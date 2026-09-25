// Armana — messages « Nous contacter » (bug / avis).
// Écriture : tout utilisateur connecté. Lecture/suppression : admins (RLS).
import { supabase } from './supabaseClient.js'
import { getUser } from './auth.js'

export async function sendFeedback({ type, message }) {
  const uid = getUser()?.id
  if (!uid) throw new Error('Non connecté')
  const { error } = await supabase
    .from('feedback')
    .insert({ created_by: uid, type, message })
  if (error) throw error
}

/** Messages reçus (propriétaire). Rattache le nom de l'auteur. */
export async function listFeedback() {
  let { data, error } = await supabase
    .from('feedback')
    .select('id, type, message, created_at, created_by, read_at')
    .order('created_at', { ascending: false })
  // ⚠ REPLI SI LA MIGRATION 0030 N'EST PAS ENCORE PASSÉE. Sans la colonne
  // `read_at`, la requête échoue entièrement (42703) et l'écran « Messages »
  // tomberait en panne. On relance alors sans elle : les messages s'affichent,
  // simplement sans distinction lu / nouveau.
  if (error?.code === '42703') {
    ;({ data, error } = await supabase
      .from('feedback')
      .select('id, type, message, created_at, created_by')
      .order('created_at', { ascending: false }))
  }
  if (error) throw error
  const list = data ?? []
  const ids = [...new Set(list.map((f) => f.created_by).filter(Boolean))]
  let names = new Map()
  if (ids.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', ids)
    names = new Map((profs ?? []).map((p) => [p.id, p.display_name]))
  }
  return list.map((f) => ({ ...f, author_name: names.get(f.created_by) ?? 'Anonyme' }))
}

/**
 * Nombre de messages NON LUS (0 pour tout autre que le propriétaire, via la RLS).
 *
 * ⚠ Il comptait tous les messages, lus compris : le chiffre ne disait jamais
 * s'il y avait du nouveau. Sans la migration 0030, la colonne manque et la
 * requête échoue — on renvoie alors 0 plutôt qu'un total trompeur.
 */
export async function countFeedback() {
  const { count, error } = await supabase
    .from('feedback')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
  if (error) return 0
  return count ?? 0
}

/**
 * Marque comme lus tous les messages encore non lus (propriétaire seul).
 *
 * ⚠ PAR UNE FONCTION, jamais par une mise à jour de la table : `feedback` n'a
 * aucune politique UPDATE, et en ouvrir une permettrait aussi de réécrire le
 * texte d'un message. Voir la migration 0030.
 * Ne bloque jamais l'affichage : un échec laisse simplement les messages
 * « nouveaux » jusqu'à la prochaine visite.
 */
export async function markFeedbackRead() {
  const { data, error } = await supabase.rpc('mark_feedback_read')
  if (error) {
    console.warn('[Armana] Messages non marqués lus :', error.message)
    return 0
  }
  return data ?? 0
}

export async function deleteFeedback(id) {
  const { error } = await supabase.from('feedback').delete().eq('id', id)
  if (error) throw error
}
