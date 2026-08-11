// Armana — écran « Mes départements » (Profil).
//
// Filtre de territoire : il agit à la fois sur l'agenda et sur la carte. Un
// département décoché disparaît des deux — sur la carte, il repasse même sous
// le masque, comme s'il n'était pas couvert.
//
// Préférence locale à l'appareil, pas au compte : quelqu'un peut vouloir voir
// les trois départements sur son ordinateur et seulement le sien sur son
// téléphone.
import { el } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { DEPARTEMENTS } from '../lib/departements.js'
import { getMesDepartements, setMesDepartements } from '../lib/mesDepartements.js'

export function viewDepartements() {
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
    const ligne = el('label', 'settings-row settings-row--static')
    const label = el('div', 'settings-row__label')
    label.appendChild(icon('pin'))
    const bloc = el('div', 'notif-type')
    bloc.appendChild(el('strong', null, `${d.code} · ${d.nom}`))
    bloc.appendChild(el('span', 'notif-type__detail', ''))
    label.appendChild(bloc)
    ligne.appendChild(label)

    const toggle = el('input')
    toggle.type = 'checkbox'
    toggle.checked = choisis.includes(d.code)
    toggle.addEventListener('change', () => {
      choisis = toggle.checked
        ? [...new Set([...choisis, d.code])]
        : choisis.filter((c) => c !== d.code)
      choisis = setMesDepartements(choisis)
      // On resynchronise les cases sur ce que le stockage a réellement retenu,
      // plutôt que sur ce que l'on croit avoir enregistré.
      for (const [code, e] of cases) e.toggle.checked = choisis.includes(code)
      majVerrous()
    })
    ligne.appendChild(toggle)

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

  return wrap
}
