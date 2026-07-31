import { el } from './components.js'

/** En-tête commun aux écrans du thème « Studio Affiche ». */
export function studioHeader(title, { tone = 'blue' } = {}) {
  const head = el('header', `studio-head studio-head--${tone}`)
  head.appendChild(el('h1', 'studio-head__title', title))

  const logo = el('img', 'studio-head__logo')
  logo.src = '/assets/studio-affiche/masks-logo.png'
  logo.alt = ''
  logo.setAttribute('aria-hidden', 'true')
  head.appendChild(logo)

  return head
}
