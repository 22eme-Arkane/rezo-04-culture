// Rézo 04 Culture — client Supabase partagé (singleton).
//
// Toute la sécurité repose sur la base (RLS) : la clé "anon" est publique et sûre à
// exposer côté navigateur TANT QUE les politiques RLS sont correctes. On ne fait donc
// JAMAIS confiance au client pour les autorisations — voir supabase/migrations/.
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // On échoue tôt et clairement plutôt que de laisser des appels réseau muets.
  console.error(
    '[Rézo] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY manquants. ' +
      'Copiez .env.example en .env et renseignez votre projet Supabase.'
  )
}

// La configuration est-elle présente ? (affiché à l'utilisateur si non.)
export const isConfigured = Boolean(url && anonKey)

// createClient('') lève « supabaseUrl is required » : on met des placeholders inertes
// quand la config manque, pour que l'app démarre et affiche l'avertissement plutôt
// que d'échouer au chargement. Aucun appel réseau utile ne partira dans ce cas.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  }
)
