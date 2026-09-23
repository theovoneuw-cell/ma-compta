'use strict';
window.CC = window.CC || {};

// ---------------------------------------------------------------------------
// Signature de mail (bloc HTML + photo). Ajoutee automatiquement a chaque
// message envoye depuis la boite mail, sauf si la case est decochee dans le
// composeur. La photo voyage en piece jointe inline (cid:), pas en lien
// externe : elle s'affiche meme si le destinataire bloque les images distantes.
// ---------------------------------------------------------------------------
CC.signature = {
  cid: 'photo-signature@macompta',
  mime: 'image/jpeg',
  filename: 'photo.jpg',

  // Photo et coordonnees : elles vivent dans les reglages du fichier de compta
  // (`settings.signature` = { ident, photo }), qui est prive et synchronise par
  // Drive — jamais dans le code, car la version iPhone est publiee sur un depot
  // GitHub public. Photo : ronde 300 px, cercle et anneau deja graves dans
  // l'image (aucun CSS necessaire, identique dans tous les clients mail).
  _donnees() {
    const s = (window.CC && CC.state && CC.state.settings) || {};
    return (s.signature && typeof s.signature === 'object') ? s.signature : null;
  },
  get ident() { const d = this._donnees(); return (d && d.ident) || null; },
  get imgB64() { const d = this._donnees(); return (d && d.photo) || ''; },
  configuree() { const i = this.ident; return !!(i && i.nomAff); },

  // Bloc HTML, styles en ligne (aucune classe : les clients mail les suppriment).
  html() {
    const i = this.ident;
    const F = "font-family:-apple-system,'Helvetica Neue',Helvetica,Arial,sans-serif;";
    return '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;' + F + '">' +
      '<tr>' +
        (this.imgB64 ? '<td style="vertical-align:middle;padding:0 18px 0 0;" valign="middle">' +
          '<img src="cid:' + this.cid + '" width="100" height="100" alt="' + i.nomAff + '" ' +
          'style="display:block;width:100px;height:100px;border:0;outline:none;text-decoration:none;">' +
        '</td>' : '') +
        '<td style="vertical-align:middle;padding:2px 0 2px 18px;border-left:2px solid #7d5a79;" valign="middle">' +
          '<div style="' + F + 'font-size:17px;line-height:22px;font-weight:700;color:#16181d;">' + i.nomAff + '</div>' +
          '<div style="' + F + 'font-size:13px;line-height:19px;font-weight:600;color:#7d5a79;padding-top:2px;">' + i.titre + '</div>' +
          '<div style="' + F + 'font-size:12px;line-height:18px;color:#5f636e;padding-top:1px;">' + i.role + '</div>' +
          '<div style="font-size:9px;line-height:9px;">&nbsp;</div>' +
          '<div style="' + F + 'font-size:13px;line-height:20px;color:#5f636e;">' +
            '<a href="tel:' + i.telUri + '" style="color:#16181d;text-decoration:none;font-weight:600;">' + i.tel + '</a>' +
            '<span style="color:#e2dde1;">&nbsp;|&nbsp;</span>' +
            '<a href="mailto:' + i.mail + '" style="color:#16181d;text-decoration:none;font-weight:600;">' + i.mail + '</a>' +
          '</div>' +
          '<div style="' + F + 'font-size:11px;line-height:17px;color:#9aa0ab;padding-top:3px;">' + i.lieu + '</div>' +
        '</td>' +
      '</tr>' +
    '</table>';
  },

  // Version texte, pour les clients qui n'affichent pas le HTML.
  texte() {
    const i = this.ident;
    return '-- \n' + i.nomAff + '\n' + i.titre + '\n' + i.role + '\n' + i.tel + ' | ' + i.mail + '\n' + i.lieu;
  },

  // Meme bloc, mais avec la photo en data: pour un affichage hors mail (reglages).
  apercu() {
    if (!this.configuree()) return '<p class="muted">Signature non configurée : ses coordonnées et sa photo sont rangées dans ta compta, pas dans l\'app.</p>';
    return this.html().split('cid:' + this.cid).join('data:' + this.mime + ';base64,' + this.imgB64);
  },

  // Vrai tant que le reglage n'a pas ete desactive dans les parametres.
  actif() {
    const s = (window.CC && CC.state && CC.state.settings) || {};
    return s.mailSignatureAuto !== false && this.configuree();
  },

  // Ce que la construction du message attend, ou null si la signature est coupee.
  payload() {
    if (!this.actif()) return null;
    return {
      html: this.html(),
      texte: this.texte(),
      image: this.imgB64 ? { cid: this.cid, mime: this.mime, filename: this.filename, dataB64: this.imgB64 } : null
    };
  }
};
