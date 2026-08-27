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

/**
 * Un cœur tenu à deux mains : l'écran « Faire un don ».
 * Redessiné d'après l'illustration fournie par Matthieu
 * (assets/Faire un Don.png) — mêmes formes, mêmes aplats, mais en vectoriel :
 * le PNG pesait 408 Ko pour une image qui n'est faite que de trois couleurs.
 */
export function illustrationDon() {
  return svg(
    '0 0 320 400',
    `
    <path d="M40 400V180a120 120 0 0 1 240 0v220Z" fill="#0b3fbf"/>
    <path d="M160 278c-52-38-90-70-90-116a52 52 0 0 1 90-31 52 52 0 0 1 90 31c0 46-38 78-90 116Z"
          fill="#ffc400"/>
    <g fill="#1f9235" stroke="#fffaf0" stroke-width="7" stroke-linejoin="round" stroke-linecap="round">
      <path d="M104 400V292c0-14-6-22-16-32l-24-24c-10-10-12-24-4-32s22-6 32 4l38 38c10 10 14 20 14 34v120Z"/>
      <path d="M216 400V292c0-14 6-22 16-32l24-24c10-10 12-24 4-32s-22-6-32 4l-38 38c-10 10-14 20-14 34v120Z"/>
    </g>
    <g fill="none" stroke="#fffaf0" stroke-width="5" stroke-linecap="round" opacity="0.95">
      <path d="M96 292c4-16 0-26-10-36"/>
      <path d="M224 292c-4-16 0-26 10-36"/>
    </g>
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
