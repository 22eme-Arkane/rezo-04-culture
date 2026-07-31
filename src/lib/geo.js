// Armana — géolocalisation utilisateur + géocodage d'adresse.
//
// - Position de l'utilisateur : API navigateur (Geolocation), repli sur le centre du
//   département 04 (Digne-les-Bains) si refus/erreur.
// - Géocodage adresse → (lat, lng) : Nominatim (OpenStreetMap), sans clé.
//   ⚠ Usage soumis à la politique Nominatim (1 req/s, User-Agent identifiable).
//   On limite volontairement les appels (bouton explicite, pas de frappe en direct).

// Centre approximatif du département 04 (repli).
export const DEFAULT_CENTER = { lat: 44.0921, lng: 6.2354 } // Digne-les-Bains

/**
 * Position courante via le navigateur. Résout DEFAULT_CENTER en cas d'échec.
 * ⚠ Le `timeout` de l'API ne démarre qu'APRÈS la réponse à la demande
 * d'autorisation : si l'utilisateur ignore la fenêtre, la promesse ne se résout
 * jamais et la carte reste bloquée. D'où le garde-fou explicite.
 */
export function getUserLocation({ timeoutMs = 8000 } = {}) {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve({ ...DEFAULT_CENTER, fallback: true })
      return
    }
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => finish({ ...DEFAULT_CENTER, fallback: true }), timeoutMs)
    navigator.geolocation.getCurrentPosition(
      (pos) => finish({ lat: pos.coords.latitude, lng: pos.coords.longitude, fallback: false }),
      () => finish({ ...DEFAULT_CENTER, fallback: true }),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 300000 }
    )
  })
}

/**
 * Géocode une adresse texte via Nominatim (biais sur la France).
 * @returns {Promise<{lat:number, lng:number, label:string}|null>}
 */
export async function geocodeAddress(query) {
  const q = (query || '').trim()
  if (!q) return null
  const url =
    'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=fr&q=' +
    encodeURIComponent(q)

  // Nominatim est un service bénévole plafonné à ~1 requête/seconde POUR TOUTE
  // l'application : si plusieurs personnes publient en même temps, certaines
  // reçoivent un 429/503. Une seule nouvelle tentative après une pause suffit
  // dans l'immense majorité des cas ; au-delà, l'utilisateur place son marqueur
  // à la main sur la carte (chemin qui ne dépend d'aucun service tiers).
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

// --- Ville par défaut (préférence explicite de l'utilisateur) ---
const CITY_KEY = 'rezo-city'
const CITY_POS_KEY = 'rezo-city-pos' // { city, lat, lng } — évite de re-géocoder

export function getDefaultCity() {
  try {
    return localStorage.getItem(CITY_KEY) || ''
  } catch {
    return ''
  }
}

/** Coordonnées mémorisées de la ville par défaut, si elles correspondent encore. */
export function getDefaultCityPos() {
  try {
    const raw = JSON.parse(localStorage.getItem(CITY_POS_KEY) || 'null')
    const city = getDefaultCity()
    if (!raw || !city || raw.city !== city) return null
    if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lng)) return null
    return { lat: raw.lat, lng: raw.lng }
  } catch {
    return null
  }
}

export function setDefaultCity(city, pos = null) {
  try {
    if (city) localStorage.setItem(CITY_KEY, city)
    else localStorage.removeItem(CITY_KEY)
    // Les coordonnées ne valent que pour cette ville-là.
    if (city && pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lng)) {
      localStorage.setItem(CITY_POS_KEY, JSON.stringify({ city, lat: pos.lat, lng: pos.lng }))
    } else {
      localStorage.removeItem(CITY_POS_KEY)
    }
  } catch {
    /* stockage indisponible : sans effet */
  }
}

/** Géocode la ville par défaut et mémorise le résultat pour les fois suivantes. */
export async function resolveDefaultCity() {
  const city = getDefaultCity()
  if (!city) return null
  const cached = getDefaultCityPos()
  if (cached) return { ...cached, fallback: false, city }
  try {
    const g = await geocodeAddress(city + ', Alpes-de-Haute-Provence')
    if (g) {
      setDefaultCity(city, { lat: g.lat, lng: g.lng })
      return { lat: g.lat, lng: g.lng, fallback: false, city }
    }
  } catch {
    /* réseau indisponible : on retombera sur la géoloc / le centre du 04 */
  }
  return null
}

/**
 * Position de départ pour la carte.
 * PRIORITÉ à la ville par défaut : c'est un choix explicite de l'utilisateur, il
 * doit primer sur le GPS (sinon la préférence semblait ignorée). Sans ville
 * choisie : géolocalisation, puis centre du département 04.
 */
export async function resolveStartLocation() {
  const fromCity = await resolveDefaultCity()
  if (fromCity) return fromCity
  return getUserLocation()
}

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
