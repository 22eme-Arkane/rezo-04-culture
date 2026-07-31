// Armana — écran Favoris : événements mis en favori par l'utilisateur.
import { el, emptyState, loginPrompt } from './components.js'
import { posterEventCard } from './posterEventCard.js'
import { studioHeader } from './studio.js'
import { isLoggedIn } from '../lib/auth.js'
import { listGemmedEvents } from '../lib/events.js'

export async function viewGems() {
  const wrap = el('section', 'screen screen--studio-favorites')
  wrap.appendChild(studioHeader('Favoris'))

  if (!isLoggedIn()) {
    wrap.appendChild(loginPrompt('Connectez-vous pour retrouver vos favoris.'))
    return wrap
  }

  const list = el('div', 'events-list studio-events-list')
  wrap.appendChild(list)

  const events = await listGemmedEvents()
  if (!events.length) {
    list.appendChild(
      emptyState('Aucun favori pour l’instant. Touchez le ♥ sur un événement pour le garder ici.')
    )
    return wrap
  }

  for (const ev of events) {
    const card = posterEventCard(ev, {
      gemmed: true,
      onGemChange: (id, on) => {
        if (!on) {
          card.remove()
          if (!list.querySelector('.poster-card')) {
            list.appendChild(emptyState('Aucun favori pour l’instant.'))
          }
        }
      },
    })
    list.appendChild(card)
  }
  return wrap
}
