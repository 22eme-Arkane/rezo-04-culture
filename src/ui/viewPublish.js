// Armana — vue Publier / Modifier un événement.
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import '../lib/leafletIcons.js' // correctif icônes marqueur (Vite)
import { el, formatPrice, formatTime } from './components.js'
import { loginPrompt } from './components.js'
import { posterEventCard } from './posterEventCard.js'
import { createPhotoFramer } from './photoFramer.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { navigate } from '../lib/router.js'
import { isLoggedIn } from '../lib/auth.js'
import { DEFAULT_CENTER, geocodeAddress } from '../lib/geo.js'
import { JOURS, formatJourMois } from '../lib/recurrence.js'
import { toDisplayableFile } from '../lib/heic.js'
import { consumeDraft, consumeSharedFile } from '../lib/draft.js'
import {
  CATEGORIES,
  createEvent,
  updateEvent,
  uploadEventPhotos,
  getEventById,
  isUpcoming,
} from '../lib/events.js'

const PREVIEW_MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'short' })

// Date écrite en toutes lettres, ANNÉE COMPRISE : c'est elle qui manque partout
// ailleurs (l'aperçu n'affiche que « 01 AOÛT »).
const DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** Nombre de mois entre aujourd'hui et `d` (négatif si passé). */
function moisDEcart(d) {
  const now = new Date()
  return (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth())
}

function toolButton(label, title) {
  const b = el('button', 'photo-preview__zoom', label)
  b.type = 'button'
  b.title = title
  b.setAttribute('aria-label', title)
  return b
}

