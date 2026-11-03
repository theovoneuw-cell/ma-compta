'use strict';
window.CC = window.CC || {};

// ---------------------------------------------------------------------------
// Onglet « Dépenses perso » (menu Plus) : les mensualités personnelles (loyer,
// crédit, assurances, abonnements…) et ce qu'elles coûtent par mois.
//
// Rangées dans settings.depensesPerso et non à la racine du fichier, pour la
// même raison que les fiches clients : une ancienne version de l'app iPhone ne
// réécrit que les rubriques racines qu'elle connaît, mais recopie `settings` en
// entier. Une mensualité :
//   { id, libelle, montant, frequence: 'mois'|'trimestre'|'an', jour, categorie,
//     debut?, fin? }
// `montant` est ce qui part à chaque prélèvement ; l'équivalent mensuel en découle.
// `debut` et `fin` ('AAAA-MM', facultatifs, mois inclus) bornent la mensualité :
// un crédit qui se termine, un abonnement qui démarre plus tard… Sans eux elle
// court tous les mois. Hors de sa période, elle reste dans la liste mais ne
// compte plus dans les totaux.
// ---------------------------------------------------------------------------

const PE_FREQ = {
  mois: { label: 'Chaque mois', court: '/mois', div: 1 },
  trimestre: { label: 'Chaque trimestre', court: '/trim.', div: 3 },
  an: { label: 'Chaque année', court: '/an', div: 12 }
};
const PE_CATEGORIES = ['Logement', 'Crédit', 'Assurance', 'Énergie', 'Téléphone & internet', 'Abonnements', 'Transport', 'Santé', 'Épargne', 'Autre'];

