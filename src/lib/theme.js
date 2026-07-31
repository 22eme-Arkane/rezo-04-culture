// Armana — gestion des thèmes visuels (data-theme sur <html>).
//
// Chaque thème est un simple identifiant ; ses couleurs sont définies en CSS
// (src/style.css → blocs [data-theme="..."]). Le choix est persisté en localStorage
// et appliqué en direct (aperçu immédiat).

const KEY = 'rezo-theme'
export const DEFAULT_THEME = 'soleil-or'

// dots = 3 couleurs représentatives (fond, accent principal, accent secondaire)
// affichées dans le sélecteur.
export const THEMES = [
  { key: 'soleil-or', label: "Soleil d'Or", dots: ['#f7be00', '#1e2b45', '#e0900b'] },
  { key: 'lavande', label: 'Lavande Chic', dots: ['#ede7fb', '#7c5cff', '#b567dc'] },
  { key: 'provence', label: 'Ciel de Provence', dots: ['#f3e7d6', '#c85a3a', '#3e7ca8'] },
  { key: 'ocre', label: "Terre d'Ocre", dots: ['#e8dfc8', '#b07a2e', '#6e7a3a'] },
  { key: 'foret', label: 'Forêt Résine', dots: ['#14261c', '#e3b23c', '#6fbf73'] },
  { key: 'nuit', label: 'Nuit', dots: ['#0c0e1a', '#5b8cff', '#ff5b8c'] },
]

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY)
    return THEMES.some((x) => x.key === t) ? t : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function applyTheme(key) {
  document.documentElement.dataset.theme = key
  try {
    localStorage.setItem(KEY, key)
  } catch {
    /* stockage indisponible : le thème reste actif pour la session */
  }
}

export function initTheme() {
  applyTheme(getTheme())
}
