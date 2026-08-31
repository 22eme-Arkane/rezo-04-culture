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

/**
 * Le n-ième jour de semaine d'un mois — « le 2e vendredi » — ou null si le mois
 * n'en compte pas autant : tous les mois n'ont pas cinq vendredis.
 */
export function niemeJourDuMois(annee, mois, jourSemaine, rang) {
  const premier = new Date(annee, mois, 1, 12, 0, 0, 0)
  const decalage = (jourSemaine - premier.getDay() + 7) % 7
  const d = new Date(annee, mois, 1 + decalage + (rang - 1) * 7, 12, 0, 0, 0)
  return d.getMonth() === mois ? d : null
}

/**
 * Dates proposées pour une série, entre deux bornes incluses.
 *
 * ⚠ CE N'EST QU'UNE PROPOSITION. Elle est faite pour être corrigée à la main :
 * une séance saute pour les vacances, une salle est prise, un jour est férié.
 * C'est la raison d'être des dates enregistrées une à une — voir `recurDates`.
 *
 * « mois » garde LE RANG DU JOUR DANS LE MOIS (deuxième vendredi, troisième
 * samedi), pas le quantième : c'est ainsi que s'organisent ateliers et marchés,
 * et le 31 n'existe pas tous les mois. Les mois trop courts sont simplement
 * sautés — mieux vaut une date en moins, qu'on ajoute, qu'une date fausse.
 *
 * @param {Date} debut
 * @param {Date} fin
 * @param {'quinzaine'|'mois'} rythme
 * @returns {string[]} clés AAAA-MM-JJ, triées
 */
export function serieProposee(debut, fin, rythme) {
  if (!(debut instanceof Date) || !(fin instanceof Date)) return []
  if (Number.isNaN(debut.getTime()) || Number.isNaN(fin.getTime()) || fin < debut) return []
  const out = []
  // Garde-fou : une série d'ateliers ne dépasse pas cinq ans de rendez-vous
  // mensuels, et une boucle sans borne sur des dates aberrantes gèlerait la page.
  const MAX = 60

  if (rythme === 'quinzaine') {
    const cur = new Date(debut)
    while (cur <= fin && out.length < MAX) {
      out.push(dayKey(cur))
      cur.setDate(cur.getDate() + 14)
    }
    return out
  }

  const jourSemaine = debut.getDay()
  const rang = Math.ceil(debut.getDate() / 7)
  const curseur = new Date(debut.getFullYear(), debut.getMonth(), 1, 12, 0, 0, 0)
  while (curseur <= fin && out.length < MAX) {
    const d = niemeJourDuMois(curseur.getFullYear(), curseur.getMonth(), jourSemaine, rang)
    if (d && d >= debut && d <= fin) out.push(dayKey(d))
    curseur.setMonth(curseur.getMonth() + 1)
  }
  return out
}

/** Jours de récurrence normalisés, ou null si l'événement est ponctuel. */
export function recurDays(ev) {
  const d = ev?.recur_days
  if (!Array.isArray(d) || !d.length) return null
  const set = new Set(d.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))
  return set.size ? set : null
}

/**
 * Dates d'une série choisie une à une (migration 0028), triées, ou null.
 *
 * ⚠ POURQUOI UNE LISTE DE DATES EN PLUS DES JOURS DE LA SEMAINE. Un rythme
 * mensuel ne tombe pas sur la même semaine tous les mois : « un vendredi par
 * mois » est indescriptible par une règle hebdomadaire. Le formulaire propose
 * un rythme qui PRÉ-REMPLIT ces dates, puis l'organisateur corrige celles qui
 * tombent mal — vacances, salle prise, jour férié.
 *
 * Postgres renvoie un `date[]` en chaînes AAAA-MM-JJ, déjà au format de
 * `dayKey` : on ne construit donc AUCUNE Date ici, ce qui évite tout décalage
 * de fuseau sur une date sans heure.
 */
export function recurDates(ev) {
  const brut = ev?.recur_dates
  if (!Array.isArray(brut) || !brut.length) return null
  const cles = brut
    .map((d) => (typeof d === 'string' ? d.slice(0, 10) : d instanceof Date ? dayKey(d) : ''))
    .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
  return cles.length ? [...new Set(cles)].sort() : null
}

export function isRecurring(ev) {
  return recurDays(ev) !== null || recurDates(ev) !== null
}

/**
 * Tous les jours couverts par un événement.
 *  - ponctuel  : chaque jour de starts_at à ends_at (borné à 31 jours) ;
 *  - récurrent : seulement les jours de la semaine retenus, sur la période.
 */
export function eventDayKeys(ev) {
  // Une série de dates choisies EST déjà la liste des jours : rien à dérouler.
  const choisies = recurDates(ev)
  if (choisies) return choisies

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

  const choisies = recurDates(ev)
  if (choisies) {
    const aujourdhui = dayKey(from)
    const prochaine = choisies.find((k) => k >= aujourdhui) || choisies[choisies.length - 1]
    const [a, m, j] = prochaine.split('-').map(Number)
    return new Date(a, m - 1, j, start.getHours(), start.getMinutes(), 0, 0)
  }

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

/** « Tous les mercredis et vendredis », ou « 9 séances ». Sans la période. */
export function recurrenceDaysLabel(ev) {
  const choisies = recurDates(ev)
  // Une série choisie n'a pas de règle à énoncer : son nombre de séances est
  // ce qui renseigne le plus (« 9 séances »), les dates sont sur la fiche.
  if (choisies) return `${choisies.length} séance${choisies.length > 1 ? 's' : ''}`

  const jours = recurDays(ev)
  if (!jours) return ''
  const noms = JOURS.filter((j) => jours.has(j.n)).map((j) => j.long)
  if (noms.length === 7) return 'Tous les jours'
  if (noms.length === 1) return `Tous les ${noms[0]}s`
  return `Tous les ${noms.slice(0, -1).join('s, ')}s et ${noms[noms.length - 1]}s`
}

/** « Tous les mercredis et vendredis, du 1er juillet au 31 août ». */
export function describeRecurrence(ev) {
  const choisies = recurDates(ev)
  if (choisies) {
    // Les dates elles-mêmes, c'est la seule description honnête d'une série
    // irrégulière — et c'est ce que l'organisateur a saisi.
    const [a, m, j] = choisies[0].split('-').map(Number)
    const annee = new Date(a, m - 1, j).getFullYear()
    const memeAnnee = choisies.every((k) => Number(k.slice(0, 4)) === annee)
    const liste = choisies
      .map((k) => {
        const [y, mo, d] = k.split('-').map(Number)
        const date = new Date(y, mo - 1, d)
        return memeAnnee ? formatJourMois(date) : `${formatJourMois(date)} ${y}`
      })
      .join(' · ')
    return `${recurrenceDaysLabel(ev)} : ${liste}`
  }

  const quand = recurrenceDaysLabel(ev)
  if (!quand) return ''
  const debut = new Date(ev.starts_at)
  const fin = ev.ends_at ? new Date(ev.ends_at) : null
  if (!fin) return quand
  return `${quand}, du ${formatJourMois(debut)} au ${formatJourMois(fin)}`
}
