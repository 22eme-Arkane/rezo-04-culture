-- =============================================================================
-- Migration 0028 — séries de dates choisies, et trois tarifs
-- =============================================================================
--
-- Demande venue d'une utilisatrice, atelier « Le jeu de peindre » :
-- 200 €/personne pour 9 séances, un vendredi par mois. Rien ne permettait de
-- le dire. Cocher « vendredi » affichait « Tous les vendredis » — faux — et le
-- montant seul se lisait comme un prix par séance.
--
-- TROIS AJOUTS :
--
--   recur_dates   les dates de la série, choisies une à une. Un rythme mensuel
--                 ne tombe pas sur la même semaine tous les mois : une règle
--                 hebdomadaire ne peut pas le décrire. Le formulaire propose un
--                 rythme (une semaine sur deux, une fois par mois) qui PRÉ-REMPLIT
--                 ces dates, puis l'organisateur corrige celles qui tombent mal.
--
--   price_detail  précision libre à côté du montant : « les 9 séances »,
--                 « par personne », « tarif réduit 12 € ».
--
--   price_mode    gratuit | libre | payant. « Prix libre » existait déjà dans
--                 les faits — une affiche publiée dit « Entrée libre
--                 participation » — sans pouvoir se dire dans le formulaire.
--
-- ⚠ `is_paid` EST CONSERVÉE ET DEVIENT UN MIROIR de `price_mode = 'payant'`.
-- Elle est lue partout dans l'application (filtre « Gratuit », vignettes,
-- fiche). La supprimer aurait demandé de tout reprendre en même temps ; les
-- deux RPC ci-dessous sont les SEULES à écrire ces colonnes et les calculent
-- ensemble, elles ne peuvent donc pas diverger.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Colonnes
-- -----------------------------------------------------------------------------
alter table public.events add column if not exists recur_dates  date[];
alter table public.events add column if not exists price_detail text;
alter table public.events add column if not exists price_mode   text;

-- Reprise de l'existant AVANT la contrainte, sinon elle échoue et le SQL
-- Editor annule toute la migration en silence.
update public.events
   set price_mode = case when is_paid then 'payant' else 'gratuit' end
 where price_mode is null;

alter table public.events drop constraint if exists events_price_mode_valide;
alter table public.events
  add constraint events_price_mode_valide
  check (price_mode is null or price_mode in ('gratuit', 'libre', 'payant'));

-- ⚠ LONGUEUR BORNÉE. Sur la vignette d'agenda, la précision s'affiche à la
-- suite du montant, sur une seule ligne : au-delà, elle serait tronquée et
-- l'information perdue. La limite est posée EN BASE, pas seulement dans le
-- formulaire — un appel direct à l'API la contournerait.
alter table public.events drop constraint if exists events_price_detail_court;
alter table public.events
  add constraint events_price_detail_court
  check (price_detail is null or char_length(price_detail) <= 40);

-- Une série est SOIT hebdomadaire (recur_days) SOIT une liste de dates
-- (recur_dates) — jamais les deux, l'affichage ne saurait laquelle suivre.
alter table public.events drop constraint if exists events_recurrence_exclusive;
alter table public.events
  add constraint events_recurrence_exclusive
  check (recur_days is null or recur_dates is null);

-- -----------------------------------------------------------------------------
-- B. La vue expose les nouvelles colonnes
-- -----------------------------------------------------------------------------
-- ⚠ `select e.*` FIGE LA LISTE DES COLONNES À LA CRÉATION. Sans cette
-- recréation, les trois colonnes ci-dessus n'arriveraient jamais jusqu'à
-- l'application, qui lit tout par `events_geo`. Même manœuvre qu'en 0013 et
-- 0019, avec la fonction dépendante à retirer d'abord.
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
-- C. Calcul commun aux deux RPC
-- -----------------------------------------------------------------------------
-- Bornes réelles d'une série de dates. `starts_at` et `ends_at` commandent la
-- visibilité, la purge mensuelle et le tri : si elles ne couvraient pas toute
-- la série, un atelier de neuf mois disparaîtrait de l'agenda dès la première
-- séance passée. On les RECALCULE côté serveur — un client fautif ne peut donc
-- pas produire un événement mal borné.
create or replace function public.serie_bornes(
  p_dates     date[],
  p_starts_at timestamptz,
  p_ends_at   timestamptz,
  out debut   timestamptz,
  out fin     timestamptz
)
language plpgsql
immutable
set search_path = public
as $$
declare
  heure_debut time;
  heure_fin   time;
