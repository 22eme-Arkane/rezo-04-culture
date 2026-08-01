// Armana — compression d'image côté client avant upload.
//
// Objectif : rester sur le plan gratuit Supabase. On réduit fortement le poids
// AVANT l'envoi et on génère une vignette pour les listes/cartes.
//  - photo pleine : max ~1600 px de côté
//  - vignette      : max ~400 px de côté, cadrée comme dans l'aperçu
//
// ⚠ PIÈGE CORRIGÉ (retour utilisateur, affiche de la Saint-Laurent) :
// `canvas.toBlob(cb, 'image/webp', q)` ne LÈVE PAS d'erreur quand le navigateur
// ne sait pas encoder le WebP — la spécification impose de retomber sur PNG,
// silencieusement. Un PNG de 1600 px d'affiche colorée pèse plusieurs Mo et se
// faisait refuser par le bucket (« The object exceeded the maximum allowed
// size »). On vérifie donc le type réellement produit, on se rabat sur JPEG, et
// on boucle jusqu'à tenir dans le budget de poids.

// Le bucket plafonne à 3 Mo (migration 0009) : on garde une vraie marge.
const BUDGET_FULL = 2_400_000
const BUDGET_THUMB = 400_000

// --- Capacité d'encodage du navigateur --------------------------------------
// Testée une seule fois : `toDataURL` renvoie du PNG quand le type est refusé.
let webpOk = null
function supportsWebp() {
  if (webpOk !== null) return webpOk
  try {
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    webpOk = c.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    webpOk = false
  }
  return webpOk
}

/** Type d'encodage retenu pour cet appareil. */
export function outputType() {
  return supportsWebp() ? 'image/webp' : 'image/jpeg'
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Image illisible'))
    }
    img.src = url
  })
}

function fit(w, h, maxSize) {
  if (w <= maxSize && h <= maxSize) return { w, h }
  const ratio = w > h ? maxSize / w : maxSize / h
  return { w: Math.round(w * ratio), h: Math.round(h * ratio) }
}

function encode(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality))
}

/**
 * Dessine la zone `src` de `img` sur un canevas de `w`×`h`.
 *
 * `src` peut DÉBORDER de la photo (l'auteur a dézoomé au-delà du cadrage
 * « couvrir » pour montrer l'affiche en entier). Les bords découverts sont
 * alors comblés par la photo elle-même, agrandie et floutée : bien plus
 * présentable qu'une bande transparente ou noire.
 */
function paint(img, src, w, h) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w))
  canvas.height = Math.max(1, Math.round(h))
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'

  const iw = img.naturalWidth
  const ih = img.naturalHeight
  const deborde = src.sx < 0 || src.sy < 0 || src.sx + src.sw > iw || src.sy + src.sh > ih

  if (deborde) {
    // Fond : la photo entière étirée pour couvrir, débordant un peu du canevas
    // pour que le flou ne laisse pas apparaître de bord translucide.
    const couvre = Math.max(canvas.width / iw, canvas.height / ih) * 1.25
    const bw = iw * couvre
    const bh = ih * couvre
    // `ctx.filter` n'existe pas partout (Safari ancien) : l'affectation est
    // alors ignorée et l'on garde un fond net — acceptable comme repli.
    ctx.filter = 'blur(18px) brightness(0.85)'
    ctx.drawImage(img, (canvas.width - bw) / 2, (canvas.height - bh) / 2, bw, bh)
    ctx.filter = 'none'

    // Puis la photo à sa place réelle dans le rectangle demandé.
    const kx = canvas.width / src.sw
    const ky = canvas.height / src.sh
    ctx.drawImage(img, -src.sx * kx, -src.sy * ky, iw * kx, ih * ky)
  } else {
    ctx.drawImage(img, src.sx, src.sy, src.sw, src.sh, 0, 0, canvas.width, canvas.height)
  }
  return canvas
}

/**
 * Encode en respectant un budget de poids : on baisse d'abord la qualité, puis
 * les dimensions. Garantit qu'on n'envoie jamais un fichier refusé par le bucket.
 */
async function encodeUnder(img, src, w, h, { quality, budget }) {
  const type = outputType()
  let q = quality
  let reduction = 1
  let dernier = null

  for (let essai = 0; essai < 7; essai++) {
    const canvas = paint(img, src, w * reduction, h * reduction)
    const blob = await encode(canvas, type, q)
    if (!blob) throw new Error('Encodage de l’image impossible')
    dernier = blob
    if (blob.size <= budget) return blob
    // Trop lourd : on rogne la qualité tant qu'elle reste correcte, puis la taille.
    if (q > 0.5) q = Math.max(0.5, q - 0.15)
    else reduction *= 0.75
  }
  return dernier
}

/**
 * Redimensionne et encode une image (WebP si le navigateur sait, JPEG sinon).
 * @param {{maxSize?:number, quality?:number, budget?:number,
 *          crop?:{sx:number,sy:number,sw:number,sh:number}}} opts
 *   `crop` = rectangle à conserver, en pixels de la photo source (cadrage choisi
 *   dans l'aperçu). Il peut déborder de la photo — voir `paint()`.
 * @returns {Promise<Blob>}
 */
export async function toWebp(
  file,
  { maxSize = 1600, quality = 0.82, budget = BUDGET_FULL, crop = null } = {}
) {
  const img = await loadImage(file)
  const src =
    crop && crop.sw > 0 && crop.sh > 0
      ? crop
      : { sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight }

  const { w, h } = fit(src.sw, src.sh, maxSize)
  return encodeUnder(img, src, w, h, { quality, budget })
}

/**
 * Produit { full, thumb, type } à partir d'un fichier image.
 * Le cadrage choisi ne s'applique QU'À LA VIGNETTE (celle des cartes) : la photo
 * pleine résolution reste entière pour l'écran de détail.
 */
export async function makePhotoVariants(file, { crop = null } = {}) {
  const [full, thumb] = await Promise.all([
    toWebp(file, { maxSize: 1600, quality: 0.82, budget: BUDGET_FULL }),
    toWebp(file, { maxSize: 400, quality: 0.7, budget: BUDGET_THUMB, crop }),
  ])
  return { full, thumb, type: outputType() }
}
