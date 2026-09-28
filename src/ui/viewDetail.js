// Armana — écran détail d'un événement : la fiche, puis gérer / signaler.
// Le corps de la fiche est dans ficheEvenement.js ; ici restent la barre de
// titre, le chargement, et les actions réservées (gestion, signalement).
import { el, emptyState } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { isAdmin, isLoggedIn, getUser } from '../lib/auth.js'
import { amIOwner } from '../lib/admins.js'
import { canModerateEvent, myModDepts } from '../lib/moderation.js'
import { navigate } from '../lib/router.js'
import { sendFeedback } from '../lib/feedback.js'
import { ficheEvenement } from './ficheEvenement.js'
import { getEventById, listGemEventIds, deleteEvent } from '../lib/events.js'

export async function viewDetail({ query } = {}) {
  const id = query?.get('id')
  const wrap = el('section', 'page page--studio-sub page--studio-blue fiche')
  // « À l'affiche » plutôt qu'« Événement » (choix de Matthieu, 28/09/2026) :
  // c'est ce qu'on lit devant une salle, et la page montre justement l'affiche.
  // ⚠ Le titre est à la taille des onglets : au-delà de ~205 px sur un écran
  // de 360 px, il chevaucherait le logo. « À l'affiche » en fait 189.
  wrap.appendChild(
    studioHeader('À l’affiche', { backLabel: 'Retour', onBack: () => history.back() })
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

  const gemmed = isLoggedIn() ? (await listGemEventIds()).has(ev.id) : false
  wrap.appendChild(ficheEvenement(ev, { gemmed }))

  // --- Actions en bas de page ---------------------------------------------
  // L'auteur et les administrateurs gèrent l'événement ; les autres personnes
  // connectées peuvent le signaler. Les droits sont AUSSI imposés côté base
  // (RLS) : ce qui suit ne fait que masquer ce qui serait de toute façon refusé.
  // La zone du modérateur borne ses boutons : un modérateur du 04 ne doit pas
  // voir « Supprimer » sur un événement du 84 — la base le refuserait, mais un
  // bouton qui échoue toujours est pire qu'un bouton absent.
  wrap.appendChild(buildActions(ev, await contexteModeration()))

  return wrap
}

/** Propriétaire et zone du modérateur connecté, ou null pour les autres. */
async function contexteModeration() {
  if (!isAdmin()) return null
  const [owner, depts] = await Promise.all([
    amIOwner().catch(() => false),
    myModDepts().catch(() => null),
  ])
  return { owner, depts }
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
