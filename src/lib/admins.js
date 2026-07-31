// Armana — gestion des administrateurs (réservé aux admins, via RPC).
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

/**
 * Tous les membres inscrits (nom, rôle, date d'inscription).
 * Passe par une RPC réservée aux admins : la table profiles n'expose plus que
 * (id, display_name) au public, sinon l'annuaire complet des inscrits était
 * aspirable avec la clé publique présente dans le bundle.
 */
export async function listMembers() {
  const { data, error } = await supabase.rpc('list_members')
  if (error) throw error
  return data ?? []
}

/** Enregistre le passage du jour (statistiques de fréquentation). Silencieux. */
export async function recordVisit() {
  try {
    await supabase.rpc('record_visit')
  } catch {
    /* purement statistique : ne doit jamais gêner l'utilisateur */
  }
}

/** Statistiques complètes du tableau de bord (admin uniquement). */
export async function getAdminStats() {
  const { data, error } = await supabase.rpc('admin_stats')
  if (error) throw error
  return data
}
