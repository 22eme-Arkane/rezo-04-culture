// Rézo 04 Culture — barre de navigation basse (4 onglets, icônes Lucide).
import { el } from './components.js'
import { icon } from './icons.js'
import { navigate, currentRoute } from '../lib/router.js'

const TABS = [
  { path: '/', label: 'Calendrier', ic: 'calendar' },
  { path: '/carte', label: 'Map', ic: 'map' },
  { path: '/favoris', label: 'Favoris', ic: 'heart' },
  { path: '/parametres', label: 'Paramètres', ic: 'settings' },
]

// Les sous-écrans allument l'onglet parent.
const PARENT = {
  '/evenement': '/',
  '/publier': '/',
  '/mes-evenements': '/parametres',
  '/moderation': '/parametres',
  '/connexion': '/parametres',
  '/admins': '/parametres',
  '/nouveau-mdp': '/parametres',
  '/contact': '/parametres',
  '/messages': '/parametres',
}

export function buildNav() {
  const nav = el('nav', 'bottom-nav')
  const inner = el('div', 'bottom-nav__inner')
  const { path } = currentRoute()
  const active = PARENT[path] ?? path

  for (const t of TABS) {
    const b = el('button', 'navtab')
    b.appendChild(icon(t.ic))
    b.appendChild(el('span', 'navtab__label', t.label))
    if (active === t.path) b.classList.add('is-active')
    b.addEventListener('click', () => navigate(t.path))
    inner.appendChild(b)
  }

  nav.appendChild(inner)
  return nav
}
