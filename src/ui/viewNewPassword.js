// Armana — écran « Nouveau mot de passe » (arrivée du lien de
// réinitialisation reçu par e-mail : Supabase ouvre une session de récupération,
// on demande simplement le nouveau mot de passe).
import { el } from './components.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn, updatePassword } from '../lib/auth.js'
import { studioHeader } from './studio.js'

export function viewNewPassword() {
  const wrap = el('section', 'page page--studio-sub')
  wrap.appendChild(studioHeader('Nouveau mot de passe', { backTo: '/connexion', backLabel: 'Connexion' }))
  const card = el('div', 'card-panel studio-auth-card')
  card.appendChild(el('h2', 'card-panel__title', 'Nouveau mot de passe'))

  if (!isLoggedIn()) {
    card.appendChild(
      el(
        'p',
        'form__hint',
        'Lien invalide ou expiré. Redemandez un e-mail de réinitialisation depuis l’écran de connexion (« Mot de passe oublié ? »).'
      )
    )
    const back = el('button', 'btn btn--primary btn--block', 'Aller à la connexion')
    back.addEventListener('click', () => navigate('/connexion'))
    card.appendChild(back)
    wrap.appendChild(card)
    return wrap
  }

  const form = el('form', 'form')
  const f1 = field('Nouveau mot de passe')
  const f2 = field('Confirmez le mot de passe')
  const msg = el('p', 'form__msg')
  const submit = el('button', 'btn btn--primary btn--block', 'Enregistrer')
  submit.type = 'submit'

  form.appendChild(f1.wrap)
  form.appendChild(f2.wrap)
  form.appendChild(submit)
  form.appendChild(msg)

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    msg.className = 'form__msg'
    if (f1.input.value.length < 6) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = 'Le mot de passe doit faire au moins 6 caractères.'
      return
    }
    if (f1.input.value !== f2.input.value) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = 'Les deux mots de passe ne correspondent pas.'
      return
    }
    submit.disabled = true
    msg.textContent = 'Enregistrement…'
    try {
      await updatePassword(f1.input.value)
      msg.className = 'form__msg form__msg--ok'
      msg.textContent = 'Mot de passe changé ! Vous êtes connecté.'
      setTimeout(() => navigate('/'), 900)
    } catch (err) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = err.message
      submit.disabled = false
    }
  })

  card.appendChild(form)
  wrap.appendChild(card)
  return wrap
}

function field(label) {
  const wrap = el('label', 'form__field')
  wrap.appendChild(el('span', 'form__label', label))
  const input = el('input', 'form__input')
  input.type = 'password'
  input.autocomplete = 'new-password'
  input.required = true
  wrap.appendChild(input)
  return { wrap, input }
}
