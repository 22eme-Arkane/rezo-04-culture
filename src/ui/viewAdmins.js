// Armana — écran « Modérateurs » (propriétaire uniquement) :
// qui modère quoi, ajuster les zones, désigner ou retirer.
//
// Le rôle s'appelle toujours `admin` en base (identifiant technique) ; dans
// l'interface, ce sont des modérateurs — le seul administrateur est le
// propriétaire, et cet écran lui est réservé (imposé en base, migration 0020).
import { el, emptyState } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn, getUser } from '../lib/auth.js'
import { amIOwner, listAdmins, setAdminByEmail } from '../lib/admins.js'
import { setModerator } from '../lib/moderation.js'
import { DEPARTEMENTS } from '../lib/departements.js'

export async function viewAdmins() {
  const wrap = el('section', 'page page--studio-sub')
  wrap.appendChild(studioHeader('Modérateurs', { backTo: '/parametres' }))

  if (!isLoggedIn() || !(await amIOwner())) {
    wrap.appendChild(emptyState('Réservé au propriétaire du projet.'))
    return wrap
  }

  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      'Chaque modérateur relit les événements de sa zone. Touchez les numéros ' +
        'pour ajuster les départements ; tout retirer retire le rôle.'
    )
  )

  const listWrap = el('div')
  wrap.appendChild(listWrap)

  async function refresh() {
    listWrap.innerHTML = ''
    let admins = []
    try {
      admins = await listAdmins()
    } catch (e) {
      listWrap.appendChild(emptyState('Chargement impossible : ' + e.message))
      return
    }

    const myId = getUser()?.id
    const groupe = el('div', 'settings-group')
    for (const a of admins) {
      const ligne = el('div', 'settings-row settings-row--static moderateur')
      const lab = el('div', 'settings-row__label')
      lab.appendChild(icon(a.is_owner ? 'shield' : 'user'))
      const bloc = el('div', 'notif-type')
      bloc.appendChild(el('strong', null, a.display_name || a.email))
      bloc.appendChild(
        el(
          'span',
          'notif-type__detail',
          a.is_owner ? 'Propriétaire — tous les droits' : a.email
        )
      )
      lab.appendChild(bloc)
      ligne.appendChild(lab)

      if (a.is_owner) {
        ligne.appendChild(el('span', 'fb-tag fb-tag--avis', 'Propriétaire'))
        groupe.appendChild(ligne)
        continue
      }

      // Sa zone : un bouton par département couvert, allumé ou non. Chaque
      // bascule enregistre aussitôt — pas de bouton « Enregistrer » à oublier.
      const zone = el('div', 'moderateur__zone')
      let depts = [...(a.mod_depts ?? [])]
      const boutons = new Map()
      const peindre = () => {
        for (const [code, b] of boutons) b.classList.toggle('is-active', depts.includes(code))
      }
      // ⚠ Pendant l'enregistrement, TOUTES les pastilles de la ligne sont
      // gelées : deux bascules rapprochées partiraient chacune de l'état
      // d'avant l'autre, et la seconde écraserait la première en base
      // (set_moderator remplace la zone entière). L'état repeint vient du
      // retour de la RPC — la vérité de la base, pas notre supposition.
      const geler = (oui) => {
        for (const b of boutons.values()) b.disabled = oui
      }
      for (const d of DEPARTEMENTS) {
        const b = el('button', 'recur__day', d.code)
        b.type = 'button'
        b.title = d.nom
        b.setAttribute('aria-label', d.nom)
        b.addEventListener('click', async () => {
          const prochain = depts.includes(d.code)
            ? depts.filter((c) => c !== d.code)
            : [...depts, d.code]
          if (
            !prochain.length &&
            !confirm(`Plus aucun département : retirer le rôle de modérateur à ${a.display_name || a.email} ?`)
          ) {
            return
          }
          geler(true)
          try {
            const res = await setModerator(a.id, prochain)
            if (res?.role !== 'admin') {
              await refresh() // le rôle est retiré : la ligne disparaît
              return
            }
            depts = [...(res.mod_depts ?? [])]
            peindre()
          } catch (e) {
            alert('Modification impossible : ' + e.message)
          } finally {
            geler(false)
          }
        })
        boutons.set(d.code, b)
        zone.appendChild(b)
      }
      peindre()
      ligne.appendChild(zone)

      if (a.id === myId) ligne.appendChild(el('span', 'settings-row__value', 'vous'))
      groupe.appendChild(ligne)
    }
    listWrap.appendChild(groupe)
  }

  // --- Désigner par e-mail (dépannage : le chemin normal est Membres ou les
  // candidatures). La personne est rattachée au 04, à ajuster ensuite. ---
  wrap.appendChild(el('h3', 'support-wall__title', 'Désigner par e-mail'))
  const form = el('div', 'form')
  const field = el('label', 'form__field')
  field.appendChild(el('span', 'form__label', 'E-mail du compte'))
  const emailInput = el('input', 'form__input')
  emailInput.type = 'email'
  emailInput.placeholder = 'personne@exemple.fr'
  field.appendChild(emailInput)
  form.appendChild(field)

  const msg = el('p', 'form__msg')
  const addBtn = el('button', 'btn btn--primary btn--block')
  addBtn.type = 'button'
  addBtn.appendChild(icon('shield'))
  addBtn.appendChild(document.createTextNode(' Désigner modérateur (zone : 04)'))
  addBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim()
    msg.className = 'form__msg'
    if (!email) {
      msg.classList.add('form__msg--err')
      msg.textContent = 'Entrez un e-mail.'
      return
    }
    addBtn.disabled = true
    msg.textContent = 'Traitement…'
    try {
      const res = await setAdminByEmail(email, true)
      msg.className = 'form__msg form__msg--ok'
      msg.textContent = `${res?.display_name || email} est désormais modérateur du 04 — ajustez sa zone ci-dessus.`
      emailInput.value = ''
      await refresh()
    } catch (e) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = e.message
    } finally {
      addBtn.disabled = false
    }
  })
  form.appendChild(addBtn)
  form.appendChild(msg)
  wrap.appendChild(form)

  // --- Journal des actions (propriétaire) -----------------------------------
  const grp = el('div', 'settings-group')
  const lien = el('button', 'settings-row')
  lien.type = 'button'
  const lab = el('div', 'settings-row__label')
  lab.appendChild(icon('shield'))
  lab.appendChild(document.createTextNode('Journal des actions'))
  lien.appendChild(lab)
  lien.appendChild(icon('chevronRight'))
  lien.addEventListener('click', () => navigate('/journal'))
  grp.appendChild(lien)
  wrap.appendChild(grp)
  wrap.appendChild(
    el(
      'p',
      'form__hint',
      'Qui a modéré, supprimé un événement, changé un rôle ou une zone, et quand. ' +
        'Impossible à effacer depuis l’application.'
    )
  )

  await refresh()
  return wrap
}
