// Armana — écran « Mes départements » (Profil).
//
// Filtre de territoire : il agit à la fois sur l'agenda et sur la carte. Un
// département décoché disparaît des deux — sur la carte, il repasse même sous
// le masque, comme s'il n'était pas couvert.
//
// Préférence locale à l'appareil, pas au compte : quelqu'un peut vouloir voir
// les trois départements sur son ordinateur et seulement le sien sur son
// téléphone.
import { el, toggleRow } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { isAdmin, isLoggedIn } from '../lib/auth.js'
import { amIOwner } from '../lib/admins.js'
import { DEPARTEMENTS, nomDepartement } from '../lib/departements.js'
import { getMesDepartements, setMesDepartements } from '../lib/mesDepartements.js'
import { applyModerator, myModDepts, myModeratorRequest } from '../lib/moderation.js'

export async function viewDepartements() {
  const wrap = el('section', 'page page--studio-sub')
  wrap.appendChild(studioHeader('Mes départements', { backTo: '/parametres' }))

  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      'Choisissez les départements dont vous voulez voir les événements. ' +
        'Le choix s’applique à l’agenda comme à la carte.'
    )
  )

  let choisis = getMesDepartements()
  const groupe = el('div', 'settings-group')
  const message = el('p', 'form__hint')
  const cases = new Map()

  /** Le dernier département coché ne peut pas être décoché. */
  function majVerrous() {
    const seul = choisis.length === 1
    for (const [code, entree] of cases) {
      const dernier = seul && choisis.includes(code)
      entree.toggle.disabled = dernier
      entree.ligne.classList.toggle('is-locked', dernier)
    }
    message.textContent = seul
      ? 'Au moins un département doit rester affiché.'
      : `${choisis.length} départements affichés.`
  }

  for (const d of DEPARTEMENTS) {
    // Le numéro en gros chiffres condensés à gauche, comme la maquette : c'est
    // lui qu'on cherche du regard, pas le nom complet.
    const ligne = toggleRow(d.nom, {
      prefix: el('span', 'dept-num', d.code),
      actif: choisis.includes(d.code),
      onChange: (veut) => {
        choisis = veut
          ? [...new Set([...choisis, d.code])]
          : choisis.filter((c) => c !== d.code)
        choisis = setMesDepartements(choisis)
        // On resynchronise les cases sur ce que le stockage a réellement
        // retenu, plutôt que sur ce que l'on croit avoir enregistré.
        for (const [code, e] of cases) e.toggle.checked = choisis.includes(code)
        majVerrous()
      },
    })
    const toggle = ligne.input

    cases.set(d.code, { toggle, ligne })
    groupe.appendChild(ligne)
  }

  wrap.appendChild(groupe)
  wrap.appendChild(message)
  majVerrous()

  wrap.appendChild(
    el(
      'p',
      'form__hint',
      'Ce réglage ne vaut que pour cet appareil. Il ne change rien pour les ' +
        'autres membres, et n’empêche personne de publier ailleurs.'
    )
  )

  // --- Ma zone de modération (modérateurs uniquement) ------------------------
  // Distincte du filtre d'affichage ci-dessus : l'affichage est un confort
  // local, la zone de modération est un DROIT, accordé par le propriétaire.
  // C'est ici qu'un modérateur demande à élargir sa zone (décision Matthieu).
  if (isLoggedIn() && isAdmin() && !(await amIOwner().catch(() => false))) {
    let zone = null
    let demande = null
    try {
      ;[zone, demande] = await Promise.all([myModDepts(), myModeratorRequest()])
    } catch {
      return wrap // migration pas encore appliquée : section simplement absente
    }

    wrap.appendChild(el('h3', 'support-wall__title', '🛡 Ma zone de modération'))
    wrap.appendChild(
      el(
        'p',
        'form__hint',
        zone?.length
          ? 'Vous relisez les événements de : ' +
            zone.map((c) => `${c} (${nomDepartement(c)})`).join(', ') + '.'
          : 'Vous relisez les événements de tout le territoire.'
      )
    )

    if (demande?.status === 'pending') {
      wrap.appendChild(
        el(
          'p',
          'demo-note',
          `✉ Votre demande d’extension (${demande.depts.join(', ')}) attend la ` +
            'réponse du propriétaire.'
        )
      )
      return wrap
    }

    const restants = DEPARTEMENTS.filter((d) => zone?.length && !zone.includes(d.code))
    if (!restants.length) return wrap

    wrap.appendChild(
      el('p', 'form__label', 'Demander un département de plus')
    )
    const groupe = el('div', 'settings-group')
    const cases = []
    for (const d of restants) {
      const ligne = toggleRow(d.nom, { prefix: el('span', 'dept-num', d.code) })
      ligne.input.dataset.code = d.code
      groupe.appendChild(ligne)
      cases.push(ligne.input)
    }
    wrap.appendChild(groupe)

    const msg = el('p', 'form__msg')
    const demander = el('button', 'btn btn--primary btn--block')
    demander.type = 'button'
    demander.appendChild(icon('shield'))
    demander.appendChild(document.createTextNode(' Demander l’extension'))
    demander.addEventListener('click', async () => {
      const depts = cases.filter((c) => c.checked).map((c) => c.dataset.code)
      msg.className = 'form__msg'
      if (!depts.length) {
        msg.classList.add('form__msg--err')
        msg.textContent = 'Cochez au moins un département.'
        return
      }
      demander.disabled = true
      msg.textContent = 'Envoi…'
      try {
        await applyModerator(depts, null)
        msg.className = 'form__msg form__msg--ok'
        msg.textContent = '✅ Demande envoyée au propriétaire. Réponse dans l’application.'
        demander.remove()
        groupe.remove()
      } catch (e) {
        msg.className = 'form__msg form__msg--err'
        msg.textContent = 'Envoi impossible : ' + e.message
        demander.disabled = false
      }
    })
    wrap.appendChild(demander)
    wrap.appendChild(msg)
  }

  return wrap
}
