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
//   { id, libelle, montant, frequence: 'mois'|'trimestre'|'an', jour, categorie }
// `montant` est ce qui part à chaque prélèvement ; l'équivalent mensuel en découle.
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
    const liste = CC.perso.liste();
    const now = new Date();
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
      ? [`soit ${CC.util.eur0(total * 12)} par an`, sansJour ? `${sansJour} sans jour de prélèvement, hors jauge` : ''].filter(Boolean).join(' · ')
      : 'Ajoute ta première mensualité ci-dessous.';
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
    const liste = CC.perso.liste();
    if (!liste.length) { box.innerHTML = ''; return; }
    const now = new Date();
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
    CC.perso.liste().forEach((d) => {
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
    // Tri par jour de prélèvement ; les mensualités sans jour ferment la marche.
    const liste = CC.perso.liste().slice().sort((a, b) =>
      ((+a.jour || 99) - (+b.jour || 99)) || (a.libelle || '').localeCompare(b.libelle || '', 'fr'));
    body.innerHTML = liste.map((d) => {
      const f = PE_FREQ[d.frequence] || PE_FREQ.mois;
      const mensuel = (d.frequence || 'mois') === 'mois';
      let etat = '';
      if (mensuel && +d.jour >= 1) {
        etat = CC.perso.jourCeMois(d, now) <= now.getDate()
          ? '<span class="pe-etat passe">passé</span>'
          : '<span class="pe-etat avenir">à venir</span>';
      }
      const jour = +d.jour >= 1 ? 'le ' + (+d.jour) : '';
      const montant = `${CC.util.eur(+d.montant || 0)}<span class="pe-freq">${f.court}</span>`;
      // .pe-sous ne s'affiche que sur téléphone, où les colonnes Jour et Montant sont masquées.
      return `<tr class="${CC.perso._edit === d.id ? 'pe-en-cours' : ''}">
        <td class="fmeta pe-jour">${jour || '—'}</td>
        <td class="client pe-lib">${peEsc(d.libelle)} <span class="cat-chip">${peEsc(d.categorie || 'Autre')}</span> ${etat}
          <div class="pe-sous">${[jour, mensuel ? '' : montant].filter(Boolean).join(' · ')}</div></td>
        <td class="num pe-mt">${montant}</td>
        <td class="num montant pe-par">${CC.util.eur(CC.perso.parMois(d))}</td>
        <td class="col-actions"><button class="mini-btn" data-edit="${d.id}">Modifier</button> <button class="mini-btn" data-del="${d.id}">Suppr.</button></td>
      </tr>`;
    }).join('');
    const foot = document.getElementById('peFoot');
    if (foot) foot.innerHTML = liste.length
      ? `<tr><td class="pe-jour"></td><td class="client pe-lib">Total par mois</td><td class="pe-mt"></td><td class="num montant pe-par">${CC.util.eur(liste.reduce((s, d) => s + CC.perso.parMois(d), 0))}</td><td class="col-actions"></td></tr>`
      : '';
    if (empty) empty.classList.toggle('hidden', liste.length > 0);
  },

  // ---- Formulaire ----
  lireForm() {
    const v = (id) => (document.getElementById(id).value || '').trim();
    const montant = parseFloat(v('pe_montant').replace(/\s/g, '').replace(',', '.'));
    const jour = parseInt(v('pe_jour'), 10);
    return {
      libelle: v('pe_libelle'),
      montant: isNaN(montant) ? NaN : Math.round(montant * 100) / 100,
      frequence: PE_FREQ[v('pe_frequence')] ? v('pe_frequence') : 'mois',
      jour: jour >= 1 && jour <= 31 ? jour : null,
      categorie: v('pe_categorie') || 'Autre'
    };
  },

  remplirForm(d) {
    d = d || {};
    document.getElementById('pe_libelle').value = d.libelle || '';
    document.getElementById('pe_montant').value = d.montant != null ? String(d.montant).replace('.', ',') : '';
    document.getElementById('pe_frequence').value = d.frequence || 'mois';
    document.getElementById('pe_jour').value = d.jour || '';
    document.getElementById('pe_categorie').value = d.categorie || 'Logement';
    const edit = !!CC.perso._edit;
    document.getElementById('pe_titre').textContent = edit ? 'Modifier la mensualité' : 'Ajouter une mensualité';
    document.getElementById('pe_save').textContent = edit ? 'Enregistrer' : 'Ajouter';
    document.getElementById('pe_cancel').classList.toggle('hidden', !edit);
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
    document.getElementById('peBody').addEventListener('click', (e) => {
      const ed = e.target.closest('button[data-edit]');
      if (ed) return CC.perso.modifier(ed.dataset.edit);
      const del = e.target.closest('button[data-del]');
      if (del) CC.perso.supprimer(del.dataset.del);
    });
  }
};

function peEsc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
