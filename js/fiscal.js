'use strict';
window.CC = window.CC || {};

const FMOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function frD(d) { return d.getDate() + ' ' + FMOIS[d.getMonth()] + ' ' + d.getFullYear(); }

CC.renderFiscal = function () {
  const S = CC.state, settings = S.settings;
  const year = (S.selectedYear === 'all') ? new Date().getFullYear() : S.selectedYear;
  const fy = CC.stats.forYear(S.factures, year);
  const today = new Date();

  // ---------- À déclarer maintenant (carte focalisée + bouton Copier) ----------
  (function renderUrssafNow() {
    const box = document.getElementById('urssafNow');
    if (!box) return;
    // Trimestre à déclarer : le plus urgent (échéance dépassée non déclarée),
    // sinon la prochaine échéance non déclarée, sinon la prochaine échéance.
    const cand = [];
    for (let y = today.getFullYear() - 1; y <= today.getFullYear() + 1; y++)
      for (let t = 1; t <= 4; t++) cand.push({ y, t, dl: CC.stats.urssafDeclDeadline(y, t) });
    cand.sort((a, b) => a.dl - b.dl);
    const declared = (c) => (S.declarations[c.y + '-' + c.t] || {}).declare;
    const overdue = cand.filter((c) => c.dl < today && !declared(c));
    const upcoming = cand.filter((c) => c.dl >= today && !declared(c));
    const futur = cand.filter((c) => c.dl >= today);
    const sel = overdue.length ? overdue[overdue.length - 1] : (upcoming[0] || futur[0] || cand[cand.length - 1]);

    const fyy = CC.stats.forYear(S.factures, sel.y);
    const enc = CC.stats.encaisseTrim(fyy, sel.y, sel.t);
    const taux = CC.urssafRate(sel.y, sel.t);
    const urssaf = enc * taux / 100;
    const key = sel.y + '-' + sel.t;
    const dec = S.declarations[key] || {};
    const days = CC.util.daysBetween(today, sel.dl);
    const overdueSel = days < 0;
    let dlTxt, dlCls;
    if (dec.declare) { dlTxt = 'déclaré ✓'; dlCls = 'ok'; }
    else if (overdueSel) { dlTxt = 'échéance dépassée le ' + frD(sel.dl); dlCls = 'danger'; }
    else { dlTxt = 'à déclarer avant le ' + frD(sel.dl) + (days <= 31 ? ' · dans ' + days + ' j' : ''); dlCls = days <= 15 ? 'urgent' : ''; }
    const caR = Math.round(enc);

    box.innerHTML = `
      <h3>À déclarer à l'URSSAF</h3>
      <p class="card-sub">Le montant exact à reporter dans ta déclaration, prêt à copier.</p>
      <div class="un-grid">
        <div class="un-info">
          <div class="un-trim">T${sel.t} ${sel.y} <span class="un-dl ${dlCls}">${dlTxt}</span></div>
          <div class="un-ca">${CC.util.eur0(enc)}</div>
          <div class="un-note">CA encaissé du trimestre · cotisations + contributions URSSAF estimées <b>${CC.util.eur0(urssaf)}</b> (${String(taux).replace('.', ',')} %, CFP/CCI inclus)</div>
        </div>
        <div class="un-actions">
          <button type="button" class="btn btn-primary" id="unCopy">Copier&nbsp;: ${caR.toLocaleString('fr-FR')} €</button>
          <label class="check un-declare"><input type="checkbox" id="unDeclare" ${dec.declare ? 'checked' : ''}> Marquer déclaré</label>
          <button type="button" class="btn-urssaf" id="unOpen" title="Ouvrir le site auto-entrepreneur de l'Urssaf">
            <svg class="urssaf-logo" viewBox="0 22 105 106" width="19" height="19" aria-hidden="true"><path fill="#1ECAD3" d="M0.16,48.81c0,14.5,11.76,26.26,26.26,26.26s26.26-11.76,26.26-26.26S40.92,22.55,26.42,22.55C11.91,22.55,0.16,34.31,0.16,48.81"/><path fill="#90B3E6" d="M52.48,75.07h52.13c0,29.01-23.34,52.52-52.13,52.52C52.48,127.59,52.48,75.07,52.48,75.07z"/><path fill="#0071CE" d="M104.6,22.55v52.52H52.48C52.48,46.06,75.81,22.55,104.6,22.55"/><path fill="#D0DDF4" d="M52.48,75.07H0.35c0,29.01,23.34,52.52,52.13,52.52C52.48,127.59,52.48,75.07,52.48,75.07z"/></svg>
            <span>Déclarer sur <b>urssaf.fr</b></span>
            <svg class="urssaf-ext" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M9 7h8v8"/></svg>
          </button>
        </div>
      </div>`;

    const copyBtn = document.getElementById('unCopy');
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(String(caR)); CC.toast('Montant copié : ' + caR.toLocaleString('fr-FR') + ' € — colle-le dans ta déclaration URSSAF.', 'ok'); }
      catch (_) { CC.toast('Copie impossible.', 'err'); }
    });
    const decBox = document.getElementById('unDeclare');
    if (decBox) decBox.addEventListener('change', (e) => {
      S.declarations[key] = S.declarations[key] || {};
      S.declarations[key].declare = e.target.checked;
      CC.markDirty();
      CC.renderFiscal();   // resynchronise la carte ET le tableau ci-dessous
    });
    const openBtn = document.getElementById('unOpen');
    if (openBtn) openBtn.addEventListener('click', () => { try { window.api.openUrl('https://www.autoentrepreneur.urssaf.fr/'); } catch (_) {} });
  })();

  // ---------- Déclarations URSSAF ----------
  const cot = CC.stats.cotisationsYear(fy, year, settings);
  let rows = cot.trims.map((t) => {
    const dl = CC.stats.urssafDeclDeadline(year, t.trimestre);
    const key = `${year}-${t.trimestre}`;
    const dec = S.declarations[key] || {};
    const days = CC.util.daysBetween(today, dl);
    const urgent = !dec.declare && days >= 0 && days <= 30;
    const passe = days < 0;
    const dlTxt = passe ? ('échu — ' + frD(dl)) : (frD(dl) + (urgent ? ` · dans ${days} j` : ''));
    return `<tr>
      <td class="q" data-label="Trimestre">T${t.trimestre} ${year}</td>
      <td class="num" data-label="CA à déclarer">${CC.util.eur0(t.encaisse)}</td>
      <td class="num" data-label="URSSAF">${CC.util.eur0(t.urssaf)}</td>
      <td class="deadline ${urgent ? 'urgent' : ''}" data-label="Date limite">${dlTxt}</td>
      <td class="ctr" data-label="Déclaré"><input type="checkbox" class="chk" data-k="${key}" data-f="declare" ${dec.declare ? 'checked' : ''}></td>
      <td class="ctr" data-label="Payé"><input type="checkbox" class="chk" data-k="${key}" data-f="paye" ${dec.paye ? 'checked' : ''}></td>
    </tr>`;
  }).join('');
  document.getElementById('fiscalDeclarations').innerHTML = `
    <table class="fiscal-table">
      <thead><tr><th>Trimestre</th><th class="num">CA à déclarer</th><th class="num">URSSAF</th><th>Date limite</th><th class="ctr">Déclaré</th><th class="ctr">Payé</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  document.querySelectorAll('#fiscalDeclarations .chk').forEach((c) => {
    c.addEventListener('change', (e) => {
      const k = e.target.dataset.k, f = e.target.dataset.f;
      S.declarations[k] = S.declarations[k] || {};
      S.declarations[k][f] = e.target.checked;
      CC.markDirty();
    });
  });

  // ---------- Seuils ----------
  const enc = cot.encaisse;
  const plafond = CC.effPlafond(year);
  const plafondLegal = CC.plafondMicro(year);
  function gauge(label, val, max, extra) {
    const ratio = Math.min(100, (val / max) * 100);
    const cls = ratio > 95 ? 'danger' : ratio > 80 ? 'warn' : '';
    return `<div class="gauge"><div class="lbl"><span>${label}</span><span>${CC.util.pct(ratio, 0)}</span></div>
      <div class="bar"><div class="fill ${cls}" style="width:${ratio}%"></div></div>
      <div class="lbl"><span>${CC.util.eur0(val)}</span><span>${extra || CC.util.eur0(max)}</span></div></div>`;
  }
  // Un plafond saisi a la main dans les Parametres remplace le plafond legal, en
  // silence. S'il en differe, la jauge le dit : sinon on lit une marge qui n'existe
  // pas (ou l'inverse) sans jamais savoir d'ou vient le chiffre.
  const noteePlafond = (plafond !== plafondLegal)
    ? `<p class="seuil-note">Plafond saisi à la main dans Paramètres. Le plafond légal ${year} est de ${CC.util.eur0(plafondLegal)} — videz le champ pour le suivre automatiquement.</p>`
    : '';
  document.getElementById('fiscalSeuils').innerHTML =
    `<div class="seuil">${gauge('Plafond micro ' + year, enc, plafond)}</div>` + noteePlafond;

  // ---------- Franchise de TVA ----------
  // Une question fermée, une réponse, et de quoi la vérifier.
  //
  // Choix de lecture : l'échelle de la règle s'arrête au SEUIL MAJORÉ, celui qui
  // coupe réellement la franchise. Sur une échelle partant de zéro, les deux
  // seuils ne sont séparés que de 9 % de la largeur et leurs étiquettes se
  // chevauchent. En faisant du seuil majoré le bout de la piste, la barre se lit
  // comme un remplissage vers un mur — ce qui est exactement la question posée.
  // Le seuil de base n'est plus qu'un repère, placé au-dessus de la piste pour
  // qu'il ne puisse jamais entrer en collision avec l'étiquette du mur.
  (function renderTva() {
    const box = document.getElementById('fiscalTva');
    if (!box) return;
    const t = CC.stats.tva(S.factures, year, settings, today);
    if (!t.base || !t.majore) {
      box.innerHTML = '<p class="muted">Renseigne les seuils de franchise de TVA dans Paramètres pour activer ce suivi.</p>';
      return;
    }
    const eur = CC.util.eur0;
    const suiv = year + 1;
    const niveau = t.isCurrent ? t.suivantProj : t.suivant;

    // --- Verdict : une phrase de réponse, une phrase de raison. ---
    const fin = t.isCurrent
      ? `Avec tout ce qui est engagé, tu finirais ${year} à <b>${eur(t.projete)}</b>`
      : `Tu as encaissé <b>${eur(t.enc)}</b> en ${year}`;
    let cls, rep, pourquoi;
    if (t.franchi) {
      cls = 'danger';
      rep = 'Oui — TVA due depuis le ' + CC.util.frDate(t.franchi);
      pourquoi = `Le seuil majoré a été franchi le ${CC.util.frDate(t.franchi)}. La franchise tombe à cette date, dès la facture suivante — pas au 1er janvier.`;
    } else if (niveau === 'tva-immediate') {
      cls = 'danger';
      rep = t.isCurrent ? 'Oui — et dès cette année' : 'Oui — TVA en cours d’année ' + year;
      pourquoi = `${fin}, au-dessus du seuil majoré. Au-delà de ${eur(t.majore)} la franchise tombe le jour même, dès la facture suivante.`;
    } else if (niveau === 'tva-janvier') {
      cls = 'warn';
      rep = 'Oui — TVA au 1er janvier ' + suiv;
      pourquoi = `${fin}, au-dessus du seuil de base. Tu gardes la franchise jusqu’au 31 décembre ${year}, puis tu deviens redevable de la TVA au 1er janvier ${suiv}. Dépasser ${eur(t.majore)} avant la fin de l’année avancerait la bascule au jour même.`;
    } else {
      cls = 'ok';
      rep = 'Non — tu restes en franchise en ' + suiv;
      pourquoi = `${fin}, sous le seuil de base. Rien ne change au 1er janvier ${suiv}.`;
    }

    // --- La règle graduée : 0 -> seuil majoré ---
    // Deux murs, pas un : le seuil de base décide de l'an prochain, le seuil
    // majoré décide du jour même.
    const pc = (v) => Math.max(0, Math.min(100, (v / t.majore) * 100));
    const pEnc = pc(t.enc), pBase = pc(t.base), pProj = pc(t.projete);
    const depasse = t.projete > t.majore;
    const proj = (t.isCurrent && pProj > pEnc)
      ? `<div class="ts-proj${depasse ? ' over' : ''}" style="width:${pProj}%"></div>` : '';
    const legProj = t.isCurrent ? `<span><i class="sw proj"></i>engagé ${eur(t.projete)}</span>` : '';

    const ruler = `
      <div class="tva-scale">
        <div class="ts-top"><span class="ts-lab" style="left:${pBase}%"><b>${eur(t.base)}</b><i>seuil de base</i></span></div>
        <div class="ts-track">
          ${proj}
          <div class="ts-enc" style="width:${pEnc}%"></div>
          <div class="ts-tick" style="left:${pBase}%"></div>
          <div class="ts-tol" style="left:${pBase}%"></div>
        </div>
        <div class="ts-foot">
          <span class="ts-zero">0</span>
          <span class="ts-max"><b>${eur(t.majore)}</b><i>seuil majoré — TVA le jour même</i></span>
        </div>
        <div class="ts-key"><span><i class="sw enc"></i>encaissé ${eur(t.enc)}</span>${legProj}<span><i class="sw tol"></i>TVA au 1<sup>er</sup> janvier ${suiv}</span></div>
      </div>`;

    // --- Les chiffres. La marge porte la couleur : c'est elle qui décide. ---
    const figs = [{
      t: 'Encaissé ' + year, v: eur(t.enc),
      d: t.isCurrent ? 'au ' + CC.util.frDate(CC.util.toISO(today)) : 'année complète'
    }];
    if (t.isCurrent && !t.franchi) {
      // Le chiffre qui compte en premier : ce qu'on peut encore encaisser en
      // restant en franchise l'an prochain.
      figs.push({
        t: 'Encaissable en franchise', v: (t.resteBase >= 0 ? '' : '− ') + eur(Math.abs(t.resteBase)),
        d: t.resteBase >= 0 ? `avant ${eur(t.base)} · ${t.jours} j restants` : `seuil de base déjà dépassé`,
        cls: t.resteBase < 0 ? 'neg' : ''
      });
      figs.push({ t: 'Fin d’année engagée', v: eur(t.projete), d: 'encaissé + en attente + prévisionnel' });
      const serre = t.margeBase >= 0 && t.margeBase < t.base * 0.05;
      figs.push({
        t: 'Marge sur l’engagé',
        v: (t.margeBase >= 0 ? '' : '− ') + eur(Math.abs(t.margeBase)),
        d: t.margeBase < 0 ? `au-dessus du seuil de base — TVA au 1er janvier ${suiv}`
          : serre ? `${eur(t.margeBase / Math.max(1, t.jours / 30.4))} par mois seulement` : 'sous le seuil de base',
        cls: t.margeBase < 0 ? 'neg' : (serre ? 'tight' : '')
      });
      // Le second mur ne s'affiche que s'il est en jeu : inutile d'alarmer
      // quelqu'un qui est loin du seuil de base.
      if (t.margeBase < 0 || t.margeMajore < t.majore * 0.1) {
        figs.push({
          t: 'Avant la bascule immédiate',
          v: (t.margeMajore >= 0 ? '' : '− ') + eur(Math.abs(t.margeMajore)),
          d: t.margeMajore < 0 ? `au-dessus de ${eur(t.majore)} — TVA dès la facture suivante` : `avant ${eur(t.majore)}, où la TVA s’applique le jour même`,
          cls: t.margeMajore < 0 ? 'neg' : 'tight'
        });
      }
    }
    const etat = t.encPrec > t.majore ? 'au-dessus du seuil majoré'
      : t.encPrec > t.base ? 'au-dessus du seuil de base' : 'sous le seuil de base';

    box.innerHTML = `
      <div class="tva-head ${cls}">
        <span class="tva-dot"></span>
        <div class="tva-txt">
          <div class="tva-a">${rep}</div>
          <div class="tva-w">${pourquoi}</div>
        </div>
      </div>
      ${ruler}
      <div class="tva-figs">` + figs.map((f) =>
        `<div class="fc"><div class="t">${f.t}</div><div class="v ${f.cls || ''}">${f.v}</div><div class="d">${f.d}</div></div>`
      ).join('') + `</div>
      <p class="tva-rappel">Rappel : ${eur(t.encPrec)} encaissés en ${year - 1}, ${etat}.</p>`;
  })();

  // ---------- Estimation IR ----------
  // On applique le vrai barème progressif, pas la tranche marginale à toute la
  // base : cette dernière surestime largement, et la décote finit d'éloigner
  // le résultat de l'avis réel.
  // Abattement forfaitaire micro-BNC : 34 % du CA, avec un PLANCHER de 305 €.
  // Le plancher ne mord qu'en dessous d'environ 900 € de recettes, mais sans lui
  // un tout petit CA ressortait avec une base imposable trop haute.
  const ab = settings.abattementBNC || 34;
  const abattement = Math.min(enc, Math.max(enc * ab / 100, CC.ABATTEMENT_MINI));
  const baseImp = Math.max(0, enc - abattement);
  const autres = +settings.autresRevenus || 0;
  const baseTotale = baseImp + autres;

  let irBlocks = [
    { t: 'CA encaissé ' + year, v: CC.util.eur0(enc), d: '' },
    { t: `Abattement ${ab}%`, v: '− ' + CC.util.eur0(abattement), d: abattement > enc * ab / 100 ? 'forfaitaire micro-BNC · plancher ' + CC.util.eur0(CC.ABATTEMENT_MINI) : 'forfaitaire micro-BNC' },
    { t: 'Base imposable', v: CC.util.eur0(baseImp), d: autres ? 'de ton activité' : 'à ajouter aux revenus du foyer' }
  ];
  if (autres) irBlocks.push({ t: 'Autres revenus du foyer', v: '+ ' + CC.util.eur0(autres), d: 'saisis dans Paramètres' });

  if (settings.versementActif) {
    irBlocks.push({ t: 'Impôt (versement libératoire)', v: CC.util.eur0(enc * (settings.tauxImpot || 0) / 100), d: `${CC.util.pct(settings.tauxImpot)} du CA` });
  } else {
    const ir = CC.stats.impotIR(baseTotale, {
      parts: settings.parts, couple: settings.coupleFiscal, year: year + 1
    });
    irBlocks.push({ t: 'Impôt brut', v: CC.util.eur0(ir.brut), d: `barème par tranches · ${String(ir.parts).replace('.', ',')} part${ir.parts > 1 ? 's' : ''}` });
    if (ir.decote > 0) irBlocks.push({ t: 'Décote', v: '− ' + CC.util.eur0(ir.decote), d: 'appliquée automatiquement' });
    irBlocks.push({
      t: 'Impôt estimé',
      v: ir.recouvre === 0 && ir.net > 0 ? '0 €' : CC.util.eur0(ir.net),
      d: ir.net === 0 ? 'non imposable' : (ir.recouvre === 0 ? 'non recouvré (< 61 €)' : 'sur le foyer entier')
    });
  }
  document.getElementById('fiscalIR').innerHTML =
    `<div class="ir-grid">` + irBlocks.map((b) => `<div class="fc"><div class="t">${b.t}</div><div class="v">${b.v}</div><div class="d">${b.d}</div></div>`).join('') + `</div>` +
    (settings.versementActif ? '' :
      `<p class="ir-note">Estimation sur le barème ${year + 1} (revenus ${year}).${autres ? '' : ' <b>Si ton foyer a d\u2019autres revenus</b>, renseigne-les dans Paramètres : sans eux, l\u2019impôt est sous-estimé.'} Ni réductions ni crédits d\u2019impôt ne sont pris en compte.</p>`);

  // ---------- Barèmes utilisés ----------
  // Rien ne prévient quand un barème officiel change au 1er janvier : cette carte
  // le rend visible plutôt que de laisser l'app calculer en silence sur l'an dernier.
  (function renderBaremes() {
    const box = document.getElementById('fiscalBaremes');
    if (!box || !CC.baremesUtilises) return;
    const lignes = CC.baremesUtilises(year);
    const perimes = lignes.filter((l) => l.perime).length;
    box.innerHTML =
      (perimes
        ? `<div class="bar-alerte">${perimes} barème${perimes > 1 ? 's' : ''} à mettre à jour pour ${year} — les calculs ci-dessus utilisent en attendant la dernière valeur connue.</div>`
        : `<div class="bar-ok">Tous les barèmes sont à jour pour ${year}.</div>`) +
      lignes.map((l) => `<div class="sd-row${l.perime ? ' bar-vieux' : ''}">
        <span class="sd-src">${l.quoi}</span>
        <span class="sd-amt bar-val">${l.valeur}</span>
        <span class="sd-tag ${l.perime ? '' : 'past'}">${l.perime ? 'à revoir' : l.ou}</span>
      </div>`).join('');
  })();

  // ---------- Calendrier fiscal ----------
  const events = [];
  [year, year + 1].forEach((y) => {
    for (let t = 1; t <= 4; t++) events.push({ date: CC.stats.urssafDeclDeadline(y, t), label: `Déclaration URSSAF T${t} ${y}`, kind: 'URSSAF' });
    events.push({ date: new Date(y, 11, 15), label: `CFE ${y} (cotisation foncière)`, kind: 'CFE' });
    events.push({ date: new Date(y, 4, 25), label: `Déclaration de revenus ${y - 1}`, kind: 'Impôt' });
  });
  const next = events.filter((e) => e.date >= today).sort((a, b) => a.date - b.date).slice(0, 6);
  document.getElementById('fiscalCalendar').innerHTML = next.map((e) => {
    const days = CC.util.daysBetween(today, e.date);
    return `<div class="sd-row"><span class="sd-date">${frD(e.date)}</span><span class="sd-src">${e.label}</span><span class="sd-amt"></span><span class="sd-tag ${days > 30 ? 'past' : ''}">dans ${days} j</span></div>`;
  }).join('');
};
