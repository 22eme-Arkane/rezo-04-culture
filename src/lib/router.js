// Armana — mini routeur par hash (#/route). Sans dépendance.
//
// Chaque route est une fonction async (params) => HTMLElement. Le routeur monte le
// résultat dans le conteneur fourni et gère un état de chargement/erreur simple.

const routes = new Map()
let container = null
let notFound = null

export function defineRoutes(map, opts = {}) {
  for (const [path, handler] of Object.entries(map)) routes.set(path, handler)
  notFound = opts.notFound ?? (() => textNode('Page introuvable.'))
}

function textNode(t) {
  const p = document.createElement('p')
  p.textContent = t
  return p
}

/** Route courante, ex. { path: '/carte', query: URLSearchParams }. */
export function currentRoute() {
  const raw = location.hash.replace(/^#/, '') || '/'
  const [path, qs] = raw.split('?')
  return { path: path || '/', query: new URLSearchParams(qs || '') }
}

export function navigate(path) {
  location.hash = path.startsWith('#') ? path : '#' + path
}

async function render() {
  if (!container) return
  const { path, query } = currentRoute()
  const handler = routes.get(path) ?? notFound

  container.innerHTML = ''
  const loading = document.createElement('div')
  loading.className = 'loading'
  loading.textContent = 'Chargement…'
  container.appendChild(loading)

  try {
    const view = await handler({ query })
    container.innerHTML = ''
    if (view) container.appendChild(view)
  } catch (err) {
    console.error('[Armana] Erreur de rendu :', err)
    container.innerHTML = ''
    const box = document.createElement('div')
    box.className = 'error-box'
    box.textContent = 'Une erreur est survenue : ' + (err?.message ?? err)
    container.appendChild(box)
  }
  window.scrollTo(0, 0)
}

export function startRouter(mountEl) {
  container = mountEl
  window.addEventListener('hashchange', render)
  return render()
}

/** Force un re-rendu de la route courante (après login/logout, etc.). */
export const refresh = render
