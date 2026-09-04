'use strict';
window.CC = window.CC || {};

// ---------------------------------------------------------------------------
// Onglet Réseau : démarchage des structures médico-sociales et sociales.
//
// · La BASE (structures, gestionnaires) est figée dans prospection-base.js,
//   engendrée depuis FINESS par outils/construire-prospection.js. Elle est
//   gardée sous forme de chaîne et analysée à la première ouverture de l'onglet.
// · Le SUIVI (statuts, interlocuteurs, notes, modèles) vit dans son propre
//   fichier Drive `prospection.json`, comme le pense-bête : un enregistrement de
//   compta ne peut donc jamais l'écraser, et inversement.
// · Les structures déjà facturées sont reconnues en croisant les libellés des
//   factures avec les noms de la base.
// ---------------------------------------------------------------------------

const PS_STATUTS = [
  ['aucun', 'À contacter'],
  ['contacte', 'Contacté'],
  ['relance', 'À relancer'],
  ['rdv', 'Rendez-vous'],
  ['devis', 'Devis envoyé'],
  ['gagne', 'Intervention actée'],
  ['refus', 'Sans suite'],
];
const PS_STATUT_LIB = Object.fromEntries(PS_STATUTS);

// Couleurs prises dans la palette de l'app (indigo / corail / sémantique).
const PS_COUL_FAM = {
  'enfance-handicap': '#4f46e5',
  'adultes-handicap': '#0ea371',
  'protection-enfance': '#c2740a',
  'personnes-agees': '#8b5cf6',
  'sante-mentale': '#fb7185',
  'social-insertion': '#0891b2',
  'animation-jeunesse': '#e0670e',
  'ressources': '#6c6890',
  'sanitaire': '#6366f1',
  'domicile': '#a8a29e',
  'formation': '#65a30d',
  'autre': '#9a96b8',
};
const PS_COUL_STATUT = {
  aucun: '#9a96b8', contacte: '#4f46e5', relance: '#c2740a',
  rdv: '#0ea371', devis: '#8b5cf6', gagne: '#047857', refus: '#dc2626',
};
// Vert des structures déjà facturées : il prime sur toutes les autres couleurs
// de la carte, c'est l'information qu'on cherche en premier.
const PS_CLIENT_VERT = '#12b76a';

const PS_MODELES = [
  {
    id: 'm1',
    nom: 'Premier contact — établissement',
    objet: 'Proposition d’ateliers musicaux — {structure}',
    corps: `Bonjour,

Je suis {moi}, musicien intervenant, et je propose des ateliers et des interventions musicales auprès des publics accompagnés en établissement médico-social.

Je me permets de vous écrire parce que {structure}, à {ville}, accueille un public ({public}) avec lequel ce travail a beaucoup de sens : pratique collective, écoute, rythme, voix, création sonore — des séances conçues avec l’équipe éducative et adaptées aux capacités de chacun.

Concrètement, je peux intervenir sous plusieurs formes :
• un atelier régulier (hebdomadaire ou bimensuel) sur un cycle de plusieurs séances ;
• un projet ponctuel autour d’une création, d’un enregistrement ou d’une restitution ;
• une intervention unique de découverte, pour tester avec un groupe.

Seriez-vous disponible pour un échange rapide, par téléphone ou sur place, afin que je vous présente le contenu et que l’on regarde si cela correspond à vos projets d’activité ?

Bien cordialement,

{moi}
{montel} — {monmail}
{monsite}`,
  },
  {
    id: 'm2',
    nom: 'Premier contact — siège / gestionnaire',
    objet: 'Interventions musicales dans vos établissements — {gestionnaire}',
    corps: `Bonjour,

Je suis {moi}, musicien intervenant dans les Alpes-Maritimes. Je m’adresse à vous au niveau du siège car {gestionnaire} gère plusieurs établissements dans le département, et il me semble plus simple de vous présenter une fois ce que je propose plutôt que d’écrire à chaque structure.

J’anime des ateliers musicaux auprès des publics accompagnés en établissement : pratique collective, percussions, voix, création sonore, enregistrement. Les séances sont construites avec les équipes et adaptées à chaque groupe.

Je peux intervenir ponctuellement ou sur un cycle, et me déplacer sur l’ensemble du département.

Y a-t-il une personne en charge des projets d’animation ou de la vie sociale à qui je peux transmettre un dossier ? Je peux aussi venir présenter le projet en réunion de directeurs si cela vous semble pertinent.

Bien cordialement,

{moi}
{montel} — {monmail}
{monsite}`,
  },
  {
    id: 'm3',
    nom: 'Relance (10 à 15 jours après)',
    objet: 'Re : ateliers musicaux — {structure}',
    corps: `Bonjour,

Je me permets de revenir vers vous au sujet de ma proposition d’ateliers musicaux pour {structure}.

Je sais que la période est chargée : si le sujet vous intéresse mais que ce n’est pas le bon moment, dites-le-moi simplement et je vous recontacterai plus tard dans l’année. Et si ce n’est pas d’actualité, ça ne me vexera pas — je préfère le savoir.

Je reste joignable au {montel}.

Bien cordialement,

{moi}`,
  },
  {
    id: 'm4',
    nom: 'Script d’appel téléphonique',
    objet: '(appel) {structure} — {tel}',
    corps: `« Bonjour, {moi} à l’appareil, je suis musicien intervenant.
Je cherche à joindre la personne qui s’occupe des activités ou des projets d’animation, c’est bien vous ? »

→ Si non : « Vous pouvez me dire à qui je dois m’adresser, et à quel moment on la joint le plus facilement ? »
   Noter : nom, fonction, créneau, mail direct.

→ Si oui, en une phrase :
« J’anime des ateliers musicaux en établissement — pratique collective, percussions, voix, création sonore.
Je travaille avec les équipes pour adapter les séances au groupe. Je démarche les structures du 06 pour la saison qui vient. »

Trois questions à poser (et à noter) :
1. « Vous avez déjà des intervenants extérieurs, ou des activités culturelles en place ? »
2. « Comment ça se décide chez vous — c’est vous, la direction, un budget projet, un appel à projets ? »
3. « À quelle période vous calez vos activités pour l’année ? »

Conclure sur un pas concret :
« Je vous envoie une présentation par mail aujourd’hui, et je vous rappelle la semaine du ___ pour savoir ce que vous en pensez ? »`,
  },
  {
    id: 'm5',
    nom: 'Après le rendez-vous',
    objet: 'Suite à notre échange — {structure}',
    corps: `Bonjour,

Merci pour le temps que vous m’avez accordé.

Comme convenu, voici ce que je retiens de notre échange et ce que je vous propose :
• Public concerné : {public}
• Format : ___ séances de ___ minutes, groupe de ___ personnes
• Période envisagée : ___
• Tarif : ___ € la séance (déplacement et matériel compris)

Je reste ouvert à ajuster le format selon vos contraintes d’organisation.

Dites-moi ce qu’il vous faut de mon côté pour avancer (devis, attestation d’assurance, présentation écrite pour l’équipe).

Bien cordialement,

{moi}
{montel} — {monmail}`,
  },
];

