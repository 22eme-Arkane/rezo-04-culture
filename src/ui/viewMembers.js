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

  // La LISTE est ouverte aux modérateurs (migration 0022) : elle ne contient
  // aucune adresse e-mail. La FICHE d'un membre, elle, en expose une et reste
  // réservée au propriétaire — d'où le `owner` ci-dessous, qui décide si les
  // lignes sont cliquables.
  if (!isAdmin()) {
    wrap.appendChild(emptyState('Réservé aux modérateurs.'))
    return wrap
  }
  const owner = await amIOwner().catch(() => false)

  const intro = el('p', 'page__subtitle', '')
  wrap.appendChild(intro)

  // ⚠ RECHERCHE CÔTÉ CLIENT, ET C'EST SUFFISANT. `list_members` renvoie déjà
  // TOUS les inscrits en une fois : filtrer ici évite un aller-retour par
  // frappe, et la liste ne compte que quelques centaines de lignes. Le jour où
  // elle en compterait des milliers, c'est le chargement complet qu'il faudrait
  // revoir, pas la recherche.
  const rechercheChamp = el('label', 'form__field membres-recherche')
  const recherche = el('input', 'form__input')
  recherche.type = 'search'
  recherche.placeholder = 'Chercher un nom…'
  recherche.autocomplete = 'off'
  rechercheChamp.appendChild(recherche)
  wrap.appendChild(rechercheChamp)

  const box = el('div', 'settings-group')
  wrap.appendChild(box)
  wrap.appendChild(
    el(
      'p',
      'form__hint',
      owner
        ? 'Touchez un membre pour ouvrir sa fiche : son adresse pour lui écrire, ' +
          'ses publications, et la zone de modération.'
        : 'Les fiches individuelles, qui portent les adresses e-mail, sont ' +
          'réservées au propriétaire du projet.'
    )
  )

  let tous = []

  async function refresh() {
    box.innerHTML = ''
    try {
      tous = await listMembers()
    } catch (e) {
      box.appendChild(emptyState('Chargement impossible : ' + e.message))
      return
    }
    peindre()
  }

  recherche.addEventListener('input', peindre)

  function peindre() {
    box.innerHTML = ''
    const q = normaliser(recherche.value)
    const members = q
      ? tous.filter((m) => normaliser(m.display_name).includes(q))
      : tous

    // Le total reste celui des INSCRITS ; pendant une recherche on annonce en
    // plus ce qu'elle donne, sinon on croirait avoir perdu des membres.
    const pluriel = tous.length > 1 ? 's' : ''
    intro.textContent = q
      ? `${members.length} sur ${tous.length} membre${pluriel}.`
      : `${tous.length} membre${pluriel} inscrit${pluriel}.`

    if (!members.length) {
      box.appendChild(emptyState('Aucun membre ne porte ce nom.'))
      return
    }

    const myId = getUser()?.id
    const liste = el('div', 'liste-compacte')
    for (const m of members) {
      const nom = m.display_name || 'Sans nom'
      const estAdmin = m.role === 'admin'

      // Un modérateur consulte la liste ; seul le propriétaire ouvre la fiche.
      // On rend donc la ligne inerte plutôt que de la laisser cliquable vers
      // une erreur — la base refuserait de toute façon (member_profile).
      const row = el(owner ? 'button' : 'div', 'liste-compacte__ligne')
      if (owner) row.type = 'button'
      else row.classList.add('liste-compacte__ligne--statique')
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

      // Un pictogramme plutôt qu'un mot : « Membre » répété sur trois cents
      // lignes n'apprenait rien et mangeait la place du nom.
      const role = el('span', 'liste-compacte__role')
      role.appendChild(icon(m.is_owner || estAdmin ? 'shield' : 'user'))
      role.title = m.is_owner ? 'Propriétaire' : estAdmin ? 'Modérateur' : 'Membre'
      role.setAttribute('aria-label', role.title)
      if (m.is_owner || estAdmin) role.classList.add('liste-compacte__role--moderateur')
      row.appendChild(role)
      if (owner) row.addEventListener('click', () => navigate('/membre?id=' + m.id))
      liste.appendChild(row)
    }
    box.appendChild(liste)
  }

  await refresh()
  return wrap
}

/**
 * Forme comparable d'un nom : minuscules, sans accents, sans espaces en trop.
 *
 * ⚠ LES ACCENTS SONT RETIRÉS DES DEUX CÔTÉS. Sans cela, chercher « Benoit »
 * ne trouvait pas « Benoît », et taper un accent sur un clavier de téléphone
 * demande un appui long que personne ne fait pour une recherche.
 */
export function normaliser(texte) {
  return String(texte || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
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
