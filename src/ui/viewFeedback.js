// Armana — écran « Messages reçus » (admin) : bugs signalés + avis.
import { el, emptyState } from './components.js'
import { studioHeader } from './studio.js'
import { isAdmin } from '../lib/auth.js'
import { listFeedback, deleteFeedback } from '../lib/feedback.js'

const DTF = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export async function viewFeedback() {
  const wrap = el('section', 'page page--studio-sub')
  wrap.appendChild(studioHeader('Messages', { backTo: '/parametres' }))

  if (!isAdmin()) {
    wrap.appendChild(emptyState('Accès réservé aux administrateurs.'))
    return wrap
  }

  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      'Bugs signalés et avis envoyés depuis « Nous contacter ». Visible des seuls administrateurs.'
    )
  )

  const box = el('div', 'settings-group')
  wrap.appendChild(box)

  let items = []
  try {
    items = await listFeedback()
  } catch (e) {
    box.appendChild(emptyState('Chargement impossible : ' + e.message))
    return wrap
  }

  if (!items.length) {
    box.appendChild(emptyState('Aucun message pour l’instant.'))
    return wrap
  }

  for (const f of items) {
    const row = el('div', 'fb-item')

    const meta = el('div', 'fb-meta')
    meta.appendChild(
      el('span', 'fb-tag ' + (f.type === 'bug' ? 'fb-tag--bug' : 'fb-tag--avis'), f.type === 'bug' ? '🐞 Bug' : '💡 Avis')
    )
    meta.appendChild(el('span', null, f.author_name))
    meta.appendChild(el('span', null, DTF.format(new Date(f.created_at))))
    const del = el('button', 'btn btn--danger btn--sm', 'Effacer')
    del.style.marginLeft = 'auto'
    del.addEventListener('click', async () => {
      if (!confirm('Supprimer ce message ?')) return
      del.disabled = true
      try {
        await deleteFeedback(f.id)
        row.remove()
        if (!box.querySelector('.fb-item')) box.appendChild(emptyState('Aucun message pour l’instant.'))
      } catch (e) {
        alert('Suppression impossible : ' + e.message)
        del.disabled = false
      }
    })
    meta.appendChild(del)
    row.appendChild(meta)

    row.appendChild(el('p', 'fb-text', f.message))
    box.appendChild(row)
  }

  return wrap
}
