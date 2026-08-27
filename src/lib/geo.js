// Le cadre de recherche vit dans lib/departements.js, à côté des interrupteurs
// d'ouverture : ouvrir un département sans élargir le cadre rendrait toutes ses
// adresses introuvables.
import { CADRE_RECHERCHE } from './departements.js'

// Armana — géolocalisation utilisateur + géocodage d'adresse.
//
// - Position de l'utilisateur : API navigateur (Geolocation) UNIQUEMENT, repli sur
//   Forcalquier si refus/erreur. Il n'y a volontairement plus de « ville par
//   défaut » : deux sources concurrentes pour le point de départ de la carte
//   avaient fini par se marcher dessus (le bouton « ma position » ne consultait
//   plus le GPS). Une seule source, c'est plus simple et plus prévisible.
// - Géocodage adresse → (lat, lng) : Nominatim (OpenStreetMap), sans clé.
//   ⚠ Usage soumis à la politique Nominatim (1 req/s, User-Agent identifiable).
//   On limite volontairement les appels (bouton explicite, pas de frappe en direct).

// Repli quand la géolocalisation échoue. Forcalquier plutôt que le centre
// géographique du département : c'est là que se concentrent les événements,
// donc l'endroit le plus utile pour ouvrir la carte à l'aveugle.
export const DEFAULT_CENTER = { lat: 43.9597, lng: 5.7803 } // Forcalquier

/**
 * Position courante via le navigateur. Résout DEFAULT_CENTER en cas d'échec.
 * ⚠ Le `timeout` de l'API ne démarre qu'APRÈS la réponse à la demande
 * d'autorisation : si l'utilisateur ignore la fenêtre, la promesse ne se résout
 * jamais et la carte reste bloquée. D'où le garde-fou explicite.
 *
 * `reason` dit POURQUOI on est retombé sur le repli. Sans lui, un refus
 * d'autorisation était indiscernable d'un succès et la carte se recentrait
 * silencieusement sur Digne : la localisation paraissait « ne pas marcher »
 * sans qu'on sache jamais que le navigateur l'avait bloquée.
 * @returns {Promise<{lat:number, lng:number, fallback:boolean,
 *                    reason:null|'unsupported'|'denied'|'timeout'|'unavailable'}>}
 */
export function getUserLocation({ timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve({ ...DEFAULT_CENTER, fallback: true, reason: 'unsupported' })
      return
    }
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(
      () => finish({ ...DEFAULT_CENTER, fallback: true, reason: 'timeout' }),
      timeoutMs
    )
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        finish({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          fallback: false,
          reason: null,
        }),
      (err) =>
        finish({
          ...DEFAULT_CENTER,
          fallback: true,
          // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
          reason: err?.code === 1 ? 'denied' : err?.code === 3 ? 'timeout' : 'unavailable',
        }),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 300000 }
    )
  })
}

/** Message lisible correspondant à un `reason` de `getUserLocation`. */
export function locationErrorMessage(reason) {
  switch (reason) {
    case 'denied':
      return 'Localisation refusée. Autorisez-la pour ce site dans les réglages de votre navigateur, puis réessayez.'
    case 'unsupported':
      return 'Votre navigateur ne propose pas la localisation.'
    case 'timeout':
      return 'La localisation met trop de temps. Réessayez, de préférence à l’extérieur.'
    case 'unavailable':
      return 'Position introuvable pour le moment. Vérifiez que la localisation est activée sur l’appareil.'
    default:
      return 'Localisation indisponible.'
  }
}

// Rectangle englobant les départements couverts, avec une marge : sert à
// orienter la recherche d'adresse.
// ⚠ Sans ce cadrage, Nominatim choisissait le premier homonyme de France. Cas
// réel : « Les Mées » a été résolu dans l'Orne, à 650 km du village du 04, et
// l'événement s'est retrouvé invisible sur la carte sans que personne ne
// comprenne pourquoi. Beaucoup de villages du Sud ont un homonyme au Nord.

function urlNominatim(q, cadre) {
  const base =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=fr&q=' +
    encodeURIComponent(q)
  // `bounded=1` REJETTE tout résultat hors du cadre, au lieu de simplement le
  // classer plus bas — c'est ce qui empêche l'homonyme lointain de gagner.
  return cadre ? `${base}&viewbox=${CADRE_RECHERCHE}&bounded=1` : base
}

/**
 * Géocode une adresse texte via Nominatim, en cherchant D'ABORD dans les
 * départements couverts, puis dans toute la France si rien n'y correspond.
 * @returns {Promise<{lat:number, lng:number, label:string}|null>}
 */
export async function geocodeAddress(query) {
  const q = (query || '').trim()
  if (!q) return null

  // Nominatim est un service bénévole plafonné à ~1 requête/seconde POUR TOUTE
  // l'application : si plusieurs personnes publient en même temps, certaines
  // reçoivent un 429/503. Une seule nouvelle tentative après une pause suffit
  // dans l'immense majorité des cas ; au-delà, l'utilisateur place son marqueur
  // à la main sur la carte (chemin qui ne dépend d'aucun service tiers).
  async function interroger(url) {
    let res = await fetch(url, { headers: { 'Accept-Language': 'fr' } }).catch(() => null)
    if (!res || res.status === 429 || res.status === 503) {
      await new Promise((r) => setTimeout(r, 1200))
      res = await fetch(url, { headers: { 'Accept-Language': 'fr' } }).catch(() => null)
    }
    if (!res) throw new Error('service de recherche d’adresse injoignable')
    if (res.status === 429 || res.status === 503) {
      throw new Error('service de recherche d’adresse saturé, placez le marqueur à la main')
    }
    if (!res.ok) throw new Error('géocodage indisponible (' + res.status + ')')
    const results = await res.json()
    if (!results.length) return null
    const r = results[0]
    return { lat: parseFloat(r.lat), lng: parseFloat(r.lon), label: r.display_name }
  }

  // Le repli hors cadre reste utile : une salle juste de l'autre côté d'une
  // limite départementale doit continuer de se trouver.
  return (await interroger(urlNominatim(q, true))) ?? (await interroger(urlNominatim(q, false)))
}

// Note : la « ville par défaut » a été retirée. Les clés `rezo-city` et
// `rezo-city-pos` peuvent subsister dans le stockage local des appareils qui
// l'avaient réglée — plus rien ne les lit, elles sont sans effet.

/** Distance à vol d'oiseau (mètres) entre deux points — formule de Haversine. */
export function haversineMeters(a, b) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}
