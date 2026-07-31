// Armana — Connexion / Inscription (e-mail + mot de passe Supabase Auth).
import { el } from './components.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'
import { signIn, signUp, resetPassword, isLoggedIn } from '../lib/auth.js'

export function viewAuth() {
  const wrap = el('section', 'page')

  const back = el('button', 'back-btn')
  back.appendChild(icon('arrowLeft'))
  back.appendChild(document.createTextNode(' Retour'))
  back.addEventListener('click', () => navigate('/'))
  wrap.appendChild(back)

  if (isLoggedIn()) {
    navigate('/')
    return wrap
  }

  let mode = 'login' // 'login' | 'signup'
  const card = el('div', 'card-panel')
  const title = el('h2', 'card-panel__title')
  const form = el('form', 'form')
  const msg = el('p', 'form__msg')

  const nameField = field('Nom affiché', 'text', 'name', 'Comment on vous verra')
  const emailField = field('E-mail', 'email', 'email', 'vous@exemple.fr')
  const passField = field('Mot de passe', 'password', 'password', '••••••••')

  const submit = el('button', 'btn btn--primary btn--block')
  submit.type = 'submit'
  const toggle = el('button', 'btn btn--link')
  toggle.type = 'button'
  const forgot = el('button', 'btn btn--link', 'Mot de passe oublié ?')
  forgot.type = 'button'

  function paint() {
    title.textContent = mode === 'login' ? 'Connexion' : 'Créer un compte'
    submit.textContent = mode === 'login' ? 'Se connecter' : "S'inscrire"
    toggle.textContent =
      mode === 'login' ? 'Pas encore de compte ? S’inscrire' : 'Déjà inscrit ? Se connecter'
    nameField.wrap.style.display = mode === 'signup' ? '' : 'none'
    forgot.style.display = mode === 'login' ? '' : 'none'
    msg.textContent = ''
    msg.className = 'form__msg'
  }

  forgot.addEventListener('click', async () => {
    const email = emailField.input.value.trim()
    if (!email) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = 'Entrez d’abord votre e-mail ci-dessus, puis retouchez « Mot de passe oublié ? ».'
      return
    }
    forgot.disabled = true
    msg.className = 'form__msg'
    msg.textContent = 'Envoi…'
    try {
      await resetPassword(email)
      msg.className = 'form__msg form__msg--ok'
      msg.textContent =
        'E-mail envoyé ! Ouvrez le lien reçu : il vous amènera à l’écran « Nouveau mot de passe ».'
    } catch (e) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = friendly(e.message)
    } finally {
      forgot.disabled = false
    }
  })

  toggle.addEventListener('click', () => {
    mode = mode === 'login' ? 'signup' : 'login'
    paint()
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    submit.disabled = true
    msg.className = 'form__msg'
    msg.textContent = 'Veuillez patienter…'
    try {
      const email = emailField.input.value.trim()
      const password = passField.input.value
      if (mode === 'signup') {
        const name = nameField.input.value.trim()
        if (!name) throw new Error('Le nom affiché est requis.')
        const res = await signUp(email, password, name)
        if (!res.session) {
          msg.className = 'form__msg form__msg--ok'
          msg.textContent = 'Compte créé. Vérifiez votre e-mail pour confirmer, puis connectez-vous.'
          mode = 'login'
          paint()
          return
        }
      } else {
        await signIn(email, password)
      }
      navigate('/')
    } catch (err) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = friendly(err.message)
    } finally {
      submit.disabled = false
    }
  })

  form.appendChild(nameField.wrap)
  form.appendChild(emailField.wrap)
  form.appendChild(passField.wrap)
  form.appendChild(submit)
  form.appendChild(msg)
  form.appendChild(forgot)
  form.appendChild(toggle)

  card.appendChild(title)
  card.appendChild(form)
  wrap.appendChild(card)
  paint()
  return wrap
}

function field(label, type, name, placeholder) {
  const wrap = el('label', 'form__field')
  wrap.appendChild(el('span', 'form__label', label))
  const input = el('input', 'form__input')
  input.type = type
  input.name = name
  input.placeholder = placeholder || ''
  input.autocomplete = type === 'password' ? 'current-password' : type === 'email' ? 'email' : 'off'
  if (type !== 'text') input.required = true
  wrap.appendChild(input)
  return { wrap, input }
}

function friendly(m) {
  if (!m) return 'Erreur inconnue.'
  if (/invalid login credentials/i.test(m)) return 'E-mail ou mot de passe incorrect.'
  if (/password/i.test(m) && /6/.test(m)) return 'Mot de passe : 6 caractères minimum.'
  if (/already registered/i.test(m)) return 'Cet e-mail est déjà utilisé.'
  return m
}
