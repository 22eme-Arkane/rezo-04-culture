// Armana — extraction de la ville depuis une adresse en texte libre.
//
// ⚠ IL N'Y A PAS DE CHAMP « VILLE » EN BASE. `events.address` est saisie à la
// main, éventuellement pré-remplie par le géocodage puis retouchée. La ville
// doit donc être devinée — et la règle ci-dessous n'a pas été inventée, elle a
// été TIRÉE DES ADRESSES RÉELLEMENT PUBLIÉES sur Armana le 30/08/2026 :
//
//   Chapelle St François, Couvent des Cordeliers, 04300 Forcalquier
//   7 rue Bérenger 04300 Forcalquier
//   Rue Henri Laugier, 04150 Simiane-la-Rotonde
//   17 avenue Balard 04260 Château-Arnoux Saint-Auban
//   04230 Saint Etienne Les Orgues
//   Lurs 04700
//   Ecole Buissonnière, 04110 , Montjustin
//   Foyer Yvan Durand, 04230 Ongles
//   Stade 04110 Montjustin
//   Verger, 04110 Montjustin
//   Espace culturel bonne fontaine 04300 Forcalquier
//
// LE CODE POSTAL EST LE SEUL REPÈRE FIABLE : dix fois sur onze la ville le
// suit, la onzième (« Lurs 04700 ») elle le précède. Les virgules, elles, sont
// mises n'importe où — parfois aucune, parfois une isolée entre le code postal
// et la ville.
//
// EN CAS DE DOUTE, ON REND L'ADRESSE ENTIÈRE. Mieux vaut une ligne trop longue
// qu'une ville fausse : personne ne se déplace sur « Couvent des Cordeliers »
// pris pour un nom de commune.

const CODE_POSTAL = /\b\d{5}\b/

/** Nettoie un fragment : virgules et espaces en trop, « France » final. */
function nettoyer(fragment) {
  return (fragment || '')
    .replace(/\bfrance\b/i, '')
    .replace(/[,\s]+/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim()
}

/**
 * La ville seule, pour les vignettes de l'agenda. L'adresse complète reste sur
 * la fiche de l'événement — c'est là qu'on la cherche quand on s'y rend.
 * @param {string} adresse
 * @returns {string}
 */
export function villeDeLAdresse(adresse) {
  const brut = (adresse || '').trim()
  if (!brut) return ''

  const m = brut.match(CODE_POSTAL)
  if (m) {
    // Après le code postal : la ville, jusqu'à la virgule suivante s'il y en a
    // une (elle n'introduit plus que le pays ou un complément).
    const apres = nettoyer(brut.slice(m.index + m[0].length).split(',')[0])
    if (apres) return apres
    // Code postal en fin de chaîne : la ville est juste avant.
    const avant = brut.slice(0, m.index)
    const dernier = nettoyer(avant.split(',').pop())
    if (dernier) return dernier
  }

  // Sans code postal, une virgule reste un indice acceptable ; sans virgule,
  // on ne devine pas et on rend tout.
  const segments = brut.split(',').map(nettoyer).filter(Boolean)
  if (segments.length > 1) return segments[segments.length - 1]
  return brut
}
