// Armana — illustrations plates, dessinées en SVG inline.
//
// POURQUOI PAS DES IMAGES : les visuels des maquettes sont des aplats de
// couleur. En PNG ils pesaient près d'un mégaoctet chacun — inacceptable pour
// des gens qui ouvrent l'application en 3G au fond d'une vallée. En SVG ils ne
// coûtent RIEN de plus que le bundle, restent nets sur tous les écrans, et
// suivent les couleurs du thème.
import { el } from './components.js'

const NS = 'http://www.w3.org/2000/svg'

function svg(viewBox, contenu, { titre = '' } = {}) {
  const hote = el('div', 'illu')
  const s = document.createElementNS(NS, 'svg')
  s.setAttribute('viewBox', viewBox)
  s.setAttribute('class', 'illu__svg')
  s.setAttribute('role', titre ? 'img' : 'presentation')
  if (titre) s.setAttribute('aria-label', titre)
  else s.setAttribute('aria-hidden', 'true')
  s.innerHTML = contenu
  hote.appendChild(s)
  return hote
}

/** Un cœur tenu à deux mains : l'écran « Faire un don ». */
export function illustrationDon() {
  return svg(
    '0 0 200 210',
    `
    <path d="M20 200V80a80 80 0 0 1 160 0v120z" fill="var(--studio-blue)"/>
    <path d="M100 168c-38-26-58-48-58-72a30 30 0 0 1 58-11 30 30 0 0 1 58 11c0 24-20 46-58 72z"
          fill="var(--mask-yellow)"/>
    <path d="M62 128c-8-6-16-4-19 3-4 8-1 18 6 27l25 32a34 34 0 0 0 26 12h6v-24c0-9-4-17-11-22z"
          fill="var(--studio-green)" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
    <path d="M138 128c8-6 16-4 19 3 4 8 1 18-6 27l-25 32a34 34 0 0 1-26 12h-6v-24c0-9 4-17 11-22z"
          fill="var(--studio-green)" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
  `,
    { titre: 'Un cœur tenu à deux mains' }
  )
}

/** Une cloche sous une arche : l'écran « Notifications ». */
export function illustrationNotifications() {
  return svg(
    '0 0 200 210',
    `
    <path d="M30 200V90a70 70 0 0 1 140 0v110z" fill="var(--studio-green)"/>
    <circle cx="100" cy="56" r="9" fill="var(--mask-yellow)"/>
    <path d="M100 62a44 44 0 0 0-44 44c0 30-8 40-8 40h104s-8-10-8-40a44 44 0 0 0-44-44z"
          fill="var(--mask-yellow)"/>
    <path d="M84 156a16 16 0 0 0 32 0z" fill="var(--mask-yellow)"/>
  `
  )
}

/** Une clé sous une arche : l'écran « Nouveau mot de passe ». */
export function illustrationCle() {
  return svg(
    '0 0 200 210',
    `
    <path d="M40 200V85a60 60 0 0 1 120 0v115z" fill="var(--studio-green)"/>
    <circle cx="100" cy="78" r="30" fill="var(--mask-yellow)"/>
    <circle cx="100" cy="78" r="12" fill="var(--studio-green)"/>
    <rect x="90" y="100" width="20" height="72" rx="4" fill="var(--mask-yellow)"/>
    <rect x="110" y="122" width="20" height="14" rx="4" fill="var(--mask-yellow)"/>
    <rect x="110" y="146" width="15" height="13" rx="4" fill="var(--mask-yellow)"/>
  `
  )
}
