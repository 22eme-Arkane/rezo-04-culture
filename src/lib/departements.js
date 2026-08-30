// Contours administratifs officiels des départements couverts par Armana.
// Source : Etalab, contours administratifs (jeu france-geojson).
//
// ⚠ Les trois contours proviennent du MÊME jeu, non simplifié. C'est
// indispensable : deux départements voisins partagent alors exactement les
// mêmes sommets le long de leur frontière commune. Avec des versions
// simplifiées séparément, un liseré de masque apparaîtrait entre le 04 et le
// 05, ou entre le 04 et le 84.
//
// Deux particularités que le code doit absolument gérer :
//  - le 84 est un MultiPolygon : le Vaucluse comprend l'enclave des Papes,
//    autour de Valréas, détachée du reste du département ;
//  - le 26 a un TROU à l'emplacement de cette enclave, qu'il entoure
//    complètement. Sans traiter les trous, Valréas serait attribuée à la Drôme.
// Tout le code ci-dessous raisonne donc en liste de polygones, chacun pouvant
// avoir des trous — jamais en polygone unique et plein.

export const DEPARTEMENTS_URL = '/data/departements.geojson'

/**
 * Les sept départements dont le contour est embarqué, par numéro.
 *
 * ⚠ `actif` est l'INTERRUPTEUR d'ouverture d'un département.
 *
 * Depuis le 29 août 2026, Armana couvre TOUTE LA RÉGION PACA : 04, 05, 06, 13,
 * 83 et 84. La Drôme reste embarquée mais fermée — elle n'appartient pas à
 * PACA (Auvergne-Rhône-Alpes) ; son contour est prêt si l'on veut l'ouvrir un
 * jour, il suffira de passer `actif` à true et d'élargir CADRE_RECHERCHE.
 *
 * ⚠ TOUT CHANGEMENT ICI SE RÉPERCUTE EN BASE. La liste des codes valides est
 * répétée dans les fonctions SQL (record_visit, record_anon_visit,
 * tag_visit_dept, set_moderator, apply_moderator) et dans la table
 * `dept_contours`, qui sert au calcul de `events.dept`. Ouvrir un département
 * sans migration donnerait des événements sans département : invisibles pour
 * les modérateurs et absents des notifications.
 */
export const TOUS_DEPARTEMENTS = [
  { code: '04', nom: 'Alpes-de-Haute-Provence', actif: true },
  { code: '05', nom: 'Hautes-Alpes', actif: true },
  { code: '06', nom: 'Alpes-Maritimes', actif: true },
  { code: '13', nom: 'Bouches-du-Rhône', actif: true },
  { code: '26', nom: 'Drôme', actif: false },
  { code: '83', nom: 'Var', actif: true },
  { code: '84', nom: 'Vaucluse', actif: true },
]

/** Ceux réellement ouverts. C'est cette liste que voit l'application. */
export const DEPARTEMENTS = TOUS_DEPARTEMENTS.filter((d) => d.actif)

export const CODES_DEPARTEMENTS = DEPARTEMENTS.map((d) => d.code)

/**
 * Rectangle englobant les départements ACTIFS, pour orienter la recherche
 * d'adresse (voir lib/geo.js). Volontairement placé ICI, à côté des
 * interrupteurs : les deux doivent changer ensemble, sinon on chercherait des
 * adresses dans un département qu'on n'affiche pas.
 *   04+05+84 (avant)      : 4.499,45.277,7.227,43.509
 *   PACA entière (actuel) : 4.230,45.127,7.719,42.982
 *   avec la Drôme         : 4.080,45.494,7.719,42.982
 */
export const CADRE_RECHERCHE = '4.230,45.127,7.719,42.982'

export function nomDepartement(code) {
  return TOUS_DEPARTEMENTS.find((d) => d.code === code)?.nom || code
}

export function estActif(code) {
  return CODES_DEPARTEMENTS.includes(code)
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
