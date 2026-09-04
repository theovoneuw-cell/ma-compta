'use strict';
window.CC = window.CC || {};

// ---------------------------------------------------------------------------
// Coffre à documents (PC / Mac uniquement)
//
// Les pièces qu'un client institutionnel réclame toujours au pire moment :
// attestation d'assurance RC pro, attestation URSSAF de vigilance, RIB, avis
// de situation SIRENE, diplômes, plaquette de présentation.
//
// Deux idées, et rien d'autre :
//   1. la pièce a une DATE DE FIN, et l'app prévient avant qu'elle tombe ;
//   2. la pièce part par mail en deux clics (cocher, envoyer).
//
// Le fichier lui-même est copié dans Documents/Ma Compta/Coffre : ce sont tes
// documents, ils restent des fichiers normaux. Le fichier de compta ne garde
// que la fiche (titre, type, échéance) — voir main.js, IPC « docs: ».
// ---------------------------------------------------------------------------

// Icônes au trait, dans l'esprit du reste de l'app (pas d'emoji : ils changent
// d'un système à l'autre et jurent avec la charte).
const CO_IC = {
  bouclier: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5.5c0 4.3-2.9 8.2-7 9.5-4.1-1.3-7-5.2-7-9.5V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  tampon: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20h14"/><path d="M7 17h10l-.6-3.4a2 2 0 0 0-2-1.6H9.6a2 2 0 0 0-2 1.6z"/><path d="M10 12V8.5a2 2 0 1 1 4 0V12"/></svg>',
  banque: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10 12 4l9 6"/><path d="M5 10v8M19 10v8M9 10v8M15 10v8"/><path d="M3 20h18"/></svg>',
  batiment: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h3M8 11h3M8 15h3M14 7h2M14 11h2M14 15h2"/></svg>',
  diplome: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 4 9 4.5-9 4.5-9-4.5z"/><path d="M7 11v4.2c0 .9 2.2 2.3 5 2.3s5-1.4 5-2.3V11"/></svg>',
  plaquette: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2 2 0 0 1 6 4h5v16H6a2 2 0 0 1-2-1.5z"/><path d="M20 5.5A2 2 0 0 0 18 4h-5v16h5a2 2 0 0 0 2-1.5z"/></svg>',
  contrat: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>',
  papier: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  coffre: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="13" cy="12" r="3.4"/><path d="M13 8.6V12M6.5 8v8"/></svg>'
};

// Les types connus. `moisValidite` sert à proposer une échéance à l'ajout :
// c'est ce qui fait qu'on renseigne la date au lieu de la remettre à plus tard.
const CO_TYPES = [
  { id: 'assurance', lib: 'Assurance RC pro', ic: 'bouclier', moisValidite: 12, mots: ['assurance', 'rc pro', 'responsabilite', 'responsabilité', 'axa', 'maif', 'mma', 'allianz'] },
  { id: 'vigilance', lib: 'Attestation de vigilance', ic: 'tampon', moisValidite: 6, mots: ['vigilance', 'urssaf'] },
  { id: 'fiscale', lib: 'Attestation fiscale', ic: 'tampon', moisValidite: 12, mots: ['fiscale', 'impots', 'impôts', 'dgfip'] },
  { id: 'rib', lib: 'RIB', ic: 'banque', moisValidite: 0, mots: ['rib', 'iban', 'bancaire'] },
  { id: 'sirene', lib: 'Avis SIRENE / Kbis', ic: 'batiment', moisValidite: 0, mots: ['sirene', 'siren', 'siret', 'kbis', 'insee', 'situation'] },
  { id: 'diplome', lib: 'Diplôme / certification', ic: 'diplome', moisValidite: 0, mots: ['diplome', 'diplôme', 'certificat', 'attestation de formation', 'cv'] },
  { id: 'plaquette', lib: 'Plaquette / présentation', ic: 'plaquette', moisValidite: 0, mots: ['plaquette', 'presentation', 'présentation', 'projet', 'book', 'portfolio'] },
  { id: 'contrat', lib: 'Contrat / convention', ic: 'contrat', moisValidite: 0, mots: ['contrat', 'convention', 'devis', 'accord'] },
  { id: 'autre', lib: 'Autre', ic: 'papier', moisValidite: 0, mots: [] }
];
function coType(id) { return CO_TYPES.find((t) => t.id === id) || CO_TYPES[CO_TYPES.length - 1]; }

