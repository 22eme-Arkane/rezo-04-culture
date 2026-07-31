// Contour administratif officiel du département 04, embarqué dans la PWA.
// Source : Etalab, contours administratifs 2026 (résolution 100 m).

export const DEPARTMENT_04_BOUNDARY_URL = '/data/alpes-de-haute-provence.geojson'

let boundaryPromise = null

export function loadDepartment04Boundary() {
  if (!boundaryPromise) {
    boundaryPromise = fetch(DEPARTMENT_04_BOUNDARY_URL, { cache: 'force-cache' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Contour du département indisponible (${res.status})`)
        const geojson = await res.json()
        if (!geojson?.features?.[0]?.geometry) throw new Error('Contour du département invalide')
        return geojson
      })
      // Sans cela, un simple passage hors ligne mémorisait l'échec « à vie » :
      // l'onglet Carte restait cassé jusqu'à la fermeture complète de l'app.
      .catch((err) => {
        boundaryPromise = null
        throw err
      })
  }
  return boundaryPromise
}

/** Anneaux extérieurs GeoJSON, sous la forme attendue par Leaflet [lat, lng]. */
export function departmentOuterRings(geojson) {
  const geometry = geojson?.features?.[0]?.geometry
  if (!geometry) return []
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]
  return polygons.map((polygon) => polygon[0].map(([lng, lat]) => [lat, lng]))
}

/** Test précis point-dans-polygone, utilisé pour exclure les lieux hors du 04. */
export function isInsideDepartment04({ lat, lng }, geojson) {
  const geometry = geojson?.features?.[0]?.geometry
  if (!geometry || !Number.isFinite(lat) || !Number.isFinite(lng)) return false
  const polygons = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates]
  return polygons.some((polygon) => {
    if (!pointInRing(lng, lat, polygon[0])) return false
    return !polygon.slice(1).some((hole) => pointInRing(lng, lat, hole))
  })
}

function pointInRing(x, y, ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }
  return inside
}
