// Armana — partage de l'application.
//
// Un seul endroit pour l'adresse publique et pour la logique « partage natif,
// sinon copie dans le presse-papiers » : l'écran Profil et l'écran Installer
// s'en servent tous les deux.

export const APP_URL = 'https://armana04.vercel.app'

const TITRE = 'Armana'
const TEXTE = 'L’agenda culturel des Alpes-de-Haute-Provence.'

/**
 * Copie un texte, avec repli pour les navigateurs sans presse-papiers
 * (http, permission refusée, navigateur ancien).
 * @returns {Promise<boolean>}
 */
export async function copyText(texte) {
  try {
    await navigator.clipboard.writeText(texte)
    return true
  } catch {
    try {
      const zone = document.createElement('textarea')
      zone.value = texte
      zone.setAttribute('readonly', '')
      zone.style.position = 'fixed'
      zone.style.opacity = '0'
      document.body.appendChild(zone)
      zone.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(zone)
      return ok
    } catch {
      return false
    }
  }
}

/**
 * Propose de partager Armana.
 * @returns {Promise<'shared'|'copied'|'cancelled'|'failed'>}
 *   `shared`   : la feuille de partage du système a été utilisée ;
 *   `copied`   : pas de partage natif → le lien est dans le presse-papiers ;
 *   `cancelled`: l'utilisateur a fermé la feuille de partage — ne rien afficher.
 */
export async function shareApp() {
  if (navigator.share) {
    try {
      await navigator.share({ title: TITRE, text: TEXTE, url: APP_URL })
      return 'shared'
    } catch (e) {
      // AbortError = fermeture volontaire de la feuille de partage : ce n'est
      // pas un échec, et il ne faut surtout pas enchaîner sur une copie.
      if (e?.name === 'AbortError') return 'cancelled'
      // Autre échec (permission, contexte non sécurisé) : on se rabat sur la copie.
    }
  }
  return (await copyText(APP_URL)) ? 'copied' : 'failed'
}
