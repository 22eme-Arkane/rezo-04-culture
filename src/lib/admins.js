// Rézo 04 Culture — gestion des administrateurs (réservé aux admins, via RPC).
import { supabase } from './supabaseClient.js'

/** Liste des admins (nom + e-mail). Nécessite d'être admin (garanti côté base). */
export async function listAdmins() {
  const { data, error } = await supabase.rpc('list_admins')
  if (error) throw error
  return data ?? []
}

/** Désigne (ou retire) un admin par e-mail. */
export async function setAdminByEmail(email, makeAdmin) {
  const { data, error } = await supabase.rpc('set_admin_by_email', {
    target_email: email,
    make_admin: makeAdmin,
  })
  if (error) throw error
  return data?.[0] ?? null
}

/** Tous les membres inscrits (nom, rôle, date d'inscription). */
export async function listMembers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('display_name, role, created_at')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}
