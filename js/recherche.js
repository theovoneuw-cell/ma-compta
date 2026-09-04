'use strict';
window.CC = window.CC || {};

// ---------------------------------------------------------------------------
// Recherche globale — Ctrl+K (PC / Mac uniquement)
//
// Huit onglets, et l'information cherchée est toujours dans un autre. Cette
// palette cherche partout d'un seul champ : factures, clients, structures du
// Réseau, documents du coffre, séances de travail, pense-bête, réglages — plus
// les mails et l'agenda, qui eux demandent le réseau et arrivent donc après.
//
// Deux temps assumés :
//   · ce qui est DANS le document répond instantanément, hors connexion ;
//   · Gmail et Google Agenda sont interrogés 350 ms après la dernière frappe,
//     et leurs résultats se glissent dans la liste quand ils arrivent.
//
// Rien ici ne modifie quoi que ce soit : la palette ouvre, elle n'écrit jamais.
// ---------------------------------------------------------------------------

const RQ_MIN_DISTANT = 3;      // en dessous, on n'appelle pas Google pour rien
const RQ_DELAI = 350;          // ms après la dernière frappe
const RQ_MAX_SECTION = 6;      // résultats affichés par section

const RQ_IC = {
  facture: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  client: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.2"/><path d="M5 20c.8-3.4 3.5-5 7-5s6.2 1.6 7 5"/></svg>',
  reseau: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="2.2"/><circle cx="5" cy="18" r="2.2"/><circle cx="19" cy="18" r="2.2"/><path d="M10.5 6.9 6.7 15.7M13.5 6.9l3.8 8.8M7.4 18h9.2"/></svg>',
  mail: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/></svg>',
  agenda: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3"/></svg>',
  doc: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.2"/><circle cx="13" cy="12" r="3"/><path d="M13 9v3M6.5 8v8"/></svg>',
  note: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v11l-5 5H5z"/><path d="M19 15h-5v5"/></svg>',
  temps: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  aller: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h15"/><path d="m13 6 6 6-6 6"/></svg>'
};

