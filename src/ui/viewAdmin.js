// Armana — Modération : file des événements en attente, cloisonnée à MA zone.
//
// Les ACTIONS (approuver, rejeter, supprimer) sont cloisonnées en base
// (politiques can_moderate, migration 0020) : hors zone, elles échouent quoi
// qu'affiche l'écran. La LECTURE des pending, elle, reste ouverte à tous les
// modérateurs — assumé (contenu destiné au public, relu par des personnes
// choisies par le propriétaire) ; le filtre ci-dessous est donc un confort
// d'affichage, pas une barrière.
import { el, emptyState } from './components.js'
import { posterEventCard } from './posterEventCard.js'
import { studioEventItem, studioHeader } from './studio.js'
import { isAdmin } from '../lib/auth.js'
import { listPendingEvents, setEventStatus } from '../lib/events.js'
import { myModDepts } from '../lib/moderation.js'
import { nomDepartement } from '../lib/departements.js'

export async function viewAdmin() {
  const wrap = el('section', 'page page--studio-sub')
  wrap.appendChild(studioHeader('Modération', { backTo: '/parametres' }))

  if (!isAdmin()) {
    wrap.appendChild(emptyState('Accès réservé aux modérateurs.'))
    return wrap
  }

  // Ma zone : null = tous les départements (propriétaire).
  let zone = null
  try {
    zone = await myModDepts()
  } catch {
    /* migration pas encore appliquée : on montre tout, comme avant */
  }

  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      zone?.length
        ? `Événements en attente dans votre zone (${zone.join(', ')}).`
        : 'Événements en attente de validation.'
    )
  )
  const list = el('div', 'events-list')
  wrap.appendChild(list)

  let events = await listPendingEvents()
  if (zone?.length) {
    // Un événement sans département (hors territoire, sans coordonnées) reste
    // visible de tous : personne d'autre ne le verrait.
    events = events.filter((ev) => ev.dept == null || zone.includes(ev.dept))
  }

  if (!events.length) {
    list.appendChild(emptyState('Rien à modérer dans votre zone. 👌'))
    return wrap
  }

  for (const ev of events) {
    let item
    // ⚠ Deux boutons seulement. « Supprimer » a été retiré : à côté de
    // « Rejeter », il invitait à effacer définitivement l'événement de
    // quelqu'un d'un geste irréversible, là où rejeter suffit et laisse une
    // trace. La suppression reste possible depuis la fiche de l'événement.
    const approve = el('button', 'btn btn--success btn--sm')
    approve.textContent = 'Approuver'
    const reject = el('button', 'btn btn--ghost btn--sm')
    reject.textContent = 'Rejeter'

    // D'où vient l'événement : précieux dès qu'on modère plusieurs départements.
    const dept = el(
      'span',
      'fb-tag moderation-dept' + (ev.dept ? '' : ' fb-tag--bug'),
      ev.dept ? `${ev.dept} · ${nomDepartement(ev.dept)}` : 'hors territoire'
    )

    const done = () => {
      item.remove()
      if (!list.querySelector('.studio-event-item')) {
        list.appendChild(emptyState('Rien à modérer dans votre zone. 👌'))
      }
    }

    async function moderate(action) {
      ;[approve, reject].forEach((b) => (b.disabled = true))
      try {
        await action()
        done()
      } catch (e) {
        alert('Action impossible : ' + e.message)
        ;[approve, reject].forEach((b) => (b.disabled = false))
      }
    }

    approve.addEventListener('click', () => moderate(() => setEventStatus(ev.id, 'approved')))
    reject.addEventListener('click', () => moderate(() => setEventStatus(ev.id, 'rejected')))

    const card = posterEventCard(ev, { showGem: false, index: events.indexOf(ev) })
    item = studioEventItem(card, [dept, approve, reject], { status: ev.status })
    list.appendChild(item)
  }
  return wrap
}
