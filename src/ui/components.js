// Armana — helpers UI partagés + composant Carte événement (unique).
import { navigate } from '../lib/router.js'
import { isLoggedIn } from '../lib/auth.js'
import { addGem, removeGem } from '../lib/events.js'
import { icon } from './icons.js'

const DTF_DATE = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})
const DTF_DATE_FULL = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})
const DTF_TIME = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' })
const DTF_MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' })

export function formatDate(iso) {
  return iso ? DTF_DATE.format(new Date(iso)) : ''
}
export function formatDateFull(iso) {
  return iso ? DTF_DATE_FULL.format(new Date(iso)) : ''
}
export function formatTime(iso) {
  return iso ? DTF_TIME.format(new Date(iso)) : ''
}
export function formatMonthLabel(d) {
  const label = DTF_MONTH.format(d instanceof Date ? d : new Date(d))
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function formatPrice(ev) {
  if (!ev.is_paid) return 'Gratuit'
  if (ev.price == null) return 'Payant'
  const n = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Number(ev.price))
  return `Payant · ${n} €`
}

/** Crée un élément avec classe + texte optionnels. */
export function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

/**
 * Carte événement — composant UNIQUE réutilisé partout (agenda, map, favoris,
 * mes événements, modération). Photo en haut, informations EN DESSOUS sur fond
 * clair (toujours lisibles, quelle que soit la photo — même blanche) ; sans
 * photo → bandeau "ambiance" dégradé violet. Tap → détail. Cœur = favori.
 *
 * @param {object} ev   événement enrichi (thumb_url, photo_url, author_name…)
 * @param {object} opts { gemmed, onGemChange, showGem, actions: HTMLElement[] }
 */
export function eventCard(ev, opts = {}) {
  const card = el('article', 'ecard')

  const photo = el('div', 'ecard__photo')
  const src = ev.thumb_url || ev.photo_url
  if (src) {
    const img = el('img')
    img.src = src
    img.alt = ''
    img.loading = 'lazy'
    photo.appendChild(img)
  } else {
    photo.classList.add('ecard__photo--empty')
  }
  card.appendChild(photo)

  // Cœur favori (uniquement connecté).
  if (isLoggedIn() && opts.showGem !== false) {
    let gemmed = Boolean(opts.gemmed)
    const fav = el('button', 'ecard__fav')
    fav.title = 'Favori'
    const heart = icon('heart')
    fav.appendChild(heart)
    const paint = () => {
      fav.classList.toggle('is-on', gemmed)
      heart.setAttribute('fill', gemmed ? 'currentColor' : 'none')
    }
    paint()
    fav.addEventListener('click', async (e) => {
      e.stopPropagation()
      fav.disabled = true
      try {
        if (gemmed) await removeGem(ev.id)
        else await addGem(ev.id)
        gemmed = !gemmed
        paint()
        opts.onGemChange?.(ev.id, gemmed)
      } catch (err) {
        alert('Action impossible : ' + err.message)
      } finally {
        fav.disabled = false
      }
    })
    card.appendChild(fav)
  }

  const body = el('div', 'ecard__body')

  const badges = el('div', 'ecard__badges')
  if (ev.category) badges.appendChild(el('span', 'ecard__badge ecard__badge--cat', ev.category))
  badges.appendChild(
    el('span', ev.is_paid ? 'ecard__badge ecard__badge--paid' : 'ecard__badge ecard__badge--free', formatPrice(ev))
  )
  if (ev.status && ev.status !== 'approved') {
    const map = { pending: 'En attente', rejected: 'Rejeté' }
    badges.appendChild(el('span', 'ecard__badge ecard__badge--status', map[ev.status] ?? ev.status))
  }
  body.appendChild(badges)

  body.appendChild(el('h3', 'ecard__title', ev.title))

  const when = el('p', 'ecard__meta ecard__meta--when')
  when.appendChild(icon('calendar'))
  when.appendChild(
    document.createTextNode(` ${formatDate(ev.starts_at)} · ${formatTime(ev.starts_at)}`)
  )
  body.appendChild(when)

  if (ev.address) {
    const where = el('p', 'ecard__meta ecard__meta--where')
    where.appendChild(icon('pin'))
    where.appendChild(document.createTextNode(' ' + ev.address))
    body.appendChild(where)
  }

  // Actions optionnelles (modération, édition…) — n'ouvrent pas le détail.
  if (opts.actions?.length) {
    const row = el('div', 'form__row')
    row.style.marginTop = '0.4rem'
    for (const a of opts.actions) row.appendChild(a)
    body.appendChild(row)
  }

  card.appendChild(body)

  card.addEventListener('click', (e) => {
    if (e.target.closest('button')) return
    if (opts.onOpen) opts.onOpen(ev)
    else navigate('/evenement?id=' + ev.id)
  })

  return card
}

/** Grand encart d'invitation à se connecter. */
export function loginPrompt(message) {
  const box = el('div', 'empty-state')
  box.appendChild(el('p', null, message || 'Connectez-vous pour accéder à cette section.'))
  const btn = el('button', 'btn btn--primary', 'Se connecter / S’inscrire')
  btn.addEventListener('click', () => navigate('/connexion'))
  box.appendChild(btn)
  return box
}

/** État vide générique. */
export function emptyState(message) {
  const box = el('div', 'empty-state')
  box.appendChild(el('p', null, message))
  return box
}
