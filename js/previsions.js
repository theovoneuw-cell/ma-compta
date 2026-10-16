'use strict';
window.CC = window.CC || {};

// ---------------------------------------------------------------------------
// Compta › Prévisions (15/10/2026) : le CA et le net à venir, calculés depuis
// Google Agenda. Théo donne un tarif par presta et les mots qui la repèrent
// dans le titre des rendez-vous (« STM », « AMU », « AMAPEI »…) ; chaque
// rendez-vous reconnu vaut sa durée × le tarif horaire (ou un forfait par séance).
//
// Rangé dans settings.previsions (et pas à la racine), pour la même raison que
// les fiches clients : l'ancienne app iPhone recopie `settings` en entier.
//   { tarifs: [{ id, nom, mots, montant, unite: 'heure'|'seance' }], ignores: [clé] }
// Net = CA − URSSAF (taux du trimestre du rendez-vous) − impôt si versement libératoire.
// ---------------------------------------------------------------------------

const PV_CACHE = 'previsionsCache';
const PV_MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// « AMU - IME Val Paillon » -> " AMU IME VAL PAILLON " : sans accents ni ponctuation,
// bordé d'espaces pour chercher des mots entiers (« AMU » ne doit pas prendre « AMUSE »).
function pvNorm(s) {
  return ' ' + String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ').trim() + ' ';
}
function pvEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function pvKey(d) { const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }
function pvMk(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function pvHeures(h) {
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  return mm ? `${hh} h ${String(mm).padStart(2, '0')}` : `${hh} h`;
}
// Intitulé d'un rendez-vous sans son préfixe ni ses parenthèses :
// « AMU - IME Les Chênes (PASSERELLE-MATIS) » -> { cle: 'IME LES CHENES', nom: 'AMU · IME Les Chênes' }.
// La clé sert de mot à reconnaître : c'est elle qui distingue deux lieux d'un même préfixe.
function pvSous(titre) {
  const brut = String(titre || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const m = brut.match(/^([^\s\-–—:·]+)[\s\-–—:·]+(.+)$/);
  const reste = m ? m[2].trim() : '';
  return { cle: pvNorm(reste || brut).trim(), nom: reste ? m[1] + ' · ' + reste : brut };
}
function pvHeure(iso) { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }

CC.previsions = {
  cur: null,          // 1er jour du mois affiché
  _events: null,      // rendez-vous de la période (Google ou cache)
  _savedAt: null,     // date de la synchro affichée si on lit le cache
  _erreur: '',
  _charge: null,      // promesse de chargement en cours
  _edit: null,        // id du tarif en cours de modification

  reglages() {
    const s = CC.state.settings;
    if (!s.previsions || typeof s.previsions !== 'object') s.previsions = {};
    if (!Array.isArray(s.previsions.tarifs)) s.previsions.tarifs = [];
    if (!Array.isArray(s.previsions.ignores)) s.previsions.ignores = [];
    return s.previsions;
  },

  // Période lue dans l'agenda : de la rentrée (1er septembre) à 12 mois devant.
  _bornes() {
    const n = new Date();
    const debut = new Date(n.getMonth() >= 8 ? n.getFullYear() : n.getFullYear() - 1, 8, 1);
    const fin = new Date(n.getFullYear(), n.getMonth() + 13, 1);
    return { debut, fin };
  },

  _month() {
    if (!this.cur) { const n = new Date(); this.cur = new Date(n.getFullYear(), n.getMonth(), 1); }
    return this.cur;
  },

  async charger(force) {
    if (this._events && !force) return;
    if (this._charge) return this._charge;
    const { debut, fin } = this._bornes();
    this._charge = (async () => {
      let res;
      try { res = await window.api.gcal.events({ timeMin: debut.toISOString(), timeMax: fin.toISOString(), maxResults: 2500 }); }
      catch (e) { res = { error: String(e.message || e) }; }
      if (res && !res.error) {
        this._events = res.events || [];
        this._savedAt = null; this._erreur = '';
        try { localStorage.setItem(PV_CACHE, JSON.stringify({ savedAt: new Date().toISOString(), events: this._events })); } catch (_) {}
      } else {
        let c = null;
        try { c = JSON.parse(localStorage.getItem(PV_CACHE) || 'null'); } catch (_) {}
        this._erreur = (res && res.error) || 'Agenda indisponible';
        if (c) { this._events = c.events || []; this._savedAt = c.savedAt; }
        else this._events = null;
      }
    })();
    try { await this._charge; } finally { this._charge = null; }
  },

  // Tarif qui correspond au titre : le mot-clé le plus long gagne, pour qu'un
  // « STM TP STUDIO » précis passe devant un « STM » général.
  tarifDe(titre) {
    const t = pvNorm(titre);
    let best = null, lg = 0;
    this.reglages().tarifs.forEach((tf) => {
      String(tf.mots || tf.nom || '').split(',').forEach((m) => {
        const k = pvNorm(m);
        if (k.trim() && t.includes(k) && k.length > lg) { best = tf; lg = k.length; }
      });
    });
    return best;
  },

  // Nom du client sur la facture pour ce tarif. Écrit dans le tarif (`client`)
  // ou, à défaut, deviné dans l'historique : le nom de facture le plus long que
  // contient le nom du tarif (« Cours Studio M » -> « Studio M ») ou qui contient
  // un de ses mots (« AMAPEI » -> « FdV - AMAPEI »).
  clientDe(tf) {
    if (tf.client && String(tf.client).trim()) return String(tf.client).trim();
    const nom = pvNorm(tf.nom);
    const mots = String(tf.mots || '').split(',').map(pvNorm).filter((m) => m.trim());
    let best = null, lg = 0;
    new Set(CC.state.factures.map((f) => CC.util.clientNom(f.libelle))).forEach((n) => {
      const k = pvNorm(n);
      if (k.trim().length < 3) return;
      if ((nom.includes(k) || mots.some((m) => k.includes(m))) && k.length > lg) { best = n; lg = k.length; }
    });
    return best || String(tf.nom || '').replace(/^[^·]*·\s*/, '').trim() || tf.nom;
  },

  // -------------------------------------------------------------------------
  // LE PRÉVISIONNEL TENU PAR L'AGENDA (16/10/2026)
  //
  // Une facture prévisionnelle par client et par mois, d'après les rendez-vous
  // reconnus. Ce qui est déjà facturé ne compte plus : pour un client, tout
  // rendez-vous jusqu'à sa dernière facture émise (date d'envoi, ou fin du mois
  // couvert si elle vient d'une ligne de l'agenda) est considéré comme facturé.
  //
  // Les lignes saisies par Théo sont gardées, avec leur nom : chacune est
  // rattachée au mois de son trimestre dont le montant est le plus proche, puis
  // ajustée sur l'agenda. Une ligne retouchée à la main ensuite (montant différent
  // du dernier calcul) est figée : on n'y touche plus.
  //
  // Tarifs hors taxe : à partir du 1er janvier 2027 (ou de tvaDepuis), la ligne
  // porte 20 % de TVA et son montant est le TTC, comme toute facture de l'app.
  // f.pv = { mois: 'AAAA-MM', calc: dernier montant calculé, saisi?: montant
  //          d'origine d'une ligne de Théo, detail: '5 rendez-vous, 15 h', fige?: true }
  // -------------------------------------------------------------------------
  synchroniser() {
    const S = CC.state;
    if (this._sync || !this._events || !this._events.length || S.readOnly) return null;
    this._sync = true;
    try {
      const { debut, fin } = this._bornes();
      const dansFenetre = (mk) => mk >= pvMk(debut) && mk < pvMk(fin);
      const tvaDepuis = S.settings.tvaDepuis || '2027-01-01';
      const r2 = (x) => Math.round(x * 100) / 100;
      const cle = (n) => CC.util.clientKey(n);
      const res = { ajout: 0, maj: 0, suppr: 0 };
      let touche = false;   // seule l'heure de fin a bougé : on enregistre sans l'annoncer

      const parClient = new Map();
      this._calcul().lignes.forEach((l) => {
        const nom = this.clientDe(l.tarif), k = cle(nom);
        const c = parClient.get(k) || { k, nom, mois: {} };
        parClient.set(k, c);
        (c.mois[l.mk] = c.mois[l.mk] || []).push(l);
      });

      const retirer = new Set();
      parClient.forEach((c) => {
        const fs = S.factures.filter((f) => cle(f.libelle) === c.k);
        let couvert = '';
        fs.forEach((f) => {
          if (CC.stats.isPrevu(f)) return;
          const x = f.pv && f.pv.mois ? f.pv.mois + '-31' : (f.dateEnvoi || f.dateEncaissement || '');
          if (x > couvert) couvert = x;
        });

        const aPrevoir = {};
        Object.keys(c.mois).forEach((mk) => {
          const ls = c.mois[mk].filter((l) => l.jour > couvert);
          if (!ls.length) return;
          const ht = r2(ls.reduce((a, l) => a + l.montant, 0));
          const tva = mk + '-01' >= tvaDepuis ? 20 : 0;
          // Fin de la dernière séance du mois : passée elle, la facture du mois peut partir.
          const finDe = (l) => new Date(l.e.fin || l.e.debut).getTime();
          const fin = new Date(Math.max(...ls.map(finDe))).toISOString();
          aPrevoir[mk] = { ht, tva, ttc: r2(ht * (1 + tva / 100)), fin, detail: `${ls.length} rendez-vous, ${pvHeures(ls.reduce((a, l) => a + l.heures, 0))}` };
        });

        const prevues = fs.filter((f) => CC.stats.isPrevu(f));
        const parMois = {};
        prevues.forEach((f) => { if (f.pv && f.pv.mois && !parMois[f.pv.mois]) parMois[f.pv.mois] = f; });

        // Lignes de Théo pas encore rattachées : au mois le plus proche, dans leur trimestre.
        const paires = [];
        prevues.filter((f) => !(f.pv && f.pv.mois)).forEach((f) => Object.keys(aPrevoir).forEach((mk) => {
          if (parMois[mk]) return;
          const [y, m] = mk.split('-').map(Number);
          if (+f.annee !== y || +f.trimestre !== Math.floor((m - 1) / 3) + 1) return;
          paires.push({ f, mk, ecart: Math.abs((+f.montant || 0) - aPrevoir[mk].ttc) });
        }));
        paires.sort((a, b) => a.ecart - b.ecart);
        const pris = new Set();
        paires.forEach(({ f, mk }) => {
          if (pris.has(f) || parMois[mk]) return;
          pris.add(f);
          f.pv = { mois: mk, saisi: +f.montant || 0 };
          parMois[mk] = f;
        });

        const modele = fs.slice().sort((a, b) => String(b.dateEnvoi || '').localeCompare(String(a.dateEnvoi || '')))[0] || {};
        Object.keys(aPrevoir).forEach((mk) => {
          const a = aPrevoir[mk];
          let f = parMois[mk];
          if (f && f.pv.fin !== a.fin) { f.pv.fin = a.fin; touche = true; }
          if (f && f.pv.fige) return;
          if (f && f.pv.calc != null && Math.abs((+f.montant || 0) - f.pv.calc) > 0.005) { f.pv.fige = true; res.maj++; return; }
          const [y, m] = mk.split('-').map(Number);
          if (!f) {
            f = {
              id: 'pv-' + c.k.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + mk,
              libelle: c.nom, montant: 0, numFacture: '', modePaiement: modele.modePaiement || 'Virement',
              dateEncaissement: '', annee: y, trimestre: Math.floor((m - 1) / 3) + 1,
              categorie: modele.categorie || CC.util.categoryOf(c.nom),
              dateEnvoi: '', dateEcheance: '', notes: '', fichier: '', previsionnel: true, pv: { mois: mk }
            };
            S.factures.push(f);
            res.ajout++;
          } else if (Math.abs((+f.montant || 0) - a.ttc) > 0.005 || (+f.tauxTva || 0) !== a.tva) res.maj++;
          f.montant = a.ttc;
          if (a.tva) f.tauxTva = a.tva; else delete f.tauxTva;
          f.pv.calc = a.ttc;
          f.pv.detail = a.detail;
          f.pv.fin = a.fin;
        });

        // Mois sans plus rien à facturer (facturé, ou rendez-vous annulés) : la ligne s'en va.
        prevues.forEach((f) => {
          if (f.pv && f.pv.mois && !f.pv.fige && !aPrevoir[f.pv.mois] && dansFenetre(f.pv.mois)) retirer.add(f);
        });
      });

      // Ligne créée par l'agenda pour un client qui n'a plus de tarif (tarif supprimé,
      // ou client renommé : « SESSAD CARROS » -> « ABA Carros ») : elle ferait doublon.
      // Les lignes saisies par Théo (pv.saisi) restent.
      S.factures.forEach((f) => {
        if (f.pv && f.pv.mois && f.pv.saisi == null && !f.pv.fige && CC.stats.isPrevu(f)
          && !parClient.has(cle(f.libelle)) && dansFenetre(f.pv.mois)) retirer.add(f);
      });

      if (retirer.size) { S.factures = S.factures.filter((f) => !retirer.has(f)); res.suppr = retirer.size; }
      this._dernier = res;
      if (res.ajout || res.maj || res.suppr || touche) { CC.markDirty(); CC.refreshYears(); CC.render(); if (CC.renderAFacturer) CC.renderAFacturer(); }
      return res;
    } finally { this._sync = false; }
  },

  // Facture du mois prête à partir : toutes les séances du mois chez ce client
  // sont passées (Théo facture une structure quand il a fini son mois chez elle).
  estAFacturer(f, now) {
    return !!(f && f.pv && f.pv.mois && f.pv.fin && CC.stats.isPrevu(f)
      && new Date(f.pv.fin).getTime() <= (now || new Date()).getTime());
  },
  aFacturer(now) {
    return (CC.state.factures || []).filter((f) => this.estAFacturer(f, now))
      .sort((a, b) => String(a.pv.mois).localeCompare(String(b.pv.mois)) || String(a.libelle).localeCompare(String(b.libelle), 'fr'));
  },
  moisTxt(mk) {
    const [y, m] = String(mk).split('-').map(Number);
    return PV_MOIS[m - 1] + (y !== new Date().getFullYear() ? ' ' + y : '');
  },

  // Au démarrage et à chaque lecture de l'agenda.
  async auto() {
    // Une séance qui se termine app ouverte : la facture du mois passe « À facturer »
    // sans attendre le prochain démarrage (contrôle toutes les 5 min).
    if (!this._veille) {
      this._veille = setInterval(() => {
        const n = this.aFacturer().map((f) => f.id).join();
        if (n === this._vus) return;
        this._vus = n;
        CC.facturesView.render();
        if (CC.renderAFacturer) CC.renderAFacturer();
      }, 5 * 60 * 1000);
    }
    await this.charger();
    const r = this.synchroniser();
    if (r && (r.ajout || r.maj || r.suppr)) {
      const p = [r.ajout && `${r.ajout} ajoutée(s)`, r.maj && `${r.maj} ajustée(s)`, r.suppr && `${r.suppr} retirée(s)`].filter(Boolean);
      CC.toast(`Prévisionnel mis à jour d'après l'agenda : ${p.join(', ')}.`, 'ok');
    }
    return r;
  },

  // Rendez-vous chiffrés : { e, jour, heures, tarif, montant }, et les non reconnus.
  _calcul() {
    const lignes = [], inconnus = [];
    const ign = new Set(this.reglages().ignores);
    (this._events || []).forEach((e) => {
      const d = new Date(e.debut);
      if (isNaN(d.getTime())) return;
      const tf = this.tarifDe(e.titre);
      let heures = 0;
      if (!e.journee && e.fin) heures = Math.max(0, (new Date(e.fin) - d) / 3600000);
      if (!tf) {
        if (!e.journee && heures > 0 && !ign.has(this._groupe(e.titre))) inconnus.push({ e, heures });
        return;
      }
      let montant;
      if (tf.unite === 'seance') montant = +tf.montant || 0;
      else {
        if (e.journee) return;    // journée entière sans horaire : rien à multiplier
        montant = heures * (+tf.montant || 0);
      }
      lignes.push({ e, d, jour: pvKey(d), mk: pvMk(d), heures, tarif: tf, montant });
    });
    return { lignes, inconnus };
  },

  // URSSAF + impôt sur un ensemble de lignes (taux du trimestre de chaque rendez-vous).
  _net(lignes) {
    const s = CC.state.settings;
    let ca = 0, urssaf = 0;
    lignes.forEach((l) => {
      ca += l.montant;
      urssaf += l.montant * CC.urssafRate(l.d.getFullYear(), Math.floor(l.d.getMonth() / 3) + 1) / 100;
    });
    const impot = s.versementActif ? ca * (+s.tauxImpot || 0) / 100 : 0;
    return { ca, urssaf, impot, net: ca - urssaf - impot, heures: lignes.reduce((a, l) => a + l.heures, 0) };
  },

  // Regroupe les rendez-vous non reconnus par leur premier mot (« STM », « AMU »…).
  _groupe(titre) { return pvNorm(titre).trim().split(' ')[0] || ''; },

  // Rendez-vous [{ e, heures }] regroupés par intitulé (lieu). Un intitulé qui en
  // contient un autre s'y range : « Villa Les Lucioles » rejoint « Les Lucioles »,
  // pour qu'un seul mot-clé attrape les deux.
  _sousGroupes(items) {
    const m = {};
    items.forEach(({ e, heures }) => {
      const s = pvSous(e.titre);
      if (!s.cle) return;
      const x = m[s.cle] = m[s.cle] || { cle: s.cle, noms: {}, n: 0, h: 0 };
      x.n++; x.h += heures; x.noms[s.nom] = (x.noms[s.nom] || 0) + 1;
    });
    const liste = Object.values(m).sort((a, b) => a.cle.length - b.cle.length);
    const gardes = [];
    liste.forEach((x) => {
      const hote = gardes.find((g) => (' ' + x.cle + ' ').includes(' ' + g.cle + ' '));
      if (!hote) { gardes.push(x); return; }
      hote.n += x.n; hote.h += x.h;
      Object.keys(x.noms).forEach((k) => (hote.noms[k] = (hote.noms[k] || 0) + x.noms[k]));
    });
    gardes.forEach((g) => { g.nom = Object.keys(g.noms).sort((a, b) => g.noms[b] - g.noms[a])[0]; });
    return gardes.sort((a, b) => b.n - a.n);
  },

  async render() {
    const box = document.getElementById('pvBody');
    if (!box) return;
    if (!this._events) box.innerHTML = '<div class="ck-empty">Lecture de l\'agenda…</div>';
    await this.charger();
    this.synchroniser();
    this.paint();
  },

  paint() {
    const box = document.getElementById('pvBody');
    if (!box) return;
    if (!this._events) {
      const pasConnecte = /connect/i.test(this._erreur);
      box.innerHTML = `<div class="card pv-vide">
        <h3>${pasConnecte ? 'Google Agenda n\'est pas connecté' : 'Agenda indisponible'}</h3>
        <p class="card-sub">${pasConnecte ? 'Les prévisions se calculent à partir de tes rendez-vous : connecte Google Agenda dans les Paramètres.' : pvEsc(this._erreur)}</p>
        <button class="btn btn-primary" data-pv="${pasConnecte ? 'parametres' : 'actualiser'}">${pasConnecte ? 'Ouvrir les Paramètres' : 'Réessayer'}</button>
      </div>`;
      return;
    }
    const { lignes, inconnus } = this._calcul();
    const m = this._month();
    const mk = pvMk(m);
    const duMois = lignes.filter((l) => l.mk === mk);
    const now = new Date();
    const auj = pvKey(now);

    let html = '';
    if (this._savedAt) {
      html += `<div class="agenda-offline"><span class="ao-ic">⚠</span>
        <div>Agenda injoignable : calcul fait sur la synchro du <b>${pvEsc(new Date(this._savedAt).toLocaleString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }))}</b>.</div>
        <button class="lnk" data-pv="actualiser">Réessayer</button></div>`;
    }

    // ---- En-tête : mois affiché ----
    html += `<div class="pv-nav">
      <button class="btn btn-icon" data-pv="prev" aria-label="Mois précédent">‹</button>
      <h3>${PV_MOIS[m.getMonth()].replace(/^./, (c) => c.toUpperCase())} ${m.getFullYear()}</h3>
      <button class="btn btn-icon" data-pv="next" aria-label="Mois suivant">›</button>
      ${mk !== pvMk(now) ? '<button class="lnk" data-pv="auj">Revenir à ce mois-ci</button>' : ''}
      <span class="spacer"></span>
      <button class="btn" data-pv="actualiser">Actualiser</button>
    </div>`;

    // ---- Plaque : CA du mois, net, déjà fait / à venir ----
    const tot = this._net(duMois);
    const fait = this._net(duMois.filter((l) => (l.e.fin ? new Date(l.e.fin) : l.d) <= now));
    const reste = tot.ca - fait.ca;
    const enCours = mk === pvMk(now);
    const part = tot.ca > 0 ? fait.ca / tot.ca * 100 : 0;
    const taux = tot.ca > 0 ? (tot.urssaf + tot.impot) / tot.ca * 100 : 0;
    const jourJ = lignes.filter((l) => l.jour === auj);
    const caJ = jourJ.reduce((a, l) => a + l.montant, 0);
    const jauge = enCours && tot.ca > 0 ? `<div class="pe-jauge">
        <div class="pe-jauge-barre" role="img" aria-label="Déjà fait ${CC.util.eur0(fait.ca)}, à venir ${CC.util.eur0(reste)}"><span style="width:${part.toFixed(1)}%"></span></div>
        <div class="pe-jauge-leg">
          <span class="paye"><i></i>Déjà fait <b>${CC.util.eur0(fait.ca)}</b></span>
          <span class="avenir"><i></i>À venir <b>${CC.util.eur0(reste)}</b></span>
        </div>
      </div>` : '';
    html += `<div class="today-hero"><div class="hero-plaque pv-plaque">
      <p class="hero-l"><span class="hero-voyant" aria-hidden="true"></span>CA prévu en ${PV_MOIS[m.getMonth()]}</p>
      <p class="hero-v"><span class="hero-n">${CC.util.eur0(tot.ca).replace(/\s?€$/, '')}</span><span class="hero-e">€</span></p>
      <p class="pv-net">Net <b>${CC.util.eur0(tot.net)}</b> <span>après ${CC.state.settings.versementActif ? 'URSSAF et impôt' : 'URSSAF'} (${CC.util.pct(taux)})</span></p>
      ${jauge}
      <p class="hero-d">${tot.heures ? pvHeures(tot.heures) + ' facturables' : 'Aucun rendez-vous reconnu ce mois-ci'}${enCours && caJ ? ' · aujourd’hui ' + CC.util.eur0(caJ) : ''}</p>
    </div></div>`;

    // ---- Jour par jour (mois affiché) + mois par mois ----
    const parJour = {};
    duMois.forEach((l) => (parJour[l.jour] = parJour[l.jour] || []).push(l));
    const jours = Object.keys(parJour).sort();
    const jourHtml = jours.map((k) => {
      const ls = parJour[k].sort((a, b) => a.d - b.d);
      const [y, mo, da] = k.split('-').map(Number);
      const nom = new Date(y, mo - 1, da).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
      const somme = ls.reduce((a, l) => a + l.montant, 0);
      const passe = k < auj ? ' passe' : (k === auj ? ' auj' : '');
      return `<div class="pv-jour${passe}">
        <div class="pv-jour-t"><span>${pvEsc(nom)}</span><b>${CC.util.eur0(somme)}</b></div>
        ${ls.map((l) => `<div class="pv-rdv">
          <span class="pv-rdv-h">${l.e.journee ? 'journée' : pvHeure(l.e.debut)}</span>
          <span class="pv-rdv-t">${pvEsc(l.e.titre)}<small>${pvEsc(l.tarif.nom)} · ${l.tarif.unite === 'seance' ? 'forfait' : pvHeures(l.heures) + ' × ' + CC.util.eur0(l.tarif.montant)}</small></span>
          <span class="pv-rdv-m">${CC.util.eur0(l.montant)}</span>
        </div>`).join('')}
      </div>`;
    }).join('');

    // Mois par mois : du mois en cours jusqu'au dernier mois qui a quelque chose.
    const moisListe = [];
    const dernier = lignes.reduce((a, l) => (l.mk > a ? l.mk : a), pvMk(now));
    for (let d = new Date(now.getFullYear(), now.getMonth(), 1); pvMk(d) <= dernier; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) moisListe.push(d);
    let totCa = 0, totNet = 0;
    const moisHtml = moisListe.map((d) => {
      const k = pvMk(d);
      const r = this._net(lignes.filter((l) => l.mk === k));
      totCa += r.ca; totNet += r.net;
      return `<tr class="${k === mk ? 'pv-sel' : ''}" data-pv-mois="${k}">
        <td>${PV_MOIS[d.getMonth()].replace(/^./, (c) => c.toUpperCase())} ${d.getFullYear() !== now.getFullYear() ? d.getFullYear() : ''}</td>
        <td class="num pv-h">${r.heures ? pvHeures(r.heures) : '—'}</td>
        <td class="num">${CC.util.eur0(r.ca)}</td>
        <td class="num montant">${CC.util.eur0(r.net)}</td>
      </tr>`;
    }).join('');
    const finTxt = moisListe.length ? PV_MOIS[moisListe[moisListe.length - 1].getMonth()] + ' ' + moisListe[moisListe.length - 1].getFullYear() : '';

    html += `<div class="pv-grid">
      <div class="card">
        <h3>Jour par jour</h3>
        <p class="card-sub">${jours.length ? `${duMois.length} rendez-vous reconnu(s) en ${PV_MOIS[m.getMonth()]}.` : 'Rien de reconnu ce mois-ci : ajoute un tarif ci-dessous.'}</p>
        <div class="pv-jours">${jourHtml}</div>
      </div>
      <div class="card">
        <h3>Mois par mois</h3>
        <p class="card-sub">${moisListe.length > 1 ? `D'ici ${finTxt}, d'après ton agenda.` : 'Ce que dit ton agenda.'} Touche un mois pour le détail. Les factures prévisionnelles suivent toutes seules : une par client et par mois, sans ce qui est déjà facturé.</p>
        <div class="table-wrap"><table class="table pv-table">
          <thead><tr><th>Mois</th><th class="num pv-h">Heures</th><th class="num">CA</th><th class="num">Net</th></tr></thead>
          <tbody>${moisHtml}</tbody>
          <tfoot><tr><td>Total</td><td class="pv-h"></td><td class="num">${CC.util.eur0(totCa)}</td><td class="num montant">${CC.util.eur0(totNet)}</td></tr></tfoot>
        </table></div>
      </div>
    </div>`;

    html += this._htmlTarifs(inconnus, lignes);
    box.innerHTML = html;
    if (this._edit) this._remplir();
  },

  // ---- Tarifs + rendez-vous non reconnus ----
  _htmlTarifs(inconnus, lignes) {
    const tarifs = this.reglages().tarifs;
    const bouton = (x, txt) => `<button class="mini-btn" data-pv-ajout="${pvEsc(x.cle)}" data-pv-nom="${pvEsc(x.nom)}">${txt}</button>`;
    const liste = tarifs.map((t) => {
      // Ce que ce tarif attrape dans l'agenda, lieu par lieu, avec de quoi en sortir un.
      const pris = lignes.filter((l) => l.tarif === t);
      const sous = this._sousGroupes(pris);
      const mots = String(t.mots || t.nom).split(',').map((m) => pvNorm(m).trim());
      const detail = sous.length > 1 ? `<details class="pv-capte"><summary>${pris.length} rendez-vous · ${sous.length} intitulés</summary>
          ${sous.map((x) => `<div class="pv-capte-l"><span>${pvEsc(x.nom)} <small>${x.n} rdv</small></span>${mots.includes(x.cle) ? '' : bouton(x, 'Tarif à part')}</div>`).join('')}
        </details>` : `<div class="pv-mots">${pris.length} rendez-vous</div>`;
      return `<tr class="${this._edit === t.id ? 'pe-en-cours' : ''}">
        <td class="client">${pvEsc(t.nom)}<div class="pv-mots">mots : ${pvEsc(t.mots || t.nom)} · facturé à ${pvEsc(this.clientDe(t))}</div>${detail}</td>
        <td class="num montant">${CC.util.eur(+t.montant || 0)}<span class="pe-freq">${t.unite === 'seance' ? '/séance' : '/h'}</span></td>
        <td class="col-actions"><button class="mini-btn" data-pv-edit="${t.id}">Modifier</button> <button class="mini-btn" data-pv-del="${t.id}">Suppr.</button></td>
      </tr>`;
    }).join('');

    // Non reconnus, regroupés par premier mot, du plus fréquent au plus rare.
    const g = {};
    inconnus.forEach(({ e, heures }) => {
      const k = this._groupe(e.titre);
      if (!k) return;
      const x = g[k] = g[k] || { k, n: 0, h: 0, ex: e.titre, items: [] };
      x.n++; x.h += heures; x.items.push({ e, heures });
    });
    const groupes = Object.values(g).sort((a, b) => b.n - a.n);
    groupes.forEach((x) => { x.sous = this._sousGroupes(x.items); });
    const sugg = groupes.length ? `<div class="pv-sugg">
        <h4>Pas encore reconnus</h4>
        <p class="card-sub">Rendez-vous de ton agenda sans tarif, rangés par préfixe puis par lieu. Un tarif par lieu, un pour tout le préfixe, ou « Ignorer » pour le perso.</p>
        ${groupes.map((x) => {
          const plusieurs = x.sous.length > 1;
          return `<div class="pv-sugg-g">
          <div class="pv-sugg-l">
            <span class="pv-sugg-t"><b>${pvEsc(x.k)}</b> · ${x.n} rendez-vous, ${pvHeures(x.h)}<small>${plusieurs ? x.sous.length + ' intitulés différents' : 'ex. ' + pvEsc(x.ex)}</small></span>
            <button class="mini-btn" data-pv-ajout="${pvEsc(x.k)}">${plusieurs ? 'Un tarif pour tout' : 'Mettre un tarif'}</button>
            <button class="mini-btn" data-pv-ign="${pvEsc(x.k)}">Ignorer</button>
          </div>
          ${plusieurs ? `<div class="pv-sugg-sous">${x.sous.map((y) => `<div class="pv-sugg-l">
            <span class="pv-sugg-t">${pvEsc(y.nom)}<small>${y.n} rendez-vous, ${pvHeures(y.h)}</small></span>
            ${bouton(y, 'Mettre un tarif')}
          </div>`).join('')}</div>` : ''}
        </div>`;
        }).join('')}
      </div>` : '';
    const nbIgn = this.reglages().ignores.length;

    return `<div class="card pv-tarifs">
      <h3>Mes tarifs</h3>
      <p class="card-sub">Un rendez-vous dont le titre contient un des mots est compté avec ce tarif. Montant hors TVA.</p>
      <div class="pv-tarifs-g">
        <form class="pv-form" id="pv_form" autocomplete="off">
          <h4 id="pv_titre">Ajouter une presta</h4>
          <div class="field full"><label for="pv_nom">Nom</label>
            <input type="text" id="pv_nom" class="input" placeholder="ex. Studio M" maxlength="60"></div>
          <div class="field full"><label for="pv_mots">Mots dans le titre de l'agenda</label>
            <input type="text" id="pv_mots" class="input" placeholder="ex. STM (plusieurs : séparés par des virgules)" maxlength="200"></div>
          <div class="field full"><label for="pv_client">Client sur la facture</label>
            <input type="text" id="pv_client" class="input" list="pv_clients" placeholder="ex. IME Val Paillon" maxlength="80">
            <datalist id="pv_clients">${[...new Set(CC.state.factures.map((f) => CC.util.clientNom(f.libelle)))].sort((a, b) => a.localeCompare(b, 'fr')).map((n) => `<option value="${pvEsc(n)}">`).join('')}</datalist></div>
          <div class="field-row">
            <div class="field"><label for="pv_montant">Tarif (€)</label>
              <input type="text" id="pv_montant" class="input mask-amount" inputmode="decimal" placeholder="ex. 45"></div>
            <div class="field"><label for="pv_unite">Compté</label>
              <select id="pv_unite" class="input"><option value="heure">à l'heure</option><option value="seance">à la séance</option></select></div>
          </div>
          <div class="btn-row">
            <button type="submit" id="pv_save" class="btn btn-primary">Ajouter</button>
            <button type="button" id="pv_cancel" class="btn hidden">Annuler</button>
          </div>
        </form>
        <div>
          ${tarifs.length ? `<div class="table-wrap"><table class="table pv-tarifs-t"><tbody>${liste}</tbody></table></div>` : '<p class="cj-vide">Aucun tarif pour l\'instant.</p>'}
          ${sugg}
          ${nbIgn ? `<p class="pv-ign">${nbIgn} groupe(s) ignoré(s) · <button class="lnk" data-pv="reprendre">tout reprendre</button></p>` : ''}
        </div>
      </div>
    </div>`;
  },

  _remplir(d) {
    const tf = d || (this._edit && this.reglages().tarifs.find((t) => t.id === this._edit)) || {};
    const $ = (id) => document.getElementById(id);
    if (!$('pv_nom')) return;
    $('pv_nom').value = tf.nom || '';
    $('pv_mots').value = tf.mots || '';
    $('pv_client').value = tf.client || (tf.nom ? this.clientDe(tf) : '');
    $('pv_montant').value = tf.montant != null ? String(tf.montant).replace('.', ',') : '';
    $('pv_unite').value = tf.unite || 'heure';
    const edit = !!this._edit;
    $('pv_titre').textContent = edit ? 'Modifier la presta' : 'Ajouter une presta';
    $('pv_save').textContent = edit ? 'Enregistrer' : 'Ajouter';
    $('pv_cancel').classList.toggle('hidden', !edit);
  },

  enregistrer() {
    const v = (id) => (document.getElementById(id).value || '').trim();
    const montant = parseFloat(v('pv_montant').replace(/\s/g, '').replace(',', '.'));
    const t = { nom: v('pv_nom'), mots: v('pv_mots'), client: v('pv_client'), montant: Math.round(montant * 100) / 100, unite: v('pv_unite') === 'seance' ? 'seance' : 'heure' };
    if (!t.nom) { CC.toast('Donne un nom à la presta.', 'err'); document.getElementById('pv_nom').focus(); return; }
    if (!t.mots) t.mots = t.nom;
    if (!(t.montant > 0)) { CC.toast('Indique un tarif.', 'err'); document.getElementById('pv_montant').focus(); return; }
    const r = this.reglages();
    const ex = this._edit && r.tarifs.find((x) => x.id === this._edit);
    if (ex) Object.assign(ex, t); else r.tarifs.push(Object.assign({ id: CC.util.uid() }, t));
    // Un groupe écarté qui reçoit un tarif n'a plus à être ignoré.
    r.ignores = r.ignores.filter((k) => !pvNorm(t.mots).includes(' ' + k + ' '));
    CC.toast(ex ? 'Tarif modifié.' : 'Tarif ajouté.', 'ok');
    this._edit = null;
    CC.markDirty();
    this.synchroniser();
    this.paint();
  },

  async supprimer(id) {
    const r = this.reglages();
    const t = r.tarifs.find((x) => x.id === id);
    if (!t) return;
    const ok = await CC.dialog({ type: 'question', title: 'Supprimer le tarif', message: `Supprimer « ${t.nom} » ?`, buttons: ['Supprimer', 'Annuler'], defaultId: 1, cancelId: 1 });
    if (!ok || ok.response !== 0) return;
    r.tarifs = r.tarifs.filter((x) => x.id !== id);
    if (this._edit === id) this._edit = null;
    CC.markDirty();
    this.paint();
  },

  bind() {
    const box = document.getElementById('pvBody');
    if (!box || this._bound) return;
    this._bound = true;
    box.addEventListener('submit', (e) => { if (e.target.id === 'pv_form') { e.preventDefault(); CC.previsions.enregistrer(); } });
    box.addEventListener('click', (e) => {
      const P = CC.previsions;
      const b = e.target.closest('[data-pv]');
      if (b) {
        const a = b.dataset.pv, m = P._month();
        if (a === 'prev') P.cur = new Date(m.getFullYear(), m.getMonth() - 1, 1);
        if (a === 'next') P.cur = new Date(m.getFullYear(), m.getMonth() + 1, 1);
        if (a === 'auj') P.cur = null;
        if (a === 'parametres') return CC.switchTab('settings');
        if (a === 'reprendre') { P.reglages().ignores = []; CC.markDirty(); }
        if (a === 'actualiser') { b.disabled = true; return P.charger(true).then(() => { P.synchroniser(); P.paint(); }); }
        return P.paint();
      }
      const tr = e.target.closest('tr[data-pv-mois]');
      if (tr) {
        const [y, mo] = tr.dataset.pvMois.split('-').map(Number);
        P.cur = new Date(y, mo - 1, 1);
        P.paint();
        const nav = box.querySelector('.pv-nav');
        if (nav && nav.scrollIntoView) nav.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (e.target.id === 'pv_cancel') { P._edit = null; return P.paint(); }
      const ed = e.target.closest('[data-pv-edit]');
      if (ed) { P._edit = ed.dataset.pvEdit; P.paint(); P._focus(); return; }
      const del = e.target.closest('[data-pv-del]');
      if (del) return P.supprimer(del.dataset.pvDel);
      const aj = e.target.closest('[data-pv-ajout]');
      if (aj) {
        P._edit = null;
        P.paint();
        const k = aj.dataset.pvAjout;
        P._remplir({ nom: aj.dataset.pvNom || (k.charAt(0) + k.slice(1).toLowerCase()), mots: k, unite: 'heure' });
        P._focus('pv_montant');
        return;
      }
      const ig = e.target.closest('[data-pv-ign]');
      if (ig) {
        const r = P.reglages();
        if (!r.ignores.includes(ig.dataset.pvIgn)) r.ignores.push(ig.dataset.pvIgn);
        CC.markDirty();
        P.paint();
      }
    });
  },

  _focus(id) {
    const f = document.getElementById('pv_form');
    if (f && f.scrollIntoView) f.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const el = document.getElementById(id || 'pv_nom');
    if (el) el.focus({ preventScroll: true });
  }
};
