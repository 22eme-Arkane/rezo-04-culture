// Armana — écran « Administrateurs » (admin uniquement) :
// lister, désigner par e-mail, retirer.
import { el, emptyState } from './components.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'
import { isAdmin, getUser } from '../lib/auth.js'
import { listAdmins, setAdminByEmail } from '../lib/admins.js'

export async function viewAdmins() {
  const wrap = el('section', 'page')

  const back = el('button', 'back-btn')
  back.appendChild(icon('arrowLeft'))
  back.appendChild(document.createTextNode(' Paramètres'))
  back.addEventListener('click', () => navigate('/parametres'))
  wrap.appendChild(back)

  wrap.appendChild(el('h1', 'page__title', 'Administrateurs'))

  if (!isAdmin()) {
    wrap.appendChild(emptyState('Accès réservé aux administrateurs.'))
    return wrap
  }

  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      'Un admin peut modifier/supprimer tous les événements et désigner d’autres admins. La personne doit d’abord avoir créé son compte dans l’app.'
    )
  )

  // --- Ajout par e-mail ---
  const form = el('div', 'form')
  const field = el('label', 'form__field')
  field.appendChild(el('span', 'form__label', 'Désigner un administrateur (e-mail)'))
  const emailInput = el('input', 'form__input')
  emailInput.type = 'email'
  emailInput.placeholder = 'personne@exemple.fr'
  field.appendChild(emailInput)
  form.appendChild(field)

  const msg = el('p', 'form__msg')
  const addBtn = el('button', 'btn btn--primary btn--block')
  addBtn.appendChild(icon('shield'))
  addBtn.appendChild(document.createTextNode(' Désigner administrateur'))
  form.appendChild(addBtn)
  form.appendChild(msg)
  wrap.appendChild(form)

  const listWrap = el('div', 'settings-group')
  wrap.appendChild(listWrap)

  async function refresh() {
    listWrap.innerHTML = ''
    let admins = []
    try {
      admins = await listAdmins()
    } catch (e) {
      listWrap.appendChild(emptyState('Chargement impossible : ' + e.message))
      return
    }
    if (!admins.length) {
      listWrap.appendChild(emptyState('Aucun administrateur.'))
      return
    }
    const myId = getUser()?.id
    for (const a of admins) {
      const row = el('div', 'settings-row')
      const label = el('div', 'settings-row__label')
      label.appendChild(icon('user'))
      label.appendChild(document.createTextNode(a.display_name || a.email))
      row.appendChild(label)

      if (a.id === myId) {
        row.appendChild(el('span', 'settings-row__value', 'vous'))
      } else {
        const rm = el('button', 'btn btn--danger btn--sm', 'Retirer')
        rm.addEventListener('click', async () => {
          if (!confirm(`Retirer le rôle admin de ${a.display_name || a.email} ?`)) return
          rm.disabled = true
          try {
            await setAdminByEmail(a.email, false)
            await refresh()
          } catch (e) {
            alert('Action impossible : ' + e.message)
            rm.disabled = false
          }
        })
        row.appendChild(rm)
      }
      listWrap.appendChild(row)
    }
  }

  addBtn.addEventListener('click', async () => {
    const email = emailInput.value.trim()
    msg.className = 'form__msg'
    if (!email) {
      msg.classList.add('form__msg--err')
      msg.textContent = 'Entrez un e-mail.'
      return
    }
    addBtn.disabled = true
    msg.textContent = 'Traitement…'
    try {
      const res = await setAdminByEmail(email, true)
      msg.className = 'form__msg form__msg--ok'
      msg.textContent = `${res?.display_name || email} est désormais administrateur.`
      emailInput.value = ''
      await refresh()
    } catch (e) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = e.message
    } finally {
      addBtn.disabled = false
    }
  })

  await refresh()
  return wrap
}
