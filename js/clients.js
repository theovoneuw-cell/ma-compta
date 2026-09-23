'use strict';
window.CC = window.CC || {};

// ---------------------------------------------------------------------------
// Fiches clients
//
// Un client n'etait qu'un nom tape dans le libelle de la facture. La fiche lui
// donne une identite (adresse, SIRET, contact), des habitudes de facturation
// (activite, delai de paiement, Chorus Pro) et une liste de ses autres noms.
//
// Le lien facture -> fiche se fait PAR LE NOM, jamais par un identifiant : la
// partie client du libelle (avant « — », « , » ou « / ») est comparee au nom de
// la fiche et a ses autres noms, sans casse ni accents. Aucune facture ne porte
// de champ supplementaire, ce qui compte parce que les versions plus anciennes
// de l'app (iPhone, PC) reecrivent les factures champ par champ et effaceraient
// un champ inconnu.
//
// Pour la meme raison, les fiches vivent dans `settings.clients` et non a la
// racine du fichier : une ancienne version recopie les reglages tels quels
// (Object.assign) mais ne reecrit que les rubriques racines qu'elle connait. Un
// enregistrement depuis le telephone ne peut donc pas effacer les fiches.
// ---------------------------------------------------------------------------

const CL_TYPES = [
  { id: 'public', lib: 'Organisme public', aide: 'Mairie, SIVOM, établissement public : dépôt sur Chorus Pro.' },
  { id: 'pro', lib: 'Structure privée', aide: 'Association, fondation, entreprise : SIRET du client sur la facture.' },
  { id: 'particulier', lib: 'Particulier', aide: 'Nom et adresse suffisent, pas de SIRET.' }
];

// Ce qui suit un tiret long (« Studio M — Cours ») est la nature de la vente,
// pas le client. Le tiret court entoure d'espaces n'est PAS une coupure ici :
// il fait partie de noms comme « FdV - AMAPEI ». (CC.util.clientKey coupe plus
// large pour regrouper ; ce decoupage-ci sert a AFFICHER et a RENOMMER.)
const CL_SEP = /\s*(?:—|–)/;

function clNorm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function clEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function clVal(id) { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; }
function clSet(id, v) { const el = document.getElementById(id); if (el) el.value = v == null ? '' : v; }

// Partie client d'un libelle, telle qu'ecrite (« Studio M — Cours » -> « Studio M »).
function clPartie(libelle) { return String(libelle || '').split(CL_SEP)[0].replace(/\s+/g, ' ').trim(); }
// Ce qui suit le nom du client dans un libelle (« — Cours »), a conserver quand
// on renomme. Un nom qui contient lui-meme un separateur (« FdV - AMAPEI ») est
// reconnu en entier avant de chercher la coupure.
function clSuite(libelle, nom) {
  const l = String(libelle || '');
  if (clNorm(l).startsWith(clNorm(nom))) return l.slice(nom.length);
  const m = l.match(CL_SEP);
  return m ? l.slice(m.index) : '';
}

// L'annuaire ecrit tout en majuscules (« 21 RUE DES LILAS », « NICE ») : on
// remet une casse d'adresse normale (« 21 rue des Lilas », « Nice »).
const CL_VOIES = { AV: 'avenue', AVE: 'avenue', AVENUE: 'avenue', BD: 'boulevard', BOULEVARD: 'boulevard', CHE: 'chemin', CHEM: 'chemin', CHEMIN: 'chemin',
  ALL: 'allée', ALLEE: 'allée', IMP: 'impasse', IMPASSE: 'impasse', PL: 'place', PLACE: 'place', RTE: 'route', ROUTE: 'route', RUE: 'rue',
  QUA: 'quai', QUAI: 'quai', CRS: 'cours', COURS: 'cours', SQ: 'square', PROM: 'promenade', MTE: 'montée', MONTEE: 'montée', TRA: 'traverse', TRAVERSE: 'traverse', LOT: 'lotissement', RES: 'résidence', HAM: 'hameau', PARC: 'parc', ESP: 'esplanade', VC: 'voie communale' };
const CL_PETITS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'sur', 'sous', 'aux', 'au', 'en', 'l', 'd']);
function clCasse(s, voie) {
  let n = 0;
  return String(s || '').toLowerCase().replace(/[a-zà-ÿ]+/g, (w) => {
    if (voie && /^(bis|ter)$/.test(w)) return w;       // « 21 bis rue… »
    const i = n++;
    if (voie && i === 0 && CL_VOIES[w.toUpperCase()]) return CL_VOIES[w.toUpperCase()];
    if (i > 0 && CL_PETITS.has(w)) return w;
    return w.charAt(0).toUpperCase() + w.slice(1);
  });
}
// Voie seule, depuis l'adresse complete de l'annuaire : on retire code postal et
// ville, et ce qui precede le numero (« ANG IME DES CHENES 21 RUE… » = enseigne).
function clVoie(adresse, cp) {
  let a = String(adresse || '');
  if (cp && a.includes(cp)) a = a.slice(0, a.indexOf(cp));
  a = a.trim();
  const m = a.match(/(?:^|\s)(\d+\s*(?:BIS|TER|B|T)?\s+\D.*)$/i);
  return m ? m[1].trim() : a;
}

