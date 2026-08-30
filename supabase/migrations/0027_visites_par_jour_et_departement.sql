-- =============================================================================
-- Migration 0027 — les graphiques comptent des VISITES, comme les tuiles
-- =============================================================================
--
-- LE PROBLÈME, constaté par Matthieu le 30/08/2026 : la tuile « Visites
-- aujourd'hui » affichait 115 pendant que le graphique du jour affichait 59
-- pour le 30 août. Les deux chiffres étaient JUSTES, mais ne comptaient pas la
-- même chose :
--
--   • les tuiles (visits_summary, migration 0025) font `sum(passages)`
--     — le nombre d'OUVERTURES de l'application ;
--   • les deux graphiques (admin_stats, migration 0019) font `count(*)`
--     — le nombre de LIGNES, soit une par visiteur et par jour, donc le
--     nombre de VISITEURS.
--
-- 59 personnes avaient ouvert Armana 115 fois. Deux unités sur un même écran,
-- sans que rien ne le dise : c'est le même défaut que l'audit du tableau de
-- bord avait déjà relevé, où les chiffres étaient bons et les mots faux.
--
-- LE CHOIX : tout l'écran parle désormais en VISITES.
--
-- ⚠ POURQUOI UNE NOUVELLE FONCTION PLUTÔT QUE MODIFIER `admin_stats` :
-- `create or replace` impose de réécrire le corps ENTIER. `admin_stats` fait
-- près de 200 lignes ; la recopier pour changer trois agrégats, c'est prendre
-- le risque d'en abîmer une autre partie — et dans l'éditeur SQL, la moindre
-- erreur annule TOUTE la migration en silence. On ajoute donc une petite
-- fonction dédiée, vérifiable d'un coup d'œil. `admin_stats` continue de
-- renvoyer ses `par_jour` / `par_departement` en visiteurs : ils ne sont
-- simplement plus lus par l'écran.
--
-- ⚠ `passages` n'existe que depuis la migration 0023, avec `default 1`. Les
-- lignes antérieures valent donc 1 : sur cette période ancienne, visites et
-- visiteurs se confondent. Les tuiles ont exactement la même limite, les deux
-- restent donc cohérentes entre elles.
-- =============================================================================

create or replace function public.visits_breakdown()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with jour as (select (now() at time zone 'Europe/Paris')::date as d),
  -- Inscrits et visiteurs sans compte comptent pareil : c'est la
  -- fréquentation de l'application, pas celle des comptes.
  toutes as (
    select day, dept, passages from public.app_visits
    union all
    select day, dept, passages from public.anon_visits
  ),
  recentes as (
    select t.day, t.dept, t.passages
    from toutes t, jour
    where t.day >= jour.d - 29
  )
  select case when public.is_admin() then jsonb_build_object(
    'par_jour', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.label), '[]'::jsonb)
      from (
        select day::text as label, sum(passages)::int as n
        from recentes
        group by 1
      ) x
    ),
    'par_departement', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.n desc), '[]'::jsonb)
      from (
        -- '—' = position non renseignée (géolocalisation refusée ou absente).
        select coalesce(dept, '—') as code, sum(passages)::int as n
        from recentes
        group by 1
      ) x
    )
  ) end;
$$;

-- Même verrouillage que visits_summary : jamais au public ni aux anonymes.
-- La fonction renvoie NULL à qui n'est pas modérateur (le `case when`).
revoke execute on function public.visits_breakdown() from public, anon;
grant execute on function public.visits_breakdown() to authenticated;

-- -----------------------------------------------------------------------------
-- Vérification — les trois doivent être vrais
-- -----------------------------------------------------------------------------
-- ⚠ N'appelle pas la fonction elle-même : l'éditeur SQL n'a pas d'utilisateur
-- connecté, `is_admin()` y serait faux et le résultat toujours NULL.
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'visits_breakdown') = 1
                                                            as fonction_creee,
  (select pg_get_functiondef(p.oid) like '%sum(passages)%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'visits_breakdown')
                                                            as compte_des_visites,
  has_function_privilege('authenticated', 'public.visits_breakdown()', 'execute')
                                                            as droit_accorde,
  -- Repère de lecture : ce que l'écran affichera pour aujourd'hui.
  (select coalesce(sum(passages), 0)
     from (select day, passages from public.app_visits
           union all
           select day, passages from public.anon_visits) t
    where day = (now() at time zone 'Europe/Paris')::date)   as visites_aujourdhui,
  (select count(*)
     from (select day from public.app_visits
           union all
           select day from public.anon_visits) t
    where day = (now() at time zone 'Europe/Paris')::date)   as visiteurs_aujourdhui;

-- =============================================================================
-- Fin de migration 0027
-- =============================================================================
