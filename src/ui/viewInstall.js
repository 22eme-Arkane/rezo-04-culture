// Armana — écran « Installer l'application ».
//
// Raison d'être : Armana est une PWA, elle s'installe depuis le navigateur et
// non depuis un magasin d'applications. C'est déroutant, et deux pièges
// reviennent sans arrêt auprès des utilisateurs :
//   1. sur iPhone, SEUL Safari sait installer (Chrome iOS n'a pas le bouton) ;
//   2. sur Android, installer depuis un navigateur autre que Chrome fait
//      fabriquer le paquet par le téléphone lui-même, avec une cible Android
//      très ancienne → Play Protect affiche « Appli non sécurisée bloquée ».
// Cet écran explique les deux, et permet de copier / partager le lien pour le
// rouvrir dans le bon navigateur.
import { el } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { APP_URL, copyText, shareApp } from '../lib/share.js'

// --- Détection de l'appareil ------------------------------------------------
// Volontairement tolérante : en cas de doute on affiche tout, les instructions
// des autres plateformes restent lisibles juste en dessous.
function detecter() {
  const ua = navigator.userAgent || ''
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ se fait passer pour un Mac ; le tactile le trahit.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const android = /Android/.test(ua)
  // Navigateurs intégrés à une application : ceux-ci utilisent leur propre moteur
  // et n'offrent aucune installation. (WhatsApp est absent de la liste : sur
  // Android il ouvre les liens dans Chrome, l'installation y fonctionne.)
  const integre = /FBAN|FBAV|FB_IAB|Instagram|Messenger|Line\/|TikTok|Snapchat|MicroMessenger/i.test(ua)
  const installee =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.navigator.standalone === true
  return { ios, android, integre, installee }
}

export function viewInstall() {
  const { ios, android, integre, installee } = detecter()

  const wrap = el('section', 'page page--studio-sub')
  wrap.appendChild(studioHeader('Installer', { backTo: '/parametres' }))

  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      'Armana s’installe directement depuis votre navigateur : pas de magasin ' +
        'd’applications, pas de compte à créer, et aucun espace pris sur le téléphone.'
    )
  )

  if (installee) {
    wrap.appendChild(
      note('ok', '✅ C’est déjà fait !', [
        'Armana est bien installée sur cet appareil. Les instructions ci-dessous ' +
          'vous serviront pour aider quelqu’un d’autre à l’installer.',
      ])
    )
  }

  if (integre) {
    wrap.appendChild(
      note('warn', '⚠ Ouvrez d’abord cette page dans votre navigateur', [
        'Vous consultez Armana depuis le navigateur intégré à une autre ' +
          'application (Facebook, Messenger, Instagram…). Celui-ci ne permet pas ' +
          'l’installation.',
        'Copiez le lien avec le bouton ci-dessous, puis collez-le dans Chrome ' +
          '(Android) ou Safari (iPhone).',
      ])
    )
  }

  wrap.appendChild(boutonsLien())

  // --- Instructions, l'appareil détecté en premier -------------------------
  const blocs = []
  blocs.push({ cle: 'android', actif: android && !ios, noeud: () => blocAndroid() })
  blocs.push({ cle: 'ios', actif: ios, noeud: () => blocIos() })
  blocs.push({ cle: 'bureau', actif: !ios && !android, noeud: () => blocBureau() })
  blocs.sort((a, b) => Number(b.actif) - Number(a.actif))
  for (const b of blocs) {
    const n = b.noeud()
    if (b.actif) {
      n.classList.add('install-block--current')
      n.insertBefore(el('span', 'install-block__badge', 'Votre appareil'), n.firstChild)
    }
    wrap.appendChild(n)
  }

  // --- Le message Play Protect ---------------------------------------------
  const play = el('div', 'install-block')
  play.appendChild(el('h2', 'install-block__title', '🛡️ « Appli non sécurisée bloquée » ?'))
  play.appendChild(
    el(
      'p',
      'support-text',
      'Ce message de Google Play Protect apparaît quand on installe depuis un ' +
        'navigateur Android autre que Chrome. Ce n’est pas une alerte de virus : ' +
        'Android signale que l’emballage fabriqué par ce navigateur vise une ' +
        'version ancienne du système.'
    )
  )
  play.appendChild(
    el(
      'p',
      'support-text support-text--muted',
      'La solution : refermer ce message et refaire l’installation depuis Chrome. ' +
        'L’emballage est alors préparé par Google, à jour, et aucun avertissement ' +
        'n’apparaît.'
    )
  )
  wrap.appendChild(play)

  // --- Repli : ne rien installer du tout -----------------------------------
  wrap.appendChild(
    note('info', '💡 Et si je ne veux rien installer ?', [
      'Aucun problème : Armana fonctionne exactement pareil dans un simple ' +
        'navigateur. Mettez armana.app en favori et c’est réglé. ' +
        'L’installation n’apporte que le raccourci sur l’écran d’accueil et ' +
        'l’affichage sans barre d’adresse.',
    ])
  )

  return wrap
}

