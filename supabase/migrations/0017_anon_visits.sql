-- =============================================================================
-- Armana — Migration 0017 : compter aussi les visiteurs non inscrits
-- =============================================================================
-- CE QUI N'ALLAIT PAS
-- `record_visit()` (migration 0009) porte un `where auth.uid() is not null` :
-- seuls les inscrits CONNECTÉS étaient comptés. Quelqu'un qui ouvre l'agenda
-- sans compte — le cas le plus fréquent — n'apparaissait nulle part.
--
-- Et deux séries incohérentes étaient présentées côte à côte :
--   * « Visiteurs uniques » vient de app_visits, qui ne collecte que depuis la
--     migration 0009 (fin juillet 2026) ;
--   * « Connectés » vient de auth.users.last_sign_in_at, qui remonte à la
--     création de chaque compte.
-- D'où des « connectés sur 7 jours » supérieurs aux « visiteurs sur 30 jours »,
-- ce qui donnait l'impression que le tableau de bord était faux. Il ne l'était
-- pas : il comparait deux choses différentes sans le dire. On expose donc
-- désormais la date de début de mesure.
--
-- VIE PRIVÉE
-- Le visiteur anonyme est identifié par un nombre aléatoire tiré par son
-- navigateur, sans aucun lien avec une personne, une adresse ou un appareil.
-- Il ne sert qu'à ne pas compter dix fois la même visite dans la journée. Rien
-- n'est partagé avec un tiers ; il n'y a pas de suivi entre sites.
-- =============================================================================

create table if not exists public.anon_visits (
  visitor text not null,
  day     date not null default ((now() at time zone 'Europe/Paris')::date),
  primary key (visitor, day)
);

create index if not exists anon_visits_day_idx on public.anon_visits (day);

alter table public.anon_visits enable row level security;
-- Aucune politique, tous droits révoqués : l'écriture passe uniquement par la
-- fonction ci-dessous, la lecture uniquement par admin_stats.
revoke all on public.anon_visits from anon, authenticated;

create or replace function public.record_anon_visit(p_visitor text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.anon_visits (visitor, day)
  select p_visitor, (now() at time zone 'Europe/Paris')::date
  -- Uniquement les non-connectés : un inscrit est déjà compté par record_visit,
  -- il serait sinon compté deux fois.
  where auth.uid() is null
    -- Format imposé : sans cela, n'importe qui pourrait remplir la table de
    -- valeurs arbitraires et gonfler le nombre de visiteurs.
    and p_visitor ~ '^[0-9a-f]{32}$'
  on conflict do nothing;
$$;

revoke execute on function public.record_anon_visit(text) from public;
grant execute on function public.record_anon_visit(text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- admin_stats : visites anonymes + date de début de mesure
-- -----------------------------------------------------------------------------
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
        -- Depuis quand la mesure existe : sans cette date, un « 30 jours » qui
        -- n'a que deux jours de données passe pour une anomalie.
        'depuis',     min(day)::text,
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

    'visites_anonymes', (
      select jsonb_build_object(
        'aujourdhui', count(*) filter (where day = today)::int,
        'hier',       count(*) filter (where day = today - 1)::int,
        'uniques_7j', count(distinct visitor) filter (where day >= today - 6)::int,
        'uniques_30j',count(distinct visitor) filter (where day >= today - 29)::int,
        'depuis',     min(day)::text,
        'par_jour', (
          select coalesce(jsonb_agg(to_jsonb(t) order by t.label), '[]'::jsonb)
          from (
            select day::text as label, count(*)::int as n
            from public.anon_visits
            where day >= today - 29
            group by 1
          ) t
        )
      )
      from public.anon_visits
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

-- -----------------------------------------------------------------------------
-- Vérification — doit afficher « true » partout
-- -----------------------------------------------------------------------------
-- ⚠ Ne PAS appeler admin_stats() ici : elle exige un administrateur, or le SQL
-- Editor s'exécute sans utilisateur connecté. L'exception ferait échouer toute
-- la migration, qui serait annulée en bloc. On inspecte donc son code source.
select
  exists (select 1 from information_schema.tables
           where table_schema='public' and table_name='anon_visits')            as table_visiteurs,
  exists (select 1 from information_schema.routines
           where routine_schema='public' and routine_name='record_anon_visit')  as fonction_enregistrement,
  (select pg_get_functiondef(p.oid) like '%visites_anonymes%'
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_stats')                   as stats_enrichies;

-- =============================================================================
-- Fin de migration 0017
-- =============================================================================
