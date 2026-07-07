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

  // --- Groupe principal ---
  const group = el('div', 'settings-group')

  // 1. Ville par défaut (éditable).
  const cityRow = rowValue(icon('pin'), 'Ville par défaut', getDefaultCity() || 'Non définie')
  cityRow.addEventListener('click', () => {
    const v = prompt('Votre ville (pour centrer la carte) :', getDefaultCity() || '')
    if (v === null) return
    setDefaultCity(v.trim())
    refresh()
  })
  group.appendChild(cityRow)

  if (logged) {
    // 2. Publier un événement.
    const publish = rowNav(icon('plus'), 'Publier un événement', '/publier')
    group.appendChild(publish)

    // 3. Mes événements.
    const mine = rowNav(icon('ticket'), 'Mes événements', '/mes-evenements')
    group.appendChild(mine)

    // Modération (admin uniquement).
    if (isAdmin()) {
      let pending = 0
      try {
        pending = await listPendingCount()
      } catch {
        /* ignore */
      }
      const mod = rowNav(icon('shield'), 'Modération' + (pending ? ` (${pending})` : ''), '/moderation')
      group.appendChild(mod)

      const admins = rowNav(icon('user'), 'Gérer les administrateurs', '/admins')
      group.appendChild(admins)
    }
  }

  // 4. Thème de l'application.
  const themeRow = rowButton(paletteIcon(), 'Thème de l’application')
  themeRow.addEventListener('click', openThemePicker)
  group.appendChild(themeRow)

  // 5. Rechercher une mise à jour.
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
  group.appendChild(updRow)

  wrap.appendChild(group)

  // --- Tout en bas : compte ---
  const bottom = el('div', 'settings-group')
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
