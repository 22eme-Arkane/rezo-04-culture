// Armana — barre de navigation basse (4 onglets, icônes Lucide).
import { el } from './components.js'
import { icon } from './icons.js'
import { navigate, currentRoute } from '../lib/router.js'
import { isAdmin } from '../lib/auth.js'
import { listPendingCount } from '../lib/events.js'

const TABS = [
  { path: '/', label: 'Agenda', ic: 'calendar' },
  { path: '/carte', label: 'Carte', ic: 'map' },
  { path: '/favoris', label: 'Favoris', ic: 'heart' },
  { path: '/parametres', label: 'Profil', ic: 'user' },
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
  '/membres': '/parametres',
  '/statistiques': '/parametres',
  '/messages': '/parametres',
  '/soutenir': '/parametres',
  '/importer': '/',
}

export function buildNav() {
  const nav = el('nav', 'bottom-nav bottom-nav--studio')
  const inner = el('div', 'bottom-nav__inner')
  const { path } = currentRoute()
  const active = PARENT[path] ?? path

  const buttons = {}
  for (const t of TABS) {
    const b = el('button', 'navtab')
    b.appendChild(icon(t.ic))
    b.appendChild(el('span', 'navtab__label', t.label))
    if (active === t.path) b.classList.add('is-active')
    b.addEventListener('click', () => navigate(t.path))
    inner.appendChild(b)
    buttons[t.path] = b
  }

  // Notification admin : pastille sur « Paramètres » = événements en attente de
  // modération. Chargée en arrière-plan.
  if (isAdmin()) {
    listPendingCount()
      .then((pending) => {
        if (!pending) return
        const badge = el('span', 'navtab__badge', pending > 99 ? '99+' : String(pending))
        badge.title = `${pending} événement(s) à modérer`
        buttons['/parametres'].appendChild(badge)
      })
      .catch(() => {})
  }

  nav.appendChild(inner)
  return nav
}
