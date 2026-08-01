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

  // --- Bandeau du haut : qui est connecté, et le partage bien en vue ---
  // Armana ne sert à rien sans utilisateurs : le bouton de partage est placé
  // tout en haut, à hauteur du regard, plutôt qu'en bas de l'écran.
  const share = el('button', 'settings-share')
  share.type = 'button'
  share.title = 'Partager Armana'
  share.setAttribute('aria-label', 'Partager Armana')
  share.appendChild(icon('share'))

  const topbar = el('div', 'settings-topbar')
  if (logged) {
    const who = getProfile()?.display_name || getUser()?.email || 'Mon compte'
    topbar.appendChild(el('p', 'settings-connected', 'Connecté : ' + who))
  }
  topbar.appendChild(share) // toujours calé à droite (margin-left: auto)
  wrap.appendChild(topbar)

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

  // --- Trois groupes distincts en bas, volontairement séparés ---
  // (La recherche de mise à jour est automatique à chaque lancement + bannière ;
  //  un simple rafraîchissement de la page suffit à récupérer la dernière version.)

  // 3. Installer : action ponctuelle, isolée pour ne pas se noyer dans la liste.
  const install = el('div', 'settings-group')
  install.appendChild(rowNav(icon('plus'), 'Installer l’application', '/installer'))
  wrap.appendChild(install)

  // 4. Soutenir et écrire : les deux façons d'aider le projet.
  const help = el('div', 'settings-group')
  help.appendChild(rowNav(icon('heart'), 'Soutenir Armana', '/soutenir'))
  help.appendChild(rowNav(icon('message'), 'Nous contacter', '/contact'))
  wrap.appendChild(help)

  // 5. Le compte, seul : une déconnexion ne se clique pas par erreur en visant
  //    la ligne du dessus.
  const compte = el('div', 'settings-group')
  if (logged) {
    const out = rowButton(icon('logOut'), 'Se déconnecter')
    out.classList.add('settings-row--danger')
    out.addEventListener('click', async () => {
      try {
        await signOut()
        navigate('/')
      } catch (e) {
        alert('Déconnexion impossible : ' + e.message)
      }
    })
    compte.appendChild(out)
  } else {
    const login = rowButton(icon('logIn'), 'Se connecter / S’inscrire')
    login.addEventListener('click', () => navigate('/connexion'))
    compte.appendChild(login)
  }
  wrap.appendChild(compte)

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