begin
  heure_debut := (p_starts_at at time zone 'Europe/Paris')::time;
  heure_fin   := coalesce((p_ends_at at time zone 'Europe/Paris')::time, heure_debut);
  debut := ((select min(d) from unnest(p_dates) d) + heure_debut) at time zone 'Europe/Paris';
  fin   := ((select max(d) from unnest(p_dates) d) + heure_fin)   at time zone 'Europe/Paris';
end;
$$;

-- -----------------------------------------------------------------------------
-- D. RPC de création
-- -----------------------------------------------------------------------------
-- ⚠ `create or replace` NE PEUT PAS ajouter de paramètre : il faut retirer
-- l'ancienne signature d'abord. Les nouveaux paramètres ont une valeur par
-- défaut, donc un téléphone encore sur l'ancien bundle continue d'appeler la
-- fonction avec ses douze arguments nommés pendant la propagation.
drop function if exists public.create_event(
  text, text, timestamptz, timestamptz, boolean, numeric,
  double precision, double precision, text, text, smallint[], text
);

create function public.create_event(
  p_title        text,
  p_description  text,
  p_starts_at    timestamptz,
  p_ends_at      timestamptz,
  p_is_paid      boolean,
  p_price        numeric,
  p_lat          double precision,
  p_lng          double precision,
  p_address      text,
  p_category     text,
  p_recur_days   smallint[] default null,
  p_contact      text default null,
  p_recur_dates  date[]     default null,
  p_price_detail text       default null,
  p_price_mode   text       default null
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
  dates   date[];
  mode    text;
  paid    boolean;
  debut   timestamptz;
  fin     timestamptz;
begin
  -- Limite de publication : 10 événements par heure et par compte, pour qu'un
  -- seul utilisateur ne puisse pas noyer la file de modération. Une série ne
  -- compte que pour un : c'est tout l'intérêt du modèle.
  select count(*) into recent
  from public.events
  where created_by = auth.uid()
    and created_at > now() - interval '1 hour';

  if recent >= 10 then
    raise exception 'Limite atteinte : 10 événements par heure. Réessayez un peu plus tard.';
  end if;

  jours := nullif(p_recur_days, '{}');
  dates := nullif(p_recur_dates, '{}');

  if dates is not null then
    -- Une liste de dates l'emporte : les deux ensemble n'ont pas de sens.
    jours := null;
    select b.debut, b.fin into debut, fin
    from public.serie_bornes(dates, p_starts_at, p_ends_at) b;
  else
    debut := p_starts_at;
    fin   := p_ends_at;
    if jours is not null and fin is null then
      raise exception 'Un événement récurrent doit avoir une date de fin de période.';
    end if;
  end if;

  -- Sans `p_price_mode` (ancien bundle), on retombe sur l'ancien booléen.
  mode := coalesce(nullif(p_price_mode, ''),
                   case when coalesce(p_is_paid, false) then 'payant' else 'gratuit' end);
  if mode not in ('gratuit', 'libre', 'payant') then
    raise exception 'Tarif inconnu : %', mode;
  end if;
  paid := (mode = 'payant');

  insert into public.events (
    created_by, title, description, starts_at, ends_at,
    is_paid, price, location, address, category, status,
    recur_days, contact, recur_dates, price_detail, price_mode
  ) values (
    auth.uid(), p_title, nullif(p_description, ''), debut, fin,
    paid,
    case when paid then p_price else null end,
    case when p_lat is null or p_lng is null then null
         else ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography end,
    nullif(p_address, ''), nullif(p_category, ''), 'pending',
    jours, nullif(trim(p_contact), ''),
    dates,
    -- Gratuit n'a rien à préciser ; « libre » et « payant », si.
    case when mode = 'gratuit' then null else nullif(trim(p_price_detail), '') end,
    mode
  )
  returning * into new_row;
  return new_row;
end;
$$;

grant execute on function public.create_event(
  text, text, timestamptz, timestamptz, boolean, numeric,
  double precision, double precision, text, text, smallint[], text,
  date[], text, text
) to authenticated;

-- -----------------------------------------------------------------------------
-- E. RPC de mise à jour
-- -----------------------------------------------------------------------------
drop function if exists public.update_event(
  uuid, text, text, timestamptz, timestamptz, boolean, numeric,
  double precision, double precision, text, text, smallint[], text
);

create function public.update_event(
  p_id           uuid,
  p_title        text,
  p_description  text,
  p_starts_at    timestamptz,
  p_ends_at      timestamptz,
  p_is_paid      boolean,
  p_price        numeric,
  p_lat          double precision,
  p_lng          double precision,
  p_address      text,
  p_category     text,
  p_recur_days   smallint[] default null,
  p_contact      text default null,
  p_recur_dates  date[]     default null,
  p_price_detail text       default null,
  p_price_mode   text       default null
)
returns public.events
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated_row public.events;
  jours       smallint[];
  dates       date[];
  mode        text;
  paid        boolean;
  debut       timestamptz;
  fin         timestamptz;
begin
  jours := nullif(p_recur_days, '{}');
  dates := nullif(p_recur_dates, '{}');

  if dates is not null then
    jours := null;
    select b.debut, b.fin into debut, fin
    from public.serie_bornes(dates, p_starts_at, p_ends_at) b;
  else
    debut := p_starts_at;
    fin   := p_ends_at;
    if jours is not null and fin is null then
      raise exception 'Un événement récurrent doit avoir une date de fin de période.';
    end if;
  end if;

  mode := coalesce(nullif(p_price_mode, ''),
                   case when coalesce(p_is_paid, false) then 'payant' else 'gratuit' end);
  if mode not in ('gratuit', 'libre', 'payant') then
    raise exception 'Tarif inconnu : %', mode;
  end if;
  paid := (mode = 'payant');

  update public.events set
    title        = p_title,
    description  = nullif(p_description, ''),
    starts_at    = debut,
    ends_at      = fin,
    is_paid      = paid,
    price        = case when paid then p_price else null end,
    location     = case when p_lat is null or p_lng is null then null
                        else ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography end,
    address      = nullif(p_address, ''),
    category     = nullif(p_category, ''),
    recur_days   = jours,
    recur_dates  = dates,
    price_detail = case when mode = 'gratuit' then null
                        else nullif(trim(p_price_detail), '') end,
    price_mode   = mode,
    contact      = nullif(trim(p_contact), ''),
    -- Une modification par l'auteur repasse en modération ; un modérateur garde
    -- la main sur le statut (comportement d'origine, migration 0002).
    status       = case when public.is_admin() then status else 'pending' end
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
  double precision, double precision, text, text, smallint[], text,
  date[], text, text
) to authenticated;

-- -----------------------------------------------------------------------------
-- F. Vérification — les six doivent être vrais
-- -----------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'events'
      and column_name in ('recur_dates', 'price_detail', 'price_mode')) = 3
                                                        as colonnes_ajoutees,
  -- ⚠ Le vrai piège : la vue fige ses colonnes. Si ceci est faux, les trois
  -- colonnes existent mais n'arriveront JAMAIS jusqu'à l'application.
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'events_geo'
      and column_name in ('recur_dates', 'price_detail', 'price_mode')) = 3
                                                        as vue_a_jour,
  (select count(*) = 0 from public.events where price_mode is null)
                                                        as tarifs_repris,
  (select count(*) = 0 from public.events
    where (price_mode = 'payant') is distinct from is_paid)
                                                        as miroir_coherent,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_event') = 1
                                                        as une_seule_create_event,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_event') = 1
                                                        as une_seule_update_event;

-- =============================================================================
-- Fin de migration 0028
-- =============================================================================
