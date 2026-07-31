// Armana — écran Map : Leaflet + OSM, filtre par rayon (PostGIS ST_DWithin).
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import '../lib/leafletIcons.js' // correctif icônes marqueur (Vite)

import { el, formatDate, formatTime, formatPrice } from './components.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'
import { DEFAULT_CENTER, resolveStartLocation } from '../lib/geo.js'
import { eventsWithinRadius } from '../lib/events.js'
import { getCategory, setCategory } from '../lib/filter.js'
import { CATEGORIES } from '../lib/events.js'
import { studioHeader } from './studio.js'
import {
  departmentOuterRings,
  isInsideDepartment04,
  loadDepartment04Boundary,
} from '../lib/department04.js'

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
  const wrap = el('section', 'screen screen--studio-map')
  const head = studioHeader('Carte', { tone: 'blue' })

  // Chips de catégories (même filtre partagé que le Calendrier).
  const chipsRow = el('div', 'chips-row chips-row--studio-map')
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
  head.appendChild(chipsRow)
  wrap.appendChild(head)

  // Panneau de recherche : rayon et date, dans une seule surface éditoriale.
  const controls = el('section', 'map-search-panel')
  controls.setAttribute('aria-label', 'Filtres de la carte')

  const radiusControl = el('div', 'map-search-control')
  const radiusHeading = el('div', 'map-search-control__heading')
  const radiusIcon = el('span', 'map-search-control__icon')
  radiusIcon.appendChild(icon('pin'))
  radiusHeading.appendChild(radiusIcon)
  const radiusCopy = el('div', 'map-search-control__copy')
  radiusCopy.appendChild(el('strong', null, 'Rayon'))
  radiusCopy.appendChild(el('span', null, 'Choisissez votre rayon'))
  radiusHeading.appendChild(radiusCopy)
  const recenter = el('button', 'map-search-control__recenter')
  recenter.type = 'button'
  recenter.title = 'Recentrer sur ma position'
  recenter.setAttribute('aria-label', 'Recentrer sur ma position')
  recenter.appendChild(icon('refresh'))
  radiusHeading.appendChild(recenter)
  radiusControl.appendChild(radiusHeading)

  const radiusOptions = el('div', 'map-radius-options')
  let radiusM = RADII[1].m
  const radiusBtns = RADII.map((r, i) => {
    const b = el('button', 'map-radius-option', r.label)
    b.type = 'button'
    if (i === 1) b.classList.add('is-active')
    radiusOptions.appendChild(b)
    return b
  })
  radiusControl.appendChild(radiusOptions)
  controls.appendChild(radiusControl)

  // Sélecteur de date : uniquement les événements actifs ce jour-là.
  let selectedDate = null
  const dateControl = el('div', 'map-search-control map-search-control--date')
  const dateHeading = el('label', 'map-search-control__heading')
  const dateIcon = el('span', 'map-search-control__icon map-search-control__icon--yellow')
  dateIcon.appendChild(icon('calendar'))
  dateHeading.appendChild(dateIcon)
  const dateCopy = el('span', 'map-search-control__copy')
  dateCopy.appendChild(el('strong', null, 'Date'))
  dateCopy.appendChild(el('span', null, 'Tous les événements par défaut'))
  dateHeading.appendChild(dateCopy)
  dateControl.appendChild(dateHeading)
  const datePicker = el('div', 'map-date-picker')
  const dateInput = el('input', 'map-date map-date--studio')
  dateInput.type = 'date'
  dateInput.min = ymd(new Date())
  dateInput.setAttribute('aria-label', 'Filtrer par date')
  datePicker.appendChild(dateInput)
  const clearDate = el('button', 'map-date-clear', 'Toutes')
  clearDate.type = 'button'
  datePicker.appendChild(clearDate)
  dateControl.appendChild(datePicker)
  controls.appendChild(dateControl)

  const resultsBar = el('div', 'map-results-bar')
  resultsBar.appendChild(el('span', 'map-results-bar__dot'))
  const count = el('span', 'map-results-bar__count', '')
  resultsBar.appendChild(count)
  wrap.appendChild(controls)

  dateInput.addEventListener('change', () => {
    selectedDate = dateInput.value || null
    dateControl.classList.toggle('has-date', Boolean(selectedDate))
    loadEvents()
  })
  clearDate.addEventListener('click', () => {
    dateInput.value = ''
    selectedDate = null
    dateControl.classList.remove('has-date')
    loadEvents()
  })

  const mapFrame = el('div', 'map-frame-studio')
  const departmentBadge = el('div', 'map-department-badge')
  departmentBadge.appendChild(el('strong', null, '04'))
  departmentBadge.appendChild(el('span', null, 'Alpes-de-Haute-Provence'))
  mapFrame.appendChild(departmentBadge)
  mapFrame.appendChild(resultsBar)
  const mapDiv = el('div', 'map map--studio')
  mapFrame.appendChild(mapDiv)
  wrap.appendChild(mapFrame)

  let map = null
  let center = null
  let userMarker = null
  let radiusCircle = null
  let departmentBoundary = null
  let departmentBounds = null
  const markers = L.layerGroup()

  async function loadEvents() {
    if (!map) return
    count.textContent = 'Recherche…'
    try {
      let events = await eventsWithinRadius({ lat: center.lat, lng: center.lng, radiusM })
      const cat = getCategory()
      if (cat) events = events.filter((e) => e.category === cat)
      if (selectedDate) events = events.filter((e) => coversDay(e, selectedDate))
      if (departmentBoundary) {
        events = events.filter((e) =>
          isInsideDepartment04({ lat: Number(e.lat), lng: Number(e.lng) }, departmentBoundary)
        )
      }
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

  function drawRadius({ fit = true } = {}) {
    if (radiusCircle) map.removeLayer(radiusCircle)
    const styles = getComputedStyle(wrap)
    const accent = styles.getPropertyValue('--mask-yellow').trim() || '#f4ca15'
    radiusCircle = L.circle([center.lat, center.lng], {
      radius: radiusM,
      color: accent,
      weight: 1,
      fillColor: accent,
      fillOpacity: 0.1,
    }).addTo(map)
    // La carte s'ouvre SUR la zone de recherche (ville par défaut ou position),
    // pas sur le département entier : sinon la ville choisie dans les réglages
    // semblait ignorée.
    if (fit) map.fitBounds(radiusCircle.getBounds(), { padding: [16, 16], animate: false })
  }

  function popupContent(ev) {
    const box = el('div', 'popup')
    if (ev.category) box.appendChild(el('span', 'popup__cat', ev.category))
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
    departmentBoundary = await loadDepartment04Boundary()
    center = await resolveStartLocation()
    if (!isInsideDepartment04(center, departmentBoundary)) center = { ...DEFAULT_CENTER, fallback: true }
    map = L.map(mapDiv, { zoomControl: true, maxBoundsViscosity: 1.0 }).setView(
      [center.lat, center.lng],
      11
    )
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // Crédit obligatoire des tuiles OSM (c'est ce qui rend la carte gratuite) :
      // le lien vers la page de copyright fait partie des conditions d'usage.
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · contour Etalab',
    }).addTo(map)

    // Frontière exacte du 04. Un masque 100 % opaque recouvre le monde entier,
    // avec le département comme « trou » : aucun territoire voisin n'est visible.
    const boundaryLayer = L.geoJSON(departmentBoundary)
    departmentBounds = boundaryLayer.getBounds()
    map.createPane('departmentMask')
    map.getPane('departmentMask').style.zIndex = '430'
    map.getPane('departmentMask').style.pointerEvents = 'none'
    const world = [[-90, -180], [-90, 180], [90, 180], [90, -180]]
    const departmentMask = L.polygon([world, ...departmentOuterRings(departmentBoundary)], {
      pane: 'departmentMask',
      stroke: false,
      fillColor: '#fff4df',
      fillOpacity: 1,
      fillRule: 'evenodd',
      interactive: false,
      className: 'department-mask',
    }).addTo(map)
    applyDepartmentMaskPattern(departmentMask)
    L.geoJSON(departmentBoundary, {
      pane: 'departmentMask',
      interactive: false,
      style: {
        color: '#f4ca15',
        weight: 4,
        opacity: 1,
        fillOpacity: 0,
        className: 'department-outline',
      },
    }).addTo(map)

    markers.addTo(map)
    userMarker = L.circleMarker([center.lat, center.lng], {
      radius: 6,
      color: '#fff',
      weight: 2,
      fillColor: '#f04b2f',
      fillOpacity: 1,
    }).addTo(map)
    userMarker.bindPopup(center.city ? `Ville choisie : ${center.city}` : 'Vous êtes ici')

    // La carte occupe désormais la place restante (flex) : sa taille définitive
    // n'est connue qu'APRÈS la mise en page. On cadre donc APRÈS mesure, sinon le
    // zoom est calculé sur un conteneur encore vide et l'affichage est décadré.
    fitToViewport()
    drawRadius()
    applyDepartmentLimits()
    watchResize()

    await loadEvents()
  }

  /**
   * Hauteur de la carte MESURÉE sur l'appareil, jamais devinée.
   *
   * Les mises en page en CSS pur (flex, 100dvh, env(safe-area-inset-bottom))
   * dépendent du navigateur : `:has()` ignoré, `dvh` mal géré, barre d'URL qui
   * se rétracte, encoche… Sur certains téléphones la carte finissait sous la
   * barre d'onglets, avec l'attribution OpenStreetMap collée dessus.
   * On lit donc la position RÉELLE de la barre d'onglets (élément fixe, donc en
   * coordonnées de l'écran visible) et on cale la carte juste au-dessus.
   */
  function fitToViewport() {
    if (!mapDiv.isConnected) return
    const nav = document.querySelector('.bottom-nav')
    const visible = window.visualViewport?.height ?? window.innerHeight
    const limite = nav ? nav.getBoundingClientRect().top : visible
    const haut = mapDiv.getBoundingClientRect().top
    // 8 px de respiration sous la carte, et un plancher pour rester utilisable.
    const hauteur = Math.max(140, Math.round(limite - haut - 8))
    if (Math.abs(parseFloat(mapDiv.style.height) - hauteur) < 1) return

    // ⚠ La hauteur est posée sur la CARTE elle-même, en style inline : c'est la
    // seule façon de battre à coup sûr le `height: 58vh; min-height: 320px` de
    // la règle générique `.map`. La caler sur le cadre ne suffisait pas — la
    // carte reprenait ses 58vh dès qu'une règle de mise en page n'était pas
    // appliquée, et repassait sous la barre d'onglets.
    mapDiv.style.height = hauteur + 'px'
    mapDiv.style.minHeight = '0'
    mapFrame.style.flex = '0 0 auto'
    mapFrame.style.height = hauteur + 'px'
    map?.invalidateSize({ animate: false })
  }

  /** Bornes de navigation : impossible de sortir du 04 ni de dézoomer au-delà. */
  function applyDepartmentLimits() {
    const fitZoom = map.getBoundsZoom(departmentBounds, false, L.point(12, 12))
    // Deux niveaux de recul : l'extérieur reste masqué, mais on situe mieux la
    // silhouette du département.
    map.setMinZoom(Math.max(6, fitZoom - 2))
    map.setMaxBounds(departmentBounds.pad(0.02))
  }

  /** Rotation de l'écran, barre d'URL mobile qui se rétracte, clavier : la place
   *  disponible change SANS que le conteneur bouge de lui-même. On recalcule donc
   *  à chaque événement, et Leaflet est prévenu à chaque fois (il mémorise la
   *  taille de son conteneur).
   *  Tout se débranche seul quand la vue quitte le DOM : le routeur vide son
   *  conteneur sans prévenir personne, la carte fuiterait sinon. */
  function watchResize() {
    const relayout = () => {
      if (!mapFrame.isConnected) return detach()
      fitToViewport()
      applyDepartmentLimits()
    }

    const vv = window.visualViewport
    window.addEventListener('resize', relayout)
    window.addEventListener('orientationchange', relayout)
    vv?.addEventListener('resize', relayout)
    vv?.addEventListener('scroll', relayout)

    const ro =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            if (!mapDiv.isConnected) return detach()
            map.invalidateSize({ animate: false })
          })
        : null
    ro?.observe(mapDiv)

    function detach() {
      window.removeEventListener('resize', relayout)
      window.removeEventListener('orientationchange', relayout)
      vv?.removeEventListener('resize', relayout)
      vv?.removeEventListener('scroll', relayout)
      ro?.disconnect()
      map?.remove()
    }

    // La barre d'onglets et les polices peuvent finir de se poser après le
    // premier rendu : un dernier calage une fois tout stabilisé.
    setTimeout(relayout, 250)
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
    const located = await resolveStartLocation()
    center = departmentBoundary && isInsideDepartment04(located, departmentBoundary)
      ? located
      : { ...DEFAULT_CENTER, fallback: true }
    if (map) {
      userMarker.setLatLng([center.lat, center.lng])
      drawRadius()
      await loadEvents()
    }
  })

  // setTimeout plutôt que requestAnimationFrame : rAF est gelé quand l'onglet
  // n'est pas visible (app ouverte en arrière-plan) et la carte ne se construisait
  // jamais. Le dimensionnement est géré par invalidateSize + ResizeObserver.
  setTimeout(() => {
    initMap().catch((e) => {
      count.textContent = 'Carte indisponible : ' + e.message
    })
  }, 0)

  return wrap
}

