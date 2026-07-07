// Rézo 04 Culture — écran Favoris : événements mis en favori par l'utilisateur.
import { el, eventCard, emptyState, loginPrompt } from './components.js'
import { isLoggedIn } from '../lib/auth.js'
import { listGemmedEvents } from '../lib/events.js'

export async function viewGems() {
  const wrap = el('section', 'screen')
  const head = el('header', 'screen-head')
  head.appendChild(el('h1', 'screen-title', 'Mes favoris'))
  wrap.appendChild(head)

  if (!isLoggedIn()) {
    wrap.appendChild(loginPrompt('Connectez-vous pour retrouver vos favoris.'))
    return wrap
  }

  const list = el('div', 'events-list')
  wrap.appendChild(list)

  const events = await listGemmedEvents()
  if (!events.length) {
    list.appendChild(
      emptyState('Aucun favori pour l’instant. Touchez le ♥ sur un événement pour le garder ici.')
    )
    return wrap
  }

  for (const ev of events) {
    const card = eventCard(ev, {
      gemmed: true,
      onGemChange: (id, on) => {
        if (!on) {
          card.remove()
          if (!list.querySelector('.ecard')) {
            list.appendChild(emptyState('Aucun favori pour l’instant.'))
          }
        }
      },
    })
    list.appendChild(card)
  }
  return wrap
}
