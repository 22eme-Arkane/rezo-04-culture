// Armana — écran Map : Leaflet + OSM, filtre par rayon (PostGIS ST_DWithin).
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import '../lib/leafletIcons.js' // correctif icônes marqueur (Vite)

import { el, formatDate, formatTime, formatPrice } from './components.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'
import { DEFAULT_CENTER, getUserLocation, locationErrorMessage } from '../lib/geo.js'
import { eventsWithinRadius } from '../lib/events.js'
import { dayKey, eventDayKeys } from '../lib/recurrence.js'
import { getCategory, setCategory } from '../lib/filter.js'
import { CATEGORIES } from '../lib/events.js'
import { studioHeader } from './studio.js'
import {
  anneauxExterieurs,
  departementDuPoint,
  estDansLeTerritoire,
  loadDepartements,
  nomDepartement,
  estActif,
  CODES_DEPARTEMENTS,
} from '../lib/departements.js'
import { getMesDepartements } from '../lib/mesDepartements.js'

// Le sélecteur de rayon (10/20/50 km) a été retiré : un rayon n'apportait
// qu'un filtre de plus à comprendre, dont le seul effet était de cacher des
// événements pourtant proches. On charge donc tout le territoire — 300 km
// depuis n'importe quel point englobent largement les trois départements.
const RAYON_M = 300000

// Zoom d'ouverture, autrefois déduit du cercle de rayon.
const ZOOM_DEPART = 9

