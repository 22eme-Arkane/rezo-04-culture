// Armana — couche d'accès aux données (événements, photos, favoris).
//
// Toute autorisation est imposée par la RLS côté base ; ce module ne fait que
// formuler les requêtes. On lit les événements via la vue events_geo (lat/lng en
// clair) et on rattache photo + auteur par des requêtes explicites (pas d'embedding
// PostgREST au travers de la vue, qui n'est pas garanti).
import { supabase } from './supabaseClient.js'
import { getUser } from './auth.js'
import { makePhotoVariants } from './image.js'

export const CATEGORIES = [
  'Musique',
  'Spectacles vivants',
  'Danse',
  'Théâtre',
  'Exposition',
  'Cinéma',
  'Atelier',
  'Festival',
  'Conférence',
  'Marché',
  'Autre',
]

/** URL publique d'une photo du bucket Storage 'event-photos'. */
export function publicPhotoUrl(path) {
  if (!path) return null
  return supabase.storage.from('event-photos').getPublicUrl(path).data.publicUrl
}

/**
 * Un événement est-il "à venir" (non terminé) ?
 * Fin effective = ends_at, sinon le début (compté jusqu'à la fin de sa journée).
 */
export function isUpcoming(ev) {
  const now = Date.now()
  if (ev.ends_at) return Date.parse(ev.ends_at) >= now
  const start = new Date(ev.starts_at)
  start.setHours(23, 59, 59, 999)
  return start.getTime() >= now
}

// Filtre PostgREST "à venir" : ends_at >= maintenant, OU (ends_at nul ET starts_at
// >= aujourd'hui). Les mois passés ne s'affichent jamais.
function applyUpcoming(q) {
  const now = new Date().toISOString()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return q.or(`ends_at.gte.${now},and(ends_at.is.null,starts_at.gte.${today.toISOString()})`)
}

/** Rattache author_name + photo_url (1re photo) à une liste d'événements. */
async function attachRelations(events) {
  const list = events ?? []
  if (!list.length) return []
  const ids = list.map((e) => e.id)
  const creatorIds = [...new Set(list.map((e) => e.created_by))]

  const [photosRes, profilesRes] = await Promise.all([
    supabase
      .from('event_photos')
      .select('event_id, storage_path, position')
      .in('event_id', ids)
      .order('position', { ascending: true }),
    supabase.from('profiles').select('id, display_name').in('id', creatorIds),
  ])

  const firstPhoto = new Map()
  for (const p of photosRes.data ?? []) {
    if (!firstPhoto.has(p.event_id)) firstPhoto.set(p.event_id, p.storage_path)
  }
  const nameById = new Map((profilesRes.data ?? []).map((p) => [p.id, p.display_name]))

  return list.map((e) => {
    const path = firstPhoto.get(e.id) ?? null
    // Convention de stockage : {uid}/{eventId}/photo.webp + thumb.webp à côté.
    // La vignette sert aux listes/cartes ; la pleine résolution au détail seul.
    const thumbPath = path?.endsWith('photo.webp')
      ? path.replace(/photo\.webp$/, 'thumb.webp')
      : path
    return {
      ...e,
      author_name: nameById.get(e.created_by) ?? 'Anonyme',
      photo_url: path ? publicPhotoUrl(path) : null,
      thumb_url: thumbPath ? publicPhotoUrl(thumbPath) : null,
    }
  })
}

/**
 * Événements visibles à l'agenda (non terminés) : ceux APPROUVÉS (tout le monde) +
 * ses PROPRES événements en attente (pour que l'auteur voie sa soumission, avec un
 * badge « En attente »). Les mois passés ne s'affichent jamais.
 */
export async function listApprovedEvents() {
  const uid = getUser()?.id
  let q = supabase.from('events_geo').select('*')
  if (uid) q = q.or(`status.eq.approved,and(created_by.eq.${uid},status.eq.pending)`)
  else q = q.eq('status', 'approved')
  q = applyUpcoming(q)
  const { data, error } = await q.order('starts_at', { ascending: true })
  if (error) throw error
  return attachRelations(data)
}

