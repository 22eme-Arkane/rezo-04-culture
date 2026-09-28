// Armana — le champ « contact » d'un événement, transformé en boutons.
//
// Le champ est LIBRE : un lien, une adresse e-mail, un numéro, ou un mélange
// (« Association Lei Rampelaires 07 69 58 71 18 »). On en extrait ce qui peut
// devenir un bouton — site, appel, e-mail — et on garde le reste en texte.
//
// ⚠ CONTENU SAISI PAR UN UTILISATEUR. Aucun lien n'est construit autrement
// qu'à partir de ces trois motifs, et un lien web doit encore être http ou
// https une fois analysé par `URL`. Un « javascript: » ne correspond à aucun
// motif : il reste du texte, affiché tel quel.
//
// ⚠ Les adresses SANS « http » ni « www » comptent aussi : « arty-madeinforcalquier.com »
// restait en texte brut, non cliquable, dans l'ancienne fiche.

const MAIL = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[a-z]{2,}/gi
const WEB =
  /\b(?:https?:\/\/|www\.)[^\s<>"']+|\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:fr|com|org|net|eu|info|app|art|be|ch|io|coop|bzh|asso|live|events?)\b(?:\/[^\s<>"']*)?/gi
const TEL = /(?:\+33\s?|\b0)[1-9](?:[\s.-]?\d{2}){4}\b/g
const PONCTUATION_FINALE = /[.,;:!?)\]]+$/

// Les plateformes connues ont un nom plus parlant que « Site web ».
const NOMS = [
  [/(^|\.)(facebook\.com|fb\.me|fb\.com)$/, 'Facebook'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [
    /(^|\.)(helloasso\.com|billetweb\.fr|weezevent\.com|eventbrite\.(fr|com)|shotgun\.live|yurplan\.com|festik\.net)$/,
    'Billetterie',
  ],
]

function nomDuSite(hote) {
  for (const [motif, nom] of NOMS) if (motif.test(hote)) return nom
  return 'Site web'
}

function web(brut) {
  const propre = brut.replace(PONCTUATION_FINALE, '')
  let u
  try {
    u = new URL(/^https?:\/\//i.test(propre) ? propre : 'https://' + propre)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  const hote = u.hostname.replace(/^www\./, '')
  return { type: 'web', href: u.href, label: nomDuSite(hote), detail: hote }
}

function tel(brut) {
  const chiffres = brut.replace(/\D/g, '')
  const national = chiffres.startsWith('33') ? '0' + chiffres.slice(2) : chiffres
  return {
    type: 'tel',
    href: 'tel:+33' + national.slice(1),
    label: 'Appeler',
    detail: national.replace(/(\d{2})(?=\d)/g, '$1 '),
  }
}

function mail(brut) {
  return { type: 'mail', href: 'mailto:' + brut, label: 'Écrire', detail: brut }
}

/**
 * @param {string|null|undefined} brut  le champ tel que saisi
 * @returns {{ actions: {type:'web'|'tel'|'mail', href:string, label:string, detail:string}[], reste: string }}
 *   `reste` : ce qui n'est ni un lien, ni un numéro, ni un e-mail — souvent le
 *   nom de l'organisateur. Vide s'il ne reste rien.
 */
export function lireContact(brut) {
  let reste = String(brut ?? '').trim()
  const actions = []
  if (!reste) return { actions, reste: '' }

  // Les e-mails d'abord : leur nom de domaine passerait sinon pour un site.
  reste = reste.replace(MAIL, (m) => {
    actions.push(mail(m))
    return ' '
  })
  reste = reste.replace(WEB, (m) => {
    const a = web(m)
    if (!a) return m
    actions.push(a)
    return ' '
  })
  reste = reste.replace(TEL, (m) => {
    actions.push(tel(m))
    return ' '
  })

  reste = reste
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:/–—-]+|[\s,;:/–—-]+$/g, '')
    .trim()
  // Les petits mots qui ne liaient que ce qu'on a retiré : « Réservation au
  // 04… ou billetweb.fr » laissait « Réservation au ou ».
  const LIANT = /\s+(?:au|ou|et|sur|par|via|tel\.?|tél\.?|téléphone|mail|e-mail|site)$/i
  while (LIANT.test(reste)) reste = reste.replace(LIANT, '').replace(/[\s,;:/–—-]+$/, '')
  // Des doublons arrivent (« site.fr https://site.fr ») : un bouton par adresse.
  const vus = new Set()
  return {
    actions: actions.filter((a) => (vus.has(a.href) ? false : vus.add(a.href))),
    reste,
  }
}
