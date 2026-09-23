'use strict';
window.CC = window.CC || {};

// ---------------------------------------------------------------------------
// Lecture d'une facture PDF (Indy) — 100% local, via pdf.js embarque.
// Extrait : numero, montant TTC, date d'emission, libelle/objet, echeance.
// ---------------------------------------------------------------------------
CC.pdfImporter = {
  _ready: false,
  _ensure() {
    if (this._ready) return;
    if (typeof pdfjsLib === 'undefined') throw new Error('Module PDF non chargé');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '../vendor/pdf.worker.min.js';
    this._ready = true;
  },

  // Reconstruit les lignes du PDF avec leurs positions (x) pour separer les colonnes.
  async extractRows(arrayBuffer) {
    this._ensure();
    const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const rows = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const byY = {};
      for (const it of tc.items) {
        const y = Math.round(it.transform[5]);
        (byY[y] = byY[y] || []).push({ x: it.transform[4], s: it.str });
      }
      Object.keys(byY).map(Number).sort((a, b) => b - a).forEach((y) => {
        const items = byY[y].sort((a, b) => a.x - b.x);
        rows.push({
          full: items.map((i) => i.s).join('').replace(/\s+/g, ' ').trim(),
          desc: items.filter((i) => i.x > 130).map((i) => i.s).join('').replace(/\s+/g, ' ').trim(),
          // Colonne de gauche : ton bloc (en haut), puis celui du client.
          left: items.filter((i) => i.x <= 130).map((i) => i.s).join('').replace(/\s+/g, ' ').trim()
        });
      });
    }
    return rows;
  },

  cleanLibelle(s) {
    if (!s) return '';
    return s.replace(/^facture\s+/i, '')        // titre "Facture Cours..." -> "Cours..."
      .replace(/^[\s\-–—:]+/, '')
      .replace(/[\s\-–—:."]+$/, '')
      .replace(/\s+/g, ' ')
      .trim();
  },

  // Analyse les lignes extraites et renvoie les champs d'une facture.
  parse(rows) {
    const text = rows.map((r) => r.full).join('\n');
    const nospace = text.replace(/\s+/g, '');
    const out = { isIndy: false };

    let m = text.match(/Facture\s+([0-9][0-9 \-]{3,}[0-9])/);
    if (m) {
      const full = m[1].replace(/\s+/g, '');
      out.numFull = full;
      out.num = full.includes('-') ? full.split('-').pop() : full;
    }

    m = nospace.match(/TotalTTC([\d.,]+)€/i) || nospace.match(/TTC([\d.,]+)€/i);
    if (m) {
      let s = m[1];
      s = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
      const n = parseFloat(s);
      if (!isNaN(n)) out.montant = n;
    }

    m = nospace.match(/Émisele(\d{2})\/(\d{2})\/(\d{4})/) || text.match(/Émise le\s*(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) out.dateEnvoi = `${m[3]}-${m[2]}-${m[1]}`;

    const le = rows.find((r) => /Émise le/.test(r.full));
    if (le) out.libelle = this.cleanLibelle(le.desc.split(/Émise le/)[0]);

    m = text.match(/(\d{1,3})\s*jours/);
    out.echeanceJours = m ? parseInt(m[1], 10) : 30;

    out.client = this.parseClient(rows);

    out.isIndy = !!(out.numFull && out.montant != null);
    return out;
  },

  // Bloc client d'une facture Indy : dans la colonne de gauche, juste apres ta
  // ligne « APE », jusqu'aux conditions de paiement. Exemple :
  //   ABA APPRENDRE / AUTREMENT / Chemin De La Solidarite / 06510 Carros, France / SIRET / 48404736000041
  // -> { nom, adresse, cp, ville, siret }. Renvoie null si rien d'exploitable.
  parseClient(rows) {
    const gauche = rows.map((r) => r.left || '').filter(Boolean);
    const ape = gauche.findIndex((l) => /^APE\s*:/i.test(l));
    if (ape < 0) return null;
    const lignes = [];
    for (let i = ape + 1; i < gauche.length; i++) {
      const l = gauche[i];
      // Indy espace parfois les lettres (« Te rme s e t co ndit io ns ») : on
      // compare sans les espaces.
      const colle = l.replace(/\s+/g, '');
      if (/^(Termes|ThéoVonEuw|Modedepaiement|Libellé|Échéance|IBAN|BIC|Cettefacture|TVAnonapplicable)/i.test(colle)) break;
      lignes.push(l.replace(/\s*,\s*$/, ''));
    }
    if (!lignes.length) return null;
    const c = { nom: '', adresse: '', cp: '', ville: '', siret: '' };
    const reste = [];
    for (let i = 0; i < lignes.length; i++) {
      const l = lignes[i];
      let m = l.match(/^SIRE[NT]\s*:?\s*([\d ]{9,})$/i);
      if (m) { c.siret = m[1].replace(/\s/g, ''); continue; }
      if (/^SIRE[NT]\s*:?$/i.test(l) && /^[\d ]{9,}$/.test(lignes[i + 1] || '')) { c.siret = lignes[++i].replace(/\s/g, ''); continue; }
      if (/^[\d ]{14,17}$/.test(l) && !c.siret) { c.siret = l.replace(/\s/g, ''); continue; }
      if (/^(N°\s*)?TVA/i.test(l)) { if (/^[A-Z]{2}[\dA-Z ]{8,}$/.test(lignes[i + 1] || '')) i++; continue; }
      if (/^France$/i.test(l)) continue;
      reste.push(l);
    }
    const iCp = reste.findIndex((l) => /^\d{5}\s+\S/.test(l));
    if (iCp >= 0) {
      const m = reste[iCp].match(/^(\d{5})\s+(.+?)(?:\s*,\s*France)?$/i);
      c.cp = m[1];
      c.ville = m[2].replace(/,\s*$/, '').trim();
      // Ville coupee en fin de ligne (« Saint-André-de- » / « la-Roche ») : on recolle.
      if (/-$/.test(c.ville) && reste[iCp + 1]) c.ville += reste[iCp + 1].replace(/\s*,?\s*France$/i, '').trim();
      const avant = reste.slice(0, iCp);
      // La voie commence a la premiere ligne qui ressemble a une adresse (un
      // numero, « rue », « chemin »…) ; Indy la coupe parfois sur deux lignes
      // (« 47 Avenue du Trois » / « Septembre »), qu'on recolle. A defaut, la voie
      // est la derniere ligne avant le code postal.
      const VOIE = /^(\d+|rue|chemin|che|avenue|av|bd|boulevard|impasse|imp|all[ée]e|place|pl|route|rte|quai|cours|square|promenade|mont[ée]e|traverse|lotissement|r[ée]sidence|b[aâ]t|bp|cs|zone|za|zi|lieu|chez|domaine|parc|esplanade|voie|hameau|quartier)\b/i;
      let debut = avant.findIndex((l, k) => k > 0 && VOIE.test(l));
      if (debut < 0) debut = avant.length >= 2 ? avant.length - 1 : avant.length;
      c.adresse = avant.slice(debut).join(' ');
      c.nom = avant.slice(0, debut).join(' ');
    } else {
      c.nom = reste.join(' ');
    }
    c.nom = c.nom.replace(/\s+/g, ' ').trim();
    // pdf.js colle parfois deux mots (« Chemindu Castel ») : on redecoupe apres
    // un type de voie suivi d'un article.
    c.adresse = c.adresse.replace(/\b(chemin|avenue|rue|boulevard|route|all[ée]e|impasse|place|quai|cours|square|traverse|mont[ée]e)(du|de|des|la|le|les)\b/gi, '$1 $2')
      .replace(/\s+/g, ' ').trim();
    // Ton propre SIREN (pied de page) n'est jamais celui du client.
    if (/^910080589/.test(c.siret)) c.siret = '';
    return (c.nom || c.siret || c.cp) ? c : null;
  },

  async fromArrayBuffer(arrayBuffer) {
    const rows = await this.extractRows(arrayBuffer);
    return this.parse(rows);
  }
};
