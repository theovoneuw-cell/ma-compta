'use strict';
window.CC = window.CC || {};

CC.FILE_VERSION = 2;

CC.storage = {
  serialize() {
    return JSON.stringify({
      version: CC.FILE_VERSION,
      settings: CC.state.settings,
      declarations: CC.state.declarations,
      factures: CC.state.factures,
      trajets: CC.state.trajets,
      documents: CC.state.documents,
      temps: CC.state.temps
    }, null, 2);
  },

  applyData(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('Fichier invalide');
    const s = Object.assign(CC.defaultSettings(), obj.settings || {});
    if (obj.settings && obj.settings.urssafRates) s.urssafRates = obj.settings.urssafRates;
    CC.state.settings = s;
    // 0 EUR/km n'est pas un tarif, c'est un champ vide enregistre par erreur. On le
    // remplace par le bareme de la puissance fiscale des le chargement, sinon le
    // reglage reste faux dans le fichier meme si les calculs, eux, s'en sortent.
    if (!(+s.tarifKm > 0)) s.tarifKm = CC.baremeKm(s.chevauxFiscaux);
    CC.state.declarations = obj.declarations || {};
    CC.state.factures = Array.isArray(obj.factures) ? obj.factures.map(normalize) : [];
    CC.state.trajets = Array.isArray(obj.trajets) ? obj.trajets : [];
    // Coffre à documents : relu tel quel, y compris sur l'iPhone (qui ne l'affiche
    // pas mais le réécrit à l'identique — sinon un enregistrement depuis le
    // téléphone effacerait le coffre).
    CC.state.documents = Array.isArray(obj.documents) ? obj.documents : [];
    // Feuille de temps : onglet retiré, champ conservé. On ne supprime pas les
    // données d'un fichier existant parce qu'on a cessé de les afficher.
    CC.state.temps = Array.isArray(obj.temps) ? obj.temps.map(normTemps) : [];
    // Le pense-bête vit désormais dans son propre fichier Drive (notes.json).
    // On garde juste une graine de migration si un ancien fichier compta en contenait.
    if (Array.isArray(obj.notes) && obj.notes.length) CC.state._notesSeed = obj.notes;
  },

  // `discret` : pas de fenetre, pas de message de reussite. Utilise par
  // l'enregistrement automatique, qui ne doit jamais interrompre la saisie.
  async save(forceDialog, discret) {
    if (CC.state.readOnly) {
      if (!discret) CC.toast('Lecture seule : rebranche le disque externe pour enregistrer.', 'err');
      return false;
    }
    const res = await window.api.save(CC.storage.serialize(), !!forceDialog);
    if (res.canceled) return false;
    if (res.error) { CC.toast('Erreur d\'enregistrement : ' + res.error, 'err'); return false; }
    CC.state.dirty = false;
    CC.state.filePath = res.filePath;
    window.api.setFile(res.filePath);
    CC.storage.clearRecovery();
    CC.updateDirtyUI();
    if (discret) CC.storage._flashAuto();
    else CC.toast('Enregistré : ' + fileName(res.filePath), 'ok');
    return true;
  },

  // -------------------------------------------------------------------------
  // Enregistrement automatique.
  //
  // La sauvegarde de recuperation (scheduleRecovery) protege d'un plantage ;
  // elle ne protege pas d'un « j'ai oublie de cliquer sur Enregistrer » suivi
  // d'une fermeture rapide. Toutes les 2 minutes, si le document a change et
  // qu'il possede deja un fichier, on l'ecrit — sans un mot, sans fenetre.
  // Un document jamais enregistre est laisse tranquille : ouvrir une boite
  // « Enregistrer sous » tout seul serait pire que le probleme.
  AUTOSAVE_MS: 120000,

  startAutosave() {
    clearInterval(CC._autosaveTimer);
    CC._autosaveTimer = setInterval(() => CC.storage.autosaveTick(), CC.storage.AUTOSAVE_MS);
  },

  async autosaveTick() {
    const S = CC.state;
    if (!S.dirty || S.readOnly || !S.filePath) return;
    if (CC._autosaveBusy) return;                     // un enregistrement est deja en vol
    CC._autosaveBusy = true;
    try { await CC.storage.save(false, true); }
    catch (_) { /* on retentera dans 2 minutes */ }
    finally { CC._autosaveBusy = false; }
  },

  // Retour visuel discret : le bouton confirme une seconde, sans toast.
  _flashAuto() {
    const btn = document.getElementById('btnSave');
    if (!btn) return;
    btn.textContent = 'Enregistré ✓';
    btn.classList.add('saved-auto');
    clearTimeout(CC._autosaveFlash);
    CC._autosaveFlash = setTimeout(() => { btn.classList.remove('saved-auto'); CC.updateDirtyUI(); }, 1600);
  },

  async open() {
    if (!(await CC.confirmIfDirty())) return;
    const res = await window.api.open();
    if (res.canceled) return;
    if (res.error) { CC.toast('Erreur d\'ouverture : ' + res.error, 'err'); return; }
    try {
      CC.storage.applyData(JSON.parse(res.content));
      CC.state.filePath = res.filePath;
      CC.state.dirty = false;
      window.api.setFile(res.filePath);
      CC.storage.clearRecovery();
      CC.refreshYears();
      CC.renderSettings();
      CC.render();
      CC.updateDirtyUI();
      CC.toast('Fichier ouvert : ' + fileName(res.filePath), 'ok');
    } catch (e) {
      CC.toast('Fichier illisible : ' + e.message, 'err');
    }
  },

  async newFile() {
    if (!(await CC.confirmIfDirty())) return;
    CC.state.settings = CC.defaultSettings();
    CC.state.factures = [];
    CC.state.declarations = {};
    CC.state.trajets = [];
    CC.state.documents = [];
    CC.state.temps = [];
    CC.state.filePath = null;
    CC.state.dirty = false;
    window.api.setFile(null);
    CC.storage.clearRecovery();
    CC.refreshYears();
    CC.renderSettings();
    CC.render();
    CC.updateDirtyUI();
    CC.toast('Nouveau fichier créé.', 'ok');
  },

  async exportCsv() {
    const sep = ';';
    const head = ['Annee', 'Trimestre', 'Encaisse le', 'N° Facture', 'Libelle', 'Mode de paiement', 'Montant', 'Statut'];
    const lines = [head.join(sep)];
    const labels = { recue: 'Recue', attente: 'En attente', retard: 'En retard', prevu: 'Previsionnel' };
    CC.facturesView.current().forEach((f) => {
      const st = CC.stats.statut(f, CC.state.settings);
      const row = [
        CC.stats.yearOf(f) || '', 'T' + (CC.stats.trimOf(f) || ''),
        CC.util.frDate(f.dateEncaissement), f.numFacture || '',
        '"' + (f.libelle || '').replace(/"/g, '""') + '"',
        f.modePaiement || '', String(+f.montant || 0).replace('.', ','), labels[st]
      ];
      lines.push(row.join(sep));
    });
    const res = await window.api.exportCsv(lines.join('\r\n'));
    if (res && res.filePath) CC.toast('Export CSV : ' + fileName(res.filePath), 'ok');
  },

  async exportPdf() {
    // Génère un PDF épuré du bilan (HTML mis en page), pas une capture du logiciel.
    const year = (CC.bilan && CC.bilan.resolveYear) ? CC.bilan.resolveYear() : null;
    if (year == null) { CC.toast('Aucune donnée à exporter.', 'err'); return; }
    const html = CC.bilan.buildPrintHTML(year);
    const res = await window.api.exportBilanPdf({ html, defaultName: `bilan-${year}.pdf` });
    if (!res || res.canceled) return;
    if (res.error) { CC.toast('Export PDF impossible : ' + res.error, 'err'); return; }
    if (res.filePath) CC.toast('Bilan PDF : ' + fileName(res.filePath), 'ok');
  },

  async importExcel() {
    const res = await window.api.importExcel();
    if (res.canceled) return;
    if (res.error) { CC.toast('Erreur import : ' + res.error, 'err'); return; }
    try {
      const factures = CC.importer.fromBase64(res.base64);
      if (!factures.length) { CC.toast('Aucune facture détectée dans ce fichier.', 'err'); return; }
      const choix = await CC.dialog({
        type: 'question',
        buttons: ['Ajouter aux factures', 'Remplacer tout', 'Annuler'],
        defaultId: 0, cancelId: 2,
        title: 'Import Excel',
        message: `${factures.length} facture(s) détectée(s).`,
        detail: 'Voulez-vous les ajouter à vos factures existantes ou tout remplacer ?'
      });
      if (choix.response === 2) return;
      if (choix.response === 1) CC.state.factures = factures;
      else CC.state.factures = CC.state.factures.concat(factures);
      CC.markDirty();
      CC.refreshYears();
      CC.renderSettings();
      CC.render();
      CC.toast(`${factures.length} facture(s) importée(s).`, 'ok');
    } catch (e) {
      CC.toast('Import impossible : ' + e.message, 'err');
    }
  },

  // Sauvegarde de recuperation (debounce)
  scheduleRecovery() {
    clearTimeout(CC._recoveryTimer);
    CC._recoveryTimer = setTimeout(() => {
      window.api.recoveryWrite(CC.storage.serialize());
    }, 1500);
  },

  // Eteindre le filet de securite.
  //
  // Supprimer le fichier ne suffit pas : une ecriture differee peut encore etre
  // en vol (scheduleRecovery attend 1,5 s) et le recreer juste apres l'effacement.
  // L'app reclamait alors une recuperation au lancement suivant alors que tout
  // etait deja enregistre. On annule donc la minuterie AVANT d'effacer.
  clearRecovery() {
    clearTimeout(CC._recoveryTimer);
    window.api.recoveryClear();
  }
};

function normalize(f) {
  // Compat ancien format (v1) : "date" = date de vente marquee payee
  let annee = f.annee, trimestre = f.trimestre;
  if (!annee && f.dateEncaissement) annee = CC.util.yearOf(f.dateEncaissement);
  if (!annee && f.date) annee = CC.util.yearOf(f.date);
  if (!trimestre && f.dateEncaissement) trimestre = CC.util.trimestreOfDate(f.dateEncaissement);
  if (!trimestre && f.date) trimestre = CC.util.trimestreOfDate(f.date);
  return {
    id: f.id || CC.util.uid(),
    libelle: f.libelle || '',
    montant: +f.montant || 0,
    numFacture: f.numFacture || '',
    modePaiement: f.modePaiement || '',
    dateEncaissement: f.dateEncaissement || '',
    annee: annee || null,
    trimestre: trimestre || null,
    categorie: f.categorie || (CC.util.categoryOf ? CC.util.categoryOf(f.libelle) : 'Autre'),
    dateEnvoi: f.dateEnvoi || '',
    dateEcheance: f.dateEcheance || '',
    notes: f.notes || '',
    fichier: f.fichier || '',
    // Drapeau explicite « facture previsionnelle » : il fait foi sur l'heuristique
    // "pas de numero = pas encore emise" (voir CC.stats.isPrevu). Sans cette ligne,
    // une facture EMISE marquee previsionnelle redevenait « en attente » au simple
    // rechargement du fichier — et changeait de colonne dans le previsionnel et la TVA.
    ...(typeof f.previsionnel === 'boolean' ? { previsionnel: f.previsionnel } : {}),
    // Etat d'avant encaissement : sans lui, « Annuler l'encaissement » ne sait plus
    // quoi restaurer apres un redemarrage.
    ...(f._avantRecue ? { _avantRecue: f._avantRecue } : {}),
    // Taux de TVA de CETTE facture. Absent = franchise (HT = TTC), ce qui est le
    // cas de toutes les factures anterieures a l assujettissement : elles ne
    // doivent jamais etre recalculees retroactivement.
    ...(+f.tauxTva > 0 ? { tauxTva: +f.tauxTva } : {})
  };
}
// Une seance de travail. `minutes` fait foi : c'est la seule grandeur sur
// laquelle on additionne, et elle est stockee en entier pour ne pas trainer
// d'arrondis d'heures decimales.
function normTemps(t) {
  return {
    id: t.id || CC.util.uid(),
    date: t.date || '',
    client: t.client || '',
    minutes: Math.max(0, Math.round(+t.minutes || 0)),
    note: t.note || '',
    factureId: t.factureId || ''
  };
}

function fileName(p) { return p ? p.split(/[\\/]/).pop() : ''; }
