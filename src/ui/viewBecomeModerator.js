// Armana — « Devenir modérateur » : présentation du rôle et candidature.
//
// Visible de tous les membres connectés. Un modérateur en place passe par
// « Mes départements » pour demander une extension de zone (même mécanisme
// en base, autre porte d'entrée) : cet écran le lui rappelle.
import { el, loginPrompt } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { navigate } from '../lib/router.js'
import { isAdmin, isLoggedIn } from '../lib/auth.js'
import { DEPARTEMENTS } from '../lib/departements.js'
import { applyModerator, myModeratorRequest } from '../lib/moderation.js'

const QUAND = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' })

export async function viewBecomeModerator() {
  const wrap = el('section', 'page page--studio-sub')
  wrap.appendChild(studioHeader('Devenir modérateur', { backTo: '/parametres' }))

  if (!isLoggedIn()) {
    wrap.appendChild(loginPrompt('Connectez-vous pour proposer votre aide.'))
    return wrap
  }

  if (isAdmin()) {
    wrap.appendChild(
      el(
        'p',
        'page__subtitle',
        'Vous êtes déjà modérateur ou modératrice. Pour élargir votre zone à un ' +
          'autre département, passez par « Mes départements ».'
      )
    )
    const aller = el('button', 'btn btn--primary btn--block')
    aller.type = 'button'
    aller.appendChild(icon('map'))
    aller.appendChild(document.createTextNode(' Ouvrir Mes départements'))
    aller.addEventListener('click', () => navigate('/mes-departements'))
    wrap.appendChild(aller)
    return wrap
  }

  // --- Présentation du rôle --------------------------------------------------
  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      'Armana grandit, et une personne ne peut pas tout relire seule. Nous ' +
        'cherchons des habitants qui connaissent leur coin pour veiller sur ' +
        'l’agenda de leur département.'
    )
  )

  const carte = el('div', 'support-card')
  carte.appendChild(
    el(
      'p',
      'support-text',
      'Chaque événement publié est relu avant d’apparaître dans l’agenda : c’est ' +
        'ce qui garde Armana fiable. Modérer, c’est vérifier que la date, le lieu ' +
        'et la photo correspondent, approuver, et écarter les doublons ou les ' +
        'annonces déplacées.'
    )
  )
  carte.appendChild(
    el(
      'p',
      'support-text support-text--muted',
      'Quelques minutes par semaine, directement depuis l’application, avec une ' +
        'notification quand un événement de votre zone attend. C’est bénévole, et ' +
        'vous pouvez arrêter quand vous voulez.'
    )
  )
  wrap.appendChild(carte)

  // --- État d'une éventuelle candidature -------------------------------------
  let demande = null
  try {
    demande = await myModeratorRequest()
  } catch {
    /* réseau ou migration absente : le formulaire reste utilisable */
  }

  if (demande?.status === 'pending') {
    wrap.appendChild(
      el(
        'p',
        'demo-note',
        `✉ Votre candidature du ${QUAND.format(new Date(demande.created_at))} ` +
          `(${demande.depts.join(', ')}) est en attente de réponse. La réponse ` +
          'arrivera ici même.'
      )
    )
    return wrap
  }
  if (demande?.status === 'approved') {
    // Acceptée, mais le profil en mémoire date d'avant : sans ce message, la
    // personne retomberait sur le formulaire comme si rien ne s'était passé.
    wrap.appendChild(
      el(
        'p',
        'demo-note',
        '🎉 Votre candidature a été acceptée ! Fermez et rouvrez l’application ' +
          'pour voir vos outils de modération dans le Profil.'
      )
    )
    return wrap
  }
  if (demande?.status === 'rejected') {
    wrap.appendChild(
      el(
        'p',
        'form__hint',
        'Votre précédente candidature n’a pas été retenue. Vous pouvez en ' +
          'proposer une nouvelle.'
      )
    )
  }

  // --- Formulaire -------------------------------------------------------------
  wrap.appendChild(el('h3', 'support-wall__title', 'Ma candidature'))
  wrap.appendChild(el('p', 'form__label', 'Département(s) que je connais bien'))

  const rangs = el('div', 'settings-group')
  const cases = []
  for (const d of DEPARTEMENTS) {
    const ligne = el('label', 'settings-row settings-row--static')
    const lab = el('div', 'settings-row__label')
    lab.appendChild(icon('pin'))
    lab.appendChild(document.createTextNode(`${d.code} · ${d.nom}`))
    ligne.appendChild(lab)
    const c = el('input')
    c.type = 'checkbox'
    c.dataset.code = d.code
    ligne.appendChild(c)
    rangs.appendChild(ligne)
    cases.push(c)
  }
  wrap.appendChild(rangs)

  const champ = el('label', 'form__field')
  champ.appendChild(el('span', 'form__label', 'Deux mots sur vous (facultatif)'))
  const zone = el('textarea', 'form__input form__textarea')
  zone.rows = 3
  zone.maxLength = 1000
  zone.placeholder = 'Qui êtes-vous, et pourquoi ça vous tente ?'
  champ.appendChild(zone)
  wrap.appendChild(champ)

  const msg = el('p', 'form__msg')
  const envoyer = el('button', 'btn btn--primary btn--block')
  envoyer.type = 'button'
  envoyer.appendChild(icon('shield'))
  envoyer.appendChild(document.createTextNode(' Envoyer ma candidature'))
  envoyer.addEventListener('click', async () => {
    const depts = cases.filter((c) => c.checked).map((c) => c.dataset.code)
    msg.className = 'form__msg'
    if (!depts.length) {
      msg.classList.add('form__msg--err')
      msg.textContent = 'Choisissez au moins un département.'
      return
    }
    envoyer.disabled = true
    msg.textContent = 'Envoi…'
    try {
      await applyModerator(depts, zone.value.trim())
      msg.className = 'form__msg form__msg--ok'
      msg.textContent =
        '✅ Candidature envoyée. Vous recevrez la réponse ici, dans l’application.'
      envoyer.remove()
    } catch (e) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = 'Envoi impossible : ' + e.message
      envoyer.disabled = false
    }
  })
  wrap.appendChild(envoyer)
  wrap.appendChild(msg)

  return wrap
}
