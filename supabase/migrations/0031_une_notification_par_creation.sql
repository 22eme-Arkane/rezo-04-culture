-- =============================================================================
-- Migration 0031 — une notification à la création, plus aucune à la retouche
-- =============================================================================
--
-- SIGNALÉ PAR MATTHIEU : modifier un événement déclenche de nouvelles
-- notifications — dix retouches, dix notifications.
--
-- ⚠ SON OBSERVATION ÉTAIT JUSTE, ET LA CAUSE EST UNE RÉGRESSION DE LA 0025.
-- La 0021 avait réglé le problème pour le public : une colonne `announced_at`
-- retenait la première annonce, et le déclencheur la renseignait par un vrai
-- UPDATE. La 0025 a remplacé cet UPDATE par `new.announced_at := now()`. Or le
-- déclencheur `enqueue_event_notification_trg` est créé en 0015 comme AFTER
-- INSERT OR UPDATE, et n'a jamais été recréé depuis : dans un déclencheur AFTER,
-- modifier NEW n'a AUCUN effet, la ligne est déjà écrite. Depuis la 0025,
-- `announced_at` n'est donc plus jamais renseigné, et chaque réapprobation
-- après une retouche renvoie « Nouvel événement dans l'agenda » à tout le monde.
--
-- ⚠ ET LE COMPTEUR « ÉVÉNEMENTS PUBLIÉS » EST GONFLÉ D'AUTANT. La 0025
-- l'incrémente dans la même branche que l'annonce : chaque réapprobation l'a
-- fait monter d'un événement fantôme. Il est corrigé en C, sur MESURE.
--
-- ⚠ POURQUOI NE PAS SIMPLEMENT PASSER LE DÉCLENCHEUR EN BEFORE, ce qui rendrait
-- l'affectation valide : les déclencheurs BEFORE s'exécutent par ordre
-- alphabétique de nom, et `enqueue_event_notification_trg` passerait AVANT
-- `set_event_dept_trg` (0019). La notification partirait alors avec un
-- département pas encore calculé — et l'acheminement par département serait
-- faux. On reste en AFTER, avec le vrai UPDATE de la 0021.
--
-- CE QUI CHANGE, À LA DEMANDE DE MATTHIEU :
--   * les MODÉRATEURS ne sont plus prévenus qu'à la CRÉATION d'un événement,
--     plus quand une retouche le renvoie en relecture ;
--   * le PUBLIC n'est prévenu qu'UNE fois, à la première approbation — comme
--     le prévoyait déjà la 0021, et comme ce n'était plus le cas depuis la 0025.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A. Rattrapage de la mémoire d'annonce
-- -----------------------------------------------------------------------------
-- Tout événement déjà annoncé doit porter sa date d'annonce, SINON sa prochaine
-- réapprobation l'annoncerait encore. « Déjà annoncé » se lit dans la file, qui
-- conserve ses lignes après envoi — y compris pour un événement aujourd'hui EN
-- ATTENTE : approuvé, puis retouché, il repasserait par l'annonce. D'où le test
-- sur la file et non sur le seul statut.
update public.events e
   set announced_at = coalesce(
         (select min(q.created_at)
            from public.notification_queue q
           where q.kind = 'nouveaux_evenements' and q.event_id = e.id),
         e.created_at,
         now())
 where e.announced_at is null
   and (e.status = 'approved'
        or exists (select 1 from public.notification_queue q
                    where q.kind = 'nouveaux_evenements' and q.event_id = e.id));

