import { el } from './components.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'

/** En-tête commun aux écrans du thème « Studio Affiche ». */
export function studioHeader(
  title,
  { tone = 'blue', backTo = null, backLabel = 'Profil', onBack = null } = {}
) {
  const head = el('header', `studio-head studio-head--${tone}`)

  if (backTo || onBack) {
    head.classList.add('studio-head--sub')
    const back = el('button', 'studio-head__back')
    back.type = 'button'
    back.appendChild(icon('arrowLeft'))
    back.appendChild(document.createTextNode(backLabel))
    back.addEventListener('click', () => (onBack ? onBack() : navigate(backTo)))
    head.appendChild(back)
  }

  head.appendChild(el('h1', 'studio-head__title', title))

  const logo = el('img', 'studio-head__logo')
  logo.src = '/assets/studio-affiche/masks-logo.png'
  logo.alt = ''
  logo.setAttribute('aria-hidden', 'true')
  head.appendChild(logo)

  return head
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