// --- Blocs d'instructions ---------------------------------------------------

function blocAndroid() {
  return blocEtapes('🤖 Android', [
    ['Ouvrez cette page dans ', 'Chrome', ' — c’est le seul navigateur Android qui installe Armana proprement.'],
    ['Touchez le menu ', '⋮', ' en haut à droite.'],
    ['Choisissez ', 'Installer l’application', ' (ou « Ajouter à l’écran d’accueil »).'],
    ['Confirmez : l’icône Armana apparaît avec vos autres applications.'],
  ])
}

function blocIos() {
  return blocEtapes('🍎 iPhone et iPad', [
    ['Ouvrez cette page dans ', 'Safari', ' — sur iPhone, Chrome ne propose pas l’installation.'],
    ['Touchez le bouton ', 'Partager', ' en bas de l’écran (le carré avec une flèche vers le haut).'],
    ['Faites défiler la liste et choisissez ', 'Sur l’écran d’accueil', '.'],
    ['Touchez ', 'Ajouter', ' en haut à droite.'],
  ])
}

function blocBureau() {
  return blocEtapes('💻 Ordinateur', [
    ['Ouvrez cette page dans ', 'Chrome', ' ou ', 'Edge', '.'],
    ['Cliquez sur l’icône d’installation à droite de la barre d’adresse, ou allez dans le menu → ', 'Installer Armana', '.'],
    ['Armana s’ouvre alors dans sa propre fenêtre, comme un logiciel ordinaire.'],
  ])
}

// `etapes` : tableau de segments ; les segments d'indice impair sont mis en gras.
function blocEtapes(titre, etapes) {
  const bloc = el('div', 'install-block')
  bloc.appendChild(el('h2', 'install-block__title', titre))
  const ol = el('ol', 'install-steps')
  for (const segments of etapes) {
    const li = el('li', 'install-step')
    segments.forEach((s, i) => {
      if (i % 2 === 1) li.appendChild(el('strong', null, s))
      else li.appendChild(document.createTextNode(s))
    })
    ol.appendChild(li)
  }
  bloc.appendChild(ol)
  return bloc
}

// --- Encadré ----------------------------------------------------------------

function note(ton, titre, paragraphes) {
  const box = el('div', `install-note install-note--${ton}`)
  box.appendChild(el('p', 'install-note__title', titre))
  for (const p of paragraphes) box.appendChild(el('p', 'install-note__text', p))
  return box
}

// --- Copier / partager le lien ---------------------------------------------

function boutonsLien() {
  const row = el('div', 'install-actions')

  const copier = el('button', 'btn btn--primary install-action')
  copier.type = 'button'
  copier.appendChild(icon('check'))
  copier.appendChild(document.createTextNode(' Copier le lien'))
  copier.addEventListener('click', async () => {
    const ok = await copyText(APP_URL)
    copier.lastChild.textContent = ok ? ' Lien copié !' : ' ' + APP_URL
    // On laisse le retour visible un moment, puis on rend le bouton réutilisable.
    setTimeout(() => {
      copier.lastChild.textContent = ' Copier le lien'
    }, 2500)
  })
  row.appendChild(copier)

  // Partage natif : le moyen le plus direct de faire connaître Armana.
  if (navigator.share) {
    const partager = el('button', 'btn btn--ghost install-action')
    partager.type = 'button'
    partager.appendChild(icon('share'))
    partager.appendChild(document.createTextNode(' Partager Armana'))
    partager.addEventListener('click', () => shareApp())
    row.appendChild(partager)
  }

  return row
}
