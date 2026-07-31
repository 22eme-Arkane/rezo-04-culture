// Armana — écran « Membres » (admin) : tous les inscrits.
import { el, emptyState } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { isAdmin } from '../lib/auth.js'
import { listMembers } from '../lib/admins.js'

const DTF = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })

export async function viewMembers() {
  const wrap = el('section', 'page page--studio-sub')
  wrap.appendChild(studioHeader('Membres', { backTo: '/parametres' }))

  if (!isAdmin()) {
    wrap.appendChild(emptyState('Accès réservé aux administrateurs.'))
    return wrap
  }

  let members = []
  try {
    members = await listMembers()
  } catch (e) {
    wrap.appendChild(emptyState('Chargement impossible : ' + e.message))
    return wrap
  }

  wrap.appendChild(
    el('p', 'page__subtitle', `${members.length} membre${members.length > 1 ? 's' : ''} inscrit${members.length > 1 ? 's' : ''}.`)
  )

  const box = el('div', 'settings-group')
  for (const m of members) {
    const row = el('div', 'settings-row')
    const label = el('div', 'settings-row__label')
    label.appendChild(icon('user'))
    label.appendChild(document.createTextNode(m.display_name || 'Sans nom'))
    if (m.role === 'admin') {
      label.appendChild(el('span', 'fb-tag fb-tag--avis', 'Admin'))
    }
    row.appendChild(label)
    row.appendChild(el('span', 'settings-row__value', 'Inscrit le ' + DTF.format(new Date(m.created_at))))
    row.style.cursor = 'default'
    box.appendChild(row)
  }
  wrap.appendChild(box)

  return wrap
}
