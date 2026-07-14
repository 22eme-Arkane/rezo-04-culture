// Rézo 04 Culture — point d'entrée : assemble le shell (nav + routeur) et l'auth.
import './style.css'
import { isConfigured } from './lib/supabaseClient.js'
import { initTheme } from './lib/theme.js'
import { initUpdateCheck, reloadForUpdate } from './lib/update.js'
import { initAuth, onAuthChange, getUser } from './lib/auth.js'
import { defineRoutes, startRouter, refresh } from './lib/router.js'
import { el } from './ui/components.js'
import { buildNav } from './ui/nav.js'
import { viewCalendar } from './ui/viewCalendar.js'
import { viewMap } from './ui/viewMap.js'
import { viewPublish } from './ui/viewPublish.js'
import { viewGems } from './ui/viewGems.js'
import { viewMine } from './ui/viewMine.js'
import { viewAdmin } from './ui/viewAdmin.js'
import { viewAuth } from './ui/viewAuth.js'
import { viewSettings } from './ui/viewSettings.js'
import { viewDetail } from './ui/viewDetail.js'
import { viewImport } from './ui/viewImport.js'
import { viewAdmins } from './ui/viewAdmins.js'
import { viewNewPassword } from './ui/viewNewPassword.js'
import { viewContact } from './ui/viewContact.js'
import { viewMembers } from './ui/viewMembers.js'
import { setSharedText, setSharedFile } from './lib/draft.js'

// --- Service worker (offline shell) ---
// UNIQUEMENT en production : en dev, un SW "cache-first" servirait des modules
// périmés → page blanche. En dev on retire tout SW existant + on purge les caches.
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[Rézo] SW :', e))
    })
  } else {
    navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()))
    if (self.caches) caches.keys().then((ks) => ks.forEach((k) => caches.delete(k)))
  }
}

// Thème (redondant avec le script inline de index.html, garantit la cohérence).
initTheme()

const app = document.querySelector('#app')
app.innerHTML = ''

// Avertissement si la configuration Supabase manque (app en lecture seule / erreurs).
if (!isConfigured) {
  const warn = el('div', 'config-warning')
  warn.textContent =
    "⚠ Configuration Supabase absente : copiez .env.example en .env et renseignez VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY."
  app.appendChild(warn)
}

const content = el('main', 'content')
const navHost = el('div', 'nav-host')

app.appendChild(content)
app.appendChild(navHost) // barre fixe en bas

function renderNav() {
  navHost.innerHTML = ''
  navHost.appendChild(buildNav())
}

// Bannière "nouvelle version disponible" (affichée si un nouveau déploiement existe).
function showUpdateBanner() {
  if (document.querySelector('.update-banner')) return
  const b = el('div', 'update-banner')
  b.appendChild(el('span', null, '✨ Une nouvelle version est disponible.'))
  const btn = el('button', 'btn btn--sm', 'Recharger')
  btn.addEventListener('click', reloadForUpdate)
  b.appendChild(btn)
  app.insertBefore(b, app.firstChild)
}

defineRoutes(
  {
    '/': viewCalendar,
    '/carte': viewMap,
    '/publier': viewPublish,
    '/favoris': viewGems,
    '/parametres': viewSettings,
    '/evenement': viewDetail,
    '/importer': viewImport,
    '/mes-evenements': viewMine,
    '/moderation': viewAdmin,
    '/admins': viewAdmins,
    '/nouveau-mdp': viewNewPassword,
    '/contact': viewContact,
    '/membres': viewMembers,
    '/connexion': viewAuth,
  },
  {
    notFound: () => {
      const box = el('div', 'empty-state')
      box.appendChild(el('p', null, 'Page introuvable.'))
      return box
    },
  }
)

// Bootstrap asynchrone (pas de top-level await → compatible large).
;(async () => {
  // Init auth d'abord (récupère session + profil), puis on monte le shell.
  await initAuth()

  // Liens Supabase reçus par e-mail : les jetons arrivent dans le hash
  // (#access_token=…). La session vient d'être établie par initAuth → on remplace
  // le hash par la bonne route (sinon le routeur afficherait « Page introuvable »).
  //  - type=recovery (mot de passe oublié) → écran « Nouveau mot de passe » ;
  //  - confirmation d'inscription / autres → agenda.
  if (/type=recovery/.test(location.hash)) {
    history.replaceState(null, '', location.pathname + '#/nouveau-mdp')
  } else if (/access_token=|refresh_token=|type=signup|error_description=/.test(location.hash)) {
    history.replaceState(null, '', location.pathname + '#/')
  }

  renderNav()

  // Sur login/logout UNIQUEMENT : reconstruire la nav + re-rendre la vue courante.
  // ⚠ Supabase émet aussi des événements au simple retour dans l'app (rafraîchissement
  // de jeton) : re-rendre à ce moment-là VIDAIT les formulaires en cours de saisie.
  // On ne re-rend que si l'utilisateur a réellement changé.
  let lastUid = getUser()?.id ?? null
  onAuthChange(() => {
    const uid = getUser()?.id ?? null
    if (uid === lastUid) return
    lastUid = uid
    renderNav()
    refresh()
  })
  // Sur changement de route : mettre l'onglet actif à jour.
  window.addEventListener('hashchange', renderNav)

  // Partage natif (share_target). Le SW a rangé texte + photo en cache puis redirigé
  // vers /?shared=1 → on les récupère et on aiguille vers l'écran d'import.
  const sp = new URLSearchParams(location.search)
  if (sp.get('shared')) {
    try {
      const cache = await caches.open('rezo-share-v1')
      const tRes = await cache.match('shared-text')
      const text = tRes ? await tRes.text() : ''
      const fRes = await cache.match('shared-file')
      if (fRes) {
        const blob = await fRes.blob()
        const name = decodeURIComponent(fRes.headers.get('X-Filename') || 'photo')
        setSharedFile(new File([blob], name || 'photo', { type: blob.type || 'image/jpeg' }))
      }
      await cache.delete('shared-text')
      await cache.delete('shared-file')
      if (text) setSharedText(text)
    } catch (e) {
      console.warn('[Rézo] Partage non lu :', e)
    }
    history.replaceState(null, '', location.pathname + '#/importer')
  } else {
    // Repli : partage GET (texte seul), au cas où.
    const legacy = [sp.get('title'), sp.get('text'), sp.get('url')].filter(Boolean).join('\n').trim()
    if (legacy) {
      setSharedText(legacy)
      history.replaceState(null, '', location.pathname + '#/importer')
    }
  }

  startRouter(content)

  // Recherche de mise à jour à CHAQUE lancement (silencieuse ; bannière si dispo).
  initUpdateCheck(showUpdateBanner)
})()
