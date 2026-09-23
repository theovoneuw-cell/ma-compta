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

// Ordre d'avancement : un raccourci du journal ne fait jamais reculer une
// démarche (« Appelé » ne ramène pas un rendez-vous à « Contacté »).
const PS_RANG = { aucun: 0, contacte: 1, relance: 2, rdv: 3, devis: 4, gagne: 5, refus: 6 };
// Raccourcis du journal : [texte, statut atteint].
const PS_RAPIDES = [
  ['Appelé', 'contacte'], ['Message laissé', 'contacte'], ['Mail envoyé', 'contacte'],
  ['RDV fixé', 'rdv'], ['Devis envoyé', 'devis'], ['Intervention actée', 'gagne'], ['Pas intéressé', 'refus'],
];
// Sigles de TYPE d'établissement : deux noms ne désignent la même structure que
// s'ils ont le même type (« IME Les Chênes » n'est pas « EHPAD Les Chênes »).
const PS_TYPES = new Set(['IME', 'SESSAD', 'ITEP', 'IEM', 'ESAT', 'MAS', 'FAM', 'EAM', 'EANM', 'CAMSP', 'CMPP', 'CMP',
  'MECS', 'EHPAD', 'CHRS', 'SAVS', 'SAMSAH', 'SAAD', 'SSIAD', 'LVA', 'CADA', 'FJT', 'MJC', 'BAPU', 'HJ', 'CH', 'CHU',
  'HOP', 'SAS', 'CPH', 'ACT', 'IFMEA', 'GCS', 'USLD', 'SSR', 'SAJ', 'FOYER', 'EJ', 'SIVOM', 'CCAS', 'CIAS', 'CRECHE']);
// Mots trop courants pour identifier une structure.
const PS_VIDES = new Set(['ASSO', 'ASSOCIATION', 'FONDATION', 'LE', 'LA', 'LES', 'DE', 'DU', 'DES', 'ET', 'CENTRE',
  'MAISON', 'SERVICE', 'ETABLISSEMENT', 'SAINT', 'STE', 'ST', 'DR', 'UNITE', 'SECTEUR', 'SIEGE', 'VILLE', 'MAIRIE',
  'COMMUNE', 'ESPACE', 'JEUNES', 'JEUNESSE', 'NICE', 'CANNES', 'ANTIBES', 'GRASSE', 'MENTON', 'CEDEX']);
