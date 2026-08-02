-- =============================================================================
-- Armana — Migration 0016 : envoi automatique des notifications
-- =============================================================================
-- ⚠ UNE SEULE LIGNE À MODIFIER AVANT D'EXÉCUTER : voir « À REMPLIR » ci-dessous.
--
-- CE QUE FAIT CETTE MIGRATION
-- Jusqu'ici, il fallait déclencher l'envoi à la main. Désormais la base regarde
-- toutes les minutes s'il y a quelque chose à envoyer et appelle elle-même la
-- fonction serveur.
--
-- ÉCONOMIE DU QUOTA GRATUIT — le point important
-- On n'appelle PAS la fonction chaque minute : on vérifie d'abord, en SQL (ce
-- qui ne coûte rien), si la file contient quelque chose. Un appel par minute
-- ferait 43 000 invocations par mois, soit près de 9 % du quota gratuit pour
-- ne rien faire. Là, on ne consomme qu'à chaque notification réelle.
--
-- SÉCURITÉ
-- La fonction d'envoi était appelable par quiconque disposait de la clé
-- publique de l'application (elle est dans le bundle, donc lisible par tous).
-- Le risque n'était pas la fuite de données — la réponse ne contient que des
-- compteurs — mais l'épuisement du quota gratuit. On ajoute donc un secret
-- partagé entre la base et la fonction, généré ici même.
-- =============================================================================

-- Si ces deux lignes échouent (« permission denied to create extension »),
-- activez-les d'abord dans le Dashboard Supabase → Database → Extensions :
-- cherchez « pg_cron » puis « pg_net », activez les deux, et relancez ce
-- fichier. C'est le seul obstacle courant de cette migration.
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- -----------------------------------------------------------------------------
-- A. Réglages internes — jamais accessibles à un client
-- -----------------------------------------------------------------------------
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);

alter table public.app_config enable row level security;
-- RLS active et AUCUNE politique + tous droits révoqués : personne n'y accède
-- depuis l'application, quel que soit son rôle.
revoke all on public.app_config from anon, authenticated;

-- ⚠⚠ À REMPLIR ⚠⚠ ------------------------------------------------------------
-- Remplacez l'adresse ci-dessous par celle de VOTRE projet Supabase.
-- Où la trouver : Dashboard Supabase → Settings → API → « Project URL ».
-- Elle ressemble à https://abcdefghijkl.supabase.co
-- Gardez bien « /functions/v1/notify » à la fin.
insert into public.app_config (key, value)
values ('notify_url', 'https://VOTRE-PROJET.supabase.co/functions/v1/notify')
on conflict (key) do update set value = excluded.value;
-- -----------------------------------------------------------------------------

-- Secret partagé, généré automatiquement. Il n'est écrit nulle part ailleurs :
-- la dernière requête de ce fichier vous l'affichera une fois, pour que vous le
-- déposiez côté fonction.
insert into public.app_config (key, value)
values ('notify_key', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- B. Le déclencheur périodique
-- -----------------------------------------------------------------------------
create or replace function public.dispatch_notifications()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  url    text;
  cle    text;
  en_att int;
begin
  -- Vérification en SQL d'abord : c'est ce qui évite d'appeler la fonction
  -- serveur — et donc de consommer le quota — quand il n'y a rien à envoyer.
  select count(*) into en_att from public.notification_queue where sent_at is null;
  if en_att = 0 then
    return;
  end if;

  select value into url from public.app_config where key = 'notify_url';
  select value into cle from public.app_config where key = 'notify_key';
  if url is null or cle is null or url like '%VOTRE-PROJET%' then
    raise notice 'Armana : notify_url non renseignée, envoi ignoré.';
    return;
  end if;

  perform net.http_post(
    url     := url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-armana-key',  cle
    ),
    body    := '{}'::jsonb
  );
end;
$$;

revoke execute on function public.dispatch_notifications() from public, anon, authenticated;

-- Toutes les minutes. Le travail réel n'a lieu que si la file n'est pas vide.
select cron.unschedule('armana-push') where exists (
  select 1 from cron.job where jobname = 'armana-push'
);
select cron.schedule('armana-push', '* * * * *', 'select public.dispatch_notifications()');

-- -----------------------------------------------------------------------------
-- C. À FAIRE ENSUITE — recopiez le secret affiché ci-dessous
-- -----------------------------------------------------------------------------
--   npx supabase secrets set ARMANA_PUSH_KEY=<le secret affiché>
--   npx supabase functions deploy notify
--
-- Tant que ces deux commandes ne sont pas passées, la fonction refusera les
-- appels et les notifications resteront en file — rien n'est perdu.
-- -----------------------------------------------------------------------------
select
  (select value from public.app_config where key = 'notify_key')                as secret_a_recopier,
  (select value from public.app_config where key = 'notify_url')                as adresse_configuree,
  (select count(*) from cron.job where jobname = 'armana-push')                 as tache_planifiee;

-- =============================================================================
-- Fin de migration 0016
-- =============================================================================
