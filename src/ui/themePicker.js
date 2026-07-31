// Armana — modale de sélection du thème (aperçu en direct).
import { el } from './components.js'
import { THEMES, getTheme, applyTheme } from '../lib/theme.js'

export function openThemePicker() {
  const overlay = el('div', 'modal-overlay')
  const modal = el('div', 'modal')
  modal.appendChild(el('h3', 'modal__title', '🎨 Choisir un thème'))

  const grid = el('div', 'theme-grid')
  const current = getTheme()

  for (const t of THEMES) {
    const card = el('button', 'theme-swatch')
    card.type = 'button'
    if (t.key === current) card.classList.add('is-active')

    const dots = el('div', 'theme-swatch__dots')
    for (const c of t.dots) {
      const d = el('span', 'theme-swatch__dot')
      d.style.background = c
      dots.appendChild(d)
    }
    card.appendChild(dots)
    card.appendChild(el('span', 'theme-swatch__label', t.label))

    card.addEventListener('click', () => {
      applyTheme(t.key) // appliqué immédiatement → aperçu live
      grid.querySelectorAll('.theme-swatch').forEach((x) => x.classList.remove('is-active'))
      card.classList.add('is-active')
    })
    grid.appendChild(card)
  }
  modal.appendChild(grid)

  const close = el('button', 'btn btn--primary btn--block', 'Fermer')
  close.addEventListener('click', () => overlay.remove())
  modal.appendChild(close)

  overlay.appendChild(modal)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove()
  })
  document.body.appendChild(overlay)
}
