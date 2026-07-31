// Armana — écran détail d'un événement (photo pleine résolution + infos).
import { el, formatDateFull, formatTime, formatPrice, emptyState } from './components.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn } from '../lib/auth.js'
import { getEventById, listGemEventIds, addGem, removeGem } from '../lib/events.js'

export async function viewDetail({ query } = {}) {
  const id = query?.get('id')
  const wrap = el('section', 'page')

  const back = el('button', 'back-btn')
  back.appendChild(icon('arrowLeft'))
  back.appendChild(document.createTextNode(' Retour'))
  back.addEventListener('click', () => history.back())
  wrap.appendChild(back)

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
  wrap.appendChild(hero)

  wrap.appendChild(el('h1', 'detail__title', ev.title))

  const badges = el('div', 'detail__badges')
  if (ev.category) badges.appendChild(el('span', 'ecard__badge ecard__badge--cat', ev.category))
  badges.appendChild(
    el('span', ev.is_paid ? 'ecard__badge ecard__badge--paid' : 'ecard__badge ecard__badge--free', formatPrice(ev))
  )
  wrap.appendChild(badges)

  const when = el('p', 'detail__meta')
  when.appendChild(icon('calendar'))
  const dateTxt = ev.ends_at
    ? `${formatDateFull(ev.starts_at)} · ${formatTime(ev.starts_at)} → ${formatTime(ev.ends_at)}`
    : `${formatDateFull(ev.starts_at)} · ${formatTime(ev.starts_at)}`
  when.appendChild(document.createTextNode(' ' + dateTxt))
  wrap.appendChild(when)

  if (ev.address) {
    const where = el('p', 'detail__meta')
    where.appendChild(icon('pin'))
    where.appendChild(document.createTextNode(' ' + ev.address))
    wrap.appendChild(where)
  }

  const author = el('p', 'detail__meta')
  author.appendChild(icon('user'))
  author.appendChild(document.createTextNode(' Publié par ' + (ev.author_name || 'Anonyme')))
  wrap.appendChild(author)

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
    wrap.appendChild(favBtn)
  }

  if (ev.description) wrap.appendChild(el('p', 'detail__desc', ev.description))

  return wrap
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