// Activité d'un client de la compta -> domaine Réseau, pour l'ajout de tes clients.
const PS_FAM_DE_CAT = {
  'Ateliers Musiques Urbaines': 'animation-jeunesse', 'Cours et Enseignement': 'formation',
  'AMU Social': 'social-insertion', 'Associatif / Fondations': 'social-insertion', 'Autre': 'autre',
};

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
  _sub: 'suivi',
  _sel: null,
  _selG: null,
  _modSel: 'm1',
  _saveT: null,
  _retryT: null,
  _clients: null,
  _sync: '',          // 'drive' | 'local' | '' (inconnu)
  _touche: false,     // modifié ici avant l'arrivée de Drive
  _tri: 'nom',
  _filtres: { texte: '', famille: 'enfance-handicap', public: 'all', secteur: 'all', statut: 'all', relation: 'all' },
  _LS: 'macompta-reseau-suivi',

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

  // Structures de la base + celles que tu as ajoutées (tes clients hors FINESS).
  toutes() {
    const b = this.base();
    if (!b) return [];
    const perso = Object.values(this.suivi().perso || {});
    perso.forEach((p) => { b.parId[p.id] = p; });
    return perso.length ? b.structures.concat(perso) : b.structures;
  },

  // ---- Suivi : Drive + copie sur l'appareil --------------------------------
  // Le suivi vivait seulement sur Drive : hors connexion, une modification
  // était perdue sans un mot. Il est désormais écrit d'abord sur l'appareil
  // (localStorage), puis envoyé sur Drive ; au chargement, la version la plus
  // récente (horodatage `majLe`) gagne, et celle d'ici repart sur Drive si
  // elle est plus fraîche.
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
  _normaliser(s) {
    return {
      fiches: s.fiches || {}, perso: s.perso || {},
      modeles: Array.isArray(s.modeles) && s.modeles.length ? s.modeles : null,
      reglages: s.reglages || {}, majLe: s.majLe || '',
    };
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

  _vide(f) {
    if (!f) return true;
    if (f.statut && f.statut !== 'aucun') return false;
    if (f.histo && f.histo.length) return false;
    if (f.client) return false;
    return !['contactNom', 'mail', 'telDirect', 'site', 'notes', 'relanceLe'].some((k) => String(f[k] || '').trim());
  },
  _local() {
    try { const t = localStorage.getItem(this._LS); return t ? JSON.parse(t) : null; } catch (_) { return null; }
  },
  _ecrireLocal(p) {
    try { localStorage.setItem(this._LS, JSON.stringify(p)); } catch (_) {}
  },
  _persist() {
    this._touche = true;
    this._clients = null;
    const p = this.suivi();
    p.majLe = new Date().toISOString();
    this._ecrireLocal(p);        // tout de suite : rien ne se perd si l'app se ferme
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this._envoyer(), 600);
  },
  async _envoyer() {
    const p = this.suivi();
    Object.keys(p.fiches).forEach((id) => { if (this._vide(p.fiches[id])) delete p.fiches[id]; });
    this._ecrireLocal(p);
    let ok = false;
    try {
      if (window.api && window.api.prospection) {
        const r = await window.api.prospection.save(p);
        ok = !!(r && r.ok);
      }
    } catch (_) { ok = false; }
    this._sync = ok ? 'drive' : 'local';
    clearTimeout(this._retryT);
    if (!ok) this._retryT = setTimeout(() => this._envoyer(), 60000);
    this._majSync();
  },
  async pull() {
    // 1) La copie de l'appareil, tout de suite (et hors connexion).
    const loc = this._local();
    const cur = CC.state.prospection;
    const vide = !cur || !cur.fiches || (!Object.keys(cur.fiches).length && !Object.keys(cur.perso || {}).length);
    if (loc && vide) { CC.state.prospection = this._normaliser(loc); this.suivi(); this._clients = null; }
    // 2) Drive : on garde la plus récente des deux versions.
    if (!(window.api && window.api.prospection)) return;
    let r;
    try { r = await window.api.prospection.load(); } catch (_) { r = null; }
    if (!r || !r.exists || !r.suivi) {
      // Drive injoignable (ou fichier absent) : on ne pousse RIEN ici, pour ne
      // jamais écraser sur Drive une version plus récente faite ailleurs.
      this._sync = (r && r.offline) || !r ? 'local' : this._sync;
      this._majSync();
      return;
    }
    const d = r.suivi;
    const ici = CC.state.prospection || {};
    const majIci = ici.majLe || '';
    const majDrive = d.majLe || '';
    if (majIci && majIci > majDrive) {
      this._envoyer();                            // modifié ici hors ligne : on renvoie
    } else if (!this._touche || !majIci) {
      CC.state.prospection = this._normaliser(d);
      this.suivi();
      this._ecrireLocal(CC.state.prospection);
      this._clients = null;
      this._sync = 'drive';
    }
    this._pulled = true;
    this._majSync();
    const tab = document.getElementById('tab-reseau');
    if (tab && tab.classList.contains('active')) this.render();
    // L'accueil affiche les relances dues : il a besoin du suivi arrivé de Drive.
    try { if (CC.renderToday) CC.renderToday(); } catch (_) {}
  },
  _majSync() {
    const el = document.getElementById('psSync');
    if (!el) return;
    const n = Object.keys(this.suivi().fiches).length + Object.keys(this.suivi().perso).length;
    if (this._sync === 'drive') { el.textContent = `Suivi enregistré sur Drive · ${n} fiche${n > 1 ? 's' : ''}`; el.className = 'ps-sync ok'; }
    else if (this._sync === 'local') { el.textContent = 'Drive injoignable : ton suivi est gardé sur cet appareil et repartira sur Drive à la prochaine connexion.'; el.className = 'ps-sync warn'; }
    else { el.textContent = `${n} fiche${n > 1 ? 's' : ''} de suivi`; el.className = 'ps-sync'; }
  },

  // ---- Ton point de départ (distances) -----------------------------------
  // Géocodé une fois depuis l'adresse de départ des Paramètres (Trajets), puis
  // gardé dans les réglages du suivi. Distance à vol d'oiseau : un ordre de
  // grandeur pour trier, pas un itinéraire.
  maison() {
    const h = this.suivi().reglages.home;
    const adr = (CC.state.settings && CC.state.settings.adresseDepart) || '';
    if (h && h.lat != null && h.src === adr) return h;
    if (adr && !this._geoEnCours && window.api && window.api.routes && window.api.routes.geocode) {
      this._geoEnCours = true;
      Promise.resolve(window.api.routes.geocode(adr)).then((r) => {
        const x = r && r.results && r.results[0];
        if (x && x.lat != null) {
          this.suivi().reglages.home = { lat: x.lat, lon: x.lon, src: adr };
          this._persist();
          this.render();
        }
      }).catch(() => {}).finally(() => { this._geoEnCours = false; });
    }
    return null;
  },
  distance(s) {
    const h = this.maison();
    if (!h || !s || s.lat == null) return null;
    const R = 6371, rad = (x) => x * Math.PI / 180;
    const dLat = rad(s.lat - h.lat), dLon = rad(s.lon - h.lon);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(h.lat)) * Math.cos(rad(s.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  },

  // ---- Croisement avec tes clients -----------------------------------------
  // Une structure est « ton client » :
  //  1. si tu l'as reliée à la main (fiche.client), ou si tu l'as ajoutée
  //     depuis tes clients ;
  //  2. sinon, automatiquement, si TOUS les mots significatifs du client se
  //     retrouvent dans son nom, avec le MÊME type d'établissement (IME, SESSAD,
  //     EHPAD…) et, quand la fiche client a une ville, dans la même ville.
  // L'ancienne règle (mots dans un sens OU dans l'autre, sans type) prenait
  // l'EHPAD Les Chênes pour l'IME, ou un SAAD pour le SIVOM.
  clients() {
    if (this._clients) return this._clients;
    const idx = {};
    const liste = (CC.clients && CC.clients.liste) ? CC.clients.liste() : [];
    const parCle = new Map(liste.map((c) => [c.cle, c]));
    const trouve = (nom) => {
      if (!nom) return null;
      return liste.find((c) => c.nom === nom) || parCle.get(CC.util.clientKey(nom)) || null;
    };
    const lier = (s, c, mode) => {
      idx[s.id] = { nom: c.nom, cle: c.cle, n: c.n, ca: c.total, dernier: c.derniere, fiche: c.fiche, mode, noms: [c.nom] };
    };
    const fiches = this.suivi().fiches;
    const toutes = this.toutes();
    toutes.forEach((s) => {
      const f = fiches[s.id];
      const lien = (f && f.client) || s.client;
      if (lien && lien !== '__non__') { const c = trouve(lien); if (c) lier(s, c, 'manuel'); }
    });
    const ms = new Map(toutes.map((s) => [s.id, psMots(s.nom)]));
    liste.forEach((c) => {
      if (!c.n) return;
      const cm = psMots(c.nom);
      if (!cm.mots.length) return;
      const villeC = c.fiche && c.fiche.ville ? psNorm(c.fiche.ville).replace(/[^a-z]/g, '') : '';
      const trouvees = toutes.filter((s) => {
        if (idx[s.id]) return false;
        const f = fiches[s.id];
        if (f && f.client === '__non__') return false;
        const sm = ms.get(s.id);
        if (!cm.mots.every((w) => sm.mots.includes(w))) return false;
        // Un seul mot distinctif (« Lenval », « Magnan ») ne suffit pas : il
        // faut alors que les deux noms se recouvrent dans les deux sens.
        if (cm.mots.length < 2 && !sm.mots.every((w) => cm.mots.includes(w))) return false;
        if (!psMemeType(cm.types, sm.types)) return false;
        if (villeC && s.ville && psNorm(s.ville).replace(/[^a-z]/g, '').indexOf(villeC) !== 0) return false;
        return true;
      });
      // Plus de deux candidates : ambigu, on laisse relier à la main.
      if (trouvees.length <= 2) trouvees.forEach((s) => lier(s, c, 'auto'));
    });
    this._clients = idx;
    return idx;
  },
  // Structures reliées à un client de la compta (par sa clé de client).
  structuresDuClient(cle) {
    const cl = this.clients();
    return Object.keys(cl).filter((id) => cl[id].cle === cle).map((id) => this.base().parId[id]).filter(Boolean);
  },

  titre(t) { return psTitre(t); },

  // ---- Rendu ------------------------------------------------------------
  render() {
    const b = this.base();
    if (!b) return;
    this._clients = null;
    if (!this._pulled) { this._pulled = true; this.pull(); }
    this._remplirFiltres();
    this._majSync();
    if (this._sub === 'suivi') this.renderSuivi();
    else if (this._sub === 'structures') this.renderStructures();
    else if (this._sub === 'gestionnaires') this.renderGestionnaires();
    else if (this._sub === 'carte') this.renderCarte();
    else if (this._sub === 'modeles') this.renderModeles();
  },

  // Listes déroulantes (reconstruites : tes structures ajoutées y comptent).
  _remplirFiltres() {
    const b = this.base();
    const cnt = {};
    this.toutes().forEach((s) => { cnt[s.famille] = (cnt[s.famille] || 0) + 1; });
    const ordre = ['enfance-handicap', 'animation-jeunesse', 'adultes-handicap', 'protection-enfance', 'sante-mentale',
      'social-insertion', 'personnes-agees', 'ressources', 'sanitaire', 'formation', 'domicile', 'autre'];
    const optsFam = (sel) => `<option value="all">Tous les domaines (${this.toutes().length})</option>` + ordre.filter((f) => cnt[f]).map((f) =>
      `<option value="${f}"${f === sel ? ' selected' : ''}>${psEsc(b.famLib[f] || f)} (${cnt[f]})</option>`).join('');
    const fam = document.getElementById('psFamille');
    if (fam) fam.innerHTML = optsFam(this._filtres.famille);
    const mf = document.getElementById('psMapFam');
    if (mf) mf.innerHTML = optsFam(mf.value || 'enfance-handicap');
    if (this._filtresRemplis) return;
    this._filtresRemplis = true;
    const sel = (id, opts) => { const el = document.getElementById(id); if (el) el.insertAdjacentHTML('beforeend', opts); };
    sel('psPublic', Object.entries(b.pubLib).map(([k, v]) => `<option value="${k}">${psEsc(v)}</option>`).join(''));
    sel('psSecteur', b.secteurs.map((s) => `<option value="${psEsc(s)}">${psEsc(s)}</option>`).join(''));
    sel('psStatut', PS_STATUTS.map(([k, l]) => `<option value="${k}">${psEsc(l)}</option>`).join(''));
  },

  // ---- Suivi : le tableau de bord du démarchage ----------------------------
  relances() {
    const auj = CC.util.toISO(new Date());
    const dans7 = CC.util.toISO(CC.util.addDays(new Date(), 7));
    const out = [];
    Object.entries(this.suivi().fiches).forEach(([id, f]) => {
      if (!f.relanceLe || f.statut === 'refus') return;
      const s = this.base().parId[id];
      if (!s) return;
      if (f.relanceLe <= dans7) out.push({ s, f, due: f.relanceLe <= auj, retard: CC.util.daysBetween(CC.util.parseDate(f.relanceLe), CC.util.parseDate(auj)) });
    });
    return out.sort((a, x) => a.f.relanceLe.localeCompare(x.f.relanceLe));
  },

  renderSuivi() {
    const cl = this.clients();
    const fiches = this.suivi().fiches;
    const par = {};
    this.toutes().forEach((s) => { const st = this.statutDe(s.id); (par[st] = par[st] || []).push(s); });
    const n = (k) => (par[k] || []).length;
    const rel = this.relances();
    const dues = rel.filter((r) => r.due);
    const contactees = n('contacte') + n('relance') + n('rdv') + n('devis') + n('gagne') + n('refus');
    const reponses = n('rdv') + n('devis') + n('gagne') + n('refus');
    const kpi = document.getElementById('psKpis');
    if (kpi) kpi.innerHTML = [
      ['En cours', n('contacte') + n('relance') + n('rdv') + n('devis'), 'démarches ouvertes', ''],
      ['À relancer', dues.length, dues.length ? 'aujourd’hui ou en retard' : 'rien en retard', dues.length ? 'amber' : ''],
      ['RDV & devis', n('rdv') + n('devis'), 'en discussion', ''],
      ['Actées', n('gagne'), 'interventions / clients', 'green'],
      ['Taux de réponse', contactees ? Math.round(reponses / contactees * 100) + ' %' : '—', contactees ? reponses + ' sur ' + contactees + ' contactées' : 'aucune démarche', ''],
    ].map(([l, v, h, cls]) => `<div class="kpi ${cls}"><div class="label">${l}</div><div class="value">${v}</div><div class="hint">${h}</div></div>`).join('');

    // À relancer
    const box = document.getElementById('psAFaire');
    if (box) {
      if (!rel.length) {
        box.innerHTML = '<p class="ps-vide">Aucune relance prévue dans les 7 jours. Programme-les depuis une fiche (boutons « +7 j », « +15 j »…).</p>';
      } else {
        box.innerHTML = rel.map(({ s, f, due, retard }) => {
          const quand = retard > 0 ? `<span class="ps-quand late">en retard de ${retard} j</span>`
            : (retard === 0 ? '<span class="ps-quand today">aujourd’hui</span>'
              : `<span class="ps-quand">${CC.util.frDate(f.relanceLe)}</span>`);
          const tel = f.telDirect || s.tel;
          return `<div class="ps-todo${due ? ' due' : ''}" data-id="${psEsc(s.id)}">
            <div class="ps-todo-main" data-ouvrir="${psEsc(s.id)}">
              <span class="ps-nom">${psEsc(psTitre(s.nom))}</span>${cl[s.id] ? '<span class="ps-client">client</span>' : ''}
              <div class="ps-sub">${psEsc(s.catCourt || '')}${s.ville ? ' · ' + psEsc(psTitre(s.ville)) : ''}${f.contactNom ? ' · ' + psEsc(f.contactNom) : ''}</div>
            </div>
            <div class="ps-todo-etat"><span class="stpill ps-${psEsc(f.statut || 'aucun')}">${psEsc(PS_STATUT_LIB[f.statut || 'aucun'])}</span>${quand}</div>
            <div class="ps-todo-act">
              ${tel ? `<button type="button" class="mini-btn" data-appel="${psEsc(tel)}" title="Appeler ${psEsc(psTel(tel))}">Appeler</button>` : ''}
              <button type="button" class="mini-btn" data-ecrire="${psEsc(s.id)}">Écrire</button>
              <button type="button" class="mini-btn" data-reporter="${psEsc(s.id)}" title="Reporter d'une semaine">+7 j</button>
              <button type="button" class="mini-btn go-green" data-fait="${psEsc(s.id)}" title="Relance faite">Fait ✓</button>
            </div>
          </div>`;
        }).join('');
      }
    }

    // Démarches en cours, par étape
    const pipe = document.getElementById('psPipeline');
    if (pipe) {
      const cols = [['contacte', 'Contacté'], ['relance', 'À relancer'], ['rdv', 'Rendez-vous'], ['devis', 'Devis envoyé'], ['gagne', 'Actée']];
      pipe.innerHTML = cols.map(([k, l]) => {
        const items = (par[k] || []).slice().sort((a, x) => {
          const da = ((fiches[a.id] || {}).histo || []).slice(-1)[0], dx = ((fiches[x.id] || {}).histo || []).slice(-1)[0];
          return ((dx && dx.date) || '').localeCompare((da && da.date) || '');
        });
        return `<div class="ps-col">
          <div class="ps-col-t"><span class="stpill ps-${k}">${l}</span><span class="ps-col-n">${items.length}</span></div>
          ${items.slice(0, 12).map((s) => {
            const f = fiches[s.id] || {};
            const der = (f.histo || []).slice(-1)[0];
            return `<button type="button" class="ps-carte" data-ouvrir="${psEsc(s.id)}">
              <span class="ps-nom">${psEsc(psTitre(s.nom))}</span>
              <span class="ps-sub">${psEsc(psTitre(s.ville || ''))}${f.relanceLe ? ' · relance ' + CC.util.frDate(f.relanceLe) : ''}</span>
              ${der ? `<span class="ps-carte-der">${CC.util.frDate(der.date)} — ${psEsc(der.texte.slice(0, 60))}</span>` : ''}
            </button>`;
          }).join('') || '<p class="ps-col-vide">—</p>'}
          ${items.length > 12 ? `<p class="ps-col-vide">+ ${items.length - 12} autre(s) : filtre « ${l} » dans Structures.</p>` : ''}
        </div>`;
      }).join('');
    }

    // Clients à recontacter : plus rien de facturé ni de prévu depuis 4 mois.
    const fid = document.getElementById('psFideles');
    if (fid && CC.clients) {
      const limite = CC.util.toISO(CC.util.addDays(new Date(), -120));
      const liste = CC.clients.liste().filter((c) => c.n && c.categorie !== 'Mixage/Mastering'
        && !(c.attente + c.retard + c.prevu) && c.derniere && c.derniere < limite)
        .sort((a, x) => x.total - a.total).slice(0, 10);
      fid.innerHTML = liste.length ? liste.map((c) => {
        const mois = Math.max(4, Math.round(CC.util.daysBetween(CC.util.parseDate(c.derniere), new Date()) / 30.4));
        const st = this.structuresDuClient(c.cle)[0];
        return `<div class="ps-fid">
          <div class="ps-fid-main"><span class="ps-nom">${psEsc(c.nom)}</span>
            <div class="ps-sub">${psEsc(c.categorie || '')} · ${c.n} facture${c.n > 1 ? 's' : ''} · ${CC.util.eur0(c.total)}</div></div>
          <span class="ps-quand">dernière il y a ${mois} mois</span>
          <button type="button" class="mini-btn" ${st ? `data-ouvrir="${psEsc(st.id)}"` : `data-client="${psEsc(c.cle)}"`}>${st ? 'Fiche' : 'Fiche client'}</button>
        </div>`;
      }).join('') : '<p class="ps-vide">Tous tes clients ont eu une facture ou une vente prévue ces 4 derniers mois.</p>';
    }
  },

  // ---- Structures --------------------------------------------------------
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
      if (F.relation === 'perso' && !s.perso) return false;
      if (q.length) {
        const f = this.suivi().fiches[s.id] || {};
        const blob = psNorm([s.nom, s.ville, s.catLib, s.catCourt, s.adresse, s.cp, s.secteur,
          (this.base().gParId[s.ej] || {}).nom, f.contactNom, f.notes, cl[s.id] && cl[s.id].nom].filter(Boolean).join(' '));
        if (!q.every((t) => blob.includes(t))) return false;
      }
      return true;
    });
    const parNom = (a, b) => a.nom.localeCompare(b.nom, 'fr');
    if (this._tri === 'ville') r.sort((a, b) => (a.ville || '').localeCompare(b.ville || '', 'fr') || parNom(a, b));
    else if (this._tri === 'capacite') r.sort((a, b) => (b.capacite || 0) - (a.capacite || 0) || parNom(a, b));
    else if (this._tri === 'distance') r.sort((a, b) => (this.distance(a) ?? 1e9) - (this.distance(b) ?? 1e9) || parNom(a, b));
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
    const home = this.maison();

    const sum = document.getElementById('psSummary');
    if (sum) sum.textContent = r.length + ' structure' + (r.length > 1 ? 's' : '') + ' sur ' + this.toutes().length;
    const optDist = document.querySelector('#psTri option[value="distance"]');
    if (optDist) optDist.disabled = !home;

    const body = document.getElementById('psBody');
    if (!body) return;
    body.innerHTML = r.slice(0, 400).map((s) => {
      const st = this.statutDe(s.id);
      const f = this.suivi().fiches[s.id] || {};
      const client = cl[s.id];
      const pubs = (s.publics || []).map((p) => (b.pubLib[p] || p).replace(/\s*\(.*\)/, '')).join(', ');
      const rel = f.relanceLe
        ? `<span class="ps-rel${f.relanceLe <= auj ? ' late' : ''}">${CC.util.frDate(f.relanceLe)}</span>` : '';
      const d = this.distance(s);
      const km = d != null ? `<span class="ps-km">${d < 10 ? d.toFixed(1).replace('.', ',') : Math.round(d)} km</span>` : '';
      return `<tr data-id="${psEsc(s.id)}">
        <td class="ps-c-nom"><span class="ps-nom">${psEsc(psTitre(s.nom))}</span>${client ? `<span class="ps-client" title="${psEsc(client.nom)} · ${client.n} facture(s)">client</span>` : ''}${s.perso ? '<span class="ps-client ps-perso" title="Ajoutée par toi">ajoutée</span>' : ''}
            <div class="ps-sub">${psEsc(s.catCourt || '')}<span class="ps-v"> · ${psEsc(psTitre(s.ville || ''))}</span></div></td>
        <td class="ps-c-ville">${psEsc(psTitre(s.ville || ''))}<div class="ps-sub">${km || psEsc(s.secteur || '')}</div></td>
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
    const cl = this.clients();
    const q = psNorm(document.getElementById('psGsearch') ? document.getElementById('psGsearch').value : '');
    const coeur = document.getElementById('psGcoeur') && document.getElementById('psGcoeur').checked;
    const plusieurs = document.getElementById('psGmulti') && document.getElementById('psGmulti').checked;

    let r = b.gestionnaires.filter((g) => {
      if (plusieurs && g.nbEtabs < 2) return false;
      if (coeur && !g.familles['enfance-handicap']) return false;
      if (q && !psNorm(g.nom + ' ' + g.ville).includes(q)) return false;
      return true;
    });
    // Ceux chez qui tu travailles déjà d'abord : c'est là qu'une recommandation interne pèse.
    const nbCl = (g) => g.etabs.filter((id) => cl[id]).length;
    r = r.slice().sort((a, x) => nbCl(x) - nbCl(a) || x.nbEtabs - a.nbEtabs || a.nom.localeCompare(x.nom, 'fr'));
    const sum = document.getElementById('psGsummary');
    if (sum) sum.textContent = r.length + ' gestionnaire' + (r.length > 1 ? 's' : '') + ' sur ' + b.gestionnaires.length;

    const body = document.getElementById('psGbody');
    if (!body) return;
    body.innerHTML = r.map((g) => {
      const fam = Object.entries(g.familles).sort((a, x) => x[1] - a[1]).slice(0, 2)
        .map(([f, n]) => (b.famLib[f] || f) + ' ×' + n).join(' · ');
      const k = nbCl(g);
      return `<tr data-gid="${psEsc(g.id)}">
        <td class="ps-c-nom"><span class="ps-nom">${psEsc(psTitre(g.nom))}</span>${k ? `<span class="ps-client" title="Établissements où tu interviens déjà">client ×${k}</span>` : ''}${g.mail ? '<span class="ps-client ps-mailok" title="Adresse connue">mail</span>' : ''}
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
    const voir = document.getElementById('psMapVoir') ? document.getElementById('psMapVoir').value : 'tous';
    const cl = this.clients();
    const pts = this.toutes().filter((s) => {
      if (s.lat == null) return false;
      if (voir === 'clients') return !!cl[s.id];
      if (voir === 'suivi') return this.statutDe(s.id) !== 'aucun';
      return fam === 'all' || s.famille === fam || !!cl[s.id];
    });

    this._couches.clearLayers();
    const bounds = [];
    const ordre = pts.slice().sort((a, x) => (cl[a.id] ? 1 : 0) - (cl[x.id] ? 1 : 0));
    ordre.forEach((s) => {
      const st = this.statutDe(s.id);
      const client = cl[s.id];
      const coul = client ? PS_CLIENT_VERT : (parStatut ? PS_COUL_STATUT[st] : (PS_COUL_FAM[s.famille] || '#9a96b8'));
      const m = L.circleMarker([s.lat, s.lon], {
        radius: s.capacite ? Math.min(13, 5 + Math.sqrt(s.capacite) / 2) : 6,
        color: client ? '#08533a' : '#fff',
        weight: client ? 2.5 : 1.5,
        fillColor: coul,
        fillOpacity: client ? 1 : 0.8,
      });
      const d = this.distance(s);
      m.bindTooltip(psTitre(s.nom) + ' — ' + psTitre(s.ville || '')
        + (client ? ' · ton client (' + client.n + ' facture' + (client.n > 1 ? 's' : '') + ')' : '')
        + (d != null ? ' · ' + Math.round(d) + ' km' : ''), { direction: 'top' });
      m.on('click', () => CC.prospection.openFiche(s.id));
      m.addTo(this._couches);
      bounds.push([s.lat, s.lon]);
    });
    // Ton point de départ
    const h = this.maison();
    if (h) {
      L.circleMarker([h.lat, h.lon], { radius: 7, color: '#fff', weight: 3, fillColor: '#1b1733', fillOpacity: 1 })
        .bindTooltip('Ton point de départ', { direction: 'top' }).addTo(this._couches);
    }
    const nbClients = ordre.filter((s) => cl[s.id]).length;
    const leg = document.getElementById('psMapLegend');
    if (leg) {
      const clefs = parStatut
        ? PS_STATUTS.map(([k, l]) => [PS_COUL_STATUT[k], l])
        : (fam === 'all' || voir !== 'tous'
          ? Object.keys(PS_COUL_FAM).filter((f) => this.base().famLib[f] && pts.some((s) => s.famille === f)).map((f) => [PS_COUL_FAM[f], this.base().famLib[f]])
          : [[PS_COUL_FAM[fam], this.base().famLib[fam]]]);
      const vert = nbClients ? `<span class="ps-leg ps-leg-client"><i style="background:${PS_CLIENT_VERT}"></i>Tes clients (${nbClients})</span>` : '';
      const maison = h ? '<span class="ps-leg"><i style="background:#1b1733"></i>Ton départ</span>' : '';
      leg.innerHTML = vert + maison + clefs.map(([c, l]) => `<span class="ps-leg"><i style="background:${c}"></i>${psEsc(l)}</span>`).join('')
        + `<span class="ps-leg-note">${pts.length} points · taille = capacité · fond Esri</span>`;
    }
    setTimeout(() => {
      this._map.invalidateSize();
      const cle = fam + '|' + voir;
      if (bounds.length && this._cadre !== cle) { this._map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 }); this._cadre = cle; }
    }, 60);
  },

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
  // Tes coordonnées : celles de ta signature mail par défaut ; les champs ne
  // servent qu'à les remplacer pour le démarchage.
  _moi() {
    const r = this.suivi().reglages;
    const i = (CC.signature && CC.signature.ident) || {};
    return {
      moi: r.moi || i.nomAff || '[ton nom]',
      montel: r.montel || i.tel || '[ton téléphone]',
      monmail: r.monmail || i.mail || '[ton e-mail]',
      monsite: r.monsite || '',
    };
  },
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
    const i = (CC.signature && CC.signature.ident) || {};
    const defaut = { moi: i.nomAff || 'Prénom Nom', montel: i.tel || '06 …', monmail: i.mail || '', monsite: 'https://…' };
    ['moi', 'montel', 'monmail', 'monsite'].forEach((k) => {
      const el = document.getElementById('psSig_' + k);
      if (el) { el.value = r[k] || ''; el.placeholder = defaut[k]; }
    });
  },

  apercuModele() {
    const m = this.suivi().modeles.find((x) => x.id === this._modSel);
    if (!m) return;
    const ex = this.base().parId[this._sel] || this.toutes().find((s) => s.famille === 'enfance-handicap');
    const el = document.getElementById('psModApercu');
    if (el) el.textContent = this.remplir(m.objet, ex) + '\n\n' + this.remplir(m.corps, ex);
  },

  // `pourMail` : le message part par la boîte Mails, qui ajoute déjà ta
  // signature complète ; les lignes qui ne contiennent QUE tes coordonnées
  // ({moi}, {montel}…) sont alors retirées pour ne pas signer deux fois.
  remplir(texte, s, pourMail) {
    const b = this.base();
    const f = (s && this.suivi().fiches[s.id]) || {};
    const g = s ? b.gParId[s.ej] : null;
    const pubs = s ? (s.publics || []).map((p) => (b.pubLib[p] || p).replace(/\s*\(.*\)/, '')).join(', ') : '';
    const moi = this._moi();
    const v = Object.assign({
      structure: s ? psTitre(s.nom) : '',
      ville: s ? psTitre(s.ville || '') : '',
      categorie: s ? (s.catLib || s.catCourt || '') : '',
      public: pubs || 'enfants et adolescents',
      capacite: s && s.capacite ? s.capacite + ' places' : '',
      gestionnaire: g ? psTitre(g.nom) : '',
      contact: f.contactNom || '',
      tel: s ? psTel(f.telDirect || s.tel) : '',
      date: CC.util.frDate(CC.util.toISO(new Date())),
    }, moi);
    let t = String(texte || '');
    if (pourMail && CC.signature && CC.signature.actif && CC.signature.actif()) {
      t = t.split('\n').filter((l) => !/^\s*(\{(moi|montel|monmail|monsite)\}[\s—–\-|]*)+\s*$/.test(l)).join('\n')
        .replace(/\n{3,}/g, '\n\n').trimEnd();
    }
    return t.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
  },

  // Ouvre le message dans la boîte Mails de l'app (signature, envoi, suivi) ;
  // à défaut, dans le logiciel de mail du système.
  ecrire(s, modeleId) {
    const f = this.fiche(s.id);
    const mods = this.suivi().modeles;
    const m = mods.find((x) => x.id === modeleId) || mods[0];
    const a = f.mail || s.mail || '';
    if (CC.mailbox && CC.mailbox._openCompose && CC.switchTab) {
      document.getElementById('modalProspection').classList.add('hidden');
      CC.switchTab('mails');
      CC.mailbox._openCompose({ titre: 'Démarchage — ' + psTitre(s.nom), to: a, subject: this.remplir(m.objet, s, true), body: this.remplir(m.corps, s, true) + '\n' });
    } else {
      psOuvrir('mailto:' + encodeURIComponent(a) + '?subject=' + encodeURIComponent(this.remplir(m.objet, s)) + '&body=' + encodeURIComponent(this.remplir(m.corps, s)));
    }
    f.histo.push({ date: CC.util.toISO(new Date()), texte: 'Mail préparé : ' + m.nom });
    if ((PS_RANG[f.statut || 'aucun'] || 0) < PS_RANG.contacte) f.statut = 'contacte';
    this._persist();
  },

  // ---- Fiche (modale) ----------------------------------------------------
  openFiche(id) {
    const b = this.base();
    this.toutes();
    const s = b.parId[id];
    if (!s) return;
    this._sel = id;
    const f = this.fiche(id);
    const g = b.gParId[s.ej];
    this._clients = null;
    const client = this.clients()[id];
    const st = f.statut || 'aucun';

    const lg = (dt, dd) => `<dt>${dt}</dt><dd>${dd}</dd>`;
    const coord = [];
    if (s.tel) coord.push(lg('Téléphone', `<a href="#" class="lnk" data-ext="tel:${psEsc(s.tel)}">${psEsc(psTel(s.tel))}</a>`));
    if (f.telDirect) coord.push(lg('Ligne directe', `<a href="#" class="lnk" data-ext="tel:${psEsc(f.telDirect)}">${psEsc(psTel(f.telDirect))}</a>`));
    const mailAff = f.mail || s.mail || '';
    if (mailAff) coord.push(lg('E-mail', `<a href="#" class="lnk" data-ext="mailto:${psEsc(mailAff)}">${psEsc(mailAff)}</a>`));
    if (f.site) coord.push(lg('Site', `<a href="#" class="lnk" data-ext="${psEsc(f.site)}">${psEsc(f.site.replace(/^https?:\/\//, ''))}</a>`));
    const adr = [s.adresse, ((s.cp || '') + ' ' + psTitre(s.ville || '')).trim()].filter((x) => String(x || '').trim()).join(', ');
    if (adr) coord.push(lg('Adresse', psEsc(adr)));
    const d = this.distance(s);
    if (d != null) coord.push(lg('Distance', `${d < 10 ? d.toFixed(1).replace('.', ',') : Math.round(d)} km de chez toi <span class="ps-u2">(à vol d'oiseau)</span>`));

    const infos = [];
    if (s.catLib || s.catCourt) infos.push(lg('Catégorie', psEsc(s.catLib || s.catCourt)));
    infos.push(lg('Domaine', psEsc(b.famLib[s.famille] || s.famille || '—')));
    if (s.capacite) infos.push(lg('Capacité', s.capacite + ' places' + (s.capaInternat ? ' · dont ' + s.capaInternat + ' en internat' : '')));
    if (s.ageMin != null || s.ageMax != null) infos.push(lg('Âges', (s.ageMin != null ? s.ageMin : '?') + ' – ' + (s.ageMax != null ? s.ageMax : '?') + ' ans'));
    if ((s.publics || []).length) infos.push(lg('Public', psEsc((s.publics || []).map((p) => b.pubLib[p] || p).join(' · '))));
    if ((s.modes || []).length) infos.push(lg('Accueil', psEsc(s.modes.join(', '))));
    if ((s.clienteles || []).length) infos.push(lg('Déficiences', psEsc(s.clienteles.join(' · '))));
    if (s.statut) infos.push(lg('Statut', psEsc(s.statut)));
    if (s.perso) infos.push(lg('Source', 'Ajoutée par toi'));
    else infos.push(lg('N° FINESS', psEsc(s.id)));

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

    // Lien avec ta compta
    let blocClient;
    if (client) {
      blocClient = `<div class="ps-bloc ps-bloc-client">
        <h4>Ton client</h4>
        <p class="ps-note"><b>${psEsc(client.nom)}</b> · ${client.n} facture${client.n > 1 ? 's' : ''} · ${CC.util.eur0(client.ca)}${client.dernier ? ' · dernière le ' + CC.util.frDate(client.dernier) : ''}</p>
        <div class="btn-row">
          <button type="button" class="btn btn-ghost btn-sm" data-voirclient="${psEsc(client.cle)}">Fiche client</button>
          ${s.perso && s.client ? '' : `<button type="button" class="btn btn-ghost btn-sm" id="psF_delier">${client.mode === 'auto' ? 'Ce n’est pas ce client' : 'Retirer le lien'}</button>`}
        </div>
        ${client.mode === 'auto' ? '<p class="ps-note">Reconnu automatiquement (même nom et même type d’établissement).</p>' : ''}
      </div>`;
    } else {
      const liste = (CC.clients ? CC.clients.liste() : []).filter((c) => c.n).sort((a, x) => a.nom.localeCompare(x.nom, 'fr'));
      blocClient = `<div class="ps-bloc">
        <h4>Ta compta</h4>
        <div class="ps-lier">
          <select id="psF_client" class="input"><option value="">Relier à un de tes clients…</option>${liste.map((c) => `<option value="${psEsc(c.nom)}">${psEsc(c.nom)} (${c.n})</option>`).join('')}</select>
          <button type="button" class="btn btn-ghost btn-sm" id="psF_lier">Relier</button>
        </div>
        ${f.client === '__non__' ? '<p class="ps-note">Tu as indiqué que ce n’est pas ton client.</p>' : ''}
      </div>`;
    }

    const histo = (f.histo || []).slice().reverse().map((h, i) =>
      `<div class="ps-h"><time>${CC.util.frDate(h.date)}</time><span>${psEsc(h.texte)}</span>
       <button type="button" class="ps-hx" data-histo="${f.histo.length - 1 - i}" title="Supprimer">×</button></div>`).join('');

    const rech = 'https://www.google.com/search?q=' + encodeURIComponent(s.nom + ' ' + (s.ville || '') + ' contact email');
    const maps = s.lat != null
      ? 'https://www.google.com/maps/search/?api=1&query=' + s.lat + ',' + s.lon
      : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(s.nom + ' ' + (s.ville || ''));

    const etapes = PS_STATUTS.map(([k, l]) => `<button type="button" class="ps-step ps-${k}${k === st ? ' on' : ''}" data-st="${k}">${psEsc(l)}</button>`).join('');

    document.getElementById('psFicheTitre').textContent = psTitre(s.nom);
    const ville = psTitre(s.ville || '');
    document.getElementById('psFicheSous').textContent =
      [s.catCourt, ville, s.secteur === ville ? '' : s.secteur].filter(Boolean).join(' · ');
    document.getElementById('psFicheCorps').innerHTML = `
      <div class="ps-steps" role="group" aria-label="Étape de la démarche">${etapes}</div>
      <div class="ps-cols">
        <div>
          ${blocClient}
          <div class="ps-bloc"><h4>Coordonnées</h4><dl class="ps-dl">${coord.join('') || lg('—', 'Aucune coordonnée')}</dl>
            <div class="btn-row">
              <button type="button" class="btn btn-ghost btn-sm" data-ext="${psEsc(rech)}">Chercher le contact</button>
              <button type="button" class="btn btn-ghost btn-sm" data-ext="${psEsc(maps)}">Itinéraire</button>
              ${s.perso ? '<button type="button" class="btn btn-ghost btn-sm" id="psF_modif">Modifier</button><button type="button" class="btn btn-ghost btn-sm ps-danger" id="psF_suppr">Supprimer</button>' : ''}
            </div>
          </div>
          <div class="ps-bloc"><h4>Informations</h4><dl class="ps-dl">${infos.join('')}</dl></div>
          ${blocG}
        </div>
        <div>
          <div class="ps-bloc"><h4>Prochaine relance</h4>
            <div class="ps-relance">
              <div class="dp" data-dp-clearable data-dp-placeholder="Pas de relance prévue">
                <button type="button" class="dp-field" data-dp-btn></button>
                <input type="hidden" id="psF_relance" value="${psEsc(f.relanceLe || '')}" />
                <div class="dp-pop hidden" data-dp-pop></div>
              </div>
              <button type="button" class="btn btn-ghost btn-sm" data-rel="7">+7 j</button>
              <button type="button" class="btn btn-ghost btn-sm" data-rel="15">+15 j</button>
              <button type="button" class="btn btn-ghost btn-sm" data-rel="30">+1 mois</button>
            </div>
          </div>

          <div class="ps-bloc"><h4>Journal</h4>
            <div class="ps-rapides">${PS_RAPIDES.map(([t]) => `<button type="button" class="ps-chip" data-rapide="${psEsc(t)}">${psEsc(t)}</button>`).join('')}</div>
            <div class="ps-evt">
              <input id="psF_evt" class="input" placeholder="Autre chose : « appelé, rappeler en septembre »">
              <button type="button" class="btn btn-ghost" id="psF_evtOk">Ajouter</button>
            </div>
            ${histo || '<p class="ps-note">Aucun échange enregistré.</p>'}
          </div>

          <div class="ps-bloc"><h4>Écrire</h4>
            <div class="ps-ecrire">
              <select id="psF_modele" class="input">${this.suivi().modeles.map((m) =>
                `<option value="${psEsc(m.id)}"${(st === 'aucun' ? 'm1' : (st === 'relance' || st === 'contacte' ? 'm3' : (st === 'rdv' ? 'm5' : ''))) === m.id ? ' selected' : ''}>${psEsc(m.nom)}</option>`).join('')}</select>
              <button type="button" class="btn btn-primary" id="psF_mailto">Écrire dans Mails</button>
              <button type="button" class="btn btn-ghost" id="psF_copier">Copier</button>
            </div>
            <p class="ps-note">${mailAff ? 'Destinataire : ' + psEsc(mailAff) : 'Pas d’adresse e-mail : ajoute-la ci-dessous, ou cherche-la (« Chercher le contact »).'}</p>
          </div>

          <div class="ps-bloc"><h4>Interlocuteur</h4>
            <div class="form-grid ps-form">
              <div class="field full"><label for="psF_contact">Nom, fonction</label>
                <input id="psF_contact" class="input" value="${psEsc(f.contactNom || '')}" placeholder="ex. Mme Martin, cheffe de service"></div>
              <div class="field"><label for="psF_mail">E-mail</label>
                <input id="psF_mail" class="input" type="email" value="${psEsc(f.mail || '')}" placeholder="direction@…"></div>
              <div class="field"><label for="psF_tel">Ligne directe</label>
                <input id="psF_tel" class="input" type="tel" value="${psEsc(f.telDirect || '')}"></div>
              <div class="field full"><label for="psF_site">Site</label>
                <input id="psF_site" class="input" value="${psEsc(f.site || '')}" placeholder="https://…"></div>
              <div class="field full"><label for="psF_notes">Notes</label>
                <textarea id="psF_notes" class="input" rows="3" placeholder="Ce qui s'est dit, le budget, la période…">${psEsc(f.notes || '')}</textarea></div>
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
    const auj = () => CC.util.toISO(new Date());
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

    // Relance : sélecteur de date de l'app (format français, pas celui du système).
    if (CC.dp) CC.dp.init(box);
    const rel = document.getElementById('psF_relance');
    if (rel) rel.addEventListener('change', () => {
      f.relanceLe = rel.value || '';
      if (f.relanceLe) f.histo.push({ date: auj(), texte: 'Relance prévue le ' + CC.util.frDate(f.relanceLe) });
      this._persist();
    });
    box.querySelectorAll('[data-rel]').forEach((b) => b.addEventListener('click', () => {
      f.relanceLe = CC.util.toISO(CC.util.addDays(new Date(), +b.dataset.rel));
      if (f.statut === 'aucun' || !f.statut || f.statut === 'contacte') f.statut = 'relance';
      f.histo.push({ date: auj(), texte: 'Relance prévue le ' + CC.util.frDate(f.relanceLe) });
      this._persist();
      this.openFiche(s.id);
    }));

    box.querySelectorAll('[data-st]').forEach((b) => b.addEventListener('click', () => {
      if (f.statut === b.dataset.st) return;
      f.statut = b.dataset.st;
      f.histo.push({ date: auj(), texte: 'Étape : ' + PS_STATUT_LIB[f.statut] });
      if (f.statut === 'refus' || f.statut === 'gagne') f.relanceLe = '';
      this._persist();
      this.openFiche(s.id);
    }));

    box.querySelectorAll('[data-rapide]').forEach((b) => b.addEventListener('click', () => {
      const [texte, cible] = PS_RAPIDES.find(([t]) => t === b.dataset.rapide);
      f.histo.push({ date: auj(), texte });
      const actuel = f.statut || 'aucun';
      if (cible === 'refus' || (actuel !== 'refus' && (PS_RANG[cible] || 0) > (PS_RANG[actuel] || 0))) f.statut = cible;
      if (f.statut === 'refus' || f.statut === 'gagne') f.relanceLe = '';
      this._persist();
      this.openFiche(s.id);
    }));
    const ajout = () => {
      const el = document.getElementById('psF_evt');
      if (!el.value.trim()) return;
      f.histo.push({ date: auj(), texte: el.value.trim() });
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

    const modele = () => document.getElementById('psF_modele').value;
    document.getElementById('psF_copier').addEventListener('click', () => {
      const m = this.suivi().modeles.find((x) => x.id === modele()) || this.suivi().modeles[0];
      psCopier(this.remplir(m.objet, s) + '\n\n' + this.remplir(m.corps, s));
      CC.toast('Message copié', 'ok');
      f.histo.push({ date: auj(), texte: 'Message copié : ' + m.nom });
      if ((PS_RANG[f.statut || 'aucun'] || 0) < PS_RANG.contacte) f.statut = 'contacte';
      this._persist();
    });
    document.getElementById('psF_mailto').addEventListener('click', () => this.ecrire(s, modele()));

    // Lien avec la compta
    const lier = document.getElementById('psF_lier');
    if (lier) lier.addEventListener('click', () => {
      const v = document.getElementById('psF_client').value;
      if (!v) return;
      f.client = v;
      if ((PS_RANG[f.statut || 'aucun'] || 0) < PS_RANG.gagne && f.statut !== 'refus') f.statut = 'gagne';
      f.histo.push({ date: auj(), texte: 'Reliée au client ' + v });
      this._persist();
      this.openFiche(s.id);
    });
    const delier = document.getElementById('psF_delier');
    if (delier) delier.addEventListener('click', () => {
      f.client = '__non__';
      this._persist();
      this.openFiche(s.id);
    });
    box.querySelectorAll('[data-voirclient]').forEach((b) => b.addEventListener('click', () => this._ouvrirClient(b.dataset.voirclient)));

    const modif = document.getElementById('psF_modif');
    if (modif) modif.addEventListener('click', () => this.editerPerso(s.id));
    const suppr = document.getElementById('psF_suppr');
    if (suppr) suppr.addEventListener('click', async () => {
      const r = await CC.dialog({ type: 'warning', buttons: ['Supprimer', 'Annuler'], defaultId: 1, cancelId: 1,
        title: 'Supprimer la structure', message: `Supprimer « ${psTitre(s.nom)} » de ton Réseau ?`, detail: 'Son suivi (journal, notes) est effacé aussi. Tes factures ne sont pas touchées.' });
      if (r.response !== 0) return;
      delete this.suivi().perso[s.id];
      delete this.suivi().fiches[s.id];
      delete this.base().parId[s.id];
      this._persist();
      this.closeFiche();
    });

    box.querySelectorAll('[data-ext]').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault();
      psOuvrir(b.dataset.ext);
    }));
    box.querySelectorAll('[data-gid]').forEach((b) => b.addEventListener('click', (e) => {
      e.preventDefault();
      this.openGest(b.dataset.gid);
    }));
  },

  _ouvrirClient(cle) {
    if (!CC.clients) return;
    const c = CC.clients.liste().find((x) => x.cle === cle);
    if (!c) return;
    document.getElementById('modalProspection').classList.add('hidden');
    if (c.fiche) CC.clients.ouvrir(c.fiche);
    else CC.clients.creerDepuis(c.cle);
  },

  // ---- Structures ajoutées par toi (hors FINESS) --------------------------
  editerPerso(id) {
    const b = this.base();
    const s = id ? this.suivi().perso[id] : null;
    const e = s || { nom: '', famille: 'animation-jeunesse', catCourt: '', adresse: '', cp: '', ville: '', tel: '', mail: '', client: '' };
    const fams = ['animation-jeunesse', 'enfance-handicap', 'adultes-handicap', 'protection-enfance', 'social-insertion', 'sante-mentale', 'personnes-agees', 'formation', 'ressources', 'autre'];
    const clients = (CC.clients ? CC.clients.liste() : []).filter((c) => c.n).sort((a, x) => a.nom.localeCompare(x.nom, 'fr'));
    document.getElementById('psFicheTitre').textContent = s ? 'Modifier la structure' : 'Ajouter une structure';
    document.getElementById('psFicheSous').textContent = 'Un espace jeunes, une mairie, une école, une association… tout ce qui n’est pas dans la base FINESS.';
    document.getElementById('psFicheCorps').innerHTML = `
      <form id="psPersoForm" class="ps-perso-form">
        <div class="form-grid">
          <div class="field full"><label for="psP_nom">Nom *</label><input id="psP_nom" class="input" required value="${psEsc(e.nom)}" placeholder="ex. Espace Jeunes de Sanary"></div>
          <div class="field"><label for="psP_fam">Domaine</label><select id="psP_fam" class="input">${fams.map((f) => `<option value="${f}"${f === e.famille ? ' selected' : ''}>${psEsc(b.famLib[f] || f)}</option>`).join('')}</select></div>
          <div class="field"><label for="psP_cat">Type</label><input id="psP_cat" class="input" value="${psEsc(e.catCourt || '')}" placeholder="Espace jeunes, mairie, collège…"></div>
          <div class="field full"><label for="psP_adr">Adresse</label><input id="psP_adr" class="input" value="${psEsc(e.adresse || '')}"></div>
          <div class="field"><label for="psP_cp">Code postal</label><input id="psP_cp" class="input" inputmode="numeric" maxlength="5" value="${psEsc(e.cp || '')}"></div>
          <div class="field"><label for="psP_ville">Ville</label><input id="psP_ville" class="input" value="${psEsc(e.ville || '')}"></div>
          <div class="field"><label for="psP_tel">Téléphone</label><input id="psP_tel" class="input" type="tel" value="${psEsc(e.tel || '')}"></div>
          <div class="field"><label for="psP_mail">E-mail</label><input id="psP_mail" class="input" type="email" value="${psEsc(e.mail || '')}"></div>
          <div class="field full"><label for="psP_client">Client de ta compta</label><select id="psP_client" class="input"><option value="">— pas encore client —</option>${clients.map((c) => `<option value="${psEsc(c.nom)}"${c.nom === e.client ? ' selected' : ''}>${psEsc(c.nom)}</option>`).join('')}</select></div>
        </div>
        <p class="ps-note">L’adresse sert à placer la structure sur la carte et à calculer la distance.</p>
        <div class="modal-actions"><span class="spacer"></span>
          <button type="button" class="btn" id="psP_annuler">Annuler</button>
          <button type="submit" class="btn btn-primary">${s ? 'Enregistrer' : 'Ajouter'}</button>
        </div>
      </form>`;
    document.getElementById('modalProspection').classList.remove('hidden');
    document.getElementById('psP_annuler').addEventListener('click', () => (s ? this.openFiche(s.id) : this.closeFiche()));
    document.getElementById('psPersoForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const v = (k) => document.getElementById(k).value.trim();
      const nom = v('psP_nom');
      if (!nom) return;
      const n = Object.assign(s || { id: 'p' + CC.util.uid(), perso: true, publics: [], source: 'perso' }, {
        nom, famille: v('psP_fam'), catCourt: v('psP_cat'), catLib: v('psP_cat'), adresse: v('psP_adr'), cp: v('psP_cp'),
        ville: v('psP_ville'), tel: v('psP_tel').replace(/\s/g, ''), mail: v('psP_mail'), client: v('psP_client'),
      });
      await this._geocoder(n);
      this.suivi().perso[n.id] = n;
      this._persist();
      this.openFiche(n.id);
    });
    setTimeout(() => document.getElementById('psP_nom').focus(), 30);
  },

  async _geocoder(n) {
    const q = [n.adresse, n.cp, n.ville].filter(Boolean).join(' ');
    if (!q || !(window.api && window.api.routes && window.api.routes.geocode)) return;
    try {
      const r = await window.api.routes.geocode(q);
      const x = r && r.results && r.results[0];
      if (x && x.lat != null) { n.lat = x.lat; n.lon = x.lon; }
    } catch (_) {}
  },

  // Tes clients qui ne sont reliés à aucune structure du Réseau (espaces
  // jeunes, SIVOM, écoles…) : ajoutés en un clic, avec l'adresse de leur fiche.
  clientsAbsents() {
    if (!CC.clients) return [];
    const cl = this.clients();
    const relies = new Set(Object.values(cl).map((c) => c.cle));
    return CC.clients.liste().filter((c) => c.n && c.categorie !== 'Mixage/Mastering' && !relies.has(c.cle)
      && !(c.fiche && c.fiche.type === 'particulier'));
  },
  async importerClients() {
    const abs = this.clientsAbsents();
    if (!abs.length) { CC.toast('Tous tes clients sont déjà dans le Réseau.', 'ok'); return; }
    const r = await CC.dialog({
      type: 'question', buttons: [`Ajouter ${abs.length} client${abs.length > 1 ? 's' : ''}`, 'Annuler'], defaultId: 0, cancelId: 1,
      title: 'Ajouter tes clients au Réseau',
      message: `${abs.length} de tes clients ne sont reliés à aucune structure du Réseau.`,
      detail: abs.map((c) => '· ' + c.nom).join('\n') + '\n\nIls seront ajoutés avec l’adresse de leur fiche client, à l’étape « Actée ». Tu pourras les modifier ou les supprimer.'
    });
    if (r.response !== 0) return;
    const perso = this.suivi().perso;
    for (const c of abs) {
      const fi = c.fiche || {};
      const n = {
        id: 'p' + CC.util.uid(), perso: true, source: 'perso', publics: [],
        nom: c.nom, famille: PS_FAM_DE_CAT[c.categorie] || 'autre', catCourt: c.categorie || '', catLib: c.categorie || '',
        adresse: fi.adresse || '', cp: fi.cp || '', ville: fi.ville || '', tel: (fi.tel || '').replace(/\s/g, ''), mail: fi.email || '',
        client: c.nom,
      };
      // « EJ Sanary », « Mairie de Collobrières » : la structure est dans la ville
      // de son nom, même si la fiche porte l'adresse de celui qui paie (FOL 83 à
      // Toulon pour l'Espace Jeunes de Sanary).
      const lieu = c.nom.match(/^(?:EJ|Espace Jeunes(?: de)?|Mairie d[e']|Ville d[e']|Commune d[e'])\s*(.+)$/i);
      if (lieu) { n.adresse = ''; n.cp = ''; n.ville = lieu[1].trim(); n.catCourt = /^EJ|^Espace/i.test(c.nom) ? 'Espace jeunes' : 'Mairie'; }
      await this._geocoder(n);
      perso[n.id] = n;
      const f = this.fiche(n.id);
      f.statut = 'gagne';
      f.histo.push({ date: CC.util.toISO(new Date()), texte: 'Ajoutée depuis tes clients (' + c.n + ' facture' + (c.n > 1 ? 's' : '') + ')' });
    }
    this._persist();
    this.render();
    CC.toast(abs.length + ' client(s) ajouté(s) au Réseau.', 'ok');
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
    const etabs = g.etabs.map((x) => b.parId[x]).filter(Boolean)
      .sort((a, x) => (cl[x.id] ? 1 : 0) - (cl[a.id] ? 1 : 0) || a.nom.localeCompare(x.nom, 'fr'));
    const nbCl = etabs.filter((s) => cl[s.id]).length;

    document.getElementById('psFicheTitre').textContent = psTitre(g.nom);
    document.getElementById('psFicheSous').textContent = g.nbEtabs + ' établissement' + (g.nbEtabs > 1 ? 's' : '') + ' dans les Alpes-Maritimes'
      + (nbCl ? ' · tu interviens déjà dans ' + nbCl : '');
    document.getElementById('psFicheCorps').innerHTML = `
      <div class="ps-cols">
        <div>
          <div class="ps-bloc"><h4>Siège</h4><dl class="ps-dl">${l.join('')}</dl>
            <div class="btn-row">
              <button type="button" class="btn btn-ghost btn-sm" data-ext="https://www.google.com/search?q=${encodeURIComponent(g.nom + ' contact')}">Chercher sur le web</button>
              ${g.mail ? '<button type="button" class="btn btn-primary btn-sm" id="psG_mail">Écrire au siège</button>' : ''}
            </div>
            ${g.sourceContact === 'web' ? '<p class="ps-note">Contact relevé sur le site de l’organisme — à confirmer avant envoi.</p>' : ''}
            ${nbCl ? `<p class="ps-note">Tu travailles déjà avec ${nbCl} de leurs établissements : cite-les, c’est ta meilleure carte de visite auprès du siège.</p>` : ''}
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
      if (CC.mailbox && CC.mailbox._openCompose) {
        document.getElementById('modalProspection').classList.add('hidden');
        CC.switchTab('mails');
        CC.mailbox._openCompose({ titre: 'Démarchage — ' + psTitre(g.nom), to: g.mail, subject: this.remplir(m.objet, faux, true), body: this.remplir(m.corps, faux, true) + '\n' });
      } else {
        psOuvrir('mailto:' + encodeURIComponent(g.mail) + '?subject=' + encodeURIComponent(this.remplir(m.objet, faux)) + '&body=' + encodeURIComponent(this.remplir(m.corps, faux)));
      }
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
    const col = ['Nom', 'Catégorie', 'Domaine', 'Publics', 'Capacité', 'Adresse', 'CP', 'Ville', 'Secteur', 'Distance (km)',
      'Téléphone', 'E-mail', 'Gestionnaire', 'Tél. gestionnaire', 'Mail gestionnaire',
      'Étape', 'Interlocuteur', 'Relance', 'Client', 'Notes', 'FINESS'];
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const lignes = [col.map(q).join(';')];
    r.forEach((s) => {
      const f = this.suivi().fiches[s.id] || {};
      const g = b.gParId[s.ej] || {};
      const d = this.distance(s);
      lignes.push([
        psTitre(s.nom), s.catLib || s.catCourt || '', b.famLib[s.famille] || s.famille,
        (s.publics || []).map((p) => b.pubLib[p] || p).join(' / '),
        s.capacite || '', s.adresse || '', s.cp || '', psTitre(s.ville || ''), s.secteur || '', d != null ? Math.round(d) : '',
        psTel(f.telDirect || s.tel), f.mail || s.mail || '',
        psTitre(g.nom || ''), psTel(g.tel || ''), g.mail || '',
        PS_STATUT_LIB[this.statutDe(s.id)], f.contactNom || '', f.relanceLe || '',
        cl[s.id] ? cl[s.id].nom : '', (f.notes || '').replace(/\r?\n/g, ' · '), s.perso ? '' : s.id,
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

    // Suivi : actions des listes (délégation, le contenu est reconstruit)
    const suivi = document.getElementById('psub-suivi');
    if (suivi) suivi.addEventListener('click', (e) => {
      const t = e.target.closest('button, [data-ouvrir]');
      if (!t) return;
      const auj = CC.util.toISO(new Date());
      if (t.dataset.appel) { psOuvrir('tel:' + t.dataset.appel); return; }
      if (t.dataset.ecrire) {
        const s = this.base().parId[t.dataset.ecrire];
        if (s) this.ecrire(s, this.statutDe(s.id) === 'rdv' ? 'm5' : 'm3');
        return;
      }
      if (t.dataset.reporter) {
        const f = this.fiche(t.dataset.reporter);
        f.relanceLe = CC.util.toISO(CC.util.addDays(new Date(), 7));
        f.histo.push({ date: auj, texte: 'Relance reportée au ' + CC.util.frDate(f.relanceLe) });
        this._persist(); this.renderSuivi(); return;
      }
      if (t.dataset.fait) {
        const f = this.fiche(t.dataset.fait);
        f.relanceLe = '';
        f.histo.push({ date: auj, texte: 'Relance faite' });
        if (f.statut === 'relance') f.statut = 'contacte';
        this._persist(); this.renderSuivi();
        CC.toast('Relance notée. Pense à programmer la suivante depuis la fiche.', 'ok');
        return;
      }
      if (t.dataset.client) { this._ouvrirClient(t.dataset.client); return; }
      if (t.dataset.ouvrir) this.openFiche(t.dataset.ouvrir);
    });
    ['psAjout', 'psAjout2'].forEach((id) => { const el = document.getElementById(id); if (el) el.addEventListener('click', () => this.editerPerso(null)); });
    const imp = document.getElementById('psImportClients');
    if (imp) imp.addEventListener('click', () => this.importerClients());

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

    ['psMapColor', 'psMapFam', 'psMapVoir'].forEach((id) => {
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
    const mp = document.getElementById('modalProspection');
    mp.addEventListener('click', (e) => {
      if (CC.clicFond(e, mp)) this.closeFiche();
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
// Mots significatifs d'un nom, et ses sigles de type d'établissement.
function psMots(nom) {
  const n = String(nom || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const types = [], mots = [];
  n.split(' ').forEach((w) => {
    if (PS_TYPES.has(w)) types.push(w);
    else if (w.length > 2 && !PS_VIDES.has(w)) mots.push(w);
  });
  return { mots, types };
}
// Même type d'établissement : aucun sigle des deux côtés, ou un sigle commun.
function psMemeType(a, b) {
  if (!a.length && !b.length) return true;
  return a.some((t) => b.includes(t));
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
