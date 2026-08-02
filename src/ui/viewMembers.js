// Armana — écran « Membres » (admin) : tous les inscrits, et désignation
// directe d'un administrateur en touchant son nom.
import { el, emptyState } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { navigate } from '../lib/router.js'
import { isAdmin, getUser } from '../lib/auth.js'
import { listMembers } from '../lib/admins.js'

const DTF = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })

export async function viewMembers() {
  const wrap = el('section', 'page page--studio-sub')
  wrap.appendChild(studioHeader('Membres', { backTo: '/parametres' }))

  if (!isAdmin()) {
    wrap.appendChild(emptyState('Accès réservé aux administrateurs.'))
    return wrap
  }

  const intro = el('p', 'page__subtitle', '')
  wrap.appendChild(intro)
  const box = el('div', 'settings-group')
  wrap.appendChild(box)
  wrap.appendChild(
    el(
      'p',
      'form__hint',
      'Touchez un membre pour ouvrir sa fiche : son adresse pour lui écrire, ' +
        'ses publications, et la désignation comme administrateur.'
    )
  )

  async function refresh() {
    box.innerHTML = ''
    let members = []
    try {
      members = await listMembers()
    } catch (e) {
      box.appendChild(emptyState('Chargement impossible : ' + e.message))
      return
    }

    intro.textContent = `${members.length} membre${members.length > 1 ? 's' : ''} inscrit${
      members.length > 1 ? 's' : ''
    }.`

    const myId = getUser()?.id
    for (const m of members) {
      const nom = m.display_name || 'Sans nom'
      const estAdmin = m.role === 'admin'

      const row = el('button', 'settings-row')
      row.type = 'button'
      const label = el('div', 'settings-row__label')
      label.appendChild(icon(m.is_owner ? 'shield' : 'user'))
      label.appendChild(document.createTextNode(nom))
      if (m.is_owner) label.appendChild(el('span', 'fb-tag fb-tag--avis', 'Propriétaire'))
      else if (estAdmin) label.appendChild(el('span', 'fb-tag fb-tag--avis', 'Admin'))
      row.appendChild(label)
      row.appendChild(
        el(
          'span',
          'settings-row__value',
          m.id === myId ? 'vous' : DTF.format(new Date(m.created_at))
        )
      )
      row.appendChild(icon('chevronRight'))
      row.addEventListener('click', () => navigate('/membre?id=' + m.id))
      box.appendChild(row)
    }
  }

  await refresh()
  return wrap
}
