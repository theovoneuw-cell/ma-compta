'use strict';
window.CC = window.CC || {};

const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// ---------------------------------------------------------------------------
// Vue "Aujourd'hui" : cockpit d'accueil (agenda + relances + URSSAF + KPIs)
// ---------------------------------------------------------------------------
CC.renderToday = function () {
  const S = CC.state, settings = S.settings;
  const now = new Date();

  // En-tete : salut personnalisé selon l'heure
  const h = now.getHours();
  const salut = h < 6 ? 'Encore debout' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
  const titre = document.getElementById('todayTitle');
  if (titre) titre.innerHTML = `${salut}, <span class="hello-name">Théo</span>`;

  const dStr = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const dt = document.getElementById('todayDate');
  if (dt) dt.textContent = dStr.charAt(0).toUpperCase() + dStr.slice(1);

  // ---------- KPIs ----------
  const year = now.getFullYear(), month = now.getMonth();
  let encMois = 0;
  S.factures.forEach((f) => {
    if (!CC.stats.isPaid(f)) return;
    const d = CC.util.parseDate(f.dateEncaissement);
    if (d && d.getFullYear() === year && d.getMonth() === month) encMois += +f.montant || 0;
  });
  const fy = CC.stats.forYear(S.factures, year);
  // Impayes = factures reellement emises et non payees. Les previsionnelles sont a part.
  const impayes = fy.filter((f) => !CC.stats.isPaid(f) && !CC.stats.isPrevu(f));
  const previsionnelles = fy.filter((f) => CC.stats.isPrevu(f));
  const totalImp = impayes.reduce((a, f) => a + (+f.montant || 0), 0);
  const totalPrev = previsionnelles.reduce((a, f) => a + (+f.montant || 0), 0);
  const next = CC.stats.urssafSchedule(S.factures, settings).find((e) => e.statut === 'a-venir' && e.urssaf > 0);

  const kpis = [
    { cls: 'green', label: 'Encaissé ce mois', value: CC.util.eur0(encMois), hint: MOIS_FR[month] + ' ' + year },
    { cls: 'amber', label: 'Impayés en cours', value: CC.util.eur0(totalImp), hint: impayes.length + ' facture(s) émise(s)' },
    { cls: 'blue', label: 'Prévisionnel', value: CC.util.eur0(totalPrev), hint: previsionnelles.length + ' à émettre' },
    { cls: 'red', label: 'Prochaine URSSAF', value: next ? CC.util.eur0(next.urssaf) : '—', hint: next ? (MOIS_FR[next.due.mois] + ' ' + next.due.annee) : 'à jour' }
  ];
  const kg = document.getElementById('todayKpis');
  if (kg) kg.innerHTML = kpis.map((k) => `<div class="kpi ${k.cls}"><div class="label">${k.label}</div><div class="value">${k.value}</div><div class="hint">${k.hint}</div></div>`).join('');

  // ---------- Relances ----------
  renderRelances(impayes, settings);

  // ---------- URSSAF ----------
  renderUrssaf(next);

  // ---------- Agenda (asynchrone) ----------
  renderAgenda(now);

  // ---------- Pense-bête ----------
  if (CC.notes) CC.notes.render();
};

function renderRelances(impayes, settings) {
  const box = document.getElementById('todayRelances');
  if (!box) return;
  if (!impayes.length) {
    box.innerHTML = `<div class="ck-empty ck-empty-rich">
      <span class="ck-empty-ic"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></span>
      <span>Aucun impayé</span>
      <small>Toutes tes factures émises ont été réglées.</small>
    </div>`;
    return;
  }
  const sorted = impayes.slice().sort((a, b) => (b.montant || 0) - (a.montant || 0)).slice(0, 8);
  box.innerHTML = sorted.map((f) => {
    const st = CC.stats.statut(f, settings);
    const cls = st === 'retard' ? 'retard' : 'attente';
    return `<div class="ck-row">
      <div class="ck-main">
        <div class="ck-t">${esc(CC.util.clientKey(f.libelle))} <span class="badge ${cls}">${st === 'retard' ? 'retard' : 'attente'}</span></div>
        <div class="ck-s">${f.numFacture ? 'n°' + esc(f.numFacture) + ' · ' : ''}${CC.util.eur(+f.montant || 0)}${f.dateEcheance ? ' · éch. ' + CC.util.frDate(f.dateEcheance) : ''}</div>
      </div>
      <button type="button" class="btn btn-ghost ck-relancer" data-relance="${esc(f.id)}" title="Ouvrir un mail de relance prérempli">Relancer</button>
    </div>`;
  }).join('');
  // Delegation posee une seule fois : la liste est reconstruite a chaque rendu.
  if (!box._relanceBound) {
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-relance]');
      if (b) CC.relancerFacture(b.dataset.relance);
    });
    box._relanceBound = true;
  }
}