// ⚠ Un intervalle « start ≤ jour ≤ end » ne suffit plus : un événement récurrent
// couvre une longue période mais seulement certains jours de la semaine. On
// passe donc par le même calcul que l'Agenda (src/lib/recurrence.js).
const ymd = dayKey
function coversDay(ev, day) {
  return eventDayKeys(ev).includes(day)
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

  const posControl = el('div', 'map-search-control')
  const posHeading = el('div', 'map-search-control__heading')
  const posIcon = el('span', 'map-search-control__icon')
  posIcon.appendChild(icon('pin'))
  posHeading.appendChild(posIcon)
  const posCopy = el('div', 'map-search-control__copy')
  posCopy.appendChild(el('strong', null, 'Ma position'))
  const codesAffiches = getMesDepartements()
  posCopy.appendChild(
    el(
      'span',
      null,
      codesAffiches.length === CODES_DEPARTEMENTS.length
        ? 'Tout le territoire est affiché'
        : 'Départements affichés : ' + codesAffiches.join(', ')
    )
  )
  posHeading.appendChild(posCopy)
  const recenter = el('button', 'map-search-control__recenter')
  recenter.type = 'button'
  recenter.title = 'Recentrer sur ma position'
  recenter.setAttribute('aria-label', 'Recentrer sur ma position')
  recenter.appendChild(icon('refresh'))
  posHeading.appendChild(recenter)
  posControl.appendChild(posHeading)
  // Retour de la géolocalisation : refus d'autorisation, position introuvable,
  // ou hors département. Sans ce message, le bouton semblait ne rien faire.
  const geoMsg = el('p', 'form__hint map-geo-msg')
  posControl.appendChild(geoMsg)
  controls.appendChild(posControl)

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
  mapFrame.appendChild(resultsBar)
  const mapDiv = el('div', 'map map--studio')
  mapFrame.appendChild(mapDiv)
  wrap.appendChild(mapFrame)

  let map = null
  let center = null
  let userMarker = null
  let contours = null
  let departmentBounds = null
  // Relue à chaque rendu : l'utilisateur peut changer ses départements dans le
  // Profil et revenir sur la carte sans que celle-ci soit reconstruite.
  const mesCodes = () => getMesDepartements()
  const markers = L.layerGroup()

  async function loadEvents() {
    if (!map) return
    count.textContent = 'Recherche…'
    try {
      let events = await eventsWithinRadius({ lat: center.lat, lng: center.lng, radiusM: RAYON_M })
      const cat = getCategory()
      if (cat) events = events.filter((e) => e.category === cat)
      if (selectedDate) events = events.filter((e) => coversDay(e, selectedDate))
      if (contours) {
        // Hors territoire, ou dans un département que l'utilisateur a décoché.
        const codes = mesCodes()
        events = events.filter((e) =>
          estDansLeTerritoire({ lat: Number(e.lat), lng: Number(e.lng) }, contours, codes)
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

  /** Centre la carte sur la position retenue, au zoom d'ouverture. */
  function cadrerSurPosition() {
    applyDepartmentLimits()
    map.setView([center.lat, center.lng], ZOOM_DEPART, { animate: false })
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
    contours = await loadDepartements()
    // Une seule source pour le point de départ : le GPS, avec repli sur
    // Forcalquier. C'est aussi ce qu'utilise le bouton « ma position ».
    center = await getUserLocation()
    // Hors des départements retenus, on part du repli plutôt que d'ouvrir sur
    // une zone entièrement masquée.
    if (!estDansLeTerritoire(center, contours, mesCodes())) {
      center = { ...DEFAULT_CENTER, fallback: true }
    }
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

    // Frontières exactes des départements RETENUS. Un masque 100 % opaque
    // recouvre le monde entier, avec ces départements comme « trous » : rien
    // d'autre n'est visible. Décocher un département le fait donc disparaître
    // de la carte, pas seulement de la liste.
    const codesActifs = mesCodes()
    const contoursActifs = {
      type: 'FeatureCollection',
      features: (contours.features ?? []).filter((f) =>
        codesActifs.includes(f?.properties?.code)
      ),
    }
    const boundaryLayer = L.geoJSON(contoursActifs)
    departmentBounds = boundaryLayer.getBounds()
    map.createPane('departmentMask')
    map.getPane('departmentMask').style.zIndex = '430'
    map.getPane('departmentMask').style.pointerEvents = 'none'
    const world = [[-90, -180], [-90, 180], [90, 180], [90, -180]]
    const departmentMask = L.polygon([world, ...anneauxExterieurs(contoursActifs)], {
      pane: 'departmentMask',
      stroke: false,
      fillColor: '#fff4df',
      fillOpacity: 1,
      fillRule: 'evenodd',
      interactive: false,
      className: 'department-mask',
    }).addTo(map)
    applyDepartmentMaskPattern(departmentMask)
    L.geoJSON(contoursActifs, {
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
    cadrerSurPosition()
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
    if (!map || !departmentBounds) return
    const fitZoom = map.getBoundsZoom(departmentBounds, false, L.point(12, 12))
    // Deux niveaux de recul : l'extérieur reste masqué, mais on situe mieux la
    // silhouette du département.
    map.setMinZoom(Math.max(6, fitZoom - 2))

    // ⚠ Marge volontairement large (mesurée, pas devinée). Au zoom d'ouverture,
    // la vue fait ~0,91° de haut pour 1,03° de bornes : il ne reste presque
    // aucun jeu, et `maxBoundsViscosity: 1` repousse la vue dès que le point
    // visé est près d'un bord. Sur Forcalquier, cela décalait l'ouverture de
    // 0,146° vers le nord — soit ~16 km à côté.
    // Déborder ne montre rien d'indésirable : le masque opaque couvre déjà tout
    // ce qui est hors du département.
    const limites = L.latLngBounds(
      departmentBounds.getSouthWest(),
      departmentBounds.getNorthEast()
    )
    map.setMaxBounds(limites.pad(0.25))
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

  recenter.addEventListener('click', async () => {
    if (!map) return
    geoMsg.textContent = 'Localisation en cours…'
    recenter.disabled = true
    const located = await getUserLocation()
    recenter.disabled = false

    if (located.fallback) {
      geoMsg.textContent = locationErrorMessage(located.reason)
      return
    }
    if (contours && !estDansLeTerritoire(located, contours, mesCodes())) {
      // On ne déplace PAS la carte sans le dire : l'utilisateur croirait que sa
      // position a été prise en compte.
      // Trois cas distincts : un département couvert mais décoché, un
      // département dont les contours existent mais qui n'est pas encore
      // ouvert, ou franchement ailleurs.
      const dept = departementDuPoint(located, contours)
      geoMsg.textContent = !dept
        ? 'Vous semblez être hors du territoire couvert : la carte n’a pas bougé.'
        : estActif(dept)
          ? `Vous êtes dans un département que vous n’affichez pas (${nomDepartement(dept)}). ` +
            'Ajoutez-le depuis Profil → Mes départements.'
          : `Armana ne couvre pas encore ${nomDepartement(dept)} : la carte n’a pas bougé.`
      return
    }

    geoMsg.textContent = ''
    center = located
    userMarker.setLatLng([center.lat, center.lng])
    cadrerSurPosition()
    await loadEvents()
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
