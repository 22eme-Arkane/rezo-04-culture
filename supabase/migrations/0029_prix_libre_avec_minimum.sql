-- =============================================================================
-- Migration 0029 — le prix libre porte un montant minimum
-- =============================================================================
--
-- La 0028 donnait au prix libre une précision EN TEXTE (« à partir de 5 € »).
-- Matthieu ne veut pas de texte libre ici : le prix libre prend un MONTANT,
-- comme le tarif payant, précédé de « supérieur ou égal ».
--
-- Le montant se range dans la colonne `price`, qui existe déjà et n'est
-- contrainte que par `price >= 0` (migration 0001) : rien à ajouter. C'étaient
-- les deux RPC qui l'effaçaient dès que le tarif n'était pas « payant ».
--
-- ⚠ `create or replace` SUFFIT ICI, et c'est voulu : la signature ne change
-- pas d'un caractère. Seul le corps évolue. Ajouter ou renommer un paramètre
-- aurait imposé un `drop` préalable — c'est ce qui rend ces migrations
-- risquées, et on l'évite quand on le peut.
--
-- Ce qui change, deux lignes dans chaque fonction :
--   price        gardé pour « payant » ET pour « libre » (au lieu de « payant »
--                seul) — sinon le minimum saisi disparaissait à l'écriture ;
--   price_detail réservé au tarif « payant ». Le prix libre n'a plus de texte,
--                et un ancien texte doit s'effacer à la première modification.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. La précision de tarif descend de 40 à 15 caractères
-- -----------------------------------------------------------------------------
-- Elle s'affiche à la suite du montant, dans le badge de la vignette d'agenda.
-- « tarif réduit 12 €, par personne » n'y entrerait jamais. Quinze caractères,
-- prix compris : « réduit 12 € », « par personne ».
--
-- ⚠ ON TRONQUE AVANT DE CONTRAINDRE. Une seule valeur trop longue ferait
-- échouer la contrainte, et le SQL Editor annulerait TOUTE la migration en
-- silence. La 0028 autorisait 40 caractères : ces valeurs existent peut-être.
update public.events
   set price_detail = left(price_detail, 15)
 where price_detail is not null and char_length(price_detail) > 15;

alter table public.events drop constraint if exists events_price_detail_court;
alter table public.events
  add constraint events_price_detail_court
  check (price_detail is null or char_length(price_detail) <= 15);

-- -----------------------------------------------------------------------------
-- B. Les deux RPC
-- -----------------------------------------------------------------------------
create or replace function public.create_event(
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
    -- Le montant vaut pour « payant » (le prix) comme pour « libre » (le
    -- minimum). Seul « gratuit » n'en a pas.
    case when mode = 'gratuit' then null else p_price end,
    case when p_lat is null or p_lng is null then null
         else ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography end,
    nullif(p_address, ''), nullif(p_category, ''), 'pending',
    jours, nullif(trim(p_contact), ''),
    dates,
    -- La précision en texte est RÉSERVÉE au tarif payant.
    case when mode = 'payant' then nullif(trim(p_price_detail), '') else null end,
    mode
  )
  returning * into new_row;
  return new_row;
end;
$$;

create or replace function public.update_event(
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
    price        = case when mode = 'gratuit' then null else p_price end,
    location     = case when p_lat is null or p_lng is null then null
                        else ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography end,
    address      = nullif(p_address, ''),
    category     = nullif(p_category, ''),
    recur_days   = jours,
    recur_dates  = dates,
    price_detail = case when mode = 'payant' then nullif(trim(p_price_detail), '')
                        else null end,
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

-- -----------------------------------------------------------------------------
-- Vérification — les cinq doivent être vrais
-- -----------------------------------------------------------------------------
select
  (select count(*) = 0 from public.events
    where price_detail is not null and char_length(price_detail) > 15)
                                                as precisions_courtes,
  (select pg_get_functiondef(p.oid) like '%mode = ''gratuit'' then null else p_price%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_event')
                                                as creation_garde_le_minimum,
  (select pg_get_functiondef(p.oid) like '%mode = ''gratuit'' then null else p_price%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_event')
                                                as modification_garde_le_minimum,
  -- Une seule version de chaque : un `create or replace` qui aurait glissé sur
  -- une signature différente en laisserait deux, et PostgREST ne saurait plus
  -- laquelle appeler.
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_event') = 1
                                                as une_seule_create_event,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_event') = 1
                                                as une_seule_update_event;

-- =============================================================================
-- Fin de migration 0029
-- =============================================================================
