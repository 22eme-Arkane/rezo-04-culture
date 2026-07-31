// Armana — vue Publier / Modifier un événement.
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import '../lib/leafletIcons.js' // correctif icônes marqueur (Vite)
import { el, formatPrice, formatTime } from './components.js'
import { loginPrompt } from './components.js'
import { posterEventCard } from './posterEventCard.js'
import { createPhotoFramer } from './photoFramer.js'
import { icon } from './icons.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn } from '../lib/auth.js'
import { DEFAULT_CENTER, geocodeAddress } from '../lib/geo.js'
import { consumeDraft, consumeSharedFile } from '../lib/draft.js'
import {
  CATEGORIES,
  createEvent,
  updateEvent,
  uploadEventPhoto,
  getEventById,
} from '../lib/events.js'

const PREVIEW_MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'short' })

function toolButton(label, title) {
  const b = el('button', 'photo-preview__zoom', label)
  b.type = 'button'
  b.title = title
  b.setAttribute('aria-label', title)
  return b
}

export async function viewPublish({ query } = {}) {
  if (!isLoggedIn()) {
    const wrap = el('section', 'page')
    wrap.appendChild(el('h1', 'page__title', 'Publier un événement'))
    wrap.appendChild(loginPrompt('Connectez-vous pour publier un événement.'))
    return wrap
  }

  const editId = query?.get('id') || null
  const existing = editId ? await getEventById(editId) : null
  // Brouillon pré-rempli (issu de l'analyse d'un message). Consommé une seule fois.
  const draft = existing ? null : consumeDraft()
  const init = existing || draft || {}
  // Photo reçue via le partage natif (WhatsApp…), en création uniquement.
  const sharedPhoto = existing ? null : consumeSharedFile()

  const wrap = el('section', 'page')
  wrap.appendChild(el('h1', 'page__title', existing ? 'Modifier l’événement' : 'Publier un événement'))
  wrap.appendChild(
    el(
      'p',
      'page__subtitle',
      'Votre événement sera visible après validation par un modérateur.'
    )
  )

  // Raccourci : pré-remplir depuis un message (WhatsApp…). Uniquement en création.
  if (!existing) {
    const fromMsg = el('button', 'btn btn--green btn--block')
    fromMsg.type = 'button'
    fromMsg.appendChild(icon('message'))
    fromMsg.appendChild(document.createTextNode(' Remplir depuis un message'))
    fromMsg.addEventListener('click', () => navigate('/importer'))
    wrap.appendChild(fromMsg)
  }
  if (draft) {
    wrap.appendChild(
      el('p', 'demo-note', 'Champs pré-remplis depuis votre message — vérifiez et complétez le lieu.')
    )
  }

  const form = el('form', 'form form--wide')

  const fTitle = textField('Titre *', 'text', init.title)
  const fCategory = selectField('Catégorie *', CATEGORIES, init.category)
  const fDesc = textareaField('Description', init.description)
  const fStart = textField('Début *', 'datetime-local', toLocalInput(init.starts_at))
  const fEnd = textField('Fin (optionnel)', 'datetime-local', toLocalInput(init.ends_at))

  // Gratuit / payant.
  const paidWrap = el('div', 'form__field')
  paidWrap.appendChild(el('span', 'form__label', 'Tarif'))
  const paidRow = el('div', 'form__row')
  const paidToggle = el('label', 'switch')
  const paidInput = el('input')
  paidInput.type = 'checkbox'
  paidInput.checked = Boolean(init.is_paid)
  paidToggle.appendChild(paidInput)
  paidToggle.appendChild(el('span', 'switch__text', 'Événement payant'))
  paidRow.appendChild(paidToggle)
  const priceInput = el('input', 'form__input form__input--price')
  priceInput.type = 'number'
  priceInput.min = '0'
  priceInput.step = '0.5'
  priceInput.placeholder = 'Prix en €'
  if (init.price != null) priceInput.value = init.price
  priceInput.style.display = paidInput.checked ? '' : 'none'
  paidInput.addEventListener('change', () => {
    priceInput.style.display = paidInput.checked ? '' : 'none'
  })
  paidRow.appendChild(priceInput)
  paidWrap.appendChild(paidRow)

  // Localisation : adresse + géocodage + mini-carte avec marqueur déplaçable.
  const locWrap = el('div', 'form__field')
  locWrap.appendChild(el('span', 'form__label', 'Lieu *'))
  const addrRow = el('div', 'form__row')
  const addrInput = el('input', 'form__input')
  addrInput.type = 'text'
  addrInput.placeholder = 'Adresse ou ville (ex. Place du Marché, Digne-les-Bains)'
  if (init.address) addrInput.value = init.address
  const geoBtn = el('button', 'btn btn--ghost', 'Localiser')
  geoBtn.type = 'button'
  addrRow.appendChild(addrInput)
  addrRow.appendChild(geoBtn)
  locWrap.appendChild(addrRow)
  const coordReadout = el('p', 'form__hint', 'Placez le marqueur sur le lieu exact.')
  locWrap.appendChild(coordReadout)
  const pickMap = el('div', 'map map--pick')
  locWrap.appendChild(pickMap)

  // Photo.
  const fPhoto = el('div', 'form__field')
  fPhoto.appendChild(el('span', 'form__label', 'Photo (optionnel)'))
  const photoInput = el('input', 'form__input')
  photoInput.type = 'file'
  photoInput.accept = 'image/*'
  fPhoto.appendChild(photoInput)
  if (sharedPhoto) {
    fPhoto.appendChild(
      el('p', 'form__hint', `📷 Photo importée depuis le partage. Choisissez un fichier pour la remplacer.`)
    )
  } else if (existing?.photo_url) {
    fPhoto.appendChild(el('p', 'form__hint', 'Une photo existe déjà ; en choisir une nouvelle l’ajoute.'))
  }

  // --- Aperçu « tel qu'il apparaîtra dans l'agenda » ---
  // Exactement la carte de l'Agenda (date à gauche sur fond de couleur, photo au
  // centre, informations à droite). La photo se cadre au doigt : ce que l'auteur
  // voit ici est ce que la vignette affichera.
  const preview = el('div', 'photo-preview')
  preview.appendChild(el('p', 'form__label', 'Aperçu dans l’agenda'))
  const previewCard = posterEventCard(previewEventData(), {
    preview: true,
    showGem: false,
    index: 0,
  })
  preview.appendChild(previewCard)
  const frameHint = el('p', 'form__hint photo-preview__hint', '')
  preview.appendChild(frameHint)

  const frameTools = el('div', 'photo-preview__tools')
  const zoomOut = toolButton('−', 'Dézoomer')
  const zoomIn = toolButton('+', 'Zoomer')
  const resetFrame = el('button', 'btn btn--ghost btn--sm', 'Recadrer')
  resetFrame.type = 'button'
  frameTools.appendChild(zoomOut)
  frameTools.appendChild(zoomIn)
  frameTools.appendChild(resetFrame)
  preview.appendChild(frameTools)
  fPhoto.appendChild(preview)

  const previewMedia = previewCard.querySelector('.poster-card__media')
  let previewImg = previewMedia.querySelector('img')
  if (!previewImg) {
    previewImg = el('img')
    previewImg.alt = ''
    previewMedia.appendChild(previewImg)
  }
  const framer = createPhotoFramer(previewMedia, previewImg)
  let framingEnabled = false

  /** Données de l'événement telles que saisies, pour l'aperçu. */
  function previewEventData() {
    const startsAt = fStart?.input.value ? new Date(fStart.input.value) : new Date()
    return {
      id: 'preview',
      title: fTitle?.input.value.trim() || 'Titre de votre événement',
      starts_at: startsAt.toISOString(),
      address: addrInput?.value.trim() || 'Lieu à préciser',
      category: fCategory?.input.value || 'Catégorie ?',
      is_paid: paidInput?.checked ?? false,
      price: paidInput?.checked && priceInput?.value ? Number(priceInput.value) : null,
      thumb_url: null,
    }
  }

  /** Met à jour les textes de l'aperçu sans reconstruire la carte (le cadrage
   *  de la photo, lui, doit survivre à chaque frappe au clavier). */
  function refreshPreview() {
    const ev = previewEventData()
    const d = new Date(ev.starts_at)
    setText('.poster-card__day', String(d.getDate()).padStart(2, '0'))
    setText('.poster-card__month', PREVIEW_MONTH.format(d).replace('.', '').toUpperCase())
    setText('.poster-card__time', formatTime(ev.starts_at))
    setText('.poster-card__category', ev.category)
    setText('.poster-card__title', ev.title)
    setText('.poster-card__place', ev.address)
    setText('.poster-card__price', formatPrice(ev))
    frameHint.textContent = framingEnabled
      ? 'Glissez la photo pour la cadrer · pincez (ou molette) pour zoomer.'
      : 'Choisissez une photo pour la cadrer ici.'
    frameTools.style.display = framingEnabled ? '' : 'none'
  }

  function setText(sel, value) {
    const node = previewCard.querySelector(sel)
    if (node) node.textContent = value
  }

  photoInput.addEventListener('change', async () => {
    const file = photoInput.files?.[0]
    if (!file) return
    try {
      await framer.setFile(file)
      framingEnabled = true
      previewMedia.classList.remove('poster-card__media--empty')
      refreshPreview()
    } catch (e) {
      framingEnabled = false
      frameHint.textContent = 'Cette image n’a pas pu être lue : ' + e.message
    }
  })

  zoomIn.addEventListener('click', () => framer.zoomBy(1.2))
  zoomOut.addEventListener('click', () => framer.zoomBy(1 / 1.2))
  resetFrame.addEventListener('click', () => framer.reset())

  // Photo reçue par partage (WhatsApp) : on la charge d'emblée dans l'aperçu.
  if (sharedPhoto) {
    framer
      .setFile(sharedPhoto)
      .then(() => {
        framingEnabled = true
        previewMedia.classList.remove('poster-card__media--empty')
        refreshPreview()
      })
      .catch(() => {})
  }

  const submit = el('button', 'btn btn--primary btn--block')
  submit.type = 'submit'
  submit.textContent = existing ? 'Enregistrer les modifications' : 'Publier'
  const msg = el('p', 'form__msg')

  form.appendChild(fTitle.wrap)
  form.appendChild(fCategory.wrap)
  form.appendChild(fDesc.wrap)
  // Dates en pleine largeur (empilées) : en 2 colonnes le champ datetime était
  // trop étroit sur mobile (« croupi »).
  form.appendChild(fStart.wrap)
  form.appendChild(fEnd.wrap)
  form.appendChild(paidWrap)
  form.appendChild(locWrap)
  form.appendChild(fPhoto)
  form.appendChild(submit)
  form.appendChild(msg)
  wrap.appendChild(form)

  // --- Mini-carte de sélection ---
  const state = {
    lat: init.lat ?? null,
    lng: init.lng ?? null,
  }
  let map = null
  let marker = null

  // --- Brouillon persistant (création uniquement) ---
  // Sur mobile, quitter l'app peut recharger la page au retour : on sauvegarde la
  // saisie en continu (localStorage) et on la restaure. Vidé à la publication.
  const FORM_KEY = 'rezo-publish-form'
  function saveSnapshot() {
    if (existing) return
    try {
      localStorage.setItem(
        FORM_KEY,
        JSON.stringify({
          title: fTitle.input.value,
          category: fCategory.input.value,
          description: fDesc.input.value,
          startLocal: fStart.input.value,
          endLocal: fEnd.input.value,
          isPaid: paidInput.checked,
          price: priceInput.value,
          address: addrInput.value,
          lat: state.lat,
          lng: state.lng,
        })
      )
    } catch {
      /* stockage indisponible : sans effet */
    }
  }
  if (!existing && !draft) {
    let saved = null
    try {
      saved = JSON.parse(localStorage.getItem(FORM_KEY) || 'null')
    } catch {
      saved = null
    }
    // On ne restaure que s'il y a une vraie saisie (titre ou description ou point).
    if (saved && (saved.title || saved.description || saved.lat != null)) {
      fTitle.input.value = saved.title ?? ''
      if (saved.category) fCategory.input.value = saved.category
      fDesc.input.value = saved.description ?? ''
      fStart.input.value = saved.startLocal ?? ''
      fEnd.input.value = saved.endLocal ?? ''
      paidInput.checked = Boolean(saved.isPaid)
      priceInput.style.display = paidInput.checked ? '' : 'none'
      if (saved.price) priceInput.value = saved.price
      addrInput.value = saved.address ?? ''
      if (saved.lat != null) {
        state.lat = saved.lat
        state.lng = saved.lng
      }
      const note = el('p', 'demo-note')
      note.textContent = '📝 Brouillon restauré — votre saisie a été conservée. '
      const clearBtn = el('button', 'btn btn--link btn--sm', 'Recommencer à zéro')
      clearBtn.type = 'button'
      clearBtn.addEventListener('click', () => {
        try {
          localStorage.removeItem(FORM_KEY)
        } catch {}
        location.reload()
      })
      note.appendChild(clearBtn)
      wrap.insertBefore(note, form)
    }
  }
  form.addEventListener('input', () => {
    refreshPreview()
    clearTimeout(saveSnapshot._t)
    saveSnapshot._t = setTimeout(saveSnapshot, 300)
  })
  form.addEventListener('change', () => {
    refreshPreview()
    saveSnapshot()
  })
  refreshPreview()
  if (draft) saveSnapshot() // l'import depuis un message est lui aussi protégé

  function setPoint(lat, lng, recenter = true) {
    state.lat = lat
    state.lng = lng
    saveSnapshot() // le lieu fait partie du brouillon persistant
    coordReadout.textContent = `Coordonnées : ${lat.toFixed(5)}, ${lng.toFixed(5)}`
    if (!map) return
    if (!marker) {
      marker = L.marker([lat, lng], { draggable: true }).addTo(map)
      marker.on('dragend', () => {
        const p = marker.getLatLng()
        setPoint(p.lat, p.lng, false)
      })
    } else {
      marker.setLatLng([lat, lng])
    }
    if (recenter) map.setView([lat, lng], 14)
  }

  geoBtn.addEventListener('click', async () => {
    const q = addrInput.value.trim()
    if (!q) return
    geoBtn.disabled = true
    geoBtn.textContent = '…'
    try {
      const r = await geocodeAddress(q)
      if (!r) {
        msg.className = 'form__msg form__msg--err'
        msg.textContent = 'Adresse introuvable. Placez le marqueur manuellement.'
      } else {
        setPoint(r.lat, r.lng)
        msg.className = 'form__msg'
        msg.textContent = ''
      }
    } catch (e) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent =
        'Recherche impossible (' + e.message + '). Touchez directement la carte pour placer le lieu.'
    } finally {
      geoBtn.disabled = false
      geoBtn.textContent = 'Localiser'
    }
  })

  requestAnimationFrame(() => {
    const start = state.lat != null ? [state.lat, state.lng] : [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng]
    map = L.map(pickMap).setView(start, state.lat != null ? 14 : 10)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution:
        '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(map)
    if (state.lat != null) setPoint(state.lat, state.lng)
    map.on('click', (e) => setPoint(e.latlng.lat, e.latlng.lng, false))
    setTimeout(() => map.invalidateSize(), 100)
    // Depuis un message : une ville a été détectée mais pas de coordonnées → géocode auto.
    if (draft && state.lat == null && addrInput.value.trim()) geoBtn.click()
  })

  // --- Soumission ---
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    msg.className = 'form__msg'
    msg.textContent = ''

    const title = fTitle.input.value.trim()
    const starts_at = fStart.input.value ? new Date(fStart.input.value).toISOString() : null
    const ends_at = fEnd.input.value ? new Date(fEnd.input.value).toISOString() : null

    if (!title) return fail('Le titre est requis.')
    if (!fCategory.input.value) return fail('Choisissez une catégorie.')
    if (!starts_at) return fail('La date de début est requise.')
    if (state.lat == null || state.lng == null)
      return fail('Placez le lieu sur la carte (adresse ou clic).')
    if (ends_at && ends_at < starts_at) return fail('La fin est avant le début.')

    const payload = {
      title,
      description: fDesc.input.value.trim(),
      starts_at,
      ends_at,
      is_paid: paidInput.checked,
      price: paidInput.checked && priceInput.value ? Number(priceInput.value) : null,
      lat: state.lat,
      lng: state.lng,
      address: addrInput.value.trim(),
      category: fCategory.input.value,
    }

    submit.disabled = true
    submit.textContent = 'Envoi…'
    try {
      const row = existing
        ? await updateEvent(existing.id, payload)
        : await createEvent(payload)
      // Photo : choix manuel prioritaire, sinon la photo partagée (WhatsApp).
      const file = photoInput.files?.[0] || sharedPhoto
      if (file) {
        try {
          // Le cadrage choisi dans l'aperçu est appliqué à la vignette.
          await uploadEventPhoto(row.id, file, framingEnabled ? framer.getCrop() : null)
        } catch (pe) {
          // Ne JAMAIS avaler cet échec en silence : l'auteur croyait sa photo
          // publiée, et un problème de droits sur le Storage passait inaperçu.
          console.warn('[Armana] Photo non envoyée :', pe.message)
          fail(
            'L’événement est bien enregistré, mais la photo n’a pas pu être envoyée (' +
              pe.message +
              '). Vous pourrez la rajouter depuis « Mes événements ».'
          )
          submit.disabled = false
          submit.textContent = 'Continuer sans la photo'
          submit.type = 'button'
          submit.addEventListener('click', () => navigate('/mes-evenements'), { once: true })
          return
        }
      }
      // Publication réussie : le brouillon persistant n'a plus lieu d'être.
      if (!existing) {
        try {
          localStorage.removeItem(FORM_KEY)
        } catch {}
      }
      navigate('/mes-evenements')
    } catch (err) {
      fail(err.message)
      submit.disabled = false
      submit.textContent = existing ? 'Enregistrer les modifications' : 'Publier'
    }

    function fail(m) {
      msg.className = 'form__msg form__msg--err'
      msg.textContent = m
    }
  })

  return wrap
}