// ---------------------------------------------------------------------------
// Relance d'une facture impayee.
//
// La liste des impayes de l'accueil ne servait qu'a regarder : il fallait ouvrir
// Mails, retrouver le client, retaper le numero et le montant. Ce bouton ouvre le
// composeur avec l'objet et le corps deja ecrits — il reste a choisir le
// destinataire (le carnet Google propose la saisie) et a relire.
//
// Le mail n'est JAMAIS envoye d'ici : c'est un brouillon ouvert a l'ecran.
CC.relancerFacture = function (id) {
  const f = (CC.state.factures || []).find((x) => x.id === id);
  if (!f) { CC.toast('Facture introuvable.', 'err'); return; }
  if (!CC.mailbox) { CC.toast('La boîte mail n\'est pas disponible.', 'err'); return; }

  const client = CC.util.clientKey(f.libelle);
  const montant = CC.util.eur(+f.montant || 0);
  const num = (f.numFacture || '').trim();
  const ech = CC.rappels ? CC.rappels.echeanceDe(f, CC.state.settings) : null;
  const retard = ech ? CC.util.daysBetween(ech, new Date()) : 0;
  const sig = (CC.state.settings.mailSignature || '').trim();

  const designation = num ? 'la facture n° ' + num : 'la facture « ' + (f.libelle || '') + ' »';
  const subject = num ? `Relance — facture n° ${num} (${montant})` : `Relance — facture ${montant}`;

  let corps = 'Bonjour,\n\n';
  corps += `Sauf erreur de ma part, ${designation}, d'un montant de ${montant}`;
  if (ech) corps += `, échue le ${CC.util.frDate(CC.util.toISO(ech))}`;
  corps += ', n\'a pas encore été réglée';
  corps += (ech && retard > 0) ? ` (${retard} jour${retard > 1 ? 's' : ''} de retard).\n\n` : '.\n\n';
  corps += 'Pourriez-vous m\'indiquer où en est son traitement ? Si le règlement est déjà parti, merci de ne pas tenir compte de ce message.\n\n';
  corps += 'Bien cordialement,\n';
  if (sig) corps += sig;

  CC.switchTab('mails');
  CC.mailbox._openCompose({ titre: 'Relance — ' + client, subject, body: corps });
};

function renderUrssaf(next) {
  const box = document.getElementById('todayUrssaf');
  if (!box) return;
  if (!next) { box.innerHTML = '<div class="ck-empty">Rien à venir.</div>'; return; }
  box.innerHTML = `<div class="ck-row">
    <div class="ck-main">
      <div class="ck-t">${CC.util.eur0(next.urssaf)}</div>
      <div class="ck-s">T${next.trimestre} ${next.annee} · sur ${CC.util.eur0(next.encaisse)} encaissé · prélevé ~ ${MOIS_FR[next.due.mois]} ${next.due.annee}</div>
    </div>
  </div>`;
}

// Cache local de l'agenda du jour : permet d'afficher quelque chose même sans
// connexion (comme la vue Agenda principale, qui garde la dernière synchro).
const TODAY_CACHE_KEY = 'gcalTodayCache';

