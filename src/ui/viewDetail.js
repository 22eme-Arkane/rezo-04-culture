// Armana — écran détail d'un événement (photo pleine résolution + infos).
import { el, formatDateFull, formatTime, formatPrice, tarifMode, emptyState } from './components.js'
import { icon, marqueurArmana } from './icons.js'
import { studioHeader } from './studio.js'
import { isAdmin, isLoggedIn, getUser } from '../lib/auth.js'
import { amIOwner } from '../lib/admins.js'
import { canModerateEvent, myModDepts } from '../lib/moderation.js'
import { dayKey, describeRecurrence, isRecurring, nextOccurrence } from '../lib/recurrence.js'
import { navigate } from '../lib/router.js'
import { sendFeedback } from '../lib/feedback.js'
import { shareEvent } from '../lib/share.js'
import { villeDeLAdresse } from '../lib/adresse.js'
import {
  getEventById,
  listGemEventIds,
  addGem,
  removeGem,
  deleteEvent,
} from '../lib/events.js'

export async function viewDetail({ query } = {}) {
  const id = query?.get('id')
  const wrap = el('section', 'page page--studio-sub page--studio-detail')
  wrap.appendChild(
    studioHeader('Événement', { backLabel: 'Retour', onBack: () => history.back() })
  )

  if (!id) {
    wrap.appendChild(emptyState('Événement introuvable.'))
    return wrap
  }

  const ev = await getEventById(id)
  if (!ev) {
    wrap.appendChild(emptyState('Cet événement n’existe plus.'))
    return wrap
  }

  // Photo pleine résolution (chargée seulement ici, jamais dans les listes).
  // Tap sur la photo → aperçu plein écran.
  const hero = el('div', 'detail__hero')
  if (ev.photo_url) {
    const img = el('img')
    img.src = ev.photo_url
    img.alt = ev.title
    hero.appendChild(img)
    hero.classList.add('detail__hero--zoomable')
    hero.addEventListener('click', () => openLightbox(ev.photo_url, ev.title))
  }
  const card = el('article', 'detail-card')
  card.appendChild(hero)
  const body = el('div', 'detail-card__body')

  body.appendChild(el('h2', 'detail__title', ev.title))

  const badges = el('div', 'detail__badges')
  if (ev.category) badges.appendChild(el('span', 'ecard__badge ecard__badge--cat', ev.category))
  badges.appendChild(
    el(
      'span',
      tarifMode(ev) === 'gratuit'
        ? 'ecard__badge ecard__badge--free'
        : 'ecard__badge ecard__badge--paid',
      formatPrice(ev)
    )
  )
  body.appendChild(badges)

  const facts = el('div', 'detail__facts')

  const when = el('p', 'detail__meta')
  when.appendChild(icon('calendar'))
  const fin = ev.ends_at ? new Date(ev.ends_at) : null
  const memeJour = fin && dayKey(fin) === dayKey(ev.starts_at)
  let dateTxt
  if (isRecurring(ev)) {
    dateTxt = `${describeRecurrence(ev)} · ${formatTime(ev.starts_at)}`
  } else if (fin && !memeJour) {
    // ⚠ Multi-jours : afficher les DEUX dates. L'ancien format ne montrait que
    // le premier jour et l'heure de fin du dernier — on croyait que tout se
    // terminait le soir même.
    dateTxt = `Du ${formatDateFull(ev.starts_at)} au ${formatDateFull(ev.ends_at)} · ${formatTime(ev.starts_at)}`
  } else if (fin) {
    dateTxt = `${formatDateFull(ev.starts_at)} · ${formatTime(ev.starts_at)} → ${formatTime(ev.ends_at)}`
  } else {
    dateTxt = `${formatDateFull(ev.starts_at)} · ${formatTime(ev.starts_at)}`
  }
  when.appendChild(document.createTextNode(' ' + dateTxt))
  facts.appendChild(when)

  if (isRecurring(ev)) {
    const prochaine = el('p', 'detail__meta')
    prochaine.appendChild(icon('clock'))
    prochaine.appendChild(
      document.createTextNode(' Prochaine fois : ' + formatDateFull(nextOccurrence(ev).toISOString()))
    )
    facts.appendChild(prochaine)
  }

  // ⚠ L'adresse ne figure PLUS dans cette liste : elle a son propre bloc, mis
  // en avant juste avant « À propos » (voir plus bas). Noyée parmi la date,
  // le contact et l'auteur, c'était pourtant l'information qui décide si l'on
  // y va — et celle qu'on cherche au moment de partir.

  if (ev.contact) {
    const brut = String(ev.contact).trim()
    const ligne = el('p', 'detail__meta')
    ligne.appendChild(icon('message'))
    ligne.appendChild(document.createTextNode(' '))
    // ⚠ Contenu saisi par un utilisateur : on ne construit un lien que sur des
    // schémas explicitement autorisés. Un « javascript: » ne correspond à aucun
    // de ces motifs et reste donc affiché en texte brut.
    const estMail = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(brut)
    const estLien = /^(https?:\/\/|www\.)\S+$/i.test(brut)
    if (estMail || estLien) {
      const a = el('a', 'detail__contact')
      a.href = estMail ? 'mailto:' + brut : /^www\./i.test(brut) ? 'https://' + brut : brut
      a.textContent = brut
      if (!estMail) {
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
      }
      ligne.appendChild(a)
    } else {
      ligne.appendChild(document.createTextNode(brut))
    }
    facts.appendChild(ligne)
  }

  const author = el('p', 'detail__meta')
  author.appendChild(icon('user'))
  author.appendChild(document.createTextNode(' Publié par ' + (ev.author_name || 'Anonyme')))
  facts.appendChild(author)
  body.appendChild(facts)

  // Favori (connecté).
  if (isLoggedIn()) {
    const gemIds = await listGemEventIds()
    let on = gemIds.has(ev.id)
    const favBtn = el('button', 'btn btn--block')
    const paint = () => {
      favBtn.className = on ? 'btn btn--primary btn--block' : 'btn btn--block'
      favBtn.textContent = ''
      const h = icon('heart')
      h.setAttribute('fill', on ? 'currentColor' : 'none')
      favBtn.appendChild(h)
      favBtn.appendChild(document.createTextNode(on ? ' Retirer des favoris' : ' Ajouter aux favoris'))
    }
    paint()
    favBtn.addEventListener('click', async () => {
      favBtn.disabled = true
      try {
        if (on) await removeGem(ev.id)
        else await addGem(ev.id)
        on = !on
        paint()
      } catch (e) {
        alert('Action impossible : ' + e.message)
      } finally {
        favBtn.disabled = false
      }
    })
    body.appendChild(favBtn)
  }

  // --- Partager l'événement (demande d'une utilisatrice) ------------------
  // Visible SANS compte : partager ne demande rien, et c'est souvent ainsi
  // qu'un événement trouve son public.
  // ⚠ SEULEMENT POUR UN ÉVÉNEMENT PUBLIÉ. Un événement en attente ou rejeté
  // n'est lisible que par son auteur et les modérateurs : partagé, son lien
  // mènerait les destinataires vers « Cet événement n'existe plus ».
  if (ev.status === 'approved') body.appendChild(boutonPartagerEvenement(ev))

  // --- L'ADRESSE, mise en avant -------------------------------------------
  if (ev.address) {
    const lieu = el('section', 'detail-lieu')
    const tete = el('p', 'detail-lieu__adresse')
    // Le marqueur d'Armana, celui-là même qui pique l'événement sur la carte :
    // on reconnaît le repère avant d'avoir lu l'adresse.
    tete.appendChild(marqueurArmana({ size: 20 }))
    tete.appendChild(document.createTextNode(' ' + ev.address))
    lieu.appendChild(tete)

    const aller = el('a', 'btn btn--primary btn--block detail-lieu__aller')
    // ⚠ Les COORDONNÉES d'abord, l'adresse écrite seulement à défaut. C'est
    // l'événement lui-même qui porte le point choisi sur la carte à la
    // publication ; rechercher le texte exposerait aux homonymes, comme cette
    // fois où « Chahut-Chahut » s'est retrouvé dans l'Orne.
    const q =
      Number.isFinite(Number(ev.lat)) && Number.isFinite(Number(ev.lng))
        ? `${ev.lat},${ev.lng}`
        : ev.address
    aller.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q)
    aller.target = '_blank'
    aller.rel = 'noopener noreferrer'
    aller.appendChild(icon('map'))
    aller.appendChild(document.createTextNode(' Ouvrir dans Maps'))
    lieu.appendChild(aller)
    body.appendChild(lieu)
  }

  if (ev.description) {
    const desc = el('div', 'detail__description')
    desc.appendChild(el('h3', 'detail__section-title', 'À propos'))
    desc.appendChild(el('p', 'detail__desc', ev.description))
    body.appendChild(desc)
  }

  card.appendChild(body)
  wrap.appendChild(card)

  // --- Actions en bas de page ---------------------------------------------
  // L'auteur et les administrateurs gèrent l'événement ; les autres personnes
  // connectées peuvent le signaler. Les droits sont AUSSI imposés côté base
  // (RLS) : ce qui suit ne fait que masquer ce qui serait de toute façon refusé.
  // La zone du modérateur borne ses boutons : un modérateur du 04 ne doit pas
  // voir « Supprimer » sur un événement du 84 — la base le refuserait, mais un
  // bouton qui échoue toujours est pire qu'un bouton absent.
  let ctxModeration = null
  if (isAdmin()) {
    const [owner, depts] = await Promise.all([
      amIOwner().catch(() => false),
      myModDepts().catch(() => null),
    ])
    ctxModeration = { owner, depts }
  }
  wrap.appendChild(buildActions(ev, ctxModeration))

  return wrap
}

