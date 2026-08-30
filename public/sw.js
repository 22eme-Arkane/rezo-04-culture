/* Armana — service worker (offline shell + réception de partage), PRODUCTION.
 *
 * ⚠ Ne JAMAIS mettre en cache les sources de dev (/src, /@vite…) : modules périmés →
 * page blanche. On ne cache "cache-first" que les assets buildés hachés (/assets/…).
 *  - POST /share-target : réception d'un partage (texte + photo) → rangé en cache →
 *    redirection vers l'app qui le récupère (Web Share Target, méthode POST) ;
 *  - navigation (HTML) : réseau d'abord, repli cache hors-ligne ;
 *  - /assets/… : cache-first (sûr car haché) ;
 *  - le reste : réseau, sans cache.
 * Supabase (API/Storage) et tuiles OSM ne sont jamais interceptés.
 */
// Version incrémentée à chaque changement du shell : l'activation supprime les
// caches précédents, ce qui garantit que les appareils déjà installés basculent
// bien sur la nouvelle version (renommage Armana compris).
const CACHE = 'armana-shell-v2'
const SHARE_CACHE = 'rezo-share-v1'
// ⚠ PLUS DE GEOJSON ICI. Il y était préchargé sans jamais être servi (le
// gestionnaire `fetch` ne traitait pas /data/), et cette copie figée survivait
// aux livraisons. Les contours passent désormais par la branche /data/
// ci-dessous, avec une version dans l'URL — voir lib/departements.js.
const SHELL = ['/', '/index.html', '/manifest.webmanifest']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  const keep = [CACHE, SHARE_CACHE]
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// Réception d'un partage entrant (texte + éventuelle photo) via POST multipart.
async function handleShare(request) {
  try {
    const form = await request.formData()
    const text = [form.get('title'), form.get('text'), form.get('url')]
      .filter(Boolean)
      .join('\n')
    const file = form.get('photo')
    const cache = await caches.open(SHARE_CACHE)
    await cache.put('shared-text', new Response(text || ''))
    if (file && file.size) {
      await cache.put(
        'shared-file',
        new Response(file, {
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-Filename': encodeURIComponent(file.name || 'photo'),
          },
        })
      )
    } else {
      await cache.delete('shared-file')
    }
  } catch (e) {
    // En cas d'échec on redirige quand même (l'app affichera un import vide).
  }
  return Response.redirect('/?shared=1', 303)
}

// --- Notifications push -----------------------------------------------------
// Reçues même application fermée. Tout est désactivé par défaut : rien n'arrive
// ici tant que la personne n'a pas explicitement autorisé les notifications ET
// choisi ce qu'elle veut recevoir (écran Profil → Notifications).
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (e) {
    // Charge utile non JSON : on affiche quand même quelque chose plutôt que rien.
    data = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Armana', {
      body: data.body || '',
      // Grande icône, dans le corps de la notification : en couleurs.
      icon: '/icons/icon-192.png?v=2',
      // ⚠ Petite icône de la barre d'état : Android n'en garde QUE la
      // transparence et peint le reste en blanc. L'icône de l'application étant
      // un carré 100 % opaque, elle donnait un carré blanc. badge-96.png est
      // une silhouette des masques découpée sur fond transparent.
      badge: '/icons/badge-96.png',
      // Même `tag` = la nouvelle remplace la précédente au lieu d'empiler dix
      // fois « un événement à valider ».
      tag: data.kind || 'armana',
      data: { url: data.url || '/' },
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const cible = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((fenetres) => {
      // Application déjà ouverte : on la remet devant et on l'aiguille, plutôt
      // que d'ouvrir un second onglet.
      for (const f of fenetres) {
        if (f.url.startsWith(self.location.origin)) {
          if (f.navigate) f.navigate(cible).catch(() => {})
          return f.focus()
        }
      }
      return self.clients.openWindow(cible)
    })
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // Partage entrant (POST) : intercepté ici (pas de serveur).
  if (request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/share-target') {
    event.respondWith(handleShare(request))
    return
  }

  if (request.method !== 'GET') return
  if (url.origin !== self.location.origin) return

  // Navigation (HTML) : réseau d'abord, repli cache hors-ligne.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put('/index.html', copy))
          return res
        })
        .catch(() => caches.match('/index.html'))
    )
    return
  }

  // Cache-first UNIQUEMENT pour les assets buildés HACHÉS (/assets/xxx-a1b2c3.js).
  // ⚠ /assets/studio-affiche/… est copié tel quel depuis public/ : le nom ne
  // change JAMAIS. En cache-first, un logo remplacé resterait figé à vie sur les
  // téléphones déjà installés → on le sert en « cache, puis rafraîchit ».
  // /data/… suit la même règle : son URL porte une version (?v=…), elle est
  // donc immuable comme un nom haché. C'est aussi ce qui rend la carte
  // disponible hors ligne.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/data/')) {
    const unhashed = url.pathname.startsWith('/assets/studio-affiche/')
    event.respondWith(
      caches.match(request).then((cached) => {
        // Asset haché déjà en cache : immuable, aucun appel réseau.
        if (cached && !unhashed) return cached

        const network = fetch(request).then((res) => {
          // Ne jamais mettre une erreur (404, 500…) en cache.
          if (res.ok) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(request, copy))
          }
          return res
        })

        if (!cached) return network.catch(() => caches.match(request))
        network.catch(() => {}) // rafraîchissement silencieux en tâche de fond
        return cached
      })
    )
  }
})
