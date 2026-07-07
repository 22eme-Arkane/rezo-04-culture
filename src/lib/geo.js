// Rézo 04 Culture — géolocalisation utilisateur + géocodage d'adresse.
//
// - Position de l'utilisateur : API navigateur (Geolocation), repli sur le centre du
//   département 04 (Digne-les-Bains) si refus/erreur.
// - Géocodage adresse → (lat, lng) : Nominatim (OpenStreetMap), sans clé.
//   ⚠ Usage soumis à la politique Nominatim (1 req/s, User-Agent identifiable).
//   On limite volontairement les appels (bouton explicite, pas de frappe en direct).

// Centre approximatif du département 04 (repli).
export const DEFAULT_CENTER = { lat: 44.0921, lng: 6.2354 } // Digne-les-Bains

/** Position courante via le navigateur. Résout DEFAULT_CENTER en cas d'échec. */
export function getUserLocation() {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      resolve({ ...DEFAULT_CENTER, fallback: true })
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, fallback: false }),
      () => resolve({ ...DEFAULT_CENTER, fallback: true }),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
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
  const res = await fetch(url, { headers: { 'Accept-Language': 'fr' } })
  if (!res.ok) throw new Error('Géocodage indisponible (' + res.status + ')')
  const results = await res.json()
  if (!results.length) return null
  const r = results[0]
  return { lat: parseFloat(r.lat), lng: parseFloat(r.lon), label: r.display_name }
}

// --- Ville par défaut (préférence locale, utilisée en repli de la géoloc) ---
const CITY_KEY = 'rezo-city'

export function getDefaultCity() {
  try {
    return localStorage.getItem(CITY_KEY) || ''
  } catch {
    return ''
  }
}

export function setDefaultCity(city) {
  try {
    if (city) localStorage.setItem(CITY_KEY, city)
    else localStorage.removeItem(CITY_KEY)
  } catch {
    /* stockage indisponible : sans effet */
  }
}

/**
 * Position de départ pour la carte : géoloc navigateur, sinon ville par défaut
 * (géocodée), sinon centre du département 04.
 */
export async function resolveStartLocation() {
  const loc = await getUserLocation()
  if (!loc.fallback) return loc
  const city = getDefaultCity()
  if (city) {
    try {
      const g = await geocodeAddress(city + ', Alpes-de-Haute-Provence')
      if (g) return { lat: g.lat, lng: g.lng, fallback: false, city }
    } catch {
      /* on garde le repli département */
    }
  }
  return loc
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
