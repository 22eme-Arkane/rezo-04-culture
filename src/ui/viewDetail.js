// Armana — écran détail d'un événement (photo pleine résolution + infos).
import { el, formatDateFull, formatTime, formatPrice, emptyState } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { isAdmin, isLoggedIn, getUser } from '../lib/auth.js'
import { navigate } from '../lib/router.js'
import { sendFeedback } from '../lib/feedback.js'
import {
  getEventById,
  listGemEventIds,
  addGem,
  removeGem,
  deleteEvent,
} from '../lib/events.js'

export async function viewDetail({ query } = {}) {
  const id = query?.get('id')
  const wrap = el('section', 'page page--studio-sub page--studio-detail')
  wrap.appendChild(
    studioHeader('Événement', { backLabel: 'Retour', onBack: () => history.back() })
  )

  if (!id) {
    wrap.appendChild(emptyState('Événement introuvable.'))
    return wrap
  }

  const ev = await getEventById(id)
  if (!ev) {
    wrap.appendChild(emptyState('Cet événement n’existe plus.'))
    return wrap
  }

  // Photo pleine résolution (chargée seulement ici, jamais dans les listes).
  // Tap sur la photo → aperçu plein écran.
  const hero = el('div', 'detail__hero')
  if (ev.photo_url) {
    const img = el('img')
    img.src = ev.photo_url
    img.alt = ev.title
    hero.appendChild(img)
    hero.classList.add('detail__hero--zoomable')
    hero.addEventListener('click', () => openLightbox(ev.photo_url, ev.title))
  }
  const card = el('article', 'detail-card')
  card.appendChild(hero)
  const body = el('div', 'detail-card__body')

  body.appendChild(el('h2', 'detail__title', ev.title))

  const badges = el('div', 'detail__badges')
  if (ev.category) badges.appendChild(el('span', 'ecard__badge ecard__badge--cat', ev.category))
  badges.appendChild(
    el('span', ev.is_paid ? 'ecard__badge ecard__badge--paid' : 'ecard__badge ecard__badge--free', formatPrice(ev))
  )
  body.appendChild(badges)

  const facts = el('div', 'detail__facts')

  const when = el('p', 'detail__meta')
  when.appendChild(icon('calendar'))
  const dateTxt = ev.ends_at
    ? `${formatDateFull(ev.starts_at)} · ${formatTime(ev.starts_at)} → ${formatTime(ev.ends_at)}`
    : `${formatDateFull(ev.starts_at)} · ${formatTime(ev.starts_at)}`
  when.appendChild(document.createTextNode(' ' + dateTxt))
  facts.appendChild(when)

  if (ev.address) {
    const where = el('p', 'detail__meta')
    where.appendChild(icon('pin'))
    where.appendChild(document.createTextNode(' ' + ev.address))
    facts.appendChild(where)
  }

  const author = el('p', 'detail__meta')
  author.appendChild(icon('user'))
  author.appendChild(document.createTextNode(' Publié par ' + (ev.author_name || 'Anonyme')))
  facts.appendChild(author)
  body.appendChild(facts)

  // Favori (connecté).
  if (isLoggedIn()) {
    const gemIds = await listGemEventIds()
    let on = gemIds.has(ev.id)
    const favBtn = el('button', 'btn btn--block')
    const paint = () => {
      favBtn.className = on ? 'btn btn--primary btn--block' : 'btn btn--block'
      favBtn.textContent = ''
      const h = icon('heart')
      h.setAttribute('fill', on ? 'currentColor' : 'none')
      favBtn.appendChild(h)
      favBtn.appendChild(document.createTextNode(on ? ' Retirer des favoris' : ' Ajouter aux favoris'))
    }
    paint()
    favBtn.addEventListener('click', async () => {
      favBtn.disabled = true
      try {
        if (on) await removeGem(ev.id)
        else await addGem(ev.id)
        on = !on
        paint()
      } catch (e) {
        alert('Action impossible : ' + e.message)
      } finally {
        favBtn.disabled = false
      }
    })
    body.appendChild(favBtn)
  }

  if (ev.description) {
    const desc = el('div', 'detail__description')
    desc.appendChild(el('h3', 'detail__section-title', 'À propos'))
    desc.appendChild(el('p', 'detail__desc', ev.description))
    body.appendChild(desc)
  }

  card.appendChild(body)
  wrap.appendChild(card)

  // --- Actions en bas de page ---------------------------------------------
  // L'auteur et les administrateurs gèrent l'événement ; les autres personnes
  // connectées peuvent le signaler. Les droits sont AUSSI imposés côté base
  // (RLS) : ce qui suit ne fait que masquer ce qui serait de toute façon refusé.
  wrap.appendChild(buildActions(ev))

  return wrap
}

