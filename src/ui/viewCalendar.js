// Rézo 04 Culture — écran Calendrier (défaut) : en-tête, chips de catégories,
// calendrier mensuel (jours à événements marqués), liste des événements.
import { el, eventCard, emptyState, formatMonthLabel, formatDateFull } from './components.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn } from '../lib/auth.js'
import { listApprovedEvents, listGemEventIds, CATEGORIES } from '../lib/events.js'
import { getCategory, setCategory } from '../lib/filter.js'

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

export async function viewCalendar() {
  const wrap = el('section', 'screen')

  // --- En-tête ---
  const head = el('header', 'screen-head')
  head.appendChild(el('h1', 'screen-title', 'Rézo 04 Culture'))
  wrap.appendChild(head)

  // --- Chips de catégories (filtre partagé Calendrier + Map) ---
  const chipsRow = el('div', 'chips-row')
  const allChips = []
  const addChip = (label, value) => {
    const c = el('button', 'chip', label)
    c.dataset.value = value ?? ''
    c.addEventListener('click', () => {
      setCategory(value)
      paintChips()
      repaintCalendar()
      repaintList()
    })
    allChips.push(c)
    chipsRow.appendChild(c)
  }
  addChip('Tous les événements', null)
  for (const cat of CATEGORIES) addChip(cat, cat)
  const paintChips = () => {
    const active = getCategory() ?? ''
    for (const c of allChips) c.classList.toggle('is-active', c.dataset.value === active)
  }
  paintChips()
  wrap.appendChild(chipsRow)

  // --- Données ---
  const [events, gemIds] = await Promise.all([
    listApprovedEvents(),
    isLoggedIn() ? listGemEventIds() : Promise.resolve(new Set()),
  ])
  const filtered = () => {
    const cat = getCategory()
    return cat ? events.filter((e) => e.category === cat) : events
  }

  // --- Calendrier mensuel ---
  const today = new Date()
  const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1)
  let monthCursor = new Date(thisMonth)
  let selectedDay = null // clé AAAA-MM-JJ ou null = "à venir"

  const cal = el('div', 'calendar')
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
    for (const ev of shown) {
      list.appendChild(
        eventCard(ev, {
          gemmed: gemIds.has(ev.id),
          onGemChange: (id, on) => (on ? gemIds.add(id) : gemIds.delete(id)),
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