const JOUR_LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

/**
 * Quand, en une ligne lisible dans un message : « jeudi 24 septembre à 18:30 »,
 * « du 31 août au 17 septembre », « prochaine séance jeudi 9 octobre à 15:30 ».
 */
function quandPourPartage(ev) {
  if (isRecurring(ev)) {
    const d = nextOccurrence(ev)
    return `prochaine séance ${JOUR_LONG.format(d)} à ${formatTime(d.toISOString())}`
  }
  const fin = ev.ends_at ? new Date(ev.ends_at) : null
  if (fin && dayKey(fin) !== dayKey(ev.starts_at)) {
    return `du ${JOUR_LONG.format(new Date(ev.starts_at))} au ${JOUR_LONG.format(fin)}`
  }
  return `${JOUR_LONG.format(new Date(ev.starts_at))} à ${formatTime(ev.starts_at)}`
}

/** Le bouton « Partager l'événement », et son retour visible. */
function boutonPartagerEvenement(ev) {
  const b = el('button', 'btn btn--block detail__partager')
  b.type = 'button'
  const peindre = (texte) => {
    b.textContent = ''
    b.appendChild(icon('share'))
    b.appendChild(document.createTextNode(' ' + texte))
  }
  peindre('Partager l’événement')

  b.addEventListener('click', async () => {
    const ville = ev.address ? villeDeLAdresse(ev.address) : ''
    // ⚠ Le texte dit TOUT l'essentiel : l'aperçu du lien, lui, ne montrera que
    // la page d'accueil d'Armana (voir shareEvent, dans lib/share.js).
    const texte = [ev.title, quandPourPartage(ev) + (ville ? `, ${ville}` : ''), 'Sur Armana :']
      .filter(Boolean)
      .join('\n')
    b.disabled = true
    const r = await shareEvent({ id: ev.id, title: ev.title, texte })
    b.disabled = false
    // Partage natif : la feuille du système a fait le travail, rien à dire.
    // Copie : on le dit, sinon on appuie sans savoir s'il s'est passé quelque
    // chose — c'est le cas sur ordinateur, où il n'y a pas de feuille.
    if (r === 'copied' || r === 'failed') {
      peindre(r === 'copied' ? '✅ Lien copié — à coller dans un message' : 'Copie impossible')
      setTimeout(() => peindre('Partager l’événement'), 3000)
    }
  })
  return b
}