async function renderAgenda(now) {
  const box = document.getElementById('todayAgenda');
  if (!box) return;
  box.innerHTML = '<div class="ck-empty">Chargement de l\'agenda…</div>';

  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  let res;
  try { res = await window.api.gcal.events({ timeMin: start.toISOString(), timeMax: end.toISOString(), maxResults: 20 }); }
  catch (e) { res = { error: e.message }; }

  // Connexion OK -> affichage en direct + mise à jour du cache du jour.
  if (res && !res.error) {
    const events = res.events || [];
    saveTodayCache(start, events);
    paintAgenda(box, events, null);
    return;
  }

  // Erreur -> on retombe sur la dernière synchro en cache (lecture seule).
  const cached = loadTodayCache(start);
  if (cached) { paintAgenda(box, cached.events, cached.savedAt, res.error); return; }
  // À défaut, on réutilise le cache mensuel de la vue Agenda, filtré sur aujourd'hui.
  const monthly = loadMonthlyForToday(now);
  if (monthly) { paintAgenda(box, monthly.events, monthly.savedAt, res.error); return; }

  // Pas de cache : message contextuel.
  if (/connect/i.test(res.error)) {
    box.innerHTML = `<div class="ck-empty">Google Agenda non connecté.<br><button class="btn btn-ghost" id="ckConnectGcal" style="margin-top:8px">Connecter Google Agenda</button></div>`;
    const b = document.getElementById('ckConnectGcal');
    if (b) b.addEventListener('click', () => CC.switchTab('settings'));
  } else {
    box.innerHTML = `<div class="ck-empty">Agenda indisponible : ${esc(res.error)}</div>`;
  }
}

function paintAgenda(box, events, savedAt, errStr) {
  let html = '';
  if (savedAt) {
    const kind = CC.util.netKind(errStr);
    if (kind === 'auth') {
      // En ligne mais session Google expirée (iPhone) : reconnexion en un tap.
      html += `<div class="ck-offline">Session Google expirée — <button class="lnk" id="ckReconnect">Reconnecter</button></div>`;
    } else {
      html += `<div class="ck-offline" title="Dernière synchronisation : ${esc(tdFrDateTime(savedAt))}">${kind === 'offline' ? 'Hors connexion' : 'Synchro impossible'} · synchro du ${esc(tdShortDateTime(savedAt))}</div>`;
    }
  }
  if (!events.length) {
    box.innerHTML = html + '<div class="ck-empty">Aucun événement aujourd\'hui.</div>';
  } else {
    html += events.map((e) => {
      const hex = colorOf(e.couleur);
      const h = e.journee ? 'journée' : heure(e.debut);
      return `<div class="ck-row ck-row-ev" style="--evc:${hex}">
        <div class="ck-time">${h}</div>
        <div class="ck-main">
          <div class="ck-t">${esc(e.titre)}</div>
          ${e.lieu ? `<div class="ck-s">${esc(e.lieu)}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    box.innerHTML = html;
  }
  const rb = box.querySelector('#ckReconnect');
  if (rb) rb.addEventListener('click', () => CC.reconnectGoogle(rb));
}

// Palette officielle Google Agenda (mêmes valeurs que la vue Agenda).
const TODAY_GCAL_COLORS = { '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73', '5': '#f6bf26', '6': '#f4511e', '7': '#039be5', '8': '#616161', '9': '#3f51b5', '10': '#0b8043', '11': '#d50000' };
function colorOf(id) { return TODAY_GCAL_COLORS[id] || '#4f46e5'; }

function todayKey(d) { const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }
function saveTodayCache(day, events) {
  try { localStorage.setItem(TODAY_CACHE_KEY, JSON.stringify({ day: todayKey(day), savedAt: new Date().toISOString(), events })); } catch (_) {}
}
function loadTodayCache(day) {
  try {
    const raw = localStorage.getItem(TODAY_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    // On n'affiche le cache que s'il concerne bien aujourd'hui.
    return (c && c.day === todayKey(day)) ? c : null;
  } catch (_) { return null; }
}
// Cache mensuel écrit par la vue Agenda (clé gcalCache:YYYY-MM) : on en extrait
// les événements du jour pour avoir un affichage même si seul l'Agenda a été ouvert.
function loadMonthlyForToday(now) {
  try {
    const mk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const raw = localStorage.getItem('gcalCache:' + mk);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || !Array.isArray(c.events)) return null;
    const tk = todayKey(now);
    const events = c.events.filter((e) => {
      const d = new Date(e.debut);
      return !isNaN(d.getTime()) && todayKey(d) === tk;
    }).sort((a, b) => String(a.debut).localeCompare(String(b.debut)));
    return { events, savedAt: c.savedAt };
  } catch (_) { return null; }
}
function tdFrDateTime(iso) { const d = new Date(iso); if (isNaN(d.getTime())) return ''; return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
function tdShortDateTime(iso) { const d = new Date(iso); if (isNaN(d.getTime())) return ''; return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }

function heure(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
