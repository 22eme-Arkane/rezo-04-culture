// Armana — Tableau de bord (admin uniquement) : fréquentation, membres,
// événements, contenus, et entretien du stockage.
//
// Tout vient d'un SEUL appel RPC (admin_stats) : une requête, agrégée côté base.
import { el } from './components.js'
import { icon } from './icons.js'
import { studioHeader } from './studio.js'
import { isAdmin, isLoggedIn } from '../lib/auth.js'
import { getAdminStats } from '../lib/admins.js'
import { purgePastMonths } from '../lib/events.js'
import { navigate } from '../lib/router.js'

const MOIS = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: '2-digit' })
const JOUR = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' })

export async function viewStats() {
  const wrap = el('section', 'page page--studio-sub')
  wrap.appendChild(studioHeader('Statistiques', { backTo: '/parametres' }))

  if (!isLoggedIn() || !isAdmin()) {
    wrap.appendChild(el('p', 'empty-state', 'Réservé aux administrateurs.'))
    return wrap
  }

  const body = el('div', 'stats')
  body.appendChild(el('p', 'form__hint', 'Chargement des statistiques…'))
  wrap.appendChild(body)

  let stats
  try {
    stats = await getAdminStats()
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

  // --- Chiffres clés -------------------------------------------------------
  const kpis = el('div', 'stats-grid')
  kpis.appendChild(kpi('Membres', stats.membres.total, `+${stats.membres.new_7j} cette semaine`))
  kpis.appendChild(
    kpi('Visites aujourd’hui', stats.visites.aujourdhui, `${stats.visites.hier} hier`)
  )
  kpis.appendChild(
    kpi('Événements à venir', stats.evenements.a_venir, `${stats.evenements.total} au total`)
  )
  kpis.appendChild(
    kpi('En attente', stats.evenements.en_attente, 'à modérer', stats.evenements.en_attente > 0)
  )
  body.appendChild(kpis)

  if (stats.evenements.en_attente > 0) {
    const go = el('button', 'btn btn--primary btn--block', 'Aller à la modération')
    go.type = 'button'
    go.addEventListener('click', () => navigate('/moderation'))
    body.appendChild(go)
  }

  // --- Fréquentation -------------------------------------------------------
  body.appendChild(section('Fréquentation'))
  const freq = el('div', 'settings-group')
  freq.appendChild(line('Visiteurs uniques (7 jours)', stats.visites.uniques_7j))
  freq.appendChild(line('Visiteurs uniques (30 jours)', stats.visites.uniques_30j))
  freq.appendChild(line('Connectés dans les 24 h', stats.connexions.actifs_24h))
  freq.appendChild(line('Connectés dans les 7 jours', stats.connexions.actifs_7j))
  freq.appendChild(line('Connectés dans les 30 jours', stats.connexions.actifs_30j))
  freq.appendChild(line('Jamais connectés', stats.connexions.jamais_connectes))
  freq.appendChild(line('E-mails confirmés', stats.connexions.emails_confirmes))
  body.appendChild(freq)

  const daily = (stats.visites.par_jour ?? []).map((d) => ({
    label: JOUR.format(new Date(d.label + 'T12:00:00')),
    n: d.n,
  }))
  if (daily.length) {
    body.appendChild(section('Visites par jour (30 derniers jours)'))
    body.appendChild(barChart(daily))
  } else {
    body.appendChild(
      el(
        'p',
        'form__hint',
        'Aucune visite enregistrée pour l’instant : le comptage démarre avec cette version.'
      )
    )
  }

  // --- Événements ----------------------------------------------------------
  body.appendChild(section('Événements'))
  const evs = el('div', 'settings-group')
  evs.appendChild(line('Publiés (approuvés)', stats.evenements.approuves))
  evs.appendChild(line('En attente', stats.evenements.en_attente))
  evs.appendChild(line('Rejetés', stats.evenements.rejetes))
  evs.appendChild(line('Payants', stats.evenements.payants))
  evs.appendChild(line('Créés cette semaine', stats.evenements.new_7j))
  evs.appendChild(line('Créés ce mois-ci', stats.evenements.new_30j))
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

  // --- Entretien du stockage ----------------------------------------------
  body.appendChild(section('Entretien du stockage'))
  const maint = el('div', 'settings-group')
  maint.appendChild(line('Événements des mois passés', stats.evenements.a_purger))
  body.appendChild(maint)
  body.appendChild(
    el(
      'p',
      'form__hint',
      'Le mois en cours et les mois à venir sont conservés. Les mois révolus peuvent être supprimés — photos comprises — pour libérer de l’espace.'
    )
  )

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
