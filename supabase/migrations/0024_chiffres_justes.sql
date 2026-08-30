-- =============================================================================
-- Armana — Migration 0024 : deux chiffres du tableau de bord qui mentaient
-- =============================================================================
-- ⚠ À APPLIQUER APRÈS LES 0019 À 0023.
--
-- Issu de l'audit du tableau de bord (28 août 2026). Deux fonctions courtes
-- plutôt qu'une réécriture d'admin_stats : celle-ci fait deux cents lignes, la
-- réémettre pour changer deux expressions risquerait d'en perdre une autre.
--
-- 1. « ÉVÉNEMENTS À VENIR » COMPTAIT LES REJETÉS
--    `a_venir` ne filtrait pas sur le statut : les événements en attente et
--    même REJETÉS y figuraient. Le graphique « par département » juste en
--    dessous, lui, ne montre que les approuvés. La somme des barres était donc
--    fatalement inférieure au grand chiffre, sans que rien ne l'explique.
--    « À venir » doit vouloir dire ce que le public voit : approuvé.
--
-- 2. « EN ATTENTE » IGNORAIT LA ZONE DU MODÉRATEUR
--    La tuile comptait tout le territoire, alors que le bouton juste dessous
--    mène à une file cloisonnée par département : un modérateur du 04 lisait 7
--    et n'en trouvait que 3. `my_pending_count()` existe déjà et applique
--    can_moderate() — c'est elle qu'il faut lire. Rien à créer côté base ;
--    corrigé côté écran. (Noté ici pour la trace.)
-- =============================================================================

create or replace function public.events_upcoming_published()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_admin() then (
    select count(*)::int
    from public.events e
    where e.status = 'approved'
      and coalesce(e.ends_at, e.starts_at) >= now()
  ) end;
$$;

revoke execute on function public.events_upcoming_published() from public, anon;
grant execute on function public.events_upcoming_published() to authenticated;

comment on function public.events_upcoming_published() is
  'Événements APPROUVÉS et non terminés — ce que le public voit réellement. '
  'admin_stats.evenements.a_venir, lui, compte tous les statuts : les deux '
  'chiffres diffèrent volontairement, et l''écran affiche celui-ci.';

-- -----------------------------------------------------------------------------
-- Date de début de mesure de la fréquentation
-- -----------------------------------------------------------------------------
-- ⚠ C'est LE chiffre manquant qui a rendu l'écran incompréhensible. « Depuis le
-- début » ne veut pas dire depuis la création d'Armana mais depuis la mise en
-- service de la mesure — fin juillet 2026. Soit à peu près la même période que
-- le « 30 jours » affiché juste à côté, ce qui rend l'écart entre les deux non
-- seulement normal mais inévitable. admin_stats renvoie déjà cette date dans
-- `visites.depuis`, mais l'écran ne l'affichait nulle part.
create or replace function public.visits_since()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_admin() then
    least(
      (select min(day) from public.app_visits),
      (select min(day) from public.anon_visits)
    )
  end;
$$;

revoke execute on function public.visits_since() from public, anon;
grant execute on function public.visits_since() to authenticated;

-- -----------------------------------------------------------------------------
-- Vérification — tout doit être vrai
-- -----------------------------------------------------------------------------
select
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname='public' and p.proname='events_upcoming_published')   as fonction_evenements_publies,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname='public' and p.proname='visits_since')                as fonction_debut_mesure,
  -- L'écart que Matthieu constatait, rendu visible : le grand chiffre d'avant
  -- contre le chiffre juste. S'ils diffèrent, c'est bien qu'on comptait des
  -- rejetés.
  (select count(*)::int from public.events
    where coalesce(ends_at, starts_at) >= now())                                 as a_venir_tous_statuts,
  (select count(*)::int from public.events
    where status = 'approved' and coalesce(ends_at, starts_at) >= now())         as a_venir_publies_seulement,
  (select least((select min(day) from public.app_visits),
                (select min(day) from public.anon_visits)))                      as mesure_commencee_le;

-- =============================================================================
-- Fin de migration 0024
-- =============================================================================
