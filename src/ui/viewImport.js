// Rézo 04 Culture — écran « Créer depuis un message » (WhatsApp, SMS, e-mail…).
// Colle (ou reçoit via le partage natif) un message → analyse LOCALE (chrono-node +
// heuristiques) → formulaire de publication pré-rempli. Aucune donnée envoyée.
import { el, loginPrompt } from './components.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn } from '../lib/auth.js'
import { parseEventMessage } from '../lib/parseMessage.js'
import { setDraft, consumeSharedText, peekSharedFile } from '../lib/draft.js'

export function viewImport() {
  const wrap = el('section', 'page')

  const back = el('button', 'back-btn')
  back.appendChild(icon('arrowLeft'))
  back.appendChild(document.createTextNode(' Retour'))
  back.addEventListener('click', () => navigate('/'))
  wrap.appendChild(back)

  wrap.appendChild(el('h1', 'page__title', 'Créer depuis un message'))
  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      'Collez l’annonce (WhatsApp, SMS…) : on pré-remplit l’événement pour vous. Tout se fait sur votre téléphone.'
    )
  )

  if (!isLoggedIn()) {
    wrap.appendChild(loginPrompt('Connectez-vous pour créer un événement.'))
    return wrap
  }

  const form = el('div', 'form')

  const field = el('label', 'form__field')
  field.appendChild(el('span', 'form__label', 'Message'))
  const textarea = el('textarea', 'form__input form__textarea')
  textarea.rows = 7
  textarea.placeholder =
    'Ex. : Concert de la chorale samedi 12 juillet à 20h30 à Forcalquier, entrée libre !'
  // Persistance de la saisie (un aller-retour hors de l'app peut recharger la page).
  const TEXT_KEY = 'rezo-import-text'
  const shared = consumeSharedText()
  if (shared) {
    textarea.value = shared
    try {
      localStorage.setItem(TEXT_KEY, shared)
    } catch {}
  } else {
    try {
      textarea.value = localStorage.getItem(TEXT_KEY) || ''
    } catch {}
  }
  textarea.addEventListener('input', () => {
    try {
      localStorage.setItem(TEXT_KEY, textarea.value)
    } catch {}
  })
  field.appendChild(textarea)
  form.appendChild(field)

  const hasPhoto = Boolean(peekSharedFile())
  if (hasPhoto) {
    form.appendChild(el('p', 'form__hint', '📷 Une photo est jointe et sera ajoutée à l’événement.'))
  }

  const hint = el('p', 'form__hint', '')
  form.appendChild(hint)

  const analyze = el('button', 'btn btn--primary btn--block')
  analyze.appendChild(icon('check'))
  analyze.appendChild(document.createTextNode(' Analyser et pré-remplir'))
  analyze.addEventListener('click', () => {
    const text = textarea.value.trim()
    if (!text && !hasPhoto) {
      hint.textContent = 'Collez d’abord un message (ou partagez une photo).'
      return
    }
    const draft = parseEventMessage(text)
    setDraft(draft)
    try {
      localStorage.removeItem(TEXT_KEY) // consommé : le brouillon continue côté formulaire
    } catch {}
    navigate('/publier?draft=1')
  })
  form.appendChild(analyze)

  wrap.appendChild(form)
  return wrap
}