CC.clients = {
  _rev: 0,
  _cache: null,
  _editId: '',
  _bound: false,
  _filtre: 'all',
  _q: '',

  // ------------------------------------------------------------------ données
  fiches() {
    const s = CC.state.settings;
    if (!Array.isArray(s.clients)) s.clients = [];
    return s.clients;
  },

  // Index nom normalise -> fiche (nom + autres noms). Reconstruit quand le
  // tableau change (chargement d'un fichier) ou apres une modification.
  _index() {
    const arr = CC.clients.fiches();
    const c = CC.clients._cache;
    if (c && c.ref === arr && c.rev === CC.clients._rev) return c.map;
    const map = new Map();
    arr.forEach((f) => {
      [f.nom].concat(f.alias || []).forEach((n) => {
        const k = CC.util.clientKeyBrut(n);
        if (k && !map.has(k)) map.set(k, f);
      });
    });
    CC.clients._cache = { ref: arr, rev: CC.clients._rev, map };
    return map;
  },
  _touche() { CC.clients._rev++; },

  // Fiche d'un libelle de facture (ou d'un nom), ou null.
  ficheDe(libelle) {
    if (!libelle) return null;
    return CC.clients._index().get(CC.util.clientKeyBrut(libelle)) || null;
  },
  byId(id) { return CC.clients.fiches().find((f) => f.id === id) || null; },

  // Delai de paiement applicable a une facture : celui du client, sinon le reglage general.
  delaiDe(f, settings) {
    const fi = f && CC.clients.ficheDe(f.libelle);
    const d = fi && +fi.delai;
    if (d > 0) return d;
    return (settings && +settings.delaiPaiement) || 30;
  },

  // Ce qui manque a une fiche pour facturer proprement.
  manques(fi) {
    const m = [];
    if (!fi) return m;
    if (!fi.adresse || !fi.cp || !fi.ville) m.push('adresse');
    if (fi.type !== 'particulier') {
      if (!fi.siret) m.push('SIRET');
      else if (!CC.clients.siretValide(fi.siret)) m.push('SIRET invalide');
    }
    return m;
  },

  // SIRET : 14 chiffres + cle de Luhn (La Poste fait exception : somme des chiffres multiple de 5).
  siretValide(s) {
    const d = String(s || '').replace(/\s/g, '');
    if (!/^\d{14}$/.test(d)) return false;
    if (d.startsWith('356000000')) return d.split('').reduce((a, c) => a + +c, 0) % 5 === 0;
    let sum = 0;
    for (let i = 0; i < 14; i++) {
      let n = +d[13 - i];
      if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
      sum += n;
    }
    return sum % 10 === 0;
  },

  // Tous les clients : les fiches, plus les noms de factures qui n'en ont pas
  // encore. Chaque entree porte ses chiffres (toutes annees + annee choisie).
  liste() {
    const S = CC.state;
    const annee = S.selectedYear === 'all' ? new Date().getFullYear() : S.selectedYear;
    const today = new Date();
    const groupes = new Map();
    const entree = (cle) => {
      let g = groupes.get(cle);
      if (!g) {
        g = { cle, fiche: null, noms: new Map(), cats: new Map(), n: 0, total: 0, annee: 0, paye: 0, attente: 0, retard: 0, prevu: 0, derniere: '', delais: [] };
        groupes.set(cle, g);
      }
      return g;
    };
    CC.clients.fiches().forEach((fi) => { entree(CC.util.clientKeyBrut(fi.nom)).fiche = fi; });
    S.factures.forEach((f) => {
      const fi = CC.clients.ficheDe(f.libelle);
      const g = entree(fi ? CC.util.clientKeyBrut(fi.nom) : CC.util.clientKey(f.libelle));
      const nom = clPartie(f.libelle);
      if (nom) g.noms.set(nom, (g.noms.get(nom) || 0) + 1);
      if (f.categorie) g.cats.set(f.categorie, (g.cats.get(f.categorie) || 0) + 1);
      const ht = CC.stats.ht(f);
      const st = CC.stats.statut(f, S.settings, today);
      g.n++; g.total += ht;
      if (CC.stats.yearOf(f) === annee) g.annee += ht;
      if (st === 'recue') g.paye += ht;
      else if (st === 'retard') g.retard += ht;
      else if (st === 'prevu') g.prevu += ht;
      else g.attente += ht;
      const d = f.dateEncaissement || f.dateEnvoi || '';
      if (d > g.derniere) g.derniere = d;
      if (f.dateEnvoi && f.dateEncaissement) {
        const j = CC.util.daysBetween(CC.util.parseDate(f.dateEnvoi), CC.util.parseDate(f.dateEncaissement));
        if (j >= 0) g.delais.push(j);
      }
    });
    const top = (m) => Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0];
    return Array.from(groupes.values()).map((g) => ({
      ...g,
      nom: g.fiche ? g.fiche.nom : (g.noms.size ? top(g.noms)[0] : g.cle),
      categorie: (g.fiche && g.fiche.categorie) || (g.cats.size ? top(g.cats)[0] : ''),
      delaiMoyen: g.delais.length ? Math.round(g.delais.reduce((a, b) => a + b, 0) / g.delais.length) : null,
      manques: g.fiche ? CC.clients.manques(g.fiche) : null,
      anneeRef: annee
    })).sort((a, b) => b.total - a.total || a.nom.localeCompare(b.nom, 'fr'));
  },

  // Suggestions pour le champ client de la facture.
  suggestions() {
    return CC.clients.liste().map((c) => ({
      nom: c.nom, key: clNorm(c.nom), n: c.n, categorie: c.categorie, fiche: c.fiche,
      alias: c.fiche ? (c.fiche.alias || []).map(clNorm) : []
    })).sort((a, b) => b.n - a.n || a.nom.localeCompare(b.nom, 'fr'));
  },

  // Factures d'un client (par fiche ou par cle de nom).
  facturesDe(cle) {
    return CC.state.factures.filter((f) => {
      const fi = CC.clients.ficheDe(f.libelle);
      return (fi ? CC.util.clientKeyBrut(fi.nom) : CC.util.clientKey(f.libelle)) === cle;
    });
  },

  // ------------------------------------------------------------------ liste
  render() {
    CC.clients.bind();
    const body = document.getElementById('clientsBody');
    if (!body) return;
    const S = CC.state;
    let list = CC.clients.liste();
    const annee = list.length ? list[0].anneeRef : new Date().getFullYear();
    const nbFiches = list.filter((c) => c.fiche).length;
    const aCompleter = list.filter((c) => c.fiche && c.manques.length).length;
    const sansFiche = list.filter((c) => !c.fiche).length;

    if (CC.clients._filtre === 'sans') list = list.filter((c) => !c.fiche);
    else if (CC.clients._filtre === 'incomplet') list = list.filter((c) => c.fiche && c.manques.length);
    else if (CC.clients._filtre === 'chorus') list = list.filter((c) => c.fiche && c.fiche.chorus);
    else if (CC.clients._filtre === 'impaye') list = list.filter((c) => c.attente + c.retard > 0);
    const q = clNorm(CC.clients._q);
    if (q) {
      list = list.filter((c) => clNorm(c.nom).includes(q)
        || (c.fiche && [c.fiche.ville, c.fiche.siret, c.fiche.contact, c.fiche.email].concat(c.fiche.alias || []).some((x) => clNorm(x).includes(q))));
    }

    document.getElementById('clientsAnneeTh').textContent = 'CA ' + annee;
    document.getElementById('clientsSummary').textContent =
      `${nbFiches} fiche(s) · ${sansFiche} client(s) sans fiche${aCompleter ? ' · ' + aCompleter + ' à compléter' : ''}`;

    body.innerHTML = list.map((c) => {
      const badges = [];
      if (!c.fiche) badges.push('<span class="cl-tag muted">sans fiche</span>');
      else if (c.manques.length) badges.push(`<span class="cl-tag warn" title="À compléter : ${clEsc(c.manques.join(', '))}">à compléter</span>`);
      if (c.fiche && c.fiche.chorus) badges.push('<span class="cl-tag chorus">Chorus</span>');
      const ville = c.fiche && c.fiche.ville ? `<span class="cl-sub">${clEsc(c.fiche.ville)}</span>` : '';
      const du = c.attente + c.retard;
      const duTxt = du > 0
        ? `<span class="${c.retard > 0 ? 'cl-retard' : 'cl-attente'}">${CC.util.eur0(du)}</span>`
        : '<span class="muted">—</span>';
      const action = c.fiche
        ? `<button class="mini-btn" data-cl-act="ouvrir" data-cl-id="${c.fiche.id}">Fiche</button>`
        : `<button class="mini-btn go-green" data-cl-act="creer" data-cl-cle="${clEsc(c.cle)}">Créer la fiche</button>`;
      return `<tr class="clrow" data-cl-row="${c.fiche ? 'id:' + c.fiche.id : 'cle:' + clEsc(c.cle)}">
        <td class="client" data-label="Client"><div class="cl-nom">${clEsc(c.nom)} ${badges.join(' ')}</div>${ville}</td>
        <td class="fmeta" data-label="Activité">${clEsc(c.categorie) || '<span class="muted">—</span>'}</td>
        <td class="num" data-label="Factures">${c.n}</td>
        <td class="num montant" data-label="CA total">${CC.util.eur0(c.total)}</td>
        <td class="num" data-label="CA ${annee}">${c.annee ? CC.util.eur0(c.annee) : '<span class="muted">—</span>'}</td>
        <td class="num" data-label="À encaisser">${duTxt}</td>
        <td class="num" data-label="Délai réel" title="Délai moyen entre l'envoi et le paiement (factures datées des deux)">${c.delaiMoyen != null ? c.delaiMoyen + ' j' : '<span class="muted">—</span>'}</td>
        <td class="fmeta" data-label="Dernière">${c.derniere ? CC.util.frDate(c.derniere) : '<span class="muted">—</span>'}</td>
        <td class="col-actions">${action}</td>
      </tr>`;
    }).join('');
    document.getElementById('clientsEmpty').classList.toggle('hidden', list.length > 0);
  },

  bind() {
    if (CC.clients._bound) return;
    const body = document.getElementById('clientsBody');
    if (!body) return;
    CC.clients._bound = true;

    document.getElementById('btnNewClient').addEventListener('click', () => CC.clients.ouvrir(null));
    document.getElementById('btnIndyClients').addEventListener('click', () => CC.clientsIndy.ouvrir());
    document.getElementById('clientsSearch').addEventListener('input', (e) => { CC.clients._q = e.target.value; CC.clients.render(); });
    document.getElementById('clientsFiltre').addEventListener('change', (e) => { CC.clients._filtre = e.target.value; CC.clients.render(); });
    body.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-cl-act]');
      const row = e.target.closest('tr[data-cl-row]');
      if (btn && btn.dataset.clAct === 'creer') { CC.clients.creerDepuis(btn.dataset.clCle); return; }
      if (btn && btn.dataset.clAct === 'ouvrir') { CC.clients.ouvrir(CC.clients.byId(btn.dataset.clId)); return; }
      if (!row) return;
      const r = row.dataset.clRow;
      if (r.startsWith('id:')) CC.clients.ouvrir(CC.clients.byId(r.slice(3)));
      else CC.clients.creerDepuis(r.slice(4));
    });

    // Modale
    const m = document.getElementById('modalClient');
    document.getElementById('c_categorie').innerHTML = '<option value="">— selon la facture —</option>' +
      CC.CATEGORIES.map((c) => `<option>${clEsc(c)}</option>`).join('');
    document.getElementById('c_type').innerHTML = CL_TYPES.map((t) => `<option value="${t.id}">${t.lib}</option>`).join('');
    document.getElementById('c_type').addEventListener('change', () => CC.clients._syncType());
    document.getElementById('c_chorus').addEventListener('change', () => CC.clients._syncType());
    document.getElementById('c_siret').addEventListener('input', () => CC.clients._syncSiret());
    ['c_adresse', 'c_cp', 'c_ville', 'c_siret'].forEach((id) => document.getElementById(id).addEventListener('input', () => CC.clients._syncManques()));
    document.getElementById('c_annuaire').addEventListener('click', () => CC.clients.chercherAnnuaire());
    document.getElementById('c_annuaireRes').addEventListener('click', (e) => {
      const it = e.target.closest('[data-an]'); if (!it) return;
      CC.clients._appliquerAnnuaire(CC.clients._resultats[+it.dataset.an]);
    });
    document.getElementById('formClient').addEventListener('submit', (e) => { e.preventDefault(); CC.clients.enregistrer(); });
    document.getElementById('btnCancelClient').addEventListener('click', () => CC.clients.fermer());
    document.getElementById('btnCloseClient').addEventListener('click', () => CC.clients.fermer());
    document.getElementById('btnDeleteClient').addEventListener('click', () => CC.clients.supprimer());
    document.getElementById('c_histo').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-fid]'); if (!tr) return;
      const f = CC.state.factures.find((x) => x.id === tr.dataset.fid);
      if (!f) return;
      CC.clients.fermer();
      CC.facturesView.openModal(f);
    });
    m.addEventListener('click', (e) => { if (CC.clicFond(e, m)) CC.clients.fermer(); });
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); CC.clients.fermer(); } });
  },

  // ------------------------------------------------------------------ fiche
  // Nouvelle fiche pre-remplie depuis un client qui n'existe que dans les factures.
  creerDepuis(cle) {
    const c = CC.clients.liste().find((x) => x.cle === cle);
    if (!c) return;
    // Les autres ecritures du meme client deviennent ses autres noms.
    const alias = Array.from(c.noms.keys()).filter((n) => clNorm(n) !== clNorm(c.nom));
    CC.clients.ouvrir(null, { nom: c.nom, categorie: c.categorie, alias });
    // Noms sous lesquels ce client existe deja dans les factures : si le nom est
    // change avant d'enregistrer, ses factures doivent rester rattachees.
    CC.clients._origine = [c.nom].concat(alias);
  },

  ouvrir(fiche, preset) {
    CC.clients.bind();
    const f = fiche || Object.assign({ type: 'pro' }, preset || {});
    CC.clients._editId = fiche ? fiche.id : '';
    CC.clients._origine = [];
    CC.clients._resultats = [];
    document.getElementById('clientModalTitle').textContent = fiche ? fiche.nom : 'Nouveau client';
    clSet('c_nom', f.nom);
    clSet('c_alias', (f.alias || []).join(', '));
    clSet('c_type', f.type || 'pro');
    clSet('c_adresse', f.adresse);
    clSet('c_cp', f.cp);
    clSet('c_ville', f.ville);
    clSet('c_siret', f.siret);
    clSet('c_contact', f.contact);
    clSet('c_email', f.email);
    clSet('c_tel', f.tel);
    clSet('c_categorie', f.categorie || '');
    clSet('c_delai', f.delai || '');
    document.getElementById('c_delai').placeholder = String(CC.state.settings.delaiPaiement || 30);
    document.getElementById('c_chorus').checked = !!f.chorus;
    clSet('c_chorusService', f.chorusService);
    clSet('c_notes', f.notes);
    document.getElementById('c_annuaireRes').innerHTML = '';
    document.getElementById('btnDeleteClient').classList.toggle('hidden', !fiche);
    CC.clients._syncType();
    CC.clients._syncSiret();
    CC.clients._syncManques();
    CC.clients._renderHisto(f.nom ? CC.util.clientKeyBrut(f.nom) : '');
    document.getElementById('modalClient').classList.remove('hidden');
    setTimeout(() => document.getElementById('c_nom').focus(), 30);
  },

  fermer() { document.getElementById('modalClient').classList.add('hidden'); },

  _syncType() {
    const t = clVal('c_type');
    const def = CL_TYPES.find((x) => x.id === t) || CL_TYPES[1];
    document.getElementById('c_typeAide').textContent = def.aide;
    document.getElementById('c_siretField').classList.toggle('hidden', t === 'particulier');
    document.getElementById('c_annuaire').classList.toggle('hidden', t === 'particulier');
    const chorus = document.getElementById('c_chorus').checked;
    document.getElementById('c_chorusServiceField').classList.toggle('hidden', !chorus);
    document.getElementById('c_chorusAide').classList.toggle('hidden', !(t === 'public' && !chorus));
    CC.clients._syncManques();
  },

  _syncSiret() {
    const v = clVal('c_siret').replace(/\s/g, '');
    const h = document.getElementById('c_siretAide');
    if (!v) { h.textContent = '14 chiffres, sur les factures et devis du client.'; h.className = 'field-hint'; return; }
    if (!/^\d+$/.test(v)) { h.textContent = 'Uniquement des chiffres.'; h.className = 'field-hint warn'; return; }
    if (v.length !== 14) { h.textContent = `${v.length} chiffre(s) sur 14.`; h.className = 'field-hint warn'; return; }
    if (!CC.clients.siretValide(v)) { h.textContent = 'Ce SIRET n\'existe pas : un chiffre est probablement faux.'; h.className = 'field-hint warn'; return; }
    h.textContent = 'SIRET valide.'; h.className = 'field-hint ok';
  },

  _syncManques() {
    const box = document.getElementById('c_manques');
    const m = CC.clients.manques({ type: clVal('c_type'), adresse: clVal('c_adresse'), cp: clVal('c_cp'), ville: clVal('c_ville'), siret: clVal('c_siret').replace(/\s/g, '') });
    if (!clVal('c_nom') && !m.length) { box.classList.add('hidden'); return; }
    box.classList.toggle('hidden', !m.length);
    box.textContent = m.length ? 'À compléter pour facturer : ' + m.join(', ') + '.' : '';
  },

  _renderHisto(cle) {
    const box = document.getElementById('c_histo');
    const sous = document.getElementById('clientModalSous');
    if (!cle) { box.innerHTML = ''; sous.textContent = ''; return; }
    const S = CC.state;
    const fs = CC.clients.facturesDe(cle).slice().sort((a, b) => (b.dateEncaissement || b.dateEnvoi || '9').localeCompare(a.dateEncaissement || a.dateEnvoi || '9'));
    if (!fs.length) { box.innerHTML = ''; sous.textContent = 'Aucune facture à ce nom pour l\'instant.'; return; }
    const tot = fs.reduce((a, f) => a + CC.stats.ht(f), 0);
    sous.textContent = `${fs.length} facture(s) · ${CC.util.eur0(tot)} au total`;
    const labels = { recue: 'Reçue', attente: 'En attente', retard: 'En retard', prevu: 'Prévisionnel' };
    const lignes = fs.slice(0, 12).map((f) => {
      const st = CC.stats.statut(f, S.settings);
      const d = f.dateEncaissement || f.dateEnvoi;
      return `<tr data-fid="${f.id}" title="Ouvrir la facture">
        <td>${d ? CC.util.frDate(d) : '<span class="muted">—</span>'}</td>
        <td>${clEsc(f.numFacture) || '<span class="muted">—</span>'}</td>
        <td class="cl-lib">${clEsc(f.libelle)}</td>
        <td class="num">${CC.util.eur(+f.montant || 0)}</td>
        <td><span class="stpill ${st}">${labels[st]}</span></td>
      </tr>`;
    }).join('');
    const plus = fs.length > 12 ? `<p class="field-hint">… et ${fs.length - 12} plus ancienne(s), visibles dans Factures.</p>` : '';
    box.innerHTML = `<div class="cl-histo-t">Factures</div><table class="cl-histo">${lignes}</table>${plus}`;
  },

  // ------------------------------------------------------------------ annuaire
  // Annuaire public des entreprises (INSEE/SIRENE, via api.gouv.fr) : sans cle,
  // sans compte. On envoie seulement le nom tape (et la ville si elle est
  // remplie), jamais de donnees de compta.
  async chercherAnnuaire() {
    const nom = clVal('c_nom');
    const res = document.getElementById('c_annuaireRes');
    if (!nom) { res.innerHTML = '<p class="field-hint warn">Tape d\'abord le nom du client.</p>'; return; }
    const siret = clVal('c_siret').replace(/\s/g, '');
    const q = /^\d{9,14}$/.test(siret) ? siret : (nom + (clVal('c_ville') ? ' ' + clVal('c_ville') : ''));
    res.innerHTML = '<p class="field-hint">Recherche dans l\'annuaire des entreprises…</p>';
    let data;
    try {
      const r = await fetch('https://recherche-entreprises.api.gouv.fr/search?per_page=6&q=' + encodeURIComponent(q));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      data = await r.json();
    } catch (err) {
      res.innerHTML = '<p class="field-hint warn">Annuaire injoignable (connexion ?). Tu peux remplir la fiche à la main.</p>';
      return;
    }
    // Un IME, un Sessad, un espace jeunes sont des ETABLISSEMENTS d'une
    // association ou d'une mairie : on propose d'abord l'etablissement qui
    // correspond, puis le siege.
    const items = [];
    (data.results || []).forEach((e) => {
      (e.matching_etablissements || []).forEach((m) => {
        if (m.siret && m.siret !== (e.siege && e.siege.siret)) {
          items.push({ nom: (m.liste_enseignes && m.liste_enseignes[0]) || m.nom_commercial || e.nom_complet, org: e.nom_complet, siret: m.siret, adresse: m.adresse, voie: clVoie(m.adresse, m.code_postal), cp: m.code_postal, ville: m.libelle_commune, ferme: m.etat_administratif === 'F', public: /^[347]/.test(String(e.nature_juridique || '')) });
        }
      });
      if (e.siege) {
        const g = e.siege;
        const voie = g.libelle_voie ? [g.numero_voie, g.indice_repetition, g.type_voie, g.libelle_voie].filter(Boolean).join(' ') : clVoie(g.adresse, g.code_postal);
        items.push({ nom: e.nom_complet, org: 'Siège', siret: g.siret, adresse: g.adresse, voie, cp: g.code_postal, ville: g.libelle_commune, ferme: g.etat_administratif === 'F', public: /^[347]/.test(String(e.nature_juridique || '')) });
      }
    });
    // Classement : les mots du nom cherche, puis le departement de ton adresse
    // de depart (tes clients sont presque tous autour de chez toi), les
    // etablissements plutot que les sieges, et les fermes en dernier.
    const mots = clNorm(nom).split(' ').filter((w) => w.length >= 3);
    const cpDepart = (String(CC.state.settings.adresseDepart || '').match(/\b(\d{5})\b/) || [])[1] || '';
    const dep = cpDepart.slice(0, 2);
    items.forEach((it, i) => {
      const texte = clNorm(it.nom + ' ' + it.org + ' ' + it.adresse);
      it.score = mots.filter((w) => texte.includes(w)).length * 3
        + (dep && String(it.cp || '').startsWith(dep) ? 4 : 0)
        + (it.org !== 'Siège' ? 1 : 0)
        - (it.ferme ? 20 : 0);
      it.ordre = i;
    });
    items.sort((a, b) => b.score - a.score || a.ordre - b.ordre);
    CC.clients._resultats = items.slice(0, 8);
    if (!items.length) { res.innerHTML = '<p class="field-hint warn">Rien trouvé. Essaie un autre nom (celui de l\'association gestionnaire, par exemple) ou ajoute la ville.</p>'; return; }
    res.innerHTML = '<div class="cl-an-t">Choisis l\'établissement à facturer :</div>' + CC.clients._resultats.map((it, i) => `
      <button type="button" class="cl-an" data-an="${i}">
        <span class="cl-an-n">${clEsc(it.nom)}${it.ferme ? ' <span class="cl-tag warn">fermé</span>' : ''}</span>
        <span class="cl-an-d">${clEsc(it.adresse || '')}</span>
        <span class="cl-an-d">SIRET ${clEsc(it.siret)}${it.org && it.org !== it.nom ? ' · ' + clEsc(it.org) : ''}</span>
      </button>`).join('');
  },

  _resultats: [],

  _appliquerAnnuaire(it) {
    if (!it) return;
    clSet('c_siret', it.siret);
    clSet('c_adresse', clCasse(it.voie, true));
    clSet('c_cp', it.cp);
    clSet('c_ville', clCasse(it.ville, false));
    if (it.public && clVal('c_type') === 'pro') clSet('c_type', 'public');
    document.getElementById('c_annuaireRes').innerHTML = '<p class="field-hint ok">Adresse et SIRET repris de l\'annuaire. Vérifie avant d\'enregistrer.</p>';
    CC.clients._syncType();
    CC.clients._syncSiret();
  },

  // ------------------------------------------------------------------ enregistrement
  async enregistrer() {
    const nom = clVal('c_nom').replace(/\s+/g, ' ');
    if (!nom) { CC.toast('Le nom du client est obligatoire.', 'err'); return; }
    const id = CC.clients._editId;
    const avant = id ? CC.clients.byId(id) : null;
    const alias = clVal('c_alias').split(/[,;\n]/).map((s) => s.replace(/\s+/g, ' ').trim())
      .filter((s, i, arr) => s && clNorm(s) !== clNorm(nom) && arr.findIndex((x) => clNorm(x) === clNorm(s)) === i);

    // Un nom ne peut appartenir qu'a une seule fiche.
    for (const n of [nom].concat(alias)) {
      const autre = CC.clients.ficheDe(n);
      if (autre && autre.id !== id) {
        CC.toast(`« ${n} » est déjà rattaché à la fiche ${autre.nom}.`, 'err');
        return;
      }
    }

    const siret = clVal('c_siret').replace(/\s/g, '');
    const fiche = {
      id: id || CC.util.uid(),
      nom,
      alias,
      type: clVal('c_type') || 'pro',
      adresse: clVal('c_adresse'),
      cp: clVal('c_cp'),
      ville: clVal('c_ville'),
      siret: clVal('c_type') === 'particulier' ? '' : siret,
      contact: clVal('c_contact'),
      email: clVal('c_email'),
      tel: clVal('c_tel'),
      categorie: clVal('c_categorie'),
      delai: parseInt(clVal('c_delai'), 10) > 0 ? parseInt(clVal('c_delai'), 10) : null,
      chorus: document.getElementById('c_chorus').checked,
      chorusService: document.getElementById('c_chorus').checked ? clVal('c_chorusService') : '',
      notes: clVal('c_notes')
    };

    // Factures ecrites sous un autre nom que celui de la fiche (ancien nom, autre
    // ecriture) : on propose de les renommer, pour que tout soit range pareil.
    // Noms deja portes par ce client : ceux de la fiche avant modification, ou,
    // pour une fiche creee depuis la liste, ceux trouves dans les factures.
    const anciens = avant ? [avant.nom].concat(avant.alias || []) : (CC.clients._origine || []);
    const cles = new Set([nom].concat(alias).concat(anciens).map((n) => CC.util.clientKeyBrut(n)));
    const aRenommer = CC.state.factures.filter((f) => cles.has(CC.util.clientKeyBrut(f.libelle)) && !String(f.libelle).startsWith(nom));
    let renommer = false;
    if (aRenommer.length) {
      const exemples = Array.from(new Set(aRenommer.map((f) => clPartie(f.libelle)))).slice(0, 4).map((n) => '« ' + n + ' »').join(', ');
      const r = await CC.dialog({
        type: 'question',
        buttons: ['Renommer les factures', 'Garder leurs noms'],
        defaultId: 0, cancelId: 1,
        title: 'Harmoniser les factures',
        message: `${aRenommer.length} facture(s) de ce client sont écrites autrement : ${exemples}.`,
        detail: `Les renommer en « ${nom} » ? La nature de la vente (après « — ») est conservée. Si tu gardes leurs noms, elles restent rattachées à la fiche par ses autres noms.`
      });
      renommer = r.response === 0;
    }

    if (renommer) {
      aRenommer.forEach((f) => { f.libelle = nom + clSuite(f.libelle, nom); });
    } else {
      // Factures laissees telles quelles : leurs noms deviennent des « autres
      // noms » de la fiche, sinon elles ne lui seraient plus rattachees.
      aRenommer.forEach((f) => {
        const n = clPartie(f.libelle);
        if (n && clNorm(n) !== clNorm(nom) && !fiche.alias.some((a) => clNorm(a) === clNorm(n))
          && CC.util.clientKeyBrut(n) !== CC.util.clientKeyBrut(nom)) fiche.alias.push(n);
      });
    }

    const arr = CC.clients.fiches();
    const i = arr.findIndex((x) => x.id === fiche.id);
    if (i >= 0) arr[i] = fiche; else arr.push(fiche);
    CC.clients._touche();
    CC.markDirty();
    CC.clients.fermer();
    CC.render();
    CC.clients.render();
    if (CC.facturesView.syncClientHint) CC.facturesView.syncClientHint();
    CC.toast(`Fiche ${nom} enregistrée${renommer ? ' · ' + aRenommer.length + ' facture(s) renommée(s)' : ''}.`, 'ok');
  },

  async supprimer() {
    const id = CC.clients._editId;
    const fi = id && CC.clients.byId(id);
    if (!fi) return;
    const r = await CC.dialog({
      type: 'warning',
      buttons: ['Supprimer la fiche', 'Annuler'],
      defaultId: 1, cancelId: 1,
      title: 'Supprimer la fiche',
      message: `Supprimer la fiche de ${fi.nom} ?`,
      detail: 'Ses factures ne sont pas touchées : seules les coordonnées et les réglages du client sont effacés.'
    });
    if (r.response !== 0) return;
    const arr = CC.clients.fiches();
    arr.splice(arr.indexOf(fi), 1);
    CC.clients._touche();
    CC.markDirty();
    CC.clients.fermer();
    CC.render();
    CC.clients.render();
    if (CC.facturesView.syncClientHint) CC.facturesView.syncClientHint();
    CC.toast('Fiche supprimée.', 'ok');
  }
};

