// Rézo 04 Culture — détection de mise à jour (nouveau déploiement).
//
// Principe : chaque build fige un identifiant (__BUILD_ID__) et publie /version.json
// avec le même id. L'app compare son id embarqué au /version.json en ligne :
//  - différent → un nouveau déploiement existe → proposer de recharger ;
//  - recharger récupère le nouvel index.html (SW en "network-first") et les nouveaux
//    assets hachés.
// En dev, /version.json n'existe pas (404) → aucune fausse alerte.

const CURRENT = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'

export function currentBuild() {
  return CURRENT
}

/** Compare l'id embarqué au /version.json en ligne. */
export async function checkForUpdate() {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' })
    if (!res.ok) return { ok: false, updateAvailable: false }
    const data = await res.json()
    const latest = data?.build
    return {
      ok: true,
      updateAvailable: Boolean(latest) && latest !== CURRENT,
      latest,
      current: CURRENT,
    }
  } catch {
    return { ok: false, updateAvailable: false }
  }
}

/** Force la prise en compte de la nouvelle version puis recharge. */
export function reloadForUpdate() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistration()
      .then((reg) => reg?.update?.())
      .catch(() => {})
      .finally(() => location.reload())
  } else {
    location.reload()
  }
}

/**
 * Vérification silencieuse au lancement : met à jour le SW en arrière-plan et
 * appelle onUpdate(result) si une nouvelle version est disponible.
 */
export async function initUpdateCheck(onUpdate) {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      reg?.update?.()
    } catch {
      /* ignore */
    }
  }
  const r = await checkForUpdate()
  if (r.updateAvailable) onUpdate?.(r)
}
