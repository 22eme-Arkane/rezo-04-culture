-- =============================================================================
-- Armana — Migration 0012 : journal des actions d'administration
-- =============================================================================
-- BUT
-- Le propriétaire (profiles.is_owner, migration 0011) doit pouvoir retracer ce
-- que les administrateurs ont fait, pour trancher en cas de litige.
--
-- PRINCIPE DE CONCEPTION
-- Le journal doit rester crédible même contre l'administrateur qu'il accuse :
--   * l'écriture ne passe PAS par le client — uniquement par des triggers
--     SECURITY DEFINER, donc rien à falsifier depuis l'application ;
--   * la table a la RLS activée SANS AUCUNE POLITIQUE, et tous les droits sont
--     révoqués : aucun client ne peut lire, insérer, modifier ni supprimer une
--     ligne, quel que soit son rôle ;
--   * la lecture passe par une RPC réservée au seul propriétaire ;
--   * le libellé de la cible est FIGÉ à l'instant de l'action, pour rester
--     lisible après suppression de l'événement ou du compte concerné.
--
-- PORTÉE
-- Seuls les actes de pouvoir sont journalisés : changement de rôle, marquage de
-- soutien, modération et suppression d'un événement dont on n'est pas l'auteur.
-- Publier ou modifier SES PROPRES événements n'est pas une action d'admin et
-- n'encombre donc pas le journal.
--
-- Les opérations SERVEUR (SQL Editor, service_role : auth.uid() est NULL) ne
-- sont pas journalisées — elles ne viennent pas d'un administrateur de l'app.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. La table
-- -----------------------------------------------------------------------------
create table if not exists public.admin_actions (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  actor_id     uuid references public.profiles(id) on delete set null,
  action       text not null,
  target_kind  text,
  target_id    uuid,          -- volontairement sans clé étrangère : cible polymorphe
  target_label text,          -- figé : la cible peut disparaître ensuite
  details      jsonb
);

create index if not exists admin_actions_created_at_idx
  on public.admin_actions (created_at desc);

alter table public.admin_actions enable row level security;

-- Aucune politique n'est créée : RLS active + zéro politique = personne ne
-- passe. Les triggers ci-dessous sont SECURITY DEFINER et contournent la RLS.
revoke all on public.admin_actions from anon, authenticated;
revoke all on sequence public.admin_actions_id_seq from anon, authenticated;

-- -----------------------------------------------------------------------------
-- B. Journalisation des actes sur les comptes
-- -----------------------------------------------------------------------------
create or replace function public.log_profile_admin_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new; -- contexte serveur : hors journal
  end if;

  if new.role is distinct from old.role then
    insert into public.admin_actions
      (actor_id, action, target_kind, target_id, target_label, details)
    values
      (auth.uid(), 'role_change', 'profile', new.id,
       coalesce(new.display_name, '(sans nom)'),
       jsonb_build_object('avant', old.role, 'apres', new.role));
  end if;

  if new.supporter_since is distinct from old.supporter_since then
    insert into public.admin_actions
      (actor_id, action, target_kind, target_id, target_label, details)
    values
      (auth.uid(), 'supporter', 'profile', new.id,
       coalesce(new.display_name, '(sans nom)'),
       jsonb_build_object('ajoute', (new.supporter_since is not null)));
  end if;

  return new;
end;
$$;

drop trigger if exists log_profile_admin_action_trg on public.profiles;
create trigger log_profile_admin_action_trg
  after update on public.profiles
  for each row execute function public.log_profile_admin_action();

-- -----------------------------------------------------------------------------
-- C. Journalisation des actes sur les événements
-- -----------------------------------------------------------------------------
create or replace function public.log_event_admin_action()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return coalesce(new, old); -- contexte serveur : hors journal
  end if;

  if tg_op = 'UPDATE' then
    -- Modération : changement de statut sur l'événement de quelqu'un d'autre.
    if new.status is distinct from old.status
       and auth.uid() is distinct from new.created_by then
      insert into public.admin_actions
        (actor_id, action, target_kind, target_id, target_label, details)
      values
        (auth.uid(), 'event_status', 'event', new.id, new.title,
         jsonb_build_object('avant', old.status, 'apres', new.status));
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if auth.uid() is distinct from old.created_by then
      insert into public.admin_actions
        (actor_id, action, target_kind, target_id, target_label, details)
      values
        (auth.uid(), 'event_delete', 'event', old.id, old.title,
         jsonb_build_object('statut', old.status, 'debut', old.starts_at));
    end if;
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists log_event_admin_action_trg on public.events;
create trigger log_event_admin_action_trg
  after update or delete on public.events
  for each row execute function public.log_event_admin_action();

-- -----------------------------------------------------------------------------
-- D. Lecture — propriétaire uniquement
-- -----------------------------------------------------------------------------
create or replace function public.am_i_owner()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_owner);
$$;

revoke execute on function public.am_i_owner() from public, anon;
grant execute on function public.am_i_owner() to authenticated;

create or replace function public.list_admin_actions(max_rows int default 200)
returns table (
  created_at   timestamptz,
  actor_name   text,
  action       text,
  target_kind  text,
  target_label text,
  details      jsonb
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Volontairement PAS is_admin() : le journal sert justement à départager les
  -- administrateurs entre eux.
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire du projet';
  end if;

  return query
    select a.created_at,
           coalesce(pa.display_name, '(compte supprimé)')::text,
           a.action, a.target_kind, a.target_label, a.details
    from public.admin_actions a
    left join public.profiles pa on pa.id = a.actor_id
    order by a.created_at desc
    limit greatest(1, least(coalesce(max_rows, 200), 500));
end;
$$;

revoke execute on function public.list_admin_actions(int) from public, anon;
grant execute on function public.list_admin_actions(int) to authenticated;

-- =============================================================================
-- Fin de migration 0012
-- =============================================================================