function buildActions(ev) {
  const zone = el('div', 'detail-actions')
  const uid = getUser()?.id ?? null
  const estAuteur = Boolean(uid && ev.created_by === uid)
  const peutGerer = estAuteur || isAdmin()

  if (peutGerer) {
    zone.appendChild(el('h3', 'detail__section-title', 'Gérer cet événement'))

    const edit = el('button', 'btn btn--block')
    edit.type = 'button'
    edit.appendChild(icon('plus'))
    edit.appendChild(document.createTextNode(' Modifier l’événement'))
    edit.addEventListener('click', () => navigate('/publier?id=' + ev.id))
    zone.appendChild(edit)

    const msg = el('p', 'form__msg')

    const del = el('button', 'btn btn--danger btn--block')
    del.type = 'button'
    del.appendChild(icon('logOut'))
    del.appendChild(document.createTextNode(' Supprimer l’événement'))
    del.addEventListener('click', async () => {
      if (
        !confirm(
          `Supprimer définitivement « ${ev.title} » ?\n\nLa photo sera également effacée. Cette action est irréversible.`
        )
      )
        return
      del.disabled = true
      edit.disabled = true
      msg.className = 'form__msg'
      msg.textContent = 'Suppression…'
      try {
        await deleteEvent(ev.id)
        navigate(estAuteur && !isAdmin() ? '/mes-evenements' : '/')
      } catch (e) {
        msg.className = 'form__msg form__msg--err'
        msg.textContent = 'Suppression impossible : ' + e.message
        del.disabled = false
        edit.disabled = false
      }
    })
    zone.appendChild(del)
    zone.appendChild(msg)
    return zone
  }

  if (!isLoggedIn()) return zone

  // --- Signalement (personnes connectées, ni auteur ni admin) ---------------
  zone.appendChild(el('h3', 'detail__section-title', 'Un problème sur cet événement ?'))

  const open = el('button', 'btn btn--ghost btn--block')
  open.type = 'button'
  open.appendChild(icon('message'))
  open.appendChild(document.createTextNode(' Signaler un problème'))
  zone.appendChild(open)

  const form = el('form', 'form detail-report')
  form.hidden = true
  const field = el('label', 'form__field')
  field.appendChild(el('span', 'form__label', 'Que se passe-t-il ?'))
  const area = el('textarea', 'form__input form__textarea')
  area.rows = 4
  area.placeholder =
    'Date erronée, événement annulé, lieu incorrect, contenu inapproprié…'
  field.appendChild(area)
  form.appendChild(field)
  const send = el('button', 'btn btn--primary btn--block', 'Envoyer aux administrateurs')
  send.type = 'submit'
  form.appendChild(send)
  const msg = el('p', 'form__msg')
  form.appendChild(msg)
  zone.appendChild(form)

  open.addEventListener('click', () => {
    form.hidden = !form.hidden
    if (!form.hidden) area.focus()
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const texte = area.value.trim()
    if (texte.length < 3) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = 'Décrivez brièvement le problème.'
      return
    }
    send.disabled = true
    msg.className = 'form__msg'
    msg.textContent = 'Envoi…'
    try {
      // On joint le titre ET l'identifiant : un admin doit pouvoir retrouver
      // l'événement concerné sans avoir à deviner.
      await sendFeedback({
        type: 'bug',
        message: `Signalement sur l'événement « ${ev.title} » (${ev.id})\n\n${texte}`,
      })
      form.innerHTML = ''
      form.appendChild(
        el(
          'p',
          'form__msg form__msg--ok',
          'Merci, le signalement a été transmis aux administrateurs. 🙏'
        )
      )
      open.disabled = true
    } catch (err) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = 'Envoi impossible : ' + err.message
      send.disabled = false
    }
  })

  return zone
}

// Aperçu plein écran d'une image (tap ou Échap pour fermer).
function openLightbox(src, alt) {
  const overlay = el('div', 'lightbox')
  const img = el('img')
  img.src = src
  img.alt = alt || ''
  overlay.appendChild(img)
  const close = () => {
    overlay.remove()
    document.removeEventListener('keydown', onKey)
  }
  const onKey = (e) => {
    if (e.key === 'Escape') close()
  }
  overlay.addEventListener('click', close)
  document.addEventListener('keydown', onKey)
  document.body.appendChild(overlay)
}
