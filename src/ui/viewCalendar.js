// Armana — écran Calendrier (défaut) : en-tête, chips de catégories,
// calendrier mensuel (jours à événements marqués), liste des événements.
import { el, emptyState, formatMonthLabel, formatDateFull } from './components.js'
import { posterEventCard } from './posterEventCard.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn } from '../lib/auth.js'
import { listApprovedEvents, listGemEventIds } from '../lib/events.js'

/** Clé locale AAAA-MM-JJ d'une date (fuseau du navigateur, pas UTC). */
function dayKey(d) {
  const x = d instanceof Date ? d : new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

/** Tous les jours couverts par un événement (starts_at → ends_at, borné à 31 j). */
function eventDayKeys(ev) {
  const keys = []
  const start = new Date(ev.starts_at)
  const end = ev.ends_at ? new Date(ev.ends_at) : start
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  for (let i = 0; i < 31 && cur <= end; i++) {
    keys.push(dayKey(cur))
    cur.setDate(cur.getDate() + 1)
  }
  if (!keys.length) keys.push(dayKey(start))
  return keys
}

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
  logo.src = '/assets/studio-affiche/masks-logo.png'
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
  head.appendChild(logo)

  // --- Filtres rapides, calqués sur la maquette Studio Affiche ---
  const chipsRow = el('div', 'chips-row chips-row--studio')
  const allChips = []
  let quickFilter = 'all'
  const addChip = (label, value) => {
    const c = el('button', 'chip', label)
    c.dataset.value = value
    if (value === 'all') c.appendChild(icon('chevronDown'))
    c.addEventListener('click', () => {
      quickFilter = value
      paintChips()
      repaintCalendar()
      repaintList()
    })
    allChips.push(c)
    chipsRow.appendChild(c)
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
  const [approvedEvents, gemIds] = await Promise.all([
    listApprovedEvents(),
    isLoggedIn() ? listGemEventIds() : Promise.resolve(new Set()),
  ])
  const studioPreview = import.meta.env.DEV && new URLSearchParams(location.search).has('studio-preview')
  const events = studioPreview ? studioPreviewEvents(approvedEvents[0]) : approvedEvents
  const filtered = () => {
    if (quickFilter === 'free') return events.filter((event) => !event.is_paid)
    if (quickFilter === 'today') {
      const todayKey = dayKey(new Date())
      return events.filter((event) => eventDayKeys(event).includes(todayKey))
    }
    if (quickFilter === 'weekend') {
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const daysUntilSaturday = (6 - start.getDay() + 7) % 7
      const saturday = new Date(start)
      saturday.setDate(start.getDate() + daysUntilSaturday)
      const sunday = new Date(saturday)
      sunday.setDate(saturday.getDate() + 1)
      const weekendDays = new Set([dayKey(saturday), dayKey(sunday)])
      return events.filter((event) => eventDayKeys(event).some((key) => weekendDays.has(key)))
    }
    return events
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
  const prevBtn = el('button', 'calendar__nav')
  prevBtn.appendChild(icon('chevronLeft'))
  const monthLabel = el('div', 'calendar__month')
  const nextBtn = el('button', 'calendar__nav')
  nextBtn.appendChild(icon('chevronRight'))
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
  })

  prevBtn.addEventListener('click', () => {
    monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() - 1, 1)
    repaintCalendar()
  })
  nextBtn.addEventListener('click', () => {
    monthCursor = new Date(monthCursor.getFullYear(), monthCursor.getMonth() + 1, 1)
    repaintCalendar()
  })

  function repaintCalendar() {
    monthLabel.textContent = formatMonthLabel(monthCursor)
    // Les mois passés ne s'affichent jamais : pas de navigation avant le mois courant.
    prevBtn.disabled = monthCursor <= thisMonth

    const eventDays = new Set()
    for (const ev of filtered()) for (const k of eventDayKeys(ev)) eventDays.add(k)

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
    let shown = filtered()
    if (selectedDay) {
      shown = shown.filter((ev) => eventDayKeys(ev).includes(selectedDay))
      sectionLabel.textContent = formatDateFull(selectedDay + 'T12:00:00')
    } else {
      sectionLabel.textContent = 'À venir'
    }
    if (!shown.length) {
      list.appendChild(
        emptyState(selectedDay ? 'Aucun événement ce jour-là.' : 'Aucun événement à venir.')
      )
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
          onGemChange: (id, on) => (on ? gemIds.add(id) : gemIds.delete(id)),
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