// Fenêtre d'alerte par défaut : un mois avant, on a encore le temps de demander
// le renouvellement à l'assureur ou de retélécharger l'attestation.
const CO_RAPPEL_DEFAUT = 30;

CC.coffre = {
  _fichiers: {},     // nom de fichier -> { taille, modifie } (état réel du disque)
  _dir: '',
  _sel: {},          // ids cochés pour l'envoi par mail
  _bound: false,
  _charge: false,

  docs() { return CC.state.documents || (CC.state.documents = []); },

  // ---- Échéances -----------------------------------------------------------
  // Un document sans date de fin est valable pour toujours : c'est le cas du
  // RIB ou d'un diplôme. On ne lui invente pas d'alerte.
  etat(d) {
    if (!d.expire) return { cls: 'perenne', txt: 'Pas de date de fin', jours: null };
    const dt = CC.util.parseDate(d.expire);
    if (!dt) return { cls: 'perenne', txt: 'Pas de date de fin', jours: null };
    const jours = CC.util.daysBetween(new Date(), dt);
    if (jours < 0) return { cls: 'expire', txt: 'Périmé depuis le ' + CC.util.frDate(d.expire), jours };
    if (jours === 0) return { cls: 'bientot', txt: 'Périme aujourd\'hui', jours };
    const seuil = +d.rappelJours > 0 ? +d.rappelJours : CO_RAPPEL_DEFAUT;
    if (jours <= seuil) return { cls: 'bientot', txt: 'Périme dans ' + jours + ' j — le ' + CC.util.frDate(d.expire), jours };
    return { cls: 'valide', txt: 'Valable jusqu\'au ' + CC.util.frDate(d.expire), jours };
  },

  // Documents à renouveler, du plus urgent au moins urgent. Sert au bandeau
  // d'alerte de l'onglet ET aux rappels (js/rappels.js).
  aRenouveler(now) {
    now = now || new Date();
    return this.docs().filter((d) => {
      if (!d.expire) return false;
      const dt = CC.util.parseDate(d.expire);
      if (!dt) return false;
      const seuil = +d.rappelJours > 0 ? +d.rappelJours : CO_RAPPEL_DEFAUT;
      return CC.util.daysBetween(now, dt) <= seuil;
    }).sort((a, b) => String(a.expire).localeCompare(String(b.expire)));
  },

  // ---- Lecture du disque ---------------------------------------------------
  async pull() {
    if (!CC.estBureau()) return;
    let r;
    try { r = await window.api.docs.list(); } catch (_) { r = null; }
    this._fichiers = {};
    if (r && r.fichiers) r.fichiers.forEach((f) => { this._fichiers[f.nom] = f; });
    if (r && r.dir) this._dir = r.dir;
    this._charge = true;
  },

  async render() {
    if (!CC.estBureau()) return;
    // On relit le dossier à chaque affichage : un document peut avoir été
    // déplacé ou remplacé hors de l'app, et une fiche qui pointe vers un
    // fichier absent doit le dire tout de suite.
    if (this._charge) this._paint();       // évite l'écran vide pendant la lecture
    await this.pull();
    this._paint();
  },

  // ---- Rendu ---------------------------------------------------------------
  _paint() {
    const box = document.getElementById('coffreBody');
    if (!box) return;
    const docs = this.docs().slice().sort((a, b) => {
      // Ce qui périme le plus tôt en premier ; le reste par titre.
      const ea = a.expire || '9999-99-99', eb = b.expire || '9999-99-99';
      if (ea !== eb) return ea.localeCompare(eb);
      return (a.titre || '').localeCompare(b.titre || '', 'fr');
    });

    if (!docs.length) {
      box.innerHTML = `<div class="co-empty">
        <span class="co-empty-ic">${CO_IC.coffre}</span>
        <div class="co-empty-t">Le coffre est vide</div>
        <p class="co-empty-s">Dépose ici l'attestation d'assurance, l'attestation de vigilance URSSAF, ton RIB, ton avis SIRENE, tes diplômes, ta plaquette.<br>
        L'app te prévient avant qu'un document périme, et te les fait envoyer par mail sans les rechercher.</p>
        <button class="btn btn-primary" id="coAddEmpty">Ajouter un document</button>
      </div>`;
      const b = document.getElementById('coAddEmpty');
      if (b) b.addEventListener('click', () => CC.coffre.ajouter());
      this._paintBar();
      return;
    }

    // Bandeau : uniquement s'il y a quelque chose à faire.
    const urgents = this.aRenouveler();
    let html = '';
    if (urgents.length) {
      const perimes = urgents.filter((d) => this.etat(d).jours < 0);
      const cls = perimes.length ? 'danger' : 'warn';
      const lignes = urgents.slice(0, 4).map((d) => `<b>${esc(d.titre)}</b> — ${esc(this.etat(d).txt.toLowerCase())}`).join(' · ');
      html += `<div class="alert ${cls} co-alert"><span class="ai">!</span><div>${lignes}${urgents.length > 4 ? ' · et ' + (urgents.length - 4) + ' autre(s)' : ''}</div></div>`;
    }

    html += '<div class="co-grid">' + docs.map((d) => this._carte(d)).join('') + '</div>';
    box.innerHTML = html;
    this._paintBar();
  },

  _carte(d) {
    const t = coType(d.type);
    const e = this.etat(d);
    const f = this._fichiers[d.nom];
    const manquant = !f;
    const coche = !!this._sel[d.id];
    return `<div class="co-card${manquant ? ' co-missing' : ''}">
      <label class="co-pick" title="Sélectionner pour un envoi par mail">
        <input type="checkbox" class="chk" data-co-pick="${esc(d.id)}"${coche ? ' checked' : ''}${manquant ? ' disabled' : ''}>
      </label>
      <div class="co-ic">${CO_IC[t.ic] || CO_IC.papier}</div>
      <div class="co-main">
        <div class="co-t">${esc(d.titre || d.nom)}</div>
        <div class="co-meta">
          <span class="cat-chip">${esc(t.lib)}</span>
          <span class="co-file" title="${esc(d.nom)}">${esc(d.nom)}</span>
          ${f ? `<span class="co-size">${humain(f.taille)}</span>` : '<span class="co-size co-warn">fichier absent du coffre</span>'}
        </div>
        <div class="co-exp ${e.cls}">${esc(e.txt)}</div>
        ${d.notes ? `<div class="co-notes">${esc(d.notes)}</div>` : ''}
      </div>
      <div class="co-actions">
        ${manquant ? '' : `<button class="mini-btn" data-co-open="${esc(d.id)}">Ouvrir</button>`}
        ${manquant ? '' : `<button class="mini-btn" data-co-mail="${esc(d.id)}">Envoyer</button>`}
        <button class="mini-btn" data-co-edit="${esc(d.id)}">Modifier</button>
        <button class="mini-btn" data-co-del="${esc(d.id)}" title="Retirer du coffre">Retirer</button>
      </div>
    </div>`;
  },

  // Barre d'envoi : elle n'apparaît que quand une case est cochée. C'est le
  // deuxième clic de la promesse « en deux clics ».
  _paintBar() {
    const bar = document.getElementById('coffreBar');
    if (!bar) return;
    const n = Object.keys(this._sel).filter((k) => this._sel[k]).length;
    bar.classList.toggle('hidden', n === 0);
    if (n) bar.innerHTML = `<span class="co-bar-n">${n} document${n > 1 ? 's' : ''} sélectionné${n > 1 ? 's' : ''}</span>
      <span class="spacer"></span>
      <button class="btn" id="coClear">Tout décocher</button>
      <button class="btn btn-primary" id="coMailSel">Envoyer par mail</button>`;
  },

  // ---- Ajout ---------------------------------------------------------------
  async ajouter() {
    let r;
    try { r = await window.api.docs.add(); } catch (e) { r = { error: String(e.message || e) }; }
    if (!r || r.canceled) return;
    if (r.error) { CC.toast(r.error, 'err'); return; }

    const nouveaux = [];
    (r.ajoutes || []).forEach((f) => {
      this._fichiers[f.nom] = { nom: f.nom, taille: f.taille, modifie: Date.now(), mime: f.mime };
      const type = devineType(f.nom);
      const d = {
        id: CC.util.uid(),
        nom: f.nom,
        titre: titreDepuis(f.nom),
        type: type.id,
        expire: type.moisValidite ? CC.util.toISO(dansMois(type.moisValidite)) : '',
        rappelJours: CO_RAPPEL_DEFAUT,
        notes: '',
        ajoute: CC.util.toISO(new Date())
      };
      this.docs().push(d);
      nouveaux.push(d);
    });
    CC.markDirty();
    this._paint();
    CC.toast(nouveaux.length + ' document(s) ajouté(s) au coffre.', 'ok');
    // On ouvre la fiche du premier : la date d'échéance proposée doit être
    // confirmée tout de suite, sinon elle ne le sera jamais.
    if (nouveaux.length) this.modifier(nouveaux[0].id);
  },

  // ---- Fiche (modale) ------------------------------------------------------
  modifier(id) {
    const d = this.docs().find((x) => x.id === id);
    if (!d) return;
    const t = coType(d.type);
    this._show(`
      <div class="ev-head">
        <h2>Fiche du document</h2>
        <button class="ev-x" data-co-close title="Fermer" aria-label="Fermer">✕</button>
      </div>
      <div class="ev-form">
        <label class="ev-f">Titre<input id="coTitre" type="text" maxlength="120" value="${esc(d.titre || '')}" placeholder="ex. Attestation RC pro 2026"></label>
        <div class="ev-f-row">
          <label class="ev-f">Type
            <select id="coType" class="input">${CO_TYPES.map((x) => `<option value="${x.id}"${x.id === t.id ? ' selected' : ''}>${x.lib}</option>`).join('')}</select>
          </label>
          <label class="ev-f">Prévenir combien de jours avant
            <input id="coRappel" type="number" min="1" max="365" value="${+d.rappelJours > 0 ? +d.rappelJours : CO_RAPPEL_DEFAUT}">
          </label>
        </div>
        <div class="ev-f">Valable jusqu'au
          <div class="dp" id="coDateWrap" data-dp="exp">
            <button type="button" class="dp-field" data-dp-btn></button>
            <input type="hidden" id="coDate_exp" value="${esc(d.expire || '')}">
            <div class="dp-pop hidden" data-dp-pop></div>
          </div>
          <small class="co-hint">Laisse vide pour un document sans date de fin (RIB, diplôme…). <button type="button" class="lnk" id="coNoDate">Effacer la date</button></small>
        </div>
        <label class="ev-f">Notes<textarea id="coNotes" rows="2" placeholder="(optionnel) n° de contrat, interlocuteur, où le renouveler…">${esc(d.notes || '')}</textarea></label>
        <div class="co-file-line">Fichier : <b>${esc(d.nom)}</b>${this._fichiers[d.nom] ? '' : ' <span class="co-warn">— absent du coffre</span>'}</div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-danger" data-co-del="${esc(d.id)}">Retirer du coffre</button>
        <span class="spacer"></span>
        <button class="btn" data-co-close>Annuler</button>
        <button class="btn btn-primary" id="coSave" data-co-id="${esc(d.id)}">Enregistrer</button>
      </div>
    `);
    if (CC.dp) CC.dp.init(document.getElementById('coffreModalBody'));
    const eff = document.getElementById('coNoDate');
    if (eff) eff.addEventListener('click', () => { if (CC.dp) CC.dp.set(document.getElementById('coDateWrap'), ''); });
    const save = document.getElementById('coSave');
    if (save) save.addEventListener('click', () => CC.coffre._enregistrer(d.id));
    setTimeout(() => { const el = document.getElementById('coTitre'); if (el) el.focus(); }, 60);
  },

  _enregistrer(id) {
    const d = this.docs().find((x) => x.id === id);
    if (!d) return;
    const v = (x) => document.getElementById(x);
    d.titre = (v('coTitre').value || '').trim() || d.nom;
    d.type = v('coType').value || 'autre';
    d.expire = v('coDate_exp').value || '';
    const r = parseInt(v('coRappel').value, 10);
    d.rappelJours = (r > 0 && r <= 365) ? r : CO_RAPPEL_DEFAUT;
    d.notes = (v('coNotes').value || '').trim();
    CC.markDirty();
    this._closeModal();
    this._paint();
    CC.toast('Fiche enregistrée ✓', 'ok');
  },

  // ---- Suppression ---------------------------------------------------------
  async supprimer(id) {
    const d = this.docs().find((x) => x.id === id);
    if (!d) return;
    let res;
    try {
      res = await CC.dialog({
        type: 'warning',
        buttons: ['Annuler', 'Retirer la fiche', 'Retirer et supprimer le fichier'],
        defaultId: 1, cancelId: 0,
        title: 'Retirer du coffre',
        message: `Retirer « ${d.titre || d.nom} » ?`,
        detail: 'Retirer la fiche laisse le fichier dans le dossier du coffre. La seconde option efface aussi le fichier du disque — définitif.'
      });
    } catch (_) { res = { response: 0 }; }
    if (!res || res.response === 0) return;

    if (res.response === 2) {
      let r;
      try { r = await window.api.docs.remove(d.nom); } catch (e) { r = { error: String(e.message || e) }; }
      if (r && r.error) { CC.toast(r.error, 'err'); return; }
      delete this._fichiers[d.nom];
    }
    CC.state.documents = this.docs().filter((x) => x.id !== id);
    delete this._sel[id];
    CC.markDirty();
    this._closeModal();
    this._paint();
    CC.toast('Document retiré du coffre.', 'ok');
  },

  // ---- Envoi par mail ------------------------------------------------------
  // On charge les pièces AVANT d'ouvrir le composeur : si un fichier manque, on
  // le dit tout de suite plutôt que d'ouvrir un mail à moitié rempli.
  async envoyer(ids) {
    const docs = ids.map((id) => this.docs().find((x) => x.id === id)).filter(Boolean);
    if (!docs.length) return;
    CC.toast('Préparation du mail…');
    const pieces = [];
    for (const d of docs) {
      let r;
      try { r = await window.api.docs.read(d.nom); } catch (e) { r = { error: String(e.message || e) }; }
      if (!r || r.error) { CC.toast(`« ${d.titre || d.nom} » : ${(r && r.error) || 'lecture impossible'}`, 'err'); return; }
      pieces.push({ filename: r.nom, mimeType: r.mime, dataB64: r.dataB64, size: r.taille });
    }

    if (!CC.mailbox) { CC.toast('Messagerie indisponible.', 'err'); return; }
    const liste = docs.map((d) => '— ' + (d.titre || d.nom)).join('\n');
    const objet = docs.length === 1 ? (docs[0].titre || docs[0].nom) : 'Documents administratifs';
    const signature = (CC.state.settings && CC.state.settings.mailSignature) || '';
    CC.switchTab('mails');
    CC.mailbox._openCompose({
      titre: 'Envoyer des documents',
      subject: objet,
      body: `Bonjour,\n\nVous trouverez ci-joint :\n${liste}\n\nBien à vous,\n${signature}`.trimEnd() + '\n'
    });
    CC.mailbox._attachments = pieces;
    CC.mailbox._renderAttachments();
    this._sel = {};
    this._paintBar();
    CC.toast(pieces.length + ' pièce(s) jointe(s) — il ne reste que le destinataire.', 'ok');
  },

  // ---- Modale : plomberie --------------------------------------------------
  _show(html) {
    let back = document.getElementById('coffreModal');
    if (!back) {
      back = document.createElement('div');
      back.id = 'coffreModal';
      back.className = 'modal-backdrop hidden';
      back.innerHTML = '<div class="modal ev-modal"><div id="coffreModalBody"></div></div>';
      document.body.appendChild(back);
      back.addEventListener('click', (e) => {
        if (!e.target.closest('.dp')) document.querySelectorAll('#coffreModal .dp-pop:not(.hidden)').forEach((p) => p.classList.add('hidden'));
        if (e.target === back || e.target.closest('[data-co-close]')) { CC.coffre._closeModal(); return; }
        const del = e.target.closest('[data-co-del]');
        if (del) CC.coffre.supprimer(del.dataset.coDel);
      });
    }
    document.getElementById('coffreModalBody').innerHTML = html;
    back.classList.remove('hidden');
  },

  _closeModal() {
    const back = document.getElementById('coffreModal');
    if (back) back.classList.add('hidden');
  },

  bind() {
    if (this._bound || !CC.estBureau()) return;
    this._bound = true;
    const add = document.getElementById('coffreAdd');
    if (add) add.addEventListener('click', () => CC.coffre.ajouter());
    const dossier = document.getElementById('coffreDossier');
    if (dossier) dossier.addEventListener('click', async () => {
      const r = await window.api.docs.reveal();
      if (r && r.error) CC.toast(r.error, 'err');
    });

    const body = document.getElementById('coffreBody');
    if (body) body.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-co-pick]');
      if (pick) { CC.coffre._sel[pick.dataset.coPick] = pick.checked; CC.coffre._paintBar(); return; }
      const open = e.target.closest('[data-co-open]');
      if (open) { CC.coffre._ouvrir(open.dataset.coOpen); return; }
      const mail = e.target.closest('[data-co-mail]');
      if (mail) { CC.coffre.envoyer([mail.dataset.coMail]); return; }
      const edit = e.target.closest('[data-co-edit]');
      if (edit) { CC.coffre.modifier(edit.dataset.coEdit); return; }
      const del = e.target.closest('[data-co-del]');
      if (del) CC.coffre.supprimer(del.dataset.coDel);
    });

    const bar = document.getElementById('coffreBar');
    if (bar) bar.addEventListener('click', (e) => {
      if (e.target.closest('#coClear')) { CC.coffre._sel = {}; CC.coffre._paint(); return; }
      if (e.target.closest('#coMailSel')) {
        CC.coffre.envoyer(Object.keys(CC.coffre._sel).filter((k) => CC.coffre._sel[k]));
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') CC.coffre._closeModal();
    });
  },

  async _ouvrir(id) {
    const d = this.docs().find((x) => x.id === id);
    if (!d) return;
    let r;
    try { r = await window.api.docs.open(d.nom); } catch (e) { r = { error: String(e.message || e) }; }
    if (r && r.error) CC.toast(r.error, 'err');
  }
};

// --- Petites aides ----------------------------------------------------------
function devineType(nom) {
  const n = (nom || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  for (const t of CO_TYPES) {
    if (t.mots.some((m) => n.includes(m.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()))) return t;
  }
  return CO_TYPES[CO_TYPES.length - 1];
}
// Titre proposé : le nom du fichier débarrassé de son extension, des tirets et
// soulignés. Mieux vaut « Attestation vigilance 2026 » que « attestation_vigilance_2026.pdf ».
function titreDepuis(nom) {
  const sansExt = String(nom || '').replace(/\.[a-z0-9]{1,6}$/i, '');
  const propre = sansExt.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return propre.charAt(0).toUpperCase() + propre.slice(1);
}
function dansMois(n) { const d = new Date(); d.setMonth(d.getMonth() + n); return d; }
function humain(o) {
  if (!o && o !== 0) return '';
  if (o < 1024) return o + ' o';
  if (o < 1024 * 1024) return Math.round(o / 1024) + ' Ko';
  return (o / 1024 / 1024).toFixed(1).replace('.', ',') + ' Mo';
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