CC.recherche = {
  _ouvert: false,
  _sel: 0,
  _res: [],
  _distant: [],        // résultats Gmail / Agenda de la requête en cours
  _timer: null,
  _jeton: 0,           // numéro de la requête distante en vol (anti-réponse périmée)
  _bound: false,

  // ---- Ouverture / fermeture ----------------------------------------------
  ouvrir() {
    if (!CC.estBureau()) return;
    this._monter();
    const back = document.getElementById('palette');
    back.classList.remove('hidden');
    this._ouvert = true;
    const inp = document.getElementById('palInput');
    inp.value = '';
    this._distant = [];
    this._chercher('');
    setTimeout(() => inp.focus(), 20);
  },

  fermer() {
    const back = document.getElementById('palette');
    if (back) back.classList.add('hidden');
    this._ouvert = false;
    clearTimeout(this._timer);
    this._jeton++;                 // toute réponse en vol devient sans objet
  },

  basculer() { this._ouvert ? this.fermer() : this.ouvrir(); },

  _monter() {
    if (document.getElementById('palette')) return;
    const back = document.createElement('div');
    back.id = 'palette';
    back.className = 'pal-backdrop hidden';
    back.innerHTML = `
      <div class="pal" role="dialog" aria-modal="true" aria-label="Recherche globale">
        <div class="pal-head">
          <svg class="pal-loupe" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>
          <input id="palInput" type="text" autocomplete="off" spellcheck="false" placeholder="Chercher une facture, un client, une structure, un mail, un document…">
          <span class="pal-esc">Échap</span>
        </div>
        <div class="pal-list" id="palList"></div>
        <div class="pal-foot">
          <span><b>↑</b> <b>↓</b> naviguer</span><span><b>Entrée</b> ouvrir</span>
          <span class="spacer"></span><span id="palEtat"></span>
        </div>
      </div>`;
    document.body.appendChild(back);

    back.addEventListener('click', (e) => { if (e.target === back) CC.recherche.fermer(); });
    const inp = document.getElementById('palInput');
    inp.addEventListener('input', () => {
      CC.recherche._chercher(inp.value);
      CC.recherche._planifierDistant(inp.value);
    });
    document.getElementById('palList').addEventListener('click', (e) => {
      const it = e.target.closest('.pal-item');
      if (!it) return;
      CC.recherche._activer(parseInt(it.dataset.i, 10));
    });
    document.getElementById('palList').addEventListener('mousemove', (e) => {
      const it = e.target.closest('.pal-item');
      if (!it) return;
      const i = parseInt(it.dataset.i, 10);
      if (i !== CC.recherche._sel) { CC.recherche._sel = i; CC.recherche._marquer(); }
    });
  },

  // ---- Recherche locale ----------------------------------------------------
  _chercher(q) {
    const n = norm(q);
    const res = [];
    const mots = n.split(' ').filter(Boolean);
    const colle = (txt) => {
      const t = norm(txt);
      if (!mots.length) return 0;
      if (!mots.every((m) => t.includes(m))) return -1;
      return t.startsWith(mots[0]) ? 2 : 1;    // un début de mot vaut mieux qu'un fragment
    };

    // --- Aller à / actions. Sans requête, c'est le menu par défaut. ---
    this._actions().forEach((a) => {
      const s = mots.length ? colle(a.titre + ' ' + (a.mots || '')) : 1;
      if (s < 0) return;
      res.push({ sec: 'Aller à', ic: RQ_IC.aller, titre: a.titre, sous: a.sous || '', score: s + 0.4, run: a.run });
    });

    if (mots.length) {
      // --- Factures ---
      (CC.state.factures || []).forEach((f) => {
        const s = colle([f.libelle, f.numFacture, f.modePaiement, f.notes].join(' '));
        if (s < 0) return;
        const st = CC.stats.statut(f, CC.state.settings);
        const quand = f.dateEncaissement || f.dateEcheance || f.dateEnvoi || '';
        res.push({
          sec: 'Factures', ic: RQ_IC.facture, score: s + 1,
          titre: f.libelle || '(sans libellé)',
          sous: [CC.util.eur0(+f.montant || 0), f.numFacture ? 'n° ' + f.numFacture : '', quand ? CC.util.frDate(quand) : '', LIB_STATUT[st] || ''].filter(Boolean).join(' · '),
          run: () => { CC.switchTab('factures'); CC.facturesView.openModal(f); }
        });
      });

      // --- Clients (agrégés) ---
      const clients = new Map();
      (CC.state.factures || []).forEach((f) => {
        const k = CC.util.clientKey(f.libelle);
        if (!k || k === '(SANS NOM)') return;
        const c = clients.get(k) || { n: 0, ca: 0 };
        c.n++; if (CC.stats.isPaid(f)) c.ca += CC.stats.ht(f);
        clients.set(k, c);
      });
      clients.forEach((c, k) => {
        const s = colle(k);
        if (s < 0) return;
        res.push({
          sec: 'Clients', ic: RQ_IC.client, score: s + 0.9,
          titre: k, sous: c.n + ' facture(s) · ' + CC.util.eur0(c.ca) + ' encaissés',
          run: () => { CC.switchTab('factures'); rechercheFactures(k); }
        });
      });

      // --- Réseau (base FINESS + ajouts) ---
      if (CC.prospection && CC.prospection.base && CC.prospection.base()) {
        CC.prospection.toutes().forEach((st) => {
          const s = colle(st.nom + ' ' + (st.ville || ''));
          if (s < 0) return;
          res.push({
            sec: 'Réseau', ic: RQ_IC.reseau, score: s + 0.7,
            titre: st.nom, sous: [st.catCourt, st.ville].filter(Boolean).join(' · '),
            run: () => { CC.switchTab('reseau'); setTimeout(() => CC.prospection.openFiche(st.id), 60); }
          });
        });
      }

      // --- Coffre à documents ---
      (CC.state.documents || []).forEach((d) => {
        const s = colle(d.titre + ' ' + d.nom + ' ' + (d.notes || ''));
        if (s < 0) return;
        res.push({
          sec: 'Coffre', ic: RQ_IC.doc, score: s + 0.8,
          titre: d.titre || d.nom, sous: CC.coffre ? CC.coffre.etat(d).txt : '',
          run: () => { CC.switchTab('coffre'); if (CC.coffre) CC.coffre._ouvrir(d.id); }
        });
      });

      // --- Séances de travail ---
      (CC.state.temps || []).forEach((t) => {
        const s = colle((t.client || '') + ' ' + (t.note || ''));
        if (s < 0) return;
        res.push({
          sec: 'Temps', ic: RQ_IC.temps, score: s + 0.5,
          titre: (t.client || 'Sans client') + (t.note ? ' — ' + t.note : ''),
          sous: CC.util.frDate(t.date),
          run: () => CC.switchTab('temps')
        });
      });

      // --- Pense-bête ---
      (CC.state.notes || []).forEach((nt) => {
        const s = colle(nt.text || '');
        if (s < 0) return;
        res.push({
          sec: 'Pense-bête', ic: RQ_IC.note, score: s + 0.5,
          titre: nt.text, sous: 'Accueil', run: () => CC.switchTab('today')
        });
      });
    }

    // Les résultats distants déjà revenus pour CETTE requête restent affichés.
    this._res = res.concat(this._distant).sort((a, b) => b.score - a.score);
    this._sel = 0;
    this._peindre(q);
  },

  // Les entrées « Aller à » : les onglets, et les gestes qu'on cherche par leur
  // nom plutôt que par leur emplacement.
  _actions() {
    const a = [
      { titre: 'Accueil', mots: 'cockpit aujourd hui', run: () => CC.switchTab('today') },
      { titre: 'Tableau de bord', mots: 'compta kpi', run: () => CC.switchTab('dashboard') },
      { titre: 'Factures', mots: 'compta liste', run: () => CC.switchTab('factures') },
      { titre: 'Fiscal', mots: 'urssaf tva impot retraite trimestres', run: () => CC.switchTab('fiscal') },
      { titre: 'Bilan', mots: 'annuel synthese', run: () => CC.switchTab('bilan') },
      { titre: 'Coffre à documents', mots: 'attestation assurance rib kbis vigilance', run: () => CC.switchTab('coffre') },
      { titre: 'Feuille de temps', mots: 'heures chrono rentabilite taux horaire', run: () => CC.switchTab('temps') },
      { titre: 'Agenda', mots: 'calendrier rendez-vous', run: () => CC.switchTab('agenda') },
      { titre: 'Trajets', mots: 'kilometres frais route peage', run: () => CC.switchTab('trajets') },
      { titre: 'Réseau', mots: 'demarchage prospection structures', run: () => CC.switchTab('reseau') },
      { titre: 'Mails', mots: 'messagerie gmail', run: () => CC.switchTab('mails') },
      { titre: 'IA', mots: 'gemini assistant redaction', run: () => CC.switchTab('redaction') },
      { titre: 'Paramètres', mots: 'reglages taux connexions', run: () => CC.switchTab('settings') },
      { titre: 'Nouvelle facture', sous: 'Créer une facture', mots: 'ajouter saisir', run: () => { CC.switchTab('factures'); CC.facturesView.openModal(null); } },
      { titre: 'Enregistrer le document', sous: 'Ctrl+S', mots: 'sauvegarder', run: () => CC.storage.save(false) },
      { titre: 'Ajouter un document au coffre', mots: 'piece attestation', run: () => { CC.switchTab('coffre'); if (CC.coffre) CC.coffre.ajouter(); } },
      { titre: 'Exporter les factures en CSV', mots: 'export tableur excel', run: () => CC.storage.exportCsv() },
      { titre: 'Exporter le bilan en PDF', mots: 'export impression', run: () => CC.storage.exportPdf() },
      { titre: 'Ouvrir le dossier des sauvegardes', mots: 'historique instantanes', run: async () => { const r = await window.api.openHistory(); if (r && r.error) CC.toast(r.error, 'err'); } }
    ];
    return a;
  },

  // ---- Recherche distante (Gmail + Agenda) ---------------------------------
  _planifierDistant(q) {
    clearTimeout(this._timer);
    this._distant = [];
    const n = (q || '').trim();
    if (n.length < RQ_MIN_DISTANT) { this._etat(''); return; }
    this._etat('Recherche dans les mails et l\'agenda…');
    this._timer = setTimeout(() => CC.recherche._distantMaintenant(n), RQ_DELAI);
  },

  async _distantMaintenant(q) {
    const jeton = ++this._jeton;
    const trouves = [];

    // Mails : la recherche Gmail elle-même, pas un filtrage local.
    try {
      const r = await window.api.gmail.list({ dossier: 'principal', maxResults: 8, recherche: q });
      if (r && !r.error) (r.messages || []).forEach((m) => {
        trouves.push({
          sec: 'Mails', ic: RQ_IC.mail, score: 0.95,
          titre: m.sujet || '(sans objet)',
          sous: [persoDe(m.de), m.date ? new Date(m.dateMs || m.date).toLocaleDateString('fr-FR') : ''].filter(Boolean).join(' · '),
          run: () => { CC.switchTab('mails'); setTimeout(() => { if (CC.mailbox) CC.mailbox._open(m.id); }, 120); }
        });
      });
    } catch (_) { /* pas de réseau : la partie locale suffit */ }

    // Agenda : un an en arrière, un an devant. Au-delà, ce n'est plus une
    // recherche, c'est de l'archéologie.
    try {
      const now = new Date();
      const min = new Date(now.getFullYear() - 1, now.getMonth(), 1);
      const max = new Date(now.getFullYear() + 1, now.getMonth(), 1);
      const r = await window.api.gcal.events({ timeMin: min.toISOString(), timeMax: max.toISOString(), maxResults: 8, q });
      if (r && !r.error) (r.events || []).forEach((e) => {
        trouves.push({
          sec: 'Agenda', ic: RQ_IC.agenda, score: 0.93,
          titre: e.titre || '(sans titre)',
          sous: [dateEv(e), e.lieu].filter(Boolean).join(' · '),
          run: () => { CC.switchTab('agenda'); if (CC.agenda) { const d = new Date(e.debut); if (!isNaN(d)) { CC.agenda.cur = new Date(d.getFullYear(), d.getMonth(), 1); CC.agenda.render(); } } }
        });
      });
    } catch (_) {}

    // Une réponse qui arrive après une nouvelle frappe ne doit rien afficher.
    if (jeton !== this._jeton || !this._ouvert) return;
    this._distant = trouves;
    this._etat(trouves.length ? '' : 'Rien dans les mails ni l\'agenda');
    const inp = document.getElementById('palInput');
    this._chercher(inp ? inp.value : q);
  },

  _etat(txt) {
    const el = document.getElementById('palEtat');
    if (el) el.textContent = txt || '';
  },

  // ---- Affichage -----------------------------------------------------------
  _peindre(q) {
    const list = document.getElementById('palList');
    if (!list) return;
    if (!this._res.length) {
      list.innerHTML = `<div class="pal-vide">Rien pour « ${escR(q)} ».</div>`;
      return;
    }
    // Regroupé par section, dans l'ordre où les sections apparaissent.
    const sections = [];
    const parSec = new Map();
    this._res.forEach((r) => {
      if (!parSec.has(r.sec)) { parSec.set(r.sec, []); sections.push(r.sec); }
      parSec.get(r.sec).push(r);
    });

    let i = 0;
    const ordre = [];
    let html = '';
    sections.forEach((sec) => {
      const items = parSec.get(sec);
      html += `<div class="pal-sec">${escR(sec)}${items.length > RQ_MAX_SECTION ? ` <span>${items.length}</span>` : ''}</div>`;
      items.slice(0, RQ_MAX_SECTION).forEach((r) => {
        ordre.push(r);
        html += `<div class="pal-item" data-i="${i}">
          <span class="pal-ic">${r.ic}</span>
          <span class="pal-txt"><span class="pal-t">${escR(r.titre)}</span>${r.sous ? `<span class="pal-s">${escR(r.sous)}</span>` : ''}</span>
        </div>`;
        i++;
      });
    });
    this._res = ordre;               // l'index affiché fait foi pour le clavier
    list.innerHTML = html;
    this._marquer();
  },

  _marquer() {
    const list = document.getElementById('palList');
    if (!list) return;
    list.querySelectorAll('.pal-item').forEach((el, i) => el.classList.toggle('sel', i === this._sel));
    const actif = list.querySelector('.pal-item.sel');
    if (actif) actif.scrollIntoView({ block: 'nearest' });
  },

  _activer(i) {
    const r = this._res[i];
    if (!r) return;
    this.fermer();
    try { r.run(); } catch (e) { CC.toast('Action impossible : ' + (e.message || e), 'err'); }
  },

  // ---- Clavier -------------------------------------------------------------
  bind() {
    if (this._bound || !CC.estBureau()) return;
    this._bound = true;
    document.addEventListener('keydown', (e) => {
      // Ouverture : Ctrl+K (Cmd+K sur Mac). On la capture avant tout le reste.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        CC.recherche.basculer();
        return;
      }
      if (!CC.recherche._ouvert) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); CC.recherche.fermer(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); CC.recherche._sel = Math.min(CC.recherche._res.length - 1, CC.recherche._sel + 1); CC.recherche._marquer(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); CC.recherche._sel = Math.max(0, CC.recherche._sel - 1); CC.recherche._marquer(); return; }
      if (e.key === 'Enter') { e.preventDefault(); CC.recherche._activer(CC.recherche._sel); }
    }, true);

    const btn = document.getElementById('btnRecherche');
    if (btn) btn.addEventListener('click', () => CC.recherche.ouvrir());
  }
};

// --- Aides ------------------------------------------------------------------
const LIB_STATUT = { recue: 'reçue', attente: 'en attente', retard: 'en retard', prevu: 'prévisionnel' };

function norm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
// Filtrer la liste des factures sur un client : on écrit dans le champ de
// recherche et on déclenche l'événement, exactement comme une frappe — la vue
// Factures reste seule maîtresse de son filtrage.
function rechercheFactures(q) {
  const inp = document.getElementById('searchInput');
  if (!inp) return;
  inp.value = q;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
}
function persoDe(de) {
  const s = String(de || '');
  const m = s.match(/^\s*"?([^"<]+?)"?\s*</);
  return (m ? m[1] : s.replace(/[<>]/g, '')).trim();
}
function dateEv(e) {
  const d = new Date(e.debut);
  if (isNaN(d.getTime())) return '';
  const jour = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
  return e.journee ? jour : jour + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function escR(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