CC.perso = {
  _edit: null,      // id de la mensualité en cours de modification

  liste() {
    const s = CC.state.settings;
    if (!Array.isArray(s.depensesPerso)) s.depensesPerso = [];
    return s.depensesPerso;
  },

  parMois(d) { return (+d.montant || 0) / ((PE_FREQ[d.frequence] || PE_FREQ.mois).div); },

  // ---- Durée limitée ----
  _idx(date) { return date.getFullYear() * 12 + date.getMonth(); },
  _nomMois(i) { return new Date(Math.floor(i / 12), i % 12, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); },

  _lireMois(v) {
    const m = /^(\d{4})-(\d{2})$/.exec(v || '');
    return m ? +m[1] * 12 + (+m[2] - 1) : null;
  },

  // Premier et dernier mois (indices) d'une mensualité bornée ; null = tous les mois.
  periode(d) {
    const deb = CC.perso._lireMois(d.debut), fin = CC.perso._lireMois(d.fin);
    if (deb == null && fin == null) return null;
    return { deb: deb == null ? -Infinity : deb, fin: fin == null ? Infinity : fin, aDebut: deb != null, aFin: fin != null };
  },

  // La mensualité court-elle pendant le mois de `date` ?
  active(d, date) {
    const p = CC.perso.periode(d);
    if (!p) return true;
    const i = CC.perso._idx(date || new Date());
    return i >= p.deb && i <= p.fin;
  },

  enCours(now) { return CC.perso.liste().filter((d) => CC.perso.active(d, now)); },

  // Ce que coûteront vraiment les 12 prochains mois (mois en cours compris),
  // en tenant compte des mensualités qui s'arrêtent ou commencent entre-temps.
  surDouzeMois(now) {
    let t = 0;
    for (let k = 0; k < 12; k++) {
      const m = new Date(now.getFullYear(), now.getMonth() + k, 1);
      CC.perso.liste().forEach((d) => { if (CC.perso.active(d, m)) t += CC.perso.parMois(d); });
    }
    return t;
  },

  // Ligne d'explication sous le nom : « Jusqu'en décembre 2026 · 2 prélèvements restants ».
  duree(d, now) {
    const p = CC.perso.periode(d);
    if (!p) return '';
    const i = CC.perso._idx(now);
    const nom = CC.perso._nomMois;
    if (i > p.fin) return `Terminée en ${nom(p.fin)}`;
    if (i < p.deb) return `Commence en ${nom(p.deb)}` + (p.aFin ? `, jusqu’en ${nom(p.fin)}` : '');
    if (!p.aFin) return `Depuis ${nom(p.deb)}`;
    let txt = `Jusqu’en ${nom(p.fin)}`;
    if ((d.frequence || 'mois') === 'mois') {
      // Le prélèvement du mois compte tant qu'il n'est pas passé.
      const passe = +d.jour >= 1 && CC.perso.jourCeMois(d, now) <= now.getDate();
      const n = p.fin - i + (passe ? 0 : 1);
      txt += n ? ` · ${n} prélèvement${n > 1 ? 's' : ''} restant${n > 1 ? 's' : ''}` : ' · dernier prélèvement passé';
    }
    return txt;
  },

  // Jour réel du prélèvement ce mois-ci (un « 31 » tombe le 30 en avril).
  jourCeMois(d, now) {
    const dernier = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return Math.min(+d.jour, dernier);
  },

  render() {
    if (!document.getElementById('tab-perso')) return;
    CC.perso.renderHero();
    CC.perso.renderReste();
    CC.perso.renderCategories();
    CC.perso.renderList();
  },

  renderHero() {
    const box = document.getElementById('peHero');
    if (!box) return;
    const now = new Date();
    const liste = CC.perso.enCours(now);
    const total = liste.reduce((s, d) => s + CC.perso.parMois(d), 0);
    // « Ce mois-ci » : seules les mensualités avec un jour connu se placent dans le mois.
    let passe = 0, reste = 0, nPasse = 0, nReste = 0, sansJour = 0;
    liste.forEach((d) => {
      if (d.frequence !== 'mois' && d.frequence) return;
      if (!(+d.jour >= 1)) { sansJour++; return; }
      if (CC.perso.jourCeMois(d, now) <= now.getDate()) { passe += +d.montant || 0; nPasse++; }
      else { reste += +d.montant || 0; nReste++; }
    });
    const part = (passe + reste) > 0 ? passe / (passe + reste) * 100 : 0;
    const prel = (n) => n + ' prélèvement' + (n > 1 ? 's' : '');
    const mois = now.toLocaleDateString('fr-FR', { month: 'long' });
    const jauge = (passe + reste) > 0 ? `<div class="pe-jauge">
        <p class="pe-jauge-t">En ${mois}</p>
        <div class="pe-jauge-barre" role="img" aria-label="Déjà payé ${CC.util.eur0(passe)}, à venir ${CC.util.eur0(reste)}">
          <span style="width:${part.toFixed(1)}%"></span>
        </div>
        <div class="pe-jauge-leg">
          <span class="paye"><i></i>Déjà payé <b>${CC.util.eur0(passe)}</b><small>${prel(nPasse)}</small></span>
          <span class="avenir"><i></i>À venir <b>${CC.util.eur0(reste)}</b><small>${nReste ? prel(nReste) : 'tout est passé'}</small></span>
        </div>
      </div>` : '';
    const details = liste.length
      ? [`soit ${CC.util.eur0(CC.perso.surDouzeMois(now))} sur les 12 prochains mois`, sansJour ? `${sansJour} sans jour de prélèvement, hors jauge` : ''].filter(Boolean).join(' · ')
      : CC.perso.liste().length ? 'Aucune mensualité en cours ce mois-ci.' : 'Ajoute ta première mensualité ci-dessous.';
    box.innerHTML = `<div class="hero-plaque">
      <p class="hero-l"><span class="hero-voyant" aria-hidden="true"></span>Tes mensualités · ${prel(liste.length)}</p>
      <p class="hero-v"><span class="hero-n">${CC.util.eur0(total).replace(/\s?€$/, '')}</span><span class="hero-e">€ / mois</span></p>
      ${jauge}
      <p class="hero-d">${details}</p>
    </div>`;
  },

  // -------------------------------------------------------------------------
  // ESSAI du 04/10/2026 — « Il te reste » : ce que laisse le mois une fois
  // l'URSSAF mise de côté et les mensualités payées. Relie la compta pro au
  // perso. Bloc autonome : pour l'enlever, supprimer cette fonction, son appel
  // dans render(), le <div id="peReste"> d'index.html et les styles .pe-reste.
  // -------------------------------------------------------------------------
  // Encaissé HT, URSSAF et impôt (versement libératoire) sur une période.
  _net(debut, fin) {
    const s = CC.state.settings;
    let enc = 0, urssaf = 0;
    CC.state.factures.forEach((f) => {
      if (!CC.stats.isPaid(f)) return;
      const d = CC.util.parseDate(f.dateEncaissement);
      if (!d || d < debut || d >= fin) return;
      const ht = CC.stats.ht(f);
      enc += ht;
      urssaf += ht * CC.urssafRate(d.getFullYear(), Math.floor(d.getMonth() / 3) + 1) / 100;
    });
    const impot = s.versementActif ? enc * (+s.tauxImpot || 0) / 100 : 0;
    return { enc, urssaf, impot, net: enc - urssaf - impot };
  },

  renderReste() {
    const box = document.getElementById('peReste');
    if (!box) return;
    const now = new Date();
    const liste = CC.perso.enCours(now);
    if (!liste.length) { box.innerHTML = ''; return; }
    const mensualites = liste.reduce((s, d) => s + CC.perso.parMois(d), 0);
    const ceMois = CC.perso._net(new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 1));
    // Repère stable : les 12 derniers mois complets (le mois en cours n'est jamais fini).
    const an = CC.perso._net(new Date(now.getFullYear(), now.getMonth() - 12, 1), new Date(now.getFullYear(), now.getMonth(), 1));
    const reste = ceMois.net - mensualites;
    const resteMoy = an.net / 12 - mensualites;
    const mois = now.toLocaleDateString('fr-FR', { month: 'long' });
    const signe = (n) => (n < 0 ? '− ' : '') + CC.util.eur0(Math.abs(n));
    const charges = ceMois.urssaf + ceMois.impot;
    box.innerHTML = `<div class="card pe-reste ${reste < 0 ? 'neg' : ''}">
      <div class="pe-reste-g">
        <p class="pe-reste-l">Il te reste en ${mois}</p>
        <p class="pe-reste-v">${signe(reste)}</p>
        <p class="pe-reste-s">${reste < 0 ? 'Les encaissements du mois ne couvrent pas encore tes mensualités.' : 'une fois l’URSSAF mise de côté et tes mensualités payées'}</p>
      </div>
      <div class="pe-reste-d">
        <p class="pe-calc"><span>Encaissé en ${mois}</span><b>${CC.util.eur0(ceMois.enc)}</b></p>
        <p class="pe-calc moins"><span>URSSAF${ceMois.impot ? ' et impôt' : ''} à mettre de côté</span><b>− ${CC.util.eur0(charges)}</b></p>
        <p class="pe-calc moins"><span>Tes mensualités</span><b>− ${CC.util.eur0(mensualites)}</b></p>
        <p class="pe-moy">En moyenne sur les 12 derniers mois, il te reste <b>${signe(resteMoy)}</b> par mois.</p>
      </div>
    </div>`;
  },

  renderCategories() {
    const box = document.getElementById('peCats');
    if (!box) return;
    const parCat = {};
    CC.perso.enCours(new Date()).forEach((d) => {
      const c = d.categorie || 'Autre';
      parCat[c] = (parCat[c] || 0) + CC.perso.parMois(d);
    });
    const rangs = Object.keys(parCat).map((c) => ({ c, v: parCat[c] })).sort((a, b) => b.v - a.v);
    const total = rangs.reduce((s, r) => s + r.v, 0);
    if (!rangs.length) { box.innerHTML = '<p class="muted pe-vide">Rien pour l’instant.</p>'; return; }
    box.innerHTML = rangs.map((r) => {
      const part = total > 0 ? r.v / total * 100 : 0;
      return `<div class="gauge">
        <div class="lbl"><span class="pe-cat-nom">${peEsc(r.c)}</span><span class="bar-val">${CC.util.eur0(r.v)} <small>· ${CC.util.pct(part, 0)}</small></span></div>
        <div class="bar"><div class="fill" style="width:${part.toFixed(1)}%"></div></div>
      </div>`;
    }).join('');
  },

  renderList() {
    const body = document.getElementById('peBody');
    const empty = document.getElementById('peEmpty');
    if (!body) return;
    const now = new Date();
    // Tri par jour de prélèvement ; les mensualités sans jour ferment la marche,
    // celles qui ne courent pas ce mois-ci (terminées ou pas commencées) aussi.
    const actif = (d) => CC.perso.active(d, now);
    const liste = CC.perso.liste().slice().sort((a, b) =>
      (actif(b) - actif(a)) || ((+a.jour || 99) - (+b.jour || 99)) || (a.libelle || '').localeCompare(b.libelle || '', 'fr'));
    body.innerHTML = liste.map((d) => {
      const f = PE_FREQ[d.frequence] || PE_FREQ.mois;
      const mensuel = (d.frequence || 'mois') === 'mois';
      const enCours = actif(d);
      const p = CC.perso.periode(d);
      let etat = '';
      if (!enCours) {
        etat = CC.perso._idx(now) > p.fin
          ? '<span class="pe-etat fini">terminée</span>'
          : '<span class="pe-etat plus-tard">pas commencée</span>';
      } else if (mensuel && +d.jour >= 1) {
        etat = CC.perso.jourCeMois(d, now) <= now.getDate()
          ? '<span class="pe-etat passe">passé</span>'
          : '<span class="pe-etat avenir">à venir</span>';
      }
      const jour = +d.jour >= 1 ? 'le ' + (+d.jour) : '';
      const montant = `${CC.util.eur(+d.montant || 0)}<span class="pe-freq">${f.court}</span>`;
      // .pe-sous ne s'affiche que sur téléphone, où les colonnes Jour et Montant sont masquées.
      const duree = CC.perso.duree(d, now);
      // Grisées comme les jours passés de Prévisions : déjà prélevées ce mois-ci, ou hors période.
      const passee = enCours && mensuel && +d.jour >= 1 && CC.perso.jourCeMois(d, now) <= now.getDate();
      const classes = [CC.perso._edit === d.id ? 'pe-en-cours' : '', enCours ? '' : 'pe-inactive', passee ? 'pe-passee' : ''].filter(Boolean).join(' ');
      return `<tr class="${classes}">
        <td class="fmeta pe-jour">${jour || '—'}</td>
        <td class="client pe-lib">${peEsc(d.libelle)} <span class="cat-chip">${peEsc(d.categorie || 'Autre')}</span> ${etat}
          ${duree ? `<div class="pe-duree">${duree}</div>` : ''}
          <div class="pe-sous">${[jour, mensuel ? '' : montant].filter(Boolean).join(' · ')}</div></td>
        <td class="num pe-mt">${montant}</td>
        <td class="num montant pe-par">${enCours ? CC.util.eur(CC.perso.parMois(d)) : '—'}</td>
        <td class="col-actions"><button class="mini-btn" data-edit="${d.id}">Modifier</button> <button class="mini-btn" data-del="${d.id}">Suppr.</button></td>
      </tr>`;
    }).join('');
    const foot = document.getElementById('peFoot');
    if (foot) foot.innerHTML = liste.length
      ? `<tr><td class="pe-jour"></td><td class="client pe-lib">Total par mois</td><td class="pe-mt"></td><td class="num montant pe-par">${CC.util.eur(liste.filter(actif).reduce((s, d) => s + CC.perso.parMois(d), 0))}</td><td class="col-actions"></td></tr>`
      : '';
    if (empty) empty.classList.toggle('hidden', liste.length > 0);
  },

  // ---- Formulaire ----
  lireForm() {
    const v = (id) => (document.getElementById(id).value || '').trim();
    const montant = parseFloat(v('pe_montant').replace(/\s/g, '').replace(',', '.'));
    const jour = parseInt(v('pe_jour'), 10);
    const mois = (id) => (/^\d{4}-\d{2}$/.test(v(id)) ? v(id) : null);
    let debut = mois('pe_debut'), fin = mois('pe_fin');
    if (debut && fin && fin < debut) [debut, fin] = [fin, debut];
    return {
      libelle: v('pe_libelle'),
      montant: isNaN(montant) ? NaN : Math.round(montant * 100) / 100,
      frequence: PE_FREQ[v('pe_frequence')] ? v('pe_frequence') : 'mois',
      jour: jour >= 1 && jour <= 31 ? jour : null,
      categorie: v('pe_categorie') || 'Autre',
      debut,
      fin
    };
  },

  remplirForm(d) {
    d = d || {};
    document.getElementById('pe_libelle').value = d.libelle || '';
    document.getElementById('pe_montant').value = d.montant != null ? String(d.montant).replace('.', ',') : '';
    document.getElementById('pe_frequence').value = d.frequence || 'mois';
    document.getElementById('pe_jour').value = d.jour || '';
    document.getElementById('pe_categorie').value = d.categorie || 'Logement';
    document.getElementById('pe_debut').value = d.debut || '';
    document.getElementById('pe_fin').value = d.fin || '';
    CC.perso.aide();
    const edit = !!CC.perso._edit;
    document.getElementById('pe_titre').textContent = edit ? 'Modifier la mensualité' : 'Ajouter une mensualité';
    document.getElementById('pe_save').textContent = edit ? 'Enregistrer' : 'Ajouter';
    document.getElementById('pe_cancel').classList.toggle('hidden', !edit);
  },

  // Sous les champs Début / Fin : ce que la période veut dire, recalculé à la saisie.
  aide() {
    const box = document.getElementById('pe_aide');
    if (!box) return;
    const p = CC.perso.periode({ debut: document.getElementById('pe_debut').value, fin: document.getElementById('pe_fin').value });
    const nom = CC.perso._nomMois;
    let txt = 'Laisse vide pour un prélèvement tous les mois, sans date de fin.';
    if (p && p.aDebut && p.aFin) txt = `De ${nom(Math.min(p.deb, p.fin))} à ${nom(Math.max(p.deb, p.fin))} inclus.`;
    else if (p && p.aFin) txt = `Dernier prélèvement en ${nom(p.fin)}, inclus.`;
    else if (p) txt = `À partir de ${nom(p.deb)}, sans date de fin.`;
    box.textContent = txt;
  },

  enregistrer() {
    const d = CC.perso.lireForm();
    if (!d.libelle) { CC.toast('Donne un nom à la mensualité.', 'err'); document.getElementById('pe_libelle').focus(); return; }
    if (!(d.montant > 0)) { CC.toast('Indique un montant.', 'err'); document.getElementById('pe_montant').focus(); return; }
    const liste = CC.perso.liste();
    const existante = CC.perso._edit && liste.find((x) => x.id === CC.perso._edit);
    if (existante) Object.assign(existante, d);
    else liste.push(Object.assign({ id: CC.util.uid() }, d));
    CC.toast(existante ? 'Mensualité modifiée.' : 'Mensualité ajoutée.', 'ok');
    CC.perso._edit = null;
    CC.perso.remplirForm(null);
    CC.markDirty();
    CC.perso.render();
  },

  modifier(id) {
    const d = CC.perso.liste().find((x) => x.id === id);
    if (!d) return;
    CC.perso._edit = id;
    CC.perso.remplirForm(d);
    CC.perso.renderList();
    const form = document.getElementById('pe_form');
    if (form && form.scrollIntoView) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('pe_libelle').focus({ preventScroll: true });
  },

  annuler() {
    CC.perso._edit = null;
    CC.perso.remplirForm(null);
    CC.perso.renderList();
  },

  async supprimer(id) {
    const d = CC.perso.liste().find((x) => x.id === id);
    if (!d) return;
    const r = await CC.dialog({
      type: 'question', title: 'Supprimer la mensualité',
      message: `Supprimer « ${d.libelle} » ?`,
      buttons: ['Supprimer', 'Annuler'], defaultId: 1, cancelId: 1
    });
    if (!r || r.response !== 0) return;
    CC.state.settings.depensesPerso = CC.perso.liste().filter((x) => x.id !== id);
    if (CC.perso._edit === id) CC.perso.annuler();
    CC.markDirty();
    CC.perso.render();
  },

  bind() {
    const cat = document.getElementById('pe_categorie');
    if (!cat) return;
    cat.innerHTML = PE_CATEGORIES.map((c) => `<option>${peEsc(c)}</option>`).join('');
    document.getElementById('pe_frequence').innerHTML = Object.keys(PE_FREQ)
      .map((k) => `<option value="${k}">${PE_FREQ[k].label}</option>`).join('');
    CC.perso.remplirForm(null);
    document.getElementById('pe_form').addEventListener('submit', (e) => { e.preventDefault(); CC.perso.enregistrer(); });
    document.getElementById('pe_cancel').addEventListener('click', () => CC.perso.annuler());
    ['pe_debut', 'pe_fin'].forEach((id) => document.getElementById(id).addEventListener('input', () => CC.perso.aide()));
    document.getElementById('peBody').addEventListener('click', (e) => {
      const ed = e.target.closest('button[data-edit]');
      if (ed) return CC.perso.modifier(ed.dataset.edit);
      const del = e.target.closest('button[data-del]');
      if (del) CC.perso.supprimer(del.dataset.del);
    });
  }
};

function peEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
