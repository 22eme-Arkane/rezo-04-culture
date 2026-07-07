// Rézo 04 Culture — Mes événements : liste de mes publications + édition/suppression.
import { el, eventCard, emptyState, loginPrompt } from './components.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn } from '../lib/auth.js'
import { listMyEvents, deleteEvent } from '../lib/events.js'

export async function viewMine() {
  const wrap = el('section', 'page')

  const back = el('button', 'back-btn')
  back.appendChild(icon('arrowLeft'))
  back.appendChild(document.createTextNode(' Paramètres'))
  back.addEventListener('click', () => navigate('/parametres'))
  wrap.appendChild(back)

  const head = el('div', 'page__head')
  head.appendChild(el('h1', 'page__title', 'Mes événements'))
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
    const edit = el('button', 'btn btn--sm')
    edit.textContent = '✏️ Modifier'
    edit.addEventListener('click', () => navigate('/publier?id=' + ev.id))

    const del = el('button', 'btn btn--danger btn--sm')
    del.textContent = '🗑 Supprimer'
    del.addEventListener('click', async () => {
      if (!confirm('Supprimer définitivement « ' + ev.title + ' » ?')) return
      del.disabled = true
      try {
        await deleteEvent(ev.id)
        card.remove()
        if (!list.querySelector('.ecard')) {
          list.appendChild(emptyState('Vous n’avez encore rien publié.'))
        }
      } catch (e) {
        alert('Suppression impossible : ' + e.message)
        del.disabled = false
      }
    })

    const card = eventCard(ev, { showGem: false, actions: [edit, del] })
    list.appendChild(card)
  }
  return wrap
}
