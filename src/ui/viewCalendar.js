// Armana — écran Calendrier (défaut) : en-tête, chips de catégories,
// calendrier mensuel (jours à événements marqués), liste des événements.
import { el, emptyState, formatMonthLabel, formatDateFull } from './components.js'
import { posterEventCard } from './posterEventCard.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn } from '../lib/auth.js'
import { getCategory, setCategory } from '../lib/filter.js'
import { dayKey, eventDayKeys, isRecurring, recurrenceDaysLabel } from '../lib/recurrence.js'
import { estDansLeTerritoire, loadDepartements } from '../lib/departements.js'
import { getMesDepartements, toutLeTerritoire } from '../lib/mesDepartements.js'
import { CATEGORIES, listApprovedEvents, listGemEventIds } from '../lib/events.js'

// Les jours couverts par un événement (multi-jours ET récurrence) sont calculés
// dans un seul endroit, partagé avec la Carte : src/lib/recurrence.js.

function studioPreviewEvents(seed = {}) {
  const samples = [
    { offset: 0, title: 'Les Inattendus', category: 'Spectacle', address: 'Forcalquier', is_paid: false },
    { offset: 1, title: 'Jazz sous les étoiles', category: 'Concert', address: 'Digne-les-Bains', is_paid: true, price: 12 },
    { offset: 7, title: 'Arts & Paysages', category: 'Randonnée', address: 'Annot', is_paid: false },
    { offset: 8, title: 'Lettres à demain', category: 'Théâtre', address: 'Manosque', is_paid: false },
  ]
  const start = new Date()
  return samples.map((sample, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + sample.offset, 20, 30)
    return {
      ...seed,
      ...sample,
      id: `studio-preview-${index + 1}`,
      starts_at: date.toISOString(),
      ends_at: null,
      status: 'approved',
      _studioPreview: true,
    }
  })
}

