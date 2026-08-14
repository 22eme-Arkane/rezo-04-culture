-- =============================================================================
-- Armana — Migration 0018 : nombre total de visiteurs depuis le début
-- =============================================================================
-- Les chiffres existants sont tous glissants (7 ou 30 jours). Il manquait le
-- cumul : combien de personnes différentes ont ouvert Armana depuis que la
-- mesure existe, inscrites ou non.
--
-- ⚠ CE QUE CE NOMBRE EST, ET CE QU'IL N'EST PAS
-- C'est la somme de deux comptages distincts : les membres vus au moins une
-- fois, et les visiteurs sans compte vus au moins une fois. Quelqu'un qui a
-- d'abord visité sans compte PUIS créé le sien compte donc pour deux. C'est
-- un majorant, pas un dénombrement de personnes physiques — impossible à
-- obtenir sans identifier les gens, ce qu'on ne fait pas.
--
-- Et « depuis le début » signifie depuis le début de la MESURE (fin juillet
-- 2026 pour les membres, 2 août 2026 pour les visiteurs sans compte), pas
-- depuis la création de l'application. La date est déjà exposée par `depuis`,
-- et l'écran l'affiche.
-- =============================================================================

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
        -- NOUVEAU : membres différents vus au moins une fois, sans limite de date.
        'uniques_total', count(distinct user_id)::int,
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
        -- NOUVEAU : visiteurs sans compte différents, sans limite de date.
        'uniques_total', count(distinct visitor)::int,
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
-- Vérification — doit afficher « true »
-- -----------------------------------------------------------------------------
-- ⚠ Ne PAS appeler admin_stats() : elle exige un administrateur, or le SQL
-- Editor s'exécute sans utilisateur connecté, et l'exception annulerait toute
-- la migration. On inspecte son code source.
select (
  select pg_get_functiondef(p.oid) like '%uniques_total%'
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_stats'
) as total_visiteurs_ajoute;

-- =============================================================================
-- Fin de migration 0018
-- =============================================================================