// --- Champs ---
function textField(label, type, value) {
  const wrap = el('label', 'form__field')
  wrap.appendChild(el('span', 'form__label', label))
  const input = el('input', 'form__input')
  input.type = type
  if (value != null) input.value = value
  wrap.appendChild(input)
  return { wrap, input }
}

function textareaField(label, value) {
  const wrap = el('label', 'form__field')
  wrap.appendChild(el('span', 'form__label', label))
  const input = el('textarea', 'form__input form__textarea')
  input.rows = 4
  if (value != null) input.value = value
  wrap.appendChild(input)
  return { wrap, input }
}

function selectField(label, options, value) {
  const wrap = el('label', 'form__field')
  wrap.appendChild(el('span', 'form__label', label))
  const input = el('select', 'form__input')
  // Option vide EN TÊTE : sans elle, le premier choix de la liste (« Musique »)
  // était retenu par défaut et tous les événements non renseignés atterrissaient
  // en Musique — filtres et badges faussés dès la première soirée.
  const empty = el('option', null, '— Choisir une catégorie —')
  empty.value = ''
  input.appendChild(empty)
  for (const o of options) {
    const opt = el('option', null, o)
    opt.value = o
    if (o === value) opt.selected = true
    input.appendChild(opt)
  }
  if (!options.includes(value)) empty.selected = true
  wrap.appendChild(input)
  return { wrap, input }
}

/** ISO → valeur d'input datetime-local (heure locale, sans secondes). */
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
