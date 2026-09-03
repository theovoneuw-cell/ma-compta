'use strict';
window.CC = window.CC || {};

CC.facturesView = {
  current() {
    const S = CC.state;
    let list = CC.stats.forYear(S.factures, S.selectedYear);
    const f = S.filters;
    if (f.status !== 'all') list = list.filter((x) => CC.stats.statut(x, S.settings) === f.status);
    if (f.trimestre !== 'all') list = list.filter((x) => CC.stats.trimOf(x) === parseInt(f.trimestre, 10));
    if (f.categorie && f.categorie !== 'all') list = list.filter((x) => (x.categorie || CC.util.categoryOf(x.libelle)) === f.categorie);
    if (f.pj === 'with') list = list.filter((x) => !!x.fichier);
    else if (f.pj === 'without') list = list.filter((x) => !x.fichier);
    if (f.search) {
      const q = f.search.toLowerCase();
      list = list.filter((x) => (x.libelle || '').toLowerCase().includes(q) || (x.numFacture || '').toLowerCase().includes(q) || (x.modePaiement || '').toLowerCase().includes(q));
    }
    const { key, dir } = S.sort;
    const mul = dir === 'asc' ? 1 : -1;
    // Priorité de statut : ce qui est à relancer d'abord (retard, puis attente).
    const STATUT_RANK = { retard: 0, attente: 1, prevu: 2, recue: 3 };
    list.sort((a, b) => {
      let va, vb;
      if (key === 'montant') { va = +a.montant; vb = +b.montant; }
      else if (key === 'statut') { va = STATUT_RANK[CC.stats.statut(a, S.settings)] ?? 9; vb = STATUT_RANK[CC.stats.statut(b, S.settings)] ?? 9; }
      else if (key === 'periode') { va = (CC.stats.yearOf(a) || 0) * 10 + (CC.stats.trimOf(a) || 0); vb = (CC.stats.yearOf(b) || 0) * 10 + (CC.stats.trimOf(b) || 0); }
      else { va = (a[key] || '').toString().toLowerCase(); vb = (b[key] || '').toString().toLowerCase(); }
      if (va < vb) return -mul; if (va > vb) return mul;
      // Départage : échéance/encaissement le plus récent d'abord.
      const da = a.dateEcheance || a.dateEncaissement || '', db = b.dateEcheance || b.dateEncaissement || '';
      return db.localeCompare(da);
    });
    return list;
  },

  render() {
    const S = CC.state;
    const list = CC.facturesView.current();
    const body = document.getElementById('facturesBody');
    const labels = { recue: 'Reçue', attente: 'En attente', retard: 'En retard', prevu: 'Prévisionnel' };
    let total = 0, enc = 0;

    body.innerHTML = list.map((f) => {
      const st = CC.stats.statut(f, S.settings);
      total += +f.montant || 0;
      if (st === 'recue') enc += +f.montant || 0;
      const y = CC.stats.yearOf(f), t = CC.stats.trimOf(f);
      const periode = y ? `${y}${t ? ' · T' + t : ''}` : '—';
      // "Marquer reçue" pour les factures emises non payees ; pour une previsionnelle, "Marquer émise"
      let quick = '';
      if (st === 'attente' || st === 'retard') quick = `<button class="mini-btn go-green" data-act="recue" data-id="${f.id}" title="Marquer comme reçue">Reçue ✓</button> `;
      else if (st === 'prevu') quick = `<button class="mini-btn" data-act="emise" data-id="${f.id}" title="Donner un n° = facture émise">Émise</button> `;
      else if (st === 'recue') quick = `<button class="mini-btn" data-act="unrecue" data-id="${f.id}" title="Annuler l'encaissement (remettre en attente)">↩ Annuler</button> `;
      const pj = f.fichier ? `<button class="mini-btn pj-btn" data-act="pj" data-id="${f.id}" title="Ouvrir la facture PDF" aria-label="Ouvrir la facture PDF">${ICON_CLIP}</button> ` : '';
      return `<tr class="frow ${st}">
        <td class="fdate" data-label="Encaissé le">${f.dateEncaissement ? CC.util.frDate(f.dateEncaissement) : '<span class="muted">—</span>'}</td>
        <td class="fmeta" data-label="Période">${periode}</td>
        <td class="fmeta" data-label="N°">${esc(f.numFacture) || '<span class="muted">—</span>'}</td>
        <td class="client" data-label="Client">${esc(f.libelle)} <span class="cat-chip">${esc(f.categorie || CC.util.categoryOf(f.libelle))}</span></td>
        <td class="num montant" data-label="Montant">${CC.util.eur(+f.montant || 0)}</td>
        <td data-label="Statut"><span class="stpill ${st}">${labels[st]}</span></td>
        <td class="col-actions">${pj}${quick}<button class="mini-btn" data-act="edit" data-id="${f.id}">Éditer</button></td>
      </tr>`;
    }).join('');

    document.getElementById('facturesEmpty').classList.toggle('hidden', list.length > 0);
    // TTC, comme les lignes du tableau (CC.stats.sums renvoie du HT, qui est la
    // bonne unite pour le fiscal mais pas pour un recapitulatif de creances).
    let prevuTtc = 0;
    list.forEach((f) => { if (CC.stats.statut(f, S.settings) === 'prevu') prevuTtc += +f.montant || 0; });
    const prevuTxt = prevuTtc > 0 ? ` · Prévisionnel ${CC.util.eur0(prevuTtc)}` : '';
    document.getElementById('facturesSummary').textContent =
      `${list.length} facture(s) — Total ${CC.util.eur0(total)} · Encaissé ${CC.util.eur0(enc)}${prevuTxt}`;
  },

  openModal(facture) {
    const e = facture || {};
    const isEdit = !!facture;
    document.getElementById('modalTitle').textContent = isEdit ? 'Modifier la facture' : 'Nouvelle facture';
    document.getElementById('f_id').value = isEdit ? e.id : '';
    document.getElementById('f_libelle').value = e.libelle || '';
    document.getElementById('f_montant').value = isEdit ? e.montant : '';
    document.getElementById('f_numFacture').value = e.numFacture || '';
    document.getElementById('f_modePaiement').value = e.modePaiement || '';
    document.getElementById('f_categorie').value = e.categorie || (e.libelle ? CC.util.categoryOf(e.libelle) : 'Autre');
    const now = new Date();
    document.getElementById('f_annee').value = e.annee || now.getFullYear();
    document.getElementById('f_trimestre').value = e.trimestre || (Math.floor(now.getMonth() / 3) + 1);
    document.getElementById('f_previsionnel').checked = isEdit ? CC.stats.isPrevu(e) : false;
    document.getElementById('f_recue').checked = !!e.dateEncaissement;
    CC.dp.set(CC.dp.byInput('f_dateEncaissement'), e.dateEncaissement || '');
    CC.dp.set(CC.dp.byInput('f_dateEnvoi'), e.dateEnvoi || '');
    CC.dp.set(CC.dp.byInput('f_dateEcheance'), e.dateEcheance || '');
    document.getElementById('f_notes').value = e.notes || '';
    CC.facturesView.syncTva(e, isEdit);   // apres les dates : c'est la periode qui decide du taux
    CC.facturesView.setPj(e.fichier || '');
    document.getElementById('btnDeleteFacture').classList.toggle('hidden', !isEdit);
    document.getElementById('modalFacture').classList.remove('hidden');
    syncPrevisionnel();
    document.getElementById('f_libelle').focus();
  },

  // Affiche / masque la zone piece jointe
  setPj(filePath) {
    document.getElementById('f_fichier').value = filePath || '';
    const box = document.getElementById('pjFile');
    if (filePath) {
      document.getElementById('pjName').textContent = filePath.split(/[\\/]/).pop();
      box.classList.remove('hidden');
    } else {
      box.classList.add('hidden');
    }
  },

  // Lit le PDF choisi et pre-remplit le formulaire
  async importPj(file) {
    if (!file) return;
    CC.facturesView.setPj(file.path || file.name);
    try {
      const buf = await file.arrayBuffer();
      const r = await CC.pdfImporter.fromArrayBuffer(buf);
      if (r.libelle) document.getElementById('f_libelle').value = r.libelle;
      if (r.montant != null) document.getElementById('f_montant').value = r.montant;
      if (r.num) document.getElementById('f_numFacture').value = r.num;
      if (r.dateEnvoi) {
        CC.dp.set(CC.dp.byInput('f_dateEnvoi'), r.dateEnvoi);
        const env = CC.util.parseDate(r.dateEnvoi);
        if (env) CC.dp.set(CC.dp.byInput('f_dateEcheance'), CC.util.toISO(CC.util.addDays(env, r.echeanceJours || 30)));
      }
      // Mode de paiement par defaut (Indy = virement / IBAN)
      if (!document.getElementById('f_modePaiement').value) document.getElementById('f_modePaiement').value = 'Virement';
      // Categorie automatique d'apres le libelle
      const lib = document.getElementById('f_libelle').value;
      if (lib) document.getElementById('f_categorie').value = CC.util.categoryOf(lib);

      if (r.isIndy) CC.toast('Facture PDF lue : ' + (r.libelle || r.num || ''), 'ok');
      else CC.toast('PDF joint, mais format non reconnu — vérifiez les champs.', 'err');
    } catch (err) {
      CC.toast('Lecture du PDF impossible : ' + err.message, 'err');
    }
  },

  // Prepare la partie TVA de la fiche.
  //
  // Le champ n'apparait que si l'assujettissement est active dans les Parametres :
  // tant que tu es en franchise, la fiche est exactement celle d'avant. Pour une
  // facture EXISTANTE on affiche son taux tel quel, sans jamais le recalculer —
  // ce qui a ete facture a ete facture. Pour une NOUVELLE on propose le taux qui
  // correspond a sa periode, pas a la date du jour.
  syncTva(e, isEdit) {
    const champ = document.getElementById('f_tvaField');
    const sel = document.getElementById('f_tauxTva');
    if (!champ || !sel) return;
    sel._touche = false;                  // le taux n'a pas encore ete choisi a la main
    const actif = !!CC.state.settings.tvaActive;
    champ.classList.toggle('hidden', !actif);
    const mh = document.getElementById('f_montantHint');
    if (mh) mh.textContent = actif ? 'Ce que le client règle, TVA comprise.' : 'Ce que le client règle.';
    if (!actif) { sel.disabled = false; sel.value = '0'; CC.facturesView.majHt(); return; }

    if (isEdit) {
      const taux = CC.stats.tauxDe(e);
      // Un taux inhabituel (barème modifié depuis) doit rester visible plutôt
      // que d'être silencieusement ramené à zéro par le menu déroulant.
      if (taux && !Array.from(sel.options).some((o) => parseFloat(o.value) === taux)) {
        const opt = document.createElement('option');
        opt.value = String(taux); opt.textContent = String(taux).replace('.', ',') + ' %';
        sel.appendChild(opt);
      }
      sel.value = String(taux || 0);
      sel._touche = true;                 // on ne réécrit pas le taux d'une facture existante
    }
    CC.facturesView.majTaux(!isEdit);
  },

  // La date qui décide, lue dans le FORMULAIRE — elle bouge pendant la saisie.
  dateFiscaleFormulaire() {
    const recue = document.getElementById('f_recue').checked;
    const enc = document.getElementById('f_dateEncaissement').value;
    return CC.stats.dateFiscale({
      dateEncaissement: recue ? (enc || CC.util.toISO(new Date())) : '',
      dateEcheance: document.getElementById('f_dateEcheance').value,
      annee: document.getElementById('f_annee').value,
      trimestre: document.getElementById('f_trimestre').value
    });
  },

  // Applique la règle de période : une facture qui relève de l'avant-bascule est
  // en franchise, point. Le taux est forcé à zéro et le champ verrouillé — c'est
  // la garantie que l'activation ne contamine pas le passé.
  majTaux(reproposer) {
    const sel = document.getElementById('f_tauxTva');
    const s = CC.state.settings;
    if (!sel || !s.tvaActive) { CC.facturesView.majHt(); return; }
    const d = CC.facturesView.dateFiscaleFormulaire();
    const avant = !!(s.tvaDepuis && d < s.tvaDepuis);
    sel.disabled = avant;
    if (avant) sel.value = '0';
    else if (reproposer && !sel._touche) sel.value = String(CC.stats.tauxParDefaut(d, s));
    CC.facturesView.majHt(avant ? d : null);
  },

  // Rappelle en clair ce que la saisie donne : TTC, HT, et TVA. Ou, si la facture
  // relève de la franchise, pourquoi le taux est verrouillé.
  majHt(dateFranchise) {
    const hint = document.getElementById('f_tvaHint');
    if (!hint) return;
    const s = CC.state.settings;
    if (dateFranchise) {
      hint.classList.remove('calc');
      hint.textContent = `Période du ${CC.util.frDate(dateFranchise)} : avant le ${CC.util.frDate(s.tvaDepuis)}, donc en franchise. Pas de TVA sur cette facture.`;
      return;
    }
    const ttc = parseFloat(document.getElementById('f_montant').value);
    const taux = parseFloat(document.getElementById('f_tauxTva').value) || 0;
    if (!isFinite(ttc) || ttc <= 0 || !taux) { hint.textContent = ''; hint.classList.remove('calc'); return; }
    const f = { montant: ttc, tauxTva: taux };
    hint.textContent = `${CC.util.eur(ttc)} TTC = ${CC.util.eur(CC.stats.ht(f))} HT + ${CC.util.eur(CC.stats.tvaDe(f))} de TVA`;
    hint.classList.add('calc');
  },

  closeModal() { document.getElementById('modalFacture').classList.add('hidden'); },

  save() {
    const id = document.getElementById('f_id').value;
    const libelle = document.getElementById('f_libelle').value.trim();
    const montant = parseFloat(document.getElementById('f_montant').value);
    if (!libelle || isNaN(montant)) { CC.toast('Libellé et montant sont obligatoires.', 'err'); return; }

    const recue = document.getElementById('f_recue').checked;
    // Un encaissement l'emporte toujours : une facture payee ne peut pas rester previsionnelle.
    const previsionnel = !recue && document.getElementById('f_previsionnel').checked;
    let dateEnc = document.getElementById('f_dateEncaissement').value;
    if (recue && !dateEnc) dateEnc = CC.util.toISO(new Date());
    if (!recue) dateEnc = '';

    let annee = parseInt(document.getElementById('f_annee').value, 10);
    let trim = parseInt(document.getElementById('f_trimestre').value, 10);
    if (dateEnc) { annee = CC.util.yearOf(dateEnc); trim = CC.util.trimestreOfDate(dateEnc); }
    if (!annee) annee = new Date().getFullYear();
    if (!trim) trim = 1;

    // Dernier verrou avant ecriture : une facture qui releve de la periode
    // d'avant l'assujettissement ne peut pas porter de TVA, quoi qu'affiche le
    // formulaire. C'est ce qui garantit que l'activation ne touche jamais au passe.
    const saisi = parseFloat(document.getElementById('f_tauxTva').value) || 0;
    const tauxRetenu = CC.stats.enFranchise({ dateEncaissement: dateEnc, dateEcheance: document.getElementById('f_dateEcheance').value, annee, trimestre: trim }, CC.state.settings) ? 0 : saisi;

    const data = {
      libelle, montant,
      numFacture: document.getElementById('f_numFacture').value.trim(),
      modePaiement: document.getElementById('f_modePaiement').value,
      categorie: document.getElementById('f_categorie').value,
      previsionnel,
      dateEncaissement: dateEnc,
      annee, trimestre: trim,
      dateEnvoi: document.getElementById('f_dateEnvoi').value,
      dateEcheance: document.getElementById('f_dateEcheance').value,
      notes: document.getElementById('f_notes').value.trim(),
      fichier: document.getElementById('f_fichier').value,
      // 0 = franchise. On ecrit toujours la valeur : passer une facture de 20 %
      // a « sans TVA » doit pouvoir effacer le taux, pas seulement l'ignorer.
      tauxTva: tauxRetenu
    };

    if (id) {
      const idx = CC.state.factures.findIndex((x) => x.id === id);
      if (idx >= 0) CC.state.factures[idx] = { ...CC.state.factures[idx], ...data };
    } else {
      CC.state.factures.push({ id: CC.util.uid(), ...data });
    }
    CC.facturesView.closeModal();
    CC.markDirty(); CC.refreshYears(); CC.render();
    CC.toast('Facture enregistrée.');
  },

  remove() {
    const id = document.getElementById('f_id').value;
    if (!id) return;
    CC.state.factures = CC.state.factures.filter((x) => x.id !== id);
    CC.facturesView.closeModal();
    CC.markDirty(); CC.refreshYears(); CC.render();
    CC.toast('Facture supprimée.');
  },

  markRecue(id) {
    const f = CC.state.factures.find((x) => x.id === id);
    if (!f) return;
    // Mémorise l'état d'avant pour permettre une annulation exacte (clic par erreur).
    f._avantRecue = { dateEncaissement: f.dateEncaissement || '', annee: f.annee || null, trimestre: f.trimestre || null, previsionnel: f.previsionnel };
    f.previsionnel = false;
    f.dateEncaissement = CC.util.toISO(new Date());
    f.annee = CC.util.yearOf(f.dateEncaissement);
    f.trimestre = CC.util.trimestreOfDate(f.dateEncaissement);
    CC.markDirty(); CC.refreshYears(); CC.render();
    CC.toast('Facture marquée comme reçue.');
  },

  // Annule un encaissement (ex. clic "Reçue" par erreur) : remet la facture en attente.
  undoRecue(id) {
    const f = CC.state.factures.find((x) => x.id === id);
    if (!f) return;
    const prev = f._avantRecue;
    f.dateEncaissement = prev ? prev.dateEncaissement : '';
    if (prev) { f.annee = prev.annee; f.trimestre = prev.trimestre; f.previsionnel = prev.previsionnel; delete f._avantRecue; }
    CC.markDirty(); CC.refreshYears(); CC.render();
    CC.toast('Encaissement annulé — facture remise en attente.');
  },

  bind() {
    // Remplir la liste des categories (modale + filtre)
    document.getElementById('f_categorie').innerHTML = CC.CATEGORIES.map((c) => `<option>${c}</option>`).join('');
    document.getElementById('filterCategorie').innerHTML = '<option value="all">Toutes les activités</option>' +
      CC.CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('');
    document.getElementById('btnNewFacture').addEventListener('click', () => CC.facturesView.openModal(null));
    const indy = document.getElementById('btnIndy');
    if (indy) indy.addEventListener('click', () => { try { window.api.openUrl(indyUrl()); } catch (_) {} });
    // Sélecteurs de date (composant partagé, cohérent avec l'Agenda)
    if (CC.dp) CC.dp.init(document.getElementById('modalFacture'));
    document.getElementById('btnCancelModal').addEventListener('click', () => CC.facturesView.closeModal());
    // Le montant recalcule juste l'affichage HT.
    const mt = document.getElementById('f_montant');
    if (mt) ['input', 'change'].forEach((ev) => mt.addEventListener(ev, () => CC.facturesView.majHt()));
    // Choisir un taux a la main l'emporte : on ne le repropose plus ensuite.
    const tx = document.getElementById('f_tauxTva');
    if (tx) tx.addEventListener('change', () => { tx._touche = true; CC.facturesView.majHt(); });
    // Tout ce qui deplace la facture dans le temps rejoue la regle de periode :
    // c'est ce qui garantit qu'une facture d'avant la bascule reste en franchise.
    ['f_dateEncaissement', 'f_dateEcheance', 'f_annee', 'f_trimestre', 'f_recue'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => CC.facturesView.majTaux(true));
    });

    // Piece jointe (lecture PDF)
    document.getElementById('btnImportPj').addEventListener('click', () => document.getElementById('pjInput').click());
    document.getElementById('pjInput').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      CC.facturesView.importPj(file);
      e.target.value = ''; // permet de re-choisir le meme fichier
    });
    document.getElementById('btnRemovePj').addEventListener('click', () => CC.facturesView.setPj(''));
    document.getElementById('btnOpenPj').addEventListener('click', () => CC.openPj(document.getElementById('f_fichier').value));
    document.getElementById('btnDeleteFacture').addEventListener('click', () => CC.facturesView.remove());
    document.getElementById('formFacture').addEventListener('submit', (e) => { e.preventDefault(); CC.facturesView.save(); });
    document.getElementById('modalFacture').addEventListener('click', (e) => { if (e.target.id === 'modalFacture') CC.facturesView.closeModal(); });

    // « Prévisionnel » et « paiement reçu » s'excluent : une vente encaissée est réelle.
    document.getElementById('f_previsionnel').addEventListener('change', (e) => {
      if (e.target.checked && document.getElementById('f_recue').checked) {
        document.getElementById('f_recue').checked = false;
        CC.dp.set(CC.dp.byInput('f_dateEncaissement'), '');
      }
      syncPrevisionnel();
    });

    // Cocher "reçu" pré-remplit la date du jour ; la date ajuste la période
    document.getElementById('f_recue').addEventListener('change', (e) => {
      const w = CC.dp.byInput('f_dateEncaissement');
      const cur = document.getElementById('f_dateEncaissement').value;
      if (e.target.checked && !cur) CC.dp.set(w, CC.util.toISO(new Date()));
      else if (!e.target.checked) CC.dp.set(w, '');
      if (e.target.checked) document.getElementById('f_previsionnel').checked = false;
      syncPrevisionnel();
      syncPeriode();
    });
    document.getElementById('f_dateEncaissement').addEventListener('change', () => {
      const paye = !!document.getElementById('f_dateEncaissement').value;
      document.getElementById('f_recue').checked = paye;
      if (paye) document.getElementById('f_previsionnel').checked = false;
      syncPrevisionnel();
      syncPeriode();
    });

    document.getElementById('searchInput').addEventListener('input', (e) => { CC.state.filters.search = e.target.value; CC.facturesView.render(); });
    document.getElementById('filterStatus').addEventListener('change', (e) => { CC.state.filters.status = e.target.value; CC.facturesView.render(); });
    document.getElementById('filterTrimestre').addEventListener('change', (e) => { CC.state.filters.trimestre = e.target.value; CC.facturesView.render(); });
    document.getElementById('filterCategorie').addEventListener('change', (e) => { CC.state.filters.categorie = e.target.value; CC.facturesView.render(); });
    document.getElementById('filterPj').addEventListener('change', (e) => { CC.state.filters.pj = e.target.value; CC.facturesView.render(); });

    document.querySelectorAll('#facturesTable th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort, s = CC.state.sort;
        s.dir = (s.key === key && s.dir === 'asc') ? 'desc' : 'asc';
        s.key = key; CC.facturesView.render();
      });
    });

    document.getElementById('facturesBody').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'edit') { const f = CC.state.factures.find((x) => x.id === btn.dataset.id); if (f) CC.facturesView.openModal(f); }
      else if (btn.dataset.act === 'recue') CC.facturesView.markRecue(btn.dataset.id);
      else if (btn.dataset.act === 'unrecue') CC.facturesView.undoRecue(btn.dataset.id);
      else if (btn.dataset.act === 'pj') { const f = CC.state.factures.find((x) => x.id === btn.dataset.id); if (f) CC.openPj(f.fichier); }
      else if (btn.dataset.act === 'emise') {
        const f = CC.state.factures.find((x) => x.id === btn.dataset.id);
        if (f) {
          CC.facturesView.openModal(f);
          // Passer en « émise » = ce n'est plus du prévisionnel ; il reste à saisir le n°.
          document.getElementById('f_previsionnel').checked = false;
          syncPrevisionnel();
          document.getElementById('f_numFacture').focus();
        }
      }
    });
  }
};

