// Armana — accepter les photos que le navigateur ne sait pas lire (HEIC/HEIF).
//
// LE PROBLÈME
// Les iPhone, et désormais beaucoup de Samsung, enregistrent en HEIC. Aucun
// navigateur ne sait décoder ce format, sauf Safari. Sur Android, choisir une
// telle photo échouait donc sur « Image illisible » — sans dire pourquoi, ni
// que passer par un JPEG aurait marché. Signalé par une utilisatrice, et
// probablement subi en silence par d'autres.
//
// LE CHOIX
// Décodage LOCAL (bibliothèque libheif compilée), jamais un service en ligne :
// la contrainte du projet est le gratuit total, et une photo d'affiche n'a rien
// à faire chez un tiers.
//
// Le décodeur pèse 1,35 Mo. Il est donc chargé À LA DEMANDE, et uniquement
// après avoir constaté que le navigateur ne sait pas lire le fichier : celui
// qui envoie un JPEG — l'immense majorité — ne télécharge rien de plus, et
// Safari, qui lit le HEIC nativement, non plus.

const EXT_HEIC = /\.(heic|heif)$/i

/** Le navigateur sait-il afficher ce fichier tel quel ? */
function lisibleParLeNavigateur(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    const fin = (ok) => {
      URL.revokeObjectURL(url)
      resolve(ok)
    }
    img.onload = () => fin(true)
    img.onerror = () => fin(false)
    img.src = url
  })
}

function ressembleAduHeic(file) {
  const type = (file?.type || '').toLowerCase()
  // ⚠ Le type MIME est souvent VIDE pour ces fichiers selon le sélecteur
  // Android : se fier au seul type reviendrait à ne jamais convertir.
  return type.includes('heic') || type.includes('heif') || EXT_HEIC.test(file?.name || '')
}

/**
 * Renvoie un fichier que le navigateur sait afficher, en convertissant si
 * nécessaire. Lève une erreur explicite si le format reste inexploitable.
 * @param {File} file
 * @param {(etape: string) => void} [onProgres] pour prévenir l'utilisateur —
 *        la conversion d'une photo de 12 Mpx prend plusieurs secondes.
 * @returns {Promise<File>}
 */
export async function toDisplayableFile(file, onProgres) {
  if (!file) return file
  if (await lisibleParLeNavigateur(file)) return file

  if (!ressembleAduHeic(file)) {
    throw new Error(
      'ce format d’image n’est pas reconnu. Essayez avec une photo au format JPEG ou PNG.'
    )
  }

  onProgres?.('Conversion de la photo…')
  let converti
  try {
    const { default: heic2any } = await import('heic2any')
    converti = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 })
  } catch (e) {
    throw new Error(
      'cette photo est au format HEIC et n’a pas pu être convertie. ' +
        'Depuis votre téléphone, partagez-la ou enregistrez-la en JPEG, puis réessayez.'
    )
  }
  // heic2any renvoie un tableau pour les fichiers à plusieurs images (rafales).
  const blob = Array.isArray(converti) ? converti[0] : converti
  const nom = (file.name || 'photo').replace(EXT_HEIC, '') + '.jpg'
  return new File([blob], nom, { type: 'image/jpeg' })
}
