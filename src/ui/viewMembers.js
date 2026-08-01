// Armana — écran « Membres » (admin) : tous les inscrits, et désignation
// directe d'un administrateur en touchant son nom.
import { el, emptyState } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { isAdmin, getUser } from '../lib/auth.js'
import { listMembers, setAdminById } from '../lib/admins.js'

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
      'Touchez un membre pour le nommer administrateur ou lui retirer ce rôle. ' +
        'Un administrateur peut modifier et supprimer tous les événements.'
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
      // Deux comptes qu'on ne peut pas toucher : le propriétaire (protégé en
      // base, migration 0011) et soi-même (on se retirerait ses propres droits).
      const verrouille = m.is_owner || m.id === myId

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
          verrouille ? (m.is_owner ? 'protégé' : 'vous') : DTF.format(new Date(m.created_at))
        )
      )

      row.addEventListener('click', async () => {
        if (m.is_owner) {
          alert(
            'Ce compte est le propriétaire du projet.\n\n' +
              'Son rôle ne peut être modifié par personne depuis l’application, ' +
              'y compris par un autre administrateur.'
          )
          return
        }
        if (m.id === myId) {
          alert('Vous ne pouvez pas modifier votre propre rôle.')
          return
        }
        const question = estAdmin
          ? `Retirer le rôle d’administrateur à ${nom} ?`
          : `Nommer ${nom} administrateur ?\n\nIl pourra modérer, modifier et supprimer tous les événements.`
        if (!confirm(question)) return

        row.disabled = true
        try {
          await setAdminById(m.id, !estAdmin)
          await refresh()
        } catch (e) {
          alert('Action impossible : ' + e.message)
          row.disabled = false
        }
      })

      box.appendChild(row)
    }
  }

  await refresh()
  return wrap
}
