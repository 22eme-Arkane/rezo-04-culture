# Edge Functions — Armana

## `purge-expired` — purge quotidienne des événements terminés

Supprime les événements terminés depuis plus de `PURGE_GRACE_DAYS` (défaut 2 jours) :
**d'abord les fichiers du bucket Storage** (`photo.webp` + `thumb.webp`), **puis** les
lignes en base (`event_photos` et `gems` partent en cascade).

### Déploiement

Nécessite la CLI Supabase (`npm i -g supabase`), connectée au projet (`supabase link`).

```bash
supabase functions deploy purge-expired
```

La fonction reçoit automatiquement `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY`
(secrets injectés côté serveur — jamais exposés au client). Pour changer le délai :

```bash
supabase secrets set PURGE_GRACE_DAYS=3
```

### Planification (cron quotidien)

Dans le **SQL Editor** du dashboard, activer les extensions puis planifier l'appel
(remplacer `<PROJECT_REF>` et utiliser la clé service_role stockée dans Vault) :

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Tous les jours à 04:00 UTC.
select cron.schedule(
  'purge-expired-daily',
  '0 4 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/purge-expired',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    )
  );
  $$
);
```

> Stocker la clé service_role dans Vault (`select vault.create_secret('<KEY>', 'service_role_key');`)
> — **jamais en clair** dans le SQL ni le repo.

### Test manuel

```bash
curl -X POST 'https://<PROJECT_REF>.supabase.co/functions/v1/purge-expired' \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>"
```

Réponse : `{ "purged": <n>, "files_removed": <n>, "cutoff": "..." }`.
