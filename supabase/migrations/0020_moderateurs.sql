-- =============================================================================
-- Armana — Migration 0020 : modérateurs par département, candidatures
-- =============================================================================
-- ⚠ À APPLIQUER APRÈS LA 0019 (elle s'appuie sur events.dept).
--
-- LE NOUVEAU PARTAGE DES RÔLES, décidé par Matthieu :
--   * le PROPRIÉTAIRE (profiles.is_owner, migration 0011) garde tout :
--     configuration, messages, membres, gestion des modérateurs, purge ;
--   * les MODÉRATEURS (role = 'admin' en base, inchangé) n'ont plus que la
--     modération et les statistiques, et la modération est CLOISONNÉE à leurs
--     départements (profiles.mod_depts) ;
--   * les modérateurs actuels sont rattachés au 04.
--
-- CANDIDATURES : n'importe quel membre peut postuler pour devenir modérateur
-- d'un ou plusieurs départements ; un modérateur peut demander à élargir sa
-- zone. Chaque demande notifie le propriétaire, qui accepte ou refuse.
--
-- CONVENTION mod_depts : NULL = tous les départements (le propriétaire, et
-- filet de sécurité) ; sinon la liste exacte, ex. {'04','84'}.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. La zone de chaque modérateur
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists mod_depts text[];

comment on column public.profiles.mod_depts is
  'Départements que ce modérateur peut modérer. NULL = tous (propriétaire). '
  'Modifiable uniquement par le propriétaire (trigger guard_profile_role).';

-- Les modérateurs déjà en place sont rattachés au 04 (décision de Matthieu).
update public.profiles
   set mod_depts = array['04']
 where role = 'admin'
   and not is_owner
   and mod_depts is null;

-- Ce membre peut-il modérer un événement de ce département ?
--  - propriétaire : toujours ;
--  - modérateur : si sa zone couvre le département, ou si l'événement n'en a
--    pas (hors territoire, sans coordonnées) — personne d'autre ne le verrait.
create or replace function public.can_moderate(p_dept text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when public.am_i_owner() then true
    else exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role = 'admin'
        and (p.mod_depts is null or p_dept is null or p_dept = any(p.mod_depts))
    )
  end;
$$;

-- Appelée par les politiques RLS : l'utilisateur courant doit pouvoir
-- l'exécuter. Elle répond false aux anonymes, sans rien révéler.
grant execute on function public.can_moderate(text) to anon, authenticated;

-- Même règle pour am_i_owner : les politiques storage ci-dessous l'évaluent,
-- et une politique s'exécute avec les droits du rôle COURANT. La 0012 l'avait
-- révoquée pour anon (elle n'était alors appelée que par des RPC definer) ;
-- sans ce grant, toute requête anonyme sur storage.objects lèverait
-- « permission denied for function am_i_owner » au lieu d'être filtrée.
-- (Précédent documenté en 0008 pour is_admin : même invariant.)
grant execute on function public.am_i_owner() to anon;

-- -----------------------------------------------------------------------------
-- B. Garde-fou des profils, durci
-- -----------------------------------------------------------------------------
-- Avant : un admin pouvait changer les rôles. Désormais rôle ET zone de
-- modération ne bougent que par le propriétaire (ou un contexte serveur).
create or replace function public.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    if new.is_owner is distinct from old.is_owner then
      raise exception 'Le statut de propriétaire ne se modifie pas depuis l''application.';
    end if;
    if old.is_owner and new.role is distinct from old.role then
      raise exception 'Le compte propriétaire ne peut pas être retiré des administrateurs.';
    end if;
    if (new.role is distinct from old.role
        or new.mod_depts is distinct from old.mod_depts)
       and not public.am_i_owner() then
      raise exception 'Seul le propriétaire peut modifier les rôles et les zones de modération.';
    end if;
    -- Le mur des soutiens : le droit d'UPDATE de PostgREST couvre la table
    -- entière, n'importe qui pouvait donc s'y inscrire lui-même par un PATCH
    -- direct de sa ligne. Le marquage passe par le propriétaire uniquement
    -- (set_supporter_by_email) ; supporter_public reste libre, c'est la
    -- visibilité que chacun choisit pour son propre nom.
    if new.supporter_since is distinct from old.supporter_since
       and not public.am_i_owner() then
      raise exception 'Seul le propriétaire marque les soutiens.';
    end if;
  end if;
  return new;
end;
$$;

-- Le journal trace aussi les changements de zone (qui a étendu qui, quand).
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

  if new.mod_depts is distinct from old.mod_depts then
    insert into public.admin_actions
      (actor_id, action, target_kind, target_id, target_label, details)
    values
      (auth.uid(), 'moderator_depts', 'profile', new.id,
       coalesce(new.display_name, '(sans nom)'),
       jsonb_build_object('avant', to_jsonb(old.mod_depts), 'apres', to_jsonb(new.mod_depts)));
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

-- -----------------------------------------------------------------------------
-- C. Politiques : la modération est cloisonnée par département
-- -----------------------------------------------------------------------------
drop policy if exists events_update_admin on public.events;
create policy events_update_moderator
  on public.events for update
  using (public.can_moderate(dept))
  with check (public.can_moderate(dept));

-- ⚠ Les politiques de 0001 sur les ÉVÉNEMENTS DE L'AUTEUR passaient par
-- is_admin() : un modérateur du 05 aurait pu publier SES événements
-- directement approuvés dans le 04 (insert status='approved'), sans passer
-- par le modérateur du 04 — l'auto-approbation contournait le cloisonnement.
-- Le trigger set_event_dept (BEFORE) remplit new.dept avant l'évaluation du
-- WITH CHECK : can_moderate(dept) y voit donc le vrai département du lieu.
drop policy if exists events_insert_own on public.events;
create policy events_insert_own
  on public.events for insert
  with check (
    created_by = auth.uid()
    and (status = 'pending' or public.can_moderate(dept))
  );

drop policy if exists events_update_own on public.events;
create policy events_update_own
  on public.events for update
  using (created_by = auth.uid())
  with check (
    created_by = auth.uid()
    and (status in ('pending', 'rejected') or public.can_moderate(dept))
  );

-- NOTE ASSUMÉE : la politique de LECTURE (events_select_visible, 0001) laisse
-- tout modérateur VOIR les événements en attente des autres départements —
-- contenu destiné au public, relu par des personnes choisies par le
-- propriétaire. Seules les ACTIONS (approuver, modifier, supprimer) sont
-- cloisonnées ; l'écran, lui, filtre l'affichage par zone.

drop policy if exists events_delete_own_or_admin on public.events;
create policy events_delete_own_or_moderator
  on public.events for delete
  using (created_by = auth.uid() or public.can_moderate(dept));

-- Photos (table) : l'auteur, ou un modérateur DU département de l'événement.
drop policy if exists event_photos_insert_author on public.event_photos;
create policy event_photos_insert_author
  on public.event_photos for insert
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_photos.event_id
        and (e.created_by = auth.uid() or public.can_moderate(e.dept))
    )
  );

drop policy if exists event_photos_update_author on public.event_photos;
create policy event_photos_update_author
  on public.event_photos for update
  using (
    exists (
      select 1 from public.events e
      where e.id = event_photos.event_id
        and (e.created_by = auth.uid() or public.can_moderate(e.dept))
    )
  );

drop policy if exists event_photos_delete_author on public.event_photos;
create policy event_photos_delete_author
  on public.event_photos for delete
  using (
    exists (
      select 1 from public.events e
      where e.id = event_photos.event_id
        and (e.created_by = auth.uid() or public.can_moderate(e.dept))
    )
  );

-- Photos (fichiers Storage) : même cloisonnement. Le chemin est
-- {uid}/{eventId}/fichier → (storage.foldername(name))[2] est l'eventId.
drop policy if exists event_photos_select_own_or_admin on storage.objects;
create policy event_photos_select_own_or_admin
  on storage.objects for select
  using (
    bucket_id = 'event-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.am_i_owner()
      or exists (
        select 1 from public.events e
        where e.id::text = (storage.foldername(name))[2]
          and public.can_moderate(e.dept)
      )
    )
  );

drop policy if exists event_photos_delete_admin on storage.objects;
create policy event_photos_delete_admin
  on storage.objects for delete
  using (
    bucket_id = 'event-photos'
    and (
      public.am_i_owner()
      or exists (
        select 1 from public.events e
        where e.id::text = (storage.foldername(name))[2]
          and public.can_moderate(e.dept)
      )
    )
  );

