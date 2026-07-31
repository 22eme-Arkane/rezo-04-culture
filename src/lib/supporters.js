// Armana — mur des soutiens.
//
// Les dons passent par PayPal.me : aucun service ne prévient l'application. Un
// admin marque donc la personne comme soutien après l'avoir vu dans PayPal.
// Aucune somme n'est jamais enregistrée : seulement « a soutenu » et depuis quand.
import { supabase } from './supabaseClient.js'

/** Soutiens affichés publiquement (nom + ancienneté), du plus ancien au plus récent. */
export async function listSupporters() {
  const { data, error } = await supabase.rpc('list_supporters')
  if (error) throw error
  return data ?? []
}

/** Marque (ou retire) un soutien par e-mail. Réservé aux admins côté base. */
export async function setSupporterByEmail(email, isSupporter) {
  const { data, error } = await supabase.rpc('set_supporter_by_email', {
    target_email: email,
    is_supporter: isSupporter,
  })
  if (error) throw error
  return data?.[0] ?? null
}

/** Statut du compte connecté : { is_supporter, is_public }. */
export async function mySupporterStatus() {
  const { data, error } = await supabase.rpc('my_supporter_status')
  if (error) throw error
  return data?.[0] ?? { is_supporter: false, is_public: true }
}

/** Apparaître ou non sur le mur des soutiens (choix de la personne elle-même). */
export async function setSupporterVisibility(isPublic) {
  const { error } = await supabase.rpc('set_supporter_visibility', { is_public: isPublic })
  if (error) throw error
}
