// Rézo 04 Culture — Modération (admin) : file des événements en attente.
import { el, eventCard, emptyState } from './components.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'
import { isAdmin } from '../lib/auth.js'
import { listPendingEvents, setEventStatus, deleteEvent } from '../lib/events.js'

export async function viewAdmin() {
  const wrap = el('section', 'page')

  const back = el('button', 'back-btn')
  back.appendChild(icon('arrowLeft'))
  back.appendChild(document.createTextNode(' Paramètres'))
  back.addEventListener('click', () => navigate('/parametres'))
  wrap.appendChild(back)

  wrap.appendChild(el('h1', 'page__title', 'Modération'))

  if (!isAdmin()) {
    wrap.appendChild(emptyState('Accès réservé aux administrateurs.'))
    return wrap
  }

  wrap.appendChild(el('p', 'page__subtitle', 'Événements en attente de validation.'))
  const list = el('div', 'events-list')
  wrap.appendChild(list)

  const events = await listPendingEvents()
  if (!events.length) {
    list.appendChild(emptyState('Rien à modérer. 👌'))
    return wrap
  }

  for (const ev of events) {
    const approve = el('button', 'btn btn--success btn--sm')
    approve.textContent = '✅ Approuver'
    const reject = el('button', 'btn btn--ghost btn--sm')
    reject.textContent = '⛔ Rejeter'
    const del = el('button', 'btn btn--danger btn--sm')
    del.textContent = '🗑 Supprimer'

    const done = () => {
      card.remove()
      if (!list.querySelector('.ecard')) list.appendChild(emptyState('Rien à modérer. 👌'))
    }

    async function moderate(action) {
      ;[approve, reject, del].forEach((b) => (b.disabled = true))
      try {
        await action()
        done()
      } catch (e) {
        alert('Action impossible : ' + e.message)
        ;[approve, reject, del].forEach((b) => (b.disabled = false))
      }
    }

    approve.addEventListener('click', () => moderate(() => setEventStatus(ev.id, 'approved')))
    reject.addEventListener('click', () => moderate(() => setEventStatus(ev.id, 'rejected')))
    del.addEventListener('click', () => {
      if (!confirm('Supprimer définitivement cet événement ?')) return
      moderate(() => deleteEvent(ev.id))
    })

    const card = eventCard(ev, { showGem: false, actions: [approve, reject, del] })
    list.appendChild(card)
  }
  return wrap
}
