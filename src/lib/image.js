// Rézo 04 Culture — compression d'image côté client (WebP) avant upload.
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
 * @returns {Promise<Blob>}
 */
export async function toWebp(file, { maxSize = 1600, quality = 0.82 } = {}) {
  const img = await loadImage(file)
  const { w, h } = fit(img.naturalWidth, img.naturalHeight, maxSize)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, w, h)
  const blob = await new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/webp', quality)
  )
  if (!blob) throw new Error('Encodage WebP impossible')
  return blob
}

/** Produit { full, thumb } (deux Blobs WebP) à partir d'un fichier image. */
export async function makePhotoVariants(file) {
  const [full, thumb] = await Promise.all([
    toWebp(file, { maxSize: 1600, quality: 0.82 }),
    toWebp(file, { maxSize: 400, quality: 0.7 }),
  ])
  return { full, thumb }
}
