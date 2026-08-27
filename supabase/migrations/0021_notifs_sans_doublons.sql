-- =============================================================================
-- Armana — Migration 0021 : une annonce par événement, pas une par retouche
-- =============================================================================
-- ⚠ À APPLIQUER APRÈS LES 0019 ET 0020.
--
-- LE PROBLÈME, signalé par Matthieu
-- Modifier un événement le renvoie en modération (update_event, migration
-- 0013). À chaque réapprobation, le déclencheur repostait « Nouvel événement
-- dans l'agenda » : vingt corrections de faute de frappe = vingt notifications
-- pour le même spectacle, chez tout le monde.
--
-- CE QU'ON GARDE
--   * l'annonce publique ne part QU'UNE FOIS, à la première approbation
--     (colonne `announced_at`, qui sert de mémoire) ;
--   * les modérateurs, eux, continuent d'être prévenus quand quelque chose
--     attend leur relecture — c'est leur travail. Mais une seule fois par
--     attente : si l'auteur enchaîne trois retouches avant qu'un modérateur
--     n'ouvre l'application, une seule notification reste en file.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Mémoire de la première annonce
-- -----------------------------------------------------------------------------
alter table public.events add column if not exists announced_at timestamptz;

comment on column public.events.announced_at is
  'Date de la PREMIÈRE approbation, quand l''événement a été annoncé au public. '
  'NULL = jamais annoncé. Empêche de renotifier à chaque modification.';

-- Rattrapage : tout ce qui est DÉJÀ approuvé a déjà été annoncé. Sans cette
-- ligne, la prochaine retouche de chaque événement existant déclencherait
-- l'annonce que l'on cherche précisément à éviter.
update public.events
   set announced_at = coalesce(created_at, now())
 where status = 'approved'
   and announced_at is null;

-- -----------------------------------------------------------------------------
-- B. La file retient DE QUEL événement il s'agit
-- -----------------------------------------------------------------------------
-- Sans cette colonne, dédoublonner obligeait à comparer les titres — et deux
-- « Fête de la musique » dans deux villages auraient fusionné à tort.
alter table public.notification_queue add column if not exists event_id uuid;

create index if not exists notification_queue_event_idx
  on public.notification_queue (event_id) where sent_at is null;

-- -----------------------------------------------------------------------------
-- C. Le déclencheur, corrigé
-- -----------------------------------------------------------------------------
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
    -- Ne pas empiler deux alertes pour le même événement tant que la première
    -- n'est pas partie : trois retouches d'affilée ne valent qu'une relecture.
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

    -- ⚠ Le déclencheur est AFTER : on ne peut pas écrire dans NEW, il faut un
    -- vrai UPDATE. Il rappelle bien la fonction, mais l'appel récursif ne
    -- retombe dans aucune des deux branches (le statut ne change pas), donc
    -- il s'arrête là — pas de boucle.
    update public.events set announced_at = now() where id = new.id;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Vérification — tout doit être vrai
-- -----------------------------------------------------------------------------
select
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='events'
             and column_name='announced_at')                                     as memoire_annonce,
  (select count(*) from public.events
    where status = 'approved' and announced_at is null) = 0                       as existants_rattrapes,
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='notification_queue'
             and column_name='event_id')                                          as file_liee_aux_evenements,
  (select pg_get_functiondef(p.oid) like '%new.announced_at is null%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='enqueue_event_notification')          as annonce_unique,
  (select pg_get_functiondef(p.oid) like '%q.event_id = new.id%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='enqueue_event_notification')          as moderation_sans_doublon;

-- =============================================================================
-- Fin de migration 0021
-- =============================================================================
