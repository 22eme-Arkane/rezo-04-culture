-- =============================================================================
-- Armana — Migration 0022 : la LISTE des membres s'ouvre aux modérateurs,
--                           la FICHE reste au propriétaire
-- =============================================================================
-- ⚠ À APPLIQUER APRÈS LES 0019, 0020 ET 0021.
--
-- CE QUE MATTHIEU A CORRIGÉ
-- Les modérateurs doivent voir les statistiques ET la liste des membres. En
-- revanche, ouvrir la FICHE d'un membre reste réservé à Matthieu.
--
-- POURQUOI CETTE FRONTIÈRE TIENT DEBOUT
-- Les deux fonctions ne montrent pas du tout la même chose :
--   * list_members()   → nom affiché, rôle, date d'inscription. AUCUN e-mail.
--   * member_profile() → l'ADRESSE E-MAIL, le statut de soutien, la date de
--                        dernière venue, le nombre de publications.
-- Ouvrir la première ne divulgue donc aucune donnée de contact. La seconde,
-- elle, reste fermée — c'est là que vit la donnée personnelle.
--
-- L'écran masque déjà le chevron et le lien pour un modérateur, mais c'est ce
-- fichier qui fait autorité : un appel direct à member_profile() est refusé.
-- =============================================================================

create or replace function public.list_members()
returns table (id uuid, display_name text, role text, created_at timestamptz, is_owner boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Modérateurs ET propriétaire. `is_admin()` couvre les deux : le compte
  -- propriétaire porte aussi role = 'admin'.
  if not public.is_admin() then
    raise exception 'Réservé aux modérateurs';
  end if;
  return query
    select p.id, p.display_name, p.role, p.created_at, p.is_owner
    from public.profiles p
    order by p.created_at desc;
end;
$$;

-- (member_profile n'est PAS touchée : elle expose l'e-mail et reste réservée
--  au propriétaire, telle que la 0020 l'a définie.)

-- -----------------------------------------------------------------------------
-- Vérification — tout doit être vrai
-- -----------------------------------------------------------------------------
-- ⚠ N'appelle aucune fonction réservée (le SQL Editor n'a pas d'utilisateur).
select
  (select pg_get_functiondef(p.oid) like '%public.is_admin()%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='list_members')                       as liste_ouverte_aux_moderateurs,
  (select pg_get_functiondef(p.oid) like '%am_i_owner()%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='member_profile')                     as fiche_reservee_au_proprietaire,
  (select pg_get_functiondef(p.oid) not like '%email%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='list_members')                       as liste_sans_adresse_email;

-- =============================================================================
-- Fin de migration 0022
-- =============================================================================
