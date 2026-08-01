// Armana — événements récurrents.
//
// Un événement récurrent est UNE seule ligne en base (migration 0013) :
//   starts_at  → première occurrence, et l'heure de toutes les autres
//   ends_at    → fin de la période
//   recur_days → jours concernés, convention JS getDay() : 0 = dimanche
//
// Tout le reste de l'application (visibilité, purge mensuelle, modération,
// rayon, favoris) continue de raisonner sur starts_at / ends_at sans rien
// savoir de la récurrence. Seuls l'affichage et le calendrier passent par ici.

/** Semaine à la française : lundi d'abord. `n` suit getDay(). */
export const JOURS = [
  { n: 1, court: 'L', long: 'lundi' },
  { n: 2, court: 'M', long: 'mardi' },
  { n: 3, court: 'M', long: 'mercredi' },
  { n: 4, court: 'J', long: 'jeudi' },
  { n: 5, court: 'V', long: 'vendredi' },
  { n: 6, court: 'S', long: 'samedi' },
  { n: 0, court: 'D', long: 'dimanche' },
]

const DATE_COURTE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' })

/**
 * « 1er juillet », « 28 août ». Intl écrit « 1 juillet » : en français, le
 * premier du mois prend l'ordinal.
 */
export function formatJourMois(d) {
  const x = d instanceof Date ? d : new Date(d)
  const texte = DATE_COURTE.format(x)
  return x.getDate() === 1 ? texte.replace(/^1\s/, '1er ') : texte
}

/** Clé locale AAAA-MM-JJ (fuseau du navigateur, jamais UTC). */
export function dayKey(d) {
  const x = d instanceof Date ? d : new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(
    x.getDate()
  ).padStart(2, '0')}`
}

/** Jours de récurrence normalisés, ou null si l'événement est ponctuel. */
export function recurDays(ev) {
  const d = ev?.recur_days
  if (!Array.isArray(d) || !d.length) return null
  const set = new Set(d.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))
  return set.size ? set : null
}

export function isRecurring(ev) {
  return recurDays(ev) !== null
}

/**
 * Tous les jours couverts par un événement.
 *  - ponctuel  : chaque jour de starts_at à ends_at (borné à 31 jours) ;
 *  - récurrent : seulement les jours de la semaine retenus, sur la période.
 */
export function eventDayKeys(ev) {
  const keys = []
  const start = new Date(ev.starts_at)
  const end = ev.ends_at ? new Date(ev.ends_at) : start
  const jours = recurDays(ev)
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  // Un événement continu ne dure pas des mois ; un récurrent, si — mais il
  // n'occupe que quelques jours par semaine.
  const max = jours ? 400 : 31
  for (let i = 0; i < max && cur <= end; i++) {
    if (!jours || jours.has(cur.getDay())) keys.push(dayKey(cur))
    cur.setDate(cur.getDate() + 1)
  }
  if (!keys.length) keys.push(dayKey(start))
  return keys
}

/**
 * Prochaine occurrence d'un événement récurrent (à partir d'aujourd'hui),
 * en conservant l'heure de `starts_at`. Renvoie `starts_at` si l'événement
 * n'est pas récurrent, ou si la période est déjà terminée.
 */
export function nextOccurrence(ev, from = new Date()) {
  const start = new Date(ev.starts_at)
  const jours = recurDays(ev)
  if (!jours) return start
  const end = ev.ends_at ? new Date(ev.ends_at) : start
  // On ne remonte jamais avant le début de la série.
  const depuis = from > start ? from : start
  const cur = new Date(depuis.getFullYear(), depuis.getMonth(), depuis.getDate())
  cur.setHours(start.getHours(), start.getMinutes(), 0, 0)
  for (let i = 0; i < 400; i++) {
    if (cur >= depuis && cur <= end && jours.has(cur.getDay())) return cur
    cur.setDate(cur.getDate() + 1)
  }
  return start
}

/** « Tous les mercredis et vendredis » — sans la période. */
export function recurrenceDaysLabel(ev) {
  const jours = recurDays(ev)
  if (!jours) return ''
  const noms = JOURS.filter((j) => jours.has(j.n)).map((j) => j.long)
  if (noms.length === 7) return 'Tous les jours'
  if (noms.length === 1) return `Tous les ${noms[0]}s`
  return `Tous les ${noms.slice(0, -1).join('s, ')}s et ${noms[noms.length - 1]}s`
}

/** « Tous les mercredis et vendredis, du 1er juillet au 31 août ». */
export function describeRecurrence(ev) {
  const quand = recurrenceDaysLabel(ev)
  if (!quand) return ''
  const debut = new Date(ev.starts_at)
  const fin = ev.ends_at ? new Date(ev.ends_at) : null
  if (!fin) return quand
  return `${quand}, du ${formatJourMois(debut)} au ${formatJourMois(fin)}`
}
