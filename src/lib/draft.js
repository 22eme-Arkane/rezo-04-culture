// Armana — passage d'un brouillon d'événement entre écrans (mémoire volatile).
//
// - draft : objet pré-rempli (issu de l'analyse d'un message) consommé UNE fois par le
//   formulaire de publication.
// - sharedText : texte reçu via le partage natif (share_target), consommé par l'écran
//   d'import pour pré-remplir la zone de texte.

let draft = null
let sharedText = null
let sharedFile = null

export function setDraft(d) {
  draft = d
}
export function consumeDraft() {
  const d = draft
  draft = null
  return d
}

export function setSharedText(t) {
  sharedText = t
}
export function consumeSharedText() {
  const t = sharedText
  sharedText = null
  return t
}

// Photo partagée (File) : posée par le partage natif, consommée par le formulaire.
export function setSharedFile(f) {
  sharedFile = f
}
export function peekSharedFile() {
  return sharedFile
}
export function consumeSharedFile() {
  const f = sharedFile
  sharedFile = null
  return f
}