/** Visibilité "carte/agenda" : approuvé, OU sa propre soumission en attente. */
function isVisibleToViewer(ev, uid) {
  return ev.status === 'approved' || (uid && ev.created_by === uid && ev.status === 'pending')
}

/** Événements dans un rayon (mètres) — PostGIS ST_DWithin via RPC. */
export async function eventsWithinRadius({ lat, lng, radiusM }) {
  const { data, error } = await supabase.rpc('events_within_radius', {
    lat,
    lng,
    radius_m: radiusM,
  })
  if (error) throw error
  const uid = getUser()?.id
  // La RPC renvoie ce que la RLS autorise : on garde approuvés + sien-en-attente, non terminés.
  return attachRelations((data ?? []).filter((e) => isVisibleToViewer(e, uid) && isUpcoming(e)))
}

/** Un événement par id (via la vue events_geo, RLS appliquée). */
export async function getEventById(id) {
  const { data, error } = await supabase
    .from('events_geo')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const [withRel] = await attachRelations([data])
  return withRel
}

/** Événements de l'utilisateur connecté (tous statuts). */
export async function listMyEvents() {
  const uid = getUser()?.id
  if (!uid) return []
  const { data, error } = await supabase
    .from('events_geo')
    .select('*')
    .eq('created_by', uid)
    .order('starts_at', { ascending: false })
  if (error) throw error
  return attachRelations(data)
}

/** Nombre d'événements en attente (admin ; renvoie 0 pour les autres via RLS). */
export async function listPendingCount() {
  const { count, error } = await supabase
    .from('events')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) throw error
  return count ?? 0
}

/** Événements en attente de modération (admin uniquement, garanti par RLS). */
export async function listPendingEvents() {
  const { data, error } = await supabase
    .from('events_geo')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(100) // la file se traite par paquets : pas de chargement sans fin
  if (error) throw error
  return attachRelations(data)
}

/** Crée un événement (statut 'pending') via la RPC sécurisée. Renvoie la ligne. */
export async function createEvent(p) {
  const { data, error } = await supabase.rpc('create_event', {
    p_title: p.title,
    p_description: p.description ?? '',
    p_starts_at: p.starts_at,
    p_ends_at: p.ends_at ?? null,
    p_is_paid: p.is_paid ?? false,
    p_price: p.price ?? null,
    p_lat: p.lat ?? null,
    p_lng: p.lng ?? null,
    p_address: p.address ?? '',
    p_category: p.category ?? '',
  })
  if (error) throw error
  return data
}

/** Met à jour un événement (repasse en 'pending' si non-admin). */
export async function updateEvent(id, p) {
  const { data, error } = await supabase.rpc('update_event', {
    p_id: id,
    p_title: p.title,
    p_description: p.description ?? '',
    p_starts_at: p.starts_at,
    p_ends_at: p.ends_at ?? null,
    p_is_paid: p.is_paid ?? false,
    p_price: p.price ?? null,
    p_lat: p.lat ?? null,
    p_lng: p.lng ?? null,
    p_address: p.address ?? '',
    p_category: p.category ?? '',
  })
  if (error) throw error
  return data
}

export async function deleteEvent(id) {
  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) throw error
}

/** Modération (admin) : approuver / rejeter. */
export async function setEventStatus(id, status) {
  const { error } = await supabase.from('events').update({ status }).eq('id', id)
  if (error) throw error
}

/**
 * Téléverse une photo d'événement — RÈGLE DE STOCKAGE (plan gratuit) :
 * compression WebP côté client AVANT envoi (max ~1600px) + vignette ~400px.
 * Chemins : {uid}/{eventId}/photo.webp (pleine) et thumb.webp (vignette).
 * La ligne event_photos ne référence que la pleine ; la vignette est dérivée.
 */
