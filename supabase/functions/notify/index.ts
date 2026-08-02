// Armana — envoi des notifications push (Supabase Edge Function).
//
// La base ne sait pas parler à un service de push : il faut signer un jeton
// VAPID. Elle dépose donc les notifications dans `notification_queue`
// (migration 0015) et cette fonction les consomme.
//
// Conséquence utile : tant que cette fonction n'est pas déployée, RIEN n'est
// cassé — la file se remplit simplement sans être vidée, et l'application
// fonctionne normalement.
//
// -----------------------------------------------------------------------------
// DÉPLOIEMENT (à faire une seule fois, depuis le dossier du projet)
// -----------------------------------------------------------------------------
//   1. Générer les clés VAPID :
//        npx web-push generate-vapid-keys
//      Elles ne vont NI dans le dépôt NI dans un message. La clé publique est
//      publique par nature (elle voyage dans le navigateur) ; la privée reste
//      un secret serveur.
//
//   2. Enregistrer les secrets côté Supabase :
//        npx supabase login
//        npx supabase link --project-ref <reference-du-projet>
//        npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
//                                 VAPID_SUBJECT=mailto:22eme.arkane@gmail.com
//
//   3. Déployer :
//        npx supabase functions deploy notify
//
//   4. Sur Vercel, ajouter la variable d'environnement (clé PUBLIQUE seulement) :
//        VITE_VAPID_PUBLIC_KEY = ...
//      puis redéployer le site, sinon l'écran Notifications restera en
//      « Envoi pas encore en service ».
//
// La planification (appel automatique toutes les minutes) viendra ensuite, une
// fois qu'on aura vérifié ensemble qu'un envoi manuel arrive bien.
// -----------------------------------------------------------------------------
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:contact@armana04.vercel.app'

// Ces deux types ne concernent que les administrateurs : même si quelqu'un
// forçait la préférence, il ne recevrait rien.
const ADMIN_SEULEMENT = new Set(['moderation', 'messages'])

// Au-delà, l'abonnement est considéré mort et supprimé.
const ECHECS_MAX = 5

// Nombre de notifications traitées par appel : borne la durée d'exécution.
const LOT = 20

Deno.serve(async () => {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return json({ erreur: 'Clés VAPID absentes. Voir l’en-tête du fichier.' }, 500)
  }
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)

  // Clé de service : contourne la RLS, indispensable pour lire la file et les
  // abonnements de tout le monde. Elle ne quitte jamais le serveur.
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const { data: file, error: erFile } = await db
    .from('notification_queue')
    .select('id, kind, title, body, url')
    .is('sent_at', null)
    .order('created_at', { ascending: true })
    .limit(LOT)
  if (erFile) return json({ erreur: erFile.message }, 500)
  if (!file?.length) return json({ traitees: 0, envois: 0 })

  // Un seul chargement des abonnés pour tout le lot.
  const { data: abonnes, error: erAb } = await db
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, failures, profiles!inner(role, notif_prefs)')
  if (erAb) return json({ erreur: erAb.message }, 500)

  let envois = 0
  const morts: string[] = []

  for (const notif of file) {
    const cibles = (abonnes ?? []).filter((a: any) => {
      const p = a.profiles
      if (!p) return false
      if (ADMIN_SEULEMENT.has(notif.kind) && p.role !== 'admin') return false
      return p.notif_prefs?.[notif.kind] === true
    })

    const charge = JSON.stringify({
      title: notif.title,
      body: notif.body,
      url: notif.url ?? '/',
      kind: notif.kind,
    })

    await Promise.all(
      cibles.map(async (a: any) => {
        try {
          await webpush.sendNotification(
            { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
            charge
          )
          envois++
        } catch (e: any) {
          const code = e?.statusCode ?? 0
          // 404 / 410 : le navigateur a révoqué l'abonnement (désinstallation,
          // cache vidé). Il ne servira plus jamais, on le supprime.
          if (code === 404 || code === 410 || a.failures + 1 >= ECHECS_MAX) {
            morts.push(a.endpoint)
          } else {
            await db
              .from('push_subscriptions')
              .update({ failures: a.failures + 1 })
              .eq('endpoint', a.endpoint)
          }
        }
      })
    )
  }

  if (morts.length) {
    await db.from('push_subscriptions').delete().in('endpoint', morts)
  }

  // Marquée envoyée même sans destinataire : sinon la file grossirait sans fin.
  await db
    .from('notification_queue')
    .update({ sent_at: new Date().toISOString() })
    .in('id', file.map((n: any) => n.id))

  return json({ traitees: file.length, envois, abonnements_supprimes: morts.length })
})

function json(corps: unknown, status = 200) {
  return new Response(JSON.stringify(corps), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
