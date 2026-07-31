// Armana — écran « Nous contacter » : signaler un bug ou donner son avis.
// Le message est transmis aux administrateurs (boîte « Messages reçus » dans l'app).
import { el, loginPrompt } from './components.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn } from '../lib/auth.js'
import { sendFeedback } from '../lib/feedback.js'

const TEXT_KEY = 'rezo-contact-text'

export function viewContact() {
  const wrap = el('section', 'page')

  const back = el('button', 'back-btn')
  back.appendChild(icon('arrowLeft'))
  back.appendChild(document.createTextNode(' Paramètres'))
  back.addEventListener('click', () => navigate('/parametres'))
  wrap.appendChild(back)

  wrap.appendChild(el('h1', 'page__title', 'Nous contacter'))
  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      'Un bug ? Une idée pour améliorer l’application ? Votre message est transmis aux administrateurs.'
    )
  )

  if (!isLoggedIn()) {
    wrap.appendChild(loginPrompt('Connectez-vous pour nous écrire.'))
    return wrap
  }

  const form = el('form', 'form')

  // Type de message : bug ou avis.
  let type = 'avis'
  const typeRow = el('div', 'chips-row')
  const chipAvis = el('button', 'chip is-active', '💡 Donner mon avis')
  const chipBug = el('button', 'chip', '🐞 Signaler un bug')
  chipAvis.type = 'button'
  chipBug.type = 'button'
  const paintChips = () => {
    chipAvis.classList.toggle('is-active', type === 'avis')
    chipBug.classList.toggle('is-active', type === 'bug')
  }
  chipAvis.addEventListener('click', () => {
    type = 'avis'
    paintChips()
  })
  chipBug.addEventListener('click', () => {
    type = 'bug'
    paintChips()
  })
  typeRow.appendChild(chipAvis)
  typeRow.appendChild(chipBug)
  form.appendChild(typeRow)

  const field = el('label', 'form__field')
  field.appendChild(el('span', 'form__label', 'Votre message'))
  const textarea = el('textarea', 'form__input form__textarea')
  textarea.rows = 6
  textarea.placeholder =
    'Décrivez le bug (que faisiez-vous, que s’est-il passé ?) ou votre idée d’amélioration…'
  try {
    textarea.value = localStorage.getItem(TEXT_KEY) || ''
  } catch {}
  textarea.addEventListener('input', () => {
    try {
      localStorage.setItem(TEXT_KEY, textarea.value)
    } catch {}
  })
  field.appendChild(textarea)
  form.appendChild(field)

  const msg = el('p', 'form__msg')
  const submit = el('button', 'btn btn--primary btn--block', 'Envoyer')
  submit.type = 'submit'
  form.appendChild(submit)
  form.appendChild(msg)

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const text = textarea.value.trim()
    if (text.length < 3) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = 'Écrivez d’abord votre message.'
      return
    }
    submit.disabled = true
    msg.className = 'form__msg'
    msg.textContent = 'Envoi…'
    try {
      await sendFeedback({ type, message: text })
      textarea.value = ''
      try {
        localStorage.removeItem(TEXT_KEY)
      } catch {}
      msg.className = 'form__msg form__msg--ok'
      msg.textContent = 'Merci ! Votre message a bien été transmis aux administrateurs. 🙏'
    } catch (err) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = 'Envoi impossible : ' + err.message
    } finally {
      submit.disabled = false
    }
  })

  wrap.appendChild(form)
  return wrap
}
