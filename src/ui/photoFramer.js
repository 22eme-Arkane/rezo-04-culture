// Cadrage interactif d'une photo dans une boîte d'aperçu.
//
// L'utilisateur glisse pour déplacer et pince (ou molette) pour zoomer : ce qu'il
// voit dans l'aperçu est EXACTEMENT ce que la vignette de l'agenda affichera.
//
// Modèle : on garde le rectangle visible en PIXELS DE LA PHOTO SOURCE
// ({sx, sy, sw, sh}). C'est directement ce qu'attend ctx.drawImage() au moment de
// fabriquer la vignette — aucune conversion approximative entre CSS et canvas.

const MAX_ZOOM = 4

const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

/**
 * @param {HTMLElement} box conteneur (overflow:hidden, position:relative)
 * @param {HTMLImageElement} img image à cadrer, enfant de `box`
 */
export function createPhotoFramer(box, img) {
  const state = { zoom: 1, sx: 0, sy: 0, w: 0, h: 0 }
  const pointers = new Map()
  let pinchDist = 0
  let objectUrl = null

  box.style.touchAction = 'none' // sinon le glissement fait défiler la page
  box.style.cursor = 'grab'

  /** Échelle d'affichage : « couvrir la boîte » × zoom utilisateur. */
  function scale() {
    const cw = box.clientWidth
    const ch = box.clientHeight
    if (!cw || !ch || !state.w || !state.h) return 0
    return Math.max(cw / state.w, ch / state.h) * state.zoom
  }

  function apply() {
    const s = scale()
    if (!s) return
    const sw = box.clientWidth / s
    const sh = box.clientHeight / s
    // Le cadre ne peut jamais sortir de la photo.
    state.sx = clamp(state.sx, 0, Math.max(0, state.w - sw))
    state.sy = clamp(state.sy, 0, Math.max(0, state.h - sh))
    img.style.position = 'absolute'
    img.style.maxWidth = 'none'
    img.style.objectFit = 'fill' // dimensions déjà proportionnelles : aucun recadrage implicite
    img.style.width = state.w * s + 'px'
    img.style.height = state.h * s + 'px'
    img.style.left = -state.sx * s + 'px'
    img.style.top = -state.sy * s + 'px'
  }

  /** Zoom en gardant fixe le centre de la zone visible. */
  function setZoom(z) {
    const s0 = scale()
    if (!s0) return
    const cx = state.sx + box.clientWidth / s0 / 2
    const cy = state.sy + box.clientHeight / s0 / 2
    state.zoom = clamp(z, 1, MAX_ZOOM)
    const s1 = scale()
    state.sx = cx - box.clientWidth / s1 / 2
    state.sy = cy - box.clientHeight / s1 / 2
    apply()
  }

  /** Cadrage initial : centré sur la photo (et non calé en haut à gauche). */
  function centerCrop() {
    const s = scale()
    if (!s) {
      state.sx = 0
      state.sy = 0
      return
    }
    state.sx = (state.w - box.clientWidth / s) / 2
    state.sy = (state.h - box.clientHeight / s) / 2
  }

  function panBy(dx, dy) {
    const s = scale()
    if (!s) return
    state.sx -= dx / s
    state.sy -= dy / s
    apply()
  }

  // --- Gestes ---------------------------------------------------------------
  const onDown = (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 2) pinchDist = distance()
    box.setPointerCapture?.(e.pointerId)
    box.style.cursor = 'grabbing'
  }

  const onMove = (e) => {
    const prev = pointers.get(e.pointerId)
    if (!prev) return
    e.preventDefault()
    const next = { x: e.clientX, y: e.clientY }
    pointers.set(e.pointerId, next)

    if (pointers.size >= 2) {
      const d = distance()
      if (pinchDist > 0 && d > 0) setZoom(state.zoom * (d / pinchDist))
      pinchDist = d
      return
    }
    panBy(next.x - prev.x, next.y - prev.y)
  }

  const onUp = (e) => {
    pointers.delete(e.pointerId)
    if (pointers.size < 2) pinchDist = 0
    if (!pointers.size) box.style.cursor = 'grab'
  }

  const onWheel = (e) => {
    if (!state.w) return
    e.preventDefault()
    setZoom(state.zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12))
  }

  function distance() {
    const [a, b] = [...pointers.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  box.addEventListener('pointerdown', onDown)
  box.addEventListener('pointermove', onMove, { passive: false })
  box.addEventListener('pointerup', onUp)
  box.addEventListener('pointercancel', onUp)
  box.addEventListener('wheel', onWheel, { passive: false })

  // La boîte d'aperçu est fluide (largeur de l'écran) : on recalcule au besoin.
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => apply()) : null
  ro?.observe(box)

  return {
    /** Charge un fichier local et réinitialise le cadrage. */
    async setFile(file) {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      objectUrl = URL.createObjectURL(file)
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = () => reject(new Error('Image illisible'))
        img.src = objectUrl
      })
      state.w = img.naturalWidth
      state.h = img.naturalHeight
      state.zoom = 1
      centerCrop()
      apply()
    },
    zoomBy(factor) {
      setZoom(state.zoom * factor)
    },
    reset() {
      state.zoom = 1
      centerCrop()
      apply()
    },
    /** Rectangle visible en pixels source — prêt pour ctx.drawImage(). */
    getCrop() {
      const s = scale()
      if (!s) return null
      return {
        sx: state.sx,
        sy: state.sy,
        sw: box.clientWidth / s,
        sh: box.clientHeight / s,
      }
    },
    destroy() {
      box.removeEventListener('pointerdown', onDown)
      box.removeEventListener('pointermove', onMove)
      box.removeEventListener('pointerup', onUp)
      box.removeEventListener('pointercancel', onUp)
      box.removeEventListener('wheel', onWheel)
      ro?.disconnect()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    },
  }
}
