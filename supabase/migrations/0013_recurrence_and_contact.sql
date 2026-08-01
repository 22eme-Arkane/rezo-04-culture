-- =============================================================================
-- Armana — Migration 0013 : événements récurrents + contact de l'organisateur
-- =============================================================================
-- BESOIN
-- Le marché de Saint-Michel a lieu tous les vendredis, les food-trucks de
-- Dauphin tous les mercredis de l'été. Saisir vingt fois le même événement
-- n'est pas tenable.
--
-- CHOIX DE MODÉLISATION — une seule ligne, pas vingt
-- Un événement récurrent reste UN enregistrement :
--   * `starts_at` → première occurrence (et l'heure de toutes les autres) ;
--   * `ends_at`   → fin de la période de récurrence ;
--   * `recur_days`→ jours de la semaine concernés, convention JavaScript
--                   getDay() : 0 = dimanche … 6 = samedi.
--
-- L'intérêt est considérable : « visible tant que non terminé », la purge
-- mensuelle, la modération, la recherche par rayon et les favoris continuent
-- de fonctionner SANS AUCUNE modification, puisqu'ils raisonnent déjà sur
-- starts_at / ends_at. Une photo, une modération, un favori — pas vingt.
-- Seul l'affichage du calendrier doit savoir n'allumer que les bons jours.
--
-- L'alternative (créer une ligne par occurrence) aurait dupliqué la photo dans
-- le Storage autant de fois, se serait heurtée à la limite de 10 publications
-- par heure, et aurait rendu toute correction ultérieure pénible.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Colonnes
-- -----------------------------------------------------------------------------
alter table public.events
  add column if not exists recur_days smallint[],
  add column if not exists contact    text;

comment on column public.events.recur_days is
  'Jours de récurrence, convention JS getDay() : 0=dimanche … 6=samedi. '
  'NULL = événement ponctuel. Non NULL ⇒ ends_at borne la période.';
comment on column public.events.contact is
  'Lien ou contact de l''organisateur, facultatif.';

-- Contraintes en NOT VALID : les lignes existantes ne sont pas revalidées,
-- mais toute écriture future est contrôlée.
alter table public.events drop constraint if exists events_recur_days_valides;
alter table public.events
  add constraint events_recur_days_valides check (
    recur_days is null
    or (
      array_length(recur_days, 1) between 1 and 7
      and recur_days <@ array[0,1,2,3,4,5,6]::smallint[]
      -- Une récurrence sans fin remplirait le calendrier à l'infini.
      and ends_at is not null
    )
  ) not valid;

alter table public.events drop constraint if exists events_contact_len;
alter table public.events
  add constraint events_contact_len
  check (contact is null or length(contact) <= 300) not valid;

-- -----------------------------------------------------------------------------
-- B. La vue doit exposer les nouvelles colonnes
-- -----------------------------------------------------------------------------
-- ⚠ `select e.*` fige la liste des colonnes à la création de la vue : les
-- colonnes ajoutées ci-dessus n'y apparaîtraient jamais. Et `create or replace
-- view` refuserait le changement, car les nouvelles colonnes s'insèrent AVANT
-- lat/lng dans l'expansion de e.* — ce qui déplace des colonnes existantes.
-- Il faut donc supprimer puis recréer. On supprime d'abord la fonction qui en
-- dépend, plutôt que d'employer CASCADE qui l'emporterait silencieusement.
drop function if exists public.events_within_radius(float, float, float);
drop view if exists public.events_geo;

create view public.events_geo
  with (security_invoker = on)
as
  select
    e.*,
    ST_Y(e.location::geometry) as lat,
    ST_X(e.location::geometry) as lng
  from public.events e;

grant select on public.events_geo to anon, authenticated;

create function public.events_within_radius(lat float, lng float, radius_m float)
returns setof public.events_geo
language sql
stable
set search_path = public
as $$
  select *
  from public.events_geo g
  where g.location is not null
    and ST_DWithin(g.location, ST_MakePoint(lng, lat)::geography, radius_m)
  order by g.starts_at;
$$;

grant execute on function public.events_within_radius(float, float, float)
  to anon, authenticated;

-- -----------------------------------------------------------------------------
-- C. RPC de création
-- -----------------------------------------------------------------------------
-- Les nouveaux paramètres ont une VALEUR PAR DÉFAUT : un client encore sur
-- l'ancienne version du bundle continue d'appeler la fonction avec ses dix
-- arguments nommés, sans rien casser pendant la propagation de la mise à jour.
drop function if exists public.create_event(
  text, text, timestamptz, timestamptz, boolean, numeric,
  double precision, double precision, text, text
);

create function public.create_event(
  p_title       text,
  p_description text,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_is_paid     boolean,
  p_price       numeric,
  p_lat         double precision,
  p_lng         double precision,
  p_address     text,
  p_category    text,
  p_recur_days  smallint[] default null,
  p_contact     text default null
)
returns public.events
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_row public.events;
  recent  int;
  jours   smallint[];
begin
  -- Limite de publication : 10 événements par heure et par compte, pour qu'un
  -- seul utilisateur ne puisse pas noyer la file de modération. Un événement
  -- récurrent ne compte que pour un : c'est tout l'intérêt du modèle.
  select count(*) into recent
  from public.events
  where created_by = auth.uid()
    and created_at > now() - interval '1 hour';

  if recent >= 10 then
    raise exception 'Limite atteinte : 10 événements par heure. Réessayez un peu plus tard.';
  end if;

  jours := nullif(p_recur_days, '{}');
  if jours is not null and p_ends_at is null then
    raise exception 'Un événement récurrent doit avoir une date de fin de période.';
  end if;

  insert into public.events (
    created_by, title, description, starts_at, ends_at,
    is_paid, price, location, address, category, status,
    recur_days, contact
  ) values (
    auth.uid(), p_title, nullif(p_description, ''), p_starts_at, p_ends_at,
    coalesce(p_is_paid, false),
    case when coalesce(p_is_paid, false) then p_price else null end,
    case when p_lat is null or p_lng is null then null
         else ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography end,
    nullif(p_address, ''), nullif(p_category, ''), 'pending',
    jours, nullif(trim(p_contact), '')
  )
  returning * into new_row;
  return new_row;
end;
$$;

grant execute on function public.create_event(
  text, text, timestamptz, timestamptz, boolean, numeric,
  double precision, double precision, text, text, smallint[], text
) to authenticated;

-- -----------------------------------------------------------------------------
-- D. RPC de mise à jour
-- -----------------------------------------------------------------------------
drop function if exists public.update_event(
  uuid, text, text, timestamptz, timestamptz, boolean, numeric,
  double precision, double precision, text, text
);

create function public.update_event(
  p_id          uuid,
  p_title       text,
  p_description text,
  p_starts_at   timestamptz,
  p_ends_at     timestamptz,
  p_is_paid     boolean,
  p_price       numeric,
  p_lat         double precision,
  p_lng         double precision,
  p_address     text,
  p_category    text,
  p_recur_days  smallint[] default null,
  p_contact     text default null
)
returns public.events
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated_row public.events;
  jours       smallint[];
begin
  jours := nullif(p_recur_days, '{}');
  if jours is not null and p_ends_at is null then
    raise exception 'Un événement récurrent doit avoir une date de fin de période.';
  end if;

  update public.events set
    title       = p_title,
    description = nullif(p_description, ''),
    starts_at   = p_starts_at,
    ends_at     = p_ends_at,
    is_paid     = coalesce(p_is_paid, false),
    price       = case when coalesce(p_is_paid, false) then p_price else null end,
    location    = case when p_lat is null or p_lng is null then null
                       else ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography end,
    address     = nullif(p_address, ''),
    category    = nullif(p_category, ''),
    recur_days  = jours,
    contact     = nullif(trim(p_contact), ''),
    -- Une modification par l'auteur repasse en modération ; un admin garde la
    -- main sur le statut (comportement d'origine, migration 0002).
    status      = case when public.is_admin() then status else 'pending' end
  where id = p_id
  returning * into updated_row;

  if updated_row.id is null then
    raise exception 'Événement introuvable ou non autorisé';
  end if;
  return updated_row;
end;
$$;

grant execute on function public.update_event(
  uuid, text, text, timestamptz, timestamptz, boolean, numeric,
  double precision, double precision, text, text, smallint[], text
) to authenticated;

-- -----------------------------------------------------------------------------
-- E. Vérification — doit afficher une ligne avec QUATRE fois « true »
-- -----------------------------------------------------------------------------
-- Le SQL Editor exécute tout dans une transaction : la moindre erreur annule
-- l'ensemble en silence. Cette dernière requête rend le succès visible.
select
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'events'
             and column_name = 'recur_days')                       as colonne_recurrence,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'events'
             and column_name = 'contact')                          as colonne_contact,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'events_geo'
             and column_name = 'recur_days')                       as vue_a_jour,
  exists (select 1 from information_schema.routines
           where routine_schema = 'public'
             and routine_name = 'events_within_radius')            as fonction_rayon;

-- =============================================================================
-- Fin de migration 0013
-- =============================================================================
