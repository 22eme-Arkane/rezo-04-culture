-- =============================================================================
-- Armana — Migration 0015 : notifications (abonnements + préférences)
-- =============================================================================
-- Technologie : Web Push (norme du navigateur, clés VAPID). Entièrement
-- GRATUIT, aucun service tiers payant, conformément à la contrainte du projet.
--
-- TOUT EST DÉSACTIVÉ PAR DÉFAUT. `notif_prefs` vaut '{}' : une clé absente
-- signifie « non ». Personne ne reçoit quoi que ce soit sans l'avoir demandé,
-- et le navigateur exige de toute façon une autorisation explicite.
--
-- Deux notions distinctes, volontairement séparées :
--   * l'ABONNEMENT (push_subscriptions) = un appareil donné, avec ses clés de
--     chiffrement. Une même personne peut en avoir plusieurs (téléphone,
--     ordinateur) et en perdre (réinstallation, cache vidé) ;
--   * les PRÉFÉRENCES (profiles.notif_prefs) = ce que la personne veut
--     recevoir. Elles la suivent sur tous ses appareils.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Abonnements des appareils
-- -----------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  endpoint   text primary key,             -- identifiant unique fourni par le navigateur
  user_id    uuid not null references public.profiles(id) on delete cascade,
  p256dh     text not null,                -- clés de chiffrement du navigateur
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  failures   int not null default 0        -- envois échoués d'affilée (nettoyage)
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Chacun ne voit et ne gère QUE ses propres appareils. Aucun administrateur n'a
-- besoin de lire ces lignes : l'envoi se fait côté serveur, en service_role.
drop policy if exists push_own_select on public.push_subscriptions;
create policy push_own_select on public.push_subscriptions
  for select using (user_id = auth.uid());

drop policy if exists push_own_insert on public.push_subscriptions;
create policy push_own_insert on public.push_subscriptions
  for insert with check (user_id = auth.uid());

drop policy if exists push_own_update on public.push_subscriptions;
create policy push_own_update on public.push_subscriptions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists push_own_delete on public.push_subscriptions;
create policy push_own_delete on public.push_subscriptions
  for delete using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- B. Préférences
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists notif_prefs jsonb not null default '{}'::jsonb;

comment on column public.profiles.notif_prefs is
  'Types de notifications souhaités. Clé absente ou false = non. '
  'Clés : moderation, messages (administrateurs) ; nouveaux_evenements (tous).';

-- ⚠ La colonne n'est PAS ouverte en lecture directe : la RLS de profiles est
-- `using (true)`, un GRANT exposerait les préférences de tout le monde. On
-- passe par des fonctions qui ne touchent que sa propre ligne.
create or replace function public.my_notif_prefs()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(
    (select p.notif_prefs from public.profiles p where p.id = auth.uid()),
    '{}'::jsonb
  );
$$;

revoke execute on function public.my_notif_prefs() from public, anon;
grant execute on function public.my_notif_prefs() to authenticated;

create or replace function public.set_notif_prefs(p_prefs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  propre jsonb := '{}'::jsonb;
  cle    text;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise';
  end if;
  if p_prefs is null or jsonb_typeof(p_prefs) <> 'object' then
    raise exception 'Préférences invalides';
  end if;

  -- Liste blanche : on n'enregistre que les clés connues, en booléen. Un client
  -- ne peut donc pas gonfler cette colonne avec n'importe quoi.
  foreach cle in array array['moderation', 'messages', 'nouveaux_evenements'] loop
    if coalesce((p_prefs ->> cle)::boolean, false) then
      propre := propre || jsonb_build_object(cle, true);
    end if;
  end loop;

  update public.profiles set notif_prefs = propre where id = auth.uid();
  return propre;
end;
$$;

revoke execute on function public.set_notif_prefs(jsonb) from public, anon;
grant execute on function public.set_notif_prefs(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- C. Enregistrement d'un appareil
-- -----------------------------------------------------------------------------
-- Le navigateur peut renvoyer le même endpoint après réinstallation : on met à
-- jour plutôt que d'échouer, et on remet le compteur d'échecs à zéro.
create or replace function public.save_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Connexion requise';
  end if;
  if coalesce(p_endpoint, '') = '' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Abonnement incomplet';
  end if;

  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth, user_agent)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update
    set user_id    = excluded.user_id,
        p256dh     = excluded.p256dh,
        auth       = excluded.auth,
        user_agent = excluded.user_agent,
        failures   = 0;
end;
$$;

revoke execute on function public.save_push_subscription(text, text, text, text)
  from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text)
  to authenticated;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_subscriptions
   where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke execute on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