CC.prospection = {
  _base: null,
  _bound: false,
  _pulled: false,
  _map: null,
  _couches: null,
  _sub: 'structures',
  _sel: null,
  _selG: null,
  _modSel: 'm1',
  _saveT: null,
  _clients: null,
  _tri: 'nom',
  _filtres: { texte: '', famille: 'enfance-handicap', public: 'all', secteur: 'all', statut: 'all', relation: 'all' },

  // ---- Base figée -------------------------------------------------------
  base() {
    if (this._base) return this._base;
    if (!window.CC_PROSPECTION_JSON) return null;
    const b = JSON.parse(window.CC_PROSPECTION_JSON);
    b.parId = {};
    b.structures.forEach((s) => { b.parId[s.id] = s; });
    b.gParId = {};
    b.gestionnaires.forEach((g) => { b.gParId[g.id] = g; });
    this._base = b;
    return b;
  },

  // Structures + ajouts manuels de l'utilisateur.
  toutes() {
    const b = this.base();
    if (!b) return [];
    const perso = Object.values(this.suivi().perso || {});
    if (!perso.length) return b.structures;
    const t = b.structures.concat(perso);
    perso.forEach((p) => { b.parId[p.id] = p; });
    return t;
  },

  // ---- Suivi (fichier Drive séparé) -------------------------------------
  suivi() {
    const S = CC.state;
    if (!S.prospection || typeof S.prospection !== 'object') S.prospection = {};
    const p = S.prospection;
    if (!p.fiches) p.fiches = {};
    if (!p.perso) p.perso = {};
    if (!p.reglages) p.reglages = {};
    if (!Array.isArray(p.modeles) || !p.modeles.length) p.modeles = JSON.parse(JSON.stringify(PS_MODELES));
    return p;
  },
  fiche(id) {
    const f = this.suivi().fiches;
    if (!f[id]) f[id] = { statut: 'aucun', histo: [] };
    if (!f[id].histo) f[id].histo = [];
    return f[id];
  },
  statutDe(id) {
    const f = this.suivi().fiches[id];
    return (f && f.statut) || 'aucun';
  },
  reglage(k) {
    const v = this.suivi().reglages[k];
    return v == null || v === '' ? '' : v;
  },

  // Une fiche sans rien dedans n'a pas à occuper le fichier Drive.
  _vide(f) {
    if (!f) return true;
    if (f.statut && f.statut !== 'aucun') return false;
    if (f.histo && f.histo.length) return false;
    return !['contactNom', 'mail', 'telDirect', 'site', 'notes', 'relanceLe'].some((k) => String(f[k] || '').trim());
  },
  _persist() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => {
      const p = this.suivi();
      Object.keys(p.fiches).forEach((id) => { if (this._vide(p.fiches[id])) delete p.fiches[id]; });
      try { if (window.api && window.api.prospection) window.api.prospection.save(p); } catch (_) {}
    }, 600);
  },
  async pull() {
    if (!(window.api && window.api.prospection)) return;
    let r;
    try { r = await window.api.prospection.load(); } catch (_) { return; }
    if (!r || !r.exists || !r.suivi) return;
    // Drive arrive après le premier rendu : si l'utilisateur a déjà touché une
    // fiche entre-temps, on ne l'écrase pas.
    const local = CC.state.prospection;
    if (local && local.fiches && Object.keys(local.fiches).length) return;
    const s = r.suivi;
    CC.state.prospection = {
      fiches: s.fiches || {}, perso: s.perso || {},
      modeles: Array.isArray(s.modeles) && s.modeles.length ? s.modeles : null,
      reglages: s.reglages || {},
    };
    this.suivi();
    this._pulled = true;
    if (document.getElementById('tab-reseau') && !document.getElementById('tab-reseau').classList.contains('hidden')) this.render();
  },

  // ---- Croisement avec les factures -------------------------------------
  // Un nom de la base est « déjà client » si un libellé de facture le recouvre.
  // On compare sur les mots significatifs pour ne pas rater « Les Chênes » vs
  // « IME LES CHENES », sans pour autant marier deux structures homonymes.
  clients() {
    if (this._clients) return this._clients;
    const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const VIDES = new Set(['IME', 'SESSAD', 'ITEP', 'EJ', 'ASSO', 'ASSOCIATION', 'FONDATION', 'LE', 'LA', 'LES',
      'DE', 'DU', 'DES', 'ET', 'CENTRE', 'MAISON', 'FOYER', 'SERVICE', 'ETABLISSEMENT', 'ESAT', 'MAS',
      'SAINT', 'STE', 'ST', 'DR', 'NICE', 'CANNES', 'ANTIBES', 'GRASSE', 'MENTON']);
    const mots = (s) => norm(s).split(' ').filter((w) => w.length > 2 && !VIDES.has(w));

    const parClient = {};
    (CC.state.factures || []).forEach((f) => {
      const k = CC.util.clientKey(f.libelle);
      const e = parClient[k] || (parClient[k] = { nom: f.libelle, mots: mots(k), ca: 0, n: 0, dernier: '' });
      e.ca += +f.montant || 0;
      e.n++;
      const d = f.dateEncaissement || f.dateEcheance || '';
      if (d > e.dernier) e.dernier = d;
    });
    const liste = Object.values(parClient).filter((c) => c.mots.length);

    const idx = {};
    this.toutes().forEach((s) => {
      const ms = mots(s.nom);
      if (!ms.length) return;
      liste.forEach((c) => {
        // Tous les mots significatifs du client se retrouvent dans le nom de la
        // structure (ou l'inverse) → c'est la même entité.
        const ok = c.mots.every((w) => ms.includes(w)) || ms.every((w) => c.mots.includes(w));
        if (!ok) return;
        const e = idx[s.id] || (idx[s.id] = { ca: 0, n: 0, dernier: '', noms: [] });
        e.ca += c.ca; e.n += c.n;
        if (c.dernier > e.dernier) e.dernier = c.dernier;
        if (!e.noms.includes(c.nom)) e.noms.push(c.nom);
      });
    });
    this._clients = idx;
    return idx;
  },

  // ---- Rendu ------------------------------------------------------------
  render() {
    const b = this.base();
    if (!b) return;
    if (!this._pulled) { this._pulled = true; this.pull(); }
    this._remplirFiltres();
    if (this._sub === 'structures') this.renderStructures();
    else if (this._sub === 'gestionnaires') this.renderGestionnaires();
    else if (this._sub === 'carte') this.renderCarte();
    else if (this._sub === 'modeles') this.renderModeles();
  },

  _remplirFiltres() {
    const b = this.base();
    if (this._filtresRemplis) return;
    this._filtresRemplis = true;
    const sel = (id, opts) => {
      const el = document.getElementById(id);
      if (el) el.insertAdjacentHTML('beforeend', opts);
    };
    const cnt = {};
    b.structures.forEach((s) => { cnt[s.famille] = (cnt[s.famille] || 0) + 1; });
    const ordre = ['enfance-handicap', 'animation-jeunesse', 'adultes-handicap', 'protection-enfance', 'sante-mentale',
      'social-insertion', 'personnes-agees', 'ressources', 'sanitaire', 'formation', 'domicile', 'autre'];
    const optsFam = ordre.filter((f) => cnt[f]).map((f) =>
      `<option value="${f}"${f === 'enfance-handicap' ? ' selected' : ''}>${psEsc(b.famLib[f])} (${cnt[f]})</option>`).join('');
    sel('psFamille', optsFam);
    // La carte s'ouvre sur le même domaine que la liste : 1212 points d'un coup
    // ne montrent rien, 75 IME/SESSAD montrent un maillage lisible.
    sel('psMapFam', optsFam);
    sel('psPublic', Object.entries(b.pubLib).map(([k, v]) => `<option value="${k}">${psEsc(v)}</option>`).join(''));
    sel('psSecteur', b.secteurs.map((s) => `<option value="${psEsc(s)}">${psEsc(s)}</option>`).join(''));
    sel('psStatut', PS_STATUTS.map(([k, l]) => `<option value="${k}">${psEsc(l)}</option>`).join(''));
  },

  filtrer() {
    const F = this._filtres;
    const cl = this.clients();
    const q = psNorm(F.texte).split(/\s+/).filter(Boolean);
    let r = this.toutes().filter((s) => {
      if (F.famille !== 'all' && s.famille !== F.famille) return false;
      if (F.public !== 'all' && !(s.publics || []).includes(F.public)) return false;
      if (F.secteur !== 'all' && s.secteur !== F.secteur) return false;
      if (F.statut !== 'all' && this.statutDe(s.id) !== F.statut) return false;
      if (F.relation === 'client' && !cl[s.id]) return false;
      if (F.relation === 'jamais' && cl[s.id]) return false;
      if (q.length) {
        const f = this.suivi().fiches[s.id] || {};
        const blob = psNorm([s.nom, s.ville, s.catLib, s.adresse, s.cp, s.secteur,
          (this.base().gParId[s.ej] || {}).nom, f.contactNom, f.notes].filter(Boolean).join(' '));
        if (!q.every((t) => blob.includes(t))) return false;
      }
      return true;
    });
    const parNom = (a, b) => a.nom.localeCompare(b.nom, 'fr');
    if (this._tri === 'ville') r.sort((a, b) => (a.ville || '').localeCompare(b.ville || '', 'fr') || parNom(a, b));
    else if (this._tri === 'capacite') r.sort((a, b) => (b.capacite || 0) - (a.capacite || 0) || parNom(a, b));
    else if (this._tri === 'relance') r.sort((a, b) => {
      const x = (this.suivi().fiches[a.id] || {}).relanceLe || '9999';
      const y = (this.suivi().fiches[b.id] || {}).relanceLe || '9999';
      return x.localeCompare(y) || parNom(a, b);
    });
    else r.sort(parNom);
    return r;
  },

  renderStructures() {
    const b = this.base();
    const r = this.filtrer();
    const cl = this.clients();
    const auj = CC.util.toISO(new Date());

    // Indicateurs
    const c = {};
    this.toutes().forEach((s) => { const st = this.statutDe(s.id); c[st] = (c[st] || 0) + 1; });
    const dues = Object.entries(this.suivi().fiches).filter(([, f]) => f.relanceLe && f.relanceLe <= auj).length;
    const kpi = document.getElementById('psKpis');
    // Deux libellés par indicateur : le long sur écran large, le court sur
    // téléphone, où seuls les trois derniers restent affichés.
    if (kpi) kpi.innerHTML = [
      ['À contacter', 'À contacter', c.aucun || 0, ''],
      ['Contactées', 'Contactées', (c.contacte || 0) + (c.relance || 0), 'blue'],
      ['Relances dues', 'Relances', dues, dues ? 'amber' : ''],
      ['Rendez-vous', 'RDV', c.rdv || 0, 'indigo'],
      ['Interventions actées', 'Actées', c.gagne || 0, 'green'],
    ].map(([l, court, v, cls]) => `<div class="kpi ${cls}">
        <div class="label"><span class="l-long">${l}</span><span class="l-court">${court}</span></div>
        <div class="value">${v}</div></div>`).join('');

    const sum = document.getElementById('psSummary');
    if (sum) sum.textContent = r.length + ' structure' + (r.length > 1 ? 's' : '') + ' sur ' + this.toutes().length;

    const body = document.getElementById('psBody');
    if (!body) return;
    body.innerHTML = r.slice(0, 400).map((s) => {
      const st = this.statutDe(s.id);
      const f = this.suivi().fiches[s.id] || {};
      const client = cl[s.id];
      const pubs = (s.publics || []).map((p) => (b.pubLib[p] || p).replace(/\s*\(.*\)/, '')).join(', ');
      const rel = f.relanceLe
        ? `<span class="ps-rel${f.relanceLe <= auj ? ' late' : ''}">${CC.util.frDate(f.relanceLe)}</span>` : '';
      // Les cellules sont nommées : sur téléphone la CSS replie la ligne en carte
      // (nom + statut / type · ville + téléphone) sans changer ce balisage.
      return `<tr data-id="${psEsc(s.id)}">
        <td class="ps-c-nom"><span class="ps-nom">${psEsc(psTitre(s.nom))}</span>${client ? '<span class="ps-client" title="Déjà facturé">client</span>' : ''}
            <div class="ps-sub">${psEsc(s.catCourt)}<span class="ps-v"> · ${psEsc(psTitre(s.ville))}</span></div></td>
        <td class="ps-c-ville">${psEsc(psTitre(s.ville))}<div class="ps-sub">${psEsc(s.secteur)}</div></td>
        <td class="ps-c-pub">${psEsc(pubs)}</td>
        <td class="ps-c-places num">${s.capacite || '—'}</td>
        <td class="ps-c-tel ps-tel">${s.tel ? psEsc(psTel(s.tel)) : '—'}</td>
        <td class="ps-c-suivi"><span class="stpill ps-${st}">${psEsc(PS_STATUT_LIB[st])}</span> ${rel}</td>
      </tr>`;
    }).join('');

    const vide = document.getElementById('psEmpty');
    if (vide) vide.classList.toggle('hidden', r.length > 0);
    const trop = document.getElementById('psTrop');
    if (trop) trop.classList.toggle('hidden', r.length <= 400);
  },

  // ---- Gestionnaires -----------------------------------------------------
  renderGestionnaires() {
    const b = this.base();
    const q = psNorm(document.getElementById('psGsearch') ? document.getElementById('psGsearch').value : '');
    const coeur = document.getElementById('psGcoeur') && document.getElementById('psGcoeur').checked;
    const plusieurs = document.getElementById('psGmulti') && document.getElementById('psGmulti').checked;

    let r = b.gestionnaires.filter((g) => {
      if (plusieurs && g.nbEtabs < 2) return false;
      if (coeur && !g.familles['enfance-handicap']) return false;
      if (q && !psNorm(g.nom + ' ' + g.ville).includes(q)) return false;
      return true;
    });
    const sum = document.getElementById('psGsummary');
    if (sum) sum.textContent = r.length + ' gestionnaire' + (r.length > 1 ? 's' : '') + ' sur ' + b.gestionnaires.length;

    const body = document.getElementById('psGbody');
    if (!body) return;
    body.innerHTML = r.map((g) => {
      const fam = Object.entries(g.familles).sort((a, x) => x[1] - a[1]).slice(0, 2)
        .map(([f, n]) => (b.famLib[f] || f) + ' ×' + n).join(' · ');
      return `<tr data-gid="${psEsc(g.id)}">
        <td class="ps-c-nom"><span class="ps-nom">${psEsc(psTitre(g.nom))}</span>${g.mail ? '<span class="ps-client ps-mailok" title="Adresse connue">mail</span>' : ''}
            <div class="ps-sub">${psEsc(fam)}<span class="ps-v"> · ${psEsc(psTitre(g.ville))}</span></div></td>
        <td class="ps-c-ville">${psEsc(psTitre(g.ville))}</td>
        <td class="ps-c-suivi num">${g.nbEtabs} <span class="ps-u">étab.</span></td>
        <td class="ps-c-places num">${g.capacite || '—'}</td>
        <td class="ps-c-tel ps-tel">${g.tel ? psEsc(psTel(g.tel)) : '—'}</td>
      </tr>`;
    }).join('');
    const vide = document.getElementById('psGempty');
    if (vide) vide.classList.toggle('hidden', r.length > 0);
  },

  // ---- Carte (Leaflet, mêmes tuiles que Trajets) -------------------------
  renderCarte() {
    if (typeof L === 'undefined') return;
    const el = document.getElementById('psMap');
    if (!el) return;
    if (!this._map) {
      this._map = L.map(el, { zoomControl: true, attributionControl: false, zoomSnap: 0.5 }).setView([43.75, 7.1], 10);
      this._map.zoomControl.setPosition('topright');
      this._couches = L.layerGroup().addTo(this._map);
    }
    this._appliquerTuiles();

    const parStatut = document.getElementById('psMapColor') && document.getElementById('psMapColor').value === 'statut';
    const fam = document.getElementById('psMapFam') ? document.getElementById('psMapFam').value : 'enfance-handicap';
    const cl = this.clients();
    const pts = this.toutes().filter((s) => s.lat != null && (fam === 'all' || s.famille === fam));

    this._couches.clearLayers();
    const bounds = [];
    // Les structures déjà facturées passent en VERT et sont dessinées en dernier,
    // pour rester lisibles au milieu d'un amas de points.
    const ordre = pts.slice().sort((a, x) => (cl[a.id] ? 1 : 0) - (cl[x.id] ? 1 : 0));
    ordre.forEach((s) => {
      const st = this.statutDe(s.id);
      const client = cl[s.id];
      const coul = client ? PS_CLIENT_VERT : (parStatut ? PS_COUL_STATUT[st] : (PS_COUL_FAM[s.famille] || '#9a96b8'));
      const m = L.circleMarker([s.lat, s.lon], {
        radius: s.capacite ? Math.min(13, 5 + Math.sqrt(s.capacite) / 2) : 5,
        color: client ? '#08533a' : '#fff',
        weight: client ? 2.5 : 1.5,
        fillColor: coul,
        fillOpacity: client ? 1 : 0.78,
      });
      m.bindTooltip(psTitre(s.nom) + ' — ' + psTitre(s.ville)
        + (client ? ' · déjà client (' + client.n + ' facture' + (client.n > 1 ? 's' : '') + ')' : ''),
        { direction: 'top' });
      m.on('click', () => CC.prospection.openFiche(s.id));
      m.addTo(this._couches);
      bounds.push([s.lat, s.lon]);
    });
    const nbClients = ordre.filter((s) => cl[s.id]).length;
    const leg = document.getElementById('psMapLegend');
    if (leg) {
      const clefs = parStatut
        ? PS_STATUTS.map(([k, l]) => [PS_COUL_STATUT[k], l])
        : (fam === 'all'
          ? Object.keys(PS_COUL_FAM).filter((f) => this.base().famLib[f]).map((f) => [PS_COUL_FAM[f], this.base().famLib[f]])
          : [[PS_COUL_FAM[fam], this.base().famLib[fam]]]);
      const vert = nbClients
        ? `<span class="ps-leg ps-leg-client"><i style="background:${PS_CLIENT_VERT}"></i>Déjà client (${nbClients})</span>`
        : '';
      leg.innerHTML = vert + clefs.map(([c, l]) => `<span class="ps-leg"><i style="background:${c}"></i>${psEsc(l)}</span>`).join('')
        + `<span class="ps-leg-note">${pts.length} points · taille = capacité · fond Esri</span>`;
    }
    setTimeout(() => {
      this._map.invalidateSize();
      if (bounds.length && !this._cadre) { this._map.fitBounds(bounds, { padding: [30, 30] }); this._cadre = true; }
    }, 60);
  },

  // Fond de carte accordé au thème. CARTO (l'ancien fond) exige désormais une clé
  // et tamponne « API KEY REQUIRED » en travers de chaque tuile : on est passé au
  // fond Canvas d'Esri, sans clé, volontairement neutre pour laisser voir les points.
  // Deux couches : le dessin, puis les noms de lieux par-dessus.
  _appliquerTuiles() {
    const map = this._map;
    if (!map || typeof L === 'undefined') return;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const style = dark ? 'Dark' : 'Light';
    if (this._tuilesStyle === style) return;
    if (this._tuiles) map.removeLayer(this._tuiles);
    if (this._etiquettes) map.removeLayer(this._etiquettes);
    const esri = (couche) => L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_' + style + '_Gray_' + couche + '/MapServer/tile/{z}/{y}/{x}',
      { maxNativeZoom: 16, maxZoom: 19, attribution: 'Esri' });
    this._tuiles = esri('Base').addTo(map);
    this._etiquettes = esri('Reference').addTo(map);
    this._tuilesStyle = style;
  },

  // ---- Modèles -----------------------------------------------------------
  renderModeles() {
    const mods = this.suivi().modeles;
    const liste = document.getElementById('psModList');
    if (!liste) return;
    liste.innerHTML = mods.map((m) => `<button type="button" class="ps-mod${m.id === this._modSel ? ' active' : ''}" data-mid="${psEsc(m.id)}">
      <span class="ps-mod-t">${psEsc(m.nom)}</span><span class="ps-mod-s">${psEsc((m.objet || '').slice(0, 44))}</span></button>`).join('');

    const m = mods.find((x) => x.id === this._modSel) || mods[0];
    this._modSel = m.id;
    document.getElementById('psModNom').value = m.nom;
    document.getElementById('psModObjet').value = m.objet;
    document.getElementById('psModCorps').value = m.corps;
    this.apercuModele();

    const r = this.suivi().reglages;
    ['moi', 'montel', 'monmail', 'monsite'].forEach((k) => {
      const el = document.getElementById('psSig_' + k);
      if (el) el.value = r[k] || '';
    });
  },

  apercuModele() {
    const m = this.suivi().modeles.find((x) => x.id === this._modSel);
    if (!m) return;
    const ex = this.base().parId[this._sel] || this.toutes().find((s) => s.famille === 'enfance-handicap');
    const el = document.getElementById('psModApercu');
    if (el) el.textContent = this.remplir(m.objet, ex) + '\n\n' + this.remplir(m.corps, ex);
  },

  remplir(texte, s) {
    const b = this.base();
    const f = (s && this.suivi().fiches[s.id]) || {};
    const g = s ? b.gParId[s.ej] : null;
    const pubs = s ? (s.publics || []).map((p) => (b.pubLib[p] || p).replace(/\s*\(.*\)/, '')).join(', ') : '';
    const r = this.suivi().reglages;
    const v = {
      structure: s ? psTitre(s.nom) : '',
      ville: s ? psTitre(s.ville) : '',
      categorie: s ? s.catLib : '',
      public: pubs || 'enfants et adolescents',
      capacite: s && s.capacite ? s.capacite + ' places' : '',
      gestionnaire: g ? psTitre(g.nom) : '',
      contact: f.contactNom || '',
      tel: s ? psTel(f.telDirect || s.tel) : '',
      moi: r.moi || (CC.state.settings && CC.state.settings.nom) || '[ton nom]',
      montel: r.montel || '[ton téléphone]',
      monmail: r.monmail || '[ton e-mail]',
      monsite: r.monsite || '',
      date: CC.util.frDate(CC.util.toISO(new Date())),
    };
    return String(texte || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  },

  // ---- Fiche (modale) ----------------------------------------------------
  openFiche(id) {
    const b = this.base();
    const s = b.parId[id];
    if (!s) return;
    this._sel = id;
    const f = this.fiche(id);
    const g = b.gParId[s.ej];
    const client = this.clients()[id];

    const lg = (dt, dd) => `<dt>${dt}</dt><dd>${dd}</dd>`;
    const coord = [];
    if (s.tel) coord.push(lg('Téléphone', `<a href="#" class="lnk" data-ext="tel:${psEsc(s.tel)}">${psEsc(psTel(s.tel))}</a>`));
    if (f.telDirect) coord.push(lg('Ligne directe', `<a href="#" class="lnk" data-ext="tel:${psEsc(f.telDirect)}">${psEsc(psTel(f.telDirect))}</a>`));
    const mailAff = f.mail || s.mail || '';
    if (mailAff) coord.push(lg('E-mail', `<a href="#" class="lnk" data-ext="mailto:${psEsc(mailAff)}">${psEsc(mailAff)}</a>`));
    if (f.site) coord.push(lg('Site', `<a href="#" class="lnk" data-ext="${psEsc(f.site)}">${psEsc(f.site.replace(/^https?:\/\//, ''))}</a>`));
    coord.push(lg('Adresse', psEsc([s.adresse, (s.cp || '') + ' ' + psTitre(s.ville)].filter((x) => String(x).trim()).join(', '))));

    const infos = [];
    infos.push(lg('Catégorie', psEsc(s.catLib)));
    infos.push(lg('Domaine', psEsc(b.famLib[s.famille] || s.famille)));
    if (s.capacite) infos.push(lg('Capacité', s.capacite + ' places' + (s.capaInternat ? ' · dont ' + s.capaInternat + ' en internat' : '')));
    if (s.ageMin != null || s.ageMax != null) infos.push(lg('Âges', (s.ageMin != null ? s.ageMin : '?') + ' – ' + (s.ageMax != null ? s.ageMax : '?') + ' ans'));
    if ((s.publics || []).length) infos.push(lg('Public', psEsc((s.publics || []).map((p) => b.pubLib[p] || p).join(' · '))));
    if ((s.modes || []).length) infos.push(lg('Accueil', psEsc(s.modes.join(', '))));
    if ((s.clienteles || []).length) infos.push(lg('Déficiences', psEsc(s.clienteles.join(' · '))));
    if (s.statut) infos.push(lg('Statut', psEsc(s.statut)));
    if (s.mission) infos.push(lg('Rôle', psEsc(s.mission)));
    if (s.source === 'annuaire') infos.push(lg('Source', 'Annuaire de l’administration'));
    else if (s.source === 'sirene') infos.push(lg('Source', 'Répertoire SIRENE — téléphone à chercher'));
    else if (!s.perso) infos.push(lg('N° FINESS', psEsc(s.id)));

    let blocG = '';
    if (g) {
      const l = [];
      l.push(lg('Nom', `<a href="#" class="lnk" data-gid="${psEsc(g.id)}">${psEsc(psTitre(g.nom))}</a>`));
      if (g.tel) l.push(lg('Téléphone', `<a href="#" class="lnk" data-ext="tel:${psEsc(g.tel)}">${psEsc(psTel(g.tel))}</a>`));
      if (g.mail) l.push(lg('E-mail', `<a href="#" class="lnk" data-ext="mailto:${psEsc(g.mail)}">${psEsc(g.mail)}</a>`));
      if (g.site) l.push(lg('Site', `<a href="#" class="lnk" data-ext="${psEsc(g.site)}">${psEsc(g.site.replace(/^https?:\/\//, ''))}</a>`));
      l.push(lg('Réseau', g.nbEtabs + ' établissement' + (g.nbEtabs > 1 ? 's' : '') + ' dans le 06'));
      blocG = `<div class="ps-bloc"><h4>Gestionnaire</h4><dl class="ps-dl">${l.join('')}</dl></div>`;
    }

    const blocClient = client ? `<div class="ps-bloc ps-bloc-client">
        <h4>Déjà dans ta compta</h4>
        <p class="ps-note">${client.n} facture${client.n > 1 ? 's' : ''} · ${CC.util.eur(client.ca)}
        ${client.dernier ? ' · dernière le ' + CC.util.frDate(client.dernier) : ''}<br>
        Libellé${client.noms.length > 1 ? 's' : ''} : ${psEsc(client.noms.join(', '))}</p></div>` : '';

    const histo = (f.histo || []).slice().reverse().map((h, i) =>
      `<div class="ps-h"><time>${CC.util.frDate(h.date)}</time><span>${psEsc(h.texte)}</span>
       <button type="button" class="ps-hx" data-histo="${f.histo.length - 1 - i}" title="Supprimer">×</button></div>`).join('');

    const rech = 'https://www.google.com/search?q=' + encodeURIComponent(s.nom + ' ' + s.ville + ' contact email');
    const maps = s.lat != null
      ? 'https://www.google.com/maps/search/?api=1&query=' + s.lat + ',' + s.lon
      : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(s.nom + ' ' + s.ville);

    document.getElementById('psFicheTitre').textContent = psTitre(s.nom);
    const ville = psTitre(s.ville);
    document.getElementById('psFicheSous').textContent =
      [s.catCourt, ville, s.secteur === ville ? '' : s.secteur].filter(Boolean).join(' · ');
    document.getElementById('psFicheCorps').innerHTML = `
      <div class="ps-cols">
        <div>
          <div class="ps-bloc"><h4>Coordonnées</h4><dl class="ps-dl">${coord.join('')}</dl>
            <div class="btn-row">
              <button type="button" class="btn btn-ghost" data-ext="${psEsc(rech)}">Chercher le contact</button>
              <button type="button" class="btn btn-ghost" data-ext="${psEsc(maps)}">Itinéraire</button>
            </div>
          </div>
          <div class="ps-bloc"><h4>Informations</h4><dl class="ps-dl">${infos.join('')}</dl></div>
          ${blocG}${blocClient}
        </div>
        <div>
          <div class="ps-bloc"><h4>Suivi</h4>
            <div class="form-grid ps-form">
              <div class="field"><label for="psF_statut">Statut</label>
                <select id="psF_statut" class="input">${PS_STATUTS.map(([k, l]) =>
                  `<option value="${k}"${f.statut === k ? ' selected' : ''}>${psEsc(l)}</option>`).join('')}</select></div>
              <div class="field"><label for="psF_relance">Relancer le</label>
                <input id="psF_relance" class="input" type="date" value="${psEsc(f.relanceLe || '')}"></div>
              <div class="field full"><label for="psF_contact">Interlocuteur</label>
                <input id="psF_contact" class="input" value="${psEsc(f.contactNom || '')}" placeholder="Nom, fonction"></div>
              <div class="field"><label for="psF_mail">E-mail</label>
                <input id="psF_mail" class="input" value="${psEsc(f.mail || '')}" placeholder="direction@…"></div>
              <div class="field"><label for="psF_tel">Ligne directe</label>
                <input id="psF_tel" class="input" value="${psEsc(f.telDirect || '')}"></div>
              <div class="field full"><label for="psF_site">Site</label>
                <input id="psF_site" class="input" value="${psEsc(f.site || '')}" placeholder="https://…"></div>
              <div class="field full"><label for="psF_notes">Notes</label>
                <textarea id="psF_notes" class="input" rows="3" placeholder="Ce qui s'est dit, le budget, la période…">${psEsc(f.notes || '')}</textarea></div>
            </div>
            <div class="btn-row">
              <button type="button" class="btn btn-ghost" data-rel="7">Relance +7 j</button>
              <button type="button" class="btn btn-ghost" data-rel="15">+15 j</button>
              <button type="button" class="btn btn-ghost" data-rel="30">+1 mois</button>
            </div>
          </div>

          <div class="ps-bloc"><h4>Journal</h4>
            <div class="ps-evt">
              <input id="psF_evt" class="input" placeholder="« appelé, rappeler en septembre »">
              <button type="button" class="btn btn-ghost" id="psF_evtOk">Ajouter</button>
            </div>
            ${histo || '<p class="ps-note">Aucun échange enregistré.</p>'}
          </div>

          <div class="ps-bloc"><h4>Écrire</h4>
            <select id="psF_modele" class="input">${this.suivi().modeles.map((m) =>
              `<option value="${psEsc(m.id)}">${psEsc(m.nom)}</option>`).join('')}</select>
            <div class="btn-row">
              <button type="button" class="btn btn-primary" id="psF_copier">Copier le message</button>
              <button type="button" class="btn btn-ghost" id="psF_mailto">Ouvrir dans le mail</button>
            </div>
          </div>
        </div>
      </div>`;

    document.getElementById('modalProspection').classList.remove('hidden');
    this._bindFiche(s, f);
  },

  closeFiche() {
    document.getElementById('modalProspection').classList.add('hidden');
    this.render();
  },

  _bindFiche(s, f) {
    const box = document.getElementById('psFicheCorps');
    const champ = (id, cle) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => { f[cle] = el.value; this._persist(); });
    };
    champ('psF_contact', 'contactNom');
    champ('psF_mail', 'mail');
    champ('psF_tel', 'telDirect');
    champ('psF_site', 'site');
    champ('psF_notes', 'notes');
    champ('psF_relance', 'relanceLe');

    document.getElementById('psF_statut').addEventListener('change', (e) => {
      f.statut = e.target.value;
      f.histo.push({ date: CC.util.toISO(new Date()), texte: 'Statut : ' + PS_STATUT_LIB[f.statut] });
      this._persist();
      this.openFiche(s.id);
    });

    box.querySelectorAll('[data-rel]').forEach((b) => b.addEventListener('click', () => {
      const d = CC.util.addDays(new Date(), +b.dataset.rel);
      f.relanceLe = CC.util.toISO(d);
      if (f.statut === 'aucun' || f.statut === 'contacte') f.statut = 'relance';
      f.histo.push({ date: CC.util.toISO(new Date()), texte: 'Relance programmée le ' + CC.util.frDate(f.relanceLe) });
      this._persist();
      this.openFiche(s.id);
    }));

    const ajout = () => {
      const el = document.getElementById('psF_evt');
      if (!el.value.trim()) return;
      f.histo.push({ date: CC.util.toISO(new Date()), texte: el.value.trim() });
      this._persist();
      this.openFiche(s.id);
    };
    document.getElementById('psF_evtOk').addEventListener('click', ajout);
    document.getElementById('psF_evt').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ajout(); } });

    box.querySelectorAll('[data-histo]').forEach((b) => b.addEventListener('click', () => {
      f.histo.splice(+b.dataset.histo, 1);
      this._persist();
      this.openFiche(s.id);
    }));

    const modele = () => this.suivi().modeles.find((m) => m.id === document.getElementById('psF_modele').value) || this.suivi().modeles[0];
    document.getElementById('psF_copier').addEventListener('click', () => {
      const m = modele();
      psCopier(this.remplir(m.objet, s) + '\n\n' + this.remplir(m.corps, s));
      CC.toast('Message copié', 'ok');
      f.histo.push({ date: CC.util.toISO(new Date()), texte: 'Message préparé : ' + m.nom });
      if (f.statut === 'aucun') f.statut = 'contacte';
      this._persist();
    });
    document.getElementById('psF_mailto').addEventListener('click', () => {
      const m = modele();
      psOuvrir('mailto:' + encodeURIComponent(f.mail || s.mail || '') +
        '?subject=' + encodeURIComponent(this.remplir(m.objet, s)) +
        '&body=' + encodeURIComponent(this.remplir(m.corps, s)));
      if (f.statut === 'aucun') f.statut = 'contacte';
      this._persist();
    });

    box.querySelectorAll('[data-ext]').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault();
      psOuvrir(b.dataset.ext);
    }));
    box.querySelectorAll('[data-gid]').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault();
      this.closeFiche();
      this._selG = b.dataset.gid;
      this.switchSub('gestionnaires');
      const el = document.getElementById('psGsearch');
      if (el) { el.value = (this.base().gParId[b.dataset.gid] || {}).nom || ''; this.renderGestionnaires(); }
    }));
  },

  // ---- Fiche gestionnaire ------------------------------------------------
  openGest(id) {
    const b = this.base();
    const g = b.gParId[id];
    if (!g) return;
    this._selG = id;
    const l = [];
    const lg = (dt, dd) => `<dt>${dt}</dt><dd>${dd}</dd>`;
    if (g.tel) l.push(lg('Téléphone', `<a href="#" class="lnk" data-ext="tel:${psEsc(g.tel)}">${psEsc(psTel(g.tel))}</a>`));
    if (g.mail) l.push(lg('E-mail', `<a href="#" class="lnk" data-ext="mailto:${psEsc(g.mail)}">${psEsc(g.mail)}</a>`));
    if (g.site) l.push(lg('Site', `<a href="#" class="lnk" data-ext="${psEsc(g.site)}">${psEsc(g.site.replace(/^https?:\/\//, ''))}</a>`));
    l.push(lg('Adresse', psEsc([g.adresse, (g.cp || '') + ' ' + psTitre(g.ville)].filter((x) => String(x).trim()).join(', '))));
    if (g.statut) l.push(lg('Statut', psEsc(g.statut)));
    if (g.capacite) l.push(lg('Capacité', g.capacite + ' places cumulées'));
    l.push(lg('N° FINESS', psEsc(g.id)));

    const cl = this.clients();
    const etabs = g.etabs.map((x) => b.parId[x]).filter(Boolean).sort((a, x) => a.nom.localeCompare(x.nom, 'fr'));

    document.getElementById('psFicheTitre').textContent = psTitre(g.nom);
    document.getElementById('psFicheSous').textContent = g.nbEtabs + ' établissement' + (g.nbEtabs > 1 ? 's' : '') + ' dans les Alpes-Maritimes';
    document.getElementById('psFicheCorps').innerHTML = `
      <div class="ps-cols">
        <div>
          <div class="ps-bloc"><h4>Siège</h4><dl class="ps-dl">${l.join('')}</dl>
            <div class="btn-row">
              <button type="button" class="btn btn-ghost" data-ext="https://www.google.com/search?q=${encodeURIComponent(g.nom + ' contact')}">Chercher sur le web</button>
              ${g.mail ? '<button type="button" class="btn btn-primary" id="psG_mail">Écrire au siège</button>' : ''}
            </div>
            ${g.sourceContact === 'web' ? '<p class="ps-note">Contact relevé sur le site de l’organisme — à confirmer avant envoi.</p>' : ''}
          </div>
        </div>
        <div>
          <div class="ps-bloc"><h4>Ses établissements</h4>
            ${etabs.map((s) => `<div class="ps-etab" data-str="${psEsc(s.id)}">
              <div class="ps-etab-main">
                <span class="ps-nom">${psEsc(psTitre(s.nom))}</span>${cl[s.id] ? '<span class="ps-client">client</span>' : ''}
                <div class="ps-sub">${psEsc(s.catCourt)} · ${psEsc(psTitre(s.ville))}${s.capacite ? ' · ' + s.capacite + ' pl.' : ''}</div>
              </div>
              <span class="stpill ps-${this.statutDe(s.id)}">${psEsc(PS_STATUT_LIB[this.statutDe(s.id)])}</span>
            </div>`).join('')}
          </div>
        </div>
      </div>`;
    document.getElementById('modalProspection').classList.remove('hidden');

    const box = document.getElementById('psFicheCorps');
    box.querySelectorAll('[data-ext]').forEach((b2) => b2.addEventListener('click', (e) => { e.preventDefault(); psOuvrir(b2.dataset.ext); }));
    box.querySelectorAll('[data-str]').forEach((b2) => b2.addEventListener('click', () => this.openFiche(b2.dataset.str)));
    const bm = document.getElementById('psG_mail');
    if (bm) bm.addEventListener('click', () => {
      const m = this.suivi().modeles.find((x) => x.id === 'm2') || this.suivi().modeles[0];
      const faux = { id: '__g', nom: '', ville: '', publics: [], ej: g.id };
      psOuvrir('mailto:' + encodeURIComponent(g.mail) +
        '?subject=' + encodeURIComponent(this.remplir(m.objet, faux)) +
        '&body=' + encodeURIComponent(this.remplir(m.corps, faux)));
    });
  },

  // ---- Sous-onglets ------------------------------------------------------
  switchSub(name) {
    this._sub = name;
    document.querySelectorAll('#tab-reseau .subtab').forEach((b) => b.classList.toggle('active', b.dataset.psub === name));
    document.querySelectorAll('#tab-reseau .subpanel').forEach((p) => p.classList.toggle('active', p.id === 'psub-' + name));
    this.render();
  },

  // ---- Export CSV --------------------------------------------------------
  exportCsv() {
    const b = this.base();
    const r = this.filtrer();
    const cl = this.clients();
    const col = ['Nom', 'Catégorie', 'Domaine', 'Publics', 'Capacité', 'Adresse', 'CP', 'Ville', 'Secteur',
      'Téléphone', 'E-mail', 'Gestionnaire', 'Tél. gestionnaire', 'Mail gestionnaire',
      'Statut', 'Interlocuteur', 'Relance', 'Déjà client', 'Notes', 'FINESS'];
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lignes = [col.map(q).join(';')];
    r.forEach((s) => {
      const f = this.suivi().fiches[s.id] || {};
      const g = b.gParId[s.ej] || {};
      lignes.push([
        psTitre(s.nom), s.catLib, b.famLib[s.famille] || s.famille,
        (s.publics || []).map((p) => b.pubLib[p] || p).join(' / '),
        s.capacite || '', s.adresse, s.cp, psTitre(s.ville), s.secteur,
        psTel(f.telDirect || s.tel), f.mail || '',
        psTitre(g.nom || ''), psTel(g.tel || ''), g.mail || '',
        PS_STATUT_LIB[f.statut || 'aucun'], f.contactNom || '', f.relanceLe || '',
        cl[s.id] ? 'oui' : '', (f.notes || '').replace(/\r?\n/g, ' · '), s.perso ? '' : s.id,
      ].map(q).join(';'));
    });
    const contenu = '﻿' + lignes.join('\r\n');
    const nom = 'demarchage-' + CC.util.toISO(new Date()) + '.csv';
    if (window.api && window.api.exportFile) {
      window.api.exportFile(nom, contenu).then(() => CC.toast(r.length + ' lignes exportées', 'ok'));
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([contenu], { type: 'text/csv;charset=utf-8' }));
    a.download = nom;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    CC.toast(r.length + ' lignes exportées', 'ok');
  },

  // ---- Branchements ------------------------------------------------------
  bind() {
    if (this._bound) return;
    const panel = document.getElementById('tab-reseau');
    if (!panel) return;
    this._bound = true;

    panel.querySelectorAll('.subtab[data-psub]').forEach((b) =>
      b.addEventListener('click', () => this.switchSub(b.dataset.psub)));

    const maj = () => { this._filtres.texte = document.getElementById('psSearch').value; this.renderStructures(); };
    let t = null;
    document.getElementById('psSearch').addEventListener('input', () => { clearTimeout(t); t = setTimeout(maj, 130); });
    [['psFamille', 'famille'], ['psPublic', 'public'], ['psSecteur', 'secteur'],
     ['psStatut', 'statut'], ['psRelation', 'relation']].forEach(([id, cle]) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => { this._filtres[cle] = el.value; this.renderStructures(); });
    });
    document.getElementById('psTri').addEventListener('change', (e) => { this._tri = e.target.value; this.renderStructures(); });
    document.getElementById('psExport').addEventListener('click', () => this.exportCsv());

    document.getElementById('psBody').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr) this.openFiche(tr.dataset.id);
    });
    document.getElementById('psGbody').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-gid]');
      if (tr) this.openGest(tr.dataset.gid);
    });
    ['psGsearch'].forEach((id) => document.getElementById(id).addEventListener('input', () => this.renderGestionnaires()));
    ['psGmulti', 'psGcoeur'].forEach((id) => document.getElementById(id).addEventListener('change', () => this.renderGestionnaires()));

    ['psMapColor', 'psMapFam'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => this.renderCarte());
    });

    // Modèles
    document.getElementById('psModList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mid]');
      if (b) { this._modSel = b.dataset.mid; this.renderModeles(); }
    });
    const majMod = () => {
      const m = this.suivi().modeles.find((x) => x.id === this._modSel);
      if (!m) return;
      m.nom = document.getElementById('psModNom').value;
      m.objet = document.getElementById('psModObjet').value;
      m.corps = document.getElementById('psModCorps').value;
      this.apercuModele();
      this._persist();
    };
    ['psModNom', 'psModObjet', 'psModCorps'].forEach((id) => document.getElementById(id).addEventListener('input', majMod));
    document.getElementById('psModNom').addEventListener('change', () => this.renderModeles());
    document.getElementById('psModNouveau').addEventListener('click', () => {
      const id = 'm' + Date.now().toString(36);
      this.suivi().modeles.push({ id, nom: 'Nouveau modèle', objet: '{structure}', corps: 'Bonjour,\n\n' });
      this._modSel = id;
      this._persist();
      this.renderModeles();
    });
    document.getElementById('psModSuppr').addEventListener('click', () => {
      const mods = this.suivi().modeles;
      if (mods.length <= 1) { CC.toast('Il faut garder au moins un modèle', 'err'); return; }
      this.suivi().modeles = mods.filter((x) => x.id !== this._modSel);
      this._modSel = this.suivi().modeles[0].id;
      this._persist();
      this.renderModeles();
    });
    document.getElementById('psModDefaut').addEventListener('click', () => {
      this.suivi().modeles = JSON.parse(JSON.stringify(PS_MODELES));
      this._modSel = 'm1';
      this._persist();
      this.renderModeles();
      CC.toast('Modèles d’origine restaurés', 'ok');
    });
    document.getElementById('psModCopier').addEventListener('click', () => {
      psCopier(document.getElementById('psModApercu').textContent);
      CC.toast('Copié', 'ok');
    });
    ['moi', 'montel', 'monmail', 'monsite'].forEach((k) => {
      const el = document.getElementById('psSig_' + k);
      if (el) el.addEventListener('input', () => {
        this.suivi().reglages[k] = el.value;
        this.apercuModele();
        this._persist();
      });
    });

    // Modale
    document.getElementById('psFicheX').addEventListener('click', () => this.closeFiche());
    document.getElementById('modalProspection').addEventListener('click', (e) => {
      if (e.target.id === 'modalProspection') this.closeFiche();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !document.getElementById('modalProspection').classList.contains('hidden')) this.closeFiche();
    });

  },
};