-- -----------------------------------------------------------------------------
-- B. Le déclencheur, corrigé
-- -----------------------------------------------------------------------------
create or replace function public.enqueue_event_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- --- Modération : à la CRÉATION seulement --------------------------------
  -- ⚠ Plus de branche « UPDATE vers pending » : une retouche renvoie toujours
  -- l'événement en relecture (update_event), mais sans notification. Il reste
  -- visible dans la file de modération et dans son compteur, en Profil.
  if tg_op = 'INSERT' and new.status = 'pending' then
    insert into public.notification_queue (kind, title, body, url, dept, event_id)
    values ('moderation', 'Un événement à valider',
            left(new.title, 120), '/#/moderation', new.dept, new.id);

  -- --- Public : l'annonce, UNE SEULE FOIS ---------------------------------
  elsif tg_op = 'UPDATE'
        and new.status = 'approved'
        and old.status is distinct from 'approved'
        and new.announced_at is null
  then
    insert into public.notification_queue (kind, title, body, url, dept, event_id)
    values ('nouveaux_evenements', 'Nouvel événement dans l''agenda',
            left(new.title, 120), '/#/evenement?id=' || new.id, new.dept, new.id);

    -- ⚠ UN VRAI UPDATE, ET NON UNE AFFECTATION À NEW. Le déclencheur est AFTER :
    -- modifier NEW n'y fait rien. C'est exactement l'erreur de la 0025.
    -- (Formulation choisie à dessein : la vérification en fin de fichier cherche
    --  la forme fautive dans le texte de la fonction, commentaires compris.)
    -- L'UPDATE rappelle bien cette fonction, mais l'appel récursif ne retombe
    -- dans aucune branche (le statut ne change pas) : pas de boucle. Il ne
    -- touche pas non plus le journal d'audit, qui ne suit que les changements
    -- de statut (0012).
    update public.events set announced_at = now() where id = new.id;

    -- Le cumul, au seul instant où un événement devient public pour la
    -- première fois. La purge pourra effacer la ligne ; le compteur restera.
    insert into public.stats_cumul (cle, valeur) values ('evenements_publies', 1)
    on conflict (cle) do update set valeur = public.stats_cumul.valeur + 1;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- C. Correction du compteur « événements publiés », sur mesure
-- -----------------------------------------------------------------------------
-- Chaque annonce en double a ajouté un événement fantôme au compteur. Leur
-- nombre se MESURE dans la file : une ligne « nouveaux_evenements » par
-- annonce, avec l'identifiant de l'événement depuis la 0021.
--   * entre la 0021 et la 0025, l'annonce ne partait qu'une fois : ces
--     événements ont une seule ligne et ne comptent pour rien ici ;
--   * avant la 0021, `event_id` n'existait pas (NULL) : exclus, et c'est juste,
--     le compteur n'existait pas encore non plus.
-- Il ne reste donc que les doublons nés depuis la 0025 — exactement ceux qui
-- ont gonflé le compteur, puisque l'un et l'autre étaient ajoutés ensemble.
--
-- ⚠ À NE FAIRE QU'UNE FOIS : une seconde exécution soustrairait encore. Une clé
-- témoin dans `stats_cumul` le garantit, et conserve le nombre retiré.
do $$
declare
  doublons bigint;
begin
  if not exists (select 1 from public.stats_cumul where cle = 'correction_doublons_0031') then
    select coalesce(sum(n - 1), 0) into doublons
      from (select count(*) as n
              from public.notification_queue
             where kind = 'nouveaux_evenements' and event_id is not null
             group by event_id
            having count(*) > 1) t;

    update public.stats_cumul
       set valeur = greatest(valeur - doublons, 0)
     where cle = 'evenements_publies';

    insert into public.stats_cumul (cle, valeur)
    values ('correction_doublons_0031', doublons);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Vérification — les quatre premières doivent être vraies
-- -----------------------------------------------------------------------------
select
  -- L'affectation sans effet de la 0025 a disparu, le vrai UPDATE est revenu.
  (select pg_get_functiondef(p.oid) not like '%new.announced_at :=%'
      and pg_get_functiondef(p.oid) like '%update public.events set announced_at%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enqueue_event_notification')
                                                            as annonce_memorisee,
  -- Plus de notification de modération sur une retouche.
  (select pg_get_functiondef(p.oid) not like '%tg_op = ''UPDATE'' and new.status = ''pending''%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'enqueue_event_notification')
                                                            as moderation_a_la_creation_seule,
  -- Aucun événement déjà annoncé sans sa date d'annonce.
  (select count(*) = 0 from public.events e
    where e.announced_at is null
      and exists (select 1 from public.notification_queue q
                   where q.kind = 'nouveaux_evenements' and q.event_id = e.id))
                                                            as annonces_rattrapees,
  -- Le déclencheur est toujours AFTER : c'est lui qui garantit un département
  -- déjà calculé au moment de la notification.
  (select (t.tgtype::int & 2) = 0 from pg_trigger t
    where t.tgname = 'enqueue_event_notification_trg')      as declencheur_toujours_after,
  -- Pour information : combien d'annonces en double ont été retirées du
  -- compteur, et ce qu'il indique désormais.
  (select valeur from public.stats_cumul where cle = 'correction_doublons_0031')
                                                            as doublons_retires,
  (select valeur from public.stats_cumul where cle = 'evenements_publies')
                                                            as evenements_publies_corriges;

-- =============================================================================
-- Fin de migration 0031
-- =============================================================================
