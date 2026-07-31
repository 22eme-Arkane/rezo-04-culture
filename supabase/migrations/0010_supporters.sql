-- =============================================================================
-- Armana — Migration 0010 : mur des soutiens
-- =============================================================================
-- Les dons passent par PayPal.me : aucun service ne prévient l'application quand
-- quelqu'un envoie de l'argent. C'est donc un ADMIN qui marque une personne comme
-- soutien (il le voit dans ses notifications PayPal), et l'application affiche un
-- mur de remerciements.
--
-- RESPECT DE LA VIE PRIVÉE : apparaître publiquement comme donateur est une
-- information personnelle. Chacun peut se retirer du mur depuis son Profil
-- (`supporter_public`), sans perdre son statut de soutien.
--
-- Aucune somme n'est stockée : uniquement « a soutenu » et depuis quand.
-- =============================================================================

alter table public.profiles
  add column if not exists supporter_since  timestamptz;
alter table public.profiles
  add column if not exists supporter_public boolean not null default true;

-- ---------------------------------------------------------------------------
-- Mur public : uniquement les noms d'affichage, pour ceux qui l'acceptent.
-- SECURITY DEFINER → les colonnes supporter_* n'ont pas besoin d'être exposées
-- à la table (l'annuaire des membres reste fermé, cf. migration 0009).
-- ---------------------------------------------------------------------------
create or replace function public.list_supporters()
returns table (display_name text, since timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(p.display_name, ''), 'Un anonyme généreux'), p.supporter_since
  from public.profiles p
  where p.supporter_since is not null
    and p.supporter_public
  order by p.supporter_since asc;
$$;

revoke execute on function public.list_supporters() from public;
grant execute on function public.list_supporters() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Marquer / retirer un soutien (admin uniquement), par e-mail.
-- ---------------------------------------------------------------------------
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

revoke execute on function public.set_supporter_by_email(text, boolean) from public, anon;
grant execute on function public.set_supporter_by_email(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Chacun voit son propre statut et choisit d'apparaître ou non sur le mur.
-- ---------------------------------------------------------------------------
create or replace function public.my_supporter_status()
returns table (is_supporter boolean, is_public boolean)
language sql
stable
security definer
set search_path = public
as $$
  select (p.supporter_since is not null), p.supporter_public
  from public.profiles p
  where p.id = auth.uid();
$$;

revoke execute on function public.my_supporter_status() from public, anon;
grant execute on function public.my_supporter_status() to authenticated;

create or replace function public.set_supporter_visibility(is_public boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set supporter_public = coalesce(is_public, true)
   where id = auth.uid();
$$;

revoke execute on function public.set_supporter_visibility(boolean) from public, anon;
grant execute on function public.set_supporter_visibility(boolean) to authenticated;

-- =============================================================================
-- Fin de migration 0010
-- =============================================================================
