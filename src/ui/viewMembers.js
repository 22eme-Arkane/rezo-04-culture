// Armana — écran « Membres » (admin) : tous les inscrits, et désignation
// directe d'un administrateur en touchant son nom.
import { el, emptyState } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { navigate } from '../lib/router.js'
import { isAdmin, getUser } from '../lib/auth.js'
import { amIOwner, listMembers } from '../lib/admins.js'

const DTF = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })

export async function viewMembers() {
  const wrap = el('section', 'page page--studio-sub')
  wrap.appendChild(studioHeader('Membres', { backTo: '/parametres' }))

  // Depuis la 0020 la liste des membres est réservée au propriétaire : la
  // garde du client doit dire la même chose que la base, sinon un modérateur
  // arrivant par l'historique verrait une erreur de chargement au lieu d'un
  // refus propre.
  if (!isAdmin() || !(await amIOwner().catch(() => false))) {
    wrap.appendChild(emptyState('Réservé au propriétaire du projet.'))
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
        'ses publications, et la zone de modération.'
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
    const liste = el('div', 'liste-compacte')
    for (const m of members) {
      const nom = m.display_name || 'Sans nom'
      const estAdmin = m.role === 'admin'

      const row = el('button', 'liste-compacte__ligne')
      row.type = 'button'
      row.appendChild(el('span', 'liste-compacte__pastille', initiales(nom)))

      const corps = el('div', 'liste-compacte__corps')
      corps.appendChild(el('span', 'liste-compacte__nom', nom))
      corps.appendChild(
        el(
          'span',
          'liste-compacte__detail',
          m.id === myId ? 'vous' : 'inscrit le ' + DTF.format(new Date(m.created_at))
        )
      )
      row.appendChild(corps)

      row.appendChild(
        el(
          'span',
          'liste-compacte__fin',
          m.is_owner ? 'Propriétaire' : estAdmin ? 'Modérateur' : 'Membre'
        )
      )
      row.addEventListener('click', () => navigate('/membre?id=' + m.id))
      liste.appendChild(row)
    }
    box.appendChild(liste)
  }

  await refresh()
  return wrap
}

/** Deux lettres pour la pastille : première du prénom, première du nom. */
export function initiales(nom) {
  const mots = String(nom || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!mots.length) return '?'
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase()
  return (mots[0][0] + mots[mots.length - 1][0]).toUpperCase()
}
