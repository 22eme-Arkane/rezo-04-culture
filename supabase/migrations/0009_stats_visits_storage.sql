-- =============================================================================
-- Armana — Migration 0009 : statistiques admin, suivi des visites,
--                           et correctif des politiques Storage
-- =============================================================================
-- Trois sujets :
--
-- A. CORRECTIF STORAGE (important).
--    La migration 0008 a supprimé event_photos_read_public pour fermer
--    l'ÉNUMÉRATION publique du bucket. Effet de bord : il ne reste PLUS AUCUNE
--    politique SELECT sur storage.objects pour ce bucket. Or l'API Storage
--    supprime/remplace un fichier avec un DELETE/UPDATE ... RETURNING, et en
--    PostgreSQL RETURNING exige le droit de LECTURE sur la ligne. Résultat :
--    remplacer ou supprimer la photo d'un événement pouvait échouer.
--    On rétablit donc une lecture STRICTEMENT CADRÉE (son propre dossier, ou
--    admin) : les anonymes n'ont toujours aucun accès, donc l'alerte
--    « Public Bucket Allows Listing » reste corrigée. L'affichage des photos,
--    lui, passe par les URLs publiques /object/public/… et ne dépend d'aucune
--    politique.
--    On ajoute aussi les droits admin nécessaires à la purge des mois passés.
--
-- B. SUIVI DES VISITES (app_visits) : une ligne par utilisateur et par jour.
--    Volume ridicule (1 ligne/utilisateur/jour), permet un vrai historique de
--    fréquentation sans service tiers ni coût.
--
-- C. admin_stats() : toutes les statistiques en UN seul appel, réservé aux
--    admins, pour le tableau de bord.
--
-- Fuseau : tout est calculé en Europe/Paris (la base tourne en UTC ; sans cela
-- une « journée » basculerait à 2 h du matin).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Storage : lecture cadrée + droits admin
-- ---------------------------------------------------------------------------
drop policy if exists event_photos_select_own_or_admin on storage.objects;
create policy event_photos_select_own_or_admin
  on storage.objects for select
  using (
    bucket_id = 'event-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

-- Un admin doit pouvoir supprimer la photo de n'importe quel événement
-- (modération + purge des mois passés), pas seulement les siennes.
drop policy if exists event_photos_delete_admin on storage.objects;
create policy event_photos_delete_admin
  on storage.objects for delete
  using (bucket_id = 'event-photos' and public.is_admin());

drop policy if exists event_photos_update_admin on storage.objects;
create policy event_photos_update_admin
  on storage.objects for update
  using (bucket_id = 'event-photos' and public.is_admin());

-- ---------------------------------------------------------------------------
-- B. Fréquentation : une ligne par utilisateur et par jour
-- ---------------------------------------------------------------------------
create table if not exists public.app_visits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day     date not null default ((now() at time zone 'Europe/Paris')::date),
  primary key (user_id, day)
);

create index if not exists app_visits_day_idx on public.app_visits (day);

alter table public.app_visits enable row level security;

drop policy if exists app_visits_insert_own on public.app_visits;
create policy app_visits_insert_own
  on public.app_visits for insert
  with check (user_id = auth.uid());

drop policy if exists app_visits_select_own_or_admin on public.app_visits;
create policy app_visits_select_own_or_admin
  on public.app_visits for select
  using (user_id = auth.uid() or public.is_admin());

grant select, insert on public.app_visits to authenticated;

-- Enregistre le passage du jour. Idempotent : appelable à chaque lancement.
create or replace function public.record_visit()
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.app_visits (user_id, day)
  select auth.uid(), (now() at time zone 'Europe/Paris')::date
  where auth.uid() is not null
  on conflict do nothing;
$$;

revoke execute on function public.record_visit() from public, anon;
grant execute on function public.record_visit() to authenticated;

