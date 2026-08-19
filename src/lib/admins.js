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
 * Désigne (ou retire) un admin par identifiant — utilisé par l'écran Membres.
 * `list_members` ne renvoie volontairement pas les e-mails : l'annuaire complet
 * des inscrits ne doit pas circuler côté client.
 */
export async function setAdminById(id, makeAdmin) {
  const { data, error } = await supabase.rpc('set_admin_by_id', {
    target_id: id,
    make_admin: makeAdmin,
  })
  if (error) throw error
  return data?.[0] ?? null
}

/**
 * Fiche complète d'un membre, e-mail compris (admin uniquement).
 * L'adresse n'est volontairement PAS incluse dans `listMembers` : elle n'est
 * lue que lorsqu'un administrateur ouvre délibérément une fiche.
 */
export async function getMemberProfile(id) {
  const { data, error } = await supabase.rpc('member_profile', { p_id: id })
  if (error) throw error
  return data?.[0] ?? null
}

// --- Propriétaire du projet ---------------------------------------------------
// Le drapeau `profiles.is_owner` n'est pas lisible directement (aucun GRANT sur
// la colonne) : on passe par une RPC, dont le résultat ne change pas au cours
// d'une session. La garantie reste côté base — cette valeur ne sert qu'à
// afficher ou masquer l'entrée du journal.
let ownerPromise = null

export function amIOwner() {
  if (!ownerPromise) {
    ownerPromise = supabase
      .rpc('am_i_owner')
      .then(({ data, error }) => (error ? false : data === true))
      .catch(() => false)
  }
  return ownerPromise
}

/** À appeler au changement de compte : le cache ci-dessus deviendrait faux. */
export function resetOwnerCache() {
  ownerPromise = null
}

/** Journal des actions d'administration (propriétaire uniquement). */
export async function listAdminActions(max = 200) {
  const { data, error } = await supabase.rpc('list_admin_actions', { max_rows: max })
  if (error) throw error
  return data ?? []
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

/**
 * Enregistre le passage du jour (statistiques de fréquentation).
 * Ne bloque jamais l'utilisateur, mais LAISSE UNE TRACE en cas d'échec.
 *
 * ⚠ Le `try/catch` seul ne servait à rien : supabase-js ne lève pas, il
 * renvoie `{ error }`. Une erreur de droits ou de contrainte passait donc
 * totalement inaperçue, et un comptage défaillant était indiagnostiquable
 * depuis le navigateur.
 */
export async function recordVisit() {
  try {
    const { error } = await supabase.rpc('record_visit')
    if (error) console.warn('[Armana] Visite non enregistrée :', error.code, error.message)
  } catch (e) {
    console.warn('[Armana] Visite non enregistrée :', e.message)
  }
}

// Identifiant de visiteur non inscrit. Nombre aléatoire tiré par le navigateur,
// sans lien avec une personne : il sert uniquement à ne pas compter dix fois la
// même visite dans la journée. Préfixe `rezo-` comme les autres clés locales.
const VISITEUR_KEY = 'rezo-visitor'

function idVisiteur() {
  try {
    let id = localStorage.getItem(VISITEUR_KEY)
    if (!/^[0-9a-f]{32}$/.test(id || '')) {
      id = (crypto.randomUUID?.() || '').replace(/-/g, '')
      if (!/^[0-9a-f]{32}$/.test(id)) return null
      localStorage.setItem(VISITEUR_KEY, id)
    }
    return id
  } catch {
    // Stockage refusé (navigation privée) : on ne compte pas plutôt que de
    // compter faux à chaque ouverture.
    return null
  }
}

/**
 * Passage d'un visiteur NON connecté. Sans cela, les statistiques ne voyaient
 * que les inscrits — c'est-à-dire une minorité des passages.
 */
export async function recordAnonVisit() {
  const id = idVisiteur()
  if (!id) {
    // Navigation privée, ou navigateur sans générateur aléatoire : on préfère
    // ne pas compter plutôt que compter faux. Mais on le dit.
    console.warn('[Armana] Passage anonyme non compté : identifiant indisponible.')
    return
  }
  try {
    const { error } = await supabase.rpc('record_anon_visit', { p_visitor: id })
    if (error) console.warn('[Armana] Passage non enregistré :', error.code, error.message)
  } catch (e) {
    console.warn('[Armana] Passage non enregistré :', e.message)
  }
}

/** Statistiques complètes du tableau de bord (admin uniquement). */
export async function getAdminStats() {
  const { data, error } = await supabase.rpc('admin_stats')
  if (error) throw error
  return data
}