// Le formulaire dit ce que la ligne va devenir : en prévisionnel, le bloc
// « Paiement » n'a plus de sens tant que rien n'est encaissé.
function syncPrevisionnel() {
  const on = document.getElementById('f_previsionnel').checked;
  const card = document.getElementById('prevCard');
  if (card) card.classList.toggle('on', on);
  const pay = document.getElementById('f_recue').closest('fieldset');
  if (pay) pay.classList.toggle('dim', on);
  const hint = document.getElementById('prevHint');
  if (hint) hint.textContent = on
    ? 'Vente prévue, pas encore facturée : comptée dans le prévisionnel, jamais dans le CA encaissé ni l’URSSAF. Elle sortira du prévisionnel dès que vous la marquerez « Émise ».'
    : 'Vente prévue, pas encore facturée : comptée dans le prévisionnel, jamais dans le CA encaissé ni l’URSSAF, et jamais « en retard ».';
}

function syncPeriode() {
  const d = document.getElementById('f_dateEncaissement').value;
  if (!d) return;
  document.getElementById('f_annee').value = CC.util.yearOf(d);
  document.getElementById('f_trimestre').value = CC.util.trimestreOfDate(d);
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function dotColor(st) { return st === 'recue' ? '#0ea371' : st === 'retard' ? '#dc2626' : st === 'prevu' ? '#6366f1' : '#c2740a'; }
// Destination du bouton « Facturation Indy ».
//
// Indy publie des « liens universels » (app.indy.fr/.well-known/apple-app-site-association)
// mais UNIQUEMENT pour /compte/banques, /connexion-banque et /compte-pro/encaissements.
// La page des factures (/facturation/factures) n'y figure pas : sur iPhone elle
// s'ouvre donc forcément dans Safari, jamais dans l'app.
//
// D'où deux destinations : sur iPhone on vise un chemin déclaré, ce qui ouvre bien
// l'app Indy installée (quitte à arriver sur les encaissements plutôt que sur les
// factures) ; ailleurs on garde la page des factures, plus directe.
// Si Indy élargit un jour sa liste, il suffira de remettre le même chemin partout.
function indyUrl() {
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  return iOS
    ? 'https://app.indy.fr/compte-pro/encaissements'
    : 'https://app.indy.fr/facturation/factures';
}

// Icône trombone (SVG, hérite la couleur du texte)
const ICON_CLIP = '<svg class="ic" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>';