-- ---------------------------------------------------------------------------
-- C. Tableau de bord : toutes les statistiques en un appel (admin uniquement)
-- ---------------------------------------------------------------------------
create or replace function public.admin_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  paris_now timestamptz := now();
  month_start timestamptz := (date_trunc('month', (now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris');
  today date := (now() at time zone 'Europe/Paris')::date;
  result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;

  select jsonb_build_object(
    'generated_at', paris_now,
    'month_start', month_start,

    'membres', (
      select jsonb_build_object(
        'total',   count(*)::int,
        'admins',  count(*) filter (where role = 'admin')::int,
        'new_7j',  count(*) filter (where created_at >= paris_now - interval '7 days')::int,
        'new_30j', count(*) filter (where created_at >= paris_now - interval '30 days')::int
      )
      from public.profiles
    ),

    'connexions', (
      select jsonb_build_object(
        'actifs_24h',       count(*) filter (where last_sign_in_at >= paris_now - interval '24 hours')::int,
        'actifs_7j',        count(*) filter (where last_sign_in_at >= paris_now - interval '7 days')::int,
        'actifs_30j',       count(*) filter (where last_sign_in_at >= paris_now - interval '30 days')::int,
        'jamais_connectes', count(*) filter (where last_sign_in_at is null)::int,
        'emails_confirmes', count(*) filter (where email_confirmed_at is not null)::int
      )
      from auth.users
    ),

    'visites', (
      select jsonb_build_object(
        'aujourdhui', count(*) filter (where day = today)::int,
        'hier',       count(*) filter (where day = today - 1)::int,
        'uniques_7j', count(distinct user_id) filter (where day >= today - 6)::int,
        'uniques_30j',count(distinct user_id) filter (where day >= today - 29)::int,
        'par_jour', (
          select coalesce(jsonb_agg(to_jsonb(t) order by t.label), '[]'::jsonb)
          from (
            select day::text as label, count(*)::int as n
            from public.app_visits
            where day >= today - 29
            group by 1
          ) t
        )
      )
      from public.app_visits
    ),

    'evenements', (
      select jsonb_build_object(
        'total',     count(*)::int,
        'approuves', count(*) filter (where status = 'approved')::int,
        'en_attente',count(*) filter (where status = 'pending')::int,
        'rejetes',   count(*) filter (where status = 'rejected')::int,
        'a_venir',   count(*) filter (where coalesce(ends_at, starts_at) >= paris_now)::int,
        'payants',   count(*) filter (where is_paid)::int,
        'new_7j',    count(*) filter (where created_at >= paris_now - interval '7 days')::int,
        'new_30j',   count(*) filter (where created_at >= paris_now - interval '30 days')::int,
        'a_purger',  count(*) filter (where coalesce(ends_at, starts_at) < month_start)::int
      )
      from public.events
    ),

    'par_categorie', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]'::jsonb)
      from (
        select coalesce(nullif(category, ''), 'Non classé') as label, count(*)::int as n
        from public.events
        group by 1
      ) t
    ),

    'par_mois', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.label), '[]'::jsonb)
      from (
        select to_char(starts_at at time zone 'Europe/Paris', 'YYYY-MM') as label,
               count(*)::int as n
        from public.events
        where starts_at >= month_start - interval '5 months'
        group by 1
      ) t
    ),

    'top_auteurs', (
      select coalesce(jsonb_agg(to_jsonb(t) order by t.n desc), '[]'::jsonb)
      from (
        select coalesce(p.display_name, 'Anonyme') as label, count(*)::int as n
        from public.events e
        join public.profiles p on p.id = e.created_by
        group by 1
        order by 2 desc
        limit 8
      ) t
    ),

    'favoris', (
      select jsonb_build_object('total', count(*)::int) from public.gems
    ),

    'photos', (
      select jsonb_build_object('total', count(*)::int) from public.event_photos
    ),

    'retours', (
      select jsonb_build_object(
        'total', count(*)::int,
        'bugs',  count(*) filter (where type = 'bug')::int,
        'avis',  count(*) filter (where type = 'avis')::int
      )
      from public.feedback
    )
  )
  into result;

  return result;
end;
$$;

revoke execute on function public.admin_stats() from public, anon;
grant execute on function public.admin_stats() to authenticated;

