// Armana — Mes événements : liste de mes publications + édition/suppression.
import { el, emptyState, loginPrompt } from './components.js'
import { icon } from './icons.js'
import { posterEventCard } from './posterEventCard.js'
import { studioEventItem, studioHeader } from './studio.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn } from '../lib/auth.js'
import { listMyEvents, deleteEvent } from '../lib/events.js'

export async function viewMine() {
  const wrap = el('section', 'page page--studio-sub')
  wrap.appendChild(studioHeader('Mes événements', { backTo: '/parametres' }))

  const head = el('div', 'studio-toolbar')
  head.appendChild(el('p', 'page__subtitle', 'Retrouvez, modifiez ou supprimez vos publications.'))
  const add = el('button', 'btn btn--green btn--sm')
  add.appendChild(icon('plus'))
  add.appendChild(document.createTextNode(' Nouveau'))
  add.addEventListener('click', () => navigate('/publier'))
  head.appendChild(add)
  wrap.appendChild(head)

  if (!isLoggedIn()) {
    wrap.appendChild(loginPrompt('Connectez-vous pour gérer vos événements.'))
    return wrap
  }

  const list = el('div', 'events-list')
  wrap.appendChild(list)

  const events = await listMyEvents()
  if (!events.length) {
    list.appendChild(emptyState('Vous n’avez encore rien publié.'))
    return wrap
  }

  for (const ev of events) {
    let item
    const edit = el('button', 'btn btn--sm')
    edit.textContent = 'Modifier'
    edit.addEventListener('click', () => navigate('/publier?id=' + ev.id))

    const del = el('button', 'btn btn--danger btn--sm')
    del.textContent = 'Supprimer'
    del.addEventListener('click', async () => {
      if (!confirm('Supprimer définitivement « ' + ev.title + ' » ?')) return
      del.disabled = true
      try {
        await deleteEvent(ev.id)
        item.remove()
        if (!list.querySelector('.studio-event-item')) {
          list.appendChild(emptyState('Vous n’avez encore rien publié.'))
        }
      } catch (e) {
        alert('Suppression impossible : ' + e.message)
        del.disabled = false
      }
    })

    const card = posterEventCard(ev, { showGem: false, index: events.indexOf(ev) })
    item = studioEventItem(card, [edit, del], { status: ev.status })
    list.appendChild(item)
  }
  return wrap
}
