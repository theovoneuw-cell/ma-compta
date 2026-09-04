'use strict';
window.CC = window.CC || {};

// ---------------------------------------------------------------------------
// Feuille de temps et rentabilité réelle (PC / Mac uniquement)
//
// La compta dit ce que rapporte un client. Elle ne dit pas ce qu'il COÛTE en
// heures. Tant qu'on n'a pas les deux, « ce client paie bien » n'est qu'une
// impression.
//
// Ici on saisit des séances, et on les croise avec le CA encaissé, les
// cotisations URSSAF et les frais de route des trajets. Ce qui sort : ce qu'il
// te reste réellement par heure, client par client.
//
// Volontairement SANS chronomètre : il faut penser à le lancer, penser à
// l'arrêter, et une fois oublié il fabrique des durées fausses. La saisie
// après coup, en une ligne, est plus fidèle.
// ---------------------------------------------------------------------------

CC.temps = {
  _bound: false,

  seances() { return CC.state.temps || (CC.state.temps = []); },

  // ---- Séances -------------------------------------------------------------
  ajouter(s) {
    const client = CC.util.clientKey(s.client || '');
    this.seances().push({
      id: CC.util.uid(),
      date: s.date || CC.util.toISO(new Date()),
      client: client === '(SANS NOM)' ? '' : client,
      minutes: Math.max(1, Math.round(+s.minutes || 0)),
      note: (s.note || '').trim(),
      factureId: ''
    });
    CC.markDirty();
  },

  supprimer(id) {
    CC.state.temps = this.seances().filter((x) => x.id !== id);
    CC.markDirty();
    this._paint();
  },

  // Séances d'une année (ou toutes si l'année sélectionnée est « toutes »).
  pourAnnee(year) {
    const list = this.seances();
    if (year === 'all') return list.slice();
    return list.filter((s) => CC.util.yearOf(s.date) === year);
  },

  // ---- Rentabilité ---------------------------------------------------------
  //
  // Pour chaque client : les heures saisies, le CA encaissé, les cotisations
  // URSSAF de ce CA, les frais de route rattachés, et ce qui reste par heure.
  //
  // Le rattachement des trajets se fait sur le MOTIF (et l'adresse d'arrivée) :
  // un trajet ne porte pas de client. C'est une heuristique, elle est annoncée
  // comme telle à l'écran plutôt que présentée comme une vérité.
  rentabilite(year) {
    const S = CC.state;
    const seances = this.pourAnnee(year);
    const factures = CC.stats.forYear(S.factures, year);
    const trajets = (S.trajets || []).filter((t) => year === 'all' || CC.util.yearOf(t.date) === year);

    const map = new Map();
    const ligne = (cle) => {
      if (!map.has(cle)) map.set(cle, { client: cle, minutes: 0, ca: 0, urssaf: 0, route: 0, seances: 0, factures: 0 });
      return map.get(cle);
    };

    seances.forEach((s) => {
      const l = ligne(s.client || '(sans client)');
      l.minutes += s.minutes;
      l.seances++;
    });

    factures.forEach((f) => {
      if (!CC.stats.isPaid(f)) return;
      const l = ligne(CC.util.clientKey(f.libelle));
      const montant = CC.stats.ht(f);
      l.ca += montant;
      l.factures++;
      // Cotisations au taux du trimestre où l'argent est entré : c'est ce qui
      // partira réellement à l'URSSAF pour cette facture.
      const y = CC.stats.yearOf(f), t = CC.stats.trimOf(f);
      if (y && t) l.urssaf += montant * CC.urssafRate(y, t) / 100;
    });

    trajets.forEach((t) => {
      const cle = clientDuTrajet(t, Array.from(map.keys()));
      if (!cle) return;
      map.get(cle).route += coutReel(t);
    });

    const lignes = Array.from(map.values()).map((l) => {
      const heures = l.minutes / 60;
      const net = l.ca - l.urssaf - l.route;
      return Object.assign(l, {
        heures,
        net,
        brutHeure: heures > 0 ? l.ca / heures : null,
        netHeure: heures > 0 ? net / heures : null
      });
    });

    // Les clients dont on a saisi des heures d'abord, du meilleur taux au moins bon. Ceux
    // sans heures saisies ferment la marche : leur taux est inconnu, pas nul.
    lignes.sort((a, b) => {
      if ((a.heures > 0) !== (b.heures > 0)) return a.heures > 0 ? -1 : 1;
      if (a.heures > 0) return b.netHeure - a.netHeure;
      return b.ca - a.ca;
    });
    return lignes;
  },

  // ---- Rendu ---------------------------------------------------------------
  render() {
    if (!CC.estBureau()) return;
    this._paint();
  },

  _paint() {
    this._paintClients();
    this._paintKpis();
    this._paintTable();
    this._paintJournal();
  },

  // Liste des clients connus (factures + séances déjà saisies) pour la saisie.
  _paintClients() {
    const dl = document.getElementById('tpClients');
    if (!dl) return;
    const set = new Set();
    (CC.state.factures || []).forEach((f) => { const k = CC.util.clientKey(f.libelle); if (k && k !== '(SANS NOM)') set.add(k); });
    this.seances().forEach((s) => { if (s.client) set.add(s.client); });
    dl.innerHTML = Array.from(set).sort((a, b) => a.localeCompare(b, 'fr')).map((c) => `<option value="${esc(c)}">`).join('');
  },

  _paintKpis() {
    const box = document.getElementById('tpKpis');
    if (!box) return;
    const year = CC.state.selectedYear;
    const seances = this.pourAnnee(year);
    const minutes = seances.reduce((a, s) => a + s.minutes, 0);
    const lignes = this.rentabilite(year).filter((l) => l.heures > 0);
    const totalCa = lignes.reduce((a, l) => a + l.ca, 0);
    const totalNet = lignes.reduce((a, l) => a + l.net, 0);
    const totalH = lignes.reduce((a, l) => a + l.heures, 0);
    const meilleur = lignes.length ? lignes[0] : null;
    const pire = lignes.length > 1 ? lignes[lignes.length - 1] : null;

    const k = [
      { cls: 'indigo', label: 'Temps saisi', value: duree(minutes), hint: seances.length + ' séance(s)' },
      { cls: 'green', label: 'Net par heure', value: totalH > 0 ? CC.util.eur(totalNet / totalH) : '—', hint: totalH > 0 ? 'après URSSAF et frais de route' : 'aucune heure saisie' },
      { cls: 'blue', label: 'Brut par heure', value: totalH > 0 ? CC.util.eur(totalCa / totalH) : '—', hint: totalH > 0 ? CC.util.eur0(totalCa) + ' encaissés' : '—' },
      meilleur
        ? { cls: 'amber', label: 'Écart entre clients', value: pire ? CC.util.eur(meilleur.netHeure - pire.netHeure) : '—', hint: pire ? `${court(meilleur.client)} vs ${court(pire.client)}` : 'un seul client avec des heures' }
        : { cls: 'amber', label: 'Écart entre clients', value: '—', hint: 'rien à comparer pour l\'instant' }
    ];
    box.innerHTML = k.map((x) => `<div class="kpi ${x.cls}"><div class="label">${x.label}</div><div class="value">${x.value}</div><div class="hint">${esc(x.hint)}</div></div>`).join('');
  },

  _paintTable() {
    const box = document.getElementById('tpRenta');
    if (!box) return;
    const lignes = this.rentabilite(CC.state.selectedYear);
    const avec = lignes.filter((l) => l.heures > 0);
    const sans = lignes.filter((l) => l.heures === 0 && l.ca > 0);

    if (!avec.length) {
      box.innerHTML = `<div class="ck-empty">Aucune heure saisie pour cette période. Ajoute une séance ci-dessus — dès la première, le tableau se remplit.</div>`;
      return;
    }

    // L'échelle des barres se cale sur le meilleur taux : ce qu'on compare ici,
    // ce sont les clients entre eux, pas un objectif absolu.
    const max = Math.max.apply(null, avec.map((l) => Math.max(0, l.netHeure)));
    let html = `<table class="table tp-table">
      <thead><tr>
        <th>Client</th><th class="num">Heures</th><th class="num">CA encaissé</th>
        <th class="num">URSSAF</th><th class="num">Route</th><th class="num">Net / heure</th><th class="tp-bar-col"></th>
      </tr></thead><tbody>`;
    html += avec.map((l) => {
      const pc = max > 0 ? Math.max(2, Math.round(Math.max(0, l.netHeure) / max * 100)) : 0;
      const cls = l.netHeure < 0 ? 'neg' : (max > 0 && l.netHeure < max * 0.55 ? 'bas' : 'haut');
      return `<tr>
        <td class="client">${esc(l.client)}<span class="tp-sub">${l.seances} séance(s)${l.factures ? ' · ' + l.factures + ' facture(s)' : ''}</span></td>
        <td class="num">${duree(l.minutes)}</td>
        <td class="num">${CC.util.eur0(l.ca)}</td>
        <td class="num tp-moins">− ${CC.util.eur0(l.urssaf)}</td>
        <td class="num tp-moins">${l.route > 0 ? '− ' + CC.util.eur0(l.route) : '—'}</td>
        <td class="num tp-rate ${cls}">${CC.util.eur(l.netHeure)}</td>
        <td class="tp-bar-col"><span class="tp-bar ${cls}" style="width:${pc}%"></span></td>
      </tr>`;
    }).join('');
    html += '</tbody></table>';

    if (sans.length) {
      const ca = sans.reduce((a, l) => a + l.ca, 0);
      html += `<p class="tp-foot">${sans.length} client(s) facturé(s) sans aucune heure saisie (${CC.util.eur0(ca)} encaissés) : ${esc(sans.slice(0, 5).map((l) => l.client).join(', '))}${sans.length > 5 ? '…' : ''}. Leur taux horaire reste inconnu.</p>`;
    }
    html += `<p class="tp-foot">Net par heure = CA encaissé − cotisations URSSAF − frais de route réels (carburant et péages des trajets rattachés au client par leur motif).</p>`;
    box.innerHTML = html;
  },

  _paintJournal() {
    const box = document.getElementById('tpJournal');
    if (!box) return;
    const list = this.pourAnnee(CC.state.selectedYear).slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (!list.length) { box.innerHTML = '<div class="ck-empty">Aucune séance pour cette période.</div>'; return; }
    box.innerHTML = `<table class="table"><thead><tr>
        <th>Date</th><th>Client</th><th class="num">Durée</th><th>Note</th><th class="col-actions"></th>
      </tr></thead><tbody>` + list.map((s) => `<tr>
        <td class="fdate">${CC.util.frDate(s.date)}</td>
        <td class="client">${esc(s.client || '—')}</td>
        <td class="num montant">${duree(s.minutes)}</td>
        <td class="tp-note">${esc(s.note)}</td>
        <td class="col-actions"><button class="mini-btn" data-tp-del="${esc(s.id)}" title="Supprimer cette séance">✕</button></td>
      </tr>`).join('') + '</tbody></table>';
  },

  // ---- Saisie manuelle -----------------------------------------------------
  ajouterManuel() {
    const dateEl = document.getElementById('tpDate_jour');
    const date = (dateEl && dateEl.value) || CC.util.toISO(new Date());
    const client = (document.getElementById('tpMClient') || {}).value || '';
    const brut = (document.getElementById('tpDuree') || {}).value || '';
    const note = (document.getElementById('tpMNote') || {}).value || '';
    const minutes = parseDuree(brut);
    if (!minutes) {
      CC.toast('Durée non comprise. Écris par exemple 1h30, 1,5h, 90 ou 1:30.', 'err');
      const el = document.getElementById('tpDuree'); if (el) el.focus();
      return;
    }
    this.ajouter({ date, client, minutes, note });
    document.getElementById('tpDuree').value = '';
    document.getElementById('tpMNote').value = '';
    this._paint();
    CC.toast('Séance ajoutée : ' + duree(minutes) + '.', 'ok');
  },

  bind() {
    if (this._bound || !CC.estBureau()) return;
    this._bound = true;
    const add = document.getElementById('tpAdd');
    if (add) add.addEventListener('click', () => CC.temps.ajouterManuel());
    const dureeEl = document.getElementById('tpDuree');
    if (dureeEl) dureeEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') CC.temps.ajouterManuel(); });
    const journal = document.getElementById('tpJournal');
    if (journal) journal.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tp-del]');
      if (b) CC.temps.supprimer(b.dataset.tpDel);
    });
    if (CC.dp) {
      CC.dp.init(document.getElementById('sub-temps'));
      // Aujourd'hui par défaut : dans neuf cas sur dix, la séance qu'on saisit
      // à la main est celle qu'on vient de finir.
      const wrap = document.getElementById('tpDateWrap');
      if (wrap) CC.dp.set(wrap, CC.util.toISO(new Date()));
    }
  }
};