function buildActions(ev, ctxModeration) {
  const zone = el('div', 'detail-actions')
  const uid = getUser()?.id ?? null
  const estAuteur = Boolean(uid && ev.created_by === uid)
  const peutGerer =
    estAuteur ||
    (isAdmin() &&
      canModerateEvent(ev, {
        isAdmin: true,
        isOwner: ctxModeration?.owner ?? false,
        depts: ctxModeration?.depts ?? null,
      }))

  if (peutGerer) {
    zone.appendChild(el('h3', 'detail__section-title', 'Gérer cet événement'))

    const edit = el('button', 'btn btn--block')
    edit.type = 'button'
    edit.appendChild(icon('plus'))
    edit.appendChild(document.createTextNode(' Modifier l’événement'))
    edit.addEventListener('click', () => navigate('/publier?id=' + ev.id))
    zone.appendChild(edit)

    const msg = el('p', 'form__msg')

    const del = el('button', 'btn btn--danger btn--block')
    del.type = 'button'
    del.appendChild(icon('logOut'))
    del.appendChild(document.createTextNode(' Supprimer l’événement'))
    del.addEventListener('click', async () => {
      if (
        !confirm(
          `Supprimer définitivement « ${ev.title} » ?\n\nLa photo sera également effacée. Cette action est irréversible.`
        )
      )
        return
      del.disabled = true
      edit.disabled = true
      msg.className = 'form__msg'
      msg.textContent = 'Suppression…'
      try {
        await deleteEvent(ev.id)
        navigate(estAuteur && !isAdmin() ? '/mes-evenements' : '/')
      } catch (e) {
        msg.className = 'form__msg form__msg--err'
        msg.textContent = 'Suppression impossible : ' + e.message
        del.disabled = false
        edit.disabled = false
      }
    })
    zone.appendChild(del)
    zone.appendChild(msg)
    return zone
  }

  if (!isLoggedIn()) return zone

  // --- Signalement (personnes connectées, ni auteur ni admin) ---------------
  zone.appendChild(el('h3', 'detail__section-title', 'Un problème sur cet événement ?'))

  const open = el('button', 'btn btn--ghost btn--block')
  open.type = 'button'
  open.appendChild(icon('message'))
  open.appendChild(document.createTextNode(' Signaler un problème'))
  zone.appendChild(open)

  const form = el('form', 'form detail-report')
  form.hidden = true
  const field = el('label', 'form__field')
  field.appendChild(el('span', 'form__label', 'Que se passe-t-il ?'))
  const area = el('textarea', 'form__input form__textarea')
  area.rows = 4
  area.placeholder =
    'Date erronée, événement annulé, lieu incorrect, contenu inapproprié…'
  field.appendChild(area)
  form.appendChild(field)
  const send = el('button', 'btn btn--primary btn--block', 'Envoyer le signalement')
  send.type = 'submit'
  form.appendChild(send)
  const msg = el('p', 'form__msg')
  form.appendChild(msg)
  zone.appendChild(form)

  open.addEventListener('click', () => {
    form.hidden = !form.hidden
    if (!form.hidden) area.focus()
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const texte = area.value.trim()
    if (texte.length < 3) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = 'Décrivez brièvement le problème.'
      return
    }
    send.disabled = true
    msg.className = 'form__msg'
    msg.textContent = 'Envoi…'
    try {
      // On joint le titre ET l'identifiant : un admin doit pouvoir retrouver
      // l'événement concerné sans avoir à deviner.
      await sendFeedback({
        type: 'bug',
        message: `Signalement sur l'événement « ${ev.title} » (${ev.id})\n\n${texte}`,
      })
      form.innerHTML = ''
      form.appendChild(
        el(
          'p',
          'form__msg form__msg--ok',
          'Merci, le signalement a été transmis à l’équipe d’Armana. 🙏'
        )
      )
      open.disabled = true
    } catch (err) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = 'Envoi impossible : ' + err.message
      send.disabled = false
    }
  })

  return zone
}

// Aperçu plein écran d'une image (tap ou Échap pour fermer).
function openLightbox(src, alt) {
  const overlay = el('div', 'lightbox')
  const img = el('img')
  img.src = src
  img.alt = alt || ''
  overlay.appendChild(img)
  const close = () => {
    overlay.remove()
    document.removeEventListener('keydown', onKey)
  }
  const onKey = (e) => {
    if (e.key === 'Escape') close()
  }
  overlay.addEventListener('click', close)
  document.addEventListener('keydown', onKey)
  document.body.appendChild(overlay)
}
