// Armana — écran Paramètres : lignes compactes, ordre :
// Ville par défaut → Publier → Mes événements → (Modération) → Thème,
// et « Se déconnecter » tout en bas.
import { el } from './components.js'
import { icon } from './icons.js'
import { navigate, refresh } from '../lib/router.js'
import { isLoggedIn, isAdmin, getProfile, getUser, signOut } from '../lib/auth.js'
import { getDefaultCity, setDefaultCity, resolveDefaultCity } from '../lib/geo.js'
import { listPendingCount } from '../lib/events.js'
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
    adm.appendChild(rowNav(icon('chart'), 'Statistiques', '/statistiques'))
    adm.appendChild(rowNav(icon('user'), 'Gérer les administrateurs', '/admins'))
    adm.appendChild(rowNav(icon('user'), 'Membres', '/membres'))
    wrap.appendChild(adm)
  }

  // --- Groupe 3 : préférences ---
  const prefs = el('div', 'settings-group')
  const cityRow = rowValue(icon('pin'), 'Ville par défaut', getDefaultCity() || 'Non définie')
  const cityValue = cityRow.querySelector('.settings-row__value')
  cityRow.addEventListener('click', async () => {
    const v = prompt('Votre ville (la carte s’ouvrira dessus) :', getDefaultCity() || '')
    if (v === null) return
    const city = v.trim()
    if (!city) {
      setDefaultCity('')
      refresh()
      return
    }
    // On géocode TOUT DE SUITE et on mémorise le point : la carte s'ouvrira sur
    // cette ville même hors ligne, sans rappeler Nominatim à chaque fois.
    setDefaultCity(city)
    cityValue.textContent = 'Localisation…'
    const pos = await resolveDefaultCity()
    if (!pos) {
      cityValue.textContent = city
      alert(
        'Ville enregistrée, mais introuvable sur la carte pour l’instant.\n' +
          'Vérifiez l’orthographe : la carte se centrera dessus dès qu’elle sera reconnue.'
      )
      return
    }
    refresh()
  })
  prefs.appendChild(cityRow)
  wrap.appendChild(prefs)

  // --- Groupe 4 (tout en bas) : contact, compte ---
  // (La recherche de mise à jour est automatique à chaque lancement + bannière ;
  //  un simple rafraîchissement de la page suffit à récupérer la dernière version.)
  const bottom = el('div', 'settings-group')

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
