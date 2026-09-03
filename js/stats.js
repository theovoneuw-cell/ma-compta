'use strict';
window.CC = window.CC || {};

// Modele facture :
//   { id, libelle, montant, modePaiement, numFacture,
//     dateEncaissement (""=non paye), annee, trimestre,
//     dateEnvoi, dateEcheance, notes,
//     previsionnel (true = vente prevue, pas encore facturee) }

CC.stats = {
  isPaid(f) { return !!f.dateEncaissement; },

  // Une facture est "emise" (reellement facturee/envoyee) si elle a un numero.
  isInvoiced(f) { return !!(f.numFacture && String(f.numFacture).trim()); },

  // Previsionnel = vente prevue, pas encore facturee. C'est l'interrupteur
  // "Facture previsionnelle" de la fiche qui fait foi (champ `previsionnel`).
  // Fiches anterieures a cet interrupteur (champ absent) : on garde l'ancienne
  // regle, pas de numero = pas encore emise = previsionnel.
  // Une facture encaissee n'est jamais previsionnelle, quoi qu'il arrive.
  isPrevu(f) {
    if (f.dateEncaissement) return false;
    if (typeof f.previsionnel === 'boolean') return f.previsionnel;
    return !CC.stats.isInvoiced(f);
  },

  // -------------------------------------------------------------------------
  // HORS TAXES / TOUTES TAXES
  //
  // `montant` est, et reste, ce qui entre reellement sur le compte : le TTC.
  // C'est lui qu'on affiche dans la liste des factures et dans les relances —
  // c'est la somme que le client doit.
  //
  // Mais le CHIFFRE D'AFFAIRES, lui, est hors taxes. URSSAF, plafond micro,
  // impot, seuils : tout se calcule sur le HT. Tant que tu es en franchise les
  // deux sont egaux, et rien ne change. Le jour ou tu factures la TVA, cette
  // distinction devient la difference entre des cotisations justes et des
  // cotisations surestimees de 20 %.
  //
  // Une facture sans `tauxTva` (toutes les anciennes) est en franchise : HT = TTC.
  tauxDe(f) {
    const t = +(f && f.tauxTva);
    return (isFinite(t) && t > 0) ? t : 0;
  },

  // Base de calcul du chiffre d'affaires.
  ht(f) {
    const ttc = +(f && f.montant) || 0;
    const taux = CC.stats.tauxDe(f);
    return taux ? ttc / (1 + taux / 100) : ttc;
  },

  // TVA collectee sur cette facture (0 en franchise).
  tvaDe(f) {
    const ttc = +(f && f.montant) || 0;
    return ttc - CC.stats.ht(f);
  },

  // La date qui decide du regime de TVA d'une facture.
  //
  // En prestations de services la TVA est exigible a l'ENCAISSEMENT : c'est donc
  // lui qui commande, pas la date de facturation. Pour une facture pas encore
  // payee on prend la meilleure estimation disponible — l'echeance, sinon le
  // debut du trimestre de rattachement — pour qu'une vente prevue sur 2027 soit
  // proposee avec TVA des aujourd'hui, et qu'une facture de 2026 saisie en
  // retard reste en franchise.
  dateFiscale(f) {
    const aujourdhui = () => CC.util.toISO(new Date());
    if (!f) return aujourdhui();
    if (f.dateEncaissement) return f.dateEncaissement;
    if (f.dateEcheance) return f.dateEcheance;
    const y = +f.annee, t = +f.trimestre;
    if (y && t >= 1 && t <= 4) {
      const z = (n) => String(n).padStart(2, '0');
      return y + '-' + z((t - 1) * 3 + 1) + '-01';
    }
    return aujourdhui();
  },

  // Une facture releve-t-elle de la periode DE FRANCHISE (avant l'assujettissement) ?
  enFranchise(f, settings) {
    const s = settings || (CC.state && CC.state.settings) || {};
    if (!s.tvaActive) return true;
    if (!s.tvaDepuis) return false;
    return CC.stats.dateFiscale(f) < s.tvaDepuis;
  },

  // Le regime applicable a une DATE d'encaissement, d'apres les reglages.
  // Sert a pre-remplir le taux d'une nouvelle facture, jamais a recalculer une
  // facture existante : ce qui a ete facture a ete facture.
  tauxParDefaut(dateISO, settings) {
    const s = settings || (CC.state && CC.state.settings) || {};
    if (!s.tvaActive) return 0;
    if (s.tvaDepuis && dateISO && dateISO < s.tvaDepuis) return 0;
    const t = +s.tauxTvaDefaut;
    return (isFinite(t) && t > 0) ? t : 20;
  },

  // Periode de reference (annee/trimestre) : la feuille Excel fait foi ;
  // pour une facture payee sans periode explicite, on prend la date d'encaissement.
  //
  // Bascule automatique : toute facture NON encaissée (en attente, en retard OU
  // prévisionnelle) dont le trimestre de référence est déjà terminé passe sur le
  // trimestre EN COURS (le CA micro-BNC se déclare à l'encaissement, qui arrivera
  // plus tard). Le calcul est dynamique — aucune donnée n'est modifiée ; dès qu'elle
  // est payée, la période réelle d'encaissement reprend le dessus. Une facture
  // planifiée sur un trimestre FUTUR n'est jamais avancée.
  _periodOf(f, today) {
    let y = f.annee ? +f.annee : (f.dateEncaissement ? CC.util.yearOf(f.dateEncaissement) : null);
    let t = f.trimestre ? +f.trimestre : (f.dateEncaissement ? CC.util.trimestreOfDate(f.dateEncaissement) : null);
    if (y != null && t != null && !f.dateEncaissement) {
      const now = today || new Date();
      const cy = now.getFullYear(), ct = Math.floor(now.getMonth() / 3) + 1;
      if (y * 4 + t < cy * 4 + ct) { y = cy; t = ct; }   // trimestre passé -> trimestre en cours
    }
    return { y, t };
  },
  yearOf(f) { return CC.stats._periodOf(f).y; },
  trimOf(f) { return CC.stats._periodOf(f).t; },

  // Statut : 'recue' (paye) | 'prevu' (pas encore emise) | 'attente' | 'retard'
  statut(f, settings, today = new Date()) {
    if (f.dateEncaissement) return 'recue';
    // Pas encore facturee/envoyee -> previsionnel, jamais en retard
    if (CC.stats.isPrevu(f)) return 'prevu';
    if (f.dateEcheance) {
      const ech = CC.util.parseDate(f.dateEcheance);
      if (ech && today > ech) return 'retard';
    } else if (f.dateEnvoi && settings) {
      const ech = CC.util.addDays(CC.util.parseDate(f.dateEnvoi), settings.delaiPaiement || 30);
      if (ech && today > ech) return 'retard';
    }
    return 'attente';
  },

  years(factures) {
    const set = new Set();
    factures.forEach((f) => { const y = CC.stats.yearOf(f); if (y) set.add(y); });
    return Array.from(set).sort((a, b) => a - b);
  },

  forYear(factures, year) {
    if (year === 'all') return factures.slice();
    return factures.filter((f) => CC.stats.yearOf(f) === year);
  },

  // Sommes par statut pour un lot de factures
  // aVenir = factures EMISES non payees (attente + retard) ; prevu = pas encore emises
  sums(factures, settings) {
    let encaisse = 0, attente = 0, retard = 0, prevu = 0, brut = 0;
    const today = new Date();
    factures.forEach((f) => {
      const m = CC.stats.ht(f); brut += +f.montant || 0;
      const st = CC.stats.statut(f, settings, today);
      if (st === 'recue') encaisse += m;
      else if (st === 'retard') retard += m;
      else if (st === 'prevu') prevu += m;
      else attente += m;
    });
    return { brut, encaisse, attente, retard, prevu, aVenir: attente + retard };
  },

  // Encaisse d'un trimestre precis d'une annee
  encaisseTrim(factures, year, trimestre) {
    let s = 0;
    factures.forEach((f) => {
      if (!CC.stats.isPaid(f)) return;
      if (CC.stats.yearOf(f) !== year || CC.stats.trimOf(f) !== trimestre) return;
      s += CC.stats.ht(f);
    });
    return s;
  },

  encaisseYear(factures, year) {
    let s = 0;
    factures.forEach((f) => { if (CC.stats.isPaid(f) && CC.stats.yearOf(f) === year) s += CC.stats.ht(f); });
    return s;
  },

  // URSSAF par trimestre (encaisse du trimestre x taux du trimestre)
  urssafByTrim(factures, year) {
    const out = [];
    for (let t = 1; t <= 4; t++) {
      const enc = CC.stats.encaisseTrim(factures, year, t);
      const taux = CC.urssafRate(year, t);
      out.push({ trimestre: t, encaisse: enc, taux, urssaf: enc * taux / 100 });
    }
    return out;
  },

  // CA par categorie d'activite (sur une liste deja filtree par annee)
  caByCategory(factures, paidOnly) {
    const map = new Map();
    factures.forEach((f) => {
      if (paidOnly && !CC.stats.isPaid(f)) return;
      const c = f.categorie || CC.util.categoryOf(f.libelle);
      map.set(c, (map.get(c) || 0) + CC.stats.ht(f));
    });
    return Array.from(map.entries()).map(([categorie, total]) => ({ categorie, total })).sort((a, b) => b.total - a.total);
  },

  // TVA collectee, par trimestre puis pour l'annee. Sur les ENCAISSEMENTS, comme
  // le reste de l'app : en prestations de services la TVA est exigible a
  // l'encaissement, pas a la facturation.
  //
  // Ne dit rien de la TVA deductible sur les achats : l'app ne suit pas les
  // depenses. Le montant affiche est donc la TVA collectee brute, pas ce qui
  // sera reellement reverse.
  tvaByTrim(factures, year) {
    const out = [];
    for (let t = 1; t <= 4; t++) {
      let ht = 0, tva = 0;
      factures.forEach((f) => {
        if (!CC.stats.isPaid(f)) return;
        if (CC.stats.yearOf(f) !== year || CC.stats.trimOf(f) !== t) return;
        ht += CC.stats.ht(f);
        tva += CC.stats.tvaDe(f);
      });
      out.push({ trimestre: t, ht, tva });
    }
    return out;
  },

  tvaCollecteeYear(factures, year) {
    const trims = CC.stats.tvaByTrim(factures, year);
    return {
      trims,
      ht: trims.reduce((a, t) => a + t.ht, 0),
      tva: trims.reduce((a, t) => a + t.tva, 0)
    };
  },

  // Date limite de DECLARATION URSSAF d'un trimestre
  // T1 -> 30/04, T2 -> 31/07, T3 -> 31/10, T4 -> 31/01 (annee+1)
  urssafDeclDeadline(year, trimestre) {
    const map = { 1: new Date(year, 3, 30), 2: new Date(year, 6, 31), 3: new Date(year, 9, 31), 4: new Date(year + 1, 0, 31) };
    return map[trimestre];
  },

  // Date de prelevement URSSAF d'un trimestre (~1 mois apres la declaration)
  // T1 -> mai (meme annee), T2 -> aout, T3 -> novembre, T4 -> fevrier (annee+1)
  urssafDueDate(year, trimestre) {
    const map = { 1: { mois: 4, annee: year }, 2: { mois: 7, annee: year }, 3: { mois: 10, annee: year }, 4: { mois: 1, annee: year + 1 } };
    return map[trimestre];
  },

  // Echeancier des prelevements : toutes les echeances depuis fromYear, triees par date
  urssafSchedule(factures, settings, fromYear) {
    const years = CC.stats.years(factures);
    const minY = fromYear || (years[0] || new Date().getFullYear());
    const maxY = Math.max(new Date().getFullYear(), years[years.length - 1] || 0);
    const today = new Date();
    const out = [];
    for (let y = minY; y <= maxY; y++) {
      CC.stats.urssafByTrim(factures, y).forEach((t) => {
        const due = CC.stats.urssafDueDate(y, t.trimestre);
        const dueDate = new Date(due.annee, due.mois, 5);
        out.push({
          trimestre: t.trimestre, annee: y,
          encaisse: t.encaisse, taux: t.taux, urssaf: t.urssaf,
          due, dueDate,
          statut: dueDate <= today ? 'preleve' : 'a-venir'
        });
      });
    }
    return out.sort((a, b) => a.dueDate - b.dueDate);
  },

  // Cotisations annuelles + net
  cotisationsYear(factures, year, settings) {
    const trims = CC.stats.urssafByTrim(factures, year);
    const urssaf = trims.reduce((a, t) => a + t.urssaf, 0);
    const encaisse = trims.reduce((a, t) => a + t.encaisse, 0);
    const impot = settings.versementActif ? encaisse * (settings.tauxImpot || 0) / 100 : 0;
    return { urssaf, impot, encaisse, net: encaisse - urssaf - impot, trims };
  },

  // Encaisse par mois (12) selon la DATE d'encaissement
  monthlyEncaisse(factures, year) {
    const arr = new Array(12).fill(0);
    factures.forEach((f) => {
      if (!CC.stats.isPaid(f)) return;
      const d = CC.util.parseDate(f.dateEncaissement);
      if (d && d.getFullYear() === year) arr[d.getMonth()] += CC.stats.ht(f);
    });
    return arr;
  },

  // Non paye par trimestre selon la periode. `kind` :
  //   'emis'  -> seulement les factures deja emises (attente + retard)
  //   'prevu' -> seulement les previsionnelles
  //   absent  -> tout le non paye (comportement historique)
  attenteByTrim(factures, year, kind) {
    const arr = [0, 0, 0, 0];
    factures.forEach((f) => {
      if (CC.stats.isPaid(f)) return;
      if (kind) {
        const p = CC.stats.isPrevu(f);
        if (kind === 'emis' && p) return;
        if (kind === 'prevu' && !p) return;
      }
      if (CC.stats.yearOf(f) !== year) return;
      const t = CC.stats.trimOf(f);
      if (t) arr[t - 1] += CC.stats.ht(f);
    });
    return arr;
  },

  topClients(factures, limit = 8) {
    const map = new Map();
    factures.forEach((f) => {
      const c = CC.util.clientKey(f.libelle);
      const cur = map.get(c) || { client: c, total: 0, paye: 0, count: 0 };
      cur.total += CC.stats.ht(f);
      if (CC.stats.isPaid(f)) cur.paye += CC.stats.ht(f);
      cur.count += 1;
      map.set(c, cur);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, limit);
  },

  avgInvoice(factures) {
    if (!factures.length) return 0;
    return factures.reduce((a, f) => a + CC.stats.ht(f), 0) / factures.length;
  },

  // Saisonnalite : encaisse moyen par mois sur toutes les annees
  seasonality(factures) {
    const years = CC.stats.years(factures);
    const totals = new Array(12).fill(0);
    years.forEach((y) => { const m = CC.stats.monthlyEncaisse(factures, y); for (let i = 0; i < 12; i++) totals[i] += m[i]; });
    const n = years.length || 1;
    return totals.map((t) => t / n);
  },

  // Croissance EN TEMPS REEL : cumul encaisse du 1er jan -> aujourd'hui,
  // compare a la meme periode l'an dernier (meme jour/mois).
  yoyRealtime(factures, year) {
    const today = new Date();
    const isCurrent = (year === today.getFullYear());
    // borne = aujourd'hui si annee en cours, sinon 31/12
    const cutMonth = isCurrent ? today.getMonth() : 11;
    const cutDay = isCurrent ? today.getDate() : 31;

    function cumulTo(y) {
      let s = 0;
      factures.forEach((f) => {
        if (!CC.stats.isPaid(f)) return;
        const d = CC.util.parseDate(f.dateEncaissement);
        if (!d || d.getFullYear() !== y) return;
        // <= meme jour/mois
        if (d.getMonth() < cutMonth || (d.getMonth() === cutMonth && d.getDate() <= cutDay)) s += CC.stats.ht(f);
      });
      return s;
    }
    const cur = cumulTo(year);
    const prev = cumulTo(year - 1);
    if (!prev) return { cur, prev, pct: null, isCurrent };
    return { cur, prev, pct: ((cur - prev) / prev) * 100, isCurrent };
  },

  // -------------------------------------------------------------------------
  // IMPOT SUR LE REVENU — bareme reel, pas « tranche x base »
  //
  // Appliquer la TMI a toute la base surestime lourdement l'impot : les premiers
  // euros sont taxes a 0 %, puis a 11 %, etc. Et pour les revenus modestes la
  // DECOTE retranche encore plusieurs centaines d'euros. D'ou ce calcul complet.
  //
  // Limites assumees : pas de plafonnement du quotient familial (il ne mord
  // qu'a des revenus eleves avec enfants), pas de reductions ni credits d'impot.
  impotIR(baseTotale, opts) {
    const parts = Math.max(1, +opts.parts || 1);
    const tranches = CC.baremeIR(opts.year);
    const D = CC.DECOTE_IR;

    // 1. Bareme applique au quotient familial, puis remultiplie par les parts.
    const q = Math.max(0, baseTotale) / parts;
    let parPart = 0, bas = 0;
    for (const t of tranches) {
      if (q > bas) parPart += (Math.min(q, t.jusqua) - bas) * t.taux / 100;
      bas = t.jusqua;
      if (q <= bas) break;
    }
    const brut = parPart * parts;

    // 2. Decote : seuil et forfait dependent du fait d'etre en couple ou non,
    //    pas du nombre de parts (un parent isole reste « personne seule »).
    const couple = !!opts.couple;
    const plafond = couple ? D.plafondCouple : D.plafondSeul;
    const forfait = couple ? D.couple : D.seul;
    const decote = (brut > 0 && brut <= plafond)
      ? Math.max(0, Math.min(brut, forfait - brut * D.taux / 100))
      : 0;

    // 3. L'impot n'est pas recouvre en dessous de 61 EUR.
    const net = Math.max(0, brut - decote);
    return { brut, decote, net, recouvre: net >= 61 ? net : 0, parts, quotient: q };
  },

  // -------------------------------------------------------------------------
  // FRANCHISE EN BASE DE TVA
  //
  // Regime en vigueur depuis 2025 (prestations de services). TROIS cas, et non
  // deux — c'est la nuance qui change tout :
  //
  //   CA(N) <= base            -> franchise ; rien ne change au 1er janvier N+1
  //   base < CA(N) <= majore   -> franchise jusqu'au 31 decembre N, puis
  //                               REDEVABLE DE LA TVA AU 1er JANVIER N+1
  //   CA(N) > majore           -> franchise perdue IMMEDIATEMENT, des la
  //                               premiere facture emise apres le depassement
  //
  // Le seuil majore ne protege donc RIEN. Il n'ouvre pas une bande de tolerance
  // qui reconduirait la franchise — ca, c'etait l'ANCIEN regime, celui ou
  // l'annee N-2 intervenait. Il decide seulement de la DATE de bascule : au
  // 1er janvier suivant, ou le jour meme.
  //
  // Autre particularite, inchangee : on raisonne en ANNEE CIVILE
  // D'ENCAISSEMENT, pas en periode declaree URSSAF. Un virement du 5 janvier
  // compte pour l'annee ou il tombe, meme si la facture se rattache au
  // trimestre precedent.
  tva(factures, year, settings, today = new Date()) {
    const base = +settings.seuilTvaBase || 0;
    const majore = +settings.seuilTvaMajore || 0;

    const ofYear = (y) => factures.filter((f) => f.dateEncaissement && CC.util.yearOf(f.dateEncaissement) === y);
    const somme = (l) => l.reduce((a, f) => a + CC.stats.ht(f), 0);
    const payees = ofYear(year);
    const enc = somme(payees);
    const encPrec = somme(ofYear(year - 1));

    // Jour exact du franchissement du seuil MAJORE : on rejoue les encaissements
    // dans l'ordre. C'est le seul depassement qui coupe la franchise sur-le-champ.
    let cumul = 0, franchi = null;
    payees.slice().sort((a, b) => a.dateEncaissement.localeCompare(b.dateEncaissement))
      .forEach((f) => { cumul += CC.stats.ht(f); if (!franchi && majore && cumul > majore) franchi = f.dateEncaissement; });

    // Fin d'annee attendue, sur la meme base civile. Pour la TVA on ne s'appuie
    // QUE sur ce qui est engage : encaisse + factures emises non payees + ventes
    // prevues. Pas d'extrapolation du rythme : le franchissement d'un seuil
    // fiscal ne se decide pas sur une tendance, il se constate.
    const isCurrent = (year === today.getFullYear());
    const start = new Date(year, 0, 1), end = new Date(year, 11, 31);
    const totalDays = CC.util.daysBetween(start, end) + 1;
    const dayOfYear = isCurrent ? CC.util.daysBetween(start, today) + 1 : totalDays;
    const aVenir = CC.stats.attenteByTrim(factures, year, 'emis').reduce((a, b) => a + b, 0);
    const prevu = CC.stats.attenteByTrim(factures, year, 'prevu').reduce((a, b) => a + b, 0);
    const rythme = (isCurrent && dayOfYear > 0) ? (enc / dayOfYear) * totalDays : enc;
    const carnet = enc + aVenir + prevu;
    const projete = isCurrent ? carnet : enc;

    // Trois issues possibles, dans l'ordre de gravite. On classe deux fois :
    // sur l'encaisse acquise (elle fait foi pour une annee close) et sur
    // l'engage (seule lecture honnete tant que l'annee court).
    const classe = (ca) => {
      if (majore && ca > majore) return 'tva-immediate';   // bascule en cours d'annee
      if (base && ca > base) return 'tva-janvier';         // bascule au 1er janvier suivant
      return 'franchise';
    };
    const suivant = classe(enc);
    const suivantProj = classe(projete);

    return {
      year, base, majore, enc, encPrec, franchi, suivant, suivantProj, isCurrent,
      aVenir, prevu, rythme, carnet, projete,
      // Deux seuils, deux consequences, donc deux marges a suivre.
      resteBase: base - enc,          // encore encaissable en restant en franchise l'an prochain
      resteMajore: majore - enc,      // encore encaissable avant la bascule immediate
      margeBase: base - projete,      // la meme chose, sur l'engage
      margeMajore: majore - projete,
      jours: totalDays - dayOfYear    // jours restants dans l'annee
    };
  },

  // Previsionnel annee en cours
  forecast(factures, year, settings) {
    const today = new Date();
    const isCurrent = (year === today.getFullYear());
    const encaisse = CC.stats.encaisseYear(factures, year);
    // On separe ce qui est deja facture de ce qui n'est que prevu : les deux
    // nourrissent la projection, mais l'utilisateur doit voir la part "promesse".
    const aVenir = CC.stats.attenteByTrim(factures, year, 'emis').reduce((a, b) => a + b, 0);
    const prevu = CC.stats.attenteByTrim(factures, year, 'prevu').reduce((a, b) => a + b, 0);

    const start = new Date(year, 0, 1), end = new Date(year, 11, 31);
    const dayOfYear = isCurrent ? CC.util.daysBetween(start, today) + 1 : 366;
    const totalDays = CC.util.daysBetween(start, end) + 1;

    // Deux lectures possibles de la fin d'annee : l'extrapolation du rythme
    // constate, et le carnet deja engage. On retient la plus haute — et on
    // renvoie les deux, pour que l'ecran puisse dire laquelle il montre.
    const rythme = (isCurrent && dayOfYear > 0) ? (encaisse / dayOfYear) * totalDays : encaisse;
    const carnet = encaisse + aVenir + prevu;
    const projete = isCurrent ? Math.max(rythme, carnet) : encaisse;
    // URSSAF projetee : on applique le taux moyen connu de l'annee a la projection
    const trims = CC.stats.urssafByTrim(factures, year);
    const tauxMoyen = (trims.reduce((a, t) => a + t.taux, 0) / 4) / 100;
    const urssafProj = projete * tauxMoyen;
    const impotProj = settings.versementActif ? projete * (settings.tauxImpot || 0) / 100 : 0;
    const netProj = projete - urssafProj - impotProj;

    const yearsPrev = CC.stats.years(factures).filter((y) => y < year);
    const histAvg = yearsPrev.length
      ? yearsPrev.reduce((a, y) => a + CC.stats.encaisseYear(factures, y), 0) / yearsPrev.length : null;

    return { isCurrent, encaisse, aVenir, prevu, rythme, carnet, projete, dayOfYear, totalDays, urssafProj, netProj, histAvg };
  }
};
