-- =============================================================================
-- Armana — Migration 0026 : ouverture à toute la région PACA
-- =============================================================================
-- ⚠ À APPLIQUER APRÈS LES 0019 À 0025.
--
-- Armana couvrait le 04, le 05 et le 84. Elle couvre désormais les SIX
-- départements de Provence-Alpes-Côte d'Azur : 04, 05, 06, 13, 83 et 84.
--
-- CE QUI CHANGE VRAIMENT EN BASE
-- Le 13 et le 83 étaient déjà connus de `dept_contours` (préparés en 0019),
-- seule leur ouverture côté application manquait. Le **06 est entièrement
-- nouveau** : sans son contour ici, tout événement des Alpes-Maritimes serait
-- enregistré avec `dept = NULL` — donc invisible dans la file d'un modérateur
-- cloisonné, absent du routage des notifications et des statistiques par
-- département.
--
-- La Drôme (26) reste connue mais FERMÉE : elle n'appartient pas à PACA. Son
-- contour et son code restent acceptés partout, prêts si l'on veut l'ouvrir.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. La contrainte d'abord : sans elle, l'insertion du 06 serait refusée
-- -----------------------------------------------------------------------------
-- ⚠ ORDRE IMPORTANT. `events_dept_valide` (0019) n'autorisait pas '06' : le
-- rattrapage plus bas échouerait, et avec lui toute la migration.
alter table public.events drop constraint if exists events_dept_valide;
alter table public.events
  add constraint events_dept_valide
  check (dept is null or dept in ('04','05','06','13','26','83','84'))
  not valid;

-- -----------------------------------------------------------------------------
-- B. Le contour des Alpes-Maritimes
-- -----------------------------------------------------------------------------
-- Version allégée (~0,8 km de tolérance), issue du MÊME jeu Etalab que les six
-- autres — vérifié : 413 sommets exactement partagés avec le 04 et 246 avec le
-- 83. Un contour d'une autre source ferait apparaître un liseré entre voisins.
insert into public.dept_contours (code, geom) values
  ('06', ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_Multi(ST_GeomFromGeoJSON('{"type":"MultiPolygon","coordinates":[[[[7.0478,43.5045],[7.0371,43.5085],[7.0554,43.5078],[7.0478,43.5045]]],[[[6.8874,44.361],[6.9226,44.3507],[6.9272,44.3324],[6.9605,44.3109],[6.9575,44.2951],[6.9957,44.2799],[7.0085,44.2352],[7.0388,44.2237],[7.0768,44.2322],[7.1436,44.2001],[7.1861,44.2013],[7.2194,44.1685],[7.2409,44.1734],[7.2814,44.1409],[7.3419,44.1459],[7.358,44.116],[7.3929,44.125],[7.4248,44.1119],[7.4298,44.1298],[7.4607,44.1258],[7.5648,44.1552],[7.62,44.1495],[7.6366,44.1771],[7.6778,44.1768],[7.6708,44.1529],[7.6795,44.1472],[7.6666,44.1311],[7.7188,44.0825],[7.7005,44.0407],[7.6623,44.0282],[7.6704,43.9983],[7.6524,43.9737],[7.5694,43.9474],[7.562,43.8997],[7.4979,43.8717],[7.4967,43.8498],[7.5302,43.788],[7.4902,43.7672],[7.4868,43.749],[7.4578,43.7596],[7.4058,43.7194],[7.3559,43.7207],[7.3298,43.7025],[7.3497,43.687],[7.3313,43.6745],[7.3147,43.7065],[7.304,43.6848],[7.2842,43.6978],[7.2406,43.6878],[7.2116,43.6473],[7.1945,43.6579],[7.157,43.6535],[7.1373,43.6363],[7.1218,43.587],[7.1406,43.5689],[7.1364,43.5446],[7.119,43.5429],[7.1217,43.5595],[7.0963,43.5709],[7.0377,43.5347],[7.0166,43.5508],[6.9718,43.5455],[6.9384,43.5164],[6.957,43.5008],[6.9337,43.4801],[6.8842,43.5025],[6.8964,43.5272],[6.8788,43.5292],[6.8878,43.5527],[6.9082,43.5639],[6.8984,43.5816],[6.912,43.5983],[6.8943,43.6115],[6.8517,43.6044],[6.8168,43.6298],[6.7987,43.6282],[6.7608,43.6665],[6.7742,43.7036],[6.7525,43.7411],[6.715,43.7387],[6.6827,43.7579],[6.6574,43.7487],[6.6354,43.7857],[6.712,43.8149],[6.6679,43.8306],[6.6782,43.852],[6.7028,43.856],[6.6962,43.8755],[6.6733,43.888],[6.7484,43.8717],[6.7816,43.8835],[6.7986,43.9097],[6.8323,43.9185],[6.8846,43.8891],[6.944,43.8995],[6.9133,43.9278],[6.8843,43.935],[6.8755,43.9528],[6.8476,43.9544],[6.8387,43.9897],[6.7471,44.0409],[6.7565,44.0796],[6.7076,44.1245],[6.7073,44.1444],[6.6865,44.1692],[6.7176,44.2082],[6.724,44.2498],[6.7591,44.2621],[6.7635,44.2796],[6.7903,44.2723],[6.7865,44.2895],[6.8089,44.3305],[6.8874,44.361]]]]}')), 4326)), 3))