// ---- Petits utilitaires locaux ---------------------------------------------
function psEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function psNorm(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
function psTel(t) {
  const d = String(t || '').replace(/\D/g, '');
  return d.length === 10 ? d.replace(/(\d\d)(?=\d)/g, '$1 ').trim() : (t || '');
}
// FINESS écrit tout en capitales : on rend ça lisible sans casser les sigles.
const PS_SIGLES = /\b(Ime|Sessad|Itep|Iem|Esat|Mas|Fam|Eam|Eanm|Camsp|Cmpp|Cmp|Mecs|Ehpad|Chrs|Savs|Samsah|Ugecam|Adsea|Adapei|Afpjr|Apreh|Pep|Apf|Apajh|Alc|Psp|Lva|Cada|Act|Sos|Ch|Chu|Ccas|Cias|Bapu|Ueros|Mdph|Clic|Dac|Ssiad|Saad|Cph|Fjt|Sas|Mjc|Pij|Bij|Ufcv|Ifac|Evs|Ass|Aj)\b/g;
function psTitre(t) {
  return String(t || '').trim().toLowerCase()
    .replace(/([a-zà-ÿ0-9])([a-zà-ÿ0-9']*)/g, (m, a, b) => a.toUpperCase() + b)
    .replace(/\b(De|Du|Des|La|Le|Les|Et|Au|Aux|Pour|Sur|En)\b/g, (w) => w.toLowerCase())
    .replace(/^./, (c) => c.toUpperCase())
    .replace(PS_SIGLES, (w) => w.toUpperCase());
}
function psOuvrir(url) {
  if (!/^(https?|mailto|tel):/.test(url)) return;
  if (window.api && window.api.openUrl) window.api.openUrl(url);
  else window.open(url, '_blank', 'noopener');
}
function psCopier(txt) {
  try { navigator.clipboard.writeText(txt); }
  catch (_) {
    const ta = document.createElement('textarea');
    ta.value = txt;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (__) {}
    ta.remove();
  }
}
