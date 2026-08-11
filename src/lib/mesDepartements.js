// Armana — départements que l'utilisateur souhaite voir.
//
// Préférence purement locale : elle tient à l'appareil, pas au compte, et n'a
// donc pas à passer par la base. Préfixe `rezo-` comme toutes les autres clés
// de l'application (voir la note dans lib/geo.js).
//
// Par défaut : TOUS les départements couverts. Quelqu'un qui installe Armana
// doit voir l'agenda entier avant de le restreindre lui-même.
import { CODES_DEPARTEMENTS } from './departements.js'

const CLE = 'rezo-depts'
const abonnes = new Set()

export function getMesDepartements() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE) || 'null')
    if (!Array.isArray(brut)) return [...CODES_DEPARTEMENTS]
    const propre = brut.filter((c) => CODES_DEPARTEMENTS.includes(c))
    // Une liste vide viderait l'agenda sans que rien ne l'explique : on
    // retombe sur la totalité, qui est aussi la valeur par défaut.
    return propre.length ? propre : [...CODES_DEPARTEMENTS]
  } catch {
    return [...CODES_DEPARTEMENTS]
  }
}

export function setMesDepartements(codes) {
  const propre = (codes ?? []).filter((c) => CODES_DEPARTEMENTS.includes(c))
  // On refuse de tout décocher : l'écran ne le propose pas, mais un appel
  // direct ne doit pas pouvoir laisser l'application vide.
  const retenus = propre.length ? propre : [...CODES_DEPARTEMENTS]
  try {
    localStorage.setItem(CLE, JSON.stringify(retenus))
  } catch {
    /* stockage indisponible : le choix ne survivra pas, sans plus */
  }
  for (const fn of abonnes) fn(retenus)
  return retenus
}

export function onMesDepartementsChange(fn) {
  abonnes.add(fn)
  return () => abonnes.delete(fn)
}

/** Vrai si l'utilisateur n'a rien restreint — évite un filtrage inutile. */
export function toutLeTerritoire() {
  return getMesDepartements().length === CODES_DEPARTEMENTS.length
}
