-- =============================================================================
-- Migration 0030 — distinguer les messages lus des nouveaux
-- =============================================================================
--
-- Demande de Matthieu : le compteur « Messages reçus » affichait le TOTAL,
-- messages déjà lus compris. Il ne doit compter que les nouveaux.
--
-- ⚠ POURQUOI EN BASE ET PAS DANS LE TÉLÉPHONE. Retenir la dernière visite dans
-- le stockage du navigateur aurait évité cette migration — mais l'état « lu »
-- serait resté propre à chaque appareil : lus sur le téléphone, les messages
-- seraient restés « nouveaux » sur l'ordinateur. C'est précisément le genre de
-- compteur faux dont on veut se débarrasser. Une boîte de réception garde son
-- état « lu » côté serveur.
--
-- ⚠ AUCUNE POLITIQUE DE MISE À JOUR SUR LA TABLE, À DESSEIN. `feedback` n'en a
-- jamais eu : avec la RLS active, toute mise à jour est donc refusée, et un
-- message est immuable. En ouvrir une pour marquer la lecture permettrait
-- aussi, par un PATCH direct, de RÉÉCRIRE le texte d'un message. La fonction
-- ci-dessous ne touche qu'à `read_at`, et au propriétaire seul.
-- (C'est bien la RLS qui protège, pas l'absence de GRANT : Supabase accorde
--  par défaut tous les droits sur les tables du schéma public.)
-- =============================================================================

alter table public.feedback add column if not exists read_at timestamptz;

-- ⚠ LES MESSAGES DÉJÀ PRÉSENTS SONT MARQUÉS LUS. Matthieu les a lus — c'est
-- même ce qui a motivé la demande. Sans cette ligne, la mise en place ferait
-- apparaître d'un coup TOUT l'historique comme nouveau : l'inverse du but.
update public.feedback set read_at = now() where read_at is null;

-- Marque comme lus tous les messages encore non lus. Renvoie leur nombre.
-- Appelée à l'ouverture de l'écran « Messages », après leur chargement.
create or replace function public.mark_feedback_read()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  -- `auth.uid()` lit l'identité de l'APPELANT même en SECURITY DEFINER : la
  -- garde porte bien sur la personne connectée, pas sur le rôle d'exécution.
  if not public.am_i_owner() then
    raise exception 'Réservé au propriétaire du projet.';
  end if;
  update public.feedback set read_at = now() where read_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.mark_feedback_read() from public, anon;
grant execute on function public.mark_feedback_read() to authenticated;

-- -----------------------------------------------------------------------------
-- Vérification — les cinq doivent être vrais
-- -----------------------------------------------------------------------------
-- ⚠ N'appelle pas la fonction : l'éditeur SQL n'a pas d'utilisateur connecté,
-- elle y lèverait l'exception « réservé au propriétaire ».
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'feedback'
      and column_name = 'read_at') = 1                        as colonne_ajoutee,
  (select count(*) = 0 from public.feedback where read_at is null)
                                                              as historique_marque_lu,
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'mark_feedback_read')
                                                              as fonction_definer,
  has_function_privilege('authenticated', 'public.mark_feedback_read()', 'execute')
                                                              as ouverte_aux_connectes,
  -- La table reste fermée en écriture : c'est tout l'intérêt de passer par la
  -- fonction. ⚠ On teste la RLS et NON le privilège : Supabase accorde par
  -- défaut l'UPDATE sur les tables du schéma public, si bien qu'un test du
  -- privilège afficherait faux alors que tout va bien. Si ceci devient faux,
  -- quelqu'un a ajouté une politique de mise à jour directe.
  (select count(*) = 0 from pg_policies
    where schemaname = 'public' and tablename = 'feedback'
      and cmd in ('UPDATE', 'ALL'))                           as table_toujours_immuable;

-- =============================================================================
-- Fin de migration 0030
-- =============================================================================