export async function viewPublish({ query } = {}) {
  if (!isLoggedIn()) {
    const wrap = el('section', 'page page--studio-sub')
    wrap.appendChild(studioHeader('Publier', { backTo: '/parametres' }))
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

  const wrap = el('section', 'page page--studio-sub page--studio-publish')
  wrap.appendChild(
    studioHeader(existing ? 'Modifier' : 'Publier', {
      backTo: existing ? '/mes-evenements' : '/parametres',
      backLabel: existing ? 'Mes événements' : 'Profil',
    })
  )
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

  // ⚠ L'ANNÉE est le piège de `datetime-local` : on tape le jour et le mois, et
  // l'année reste sur ce que le navigateur avait proposé. Rien ne la rappelait
  // ensuite — l'aperçu n'affiche que le jour et le mois — si bien qu'un
  // événement saisi pour l'an prochain paraissait juste et se retrouvait tout
  // en bas de l'agenda (cas réel : « La mare où (l')on se Mire », daté 2027).
  // On écrit donc la date en toutes lettres sous le champ.
  const dateEcho = el('span', 'form__hint date-echo')
  fStart.wrap.appendChild(dateEcho)

  // ⚠ Beaucoup de gens laissent « Fin » vide et recréent un SECOND événement
  // pour le lendemain (cas réel : les 21 et 22 août saisis deux fois). Le
  // mécanisme multi-jours existe pourtant déjà — c'est le champ qui ne disait
  // pas à quoi il sert. On l'explique, et on montre l'étendue obtenue.
  fEnd.wrap.appendChild(
    el(
      'span',
      'form__hint',
      'Sur plusieurs jours ? Indiquez ici la date de fin : l’événement apparaîtra ' +
        'sur toutes les dates, sans avoir à le saisir deux fois.'
    )
  )
  const finEcho = el('span', 'form__hint date-echo')
  fEnd.wrap.appendChild(finEcho)

  /** Confirme l'étendue réellement couverte par les deux dates. */
  function majEtendue(debut) {
    finEcho.textContent = ''
    const vf = fEnd.input.value
    if (!debut || !vf) return
    const f = new Date(vf)
    if (Number.isNaN(f.getTime())) return
    const jour = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate())
    const n = Math.round((jour(f) - jour(debut)) / 86400000) + 1
    if (n > 1) {
      finEcho.textContent = `→ ${n} jours : affiché du ${formatJourMois(debut)} au ${formatJourMois(f)}.`
    }
  }

  function majEchoDate() {
    const v = fStart.input.value
    if (!v) {
      dateEcho.textContent = ''
      dateEcho.classList.remove('date-echo--warn')
      majEtendue(null)
      return
    }
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) {
      dateEcho.textContent = ''
      dateEcho.classList.remove('date-echo--warn')
      majEtendue(null)
      return
    }
    majEtendue(d)
    const ecart = moisDEcart(d)
    let texte = '→ ' + DATE_LONGUE.format(d)
    let alerte = false
    // ⚠ `>= 12` et non `> 12` : la faute de frappe classique est l'année juste
    // au-dessus, soit EXACTEMENT 12 mois d'écart — c'est le cas qu'il faut
    // attraper en premier, et un seuil strict le laissait passer.
    if (ecart >= 12) {
      texte += ' — dans un an ou plus, l’année est-elle la bonne ?'
      alerte = true
    } else if (!isUpcoming({ starts_at: d.toISOString(), ends_at: null })) {
      texte += ' — date déjà passée, l’événement n’apparaîtrait pas'
      alerte = true
    }
    dateEcho.textContent = texte
    dateEcho.classList.toggle('date-echo--warn', alerte)
  }

  // --- Répétition -----------------------------------------------------------
  // Le marché du vendredi, les food-trucks du mercredi : un seul événement,
  // qui s'allume sur les bons jours de la période (migration 0013).
  const recurWrap = el('div', 'form__field')
  recurWrap.appendChild(el('span', 'form__label', 'Répétition'))
  const recurToggle = el('label', 'switch')
  const recurInput = el('input')
  recurInput.type = 'checkbox'
  recurToggle.appendChild(recurInput)
  recurToggle.appendChild(el('span', 'switch__text', 'Cet événement se répète'))
  recurWrap.appendChild(recurToggle)

  const recurBox = el('div', 'recur')
  const daysRow = el('div', 'recur__days')
  const dayBtns = JOURS.map((j) => {
    const b = el('button', 'recur__day', j.court)
    b.type = 'button'
    b.dataset.n = String(j.n)
    b.title = j.long
    b.setAttribute('aria-label', j.long)
    b.addEventListener('click', () => {
      b.classList.toggle('is-active')
      refreshPreview()
    })
    daysRow.appendChild(b)
    return b
  })
  recurBox.appendChild(daysRow)
  const recurEcho = el('p', 'form__hint recur__echo')
  recurBox.appendChild(recurEcho)
  recurWrap.appendChild(recurBox)

  const joursChoisis = () =>
    dayBtns.filter((b) => b.classList.contains('is-active')).map((b) => Number(b.dataset.n))

  function majRecurrence() {
    const actif = recurInput.checked
    recurBox.style.display = actif ? '' : 'none'
    // Pour un événement récurrent, « Fin » borne la PÉRIODE et devient requis :
    // sans borne, la répétition remplirait le calendrier indéfiniment.
    const lbl = fEnd.wrap.querySelector('.form__label')
    if (lbl) lbl.textContent = actif ? 'Fin de la période *' : 'Fin (optionnel)'
    if (!actif) {
      recurEcho.textContent = ''
      return
    }
    const noms = JOURS.filter((j) => joursChoisis().includes(j.n)).map((j) => j.long)
    recurEcho.textContent = noms.length
      ? `Tous les ${noms.join('s, tous les ')}s, jusqu’à la date de fin.`
      : 'Choisissez au moins un jour.'
  }
  recurInput.addEventListener('change', () => {
    majRecurrence()
    refreshPreview()
  })

  // Reprise d'un événement existant en édition.
  const joursInit = Array.isArray(init.recur_days) ? init.recur_days.map(Number) : []
  recurInput.checked = joursInit.length > 0
  for (const b of dayBtns) {
    if (joursInit.includes(Number(b.dataset.n))) b.classList.add('is-active')
  }
  majRecurrence()

  // --- Contact de l'organisateur (facultatif) -------------------------------
  const fContact = textField('Contact ou lien (facultatif)', 'text', init.contact || '')
  fContact.input.placeholder = 'Site, page Facebook, téléphone, e-mail…'
  fContact.wrap.appendChild(
    el(
      'span',
      'form__hint',
      'Affiché sur la fiche de l’événement, pour que le public puisse vous joindre.'
    )
  )

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

  // --- Photo(s) -------------------------------------------------------------
  // Un événement sur plusieurs jours peut avoir une affiche par journée : on
  // ouvre autant d'emplacements que de dates annoncées. La photo de
  // l'emplacement N illustrera le jour N dans l'agenda.
  const fPhoto = el('div', 'form__field')
  fPhoto.appendChild(el('span', 'form__label', 'Photo (optionnel)'))
  const slotsBox = el('div', 'photo-slots')
  fPhoto.appendChild(slotsBox)
  const photoHint = el('p', 'form__hint')
  fPhoto.appendChild(photoHint)
  if (sharedPhoto) {
    fPhoto.appendChild(
      el('p', 'form__hint', `📷 Photo importée depuis le partage. Choisissez un fichier pour la remplacer.`)
    )
  } else if (existing?.photo_url) {
    fPhoto.appendChild(el('p', 'form__hint', 'Une photo existe déjà ; en choisir une nouvelle la remplace.'))
  }

  /** Une entrée par jour : { file, crop }. Les trous sont permis. */
  const photos = []
  let slotActif = 0
  let slots = []

  /** Nombre d'affiches proposées = nombre de jours annoncés (borné). */
  function joursAnnonces() {
    // Un événement récurrent peut compter vingt occurrences : une affiche par
    // occurrence n'aurait aucun sens, on en reste à une seule.
    if (recurInput.checked) return 1
    const d = fStart.input.value ? new Date(fStart.input.value) : null
    const f = fEnd.input.value ? new Date(fEnd.input.value) : null
    if (!d || !f || Number.isNaN(d.getTime()) || Number.isNaN(f.getTime())) return 1
    const jour = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate())
    const n = Math.round((jour(f) - jour(d)) / 86400000) + 1
    // Garde-fou : au-delà, on enverrait des dizaines de photos pour un seul
    // événement, ce que la règle de stockage du plan gratuit ne supporte pas.
    return Math.min(Math.max(1, n), 10)
  }

  /** Le cadrage en cours appartient à l'emplacement affiché : le conserver. */
  function memoriserCadrage() {
    if (framingEnabled && photos[slotActif]) photos[slotActif].crop = framer.getCrop()
  }

  async function chargerDansApercu(i) {
    slotActif = i
    try {
      await framer.setFile(photos[i].file)
      framingEnabled = true
      previewMedia.classList.remove('poster-card__media--empty')
      refreshPreview()
    } catch (e) {
      framingEnabled = false
      frameHint.textContent = 'Cette image n’a pas pu être lue : ' + e.message
    }
  }

  function construireEmplacements() {
    const n = joursAnnonces()
    if (slots.length === n) return
    slotsBox.innerHTML = ''
    slots = []
    const debut = fStart.input.value ? new Date(fStart.input.value) : null
    for (let i = 0; i < n; i++) {
      const slot = el('div', 'photo-slot')
      if (n > 1 && debut) {
        const d = new Date(debut)
        d.setDate(d.getDate() + i)
        slot.appendChild(el('span', 'photo-slot__jour', `Jour ${i + 1} · ${formatJourMois(d)}`))
      }
      const input = el('input', 'form__input')
      input.type = 'file'
      input.accept = 'image/*'
      input.addEventListener('change', async () => {
        const brut = input.files?.[0]
        if (!brut) return
        memoriserCadrage()
        try {
          // ⚠ Convertir AVANT de toucher au cadreur : celui-ci affiche le
          // fichier tel quel et échoue sur un HEIC, format qu'aucun navigateur
          // ne décode hors Safari.
          const file = await toDisplayableFile(brut, (etape) => {
            frameHint.textContent = etape
          })
          photos[i] = { file, crop: null }
          await chargerDansApercu(i)
        } catch (e) {
          framingEnabled = false
          frameHint.textContent = 'Photo non utilisable : ' + e.message
        }
      })
      slot.appendChild(input)
      slotsBox.appendChild(slot)
      slots.push(input)
    }
    photoHint.textContent =
      n > 1
        ? `Une affiche par journée. Les jours laissés vides reprennent celle du premier jour.`
        : ''
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
  // Bascule « photo entière ⇄ remplir la carte » : c'est elle qui débloque le
  // déplacement latéral d'une affiche portrait (voir photoFramer.js).
  const wholeToggle = el('button', 'btn btn--ghost btn--sm', 'Photo entière')
  wholeToggle.type = 'button'
  const resetFrame = el('button', 'btn btn--ghost btn--sm', 'Recadrer')
  resetFrame.type = 'button'
  frameTools.appendChild(zoomOut)
  frameTools.appendChild(zoomIn)
  frameTools.appendChild(wholeToggle)
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

  // Toucher l'aperçu ouvre le sélecteur de photo (demande de Matthieu) : c'est
  // le geste que tout le monde tente en premier. Le champ « Parcourir » reste
  // en dessous — il est le seul chemin au clavier, et certains le cherchent.
  // ⚠ Une fois une photo posée, l'aperçu sert au CADRAGE (glisser/pincer) :
  // ouvrir le sélecteur à ce moment-là volerait le geste. On ne l'ouvre donc
  // que tant que l'emplacement est vide.
  previewMedia.classList.add('poster-card__media--choisir')
  previewMedia.setAttribute('role', 'button')
  previewMedia.setAttribute('tabindex', '0')
  previewMedia.setAttribute('aria-label', 'Ajouter une photo')
  const ouvrirSelecteur = () => {
    if (photos[slotActif]) return
    slots[slotActif]?.click()
  }
  previewMedia.addEventListener('click', ouvrirSelecteur)
  previewMedia.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      ouvrirSelecteur()
    }
  })

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
    majEchoDate()
    majRecurrence()
    // Le nombre d'emplacements suit les dates saisies : allonger l'événement
    // d'un jour ouvre aussitôt un emplacement de plus.
    construireEmplacements()
    const ev = previewEventData()
    const d = new Date(ev.starts_at)
    setText('.poster-card__day', String(d.getDate()).padStart(2, '0'))
    setText('.poster-card__month', PREVIEW_MONTH.format(d).replace('.', '').toUpperCase())
    setText('.poster-card__time', formatTime(ev.starts_at))
    setText('.poster-card__category', ev.category)
    setText('.poster-card__title', ev.title)
    setText('.poster-card__place', ev.address)
    setText('.poster-card__price', formatPrice(ev))
    frameTools.style.display = framingEnabled ? '' : 'none'
    syncFrameUi()
  }

  /** Message d'aide et libellé de la bascule, selon le cadrage courant.
   *  Une affiche portrait « qui remplit la carte » n'a AUCUN jeu horizontal :
   *  plutôt que de laisser croire à un bug, on dit quoi faire pour l'obtenir. */
  function syncFrameUi() {
    if (!framingEnabled) {
      frameHint.textContent = 'Choisissez une photo pour la cadrer ici.'
      return
    }
    const { pannableX, pannableY, whole } = framer.info()
    wholeToggle.textContent = whole ? 'Remplir la carte' : 'Photo entière'
    if (pannableX && pannableY) {
      frameHint.textContent = 'Glissez la photo dans tous les sens · pincez (ou molette) pour zoomer.'
    } else if (pannableY) {
      frameHint.textContent =
        'Glissez la photo vers le haut ou le bas. Pour la déplacer aussi vers la ' +
        'gauche ou la droite, touchez « Photo entière ».'
    } else if (pannableX) {
      frameHint.textContent = 'Glissez la photo vers la gauche ou la droite · pincez pour zoomer.'
    } else {
      frameHint.textContent = 'La photo tient entièrement dans la carte. Zoomez (+) pour la recadrer.'
    }
  }

  function setText(sel, value) {
    const node = previewCard.querySelector(sel)
    if (node) node.textContent = value
  }

  // (Le choix d'un fichier est géré par emplacement, dans construireEmplacements.)

  zoomIn.addEventListener('click', () => {
    framer.zoomBy(1.2)
    syncFrameUi()
  })
  zoomOut.addEventListener('click', () => {
    framer.zoomBy(1 / 1.2)
    syncFrameUi()
  })
  wholeToggle.addEventListener('click', () => {
    if (framer.info().whole) framer.fillCard()
    else framer.fitWhole()
    syncFrameUi()
  })
  resetFrame.addEventListener('click', () => {
    framer.reset()
    syncFrameUi()
  })
  // Le glissement change aussi le jeu disponible : on tient le message à jour.
  previewMedia.addEventListener('pointerup', syncFrameUi)

  // Photo reçue par partage (WhatsApp) : on la charge d'emblée dans l'aperçu,
  // en la convertissant au besoin — un partage depuis un iPhone arrive en HEIC.
  // Elle rejoint le premier emplacement, donc le chemin normal d'envoi.
  if (sharedPhoto) {
    toDisplayableFile(sharedPhoto, (etape) => {
      frameHint.textContent = etape
    })
      .then(async (f) => {
        photos[0] = { file: f, crop: null }
        await chargerDansApercu(0)
      })
      .catch((e) => {
        frameHint.textContent = 'Photo non utilisable : ' + e.message
      })
  }

  const submit = el('button', 'btn btn--primary btn--block')
  submit.type = 'submit'
  submit.textContent = existing ? 'Enregistrer les modifications' : 'Publier'
  const msg = el('p', 'form__msg')

  // --- Parcours guidé (création) ou page unique (modification) -------------
  // Publier pour la première fois est intimidant : on avance par petites
  // étapes, l'aperçu se complétant au fil de la saisie. Corriger une faute de
  // frappe, en revanche, ne doit pas imposer de retraverser quatre écrans —
  // d'où la page unique en modification (décision de Matthieu).
  const ETAPES = [
    { titre: 'L’essentiel', champs: [fPhoto, fTitle.wrap, fCategory.wrap] },
    { titre: 'Quand', champs: [fDesc.wrap, fStart.wrap, fEnd.wrap, recurWrap] },
    { titre: 'Où', champs: [locWrap] },
    { titre: 'Détails', champs: [paidWrap, fContact.wrap] },
  ]
  const guide = !existing

  let pages = []
  let pageActive = 0
  const points = el('div', 'etapes-points')
  const barreEtapes = el('div', 'etapes-barre')
  const precedent = el('button', 'btn btn--ghost', 'Retour')
  precedent.type = 'button'
  const suivant = el('button', 'btn btn--primary', 'Continuer')
  suivant.type = 'button'

  if (guide) {
    for (const [i, etape] of ETAPES.entries()) {
      const page = el('div', 'etape')
      page.appendChild(el('h2', 'etape__titre', etape.titre))
      for (const champ of etape.champs) page.appendChild(champ)
      form.appendChild(page)
      pages.push(page)

      const pt = el('span', 'etapes-points__pt')
      pt.title = `Étape ${i + 1} : ${etape.titre}`
      points.appendChild(pt)
    }

    barreEtapes.appendChild(precedent)
    barreEtapes.appendChild(suivant)
    form.appendChild(points)
    form.appendChild(barreEtapes)
    form.appendChild(submit)
    form.appendChild(msg)

    /** Affiche l'étape n et remet les commandes en cohérence. */
    const montrer = (n) => {
      pageActive = Math.max(0, Math.min(ETAPES.length - 1, n))
      pages.forEach((p, i) => (p.hidden = i !== pageActive))
      points
        .querySelectorAll('.etapes-points__pt')
        .forEach((p, i) => p.classList.toggle('is-active', i === pageActive))
      const dernier = pageActive === ETAPES.length - 1
      precedent.hidden = pageActive === 0
      suivant.hidden = dernier
      // Le bouton « Publier » n'apparaît qu'à la fin : le voir dès la première
      // étape laisserait croire qu'on peut publier un formulaire à moitié vide.
      submit.hidden = !dernier
      wrap.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
    precedent.addEventListener('click', () => montrer(pageActive - 1))
    suivant.addEventListener('click', () => {
      // Le navigateur signale lui-même les champs obligatoires vides ; sans
      // cela on pouvait arriver à la dernière étape et découvrir seulement là
      // que le titre manquait.
      const page = pages[pageActive]
      const manquant = [...page.querySelectorAll('input, select, textarea')].find(
        (c) => !c.checkValidity()
      )
      if (manquant) {
        manquant.reportValidity()
        return
      }
      montrer(pageActive + 1)
    })
    montrer(0)
  } else {
    form.appendChild(fPhoto)
    form.appendChild(fTitle.wrap)
    form.appendChild(fCategory.wrap)
    form.appendChild(fDesc.wrap)
    // Dates en pleine largeur (empilées) : en 2 colonnes le champ datetime
    // était trop étroit sur mobile (« croupi »).
    form.appendChild(fStart.wrap)
    form.appendChild(fEnd.wrap)
    form.appendChild(recurWrap)
    form.appendChild(locWrap)
    form.appendChild(paidWrap)
    form.appendChild(fContact.wrap)
    form.appendChild(submit)
    form.appendChild(msg)
  }
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

    // Garde-fou sur l'année. On demande confirmation plutôt que de bloquer : un
    // événement peut légitimement être annoncé très à l'avance, et une date
    // passée peut être corrigée après coup sur un événement existant.
    const debut = new Date(starts_at)
    if (
      moisDEcart(debut) >= 12 &&
      !confirm(
        `Vous avez indiqué :\n\n${DATE_LONGUE.format(debut)}\n\n` +
          'C’est dans un an ou plus. Est-ce bien l’année voulue ?'
      )
    ) {
      return
    }
    if (
      !isUpcoming({ starts_at, ends_at }) &&
      !confirm(
        `Vous avez indiqué :\n\n${DATE_LONGUE.format(debut)}\n\n` +
          'Cette date est déjà passée : l’événement n’apparaîtra pas dans l’agenda. ' +
          'Enregistrer quand même ?'
      )
    ) {
      return
    }
    if (state.lat == null || state.lng == null)
      return fail('Placez le lieu sur la carte (adresse ou clic).')
    if (ends_at && ends_at < starts_at) return fail('La fin est avant le début.')

    // Répétition : sans jour ni borne, elle n'a pas de sens (et remplirait le
    // calendrier indéfiniment). La base refuse d'ailleurs les deux cas.
    const recurrence = recurInput.checked ? joursChoisis() : []
    if (recurInput.checked) {
      if (!recurrence.length) return fail('Choisissez au moins un jour de répétition.')
      if (!ends_at) return fail('Un événement qui se répète doit avoir une date de fin de période.')
    }

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
      recur_days: recurrence,
      contact: fContact.input.value.trim(),
    }

    submit.disabled = true
    submit.textContent = 'Envoi…'
    try {
      const row = existing
        ? await updateEvent(existing.id, payload)
        : await createEvent(payload)
      // Photos : un emplacement par journée annoncée, plus la photo reçue par
      // partage (WhatsApp) si aucun choix manuel n'a été fait.
      memoriserCadrage()
      const aEnvoyer = []
      photos.forEach((p, i) => {
        if (p?.file) aEnvoyer.push({ file: p.file, crop: p.crop, position: i })
      })
      // (La photo reçue par partage a déjà rejoint le premier emplacement, une
      // fois convertie : inutile de la reprendre ici, et surtout on ne veut pas
      // envoyer le fichier BRUT si la conversion a échoué.)
      if (aEnvoyer.length) {
        try {
          // Le cadrage choisi dans l'aperçu est appliqué à la vignette.
          await uploadEventPhotos(row.id, aEnvoyer)
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
