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

/**
 * « Tout le territoire », enregistré comme tel et non comme une liste.
 *
 * ⚠ SANS CELA, OUVRIR UN DÉPARTEMENT NE SE VOIT PAS. Une liste figée cesse
 * d'être complète dès qu'on en ajoute un : la personne avait tout coché, elle
 * se retrouve sans le nouveau, et rien ne le lui signale. C'est arrivé le
 * 30/08/2026 à l'ouverture de PACA — Matthieu a dû aller recocher lui-même.
 * En mémorisant l'INTENTION plutôt que la liste, un ajout futur profite
 * automatiquement à qui n'avait rien restreint.
 */
const TOUT = '*'

/**
 * Listes complètes d'AVANT le passage à `TOUT`, à traiter comme « tout le
 * territoire ». Elles ne peuvent plus être écrites : uniquement lues chez les
 * personnes installées avant le 30/08/2026. Supprimable une fois le parc
 * renouvelé — au pire, ces gens retrouveront leur écran de choix.
 */
const ANCIENNES_LISTES_COMPLETES = [
  ['04', '05', '84'], // avant l'ouverture à PACA
  ['04', '05', '06', '13', '83', '84'], // PACA, avant l'ajout de la Drôme
]

function estUneAncienneListeComplete(codes) {
  return ANCIENNES_LISTES_COMPLETES.some(
    (ref) => ref.length === codes.length && ref.every((c) => codes.includes(c))
  )
}

export function getMesDepartements() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE) || 'null')
    if (brut === TOUT) return [...CODES_DEPARTEMENTS]
    if (!Array.isArray(brut)) return [...CODES_DEPARTEMENTS]
    if (estUneAncienneListeComplete(brut)) return [...CODES_DEPARTEMENTS]
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
    // Tout coché = on retient l'INTENTION, pas la liste : voir TOUT ci-dessus.
    const complet = retenus.length === CODES_DEPARTEMENTS.length
    localStorage.setItem(CLE, JSON.stringify(complet ? TOUT : retenus))
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
