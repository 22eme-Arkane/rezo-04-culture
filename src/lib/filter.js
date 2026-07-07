// Rézo 04 Culture — état de filtre partagé (catégorie active).
// Le filtre agit à la fois sur l'agenda (Calendrier) et sur la carte (Map).
// null = toutes les catégories.

let category = null
const subs = new Set()

export function getCategory() {
  return category
}

export function setCategory(c) {
  category = c || null
  for (const fn of subs) fn(category)
}

export function onCategoryChange(fn) {
  subs.add(fn)
  return () => subs.delete(fn)
}