export async function viewCalendar() {
  const wrap = el('section', 'screen screen--studio-calendar')

  // --- En-tête Studio Affiche : titre utile + marque ---
  const head = el('header', 'screen-head screen-head--studio')
  const title = el('h1', 'screen-title screen-title--studio', 'Agenda')
  const logo = el('img')
  logo.src = '/icons/armana-logo.png'
  logo.alt = 'Armana'
  logo.addEventListener('error', () => logo.remove())
  head.appendChild(title)

  const calendarToggle = el('button', 'studio-calendar-toggle')
  calendarToggle.type = 'button'
  calendarToggle.title = 'Fermer le calendrier'
  calendarToggle.setAttribute('aria-label', 'Fermer le calendrier')
  calendarToggle.setAttribute('aria-expanded', 'true')
  calendarToggle.classList.add('is-open')
  calendarToggle.appendChild(icon('calendar'))

  head.appendChild(calendarToggle)
  // ⚠ PAS de bouton de partage ici : j'en avais ajouté un « pour la cohérence »,
  // Matthieu l'a fait retirer — l'Agenda est déjà chargé (titre, calendrier,
  // filtres) et c'était mieux avant. Il reste sur Carte, Favoris et Profil.
  head.appendChild(logo)

  // --- Filtre par style, sous le titre et AU-DESSUS des filtres rapides ---
  // On choisit d'abord le genre de sortie, puis le moment. Le filtre est celui
  // de src/lib/filter.js : il est partagé avec la Carte, donc une catégorie
  // choisie ici reste active en passant sur l'onglet Carte, et inversement.
  const catRow = el('div', 'chips-row chips-row--studio chips-row--cats')
  const catChips = []
  const addCat = (label, value) => {
    const c = el('button', 'chip', label)
    c.dataset.value = value ?? ''
    c.addEventListener('click', () => {
      // Re-taper la catégorie active la retire : on revient à « Tous les styles ».
      setCategory(getCategory() === value ? null : value)
      paintCats()
      repaintCalendar()
      repaintList()
    })
    catChips.push(c)
    catRow.appendChild(c)
  }
  addCat('Tous les styles', null)
  for (const c of CATEGORIES) addCat(c, c)
  const paintCats = () => {
    const cur = getCategory() || ''
    for (const c of catChips) c.classList.toggle('is-active', c.dataset.value === cur)
  }
  paintCats()
  head.appendChild(catRow)

  // --- Filtres rapides, calqués sur la maquette Studio Affiche ---
  const chipsRow = el('div', 'chips-row chips-row--studio')
  const allChips = []
  let quickFilter = 'all'
  const addChip = (label, value) => {
    const c = el('button', 'chip', label)
    c.dataset.value = value
    // Chevron décoratif sur « Tout » : sans lui, cette puce est bien plus
    // étroite que les trois autres et la rangée paraît décalée. Retiré une
    // fois, remis aussitôt pour cette raison.
    if (value === 'all') c.appendChild(icon('chevronDown'))
    c.addEventListener('click', () => {
      quickFilter = value
      // « Aujourd'hui » et « Ce week-end » désignent une date précise : on
      // ramène le calendrier sur le mois concerné, sinon les choisir depuis
      // décembre afficherait une liste vide. « Gratuit » et « Tout » ne
      // désignent aucune date : on laisse l'utilisateur là où il naviguait.
      const mois = moisDuFiltre(value)
      if (mois) monthCursor = mois
      selectedDay = null
      paintChips()
      repaintCalendar()
      repaintList()
    })
    allChips.push(c)
    chipsRow.appendChild(c)
  }
  /** Mois sur lequel se placer quand un filtre de date est choisi, sinon null. */
  function moisDuFiltre(value) {
    const now = new Date()
    if (value === 'today') return new Date(now.getFullYear(), now.getMonth(), 1)
    if (value === 'weekend') {
      const samedi = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      samedi.setDate(samedi.getDate() + ((6 - samedi.getDay() + 7) % 7))
      return new Date(samedi.getFullYear(), samedi.getMonth(), 1)
    }
    return null
  }

  addChip("Aujourd'hui", 'today')
  addChip('Ce week-end', 'weekend')
  addChip('Gratuit', 'free')
  addChip('Tout', 'all')
  const paintChips = () => {
    for (const c of allChips) c.classList.toggle('is-active', c.dataset.value === quickFilter)
  }
  paintChips()
  head.appendChild(chipsRow)
  wrap.appendChild(head)

  // --- Données ---
  const [approvedEvents, gemIds, contours] = await Promise.all([
    listApprovedEvents(),
    isLoggedIn() ? listGemEventIds() : Promise.resolve(new Set()),
    // Contours des départements, uniquement pour situer chaque événement.
    // ⚠ Tolérant à l'échec : hors ligne ou fichier indisponible, on préfère
    // afficher l'agenda entier plutôt qu'un agenda vide sans explication.
    toutLeTerritoire() ? Promise.resolve(null) : loadDepartements().catch(() => null),
  ])
  const studioPreview = import.meta.env.DEV && new URLSearchParams(location.search).has('studio-preview')
  const allEvents = studioPreview ? studioPreviewEvents(approvedEvents[0]) : approvedEvents
  /** Filtres portant sur l'ÉVÉNEMENT lui-même (style, gratuité). */
  const filtered = () => {
    const cat = getCategory()
    let events = cat ? allEvents.filter((event) => event.category === cat) : allEvents

    // Départements retenus dans le Profil. Rien n'est filtré quand ils le sont
    // tous : inutile de calculer, et le fichier de contours n'est alors même
    // pas téléchargé.
    if (contours && !toutLeTerritoire()) {
      const codes = getMesDepartements()
      events = events.filter((event) => {
        const p = { lat: Number(event.lat), lng: Number(event.lng) }
        // Un événement sans coordonnées ne peut pas être situé : on le garde
        // plutôt que de le faire disparaître sans raison visible.
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return true
        return estDansLeTerritoire(p, contours, codes)
      })
    }

    return quickFilter === 'free' ? events.filter((event) => !event.is_paid) : events
  }

  /** Filtres portant sur le JOUR — appliqués aux occurrences, pas aux événements. */
  function joursDuFiltreRapide() {
    if (quickFilter === 'today') return new Set([dayKey(new Date())])
    if (quickFilter === 'weekend') {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const samedi = new Date(start)
      samedi.setDate(start.getDate() + ((6 - start.getDay() + 7) % 7))
      const dimanche = new Date(samedi)
      dimanche.setDate(samedi.getDate() + 1)
      return new Set([dayKey(samedi), dayKey(dimanche)])
    }
    return null
  }

  /**
   * UNE CARTE PAR JOUR COUVERT. Un festival du 7 au 9 août apparaît trois fois
   * dans l'agenda, à sa date propre ; un marché hebdomadaire apparaît à chaque
   * date où il a lieu.
   *
   * ⚠ Ce sont des copies d'affichage : l'événement reste UNIQUE en base. Rien
   * n'est dupliqué — ni la photo, ni la modération, ni les favoris — et
   * corriger l'événement corrige toutes ses dates d'un coup. `id` est conservé,
   * donc le favori et l'ouverture de la fiche pointent bien vers l'original.
   */
  function occurrences() {
    const aujourdhui = dayKey(new Date())
    const filtreJours = joursDuFiltreRapide()
    const out = []
    for (const ev of filtered()) {
      // ⚠ Compter sur TOUS les jours, pas seulement ceux restants : un festival
      // entamé doit annoncer « Jour 2 sur 3 », pas « Jour 1 sur 2 ».
      const tous = eventDayKeys(ev)
      const total = tous.length
      const debut = new Date(ev.starts_at)
      tous.forEach((k, i) => {
        if (k < aujourdhui) return
        if (filtreJours && !filtreJours.has(k)) return
        const [a, m, j] = k.split('-').map(Number)
        const d = new Date(a, m - 1, j, debut.getHours(), debut.getMinutes(), 0, 0)
        // Une affiche par journée quand l'auteur en a fourni plusieurs : la
        // photo de position i illustre le jour i+1. Sinon, celle de
        // l'événement sert pour toutes ses dates.
        const photo = ev.photos?.[i] ?? null
        out.push({
          ...ev,
          starts_at: d.toISOString(),
          photo_url: photo?.photo_url ?? ev.photo_url,
          thumb_url: photo?.thumb_url ?? ev.thumb_url,
          _dayKey: k,
          // Étiquette seulement s'il y a plusieurs dates : inutile de surcharger
          // une carte d'événement ponctuel.
          _occ:
            total > 1
              ? isRecurring(ev)
                ? recurrenceDaysLabel(ev)
                : `Jour ${i + 1} sur ${total}`
              : null,
        })
      })
    }
    out.sort((x, y) => x.starts_at.localeCompare(y.starts_at))
    return out
  }

  // --- Calendrier mensuel ---
  const today = new Date()
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  let monthCursor = new Date(thisMonth)
  let selectedDay = null // clé AAAA-MM-JJ ou null = "à venir"

  const cal = el('div', 'calendar calendar--studio')
  cal.id = 'agenda-calendar-panel'
  cal.hidden = false
  calendarToggle.setAttribute('aria-controls', cal.id)
  const calHead = el('div', 'calendar__head')
  // ⚠ size explicite : sans attributs width/height ni règle CSS, Safari iOS
  // rendait ces SVG à sa taille par défaut, hors du bouton de 28 px — flèches
  // invisibles sur iPhone alors que Chrome, lui, devinait une taille correcte.
  const prevBtn = el('button', 'calendar__nav')
  prevBtn.type = 'button'
  prevBtn.setAttribute('aria-label', 'Mois précédent')
  prevBtn.appendChild(icon('chevronLeft', { size: 18 }))
  const monthLabel = el('div', 'calendar__month')
  const nextBtn = el('button', 'calendar__nav')
  nextBtn.type = 'button'
  nextBtn.setAttribute('aria-label', 'Mois suivant')
  nextBtn.appendChild(icon('chevronRight', { size: 18 }))
  calHead.appendChild(prevBtn)
  calHead.appendChild(monthLabel)
  calHead.appendChild(nextBtn)
  cal.appendChild(calHead)
  const grid = el('div', 'calendar__grid')
  cal.appendChild(grid)
  wrap.appendChild(cal)

  calendarToggle.addEventListener('click', () => {
    const willOpen = cal.hidden
    cal.hidden = !willOpen
    calendarToggle.classList.toggle('is-open', willOpen)
    calendarToggle.title = willOpen ? 'Fermer le calendrier' : 'Ouvrir le calendrier'
    calendarToggle.setAttribute('aria-label', calendarToggle.title)
    calendarToggle.setAttribute('aria-expanded', String(willOpen))
    // Le calendrier commande la liste : ouvert, elle se limite au mois affiché ;
    // fermé, elle s'ouvre à tout ce qui vient. Un jour resté sélectionné
    // masquerait tout le reste sans qu'on puisse voir d'où ça vient.
    selectedDay = null
    repaintList()
  })

  // Changer de mois change la liste : un jour sélectionné dans le mois qu'on
  // quitte n'aurait plus de sens.
  const allerAuMois = (delta) => {
    monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + delta, 1)
    selectedDay = null
    repaintCalendar()
    repaintList()
  }
  prevBtn.addEventListener('click', () => allerAuMois(-1))
  nextBtn.addEventListener('click', () => allerAuMois(1))

  function repaintCalendar() {
    monthLabel.textContent = formatMonthLabel(monthCursor)
    // Les mois passés ne s'affichent jamais : pas de navigation avant le mois courant.
    prevBtn.disabled = monthCursor <= thisMonth

    // Les pastilles s'appuient sur les MÊMES occurrences que la liste : les deux
    // ne peuvent donc pas se contredire.
    const eventDays = new Set(occurrences().map((o) => o._dayKey))

    grid.innerHTML = ''
    for (const d of ['L', 'M', 'M', 'J', 'V', 'S', 'D']) {
      grid.appendChild(el('div', 'calendar__dow', d))
    }
    const first = new Date(monthCursor.getFullYear(), monthCursor.getMonth(), 1)
    const pad = (first.getDay() + 6) % 7 // semaine française : lundi en premier
    for (let i = 0; i < pad; i++) grid.appendChild(el('button', 'calendar__cell is-empty'))
    const nDays = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 0).getDate()
    const todayKey = dayKey(today)
    for (let day = 1; day <= nDays; day++) {
      const key = dayKey(new Date(monthCursor.getFullYear(), monthCursor.getMonth(), day))
      const cell = el('button', 'calendar__cell', String(day))
      if (key === todayKey) cell.classList.add('is-today')
      if (eventDays.has(key)) cell.classList.add('has-event')
      if (key === selectedDay) cell.classList.add('is-selected')
      cell.addEventListener('click', () => {
        selectedDay = selectedDay === key ? null : key // re-tap = désélection
        repaintCalendar()
        repaintList()
      })
      grid.appendChild(cell)
    }
  }

  // --- Liste des événements ---
  const sectionLabel = el('h2', 'section-label')
  const list = el('div', 'events-list')
  wrap.appendChild(sectionLabel)
  wrap.appendChild(list)

  function repaintList() {
    list.innerHTML = ''
    let shown = occurrences()
    let vide = 'Aucun événement à venir.'

    if (selectedDay) {
      shown = shown.filter((o) => o._dayKey === selectedDay)
      sectionLabel.textContent = formatDateFull(selectedDay + 'T12:00:00')
      vide = 'Aucun événement ce jour-là.'
    } else if (!cal.hidden) {
      // Calendrier OUVERT : la liste suit le mois affiché. Le calendrier et ce
      // qu'on lit dessous racontent alors la même chose ; sans cela, on
      // feuilletait les mois sans que la liste bouge.
      const mois = `${monthCursor.getFullYear()}-${String(monthCursor.getMonth() + 1).padStart(2, '0')}`
      shown = shown.filter((o) => o._dayKey.startsWith(mois))
      sectionLabel.textContent = formatMonthLabel(monthCursor)
      vide = 'Aucun événement ce mois-ci.'
    } else {
      // Calendrier FERMÉ : plus de mois affiché, donc plus de raison de borner.
      sectionLabel.textContent = 'À venir'
      // Garde-fou : une longue récurrence pourrait à elle seule produire des
      // centaines de cartes. Le calendrier reste le moyen d'aller plus loin.
      shown = shown.slice(0, 300)
    }

    if (!shown.length) {
      list.appendChild(emptyState(vide))
      return
    }
    if (shown.some((ev) => ev.title.includes('[DÉMO]'))) {
      list.appendChild(
        el('p', 'demo-note', 'Les événements « [DÉMO] » sont des exemples de démonstration.')
      )
    }
    let posterIndex = 0
    for (const ev of shown) {
      list.appendChild(
        posterEventCard(ev, {
          gemmed: gemIds.has(ev.id),
          onGemChange: (id, on) => {
            if (on) gemIds.add(id)
            else gemIds.delete(id)
            // Le même événement peut être affiché à plusieurs dates : on
            // synchronise tous ses cœurs, sinon la carte du lendemain
            // paraîtrait ne pas avoir enregistré le favori.
            for (const b of list.querySelectorAll(
              `[data-event-id="${id}"] .poster-card__favorite`
            )) {
              b.classList.toggle('is-on', on)
              b.querySelector('svg')?.setAttribute('fill', on ? 'currentColor' : 'none')
            }
          },
          index: posterIndex++,
          preview: Boolean(ev._studioPreview),
        })
      )
    }
  }

  repaintCalendar()
  repaintList()

  // --- Bouton flottant : publier ---
  const fab = el('button', 'fab')
  fab.title = 'Publier un événement'
  fab.appendChild(icon('plus'))
  fab.addEventListener('click', () => navigate(isLoggedIn() ? '/publier' : '/connexion'))
  wrap.appendChild(fab)

  return wrap
}