export async function uploadEventPhoto(eventId, file, crop = null) {
  const uid = getUser()?.id
  if (!uid) throw new Error('Non connecté')

  // `crop` = cadrage choisi par l'auteur dans l'aperçu ; appliqué à la vignette.
  const { full, thumb } = await makePhotoVariants(file, { crop })
  const base = `${uid}/${eventId}`
  const opts = { upsert: true, contentType: 'image/webp' }

  const { error: e1 } = await supabase.storage
    .from('event-photos')
    .upload(`${base}/photo.webp`, full, opts)
  if (e1) throw e1
  const { error: e2 } = await supabase.storage
    .from('event-photos')
    .upload(`${base}/thumb.webp`, thumb, opts)
  if (e2) throw e2

  // Une seule photo par événement pour l'instant : upsert de la ligne.
  await supabase.from('event_photos').delete().eq('event_id', eventId)
  const { error: insErr } = await supabase
    .from('event_photos')
    .insert({ event_id: eventId, storage_path: `${base}/photo.webp`, position: 0 })
  if (insErr) throw insErr
  return `${base}/photo.webp`
}

/**
 * Purge des MOIS RÉVOLUS (admin) — règle de rétention : on garde le mois en
 * cours et les mois à venir, on supprime tout ce qui appartient aux mois passés.
 *
 * ⚠ ORDRE CRITIQUE : les FICHIERS d'abord, les LIGNES ensuite. Un simple DELETE
 * SQL ne libère PAS le Storage — les fichiers deviendraient introuvables et
 * occuperaient le quota pour toujours.
 */
export async function purgePastMonths() {
  const { data, error } = await supabase.rpc('expired_events_before_month')
  if (error) throw error
  const rows = data ?? []
  if (!rows.length) return { events: 0, files: 0 }

  const ids = [...new Set(rows.map((r) => r.id))]
  const files = []
  for (const r of rows) {
    if (!r.storage_path) continue
    files.push(r.storage_path)
    // La vignette est déduite du chemin (convention {uid}/{eventId}/photo.webp).
    if (r.storage_path.endsWith('photo.webp')) {
      files.push(r.storage_path.replace(/photo\.webp$/, 'thumb.webp'))
    }
  }

  // 1) Fichiers, par paquets (l'API Storage n'aime pas les listes géantes).
  let removed = 0
  for (const batch of chunk(files, 100)) {
    const { data: gone, error: rmErr } = await supabase.storage.from('event-photos').remove(batch)
    if (rmErr) throw new Error('Suppression des photos : ' + rmErr.message)
    removed += gone?.length ?? 0
  }

  // 2) Lignes (event_photos et gems partent en cascade), par paquets aussi :
  //    les identifiants transitent dans l'URL, qui a une longueur limitée.
  for (const batch of chunk(ids, 100)) {
    const { error: delErr } = await supabase.from('events').delete().in('id', batch)
    if (delErr) throw new Error('Suppression des événements : ' + delErr.message)
  }

  return { events: ids.length, files: removed }
}

function chunk(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// --- Favoris (Gems) --------------------------------------------------------

/** Set des ids d'événements « gemmés » par l'utilisateur connecté. */
export async function listGemEventIds() {
  const uid = getUser()?.id
  if (!uid) return new Set()
  const { data, error } = await supabase.from('gems').select('event_id').eq('user_id', uid)
  if (error) throw error
  return new Set((data ?? []).map((g) => g.event_id))
}

/** Événements favoris (approuvés/visibles) de l'utilisateur. */
export async function listGemmedEvents() {
  const ids = [...(await listGemEventIds())]
  if (!ids.length) return []
  const { data, error } = await supabase
    .from('events_geo')
    .select('*')
    .in('id', ids)
    .order('starts_at', { ascending: true })
  if (error) throw error
  return attachRelations(data)
}

export async function addGem(eventId) {
  const uid = getUser()?.id
  if (!uid) throw new Error('Non connecté')
  const { error } = await supabase.from('gems').insert({ user_id: uid, event_id: eventId })
  if (error) throw error
}

export async function removeGem(eventId) {
  const uid = getUser()?.id
  if (!uid) throw new Error('Non connecté')
  const { error } = await supabase
    .from('gems')
    .delete()
    .eq('user_id', uid)
    .eq('event_id', eventId)
  if (error) throw error
}
