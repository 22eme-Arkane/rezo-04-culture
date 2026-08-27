// Armana — écran Paramètres : lignes compactes, ordre :
// Publier → Mes événements → (administration) → Installer → Soutenir →
// Nous contacter → compte, et le bouton de partage à côté du compte.
import { el } from './components.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn, isAdmin, getProfile, getUser, signOut } from '../lib/auth.js'
import { amIOwner } from '../lib/admins.js'
import { listModeratorRequests, myPendingCount } from '../lib/moderation.js'
import { countFeedback } from '../lib/feedback.js'
import { currentBuild } from '../lib/update.js'
import { studioHeader, boutonPartage } from './studio.js'

export async function viewSettings() {
  // Armana ne sert à rien sans utilisateurs : le bouton de partage est logé
  // dans la barre de titre, à hauteur du regard, comme sur la maquette. Le
  // composant est partagé avec la Carte et les Favoris — une seule définition,
  // donc une seule apparence et un seul comportement.
  const wrap = el('section', 'page page--studio-profile')
  wrap.appendChild(studioHeader('Profil', { actions: [boutonPartage()] }))

  const logged = isLoggedIn()

  // --- Groupe 1 : créer et gérer ---
  // « Mes départements » est un filtre de lecture : il reste utile sans compte,
  // d'où un groupe visible même déconnecté (mais sans les lignes de publication,
  // qui n'auraient nulle part où mener).
  const pub = el('div', 'settings-group settings-group--jaune')
  if (logged) {
    pub.appendChild(rowNav(icon('plus'), 'Publier un événement', '/publier'))
    pub.appendChild(rowNav(icon('ticket'), 'Mes événements', '/mes-evenements'))
  }
  pub.appendChild(rowNav(icon('map'), 'Mes départements', '/mes-departements'))
  const terr = pub
  wrap.appendChild(pub)

  // --- Groupe 2 : modération et administration ---
  // Nouveau partage des rôles : le PROPRIÉTAIRE garde tout ; un MODÉRATEUR ne
  // voit que sa file de modération (cloisonnée à sa zone) et les statistiques.
  // La base impose ces limites de toute façon — l'écran ne fait que ne pas
  // afficher des portes qui seraient fermées.
  if (logged && isAdmin()) {
    const owner = await amIOwner()
    const adm = el('div', 'settings-group settings-group--bleu')
    // Tous les compteurs en parallèle : inutile d'attendre l'un puis l'autre.
    const [pending, messages, demandes] = await Promise.all([
      myPendingCount().catch(() => 0),
      owner ? countFeedback().catch(() => 0) : Promise.resolve(0),
      owner
        ? listModeratorRequests()
            .then((l) => l.filter((d) => d.status === 'pending').length)
            .catch(() => 0)
        : Promise.resolve(0),
    ])

    // Les candidatures vivent DANS « Gérer les modérateurs » (décision de
    // Matthieu) : c'est le même sujet, ça n'a pas à occuper deux lignes.
    if (owner) {
      adm.appendChild(
        rowNav(
          icon('shield'),
          'Gérer les modérateurs' + (demandes ? ` (${demandes})` : ''),
          '/admins'
        )
      )
      adm.appendChild(
        rowNav(icon('message'), 'Messages reçus' + (messages ? ` (${messages})` : ''), '/messages')
      )
    }
    adm.appendChild(rowNav(icon('check'), 'Modération' + (pending ? ` (${pending})` : ''), '/moderation'))
    if (owner) adm.appendChild(rowNav(icon('user'), 'Membres', '/membres'))
    adm.appendChild(rowNav(icon('chart'), 'Statistiques', '/statistiques'))
    wrap.appendChild(adm)
  }

  // Proposer son aide : pour les membres qui ne modèrent pas encore.
  if (logged && !isAdmin()) {
    terr.appendChild(rowNav(icon('shield'), 'Devenir modérateur', '/devenir-moderateur'))
  }

  // 3. Pratique : installer et régler, deux actions ponctuelles.
  const install = el('div', 'settings-group settings-group--vert')
  install.appendChild(rowNav(icon('download'), 'Installer l’application', '/installer'))
  install.appendChild(rowNav(icon('bell'), 'Notifications', '/notifications'))
  wrap.appendChild(install)

  // 4. Le don, en bannière pleine largeur : c'est ce qui fait vivre le projet,
  //    il ne doit pas se perdre au milieu d'une liste de réglages.
  const don = el('button', 'don-banner')
  don.type = 'button'
  don.appendChild(icon('heart'))
  don.appendChild(el('span', 'don-banner__texte', 'Faire un don'))
  // Le MÊME chevron que les autres lignes : une flèche différente ici donnait
  // l'impression d'un bouton d'une autre nature.
  const rond = el('span', 'don-banner__fleche')
  rond.appendChild(icon('chevronRight'))
  don.appendChild(rond)
  don.addEventListener('click', () => navigate('/soutenir'))
  wrap.appendChild(don)

  // 5. Assistance.
  const help = el('div', 'settings-group settings-group--vert')
  help.appendChild(rowNav(icon('message'), 'Nous contacter', '/contact'))
  wrap.appendChild(help)

  // 6. Le compte, seul : une déconnexion ne se clique pas par erreur en visant
  //    la ligne du dessus.
  const compte = el('div', 'settings-group settings-group--nu')
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

  // Pied de page : qui est connecté, et le numéro de version — indispensable
  // pour savoir, en cas de souci signalé, si la personne a bien reçu la
  // dernière mise à jour.
  const pied = el('div', 'settings-pied')
  if (logged) {
    const who = getProfile()?.display_name || getUser()?.email || 'Mon compte'
    pied.appendChild(el('p', 'settings-connected', 'Connecté : ' + who))
  }
  const build = currentBuild()
  pied.appendChild(
    el(
      'p',
      'form__hint settings-version',
      'Version ' + (build === 'dev' ? 'de développement' : new Date(Number(build)).toLocaleString('fr-FR'))
    )
  )
  wrap.appendChild(pied)

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
