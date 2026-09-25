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
import { decideModeratorRequest, listModeratorRequests, setModerator } from '../lib/moderation.js'
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

  // --- Candidatures en attente, EN TÊTE -------------------------------------
  // Elles vivent ici plutôt que sur un écran à part (décision de Matthieu) :
  // c'est le même sujet, et une candidature qui dort dans un onglet séparé
  // finit par ne plus être vue.
  const zoneDemandes = el('div')
  wrap.appendChild(zoneDemandes)

  const listWrap = el('div')
  wrap.appendChild(listWrap)

  async function refreshDemandes() {
    zoneDemandes.innerHTML = ''
    let demandes = []
    try {
      demandes = (await listModeratorRequests()).filter((d) => d.status === 'pending')
    } catch {
      return // migration pas encore appliquée : la section reste absente
    }
    if (!demandes.length) return

    zoneDemandes.appendChild(
      el('h3', 'support-wall__title', `Candidatures (${demandes.length})`)
    )

    for (const d of demandes) {
      // Carte compacte : il peut y en avoir beaucoup, elles ne doivent pas
      // remplir l'écran à elles seules.
      const carte = el('div', 'candidature')
      const tete = el('div', 'candidature__tete')
      tete.appendChild(el('span', 'candidature__depts', d.depts.join(' · ')))
      const ident = el('div', 'candidature__ident')
      ident.appendChild(el('strong', null, d.display_name))
      ident.appendChild(el('span', 'candidature__mail', d.email))
      tete.appendChild(ident)
      carte.appendChild(tete)

      if (d.role_actuel === 'admin') {
        carte.appendChild(
          el(
            'p',
            'candidature__note',
            `Déjà modérateur (${(d.depts_actuels ?? []).join(', ') || 'tout'}) — demande une extension.`
          )
        )
      }
      if (d.message) carte.appendChild(el('p', 'candidature__note', '« ' + d.message + ' »'))

      const rang = el('div', 'candidature__actions')
      const ok = el('button', 'btn btn--success btn--sm', 'Accepter')
      ok.type = 'button'
      const non = el('button', 'btn btn--ghost btn--sm', 'Refuser')
      non.type = 'button'
      const decider = async (accept) => {
        const q = accept
          ? `Nommer ${d.display_name} modérateur de : ${d.depts.join(', ')} ?`
          : `Refuser la candidature de ${d.display_name} ?`
        if (!confirm(q)) return
        ok.disabled = non.disabled = true
        try {
          await decideModeratorRequest(d.id, accept)
          await refreshDemandes()
          await refresh() // la personne acceptée apparaît aussitôt dans la liste
        } catch (e) {
          alert('Action impossible : ' + e.message)
          ok.disabled = non.disabled = false
        }
      }
      ok.addEventListener('click', () => decider(true))
      non.addEventListener('click', () => decider(false))
      rang.appendChild(ok)
      rang.appendChild(non)
      carte.appendChild(rang)
      zoneDemandes.appendChild(carte)
    }
  }

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
    listWrap.appendChild(
      el('h3', 'support-wall__title', `${admins.length} modérateur${admins.length > 1 ? 's' : ''}`)
    )
    const groupe = el('div', 'liste-compacte')
    for (const a of admins) {
      const ligne = el('div', 'liste-compacte__ligne liste-compacte__ligne--statique moderateur')
      const pastille = el('span', 'liste-compacte__pastille')
      pastille.appendChild(icon(a.is_owner ? 'shield' : 'user'))
      ligne.appendChild(pastille)

      const corps = el('div', 'liste-compacte__corps')
      const nom = el('span', 'liste-compacte__nom', a.display_name || a.email)
      corps.appendChild(nom)
      corps.appendChild(
        el(
          'span',
          'liste-compacte__detail',
          a.is_owner ? 'Propriétaire — tous les droits' : a.email
        )
      )
      // Le nom ouvre la fiche du membre — comme dans la liste des membres, et
      // au PROPRIÉTAIRE SEUL : la fiche porte l'adresse e-mail et les droits.
      if (!a.is_owner) {
        corps.classList.add('moderateur__ident')
        corps.setAttribute('role', 'button')
        corps.tabIndex = 0
        corps.title = 'Voir la fiche de ce membre'
        const ouvrir = () => navigate('/membre?id=' + a.id + '&retour=moderateurs')
        corps.addEventListener('click', ouvrir)
        corps.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            ouvrir()
          }
        })
      }
      ligne.appendChild(corps)

      if (a.is_owner) {
        ligne.appendChild(el('span', 'liste-compacte__fin', 'Tout le territoire'))
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

      // ⚠ LA ZONE PASSE SOUS LE NOM, ET SE REPLIE.
      // Avec sept départements, les pastilles occupaient plus de 230 px sur la
      // même ligne : le nom du modérateur n'avait plus la place de s'afficher.
      // Le bouton résume la zone (« 04 · 05 ») et l'ouvre au besoin.
      const bascule = el('button', 'moderateur__bascule')
      bascule.type = 'button'
      const resumeZone = () => (depts.length ? depts.join(' · ') : 'aucun département')
      const majBascule = () => {
        bascule.textContent = resumeZone()
        bascule.setAttribute('aria-expanded', String(zone.style.display !== 'none'))
        bascule.title = 'Modifier la zone de ' + (a.display_name || a.email)
      }
      zone.style.display = 'none'
      bascule.addEventListener('click', () => {
        zone.style.display = zone.style.display === 'none' ? '' : 'none'
        majBascule()
      })
      // Le résumé suit les bascules de département, qui enregistrent aussitôt.
      const peindreAvecResume = () => {
        peindre()
        majBascule()
      }
      for (const b of boutons.values()) b.addEventListener('click', () => setTimeout(majBascule, 0))
      majBascule()
      ligne.appendChild(bascule)

      if (a.id === myId) ligne.appendChild(el('span', 'liste-compacte__fin', 'vous'))
      groupe.appendChild(ligne)
      // La rangée de pastilles vit SOUS la ligne, en pleine largeur.
      groupe.appendChild(zone)
      peindreAvecResume()
    }
    listWrap.appendChild(groupe)
  }

  // --- Désigner par e-mail (dépannage : le chemin normal est Membres ou les
  // candidatures). La ZONE se choisit ici même : rattacher d'office au 04 puis
  // corriger dans la liste était un détour inutile, et facile à oublier. ---
  wrap.appendChild(el('h3', 'support-wall__title', 'Désigner par e-mail'))
  const form = el('div', 'form')
  const field = el('label', 'form__field')
  field.appendChild(el('span', 'form__label', 'E-mail du compte'))
  const emailInput = el('input', 'form__input')
  emailInput.type = 'email'
  emailInput.placeholder = 'personne@exemple.fr'
  field.appendChild(emailInput)
  form.appendChild(field)

  form.appendChild(el('span', 'form__label', 'Sa zone de modération'))
  const zoneNouveau = el('div', 'moderateur__zone moderateur__zone--choix')
  const choisis = new Set()
  for (const d of DEPARTEMENTS) {
    const b = el('button', 'recur__day', d.code)
    b.type = 'button'
    b.title = d.nom
    b.setAttribute('aria-label', d.nom)
    b.addEventListener('click', () => {
      if (choisis.has(d.code)) choisis.delete(d.code)
      else choisis.add(d.code)
      b.classList.toggle('is-active', choisis.has(d.code))
    })
    zoneNouveau.appendChild(b)
  }
  form.appendChild(zoneNouveau)

  const msg = el('p', 'form__msg')
  const addBtn = el('button', 'btn btn--primary btn--block')
  addBtn.type = 'button'
  addBtn.appendChild(icon('shield'))
  addBtn.appendChild(document.createTextNode(' Désigner modérateur'))
  addBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim()
    msg.className = 'form__msg'
    if (!email) {
      msg.classList.add('form__msg--err')
      msg.textContent = 'Entrez un e-mail.'
      return
    }
    if (!choisis.size) {
      msg.classList.add('form__msg--err')
      msg.textContent = 'Choisissez au moins un département.'
      return
    }
    addBtn.disabled = true
    msg.textContent = 'Traitement…'
    try {
      // Deux temps : la RPC par e-mail retrouve le compte et donne le rôle,
      // puis on pose la zone demandée. C'est la seule voie — set_moderator
      // travaille sur un identifiant, pas sur une adresse.
      const res = await setAdminByEmail(email, true)
      const depts = [...choisis].sort()
      if (res?.id) await setModerator(res.id, depts)
      msg.className = 'form__msg form__msg--ok'
      msg.textContent = `${res?.display_name || email} modère désormais : ${depts.join(', ')}.`
      emailInput.value = ''
      choisis.clear()
      for (const b of zoneNouveau.children) b.classList.remove('is-active')
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

  await Promise.all([refreshDemandes(), refresh()])
  return wrap
}
