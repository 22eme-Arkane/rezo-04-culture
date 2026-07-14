// Rézo 04 Culture — état d'authentification + profil courant.
//
// Source unique de vérité côté client pour « qui est connecté et quel est son rôle ».
// La sécurité réelle reste côté base (RLS) : ce module ne sert QU'À l'affichage.
import { supabase } from './supabaseClient.js'

const state = {
  session: null,
  profile: null, // { id, display_name, role }
}

const listeners = new Set()

/** S'abonner aux changements d'auth. Renvoie une fonction de désabonnement. */
export function onAuthChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit() {
  for (const fn of listeners) fn(state)
}

/** Charge le profil (rôle, nom) de l'utilisateur connecté. */
async function loadProfile() {
  if (!state.session) {
    state.profile = null
    return
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, role')
    .eq('id', state.session.user.id)
    .maybeSingle()
  if (error) {
    console.warn('[Rézo] Profil non chargé :', error.message)
    state.profile = null
  } else {
    state.profile = data
  }
}

/** Initialise l'état d'auth au démarrage et écoute les changements. */
export async function initAuth() {
  const { data } = await supabase.auth.getSession()
  state.session = data.session
  await loadProfile()
  emit()

  supabase.auth.onAuthStateChange(async (_event, session) => {
    state.session = session
    await loadProfile()
    emit()
  })
}

export const getSession = () => state.session
export const getUser = () => state.session?.user ?? null
export const getProfile = () => state.profile
export const isLoggedIn = () => Boolean(state.session)
export const isAdmin = () => state.profile?.role === 'admin'

/** Inscription e-mail/mot de passe (+ display_name en metadata → trigger profil). */
export async function signUp(email, password, displayName) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  })
  if (error) throw error
  return data
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

/** Envoie l'e-mail de réinitialisation du mot de passe (lien → /nouveau-mdp). */
export async function resetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: location.origin,
  })
  if (error) throw error
}

/** Définit un nouveau mot de passe (session de récupération ou connecté). */
export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}