// --- Aides ------------------------------------------------------------------

// « 1h30 », « 1,5h », « 1:30 », « 90 », « 2 h » -> minutes. 0 si incompréhensible.
function parseDuree(txt) {
  const s = String(txt || '').trim().toLowerCase().replace(',', '.');
  if (!s) return 0;
  let m = s.match(/^(\d+)\s*[h:]\s*(\d{1,2})?$/);           // 1h30, 1:30, 2h
  if (m) return (+m[1]) * 60 + (m[2] ? +m[2] : 0);
  m = s.match(/^(\d+(?:\.\d+)?)\s*h$/);                      // 1.5h
  if (m) return Math.round(parseFloat(m[1]) * 60);
  m = s.match(/^(\d+)\s*(?:min|m)$/);                        // 90min
  if (m) return +m[1];
  m = s.match(/^(\d+(?:\.\d+)?)$/);                          // 90 (minutes) / 1.5 -> heures
  if (m) {
    const v = parseFloat(m[1]);
    return v < 13 && String(m[1]).includes('.') ? Math.round(v * 60) : Math.round(v);
  }
  return 0;
}

function duree(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  const h = Math.floor(m / 60), r = m % 60;
  if (!h) return r + ' min';
  return h + ' h' + (r ? String(r).padStart(2, '0') : '');
}
function court(nom) { return String(nom || '').length > 22 ? String(nom).slice(0, 21) + '…' : String(nom || ''); }

// Coût RÉEL d'un trajet : en micro-BNC, l'abattement forfaitaire remplace les
// frais — le barème kilométrique ne se déduit de rien. Ce qui sort du compte
// en banque, c'est le carburant et les péages.
function coutReel(t) {
  const reel = (+t.carburant || 0) + (+t.peage || 0);
  return reel > 0 ? reel : (+t.indemnite || 0);
}

// Rattache un trajet à un client : son motif (ou l'adresse d'arrivée) contient
// le nom du client. On exige 4 caractères pour éviter les rapprochements
// hasardeux sur un sigle trop court.
function clientDuTrajet(t, clients) {
  const hay = normalise((t.motif || '') + ' ' + (t.to || ''));
  if (!hay.trim()) return null;
  let meilleur = null;
  clients.forEach((c) => {
    if (!c || c.length < 4) return;
    const n = normalise(c);
    if (hay.includes(n) && (!meilleur || n.length > normalise(meilleur).length)) meilleur = c;
  });
  return meilleur;
}
function normalise(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ');
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