/** Motif SVG discret appliqué uniquement à l'extérieur du contour départemental. */
function applyDepartmentMaskPattern(layer) {
  const path = layer.getElement()
  const svg = path?.ownerSVGElement
  if (!path || !svg) return
  const ns = 'http://www.w3.org/2000/svg'
  let defs = svg.querySelector('defs')
  if (!defs) {
    defs = document.createElementNS(ns, 'defs')
    svg.prepend(defs)
  }
  const pattern = document.createElementNS(ns, 'pattern')
  pattern.id = 'department-04-outside-pattern'
  pattern.setAttribute('patternUnits', 'userSpaceOnUse')
  pattern.setAttribute('width', '132')
  pattern.setAttribute('height', '118')
  pattern.innerHTML = `
    <rect width="132" height="118" fill="#0b55c5"/>
    <path d="M-18 112 112-18M54 142 150 46" stroke="#f4ca15" stroke-width="18" opacity=".09"/>
    <circle cx="112" cy="18" r="17" fill="#539957" opacity=".12"/>
    <image href="/assets/studio-affiche/masks-logo.png" x="8" y="8" width="46" height="46" opacity=".9" transform="rotate(-9 31 31)"/>
    <image href="/assets/studio-affiche/masks-logo.png" x="74" y="61" width="39" height="39" opacity=".72" transform="rotate(11 93 80)"/>
  `
  defs.appendChild(pattern)
  path.setAttribute('fill', 'url(#department-04-outside-pattern)')
  path.setAttribute('fill-opacity', '1')
}
