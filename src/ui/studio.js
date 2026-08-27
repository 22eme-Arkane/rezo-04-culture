import { el } from './components.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'
import { APP_URL, shareApp } from '../lib/share.js'

/** En-tête commun aux écrans du thème « Studio Affiche ». */
export function studioHeader(
  title,
  {
    tone = 'blue',
    backTo = null,
    backLabel = 'Profil',
    onBack = null,
    actions = [],
    // `sansLogo` : les écrans qui affichent DÉJÀ le logo en grand dans leur
    // corps (la connexion) ne doivent pas le montrer deux fois.
    sansLogo = false,
  } = {}
) {
  // Trois colonnes fixes (retour · titre · logo) : le titre reste ainsi
  // OPTIQUEMENT CENTRÉ sur la barre, même quand il n'y a pas de bouton retour.
  // Une simple mise en ligne l'aurait décalé d'un écran à l'autre.
  const head = el('header', `studio-head studio-head--${tone}`)

  const gauche = el('div', 'studio-head__slot')
  if (backTo || onBack) {
    head.classList.add('studio-head--sub')
    const back = el('button', 'studio-head__back')
    back.type = 'button'
    back.setAttribute('aria-label', 'Retour · ' + backLabel)
    back.title = backLabel
    back.appendChild(icon('arrowLeft'))
    back.addEventListener('click', () => (onBack ? onBack() : navigate(backTo)))
    gauche.appendChild(back)
  }
  head.appendChild(gauche)

  head.appendChild(el('h1', 'studio-head__title', title))

  const droite = el('div', 'studio-head__slot studio-head__slot--fin')
  for (const extra of actions) droite.appendChild(extra)
  if (!sansLogo) {
    const logo = el('img', 'studio-head__logo')
    logo.src = '/assets/studio-affiche/masks-logo.png'
    logo.alt = ''
    logo.setAttribute('aria-hidden', 'true')
    droite.appendChild(logo)
  }
  head.appendChild(droite)

  return head
}

/**
 * Bouton de partage de la barre de titre — pastille jaune, pictogramme vert.
 * Présent sur Profil, Carte et Favoris : Armana ne sert à rien sans monde, et
 * ce bouton doit rester à portée de pouce partout où l'on flâne.
 *
 * Sans feuille de partage native (ordinateur, navigateur ancien), le lien est
 * copié ; un message éphémère le dit, sans quoi le bouton semblerait mort.
 */
export function boutonPartage() {
  const b = el('button', 'settings-share')
  b.type = 'button'
  b.title = 'Partager Armana'
  b.setAttribute('aria-label', 'Partager Armana')
  b.appendChild(icon('share'))
  b.addEventListener('click', async () => {
    b.disabled = true
    const r = await shareApp()
    b.disabled = false
    if (r === 'shared') return
    const bulle = el('p', 'share-bulle', r === 'copied' ? '✅ Lien copié' : 'Copiez : ' + APP_URL)
    b.closest('header')?.appendChild(bulle)
    setTimeout(() => bulle.remove(), 3500)
  })
  return b
}

/** Carte-affiche avec une zone d'actions séparée (édition, modération…). */
export function studioEventItem(card, actions = [], { status = null } = {}) {
  const item = el('div', 'studio-event-item')
  item.appendChild(card)
  if (actions.length || status) {
    const row = el('div', 'studio-event-item__actions')
    if (status) {
      const labels = { pending: 'En attente', approved: 'Publié', rejected: 'Rejeté' }
      row.appendChild(
        el('span', `studio-event-status studio-event-status--${status}`, labels[status] || status)
      )
    }
    for (const action of actions) row.appendChild(action)
    item.appendChild(row)
  }
  return item
}
