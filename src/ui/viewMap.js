// Rézo 04 Culture — écran Map : Leaflet + OSM, filtre par rayon (PostGIS ST_DWithin).
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import '../lib/leafletIcons.js' // correctif icônes marqueur (Vite)

import { el, formatDate, formatTime, formatPrice } from './components.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'
import { resolveStartLocation } from '../lib/geo.js'
import { eventsWithinRadius } from '../lib/events.js'
import { getCategory, setCategory } from '../lib/filter.js'
import { CATEGORIES } from '../lib/events.js'

const RADII = [
  { label: '10 km', m: 10000 },
  { label: '20 km', m: 20000 },
  { label: '50 km', m: 50000 },
]

// Clé locale AAAA-MM-JJ ; un événement "couvre" un jour si start ≤ jour ≤ end.
function ymd(d) {
  const x = d instanceof Date ? d : new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
function coversDay(ev, day) {
  const s = ymd(ev.starts_at)
  const e = ev.ends_at ? ymd(ev.ends_at) : s
  return s <= day && day <= e
}

export async function viewMap() {
  const wrap = el('section', 'screen')
  const head = el('header', 'screen-head')
  head.appendChild(el('h1', 'screen-title', 'Carte'))
  wrap.appendChild(head)

  // Chips de catégories (même filtre partagé que le Calendrier).
  const chipsRow = el('div', 'chips-row')
  const allChips = []
  const addChip = (label, value) => {
    const c = el('button', 'chip', label)
    c.dataset.value = value ?? ''
    c.addEventListener('click', () => {
      setCategory(value)
      paintChips()
      loadEvents()
    })
    allChips.push(c)
    chipsRow.appendChild(c)
  }
  addChip('Tous', null)
  for (const cat of CATEGORIES) addChip(cat, cat)
  const paintChips = () => {
    const active = getCategory() ?? ''
    for (const c of allChips) c.classList.toggle('is-active', c.dataset.value === active)
  }
  paintChips()
  wrap.appendChild(chipsRow)

  // Barre rayon + position.
  const bar = el('div', 'mapbar')
  bar.appendChild(el('span', 'mapbar__label', 'Rayon :'))
  let radiusM = RADII[1].m
  const radiusBtns = RADII.map((r, i) => {
    const b = el('button', 'chip', r.label)
    if (i === 1) b.classList.add('is-active')
    bar.appendChild(b)
    return b
  })
  const recenter = el('button', 'btn btn--sm')
  recenter.appendChild(icon('pin'))
  bar.appendChild(recenter)
  const count = el('span', 'mapbar__count', '')
  bar.appendChild(count)
  wrap.appendChild(bar)

  // Sélecteur de date : n'afficher que les événements actifs ce jour-là.
  let selectedDate = null
  const dateBar = el('div', 'mapbar')
  dateBar.appendChild(el('span', 'mapbar__label', 'Date :'))
  const dateInput = el('input', 'map-date')
  dateInput.type = 'date'
  dateInput.min = ymd(new Date())
  dateBar.appendChild(dateInput)
  const clearDate = el('button', 'btn btn--sm', 'Toutes')
  dateBar.appendChild(clearDate)
  wrap.appendChild(dateBar)

  dateInput.addEventListener('change', () => {
    selectedDate = dateInput.value || null
    loadEvents()
  })
  clearDate.addEventListener('click', () => {
    dateInput.value = ''
    selectedDate = null
    loadEvents()
  })

  const mapDiv = el('div', 'map')
  wrap.appendChild(mapDiv)

  let map = null
  let center = null
  let userMarker = null
  let radiusCircle = null
  const markers = L.layerGroup()

  async function loadEvents() {
    if (!map) return
    count.textContent = 'Recherche…'
    try {
      let events = await eventsWithinRadius({ lat: center.lat, lng: center.lng, radiusM })
      const cat = getCategory()
      if (cat) events = events.filter((e) => e.category === cat)
      if (selectedDate) events = events.filter((e) => coversDay(e, selectedDate))
      markers.clearLayers()
      let plotted = 0
      for (const ev of events) {
        if (ev.lat == null || ev.lng == null) continue
        const m = L.marker([ev.lat, ev.lng])
        m.bindPopup(() => popupContent(ev))
        markers.addLayer(m)
        plotted++
      }
      count.textContent = `${plotted} événement${plotted > 1 ? 's' : ''}`
    } catch (e) {
      count.textContent = 'Erreur : ' + e.message
    }
  }

  function drawRadius() {
    if (radiusCircle) map.removeLayer(radiusCircle)
    const styles = getComputedStyle(document.documentElement)
    const accent = styles.getPropertyValue('--accent').trim() || '#f7c108'
    radiusCircle = L.circle([center.lat, center.lng], {
      radius: radiusM,
      color: accent,
      weight: 1,
      fillColor: accent,
      fillOpacity: 0.1,
    }).addTo(map)
    map.fitBounds(radiusCircle.getBounds(), { padding: [20, 20] })
  }

  function popupContent(ev) {
    const box = el('div', 'popup')
    box.appendChild(el('strong', 'popup__title', ev.title))
    box.appendChild(el('div', 'popup__meta', `${formatDate(ev.starts_at)} · ${formatTime(ev.starts_at)}`))
    box.appendChild(el('div', 'popup__meta', formatPrice(ev)))
    if (ev.address) box.appendChild(el('div', 'popup__meta', '📍 ' + ev.address))
    const open = el('button', 'btn btn--sm btn--primary', 'Voir le détail')
    open.addEventListener('click', () => navigate('/evenement?id=' + ev.id))
    box.appendChild(open)
    return box
  }

  async function initMap() {
    center = await resolveStartLocation()
    map = L.map(mapDiv, { zoomControl: true }).setView([center.lat, center.lng], 11)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap',
    }).addTo(map)
    markers.addTo(map)
    userMarker = L.circleMarker([center.lat, center.lng], {
      radius: 6,
      color: '#fff',
      weight: 2,
      fillColor: '#e23e57',
      fillOpacity: 1,
    }).addTo(map)
    userMarker.bindPopup('Vous êtes ici')
    drawRadius()
    await loadEvents()
    setTimeout(() => map.invalidateSize(), 120)
  }

  radiusBtns.forEach((b, i) => {
    b.addEventListener('click', async () => {
      radiusBtns.forEach((x) => x.classList.remove('is-active'))
      b.classList.add('is-active')
      radiusM = RADII[i].m
      if (map) {
        drawRadius()
        await loadEvents()
      }
    })
  })

  recenter.addEventListener('click', async () => {
    center = await resolveStartLocation()
    if (map) {
      userMarker.setLatLng([center.lat, center.lng])
      drawRadius()
      await loadEvents()
    }
  })

  requestAnimationFrame(() => {
    initMap().catch((e) => {
      count.textContent = 'Carte indisponible : ' + e.message
    })
  })

  return wrap
}
