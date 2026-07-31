// Carte éditoriale dédiée à l’Agenda « Studio Affiche ».
// Elle est volontairement indépendante de la carte générique utilisée ailleurs.
import { navigate } from '../lib/router.js'
import { isLoggedIn } from '../lib/auth.js'
import { addGem, removeGem } from '../lib/events.js'
import { el, formatPrice, formatTime } from './components.js'
import { icon } from './icons.js'

const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'short' })

export function posterEventCard(ev, opts = {}) {
  const card = el('article', 'poster-card')
  const tones = ['yellow', 'red', 'green', 'blue']
  card.dataset.tone = tones[(opts.index ?? 0) % tones.length]
  card.tabIndex = 0
  card.setAttribute('aria-label', `Voir l’événement ${ev.title}`)

  const startsAt = new Date(ev.starts_at)
  const date = el('div', 'poster-card__date')
  date.appendChild(el('span', 'poster-card__day', String(startsAt.getDate()).padStart(2, '0')))
  date.appendChild(
    el('span', 'poster-card__month', MONTH.format(startsAt).replace('.', '').toUpperCase())
  )
  date.appendChild(el('span', 'poster-card__time', formatTime(ev.starts_at)))
  card.appendChild(date)

  const media = el('div', 'poster-card__media')
  const src = ev.thumb_url || ev.photo_url
  if (src) {
    const image = el('img')
    image.src = src
    image.alt = ''
    image.loading = 'lazy'
    media.appendChild(image)
  } else {
    media.classList.add('poster-card__media--empty')
  }
  card.appendChild(media)

  const info = el('div', 'poster-card__info')
  if (ev.category) info.appendChild(el('span', 'poster-card__category', ev.category))
  // Titre COMPLET : le tronquer à la première virgule amputait « Fête votive,
  // feu d'artifice et bal » sans le moindre signe. Le CSS gère l'ellipse.
  info.appendChild(el('h3', 'poster-card__title', ev.title))
  if (ev.address) info.appendChild(el('p', 'poster-card__place', ev.address))
  info.appendChild(el('span', 'poster-card__price', formatPrice(ev)))
  card.appendChild(info)

  if (opts.showGem !== false) {
    const loggedIn = isLoggedIn()
    let gemmed = Boolean(opts.gemmed)
    const favorite = el('button', 'poster-card__favorite')
    favorite.type = 'button'
    favorite.title = 'Favori'
    favorite.setAttribute('aria-label', 'Ajouter aux favoris')
    const heart = icon('heart')
    favorite.appendChild(heart)
    const paint = () => {
      favorite.classList.toggle('is-on', gemmed)
      favorite.setAttribute('aria-label', gemmed ? 'Retirer des favoris' : 'Ajouter aux favoris')
      heart.setAttribute('fill', gemmed ? 'currentColor' : 'none')
    }
    paint()
    favorite.addEventListener('click', async (event) => {
      event.stopPropagation()
      if (opts.preview) return
      if (!loggedIn) {
        navigate('/connexion')
        return
      }
      favorite.disabled = true
      try {
        if (gemmed) await removeGem(ev.id)
        else await addGem(ev.id)
        gemmed = !gemmed
        paint()
        opts.onGemChange?.(ev.id, gemmed)
      } catch (error) {
        alert('Action impossible : ' + error.message)
      } finally {
        favorite.disabled = false
      }
    })
    card.appendChild(favorite)
  }

  const open = () => {
    if (!opts.preview) navigate('/evenement?id=' + ev.id)
  }
  card.addEventListener('click', (event) => {
    if (!event.target.closest('button')) open()
  })
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open()
    }
  })

  return card
}