on conflict (code) do update set geom = excluded.geom;

-- -----------------------------------------------------------------------------
-- C. Rattrapage des événements déjà publiés
-- -----------------------------------------------------------------------------
-- Un événement des Alpes-Maritimes créé avant aujourd'hui porte `dept = NULL`.
-- On les rattache maintenant que le contour existe. Les autres ne bougent pas.
update public.events
   set dept = public.dept_of_point(location)
 where location is not null
   and dept is null;

-- -----------------------------------------------------------------------------
-- D. Les fonctions qui filtrent sur la liste des codes
-- -----------------------------------------------------------------------------
-- ⚠ Cette liste est répétée dans CINQ fonctions. En oublier une laisserait
-- passer une incohérence silencieuse : par exemple une visite des Alpes-
-- Maritimes enregistrée sans département, ou un modérateur du 06 impossible à
-- nommer. Elles sont donc toutes réémises ici, à l'identique de leur dernière
-- version, avec le seul ajout de '06'.

create or replace function public.record_visit(p_dept text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.app_visits (user_id, day, dept, passages)
  select auth.uid(),
         (now() at time zone 'Europe/Paris')::date,
         case when p_dept in ('04','05','06','13','26','83','84') then p_dept end,
         1
  where auth.uid() is not null
  on conflict (user_id, day) do update
    set passages = public.app_visits.passages + 1,
        dept = coalesce(public.app_visits.dept, excluded.dept);
$$;

revoke execute on function public.record_visit(text) from public, anon;
grant execute on function public.record_visit(text) to authenticated;

create or replace function public.record_anon_visit(p_visitor text, p_dept text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.anon_visits (visitor, day, dept, passages)
  select p_visitor,
         (now() at time zone 'Europe/Paris')::date,
         case when p_dept in ('04','05','06','13','26','83','84') then p_dept end,
         1
  where auth.uid() is null
    and p_visitor ~ '^[0-9a-f]{32}$'
  on conflict (visitor, day) do update
    set passages = public.anon_visits.passages + 1,
        dept = coalesce(public.anon_visits.dept, excluded.dept);
$$;

revoke execute on function public.record_anon_visit(text, text) from public;
grant execute on function public.record_anon_visit(text, text) to anon, authenticated;

create or replace function public.tag_visit_dept(p_dept text, p_visitor text default null)
returns void
language sql
security definer
set search_path = public
as $$
  with jour as (
    select (now() at time zone 'Europe/Paris')::date as d
  ),
  code as (
    select case when p_dept in ('04','05','06','13','26','83','84') then p_dept end as c
  ),
  maj_membre as (
    update public.app_visits
       set dept = (select c from code)
     where (select c from code) is not null
       and auth.uid() is not null
       and user_id = auth.uid()
       and day = (select d from jour)
       and dept is null
    returning 1
  )
  update public.anon_visits
     set dept = (select c from code)
   where (select c from code) is not null
     and auth.uid() is null
     and p_visitor ~ '^[0-9a-f]{32}$'
     and visitor = p_visitor
     and day = (select d from jour)
     and dept is null;
$$;

revoke execute on function public.tag_visit_dept(text, text) from public;
grant execute on function public.tag_visit_dept(text, text) to anon, authenticated;

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
  where d in ('04','05','06','13','26','83','84');

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
  where d in ('04','05','06','13','26','83','84');

  if propre is null or array_length(propre, 1) is null then
    raise exception 'Choisissez au moins un département.';
  end if;

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

-- -----------------------------------------------------------------------------
-- Vérification — les quatre premiers doivent être vrais
-- -----------------------------------------------------------------------------
-- ⚠ N'appelle aucune fonction réservée (le SQL Editor n'a pas d'utilisateur).
select
  (select count(*) from public.dept_contours) = 7                                as sept_contours,
  public.dept_of_point(ST_SetSRID(ST_MakePoint(7.2620, 43.7102), 4326)::geography) = '06'
                                                                                 as nice_rattachee_au_06,
  public.dept_of_point(ST_SetSRID(ST_MakePoint(5.3698, 43.2965), 4326)::geography) = '13'
                                                                                 as marseille_rattachee_au_13,
  (select pg_get_functiondef(p.oid) like '%''06''%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='record_visit')                       as visites_acceptent_le_06,
  -- Combien d'événements viennent d'être rattachés grâce au nouveau contour
  (select count(*)::int from public.events where dept = '06')                    as evenements_dans_le_06,
  (select count(*)::int from public.events
    where location is not null and dept is null)                                 as evenements_encore_sans_dept;

-- =============================================================================
-- Fin de migration 0026
-- =============================================================================
