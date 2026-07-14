// Rézo 04 Culture — écran Paramètres : lignes compactes, ordre :
// Ville par défaut → Publier → Mes événements → (Modération) → Thème,
// et « Se déconnecter » tout en bas.
import { el } from './components.js'
import { icon } from './icons.js'
import { openThemePicker } from './themePicker.js'
import { navigate, refresh } from '../lib/router.js'
import { isLoggedIn, isAdmin, getProfile, getUser, signOut } from '../lib/auth.js'
import { getDefaultCity, setDefaultCity } from '../lib/geo.js'
import { listPendingCount } from '../lib/events.js'
import { checkForUpdate, reloadForUpdate } from '../lib/update.js'

export async function viewSettings() {
  const wrap = el('section', 'page')
  wrap.appendChild(el('h1', 'page__title', 'Paramètres'))

  const logged = isLoggedIn()
  if (logged) {
    const who = getProfile()?.display_name || getUser()?.email || 'Mon compte'
    wrap.appendChild(el('p', 'settings-connected', 'Connecté : ' + who))
  }

  // --- Groupe 1 : mes publications ---
  if (logged) {
    const pub = el('div', 'settings-group')
    pub.appendChild(rowNav(icon('plus'), 'Publier un événement', '/publier'))
    pub.appendChild(rowNav(icon('ticket'), 'Mes événements', '/mes-evenements'))
    wrap.appendChild(pub)
  }

  // --- Groupe 2 : administration (admins uniquement) ---
  if (logged && isAdmin()) {
    const adm = el('div', 'settings-group')
    let pending = 0
    try {
      pending = await listPendingCount()
    } catch {
      /* ignore */
    }
    adm.appendChild(rowNav(icon('shield'), 'Modération' + (pending ? ` (${pending})` : ''), '/moderation'))
    adm.appendChild(rowNav(icon('user'), 'Gérer les administrateurs', '/admins'))
    wrap.appendChild(adm)
  }

  // --- Groupe 3 : préférences ---
  const prefs = el('div', 'settings-group')
  const cityRow = rowValue(icon('pin'), 'Ville par défaut', getDefaultCity() || 'Non définie')
  cityRow.addEventListener('click', () => {
    const v = prompt('Votre ville (pour centrer la carte) :', getDefaultCity() || '')
    if (v === null) return
    setDefaultCity(v.trim())
    refresh()
  })
  prefs.appendChild(cityRow)
  const themeRow = rowButton(paletteIcon(), 'Thème de l’application')
  themeRow.addEventListener('click', openThemePicker)
  prefs.appendChild(themeRow)
  wrap.appendChild(prefs)

  // --- Groupe 4 (tout en bas) : mise à jour, contact, compte ---
  const bottom = el('div', 'settings-group')

  const updRow = rowButton(icon('refresh'), 'Rechercher une mise à jour')
  const updValue = el('span', 'settings-row__value', '')
  updRow.insertBefore(updValue, updRow.lastChild) // avant le chevron
  updRow.addEventListener('click', async () => {
    updValue.textContent = 'Vérification…'
    const r = await checkForUpdate()
    if (r.updateAvailable) {
      updValue.textContent = 'Disponible'
      if (confirm('Une nouvelle version est disponible. Recharger maintenant ?')) reloadForUpdate()
    } else if (r.ok) {
      updValue.textContent = 'À jour'
    } else {
      updValue.textContent = 'Indisponible'
    }
  })
  bottom.appendChild(updRow)

  bottom.appendChild(rowNav(icon('message'), 'Nous contacter', '/contact'))

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
    bottom.appendChild(out)
  } else {
    const login = rowButton(icon('logIn'), 'Se connecter / S’inscrire')
    login.addEventListener('click', () => navigate('/connexion'))
    bottom.appendChild(login)
  }
  wrap.appendChild(bottom)

  return wrap
}

// Ligne avec valeur à droite (cliquable).
function rowValue(iconEl, label, value) {
  const r = el('button', 'settings-row')
  r.appendChild(labelBlock(iconEl, label))
  r.appendChild(el('span', 'settings-row__value', value))
  return r
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

// Palette (emoji) pour la ligne thème, taille alignée sur les icônes.
function paletteIcon() {
  const s = el('span')
  s.textContent = '🎨'
  s.style.fontSize = '17px'
  s.style.width = '18px'
  s.style.display = 'inline-flex'
  return s
}
