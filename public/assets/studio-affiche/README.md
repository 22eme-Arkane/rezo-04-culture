# Kit graphique Studio Affiche

Ce dossier ne contient aucune photographie. Les six overlays SVG sont transparents et se placent au-dessus de la photo fournie par l'organisateur. La texture papier peut être ajoutée au dernier plan visuel, tandis que `abstract-culture.svg` sert uniquement lorsqu'aucune photo n'est disponible.

## Utilisation

Importer `studio-affiche.css`, puis appliquer une variante sur le conteneur de l'image :

```html
<div class="studio-media studio-media--diagonal">
  <img src="photo-organisateur.webp" alt="Description de l'événement">
</div>
```

Variantes disponibles : `diagonal`, `curve`, `ribbons`, `frame`, `stage`, `wave`. Utiliser `studio-media--empty` uniquement quand l'événement n'a pas de photo.

Les titres, dates, catégories, prix et boutons ne doivent pas être intégrés dans les images : ils restent du vrai contenu HTML pour conserver la lisibilité, l'accessibilité et la traduction.
