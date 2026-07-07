// Rézo 04 Culture — Edge Function : purge des événements terminés.
//
// OBJECTIF (plan gratuit) : libérer la base ET le Storage. Déclenchée par un cron
// quotidien (voir README de ce dossier).
//
// ⚠ PIÈGE CRITIQUE : un simple DELETE SQL ne libère PAS le Storage. On supprime donc
// d'abord les FICHIERS du bucket (original + vignette), PUIS les lignes en base.
// La suppression des lignes events fait tomber event_photos et gems EN CASCADE.
//
// SÉCURITÉ : utilise la clé service_role, injectée par Supabase UNIQUEMENT côté
// serveur (jamais exposée au client — invariant projet).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BUCKET = 'event-photos'
// Délai de grâce (jours) après la fin de l'événement avant purge. Réglable.
const GRACE_DAYS = Number(Deno.env.get('PURGE_GRACE_DAYS') ?? '2')

Deno.serve(async (req) => {
  // Autorisation simple : réservé au cron/appel authentifié service_role.
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.includes(SERVICE_ROLE)) {
    return json({ error: 'Non autorisé' }, 401)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  const cutoff = new Date(Date.now() - GRACE_DAYS * 86_400_000).toISOString()

  // 1) Cibler les événements terminés depuis > GRACE_DAYS.
  //    Fin effective = ends_at si présent, sinon starts_at (événement d'un jour).
  const { data: expired, error: selErr } = await admin
    .from('events')
    .select('id')
    .or(`ends_at.lt.${cutoff},and(ends_at.is.null,starts_at.lt.${cutoff})`)
  if (selErr) return json({ error: 'select: ' + selErr.message }, 500)

  const ids = (expired ?? []).map((e: { id: string }) => e.id)
  if (!ids.length) return json({ purged: 0, files_removed: 0 })

  // 2) Récupérer les chemins de fichiers à supprimer (une photo → photo.webp + thumb.webp).
  const { data: photos, error: phErr } = await admin
    .from('event_photos')
    .select('storage_path')
    .in('event_id', ids)
  if (phErr) return json({ error: 'photos: ' + phErr.message }, 500)

  const files: string[] = []
  for (const p of photos ?? []) {
    const path = (p as { storage_path: string }).storage_path
    files.push(path)
    files.push(path.replace(/photo\.webp$/, 'thumb.webp'))
  }

  // 3) Supprimer les FICHIERS Storage EN PREMIER.
  let filesRemoved = 0
  if (files.length) {
    const { data: removed, error: rmErr } = await admin.storage.from(BUCKET).remove(files)
    if (rmErr) return json({ error: 'storage.remove: ' + rmErr.message }, 500)
    filesRemoved = removed?.length ?? 0
  }

  // 4) PUIS supprimer les lignes (event_photos + gems partent en cascade).
  const { error: delErr } = await admin.from('events').delete().in('id', ids)
  if (delErr) return json({ error: 'delete: ' + delErr.message }, 500)

  return json({ purged: ids.length, files_removed: filesRemoved, cutoff })
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