// ---------------------------------------------------------------------------
// Completer les fiches depuis Indy
//
// Indy n'a pas d'API publique, mais chaque facture qu'il produit porte le bloc
// client complet (nom, adresse, SIRET). On lit ces PDF — dans Gmail (mails
// envoyes et recus contenant une facture PDF) ou choisis a la main — et on
// propose, client par client, ce qui manque a sa fiche. Rien n'est ecrit avant
// que tu aies valide la liste.
//
// Rattachement d'une facture Indy a un client de la compta : d'abord par le
// numero de facture (le plus sur : « 202609-228 » -> facture n°228), sinon par
// le nom. Une facture Indy dont le numero n'existe pas dans la compta est
// signalee a part : c'est peut-etre une facture oubliee.
// ---------------------------------------------------------------------------
CC.clientsIndy = {
  _lus: [],        // factures Indy lues : { num, date, montant, libelle, client, source }
  _props: [],      // propositions : { cle, nom, fiche, champs, source, coche }
  _vus: new Set(), // pieces deja lues (nom + taille), pour ne pas lire deux fois
  _enCours: false,
  _bound: false,

  // Client de la compta correspondant a un bloc client Indy : par SIRET d'abord,
  // puis par nom (nom de la fiche ou un de ses autres noms). null sinon.
  trouver(k) {
    if (!k) return null;
    const liste = CC.clients.liste();
    if (k.siret) {
      const c = liste.find((x) => x.fiche && String(x.fiche.siret || '').replace(/\s/g, '') === k.siret);
      if (c) return c;
    }
    const n = clNorm(k.nom);
    if (!n) return null;
    return liste.find((x) => clNorm(x.nom) === n || (x.fiche && (x.fiche.alias || []).some((a) => clNorm(a) === n))) || null;
  },

  // Complete les champs VIDES d'une fiche avec un bloc client Indy. Renvoie la
  // liste des champs ajoutes.
  completer(fiche, k) {
    if (!fiche || !k) return [];
    const ajoutes = [];
    if (k.adresse && !fiche.adresse) { fiche.adresse = k.adresse; ajoutes.push('adresse'); }
    if (k.cp && !fiche.cp) fiche.cp = k.cp;
    if (k.ville && !fiche.ville) fiche.ville = k.ville;
    if (k.siret && !fiche.siret && CC.clients.siretValide(k.siret)) { fiche.siret = k.siret; ajoutes.push('SIRET'); }
    if (ajoutes.length) { CC.clients._touche(); CC.markDirty(); }
    return ajoutes;
  },

  ouvrir() {
    CC.clientsIndy.bind();
    CC.clientsIndy.render();
    document.getElementById('modalIndy').classList.remove('hidden');
  },
  fermer() { document.getElementById('modalIndy').classList.add('hidden'); },

  bind() {
    if (CC.clientsIndy._bound) return;
    CC.clientsIndy._bound = true;
    const m = document.getElementById('modalIndy');
    document.getElementById('indyGmail').addEventListener('click', () => CC.clientsIndy.depuisGmail());
    document.getElementById('indyPdf').addEventListener('click', () => document.getElementById('indyFichiers').click());
    document.getElementById('indyFichiers').addEventListener('change', (e) => {
      const fs = Array.from(e.target.files || []);
      e.target.value = '';
      if (fs.length) CC.clientsIndy.depuisFichiers(fs);
    });
    document.getElementById('indyFermer').addEventListener('click', () => CC.clientsIndy.fermer());
    document.getElementById('indyX').addEventListener('click', () => CC.clientsIndy.fermer());
    document.getElementById('indyAppliquer').addEventListener('click', () => CC.clientsIndy.appliquer());
    document.getElementById('indyCorps').addEventListener('change', (e) => {
      const cb = e.target.closest('input[data-prop]'); if (!cb) return;
      const p = CC.clientsIndy._props[+cb.dataset.prop]; if (p) p.coche = cb.checked;
      CC.clientsIndy._syncBouton();
    });
    m.addEventListener('click', (e) => { if (CC.clicFond(e, m)) CC.clientsIndy.fermer(); });
  },

  _etat(txt, cls) {
    const el = document.getElementById('indyEtat');
    el.textContent = txt || '';
    el.className = 'indy-etat' + (cls ? ' ' + cls : '');
  },

  // ---- Sources -------------------------------------------------------------
  async depuisGmail() {
    if (CC.clientsIndy._enCours) return;
    const api = window.api && window.api.gmail;
    if (!api) { CC.clientsIndy._etat('Gmail n\'est pas disponible ici.', 'warn'); return; }
    CC.clientsIndy._enCours = true;
    CC.clientsIndy._occupe(true);
    try {
      CC.clientsIndy._etat('Recherche des mails contenant une facture PDF…');
      const q = 'has:attachment filename:pdf (facture OR factures)';
      const ids = new Set();
      let erreur = '';
      for (const dossier of ['envoyes', 'principal']) {
        let token = '';
        for (let page = 0; page < 8; page++) {
          const r = await api.list({ dossier, maxResults: 50, recherche: q, pageToken: token });
          if (!r || r.error) { erreur = (r && r.error) || 'réponse vide'; break; }
          (r.messages || []).forEach((m) => ids.add(m.id));
          token = r.nextPageToken || '';
          if (!token) break;
        }
      }
      if (!ids.size) {
        CC.clientsIndy._etat(erreur ? 'Gmail ne répond pas : ' + erreur + ' (connecte Google dans Paramètres).' : 'Aucun mail avec une facture PDF trouvé.', 'warn');
        return;
      }
      let n = 0, lues = 0;
      const liste = Array.from(ids);
      // Quatre messages a la fois : assez vite, sans se faire limiter par Gmail.
      for (let i = 0; i < liste.length; i += 4) {
        await Promise.all(liste.slice(i, i + 4).map(async (id) => {
          const g = await api.get(id);
          const msg = g && g.message;
          if (!msg) return;
          for (const a of (msg.attachments || [])) {
            if (!/\.pdf$/i.test(a.filename || '') || !/fact/i.test(a.filename || '')) continue;
            const cle = (a.filename || '') + '|' + (a.size || 0);
            if (CC.clientsIndy._vus.has(cle)) continue;
            CC.clientsIndy._vus.add(cle);
            const d = await api.attachment({ messageId: msg.id, attachmentId: a.attachmentId });
            if (!d || d.error || !d.data) continue;
            if (await CC.clientsIndy._lire(clB64(d.data), a.filename)) lues++;
          }
        }));
        n = Math.min(liste.length, i + 4);
        CC.clientsIndy._etat(`Lecture des factures… ${n} / ${liste.length} mails · ${lues} facture(s) Indy lue(s)`);
      }
      CC.clientsIndy._analyser();
      CC.clientsIndy._etat(`${liste.length} mail(s) parcouru(s) · ${lues} facture(s) Indy lue(s).`, 'ok');
    } catch (err) {
      CC.clientsIndy._etat('Lecture interrompue : ' + (err && err.message ? err.message : err), 'warn');
    } finally {
      CC.clientsIndy._enCours = false;
      CC.clientsIndy._occupe(false);
      CC.clientsIndy.render();
    }
  },

  async depuisFichiers(files) {
    if (CC.clientsIndy._enCours) return;
    CC.clientsIndy._enCours = true;
    CC.clientsIndy._occupe(true);
    let lues = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        CC.clientsIndy._etat(`Lecture de ${f.name} (${i + 1} / ${files.length})…`);
        const cle = f.name + '|' + f.size;
        if (CC.clientsIndy._vus.has(cle)) continue;
        CC.clientsIndy._vus.add(cle);
        if (await CC.clientsIndy._lire(await f.arrayBuffer(), f.name)) lues++;
      }
      CC.clientsIndy._analyser();
      CC.clientsIndy._etat(`${files.length} PDF · ${lues} facture(s) Indy lue(s).`, 'ok');
    } finally {
      CC.clientsIndy._enCours = false;
      CC.clientsIndy._occupe(false);
      CC.clientsIndy.render();
    }
  },

  _occupe(on) {
    ['indyGmail', 'indyPdf'].forEach((id) => { const b = document.getElementById(id); if (b) b.disabled = on; });
  },

  async _lire(buffer, nomFichier) {
    try {
      const r = await CC.pdfImporter.fromArrayBuffer(buffer);
      if (!r || !r.isIndy) return false;
      if (CC.clientsIndy._lus.some((x) => x.numFull === r.numFull)) return true;
      CC.clientsIndy._lus.push({ num: r.num, numFull: r.numFull, date: r.dateEnvoi || '', montant: r.montant, libelle: r.libelle || '', client: r.client, source: nomFichier });
      return true;
    } catch (_) { return false; }
  },

  // ---- Analyse ---------------------------------------------------------------
  // Pour chaque client de la compta : la facture Indy la plus recente qui le
  // concerne, et ce qu'elle apporte a sa fiche (champs vides uniquement).
  _analyser() {
    const S = CC.state;
    const parNum = new Map();
    S.factures.forEach((f) => String(f.numFacture || '').split(/[-\s]+/).filter(Boolean).forEach((n) => parNum.set(n.replace(/^0+/, ''), f)));
    const clients = CC.clients.liste();
    const parCle = new Map(clients.map((c) => [c.cle, c]));
    const parNom = new Map();
    clients.forEach((c) => {
      parNom.set(clNorm(c.nom), c);
      if (c.fiche) (c.fiche.alias || []).forEach((a) => parNom.set(clNorm(a), c));
    });

    const meilleur = new Map();   // cle client -> facture Indy la plus recente
    const absentes = [];
    CC.clientsIndy._lus.forEach((lu) => {
      let c = null;
      const f = lu.num ? parNum.get(String(lu.num).replace(/^0+/, '')) : null;
      if (f) {
        const fi = CC.clients.ficheDe(f.libelle);
        c = parCle.get(fi ? CC.util.clientKeyBrut(fi.nom) : CC.util.clientKey(f.libelle)) || null;
      } else {
        absentes.push(lu);
      }
      if (!c && lu.client && lu.client.nom) c = parNom.get(clNorm(lu.client.nom)) || null;
      if (!c || !lu.client) return;
      const deja = meilleur.get(c.cle);
      if (!deja || (lu.date || '') > (deja.lu.date || '')) meilleur.set(c.cle, { c, lu });
    });

    const props = [];
    meilleur.forEach(({ c, lu }) => {
      const fi = c.fiche || {};
      const k = lu.client;
      const champs = {};
      if (k.adresse && !fi.adresse) champs.adresse = k.adresse;
      if (k.cp && !fi.cp) champs.cp = k.cp;
      if (k.ville && !fi.ville) champs.ville = k.ville;
      if (k.siret && !fi.siret && CC.clients.siretValide(k.siret)) champs.siret = k.siret;
      if (!Object.keys(champs).length) return;
      props.push({ cle: c.cle, nom: c.nom, fiche: c.fiche, categorie: c.categorie, raison: k.nom, champs, lu, coche: true });
    });
    props.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    CC.clientsIndy._props = props;
    CC.clientsIndy._absentes = absentes.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  },

  // ---- Affichage -------------------------------------------------------------
  render() {
    const corps = document.getElementById('indyCorps');
    if (!corps) return;
    const props = CC.clientsIndy._props;
    const abs = CC.clientsIndy._absentes || [];
    if (!CC.clientsIndy._lus.length) {
      corps.innerHTML = '<p class="indy-vide">Lance une recherche : l\'app lit les factures Indy et te montre ici ce qu\'elle peut ajouter à chaque fiche. Rien n\'est modifié avant que tu valides.</p>';
      CC.clientsIndy._syncBouton();
      return;
    }
    const champsTxt = (ch) => {
      const t = [];
      if (ch.adresse || ch.cp || ch.ville) t.push(clEsc([ch.adresse, [ch.cp, ch.ville].filter(Boolean).join(' ')].filter(Boolean).join(', ')));
      if (ch.siret) t.push('SIRET ' + clEsc(ch.siret));
      return t.join(' · ');
    };
    const lignes = props.map((p, i) => `
      <label class="indy-prop">
        <input type="checkbox" data-prop="${i}" ${p.coche ? 'checked' : ''} />
        <span class="indy-prop-txt">
          <span class="indy-prop-nom">${clEsc(p.nom)} <span class="cl-tag ${p.fiche ? 'muted' : 'chorus'}">${p.fiche ? 'fiche existante' : 'nouvelle fiche'}</span></span>
          <span class="indy-prop-champs">${champsTxt(p.champs)}</span>
          <span class="indy-prop-src">Facture n°${clEsc(p.lu.num)}${p.lu.date ? ' du ' + CC.util.frDate(p.lu.date) : ''}${p.raison && clNorm(p.raison) !== clNorm(p.nom) ? ' · au nom de « ' + clEsc(p.raison) + ' »' : ''}</span>
        </span>
      </label>`).join('');
    const absHtml = abs.length ? `
      <div class="indy-section">
        <div class="indy-titre">Factures Indy absentes de ta compta <span class="cl-tag warn">${abs.length}</span></div>
        <p class="field-hint">Leur numéro n'existe dans aucune facture de l'app : à vérifier, c'est peut-être du CA non saisi.</p>
        <table class="cl-histo">${abs.slice(0, 30).map((a) => `<tr>
          <td>n°${clEsc(a.num)}</td><td>${a.date ? CC.util.frDate(a.date) : '—'}</td>
          <td class="cl-lib">${clEsc((a.client && a.client.nom) || '')} ${a.libelle ? '— ' + clEsc(a.libelle) : ''}</td>
          <td class="num">${a.montant != null ? CC.util.eur(a.montant) : ''}</td></tr>`).join('')}</table>
      </div>` : '';
    corps.innerHTML = `
      <div class="indy-section">
        <div class="indy-titre">Fiches à compléter <span class="cl-tag muted">${props.length}</span></div>
        ${props.length ? lignes : '<p class="field-hint ok">Toutes les fiches concernées sont déjà complètes (ou aucune facture lue ne correspond à un client de la compta).</p>'}
      </div>${absHtml}`;
    CC.clientsIndy._syncBouton();
  },

  _syncBouton() {
    const n = CC.clientsIndy._props.filter((p) => p.coche).length;
    const b = document.getElementById('indyAppliquer');
    b.disabled = !n;
    b.textContent = n ? `Compléter ${n} fiche${n > 1 ? 's' : ''}` : 'Compléter les fiches';
  },

  appliquer() {
    const choisis = CC.clientsIndy._props.filter((p) => p.coche);
    if (!choisis.length) return;
    const arr = CC.clients.fiches();
    let crees = 0, completees = 0;
    choisis.forEach((p) => {
      if (p.fiche) {
        Object.assign(p.fiche, p.champs);
        completees++;
      } else {
        const nom = p.nom;
        const publicOrg = /^(mairie|commune|ville de|sivom|sivu|syndicat|communaut|d[ée]partement|conseil|r[ée]gion|m[ée]tropole|ccas|centre communal)/i.test(nom + ' ' + (p.raison || ''));
        const autres = Array.from((CC.clients.liste().find((c) => c.cle === p.cle) || { noms: new Map() }).noms.keys()).filter((n) => clNorm(n) !== clNorm(nom));
        arr.push(Object.assign({
          id: CC.util.uid(), nom, alias: autres,
          type: publicOrg ? 'public' : (p.champs.siret ? 'pro' : 'particulier'),
          adresse: '', cp: '', ville: '', siret: '', contact: '', email: '', tel: '',
          categorie: p.categorie || '', delai: null, chorus: publicOrg, chorusService: '', notes: ''
        }, p.champs));
        crees++;
      }
    });
    CC.clients._touche();
    CC.markDirty();
    CC.clientsIndy._analyser();
    CC.clientsIndy.render();
    CC.clients.render();
    CC.toast(`${crees ? crees + ' fiche(s) créée(s)' : ''}${crees && completees ? ' · ' : ''}${completees ? completees + ' fiche(s) complétée(s)' : ''} depuis Indy.`, 'ok');
  }
};

// Donnees base64url (Gmail) -> ArrayBuffer.
function clB64(data) {
  const bin = atob(String(data).replace(/-/g, '+').replace(/_/g, '/'));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u.buffer;
}
