// Armana — Tableau de bord (admin uniquement) : fréquentation, membres,
// événements, contenus, et entretien du stockage.
//
// Tout vient d'un SEUL appel RPC (admin_stats) : une requête, agrégée côté base.
import { el } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { isAdmin, isLoggedIn } from '../lib/auth.js'
import {
  amIOwner,
  getAdminStats,
  getPublishedTotal,
  getUpcomingPublished,
  getVisitsSummary,
  getVisitsTotal,
} from '../lib/admins.js'
import { myPendingCount } from '../lib/moderation.js'
import { nomDepartement } from '../lib/departements.js'
import { purgePastMonths } from '../lib/events.js'
import { navigate } from '../lib/router.js'

const MOIS = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' })
const JOUR = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' })
const MOIS_LONG = new Intl.DateTimeFormat('fr-FR', { month: 'long' })

export async function viewStats() {
  const wrap = el('section', 'page page--studio-sub page--studio-blue page--studio-stats')
  wrap.appendChild(studioHeader('Statistiques', { backTo: '/parametres' }))

  if (!isLoggedIn() || !isAdmin()) {
    wrap.appendChild(el('p', 'empty-state', 'Réservé aux modérateurs.'))
    return wrap
  }

  const body = el('div', 'stats')
  body.appendChild(el('p', 'form__hint', 'Chargement des statistiques…'))
  wrap.appendChild(body)

  let stats
  let visites = null
  let publiesTotal = null
  let visitesTotal = null
  let aVenirPublies = null
  let enAttenteZone = null
  try {
    // Les deux en parallèle : le total vit dans sa propre fonction (0023),
    // inutile d'attendre l'un puis l'autre.
    ;[stats, visites, publiesTotal, visitesTotal, aVenirPublies, enAttenteZone] =
      await Promise.all([
        getAdminStats(),
        getVisitsSummary(),
        getPublishedTotal(),
        getVisitsTotal(),
        getUpcomingPublished(),
        myPendingCount().catch(() => null),
      ])
  } catch (e) {
    body.innerHTML = ''
    body.appendChild(el('p', 'form__msg form__msg--err', 'Statistiques indisponibles : ' + e.message))
    body.appendChild(
      el(
        'p',
        'form__hint',
        'Si l’erreur mentionne « admin_stats », la migration 0009 n’a pas encore été appliquée dans Supabase.'
      )
    )
    return wrap
  }

  body.innerHTML = ''

  // ⚠ Déclaré ICI et non plus bas : la tuile ci-dessous s'en sert, et un
  // `const` lu avant sa déclaration lèverait une erreur.
  const anon = stats.visites_anonymes ?? {}

  // --- Les trois chiffres qui comptent, en tête d'écran --------------------
  // Le coup d'œil de la maquette : visites, membres, événements, en très gros.
  // Le détail complet suit juste en dessous — rien n'est retiré.
  const bandeau = el('div', 'stats-hero')
  const grandChiffre = (valeur, mot) => {
    const l = el('div', 'stats-hero__ligne')
    l.appendChild(el('span', 'stats-hero__valeur', String(valeur ?? 0)))
    l.appendChild(el('span', 'stats-hero__mot', mot))
    bandeau.appendChild(l)
  }
  // ⚠ CHAQUE LIBELLÉ DIT SON UNITÉ. C'est la leçon de l'écart 1130 / 2079 :
  // les deux chiffres étaient justes, mais rien ne distinguait les VISITES
  // (chaque ouverture) des VISITEURS (les personnes). Ces quatre-là sont des
  // cumuls DEPUIS LA CRÉATION d'Armana ; les tuiles du dessous découpent par
  // période. Ne jamais mélanger les deux unités sans le dire dans le mot.
  grandChiffre(visites?.total ?? visitesTotal ?? 0, 'visites totales')
  grandChiffre(
    (stats.visites.uniques_total ?? 0) + (anon.uniques_total ?? 0),
    'visiteurs uniques'
  )
  grandChiffre(stats.membres.total, 'membres inscrits')
  // ⚠ Depuis la CRÉATION d'Armana, purges comprises. Compter la table donnerait
  // un total qui RÉTRÉCIT à chaque purge mensuelle : ce chiffre vient donc d'un
  // compteur que rien n'efface. Repli sur les seuls à venir tant que la
  // migration 0025 n'est pas appliquée.
  grandChiffre(publiesTotal ?? aVenirPublies ?? stats.evenements.a_venir, 'événements publiés')
  body.appendChild(bandeau)

  // --- Les quatre tuiles : LES VISITES, par période ------------------------
  // ⚠ Des VISITES, jamais des visiteurs uniques : quelqu'un qui ouvre
  // l'application trois fois aujourd'hui compte trois fois. Et la tuile
  // « Membres » a disparu — elle répétait mot pour mot le grand chiffre situé
  // juste au-dessus.
  // Semaine et mois sont CALENDAIRES : depuis lundi, depuis le 1er. Ce sont les
  // bornes auxquelles on pense en lisant ces mots ; des fenêtres glissantes de
  // 7 ou 30 jours auraient donné des chiffres qu'on n'aurait pas su recouper.
  const kpis = el('div', 'stats-grid')
  const visitesDuJour = visites?.aujourdhui ?? (stats.visites.aujourdhui ?? 0) + (anon.aujourdhui ?? 0)
  const visitesHier = visites?.hier ?? (stats.visites.hier ?? 0) + (anon.hier ?? 0)
  kpis.appendChild(kpi('Visites aujourd’hui', visitesDuJour))
  kpis.appendChild(kpi('Visites hier', visitesHier))
  kpis.appendChild(kpi('Visites cette semaine', visites?.semaine ?? '—', 'depuis lundi'))
  // Le NOM du mois plutôt que « depuis le 1er » : « août » se lit d'un coup
  // d'œil et lève l'ambiguïté quand on consulte l'écran un 2 du mois.
  kpis.appendChild(kpi('Visites ce mois-ci', visites?.mois ?? '—', MOIS_LONG.format(new Date())))
  body.appendChild(kpis)

  // ⚠ MA ZONE, pas tout le territoire. La tuile comptait les événements des
  // six départements alors que le bouton juste dessous mène à une file
  // cloisonnée : un modérateur du 04 lisait 7 et n'en trouvait que 3 à
  // traiter. `myPendingCount()` applique can_moderate(), comme la file.
  const enAttente = enAttenteZone ?? stats.evenements.en_attente

  // Le bouton suit la tuile : il ne s'affiche que s'il y a vraiment quelque
  // chose à traiter DANS SA ZONE, sinon il menait à une file vide.
  if (enAttente > 0) {
    const go = el('button', 'btn btn--primary btn--block', 'Aller à la modération')
    go.type = 'button'
    go.addEventListener('click', () => navigate('/moderation'))
    body.appendChild(go)
  }

  // --- Fréquentation -------------------------------------------------------
  // ⚠ Deux choses distinctes, autrefois mélangées dans un seul tableau :
  //   * QUI VIENT — passages réellement observés, mesurés depuis peu ;
  //   * L'ÉTAT DES COMPTES — historique d'authentification, qui remonte à la
  //     création de chaque compte.
  // Côte à côte sans explication, on lisait « 36 connectés sur 7 jours » sous
  // « 26 visiteurs sur 30 jours » et l'on croyait le tableau faux.
  body.appendChild(section('Qui vient'))
  const freq = el('div', 'settings-group')
  freq.appendChild(line('Navigateurs sans compte (7 jours)', anon.uniques_7j ?? 0))
  freq.appendChild(line('Navigateurs sans compte (30 jours)', anon.uniques_30j ?? 0))
  // Cumul depuis le début de la mesure, inscrits et non-inscrits réunis.
  const totalVisiteurs = (stats.visites.uniques_total ?? 0) + (anon.uniques_total ?? 0)
  // ⚠ « majorant » et non « total » : rien ne relie un navigateur anonyme au
  // compte créé ensuite, donc quelqu'un qui s'inscrit après être passé sans
  // compte est compté DEUX fois — définitivement. C'est un plafond, pas un
  // nombre de personnes.
  freq.appendChild(line('Membres + navigateurs sans compte (majorant)', totalVisiteurs))
  body.appendChild(freq)

  // --- État des comptes ----------------------------------------------------
  body.appendChild(section('État des comptes'))
  const comptes = el('div', 'settings-group')
  comptes.appendChild(line('Dernière connexion il y a moins de 24 h', stats.connexions.actifs_24h))
  comptes.appendChild(line('Dernière connexion il y a moins de 7 jours', stats.connexions.actifs_7j))
  comptes.appendChild(line('Dernière connexion il y a moins de 30 jours', stats.connexions.actifs_30j))
  comptes.appendChild(line('E-mails confirmés', stats.connexions.emails_confirmes))
  body.appendChild(comptes)

  // Courbe : les deux publics cumulés, c'est la fréquentation réelle.
  const parJour = new Map()
  for (const d of stats.visites.par_jour ?? []) parJour.set(d.label, d.n)
  for (const d of anon.par_jour ?? []) parJour.set(d.label, (parJour.get(d.label) ?? 0) + d.n)
  const daily = [...parJour.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, n]) => ({
      label: JOUR.format(new Date(label + 'T12:00:00')),
      n,
    }))
  // D'où viennent les gens : passages des 30 derniers jours par département
  // (position GPS quand elle est donnée — seul le département est enregistré).
  const parDept = (stats.par_departement ?? []).map((d) => ({
    label: d.code === '—' ? 'non renseigné' : `${d.code} ${nomDepartement(d.code)}`,
    n: d.n,
  }))
  if (parDept.length) {
    body.appendChild(section('Jours de présence par département (30 derniers jours)'))
    body.appendChild(barChart(parDept))
  }

  // Où se passe l'activité : les événements à venir, par département.
  const evtDept = (stats.evenements_par_departement ?? []).map((d) => ({
    label: d.code === '—' ? 'hors territoire' : `${d.code} ${nomDepartement(d.code)}`,
    n: d.n,
  }))
  if (evtDept.length) {
    body.appendChild(section('Événements publiés à venir, par département'))
    body.appendChild(barChart(evtDept))
  }

  if (daily.length) {
    body.appendChild(section('Jours de présence par jour, tous publics (30 derniers jours)'))
    body.appendChild(barChart(daily))
  }

  // --- Événements ----------------------------------------------------------
  body.appendChild(section('Événements'))
  const evs = el('div', 'settings-group')
  evs.appendChild(line('Publiés (approuvés)', stats.evenements.approuves))
  evs.appendChild(line('En attente', stats.evenements.en_attente))
  evs.appendChild(line('Rejetés', stats.evenements.rejetes))
  evs.appendChild(line('Payants (tous statuts)', stats.evenements.payants))
  // ⚠ Fenêtres GLISSANTES, pas semaine ni mois calendaires : le 3 du mois,
  // « ce mois-ci » remontait jusqu'au mois précédent sans le dire.
  evs.appendChild(line('Créés ces 7 jours', stats.evenements.new_7j))
  evs.appendChild(line('Créés ces 30 jours', stats.evenements.new_30j))
  body.appendChild(evs)

  const parMois = (stats.par_mois ?? []).map((m) => ({
    label: MOIS.format(new Date(m.label + '-01T12:00:00')),
    n: m.n,
  }))
  if (parMois.length) {
    body.appendChild(section('Événements par mois'))
    body.appendChild(barChart(parMois))
  }

  if (stats.par_categorie?.length) {
    body.appendChild(section('Par catégorie'))
    body.appendChild(barChart(stats.par_categorie))
  }

  if (stats.top_auteurs?.length) {
    body.appendChild(section('Contributeurs les plus actifs'))
    body.appendChild(barChart(stats.top_auteurs))
  }

  // --- Contenus ------------------------------------------------------------
  body.appendChild(section('Contenus'))
  const cont = el('div', 'settings-group')
  cont.appendChild(line('Photos stockées', stats.photos.total))
  cont.appendChild(line('Favoris posés', stats.favoris.total))
  cont.appendChild(line('Retours reçus', stats.retours.total))
  cont.appendChild(line('— dont bugs', stats.retours.bugs))
  cont.appendChild(line('— dont avis', stats.retours.avis))
  body.appendChild(cont)

  // --- Entretien du stockage : PROPRIÉTAIRE UNIQUEMENT ----------------------
  // La purge est irréversible et globale : elle n'a rien à faire entre les
  // mains d'un modérateur (et la base la refuse de toute façon depuis 0020).
  if (await amIOwner().catch(() => false)) {
    body.appendChild(section('Entretien du stockage'))
    const maint = el('div', 'settings-group')
    maint.appendChild(line('Événements des mois passés', stats.evenements.a_purger))
    body.appendChild(maint)

    const purgeBtn = el('button', 'btn btn--block', 'Nettoyer les mois passés')
    purgeBtn.type = 'button'
    purgeBtn.disabled = stats.evenements.a_purger === 0
    const purgeMsg = el('p', 'form__msg')
    purgeBtn.addEventListener('click', async () => {
      if (
        !confirm(
          `Supprimer définitivement ${stats.evenements.a_purger} événement(s) des mois passés, ainsi que leurs photos ?\n\nCette action est irréversible.`
        )
      )
        return
      purgeBtn.disabled = true
      purgeBtn.textContent = 'Nettoyage…'
      try {
        const r = await purgePastMonths()
        purgeMsg.className = 'form__msg'
        purgeMsg.textContent = `${r.events} événement(s) et ${r.files} fichier(s) supprimés.`
        purgeBtn.textContent = 'Nettoyage terminé'
      } catch (e) {
        purgeMsg.className = 'form__msg form__msg--err'
        purgeMsg.textContent = 'Nettoyage impossible : ' + e.message
        purgeBtn.disabled = false
        purgeBtn.textContent = 'Réessayer'
      }
    })
    body.appendChild(purgeBtn)
    body.appendChild(purgeMsg)
  }

  const stamp = new Date(stats.generated_at)
  body.appendChild(
    el('p', 'form__hint', 'Arrêté au ' + stamp.toLocaleString('fr-FR') + '.')
  )

  return wrap
}