drop policy if exists event_photos_update_admin on storage.objects;
create policy event_photos_update_admin
  on storage.objects for update
  using (
    bucket_id = 'event-photos'
    and (
      public.am_i_owner()
      or exists (
        select 1 from public.events e
        where e.id::text = (storage.foldername(name))[2]
          and public.can_moderate(e.dept)
      )
    )
  );

-- Messages « Nous contacter » et signalements : PROPRIÉTAIRE UNIQUEMENT
-- (les modérateurs n'ont que la modération et les statistiques).
drop policy if exists feedback_select_admin on public.feedback;
create policy feedback_select_owner
  on public.feedback for select
  using (public.am_i_owner());

drop policy if exists feedback_delete_admin on public.feedback;
create policy feedback_delete_owner
  on public.feedback for delete
  using (public.am_i_owner());

-- Profils : un modérateur ne modifie plus que le sien.
drop policy if exists profiles_update_self_or_admin on public.profiles;
create policy profiles_update_self_or_owner
  on public.profiles for update
  using (id = auth.uid() or public.am_i_owner())
  with check (id = auth.uid() or public.am_i_owner());

-- -----------------------------------------------------------------------------
-- D. Fonctions réservées au propriétaire (elles étaient ouvertes aux admins)
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
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire';
  end if;

  select u.id into target_id
  from auth.users u
  where lower(u.email) = lower(trim(target_email))
  limit 1;

  if target_id is null then
    raise exception 'Aucun compte avec cet e-mail (la personne doit d''abord créer son compte).';
  end if;

  if not make_admin and target_id = auth.uid() then
    raise exception 'Vous ne pouvez pas retirer votre propre rôle.';
  end if;

  if not make_admin
     and exists (select 1 from public.profiles p where p.id = target_id and p.is_owner) then
    raise exception 'Le compte propriétaire ne peut pas être retiré.';
  end if;

  -- Une promotion par e-mail rattache au 04 par défaut : la zone s'ajuste
  -- ensuite depuis l'écran Modérateurs.
  insert into public.profiles as p (id, role, mod_depts)
  values (target_id,
          case when make_admin then 'admin' else 'user' end,
          case when make_admin then array['04'] else null end)
  on conflict on constraint profiles_pkey do update
    set role = excluded.role,
        mod_depts = excluded.mod_depts;

  return query
    select p.id, p.display_name, p.role from public.profiles p where p.id = target_id;
end;
$$;

create or replace function public.set_admin_by_id(target_id uuid, make_admin boolean)
returns table(id uuid, display_name text, role text, is_owner boolean)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire';
  end if;

  if target_id is null
     or not exists (select 1 from public.profiles p where p.id = target_id) then
    raise exception 'Membre introuvable.';
  end if;

  if not make_admin and target_id = auth.uid() then
    raise exception 'Vous ne pouvez pas retirer votre propre rôle.';
  end if;

  if not make_admin
     and exists (select 1 from public.profiles p where p.id = target_id and p.is_owner) then
    raise exception 'Le compte propriétaire ne peut pas être retiré.';
  end if;

  update public.profiles p
     set role = case when make_admin then 'admin' else 'user' end,
         mod_depts = case when make_admin then coalesce(p.mod_depts, array['04']) else null end
   where p.id = target_id;

  return query
    select p.id, p.display_name, p.role, p.is_owner
    from public.profiles p
    where p.id = target_id;
end;
$$;

-- Désigner un modérateur AVEC sa zone (le chemin normal désormais).
-- p_depts vide ou null = retirer le rôle.
create or replace function public.set_moderator(p_target uuid, p_depts text[])
returns table(id uuid, display_name text, role text, mod_depts text[])
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  propre text[];
begin
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire';
  end if;
  if p_target is null
     or not exists (select 1 from public.profiles p where p.id = p_target) then
    raise exception 'Membre introuvable.';
  end if;
  if exists (select 1 from public.profiles p where p.id = p_target and p.is_owner) then
    raise exception 'Le propriétaire n''a pas de zone : il a déjà tous les droits.';
  end if;

  select array_agg(distinct d order by d) into propre
  from unnest(coalesce(p_depts, array[]::text[])) as d
  where d in ('04','05','13','26','83','84');

  if propre is null or array_length(propre, 1) is null then
    update public.profiles p set role = 'user', mod_depts = null where p.id = p_target;
  else
    update public.profiles p set role = 'admin', mod_depts = propre where p.id = p_target;
  end if;

  return query
    select p.id, p.display_name, p.role, p.mod_depts
    from public.profiles p
    where p.id = p_target;
end;
$$;

revoke execute on function public.set_moderator(uuid, text[]) from public, anon;
grant execute on function public.set_moderator(uuid, text[]) to authenticated;

-- La liste des modérateurs expose désormais leur zone (type de retour changé
-- → drop obligatoire), et n'est plus lisible que par le propriétaire.
drop function if exists public.list_admins();
create function public.list_admins()
returns table(id uuid, display_name text, email text, is_owner boolean, mod_depts text[])
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire';
  end if;
  return query
    select p.id, p.display_name, u.email::text, p.is_owner, p.mod_depts
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.role = 'admin' or p.is_owner
    order by p.is_owner desc, p.display_name nulls last, u.email;
end;
$$;

revoke execute on function public.list_admins() from public, anon;
grant execute on function public.list_admins() to authenticated;

-- Membres, fiche membre, marquage de soutien, purge : propriétaire seulement.
create or replace function public.list_members()
returns table (id uuid, display_name text, role text, created_at timestamptz, is_owner boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire';
  end if;
  return query
    select p.id, p.display_name, p.role, p.created_at, p.is_owner
    from public.profiles p
    order by p.created_at desc;
end;
$$;

-- La fiche expose désormais la zone de modération (type de retour changé →
-- drop obligatoire), et n'est plus lisible que par le propriétaire.
drop function if exists public.member_profile(uuid);
create function public.member_profile(p_id uuid)
returns table (
  id uuid, display_name text, email text, role text, is_owner boolean,
  mod_depts text[],
  created_at timestamptz, supporter_since timestamptz,
  events_total int, events_pending int, last_seen date
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire';
  end if;
  if p_id is null or not exists (select 1 from public.profiles p where p.id = p_id) then
    raise exception 'Membre introuvable.';
  end if;
  return query
    select
      p.id, p.display_name, u.email::text, p.role, p.is_owner,
      p.mod_depts,
      p.created_at, p.supporter_since,
      (select count(*)::int from public.events e where e.created_by = p.id),
      (select count(*)::int from public.events e
        where e.created_by = p.id and e.status = 'pending'),
      (select max(v.day) from public.app_visits v where v.user_id = p.id)
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.id = p_id;
end;
$$;

revoke execute on function public.member_profile(uuid) from public, anon;
grant execute on function public.member_profile(uuid) to authenticated;

-- ⚠ Corps repris de 0010 À L'IDENTIQUE (mêmes noms de paramètres, même type de
-- retour — CREATE OR REPLACE refuse d'en changer, et le client appelle par noms).
-- Seule modification : le contrôle d'accès passe au propriétaire.
create or replace function public.set_supporter_by_email(target_email text, is_supporter boolean)
returns table (id uuid, display_name text, supporter_since timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  target_id uuid;
begin
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire';
  end if;

  select u.id into target_id
  from auth.users u
  where lower(u.email) = lower(trim(target_email))
  limit 1;

  if target_id is null then
    raise exception 'Aucun compte avec cet e-mail (la personne doit d''abord créer son compte).';
  end if;

  -- coalesce : re-marquer quelqu'un ne réinitialise pas son ancienneté.
  update public.profiles p
     set supporter_since = case
           when is_supporter then coalesce(p.supporter_since, now())
           else null
         end
   where p.id = target_id;

  return query
    select p.id, p.display_name, p.supporter_since
    from public.profiles p
    where p.id = target_id;
end;
$$;

create or replace function public.expired_events_before_month()
returns table (id uuid, storage_path text)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, p.storage_path
  from public.events e
  left join public.event_photos p on p.event_id = e.id
  where coalesce(e.ends_at, e.starts_at)
        < (date_trunc('month', (now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris')
    and public.am_i_owner();
$$;

-- -----------------------------------------------------------------------------
-- E. Ce que voit un modérateur : sa zone, sa file
-- -----------------------------------------------------------------------------
create or replace function public.my_mod_depts()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select p.mod_depts from public.profiles p where p.id = auth.uid();
$$;

revoke execute on function public.my_mod_depts() from public, anon;
grant execute on function public.my_mod_depts() to authenticated;

-- Compteur du badge « Modération » : seulement CE QUE JE PEUX modérer.
-- L'ancien compteur comptait tous les pending, il aurait menti à un
-- modérateur cloisonné.
create or replace function public.my_pending_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.events e
  where e.status = 'pending'
    and public.can_moderate(e.dept);
$$;

revoke execute on function public.my_pending_count() from public, anon;
grant execute on function public.my_pending_count() to authenticated;

-- -----------------------------------------------------------------------------
-- F. Candidatures (« Devenir modérateur » et extensions de zone)
-- -----------------------------------------------------------------------------
create table if not exists public.moderator_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  depts      text[] not null,
  message    text check (message is null or length(message) <= 1000),
  status     text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid
);

-- Une seule candidature EN ATTENTE par personne ; l'historique reste.
create unique index if not exists moderator_requests_one_pending
  on public.moderator_requests (user_id) where status = 'pending';

alter table public.moderator_requests enable row level security;
-- Table fermée : tout passe par les fonctions ci-dessous.
revoke all on public.moderator_requests from anon, authenticated;

-- Postuler — ou, pour un modérateur, demander des départements EN PLUS.
create or replace function public.apply_moderator(p_depts text[], p_message text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  propre text[];
  demande_id uuid;
  demandeur text;
begin
  if auth.uid() is null then
    raise exception 'Connexion requise';
  end if;
  if public.am_i_owner() then
    raise exception 'Vous avez déjà tous les droits.';
  end if;
  if exists (select 1 from public.moderator_requests r
              where r.user_id = auth.uid() and r.status = 'pending') then
    raise exception 'Vous avez déjà une candidature en attente de réponse.';
  end if;

  select array_agg(distinct d order by d) into propre
  from unnest(coalesce(p_depts, array[]::text[])) as d
  where d in ('04','05','13','26','83','84');

  if propre is null or array_length(propre, 1) is null then
    raise exception 'Choisissez au moins un département.';
  end if;

  -- Un modérateur ne demande que ce qu'il n'a pas déjà.
  select array_agg(d order by d) into propre
  from unnest(propre) as d
  where not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin' and d = any(coalesce(p.mod_depts, array[]::text[]))
  );
  if propre is null or array_length(propre, 1) is null then
    raise exception 'Vous modérez déjà ces départements.';
  end if;

  insert into public.moderator_requests (user_id, depts, message)
  values (auth.uid(), propre, nullif(trim(coalesce(p_message, '')), ''))
  returning id into demande_id;

  -- Notifie le propriétaire, par le canal « messages » qu'il a déjà activé.
  select coalesce(display_name, 'Un membre') into demandeur
  from public.profiles where id = auth.uid();
  insert into public.notification_queue (kind, title, body, url)
  values ('messages', 'Candidature de modérateur',
          demandeur || ' — ' || array_to_string(propre, ', '),
          '/#/candidatures');

  return demande_id;
end;
$$;

revoke execute on function public.apply_moderator(text[], text) from public, anon;
grant execute on function public.apply_moderator(text[], text) to authenticated;

-- Ma candidature la plus récente (état affiché dans l'app).
create or replace function public.my_moderator_request()
returns table (id uuid, depts text[], message text, status text,
               created_at timestamptz, decided_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.depts, r.message, r.status, r.created_at, r.decided_at
  from public.moderator_requests r
  where r.user_id = auth.uid()
  order by r.created_at desc
  limit 1;
$$;

revoke execute on function public.my_moderator_request() from public, anon;
grant execute on function public.my_moderator_request() to authenticated;

-- Toutes les candidatures (propriétaire) : en attente d'abord, puis l'historique.
create or replace function public.list_moderator_requests()
returns table (
  id uuid, user_id uuid, display_name text, email text,
  depts text[], message text, status text,
  created_at timestamptz, decided_at timestamptz,
  role_actuel text, depts_actuels text[]
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire';
  end if;
  return query
    select r.id, r.user_id,
           coalesce(p.display_name, '(sans nom)'), u.email::text,
           r.depts, r.message, r.status, r.created_at, r.decided_at,
           p.role, p.mod_depts
    from public.moderator_requests r
    join public.profiles p on p.id = r.user_id
    join auth.users u on u.id = r.user_id
    order by (r.status = 'pending') desc, r.created_at desc
    limit 100;
end;
$$;

revoke execute on function public.list_moderator_requests() from public, anon;
grant execute on function public.list_moderator_requests() to authenticated;

-- Trancher. Accepter = promouvoir + AJOUTER les départements demandés à la
-- zone existante (une extension ne remplace pas, elle complète).
create or replace function public.decide_moderator_request(p_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  demande record;
begin
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire';
  end if;

  select * into demande
  from public.moderator_requests
  where id = p_id and status = 'pending'
  for update;
  if demande is null then
    raise exception 'Candidature introuvable ou déjà tranchée.';
  end if;

  if p_accept then
    update public.profiles p
       set role = 'admin',
           mod_depts = (
             select array_agg(distinct d order by d)
             from unnest(coalesce(p.mod_depts, array[]::text[]) || demande.depts) as d
           )
     where p.id = demande.user_id;
  end if;

  update public.moderator_requests
     set status = case when p_accept then 'approved' else 'rejected' end,
         decided_at = now(),
         decided_by = auth.uid()
   where id = p_id;
end;
$$;

revoke execute on function public.decide_moderator_request(uuid, boolean) from public, anon;
grant execute on function public.decide_moderator_request(uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- G. Notifications de modération routées par département
-- -----------------------------------------------------------------------------
alter table public.notification_queue add column if not exists dept text;

create or replace function public.enqueue_event_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    insert into public.notification_queue (kind, title, body, url, dept)
    values ('moderation', 'Un événement à valider',
            left(new.title, 120), '/#/moderation', new.dept);
  elsif tg_op = 'UPDATE'
        and new.status = 'approved'
        and old.status is distinct from 'approved' then
    insert into public.notification_queue (kind, title, body, url, dept)
    values ('nouveaux_evenements', 'Nouvel événement dans l''agenda',
            left(new.title, 120), '/#/evenement?id=' || new.id, new.dept);
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Vérification — tout doit être vrai
-- -----------------------------------------------------------------------------
-- ⚠ N'appelle aucune fonction réservée (SQL Editor = pas d'utilisateur).
select
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='profiles'
             and column_name='mod_depts')                                        as zone_moderateurs,
  (select count(*) from public.profiles
    where role='admin' and not is_owner and mod_depts is null) = 0               as moderateurs_rattaches_au_04,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='can_moderate')                as fonction_cloisonnement,
  exists (select 1 from pg_policies
           where schemaname='public' and tablename='events'
             and policyname='events_update_moderator')                           as politique_moderation,
  (select with_check like '%can_moderate%' from pg_policies
    where schemaname='public' and tablename='events'
      and policyname='events_insert_own')                                        as auto_approbation_cloisonnee,
  (select has_function_privilege('anon', 'public.am_i_owner()', 'execute'))      as am_i_owner_evaluable_par_anon,
  exists (select 1 from pg_policies
           where schemaname='public' and tablename='feedback'
             and policyname='feedback_select_owner')                             as messages_proprietaire_seul,
  exists (select 1 from information_schema.tables
           where table_schema='public' and table_name='moderator_requests')      as table_candidatures,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='apply_moderator')             as fonction_postuler,
  exists (select 1 from information_schema.columns
           where table_schema='public' and table_name='notification_queue'
             and column_name='dept')                                             as notifications_routees;

-- =============================================================================
-- Fin de migration 0020
-- =============================================================================
