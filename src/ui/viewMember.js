// Armana — fiche d'un membre (administrateurs uniquement).
//
// Ouverte depuis l'écran Membres. Elle sert à deux choses : écrire à la
// personne, et lui donner ou lui retirer le rôle d'administrateur.
// Toutes les autorisations sont imposées en base (RPC member_profile et
// set_admin_by_id) ; les contrôles ci-dessous ne font qu'éviter d'afficher un
// bouton qui échouerait.
import { el, emptyState } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { navigate, refresh } from '../lib/router.js'
import { isAdmin, getUser } from '../lib/auth.js'
import { amIOwner, getMemberProfile } from '../lib/admins.js'
import { setModerator } from '../lib/moderation.js'
import { DEPARTEMENTS } from '../lib/departements.js'
import { copyText } from '../lib/share.js'

const DATE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

function ligne(iconEl, libelle, valeur) {
  const r = el('div', 'settings-row settings-row--static')
  const l = el('div', 'settings-row__label')
  l.appendChild(iconEl)
  l.appendChild(document.createTextNode(libelle))
  r.appendChild(l)
  r.appendChild(el('span', 'settings-row__value', valeur))
  return r
}

export async function viewMember({ query } = {}) {
  const wrap = el('section', 'page page--studio-sub')
  wrap.appendChild(studioHeader('Membre', { backTo: '/membres', backLabel: 'Membres' }))

  // Même garde que la base (member_profile est réservée au propriétaire).
  if (!isAdmin() || !(await amIOwner().catch(() => false))) {
    wrap.appendChild(emptyState('Réservé au propriétaire du projet.'))
    return wrap
  }

  const id = query?.get?.('id') || null
  if (!id) {
    wrap.appendChild(emptyState('Membre introuvable.'))
    return wrap
  }

  let m
  try {
    m = await getMemberProfile(id)
  } catch (e) {
    wrap.appendChild(emptyState('Chargement impossible : ' + e.message))
    return wrap
  }
  if (!m) {
    wrap.appendChild(emptyState('Membre introuvable.'))
    return wrap
  }

  const nom = m.display_name || 'Sans nom'
  const estAdmin = m.role === 'admin'
  const cestMoi = m.id === getUser()?.id

  // --- Identité -------------------------------------------------------------
  const tete = el('div', 'member-head')
  tete.appendChild(el('h2', 'member-head__name', nom))
  const badges = el('div', 'member-head__badges')
  if (m.is_owner) badges.appendChild(el('span', 'fb-tag fb-tag--avis', 'Propriétaire'))
  else if (estAdmin)
    badges.appendChild(
      el('span', 'fb-tag fb-tag--avis', 'Modérateur · ' + (m.mod_depts?.join(', ') || 'tous'))
    )
  else badges.appendChild(el('span', 'fb-tag', 'Membre'))
  if (m.supporter_since) badges.appendChild(el('span', 'fb-tag', '💛 Soutien'))
  tete.appendChild(badges)
  wrap.appendChild(tete)

  // --- Écrire à la personne -------------------------------------------------
  const contact = el('div', 'settings-group')
  const mailRow = el('a', 'settings-row')
  mailRow.href = 'mailto:' + m.email
  const mailLabel = el('div', 'settings-row__label')
  mailLabel.appendChild(icon('message'))
  mailLabel.appendChild(document.createTextNode(m.email))
  mailRow.appendChild(mailLabel)
  mailRow.appendChild(icon('chevronRight'))
  contact.appendChild(mailRow)
  wrap.appendChild(contact)

  // Le lien mailto ne mène nulle part si aucun logiciel de courrier n'est
  // configuré (fréquent sur ordinateur) : on offre toujours la copie.
  const copier = el('button', 'btn btn--ghost btn--block')
  copier.type = 'button'
  copier.textContent = 'Copier l’adresse'
  const copieMsg = el('p', 'form__hint')
  copier.addEventListener('click', async () => {
    const ok = await copyText(m.email)
    copieMsg.textContent = ok ? '✅ Adresse copiée.' : m.email
    setTimeout(() => (copieMsg.textContent = ''), 4000)
  })
  wrap.appendChild(copier)
  wrap.appendChild(copieMsg)

  // --- Informations ---------------------------------------------------------
  const infos = el('div', 'settings-group')
  infos.appendChild(ligne(icon('user'), 'Inscrit le', DATE.format(new Date(m.created_at))))
  infos.appendChild(
    ligne(icon('clock'), 'Dernière visite', m.last_seen ? DATE.format(new Date(m.last_seen)) : 'jamais')
  )
  infos.appendChild(ligne(icon('ticket'), 'Événements publiés', String(m.events_total)))
  if (m.events_pending > 0) {
    infos.appendChild(ligne(icon('shield'), '— en attente de modération', String(m.events_pending)))
  }
  if (m.supporter_since) {
    infos.appendChild(
      ligne(icon('heart'), 'Soutien depuis', DATE.format(new Date(m.supporter_since)))
    )
  }
  wrap.appendChild(infos)

  // --- Rôle de modérateur -----------------------------------------------------
  wrap.appendChild(el('h3', 'support-wall__title', 'Modération'))

  if (m.is_owner) {
    wrap.appendChild(
      el(
        'p',
        'form__hint',
        'Ce compte est le propriétaire du projet : il a tous les droits, et son ' +
          'rôle ne peut être modifié par personne depuis l’application.'
      )
    )
    return wrap
  }
  if (cestMoi) {
    wrap.appendChild(el('p', 'form__hint', 'Vous ne pouvez pas modifier votre propre rôle.'))
    return wrap
  }

  wrap.appendChild(
    el(
      'p',
      'form__hint',
      estAdmin
        ? 'Cochez les départements de sa zone. Tout décocher retire le rôle.'
        : 'Cochez un ou plusieurs départements pour en faire un modérateur.'
    )
  )

  const groupe = el('div', 'settings-group')
  const cases = []
  const zone = new Set(m.mod_depts ?? [])
  for (const d of DEPARTEMENTS) {
    const ligne = el('label', 'settings-row settings-row--static')
    const lab = el('div', 'settings-row__label')
    lab.appendChild(icon('pin'))
    lab.appendChild(document.createTextNode(`${d.code} · ${d.nom}`))
    ligne.appendChild(lab)
    const c = el('input')
    c.type = 'checkbox'
    c.dataset.code = d.code
    c.checked = estAdmin && zone.has(d.code)
    ligne.appendChild(c)
    groupe.appendChild(ligne)
    cases.push(c)
  }
  wrap.appendChild(groupe)

  const msg = el('p', 'form__msg')
  const bouton = el('button', 'btn btn--primary btn--block')
  bouton.type = 'button'
  bouton.appendChild(icon('shield'))
  bouton.appendChild(document.createTextNode(' Enregistrer la zone de modération'))
  bouton.addEventListener('click', async () => {
    const depts = cases.filter((c) => c.checked).map((c) => c.dataset.code)
    const question = depts.length
      ? `${nom} : modérateur de ${depts.join(', ')} ?\n\nIl pourra approuver, modifier et supprimer les événements de cette zone, et verra les statistiques.`
      : estAdmin
        ? `Retirer le rôle de modérateur à ${nom} ?`
        : null
    if (question === null) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = 'Cochez au moins un département pour en faire un modérateur.'
      return
    }
    if (!confirm(question)) return
    bouton.disabled = true
    msg.className = 'form__msg'
    msg.textContent = 'Enregistrement…'
    try {
      await setModerator(m.id, depts)
      refresh() // recharge la fiche : badge et cases suivent
    } catch (e) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = e.message
      bouton.disabled = false
    }
  })
  wrap.appendChild(bouton)
  wrap.appendChild(msg)
  wrap.appendChild(
    el(
      'p',
      'form__hint',
      'Les actions des modérateurs sont consignées dans le journal.'
    )
  )

  return wrap
}
