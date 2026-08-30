-- =============================================================================
-- Armana — Migration 0025 : des totaux qui survivent à la purge, et les
--                           visites par période
-- =============================================================================
-- ⚠ À APPLIQUER APRÈS LES 0023 ET 0024 (elle s'appuie sur la colonne passages).
--
-- CE QUE MATTHIEU VEUT VOIR
-- Les grands chiffres doivent dire ce qui s'est passé DEPUIS LA CRÉATION
-- d'Armana, et les quatre tuiles du dessous compter des VISITES (pas des
-- visiteurs uniques) sur aujourd'hui, hier, cette semaine, ce mois-ci.
--
-- ⚠ LE PIÈGE : LA PURGE EFFACE LE PASSÉ
-- La règle de rétention supprime chaque mois les événements des mois révolus,
-- photos comprises. Compter « les événements publiés depuis le début » dans la
-- table `events` donnerait donc un chiffre qui RÉTRÉCIT à chaque purge — le
-- contraire de ce qu'on attend d'un cumul.
-- D'où un COMPTEUR PERSISTANT, incrémenté au moment exact où un événement est
-- publié pour la première fois, et que rien n'efface ensuite.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Un compteur que la purge ne touche pas
-- -----------------------------------------------------------------------------
create table if not exists public.stats_cumul (
  cle    text primary key,
  valeur bigint not null default 0
);

alter table public.stats_cumul enable row level security;
-- Table interne : lecture par les RPC, écriture par le déclencheur seul.
revoke all on public.stats_cumul from anon, authenticated;

-- Amorçage : les événements approuvés ENCORE en base. Les mois déjà purgés
-- sont définitivement perdus — on ne les invente pas. Le cumul est donc exact
-- à partir d'aujourd'hui, et minoré de ce que la purge a déjà emporté.
insert into public.stats_cumul (cle, valeur)
values ('evenements_publies', (select count(*) from public.events where status = 'approved'))
on conflict (cle) do nothing;

-- -----------------------------------------------------------------------------
-- B. Le compteur s'incrémente à la PREMIÈRE publication
-- -----------------------------------------------------------------------------
-- On se greffe sur `announced_at` (migration 0021), qui marque déjà « cet
-- événement a été annoncé une fois ». C'est exactement le moment voulu : ni la
-- création, ni les remises en attente, ni les modifications ultérieures.
create or replace function public.enqueue_event_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- --- Modération : prévenir qu'il y a à relire ---------------------------
  if (tg_op = 'INSERT' and new.status = 'pending')
     or (tg_op = 'UPDATE' and new.status = 'pending' and old.status is distinct from 'pending')
  then
    if not exists (
      select 1 from public.notification_queue q
      where q.kind = 'moderation' and q.sent_at is null and q.event_id = new.id
    ) then
      insert into public.notification_queue (kind, title, body, url, dept, event_id)
      values ('moderation', 'Un événement à valider',
              left(new.title, 120), '/#/moderation', new.dept, new.id);
    end if;

  -- --- Public : l'annonce, UNE SEULE FOIS ---------------------------------
  elsif tg_op = 'UPDATE'
        and new.status = 'approved'
        and old.status is distinct from 'approved'
        and new.announced_at is null
  then
    insert into public.notification_queue (kind, title, body, url, dept, event_id)
    values ('nouveaux_evenements', 'Nouvel événement dans l''agenda',
            left(new.title, 120), '/#/evenement?id=' || new.id, new.dept, new.id);
    new.announced_at := now();

    -- ⚠ LE CUMUL SE FAIT ICI, et nulle part ailleurs : au seul instant où un
    -- événement devient public pour la première fois. La purge pourra ensuite
    -- effacer la ligne, le compteur, lui, restera.
    insert into public.stats_cumul (cle, valeur) values ('evenements_publies', 1)
    on conflict (cle) do update set valeur = public.stats_cumul.valeur + 1;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- C. Les chiffres du tableau de bord, en un seul appel
-- -----------------------------------------------------------------------------
-- ⚠ Ce sont des VISITES (somme des passages), pas des visiteurs uniques :
-- quelqu'un qui ouvre l'application trois fois aujourd'hui compte trois fois.
-- « cette semaine » part du LUNDI, « ce mois-ci » du 1er — des bornes de
-- calendrier, celles auxquelles on pense en lisant ces mots, et non des
-- fenêtres glissantes de 7 ou 30 jours.
create or replace function public.visits_summary()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with jour as (select (now() at time zone 'Europe/Paris')::date as d),
  bornes as (
    select d,
           d - ((extract(isodow from d)::int) - 1) as lundi,
           date_trunc('month', d)::date            as premier_du_mois
    from jour
  ),
  toutes as (
    select day, passages from public.app_visits
    union all
    select day, passages from public.anon_visits
  )
  select case when public.is_admin() then jsonb_build_object(
    'total',      coalesce((select sum(passages) from toutes), 0),
    'aujourdhui', coalesce((select sum(passages) from toutes, bornes where day = bornes.d), 0),
    'hier',       coalesce((select sum(passages) from toutes, bornes where day = bornes.d - 1), 0),
    'semaine',    coalesce((select sum(passages) from toutes, bornes where day >= bornes.lundi), 0),
    'mois',       coalesce((select sum(passages) from toutes, bornes where day >= bornes.premier_du_mois), 0),
    'depuis',     (select min(day) from toutes)
  ) end;
$$;

revoke execute on function public.visits_summary() from public, anon;
grant execute on function public.visits_summary() to authenticated;

-- Total des événements publiés depuis le début, purges comprises.
create or replace function public.events_published_total()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_admin() then
    coalesce((select valeur from public.stats_cumul where cle = 'evenements_publies'), 0)
  end;
$$;

revoke execute on function public.events_published_total() from public, anon;
grant execute on function public.events_published_total() to authenticated;

-- -----------------------------------------------------------------------------
-- Vérification — les trois premiers doivent être vrais
-- -----------------------------------------------------------------------------
select
  exists (select 1 from information_schema.tables
           where table_schema='public' and table_name='stats_cumul')             as table_cumul,
  (select pg_get_functiondef(p.oid) like '%stats_cumul%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='enqueue_event_notification')         as compteur_branche,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname='public' and p.proname='visits_summary')              as fonction_visites,
  (select valeur from public.stats_cumul where cle = 'evenements_publies')       as evenements_publies_au_depart,
  (select sum(passages) from (select passages from public.app_visits
                              union all
                              select passages from public.anon_visits) t)        as visites_totales;

-- =============================================================================
-- Fin de migration 0025
-- =============================================================================