-- -----------------------------------------------------------------------------
-- D. File d'attente des notifications à envoyer
-- -----------------------------------------------------------------------------
-- La base ne sait pas parler à un service de push (il faut signer un jeton
-- VAPID). Elle DÉPOSE donc les notifications ici, et la fonction serveur les
-- consomme. Avantage : si l'envoi n'est pas encore déployé, rien n'est perdu ni
-- cassé — la file se remplit simplement sans être vidée.
create table if not exists public.notification_queue (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  kind       text not null,        -- moderation | messages | nouveaux_evenements
  title      text not null,
  body       text not null,
  url        text,
  sent_at    timestamptz
);

create index if not exists notification_queue_pending_idx
  on public.notification_queue (created_at) where sent_at is null;

alter table public.notification_queue enable row level security;
-- Aucune politique, tous droits révoqués : ni lecture ni écriture depuis un
-- client. Les triggers ci-dessous sont SECURITY DEFINER, la fonction d'envoi
-- utilise la clé de service.
revoke all on public.notification_queue from anon, authenticated;
revoke all on sequence public.notification_queue_id_seq from anon, authenticated;

-- -----------------------------------------------------------------------------
-- E. Ce qui déclenche une notification
-- -----------------------------------------------------------------------------
create or replace function public.enqueue_event_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Nouvel événement à modérer (pour les administrateurs).
  if tg_op = 'INSERT' and new.status = 'pending' then
    insert into public.notification_queue (kind, title, body, url)
    values ('moderation', 'Un événement à valider',
            left(new.title, 120), '/#/moderation');

  -- Événement publié (pour tout le monde). On ne notifie qu'au PASSAGE à
  -- approuvé : une modification ultérieure ne doit pas re-sonner.
  elsif tg_op = 'UPDATE'
        and new.status = 'approved'
        and old.status is distinct from 'approved' then
    insert into public.notification_queue (kind, title, body, url)
    values ('nouveaux_evenements', 'Nouvel événement dans l’agenda',
            left(new.title, 120), '/#/evenement?id=' || new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists enqueue_event_notification_trg on public.events;
create trigger enqueue_event_notification_trg
  after insert or update on public.events
  for each row execute function public.enqueue_event_notification();

create or replace function public.enqueue_feedback_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_queue (kind, title, body, url)
  values ('messages', 'Nouveau message reçu', left(coalesce(new.message, ''), 120), '/#/messages');
  return new;
end;
$$;

drop trigger if exists enqueue_feedback_notification_trg on public.feedback;
create trigger enqueue_feedback_notification_trg
  after insert on public.feedback
  for each row execute function public.enqueue_feedback_notification();

-- -----------------------------------------------------------------------------
-- Vérification — doit afficher « true » partout
-- -----------------------------------------------------------------------------
select
  exists (select 1 from information_schema.tables
           where table_schema='public' and table_name='push_subscriptions')   as table_abonnements,
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='profiles'
             and column_name='notif_prefs')                                   as colonne_preferences,
  exists (select 1 from information_schema.tables
           where table_schema='public' and table_name='notification_queue')   as file_attente,
  exists (select 1 from information_schema.routines
           where routine_schema='public' and routine_name='set_notif_prefs')  as fonction_preferences;

-- =============================================================================
-- Fin de migration 0015
-- =============================================================================
