// Rézo 04 Culture — correctif des icônes de marqueur Leaflet avec un bundler (Vite).
//
// Avec Vite, les chemins d'images par défaut de Leaflet (marker-icon.png…) sont
// cassés → marqueur sans image. On importe les images comme assets et on réassocie
// explicitement. `delete _getIconUrl` force Leaflet à relire nos options plutôt que
// de reconstruire un chemin par déduction. Import à effet de bord : à charger dans
// tout écran qui affiche des marqueurs (carte, mini-carte de publication).
import L from 'leaflet'
import iconUrl from 'leaflet/dist/images/marker-icon.png'
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png'
import shadowUrl from 'leaflet/dist/images/marker-shadow.png'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })
