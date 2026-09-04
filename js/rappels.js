'use strict';
window.CC = window.CC || {};

// ---------------------------------------------------------------------------
// Moteur de rappels : le SEUL endroit qui decide « quoi prevenir, et quand ».
// Il n'affiche rien lui-meme. Il produit une liste de rappels dates, consommee
// par deux clients :
//   - notifs.js sur le PC  -> notification Windows a l'ouverture de l'app ;
//   - le Worker Cloudflare -> notification poussee sur l'iPhone, app fermee.
//
// Consequence voulue : le calcul reste TOUJOURS sur tes appareils. Le serveur
// ne recoit que des messages deja rediges et leur heure d'envoi, jamais ta
// comptabilite (aucune facture brute, aucun fichier, aucun jeton de donnees).
// ---------------------------------------------------------------------------

CC.rappels = {
  // Nombre de jours de rappels envoyes d'avance au serveur. Au-dela, l'iPhone
  // ne serait plus prevenu si l'app n'est pas ouverte pendant des mois ; en
  // dessous, on repousserait trop souvent le meme calcul.
  HORIZON: 120,

  defaults() {
    return {
      actif: false,          // interrupteur general (active depuis Parametres)
      heure: 9,              // heure d'envoi des rappels (0-23, heure locale)
      pc: { urssaf: true, retard: true, agenda: true, mail: true, docs: true },
      push: { urssaf: true, retard: true, hebdo: true, mail: true },
      serveur: '',           // URL du Worker Cloudflare (sans / final)
      vapid: '',             // cle publique VAPID du Worker
      cle: ''                // cle partagee app <-> Worker (autorise les envois)
    };
  },

  // Reglages effectifs = defauts + ce qui est enregistre dans le fichier compta
  // (donc partages PC <-> iPhone via Drive, comme le reste des parametres).
  conf() {
    const d = CC.rappels.defaults();
    const s = (CC.state && CC.state.settings && CC.state.settings.notif) || {};
    return {
      actif: s.actif != null ? !!s.actif : d.actif,
      heure: (s.heure != null && !isNaN(s.heure)) ? Math.max(0, Math.min(23, +s.heure)) : d.heure,
      pc: Object.assign({}, d.pc, s.pc || {}),
      push: Object.assign({}, d.push, s.push || {}),
      serveur: String(s.serveur || d.serveur).replace(/\/+$/, ''),
      vapid: String(s.vapid || d.vapid).trim(),
      cle: String(s.cle || d.cle).trim()
    };
  },

  // Ecrit un reglage (chemin pointe, ex. 'push.hebdo') et marque le fichier modifie.
  set(chemin, valeur) {
    const S = CC.state;
    S.settings.notif = Object.assign(CC.rappels.defaults(), S.settings.notif || {});
    const parts = chemin.split('.');
    let o = S.settings.notif;
    while (parts.length > 1) { const k = parts.shift(); o[k] = Object.assign({}, o[k]); o = o[k]; }
    o[parts[0]] = valeur;
    CC.markDirty();
  },

  // -------------------------------------------------------------------------
  // Formatage des montants.
  //
  // ATTENTION : on n'utilise PAS CC.util.eur() ici. En mode discret il renvoie
  // « ••• € » : le texte partirait masque dans les notifications (et donc sur
  // le serveur). Un rappel doit rester lisible quel que soit l'affichage.
  // -------------------------------------------------------------------------
  eur(n) {
    if (n == null || isNaN(n)) n = 0;
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
  },
  jour(d) { return d ? d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : ''; },

  // Date + heure locale -> horodatage absolu (ms). On envoie de l'absolu au
  // serveur : plus aucune question de fuseau ni d'heure d'ete cote Worker.
  a(d, heure) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), heure, 0, 0, 0).getTime();
  },

  // Echeance effective d'une facture emise : sa date d'echeance, sinon la date
  // d'envoi + le delai de paiement par defaut. Meme regle que CC.stats.statut().
  echeanceDe(f, settings) {
    if (f.dateEcheance) return CC.util.parseDate(f.dateEcheance);
    if (f.dateEnvoi) {
      const env = CC.util.parseDate(f.dateEnvoi);
      if (env) return CC.util.addDays(env, (settings && settings.delaiPaiement) || 30);
    }
    return null;
  },

  // Factures reellement a relancer : emises, non encaissees, non previsionnelles.
  impayees() {
    const S = CC.state;
    return (S.factures || []).filter((f) => !CC.stats.isPaid(f) && !CC.stats.isPrevu(f) && CC.stats.isInvoiced(f));
  },

  // -------------------------------------------------------------------------
  // Construction de la liste des rappels.
  // Chaque rappel : { id, at (ms), type, titre, corps, onglet }
  // `id` est stable : il sert a ne jamais notifier deux fois la meme chose.
  // -------------------------------------------------------------------------
  liste(now) {
    now = now || new Date();
    const S = CC.state, settings = S.settings;
    const conf = CC.rappels.conf();
    const H = conf.heure;
    const debut = CC.util.addDays(now, -2).getTime();   // on rattrape 2 jours de retard
    const fin = CC.util.addDays(now, CC.rappels.HORIZON).getTime();
    const out = [];
    const garder = (r) => { if (r.at >= debut && r.at <= fin) out.push(r); };

    // ---- URSSAF : J-7 puis J-1 avant chaque date limite de declaration ----
    const yNow = now.getFullYear();
    for (let y = yNow - 1; y <= yNow + 1; y++) {
      for (let t = 1; t <= 4; t++) {
        const dl = CC.stats.urssafDeclDeadline(y, t);
        if (!dl) continue;
        if (((S.declarations || {})[y + '-' + t] || {}).declare) continue;   // deja declare
        const enc = CC.stats.encaisseTrim(S.factures, y, t);
        const taux = CC.urssafRate(y, t);
        const caTxt = 'CA à déclarer ' + CC.rappels.eur(enc) + ' · cotisations estimées ' + CC.rappels.eur(enc * taux / 100);
        garder({
          id: 'urssaf-' + y + '-' + t + '-j7', at: CC.rappels.a(CC.util.addDays(dl, -7), H), type: 'urssaf',
          titre: 'URSSAF T' + t + ' ' + y + ' — dans 7 jours',
          corps: 'À déclarer avant le ' + CC.rappels.jour(dl) + '. ' + caTxt + '.',
          onglet: 'fiscal'
        });
        garder({
          id: 'urssaf-' + y + '-' + t + '-j1', at: CC.rappels.a(CC.util.addDays(dl, -1), H), type: 'urssaf',
          titre: 'URSSAF T' + t + ' ' + y + ' — dernier jour demain',
          corps: 'Date limite le ' + CC.rappels.jour(dl) + '. ' + caTxt + '.',
          onglet: 'fiscal'
        });
      }
    }

    // ---- Factures : le lendemain du jour ou l'echeance est depassee ----
    CC.rappels.impayees().forEach((f) => {
      const ech = CC.rappels.echeanceDe(f, settings);
      if (!ech) return;
      garder({
        id: 'retard-' + (f.id || (f.numFacture || '?') + '-' + (f.montant || 0)),
        at: CC.rappels.a(CC.util.addDays(ech, 1), H), type: 'retard',
        titre: 'Facture échue — ' + CC.util.clientKey(f.libelle),
        corps: CC.rappels.eur(+f.montant || 0) + (f.numFacture ? ' · n°' + f.numFacture : '') +
               ' · échéance du ' + CC.rappels.jour(ech) + '. À relancer.',
        onglet: 'factures'
      });
    });

    // ---- Bilan du lundi matin ----
    // Les impayes des lundis futurs sont PROJETES : on compte les factures
    // aujourd'hui non payees dont l'echeance sera passee ce lundi-la. Si tu
    // encaisses entre-temps, le renvoi du recapitulatif (a la prochaine
    // ouverture de l'app) corrige le tir.
    const imp = CC.rappels.impayees();
    let lundi = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    lundi.setDate(lundi.getDate() + ((8 - lundi.getDay()) % 7 || 7));   // prochain lundi
    for (let k = 0; k < 20; k++) {
      const at = CC.rappels.a(lundi, H);
      if (at > fin) break;
      const dus = imp.filter((f) => { const e = CC.rappels.echeanceDe(f, settings); return e && e.getTime() < at; });
      const tot = dus.reduce((a, f) => a + (+f.montant || 0), 0);
      const prochaine = CC.rappels.prochaineUrssaf(new Date(at));
      const bouts = [dus.length ? dus.length + ' impayé(s) en cours — ' + CC.rappels.eur(tot) : 'Aucun impayé'];
      if (prochaine) bouts.push('URSSAF ' + prochaine.label + ' à déclarer avant le ' + CC.rappels.jour(prochaine.dl));
      if (k === 0) bouts.push('CA encaissé ' + now.getFullYear() + ' : ' + CC.rappels.eur(CC.stats.encaisseYear(S.factures, now.getFullYear())));
      garder({
        id: 'hebdo-' + CC.util.toISO(lundi), at, type: 'hebdo',
        titre: 'Bilan de la semaine', corps: bouts.join(' · ') + '.', onglet: 'today'
      });
      lundi = CC.util.addDays(lundi, 7);
    }

    // ---- Coffre a documents : avant qu'une piece perde sa validite ----
    // Deux rappels : a l'avance (delai choisi sur la fiche, 30 j par defaut),
    // puis le jour meme. Une attestation perimee decouverte le jour ou un
    // client la reclame, c'est un chantier qui attend.
    //
    // Ces rappels n'existent que sur l'ordinateur : les documents y sont, et
    // eux seuls. Ils sont donc exclus du paquet envoye au serveur (voir digest).
    if (CC.estBureau && CC.estBureau()) {
      (S.documents || []).forEach((d) => {
        if (!d.expire) return;
        const dl = CC.util.parseDate(d.expire);
        if (!dl) return;
        const avant = +d.rappelJours > 0 ? +d.rappelJours : 30;
        const nom = d.titre || d.nom || 'Document';
        garder({
          id: 'doc-' + d.id + '-avant', at: CC.rappels.a(CC.util.addDays(dl, -avant), H), type: 'docs',
          titre: nom + ' — à renouveler',
          corps: 'Valable jusqu\'au ' + CC.rappels.jour(dl) + ', soit dans ' + avant + ' jours. Demande le renouvellement maintenant.',
          onglet: 'coffre'
        });
        garder({
          id: 'doc-' + d.id + '-jour', at: CC.rappels.a(dl, H), type: 'docs',
          titre: nom + ' — périme aujourd\'hui',
          corps: 'Ce document n\'est plus valable à partir de demain. Remplace-le dans le coffre.',
          onglet: 'coffre'
        });
      });
    }

    return out.sort((a, b) => a.at - b.at);
  },

  // Prochaine declaration URSSAF non faite a une date donnee
  prochaineUrssaf(ref) {
    const S = CC.state;
    const y0 = ref.getFullYear();
    for (let y = y0 - 1; y <= y0 + 1; y++) {
      for (let t = 1; t <= 4; t++) {
        const dl = CC.stats.urssafDeclDeadline(y, t);
        if (!dl || dl < ref) continue;
        if (((S.declarations || {})[y + '-' + t] || {}).declare) continue;
        return { annee: y, trimestre: t, dl, label: 'T' + t + ' ' + y };
      }
    }
    return null;
  },

  // -------------------------------------------------------------------------
  // Rappels a montrer MAINTENANT sur cet appareil (PC, a l'ouverture).
  // On ne remonte pas au-dela de 3 jours : une notification d'il y a deux
  // semaines n'apprend plus rien, elle encombre.
  // -------------------------------------------------------------------------
  dus(now) {
    now = now || new Date();
    const conf = CC.rappels.conf();
    const limite = CC.util.addDays(now, -3).getTime();
    const vus = CC.rappels.vus();
    return CC.rappels.liste(now).filter((r) =>
      r.at <= now.getTime() && r.at >= limite && conf.pc[r.type] !== false && !vus[r.id]
    );
  },

  // Memoire « deja notifie », propre a CET appareil (le PC et l'iPhone ne
  // partagent pas leur historique) : localStorage plutot que le fichier compta,
  // pour ne pas polluer les donnees ni declencher un « modifie » a chaque notif.
  vus() {
    try { return JSON.parse(localStorage.getItem('notifVus') || '{}'); } catch (_) { return {}; }
  },
  marquerVus(ids) {
    try {
      const v = CC.rappels.vus(), t = Date.now();
      ids.forEach((id) => { v[id] = t; });
      const vieux = t - 180 * 86400000;                  // purge : la table ne gonfle pas
      Object.keys(v).forEach((k) => { if (v[k] < vieux) delete v[k]; });
      localStorage.setItem('notifVus', JSON.stringify(v));
    } catch (_) {}
  },

  // -------------------------------------------------------------------------
  // Paquet envoye au Worker : uniquement les rappels A VENIR, filtres par les
  // types coches pour le push, deja rediges. Le mail n'y figure pas : c'est le
  // Worker qui interroge Gmail, l'app ne peut pas le prevoir a l'avance.
  // -------------------------------------------------------------------------
  digest(now) {
    now = now || new Date();
    const conf = CC.rappels.conf();
    const items = CC.rappels.liste(now)
      // Les rappels du coffre restent sur l'ordinateur : les documents ne sont
      // pas sur le telephone, une notification pousee n'y menerait a rien.
      .filter((r) => r.at > now.getTime() && r.type !== 'docs' && conf.push[r.type] !== false)
      .map((r) => ({ id: r.id, at: r.at, titre: r.titre, corps: r.corps, onglet: r.onglet }));
    return { v: 1, genere: now.getTime(), heure: conf.heure, items };
  }
};
