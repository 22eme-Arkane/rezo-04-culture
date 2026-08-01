// Armana — écran Paramètres : lignes compactes, ordre :
// Publier → Mes événements → (administration) → Installer → Soutenir →
// Nous contacter → compte, et le bouton de partage à côté du compte.
import { el } from './components.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn, isAdmin, getProfile, getUser, signOut } from '../lib/auth.js'
import { listPendingCount } from '../lib/events.js'
import { countFeedback } from '../lib/feedback.js'
import { currentBuild } from '../lib/update.js'
import { APP_URL, shareApp } from '../lib/share.js'
import { studioHeader } from './studio.js'

export async function viewSettings() {
  const wrap = el('section', 'page page--studio-profile')
  wrap.appendChild(studioHeader('Profil'))

  const logged = isLoggedIn()
  if (logged) {
    const who = getProfile()?.display_name || getUser()?.email || 'Mon compte'
    wrap.appendChild(el('p', 'settings-connected', 'Connecté : ' + who))
  }

  // --- Groupe 1 : mes publications ---
  // Vide pour un visiteur non connecté : on n'ajoute alors pas le groupe, sans
  // quoi un cadre bordé apparaîtrait sans rien dedans.
  const pub = el('div', 'settings-group')
  if (logged) {
    pub.appendChild(rowNav(icon('plus'), 'Publier un événement', '/publier'))
    pub.appendChild(rowNav(icon('ticket'), 'Mes événements', '/mes-evenements'))
    wrap.appendChild(pub)
  }

  // --- Groupe 2 : administration (admins uniquement) ---
  if (logged && isAdmin()) {
    const adm = el('div', 'settings-group')
    // Les deux compteurs en parallèle : inutile d'attendre l'un puis l'autre.
    const [pending, messages] = await Promise.all([
      listPendingCount().catch(() => 0),
      countFeedback().catch(() => 0),
    ])
    adm.appendChild(rowNav(icon('shield'), 'Modération' + (pending ? ` (${pending})` : ''), '/moderation'))
    adm.appendChild(
      rowNav(icon('message'), 'Messages reçus' + (messages ? ` (${messages})` : ''), '/messages')
    )
    adm.appendChild(rowNav(icon('chart'), 'Statistiques', '/statistiques'))
    adm.appendChild(rowNav(icon('user'), 'Gérer les administrateurs', '/admins'))
    adm.appendChild(rowNav(icon('user'), 'Membres', '/membres'))
    wrap.appendChild(adm)
  }

  // --- Groupe du bas : soutien, contact, compte ---
  // (La recherche de mise à jour est automatique à chaque lancement + bannière ;
  //  un simple rafraîchissement de la page suffit à récupérer la dernière version.)
  const bottom = el('div', 'settings-group')

  bottom.appendChild(rowNav(icon('plus'), 'Installer l’application', '/installer'))
  bottom.appendChild(rowNav(icon('heart'), 'Soutenir Armana', '/soutenir'))
  bottom.appendChild(rowNav(icon('message'), 'Nous contacter', '/contact'))

  // Ligne du compte…
  let account
  if (logged) {
    account = rowButton(icon('logOut'), 'Se déconnecter')
    account.classList.add('settings-row--danger')
    account.addEventListener('click', async () => {
      try {
        await signOut()
        navigate('/')
      } catch (e) {
        alert('Déconnexion impossible : ' + e.message)
      }
    })
  } else {
    account = rowButton(icon('logIn'), 'Se connecter / S’inscrire')
    account.addEventListener('click', () => navigate('/connexion'))
  }

  // …et, juste à côté, le bouton rond de partage. Armana ne sert à rien sans
  // utilisateurs : le partage doit être à portée de pouce, sans passer par un
  // sous-écran, et qu'on soit connecté ou non.
  const share = el('button', 'settings-share')
  share.type = 'button'
  share.title = 'Partager Armana'
  share.setAttribute('aria-label', 'Partager Armana')
  share.appendChild(icon('share'))

  const pair = el('div', 'settings-pair')
  pair.appendChild(account)
  pair.appendChild(share)
  bottom.appendChild(pair)
  wrap.appendChild(bottom)

  // Sans feuille de partage native (ordinateur, navigateur ancien), le lien est
  // copié : sans ce retour, le bouton semblerait ne rien faire.
  const shareMsg = el('p', 'form__hint settings-share__msg')
  wrap.appendChild(shareMsg)
  share.addEventListener('click', async () => {
    share.disabled = true
    const r = await shareApp()
    share.disabled = false
    if (r === 'copied') shareMsg.textContent = '✅ Lien copié : ' + APP_URL
    else if (r === 'failed') shareMsg.textContent = 'Copiez ce lien : ' + APP_URL
    else shareMsg.textContent = ''
    if (shareMsg.textContent) setTimeout(() => (shareMsg.textContent = ''), 4000)
  })

  // Numéro de version : indispensable pour savoir, en cas de souci signalé, si
  // la personne a bien reçu la dernière mise à jour.
  const build = currentBuild()
  wrap.appendChild(
    el(
      'p',
      'form__hint settings-version',
      'Version ' + (build === 'dev' ? 'de développement' : new Date(Number(build)).toLocaleString('fr-FR'))
    )
  )

  return wrap
}

// Ligne d'action avec chevron.
function rowButton(iconEl, label) {
  const r = el('button', 'settings-row')
  r.appendChild(labelBlock(iconEl, label))
  r.appendChild(icon('chevronRight'))
  return r
}

// Ligne de navigation (chevron) vers une route.
function rowNav(iconEl, label, path) {
  const r = rowButton(iconEl, label)
  r.addEventListener('click', () => navigate(path))
  return r
}

function labelBlock(iconEl, label) {
  const l = el('div', 'settings-row__label')
  l.appendChild(iconEl)
  l.appendChild(document.createTextNode(label))
  return l
}
