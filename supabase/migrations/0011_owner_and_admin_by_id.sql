-- =============================================================================
-- Armana — Migration 0011 : compte propriétaire intouchable
--                          + désignation d'administrateur par identifiant
-- =============================================================================
-- PROBLÈME CORRIGÉ
-- `set_admin_by_email` (0003/0006) refusait seulement qu'un admin se retire
-- LUI-MÊME. N'importe quel administrateur pouvait donc rétrograder le
-- propriétaire du projet. Pire : la politique `profiles_update_self_or_admin`
-- (0001) autorise un admin à modifier N'IMPORTE QUELLE ligne de profiles, donc
-- un simple UPDATE via l'API publique suffisait à contourner la RPC.
--
-- La protection est donc posée dans le TRIGGER, seul point de passage commun à
-- tous les chemins (RPC, UPDATE direct, futur code). Les RPC ne font qu'ajouter
-- un message d'erreur lisible.
--
-- Les contextes SERVEUR (SQL Editor, service_role) restent souverains :
-- auth.uid() y est NULL. C'est la porte de secours pour corriger le drapeau.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Drapeau de propriétaire
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_owner boolean not null default false;

comment on column public.profiles.is_owner is
  'Compte propriétaire du projet : ne peut être ni rétrogradé ni modifié depuis '
  'l''application, même par un autre administrateur. Un seul par base.';

-- Un seul propriétaire possible.
create unique index if not exists profiles_single_owner
  on public.profiles (is_owner) where is_owner;

-- Désignation : le PLUS ANCIEN administrateur, c'est-à-dire le créateur du
-- projet (migration 0004 existe précisément pour qu'il ait pu se désigner
-- lui-même depuis le SQL Editor). Aucune adresse e-mail codée en dur.
-- Ne fait rien s'il y a déjà un propriétaire, ni s'il n'y a aucun admin.
update public.profiles p
   set is_owner = true
 where not exists (select 1 from public.profiles o where o.is_owner)
   and p.id = (
     select p2.id
       from public.profiles p2
      where p2.role = 'admin'
      order by p2.created_at asc, p2.id asc
      limit 1
   );

-- Pour déplacer le drapeau plus tard, DEPUIS LE SQL EDITOR uniquement :
--   update public.profiles set is_owner = false where is_owner;
--   update public.profiles set is_owner = true
--    where id = (select id from auth.users where lower(email) = lower('...'));

-- -----------------------------------------------------------------------------
-- B. Garde-fou de rôle — protection réelle
-- -----------------------------------------------------------------------------
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Uniquement pour les requêtes CLIENT authentifiées. Les contextes serveur
  -- (SQL Editor, service_role) doivent rester capables de tout corriger.
  if auth.uid() is not null then

    -- Le drapeau de propriétaire ne se pose ni ne se retire depuis l'app :
    -- sans cela, un admin le déplacerait sur lui avant de rétrograder l'autre.
    if new.is_owner is distinct from old.is_owner then
      raise exception 'Le statut de propriétaire ne se modifie pas depuis l''application.';
    end if;

    -- Le propriétaire garde son rôle quoi qu'il arrive, y compris face à un
    -- autre administrateur.
    if old.is_owner and new.role is distinct from old.role then
      raise exception 'Le compte propriétaire ne peut pas être retiré des administrateurs.';
    end if;

    -- Anti-escalade (comportement d'origine, 0004).
    if new.role is distinct from old.role and not public.is_admin() then
      raise exception 'Changement de rôle interdit';
    end if;

  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- C. set_admin_by_email : message lisible (le trigger bloque de toute façon)
-- -----------------------------------------------------------------------------
create or replace function public.set_admin_by_email(target_email text, make_admin boolean)
returns table(id uuid, display_name text, role text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  target_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;

  select u.id into target_id
  from auth.users u
  where lower(u.email) = lower(trim(target_email))
  limit 1;

  if target_id is null then
    raise exception 'Aucun compte avec cet e-mail (la personne doit d''abord créer son compte).';
  end if;

  if not make_admin and target_id = auth.uid() then
    raise exception 'Vous ne pouvez pas retirer votre propre rôle d''administrateur.';
  end if;

  if not make_admin
     and exists (select 1 from public.profiles p where p.id = target_id and p.is_owner) then
    raise exception 'Le compte propriétaire ne peut pas être retiré des administrateurs.';
  end if;

  insert into public.profiles as p (id, role)
  values (target_id, case when make_admin then 'admin' else 'user' end)
  on conflict on constraint profiles_pkey do update set role = excluded.role;

  return query
    select p.id, p.display_name, p.role from public.profiles p where p.id = target_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- D. Désignation par identifiant — pour l'écran « Membres »
-- -----------------------------------------------------------------------------
-- `list_members` ne renvoie volontairement PAS les e-mails (l'annuaire complet
-- des inscrits ne doit pas circuler). Il faut donc un point d'entrée par id.
create or replace function public.set_admin_by_id(target_id uuid, make_admin boolean)
returns table(id uuid, display_name text, role text, is_owner boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;

  if target_id is null
     or not exists (select 1 from public.profiles p where p.id = target_id) then
    raise exception 'Membre introuvable.';
  end if;

  if not make_admin and target_id = auth.uid() then
    raise exception 'Vous ne pouvez pas retirer votre propre rôle d''administrateur.';
  end if;

  if not make_admin
     and exists (select 1 from public.profiles p where p.id = target_id and p.is_owner) then
    raise exception 'Le compte propriétaire ne peut pas être retiré des administrateurs.';
  end if;

  update public.profiles p
     set role = case when make_admin then 'admin' else 'user' end
   where p.id = target_id;

  return query
    select p.id, p.display_name, p.role, p.is_owner
    from public.profiles p
    where p.id = target_id;
end;
$$;

revoke execute on function public.set_admin_by_id(uuid, boolean) from public, anon;
grant execute on function public.set_admin_by_id(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- E. Les listes exposent `is_owner` (badge « Propriétaire » dans l'interface)
-- -----------------------------------------------------------------------------
-- Le type de retour change → PostgreSQL impose un DROP préalable.
drop function if exists public.list_members();
create function public.list_members()
returns table (id uuid, display_name text, role text, created_at timestamptz, is_owner boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;
  return query
    select p.id, p.display_name, p.role, p.created_at, p.is_owner
    from public.profiles p
    order by p.created_at desc;
end;
$$;

revoke execute on function public.list_members() from public, anon;
grant execute on function public.list_members() to authenticated;

drop function if exists public.list_admins();
create function public.list_admins()
returns table(id uuid, display_name text, email text, is_owner boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;
  return query
    select p.id, p.display_name, u.email::text, p.is_owner
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role = 'admin'
    order by p.is_owner desc, p.display_name nulls last, u.email;
end;
$$;

revoke execute on function public.list_admins() from public, anon;
grant execute on function public.list_admins() to authenticated;

-- =============================================================================
-- Fin de migration 0011
-- =============================================================================
