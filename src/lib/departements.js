// Contours administratifs officiels des départements couverts par Armana.
// Source : Etalab, contours administratifs (jeu france-geojson).
//
// ⚠ Les trois contours proviennent du MÊME jeu, non simplifié. C'est
// indispensable : deux départements voisins partagent alors exactement les
// mêmes sommets le long de leur frontière commune. Avec des versions
// simplifiées séparément, un liseré de masque apparaîtrait entre le 04 et le
// 05, ou entre le 04 et le 84.
//
// Le 84 est un MultiPolygon : le Vaucluse comprend l'enclave des Papes,
// autour de Valréas, entièrement entourée par la Drôme. Tout le code ci-dessous
// raisonne donc en « liste de polygones », jamais en polygone unique.

export const DEPARTEMENTS_URL = '/data/departements.geojson'

/** Ordre d'affichage : du plus au moins central pour Armana. */
export const DEPARTEMENTS = [
  { code: '04', nom: 'Alpes-de-Haute-Provence' },
  { code: '05', nom: 'Hautes-Alpes' },
  { code: '84', nom: 'Vaucluse' },
]

export const CODES_DEPARTEMENTS = DEPARTEMENTS.map((d) => d.code)

export function nomDepartement(code) {
  return DEPARTEMENTS.find((d) => d.code === code)?.nom || code
}

let promesse = null

export function loadDepartements() {
  if (!promesse) {
    promesse = fetch(DEPARTEMENTS_URL, { cache: 'force-cache' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Contours des départements indisponibles (${res.status})`)
        const geojson = await res.json()
        if (!geojson?.features?.length) throw new Error('Contours des départements invalides')
        return geojson
      })
      // Sans cela, un simple passage hors ligne mémorisait l'échec « à vie » :
      // l'onglet Carte restait cassé jusqu'à la fermeture complète de l'app.
      .catch((err) => {
        promesse = null
        throw err
      })
  }
  return promesse
}

/** Les polygones d'un département donné (ou de tous), à plat. */
function polygonesDe(geojson, codes = null) {
  const out = []
  for (const f of geojson?.features ?? []) {
    const code = f?.properties?.code
    if (codes && !codes.includes(code)) continue
    const g = f?.geometry
    if (!g) continue
    const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]
    for (const p of polys) out.push(p)
  }
  return out
}

/**
 * Anneaux extérieurs, sous la forme attendue par Leaflet [lat, lng].
 * Sert à la fois au tracé du contour et au masque qui cache l'extérieur.
 */
export function anneauxExterieurs(geojson, codes = null) {
  return polygonesDe(geojson, codes).map((polygone) =>
    polygone[0].map(([lng, lat]) => [lat, lng])
  )
}

/**
 * Code du département contenant ce point, ou null s'il est hors territoire.
 * Test point-dans-polygone exact : un simple rectangle englobant se
 * tromperait sur toutes les communes frontalières.
 */
export function departementDuPoint({ lat, lng }, geojson) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  for (const f of geojson?.features ?? []) {
    const g = f?.geometry
    if (!g) continue
    const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates]
    const dedans = polys.some((polygone) => {
      if (!pointDansAnneau(lng, lat, polygone[0])) return false
      // Les anneaux suivants sont des trous (lacs, enclaves).
      return !polygone.slice(1).some((trou) => pointDansAnneau(lng, lat, trou))
    })
    if (dedans) return f.properties?.code ?? null
  }
  return null
}

/** Le point est-il dans le territoire couvert (éventuellement restreint) ? */
export function estDansLeTerritoire(point, geojson, codes = null) {
  const code = departementDuPoint(point, geojson)
  if (!code) return false
  return codes ? codes.includes(code) : true
}

function pointDansAnneau(x, y, anneau) {
  let dedans = false
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i++) {
    const [xi, yi] = anneau[i]
    const [xj, yj] = anneau[j]
    const traverse = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (traverse) dedans = !dedans
  }
  return dedans
}
