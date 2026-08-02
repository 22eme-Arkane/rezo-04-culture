// Armana — écran « Notifications » (Profil).
//
// Deux réglages distincts, et c'est volontaire :
//   1. CET APPAREIL est abonné ou non — l'autorisation du navigateur ne vaut
//      que pour le téléphone ou l'ordinateur sur lequel on se trouve ;
//   2. CE QUE JE VEUX RECEVOIR — préférences du compte, valables partout.
// Tout est désactivé au départ : rien ne part sans un choix explicite.
import { el, emptyState, loginPrompt } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { navigate, refresh } from '../lib/router.js'
import { isAdmin, isLoggedIn } from '../lib/auth.js'
import {
  TYPES,
  deviceState,
  disableOnThisDevice,
  enableOnThisDevice,
  getPrefs,
  setPrefs,
} from '../lib/notifications.js'

/** Explication honnête de l'état de l'appareil, plutôt qu'un bouton mort. */
const ETATS = {
  unsupported: {
    ton: 'warn',
    titre: 'Navigateur incompatible',
    texte:
      'Ce navigateur ne sait pas recevoir de notifications. Sur Android, Chrome les gère ; ' +
      'sur iPhone, il faut Safari et l’application installée sur l’écran d’accueil.',
  },
  'ios-not-installed': {
    ton: 'warn',
    titre: 'Installez d’abord Armana',
    texte:
      'Sur iPhone et iPad, les notifications ne fonctionnent que si l’application est ' +
      'ajoutée à l’écran d’accueil depuis Safari. Une fois installée, revenez ici.',
    lien: { libelle: 'Comment installer', vers: '/installer' },
  },
  'not-configured': {
    ton: 'warn',
    titre: 'Envoi pas encore en service',
    texte:
      'Les notifications ne sont pas encore actives côté serveur. Vous pouvez déjà ' +
      'choisir ce que vous souhaitez recevoir : vos réglages seront appliqués dès la mise en service.',
  },
  denied: {
    ton: 'warn',
    titre: 'Notifications refusées',
    texte:
      'Vous les avez refusées pour ce site, et le navigateur ne redemandera pas. ' +
      'Pour les réautoriser : touchez le cadenas dans la barre d’adresse, puis ' +
      'Notifications → Autoriser. Sur une application installée, passez par les ' +
      'réglages du téléphone.',
  },
}

export async function viewNotifications() {
  const wrap = el('section', 'page page--studio-sub')
  wrap.appendChild(studioHeader('Notifications', { backTo: '/parametres' }))

  if (!isLoggedIn()) {
    wrap.appendChild(loginPrompt('Connectez-vous pour régler vos notifications.'))
    return wrap
  }

  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      'Tout est désactivé par défaut. Vous ne recevrez que ce que vous cochez ici.'
    )
  )

  const etat = await deviceState()
  let prefs = {}
  try {
    prefs = await getPrefs()
  } catch (e) {
    wrap.appendChild(emptyState('Chargement impossible : ' + e.message))
    return wrap
  }

  // --- 1. Cet appareil ------------------------------------------------------
  wrap.appendChild(el('h3', 'support-wall__title', 'Cet appareil'))

  if (ETATS[etat]) {
    const info = ETATS[etat]
    const box = el('div', `install-note install-note--${info.ton}`)
    box.appendChild(el('p', 'install-note__title', info.titre))
    box.appendChild(el('p', 'install-note__text', info.texte))
    if (info.lien) {
      const a = el('button', 'btn btn--ghost btn--sm')
      a.type = 'button'
      a.textContent = info.lien.libelle
      a.addEventListener('click', () => navigate(info.lien.vers))
      box.appendChild(a)
    }
    wrap.appendChild(box)
  } else {
    const msg = el('p', 'form__msg')
    const bouton = el('button', etat === 'on' ? 'btn btn--ghost btn--block' : 'btn btn--primary btn--block')
    bouton.type = 'button'
    bouton.appendChild(icon(etat === 'on' ? 'check' : 'message'))
    bouton.appendChild(
      document.createTextNode(
        etat === 'on' ? ' Cet appareil est activé — le désactiver' : ' Activer sur cet appareil'
      )
    )
    bouton.addEventListener('click', async () => {
      bouton.disabled = true
      msg.className = 'form__msg'
      msg.textContent = etat === 'on' ? 'Désactivation…' : 'Autorisation…'
      try {
        if (etat === 'on') {
          await disableOnThisDevice()
        } else {
          const r = await enableOnThisDevice()
          if (r === 'denied') {
            msg.className = 'form__msg form__msg--err'
            msg.textContent =
              'Autorisation refusée. Réautorisez les notifications pour ce site, puis réessayez.'
            bouton.disabled = false
            return
          }
        }
        refresh()
      } catch (e) {
        msg.className = 'form__msg form__msg--err'
        msg.textContent = 'Action impossible : ' + e.message
        bouton.disabled = false
      }
    })
    wrap.appendChild(bouton)
    wrap.appendChild(msg)
    wrap.appendChild(
      el(
        'p',
        'form__hint',
        etat === 'on'
          ? 'Cet appareil recevra les notifications que vous cochez ci-dessous. Les autres ' +
            'appareils doivent être activés séparément.'
          : 'L’autorisation ne vaut que pour cet appareil. Vos choix ci-dessous, eux, ' +
            'suivent votre compte partout.'
      )
    )
  }

  // --- 2. Ce que je veux recevoir -------------------------------------------
  wrap.appendChild(el('h3', 'support-wall__title', 'Ce que je veux recevoir'))

  const admin = isAdmin()
  const visibles = TYPES.filter((t) => !t.adminSeulement || admin)
  const groupe = el('div', 'settings-group')
  const message = el('p', 'form__hint')

  for (const t of visibles) {
    const row = el('label', 'settings-row settings-row--static')
    const label = el('div', 'settings-row__label')
    const bloc = el('div', 'notif-type')
    bloc.appendChild(el('strong', null, t.titre))
    bloc.appendChild(el('span', 'notif-type__detail', t.detail))
    label.appendChild(bloc)
    row.appendChild(label)

    const toggle = el('input')
    toggle.type = 'checkbox'
    toggle.checked = prefs[t.cle] === true
    toggle.addEventListener('change', async () => {
      const avant = { ...prefs }
      prefs = { ...prefs, [t.cle]: toggle.checked }
      toggle.disabled = true
      message.textContent = 'Enregistrement…'
      try {
        prefs = await setPrefs(prefs)
        message.textContent = 'Réglages enregistrés.'
        setTimeout(() => (message.textContent = ''), 2500)
      } catch (e) {
        // On remet la case dans son état réel : ne jamais laisser croire que
        // c'est enregistré alors que non.
        prefs = avant
        toggle.checked = avant[t.cle] === true
        message.textContent = 'Enregistrement impossible : ' + e.message
      } finally {
        toggle.disabled = false
      }
    })
    row.appendChild(toggle)
    groupe.appendChild(row)
  }
  wrap.appendChild(groupe)
  wrap.appendChild(message)

  if (etat !== 'on') {
    wrap.appendChild(
      el(
        'p',
        'form__hint',
        '⚠ Ces choix sont enregistrés, mais rien n’arrivera sur cet appareil tant qu’il ' +
          'n’est pas activé ci-dessus.'
      )
    )
  }

  wrap.appendChild(
    el(
      'p',
      'form__hint',
      'Armana n’envoie aucun e-mail et ne transmet votre adresse à personne. ' +
        'Les notifications passent par votre navigateur, et vous pouvez tout couper ici à tout moment.'
    )
  )

  return wrap
}
