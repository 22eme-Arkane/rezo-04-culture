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
const CACHE = 'armana-shell-v1'
const SHARE_CACHE = 'rezo-share-v1'
const SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/data/alpes-de-haute-provence.geojson',
]

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
  if (url.pathname.startsWith('/assets/')) {
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
