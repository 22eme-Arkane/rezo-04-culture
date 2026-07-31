// Armana — compression d'image côté client (WebP) avant upload.
//
// Objectif : rester sur le plan gratuit Supabase. On réduit fortement le poids
// AVANT l'envoi et on génère une vignette pour les listes/cartes.
//  - photo pleine : max ~1600 px de côté, WebP qualité ~0.82
//  - vignette      : max ~400 px de côté,  WebP qualité ~0.70

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = (e) => {
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

/**
 * Redimensionne et encode une image en WebP.
 * @param {{maxSize?:number, quality?:number, crop?:{sx:number,sy:number,sw:number,sh:number}}} opts
 *   `crop` = rectangle à conserver, en pixels de la photo source (cadrage choisi
 *   par l'utilisateur dans l'aperçu). Absent → image entière.
 * @returns {Promise<Blob>}
 */
export async function toWebp(file, { maxSize = 1600, quality = 0.82, crop = null } = {}) {
  const img = await loadImage(file)
  const valid =
    crop &&
    crop.sw > 0 &&
    crop.sh > 0 &&
    crop.sx >= 0 &&
    crop.sy >= 0 &&
    crop.sx + crop.sw <= img.naturalWidth + 1 &&
    crop.sy + crop.sh <= img.naturalHeight + 1
  const src = valid
    ? crop
    : { sx: 0, sy: 0, sw: img.naturalWidth, sh: img.naturalHeight }

  const { w, h } = fit(src.sw, src.sh, maxSize)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w))
  canvas.height = Math.max(1, Math.round(h))
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, src.sx, src.sy, src.sw, src.sh, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/webp', quality)
  )
  if (!blob) throw new Error('Encodage WebP impossible')
  return blob
}

/**
 * Produit { full, thumb } (deux Blobs WebP) à partir d'un fichier image.
 * Le cadrage choisi ne s'applique QU'À LA VIGNETTE (celle des cartes) : la photo
 * pleine résolution reste entière pour l'écran de détail.
 */
export async function makePhotoVariants(file, { crop = null } = {}) {
  const [full, thumb] = await Promise.all([
    toWebp(file, { maxSize: 1600, quality: 0.82 }),
    toWebp(file, { maxSize: 400, quality: 0.7, crop }),
  ])
  return { full, thumb }
}
