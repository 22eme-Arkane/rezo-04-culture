// Armana — écran « Messages reçus » (admin) : bugs signalés + avis.
import { el, emptyState } from './components.js'
import { studioHeader } from './studio.js'
import { navigate } from '../lib/router.js'
import { isAdmin } from '../lib/auth.js'
import { amIOwner } from '../lib/admins.js'
import { listFeedback, deleteFeedback, markFeedbackRead } from '../lib/feedback.js'

const DTF = new Intl.DateTimeFormat('fr-FR', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export async function viewFeedback() {
  const wrap = el('section', 'page page--studio-sub')
  wrap.appendChild(studioHeader('Messages', { backTo: '/parametres' }))

  // Messages « Nous contacter » et signalements : le PROPRIÉTAIRE seul — les
  // modérateurs n'ont que la modération et les statistiques. La base impose
  // déjà cette limite (0020) ; on évite juste un écran d'erreur.
  if (!isAdmin() || !(await amIOwner().catch(() => false))) {
    wrap.appendChild(emptyState('Réservé au propriétaire du projet.'))
    return wrap
  }

  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      'Bugs signalés et avis envoyés depuis « Nous contacter ». Visible du seul propriétaire.'
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

  // ⚠ ORDRE : on LIT d'abord, on MARQUE ensuite. Les messages chargés gardent
  // leur `read_at` d'avant la visite, ce qui permet de signaler ci-dessous
  // ceux qui étaient nouveaux — les marquer avant de charger aurait tout
  // affiché comme déjà lu. Sans attendre la réponse : l'écran n'en dépend pas.
  // `'read_at' in f` : sans la migration 0030, la colonne est absente et rien
  // ne doit être présenté comme nouveau.
  const aDesNouveaux = items.some((f) => 'read_at' in f && !f.read_at)
  if (aDesNouveaux) markFeedbackRead()

  for (const f of items) {
    const row = el('div', 'fb-item')

    const meta = el('div', 'fb-meta')
    // Repère « Nouveau » sur ce qui n'avait pas été lu avant cette visite. Il
    // disparaît à la suivante, puisque l'ouverture de l'écran vient de tout
    // marquer lu.
    if ('read_at' in f && !f.read_at) {
      row.classList.add('fb-item--nouveau')
      meta.appendChild(el('span', 'fb-nouveau', 'Nouveau'))
    }
    meta.appendChild(
      el('span', 'fb-tag ' + (f.type === 'bug' ? 'fb-tag--bug' : 'fb-tag--avis'), f.type === 'bug' ? '🐞 Bug' : '💡 Avis')
    )
    // Le nom mène à la FICHE de l'auteur : son adresse, pour lui répondre. Les
    // deux écrans sont réservés au propriétaire, en base comme ici — le lien
    // n'ouvre donc aucun accès nouveau.
    // ⚠ Un message sans auteur (compte supprimé depuis) n'a pas de fiche :
    // on laisse alors le nom en simple texte plutôt qu'un lien vers une
    // « fiche introuvable ».
    if (f.created_by) {
      const auteur = el('button', 'fb-auteur', f.author_name)
      auteur.type = 'button'
      auteur.title = 'Voir sa fiche pour lui répondre'
      auteur.addEventListener('click', () =>
        navigate(`/membre?id=${encodeURIComponent(f.created_by)}&retour=messages`)
      )
      meta.appendChild(auteur)
    } else {
      meta.appendChild(el('span', null, f.author_name))
    }
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
