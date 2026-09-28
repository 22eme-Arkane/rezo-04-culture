-- =============================================================================
-- Migration 0032 — « Au chapeau », en complément du tarif
-- =============================================================================
--
-- DEMANDE D'UNE UTILISATRICE : pouvoir dire « au chapeau », et le COMBINER —
-- gratuit et au chapeau, prix libre et au chapeau.
--
-- ⚠ CE N'EST PAS UN QUATRIÈME TARIF. `price_mode` garde ses trois valeurs,
-- qui s'excluent entre elles (on ne peut pas être gratuit ET payant). Le
-- chapeau S'AJOUTE à l'une d'elles : d'où une colonne booléenne à part, plutôt
-- qu'une valeur combinée (« gratuit+chapeau ») qui aurait compliqué chaque
-- lecture du tarif — filtre « Gratuit », couleur du badge, formulaire.
--
-- ⚠ À APPLIQUER AVANT DE METTRE EN LIGNE le code qui l'accompagne. La nouvelle
-- application envoie `p_au_chapeau` : sans cette migration, PostgREST ne
-- trouverait aucune fonction qui l'accepte, et plus personne ne pourrait
-- publier. Dans l'autre sens, aucun risque : le paramètre a une valeur par
-- défaut, les téléphones restés sur l'ancienne version continuent d'appeler
-- les fonctions sans lui.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. La colonne
-- -----------------------------------------------------------------------------
alter table public.events
  add column if not exists au_chapeau boolean not null default false;

comment on column public.events.au_chapeau is
  'Le public donne ce qu''il veut au passage du chapeau. S''AJOUTE au tarif '
  '(price_mode) au lieu de le remplacer : gratuit et au chapeau, etc.';

-- -----------------------------------------------------------------------------
-- B. La vue expose la nouvelle colonne
-- -----------------------------------------------------------------------------
-- ⚠ `select e.*` FIGE LA LISTE DES COLONNES À LA CRÉATION. Sans cette
-- recréation, la colonne existerait sans jamais arriver jusqu'à l'application,
-- qui lit tout par `events_geo`. Même manœuvre qu'en 0013, 0019 et 0028, avec
-- la fonction dépendante à retirer d'abord.
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
-- C. Les deux RPC gagnent `p_au_chapeau`
-- -----------------------------------------------------------------------------
-- ⚠ `create or replace` NE PEUT PAS ajouter de paramètre : on retire d'abord
-- la signature de la 0028/0029. Les corps sont ceux de la 0029, à la seule
-- ligne du chapeau près.
drop function if exists public.create_event(
  text, text, timestamptz, timestamptz, boolean, numeric,
  double precision, double precision, text, text, smallint[], text,
  date[], text, text
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
  p_price_mode   text       default null,
  p_au_chapeau   boolean    default null
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
    recur_days, contact, recur_dates, price_detail, price_mode, au_chapeau
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
    mode,
    -- Ancien bundle, qui ne connaît pas le chapeau : pas de chapeau.
    coalesce(p_au_chapeau, false)
  )
  returning * into new_row;
  return new_row;
end;
$$;

grant execute on function public.create_event(
  text, text, timestamptz, timestamptz, boolean, numeric,
  double precision, double precision, text, text, smallint[], text,
  date[], text, text, boolean
) to authenticated;

drop function if exists public.update_event(
  uuid, text, text, timestamptz, timestamptz, boolean, numeric,
  double precision, double precision, text, text, smallint[], text,
  date[], text, text
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
  p_price_mode   text       default null,
  p_au_chapeau   boolean    default null
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
    -- ⚠ NULL = « je ne sais pas » (ancien bundle) : on garde la valeur en
    -- place. Sinon, retoucher un événement depuis un téléphone pas encore à
    -- jour effacerait le chapeau sans que personne l'ait décoché.
    au_chapeau   = coalesce(p_au_chapeau, au_chapeau),
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
  date[], text, text, boolean
) to authenticated;

-- -----------------------------------------------------------------------------
-- D. Vérification — les six doivent être vrais
-- -----------------------------------------------------------------------------
select
  (select count(*) = 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events'
      and column_name = 'au_chapeau')                    as colonne_ajoutee,
  -- ⚠ Le vrai piège : la vue fige ses colonnes. Si ceci est faux, la colonne
  -- existe mais n'arrivera JAMAIS jusqu'à l'application.
  (select count(*) = 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'events_geo'
      and column_name = 'au_chapeau')                    as vue_a_jour,
  (select pg_get_functiondef(p.oid) like '%coalesce(p_au_chapeau, false)%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_event')
                                                         as creation_connait_le_chapeau,
  (select pg_get_functiondef(p.oid) like '%coalesce(p_au_chapeau, au_chapeau)%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_event')
                                                         as modification_le_garde,
  -- Une seule version de chaque : deux signatures laisseraient PostgREST
  -- hésiter, et l'appel échouerait.
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_event') = 1
                                                         as une_seule_create_event,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'update_event') = 1
                                                         as une_seule_update_event;

-- =============================================================================
-- Fin de migration 0032
-- =============================================================================