// --- Petits composants ------------------------------------------------------

function kpi(label, value, hint, alert = false) {
  const box = el('div', 'stat-tile' + (alert ? ' stat-tile--alert' : ''))
  box.appendChild(el('span', 'stat-tile__value', String(value ?? 0)))
  box.appendChild(el('span', 'stat-tile__label', label))
  if (hint) box.appendChild(el('span', 'stat-tile__hint', hint))
  return box
}

function section(title) {
  const h = el('h2', 'stats-section')
  h.appendChild(icon('chevronRight'))
  h.appendChild(document.createTextNode(' ' + title))
  return h
}

function line(label, value) {
  const r = el('div', 'settings-row settings-row--static')
  r.appendChild(el('span', 'settings-row__label', label))
  r.appendChild(el('span', 'settings-row__value', String(value ?? 0)))
  return r
}

/** Histogramme horizontal en CSS pur — aucune bibliothèque, aucun réseau. */
function barChart(rows) {
  const max = Math.max(1, ...rows.map((r) => r.n))
  const box = el('div', 'bars')
  for (const r of rows) {
    const line = el('div', 'bars__row')
    line.appendChild(el('span', 'bars__label', r.label))
    const track = el('div', 'bars__track')
    const fill = el('div', 'bars__fill')
    fill.style.width = Math.round((r.n / max) * 100) + '%'
    track.appendChild(fill)
    line.appendChild(track)
    line.appendChild(el('span', 'bars__value', String(r.n)))
    box.appendChild(line)
  }
  return box
}