-- ---------------------------------------------------------------------------
-- Aide à la purge : chemins des photos appartenant aux MOIS RÉVOLUS.
-- L'app (côté admin) supprime d'abord ces FICHIERS, puis les lignes — un simple
-- DELETE SQL ne libérerait pas le Storage.
-- ---------------------------------------------------------------------------
create or replace function public.expired_events_before_month()
returns table (id uuid, storage_path text)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, p.storage_path
  from public.events e
  left join public.event_photos p on p.event_id = e.id
  where coalesce(e.ends_at, e.starts_at)
        < (date_trunc('month', (now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris')
    and public.is_admin();
$$;

revoke execute on function public.expired_events_before_month() from public, anon;
grant execute on function public.expired_events_before_month() to authenticated;

-- ---------------------------------------------------------------------------
-- D. Garde-fous d'abus (ouverture à ~1000 personnes)
-- ---------------------------------------------------------------------------

-- D1. Bucket : plafonner la taille et n'accepter que des images.
--     Sans cela, n'importe quel compte peut pousser des fichiers de 50 Mo de
--     n'importe quel type avec la clé publique et saturer le Go gratuit.
--     3 Mo est très large : le client envoie du WebP compressé (~250 Ko).
update storage.buckets
   set file_size_limit = 3145728,
       allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png']
 where id = 'event-photos';

-- D2. profiles : fermer l'annuaire des membres aux anonymes.
--     La politique RLS reste `using (true)` (nécessaire pour afficher le nom de
--     l'auteur d'un événement), mais on restreint les COLONNES accessibles.
--     is_admin() est SECURITY DEFINER : elle continue de lire `role` sans souci.
revoke select on public.profiles from anon, authenticated;
grant select (id, display_name) on public.profiles to anon, authenticated;
grant select (role) on public.profiles to authenticated; -- lu pour SON propre profil

-- La liste complète des membres passe désormais par une RPC réservée aux admins.
create or replace function public.list_members()
returns table (id uuid, display_name text, role text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;
  return query
    select p.id, p.display_name, p.role, p.created_at
    from public.profiles p
    order by p.created_at desc;
end;
$$;

revoke execute on function public.list_members() from public, anon;
grant execute on function public.list_members() to authenticated;

-- D3. Escalade de privilèges à l'INSERT : le trigger de garde ne couvrait que
--     l'UPDATE. Un compte pouvait donc créer sa ligne profiles directement en
--     role='admin' si le trigger d'inscription n'était pas passé avant lui.
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self
  on public.profiles for insert
  with check (id = auth.uid() and role = 'user');

-- D4. Limite de publication : 10 événements par heure et par compte, pour
--     qu'un seul utilisateur ne puisse pas noyer la file de modération.
create or replace function public.create_event(
  p_title       text,
  p_description text,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_is_paid     boolean,
  p_price       numeric,
  p_lat         double precision,
  p_lng         double precision,
  p_address     text,
  p_category    text
)
returns public.events
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_row public.events;
  recent  int;
begin
  select count(*) into recent
  from public.events
  where created_by = auth.uid()
    and created_at > now() - interval '1 hour';

  if recent >= 10 then
    raise exception 'Limite atteinte : 10 événements par heure. Réessayez un peu plus tard.';
  end if;

  insert into public.events (
    created_by, title, description, starts_at, ends_at,
    is_paid, price, location, address, category, status
  ) values (
    auth.uid(), p_title, nullif(p_description, ''), p_starts_at, p_ends_at,
    coalesce(p_is_paid, false),
    case when coalesce(p_is_paid, false) then p_price else null end,
    case when p_lat is null or p_lng is null then null
         else ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography end,
    nullif(p_address, ''), nullif(p_category, ''), 'pending'
  )
  returning * into new_row;
  return new_row;
end;
$$;

-- D5. Cohérence des données côté base (le client valide déjà, mais l'API est
--     ouverte : la base doit rester la source de vérité).
do $$
begin
  alter table public.events
    add constraint events_dates_coherentes
    check (ends_at is null or ends_at >= starts_at) not valid;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.events
    add constraint events_title_len
    check (length(title) between 2 and 160) not valid;
exception when duplicate_object then null;
end $$;

-- =============================================================================
-- Fin de migration 0009
-- =============================================================================
