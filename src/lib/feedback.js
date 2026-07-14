// Rézo 04 Culture — messages « Nous contacter » (bug / avis).
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

/** Messages reçus (admins). Rattache le nom de l'auteur. */
export async function listFeedback() {
  const { data, error } = await supabase
    .from('feedback')
    .select('id, type, message, created_at, created_by')
    .order('created_at', { ascending: false })
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

/** Nombre de messages (0 pour les non-admins via la RLS). */
export async function countFeedback() {
  const { count, error } = await supabase
    .from('feedback')
    .select('id', { count: 'exact', head: true })
  if (error) return 0
  return count ?? 0
}

export async function deleteFeedback(id) {
  const { error } = await supabase.from('feedback').delete().eq('id', id)
  if (error) throw error
}
