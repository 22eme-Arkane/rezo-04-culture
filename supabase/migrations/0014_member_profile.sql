-- =============================================================================
-- Armana — Migration 0014 : fiche d'un membre (administrateurs)
-- =============================================================================
-- BESOIN
-- Depuis l'écran Membres, ouvrir la fiche d'une personne pour la désigner
-- administrateur et surtout pouvoir lui écrire — donc voir son adresse e-mail.
--
-- CHOIX : une RPC par membre, et NON l'ajout de l'e-mail à `list_members`
-- La liste complète des inscrits circulerait alors avec toutes les adresses à
-- chaque ouverture de l'écran. Ici, une adresse n'est lue que lorsqu'un
-- administrateur ouvre délibérément une fiche.
--
-- Ce n'est pas une nouvelle capacité : un administrateur du projet a déjà accès
-- aux adresses via le tableau de bord Supabase. On rend seulement utilisable ce
-- qui l'était déjà — sans jamais l'ouvrir au-delà des administrateurs.
-- =============================================================================

create or replace function public.member_profile(p_id uuid)
returns table (
  id              uuid,
  display_name    text,
  email           text,
  role            text,
  is_owner        boolean,
  created_at      timestamptz,
  supporter_since timestamptz,
  events_total    int,
  events_pending  int,
  last_seen       date
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Réservé aux administrateurs';
  end if;

  if p_id is null or not exists (select 1 from public.profiles p where p.id = p_id) then
    raise exception 'Membre introuvable.';
  end if;

  return query
    select
      p.id,
      p.display_name,
      u.email::text,
      p.role,
      p.is_owner,
      p.created_at,
      p.supporter_since,
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

-- -----------------------------------------------------------------------------
-- Vérification — doit afficher « true »
-- -----------------------------------------------------------------------------
select exists (
  select 1 from information_schema.routines
   where routine_schema = 'public' and routine_name = 'member_profile'
) as fonction_fiche_membre;

-- =============================================================================
-- Fin de migration 0014
-- =============================================================================
