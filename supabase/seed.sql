-- =============================================================================
-- Armana — Seed de DÉMONSTRATION (facultatif)
-- =============================================================================
-- 2-3 événements d'exemple, clairement marqués « [DÉMO] », pour visualiser l'app.
-- À exécuter APRÈS avoir créé au moins un compte (les événements ont besoin d'un
-- auteur). Idempotent : n'insère rien si des événements [DÉMO] existent déjà.
-- Dates RELATIVES à l'exécution → toujours "à venir". Aucune photo (cartes en
-- mode "ambiance" dégradée). Supprimez-les quand vous voulez.
-- =============================================================================
do $$
declare
  uid uuid;
begin
  select id into uid from public.profiles order by created_at asc limit 1;
  if uid is null then
    raise notice 'Aucun profil trouvé : créez un compte dans l''app, puis relancez ce seed.';
    return;
  end if;

  if exists (select 1 from public.events where title like '[DÉMO]%') then
    raise notice 'Des événements [DÉMO] existent déjà : rien à faire.';
    return;
  end if;

  insert into public.events
    (created_by, title, description, starts_at, ends_at, is_paid, price, location, address, category, status)
  values
    (uid, '[DÉMO] Concert au kiosque',
     'Exemple de démonstration. Concert en plein air, entrée libre.',
     now() + interval '3 days', now() + interval '3 days 2 hours',
     false, null,
     ST_SetSRID(ST_MakePoint(6.2354, 44.0921), 4326)::geography,
     'Place du Général de Gaulle, Digne-les-Bains', 'Musique', 'approved'),

    (uid, '[DÉMO] Exposition photo',
     'Exemple de démonstration. Exposition ouverte pendant dix jours.',
     now() + interval '10 days', now() + interval '20 days',
     true, 5,
     ST_SetSRID(ST_MakePoint(5.7869, 43.8296), 4326)::geography,
     'Manosque', 'Exposition', 'approved'),

    (uid, '[DÉMO] Spectacle de rue',
     'Exemple de démonstration. Théâtre de rue pour toute la famille.',
     now() + interval '6 days', now() + interval '6 days 3 hours',
     false, null,
     ST_SetSRID(ST_MakePoint(5.9430, 44.1935), 4326)::geography,
     'Sisteron', 'Spectacles vivants', 'approved');

  raise notice '3 événements [DÉMO] insérés.';
end $$;
