// Armana — « Candidatures » (propriétaire) : accepter ou refuser les
// candidatures de modérateurs et les demandes d'extension de zone.
import { el, emptyState } from './components.js'
import { studioHeader } from './studio.js'
import { isLoggedIn } from '../lib/auth.js'
import { amIOwner } from '../lib/admins.js'
import { nomDepartement } from '../lib/departements.js'
import { decideModeratorRequest, listModeratorRequests } from '../lib/moderation.js'

const QUAND = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

const ETATS = { approved: '✅ acceptée', rejected: '✖ refusée' }

function nomsDepts(codes) {
  return (codes ?? []).map((c) => `${c} (${nomDepartement(c)})`).join(', ')
}

export async function viewApplications() {
  const wrap = el('section', 'page page--studio-sub')
  wrap.appendChild(studioHeader('Candidatures', { backTo: '/parametres' }))

  if (!isLoggedIn() || !(await amIOwner())) {
    wrap.appendChild(emptyState('Réservé au propriétaire du projet.'))
    return wrap
  }

  let demandes = []
  try {
    demandes = await listModeratorRequests()
  } catch (e) {
    wrap.appendChild(emptyState('Chargement impossible : ' + e.message))
    return wrap
  }

  const enAttente = demandes.filter((d) => d.status === 'pending')
  const tranchees = demandes.filter((d) => d.status !== 'pending')

  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      enAttente.length
        ? `${enAttente.length} candidature${enAttente.length > 1 ? 's' : ''} en attente.`
        : 'Aucune candidature en attente.'
    )
  )

  for (const d of enAttente) {
    const carte = el('div', 'support-card candidature')

    const tete = el('p', 'candidature__qui')
    tete.appendChild(el('strong', null, d.display_name))
    tete.appendChild(document.createTextNode(' · ' + d.email))
    carte.appendChild(tete)

    // Une extension de zone n'est pas une première candidature : on montre la
    // zone actuelle pour trancher en connaissance de cause.
    if (d.role_actuel === 'admin') {
      carte.appendChild(
        el(
          'p',
          'form__hint',
          `Déjà modérateur : ${nomsDepts(d.depts_actuels) || 'zone entière'} — demande une extension.`
        )
      )
    }

    carte.appendChild(el('p', 'support-text', 'Demande : ' + nomsDepts(d.depts)))
    if (d.message) {
      carte.appendChild(el('p', 'support-text support-text--muted', '« ' + d.message + ' »'))
    }
    carte.appendChild(el('p', 'form__hint', QUAND.format(new Date(d.created_at))))

    const msg = el('p', 'form__msg')
    const rang = el('div', 'form__row')
    const ok = el('button', 'btn btn--success', 'Accepter')
    ok.type = 'button'
    const non = el('button', 'btn btn--ghost', 'Refuser')
    non.type = 'button'

    const decider = async (accept) => {
      const question = accept
        ? `Nommer ${d.display_name} modérateur de : ${nomsDepts(d.depts)} ?`
        : `Refuser la candidature de ${d.display_name} ?`
      if (!confirm(question)) return
      ok.disabled = non.disabled = true
      msg.className = 'form__msg'
      msg.textContent = 'Enregistrement…'
      try {
        await decideModeratorRequest(d.id, accept)
        msg.className = 'form__msg form__msg--ok'
        msg.textContent = accept
          ? `${d.display_name} est désormais modérateur. La personne le verra dans l’application.`
          : 'Candidature refusée.'
        rang.remove()
      } catch (e) {
        msg.className = 'form__msg form__msg--err'
        msg.textContent = 'Action impossible : ' + e.message
        ok.disabled = non.disabled = false
      }
    }
    ok.addEventListener('click', () => decider(true))
    non.addEventListener('click', () => decider(false))
    rang.appendChild(ok)
    rang.appendChild(non)
    carte.appendChild(rang)
    carte.appendChild(msg)
    wrap.appendChild(carte)
  }

  if (tranchees.length) {
    wrap.appendChild(el('h3', 'support-wall__title', 'Déjà tranchées'))
    const boite = el('div', 'settings-group')
    for (const d of tranchees.slice(0, 15)) {
      const ligne = el('div', 'settings-row settings-row--static')
      const lab = el('div', 'settings-row__label')
      const bloc = el('div', 'notif-type')
      bloc.appendChild(el('strong', null, d.display_name))
      bloc.appendChild(
        el('span', 'notif-type__detail', (d.depts ?? []).join(', ') + ' · ' + (ETATS[d.status] || d.status))
      )
      lab.appendChild(bloc)
      ligne.appendChild(lab)
      ligne.appendChild(
        el('span', 'settings-row__value', d.decided_at ? QUAND.format(new Date(d.decided_at)) : '')
      )
      boite.appendChild(ligne)
    }
    wrap.appendChild(boite)
  }

  return wrap
}
