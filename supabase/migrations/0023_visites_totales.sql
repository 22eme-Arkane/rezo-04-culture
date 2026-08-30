-- =============================================================================
-- Armana — Migration 0023 : le nombre TOTAL de visites, et non plus seulement
--                           le nombre de visiteurs uniques
-- =============================================================================
-- ⚠ À APPLIQUER APRÈS LES 0019 À 0022.
--
-- LE PROBLÈME
-- `app_visits` et `anon_visits` ont pour clé primaire (personne, jour) : une
-- SEULE ligne par personne et par jour. Revenir trois fois dans la journée ne
-- laissait donc aucune trace — l'information n'existait pas en base.
--
-- LA SOLUTION, ET POURQUOI CELLE-CI
-- Un COMPTEUR sur la ligne du jour, incrémenté à chaque passage. L'autre voie
-- — une table où chaque visite ajoute une ligne — aurait grossi sans limite :
-- avec un millier d'utilisateurs revenant chaque jour, c'est un demi-million
-- de lignes par an, pour un projet qui doit rester dans une offre gratuite.
-- Ici, le volume ne bouge pas : on n'ajoute qu'un entier par ligne existante.
--
-- ⚠ LES LIGNES DÉJÀ EN BASE comptent pour 1 passage. C'est la vérité de ce
-- qu'on a mesuré : avant aujourd'hui, personne ne comptait les retours. Le
-- total sera donc juste à partir de maintenant, et légèrement sous-estimé pour
-- le passé — mieux vaut cela qu'un chiffre inventé.
-- =============================================================================

alter table public.app_visits  add column if not exists passages int not null default 1;
alter table public.anon_visits add column if not exists passages int not null default 1;

comment on column public.app_visits.passages is
  'Nombre d''ouvertures de l''application par ce membre ce jour-là. '
  'Les lignes antérieures à la migration 0023 valent 1 : les retours '
  'n''étaient pas comptés avant.';

-- -----------------------------------------------------------------------------
-- Les deux RPC incrémentent désormais au lieu d'ignorer le doublon
-- -----------------------------------------------------------------------------
create or replace function public.record_visit(p_dept text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.app_visits (user_id, day, dept, passages)
  select auth.uid(),
         (now() at time zone 'Europe/Paris')::date,
         case when p_dept in ('04','05','13','26','83','84') then p_dept end,
         1
  where auth.uid() is not null
  -- ⚠ Cible EXPLICITE : `on conflict do nothing` tout court ne permet pas de
  -- mettre à jour. C'est ce « do nothing » qui faisait perdre les retours.
  on conflict (user_id, day) do update
    set passages = public.app_visits.passages + 1,
        -- Le premier département observé dans la journée gagne : quelqu'un qui
        -- traverse deux départements ne réécrit pas sa ligne à chaque ouverture.
        dept = coalesce(public.app_visits.dept, excluded.dept);
$$;

revoke execute on function public.record_visit(text) from public, anon;
grant execute on function public.record_visit(text) to authenticated;

create or replace function public.record_anon_visit(p_visitor text, p_dept text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.anon_visits (visitor, day, dept, passages)
  select p_visitor,
         (now() at time zone 'Europe/Paris')::date,
         case when p_dept in ('04','05','13','26','83','84') then p_dept end,
         1
  where auth.uid() is null
    and p_visitor ~ '^[0-9a-f]{32}$'
  on conflict (visitor, day) do update
    set passages = public.anon_visits.passages + 1,
        dept = coalesce(public.anon_visits.dept, excluded.dept);
$$;

revoke execute on function public.record_anon_visit(text, text) from public;
grant execute on function public.record_anon_visit(text, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Le total, dans une petite fonction dédiée
-- -----------------------------------------------------------------------------
-- ⚠ Volontairement SÉPARÉE d'admin_stats. Cette dernière fait deux cents
-- lignes ; la réémettre en entier pour y ajouter un champ, c'est risquer d'en
-- laisser tomber un autre au passage. Un appel de plus ne coûte rien.
create or replace function public.visits_total()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_admin() then
    coalesce((select sum(passages) from public.app_visits), 0)
    + coalesce((select sum(passages) from public.anon_visits), 0)
  end;
$$;

revoke execute on function public.visits_total() from public, anon;
grant execute on function public.visits_total() to authenticated;

-- -----------------------------------------------------------------------------
-- Vérification — tout doit être vrai
-- -----------------------------------------------------------------------------
-- ⚠ N'appelle aucune fonction réservée (le SQL Editor n'a pas d'utilisateur).
select
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='app_visits'
             and column_name='passages')                                         as compteur_membres,
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='anon_visits'
             and column_name='passages')                                         as compteur_anonymes,
  (select pg_get_functiondef(p.oid) like '%passages + 1%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='record_visit')                       as les_retours_sont_comptes,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname='public' and p.proname='visits_total')                as fonction_total,
  (select count(*) from public.app_visits) + (select count(*) from public.anon_visits)
                                                                                 as lignes_existantes;

-- =============================================================================
-- Fin de migration 0023
-- =============================================================================
