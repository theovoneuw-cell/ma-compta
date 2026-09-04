'use strict';
window.CC = window.CC || {};

// ---------------------------------------------------------------------------
// Notifications — la plomberie. Le QUOI et le QUAND sont dans rappels.js.
//
// Deux chemins, tres differents :
//   PC (Electron)  : notification Windows native affichee a l'ouverture de
//                    l'app, calculee en local. Rien ne sort de la machine.
//   iPhone (PWA)   : iOS n'a AUCUNE notification locale programmee — un
//                    setTimeout meurt des qu'on quitte l'app. Le seul mecanisme
//                    possible est le Web Push : l'app depose a l'avance ses
//                    rappels rediges sur le Worker Cloudflare, qui les envoie a
//                    l'heure dite, meme app fermee.
// ---------------------------------------------------------------------------

CC.notifs = {
  estElectron() { return !!(window.api && window.api.notify); },
  supportPush() { return ('serviceWorker' in navigator) && ('PushManager' in window) && ('Notification' in window); },

  // iOS n'autorise le Web Push QUE depuis l'app installee sur l'ecran d'accueil.
  iosPasInstallee() {
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone = !!(window.navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches));
    return iOS && !standalone;
  },

  // Identifiant stable de CET appareil (sert de cle d'abonnement cote serveur).
  appareilId() {
    let id = '';
    try { id = localStorage.getItem('notifAppareil') || ''; } catch (_) {}
    if (!id) {
      id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem('notifAppareil', id); } catch (_) {}
    }
    return id;
  },
  appareilNom() {
    if (CC.notifs.estElectron()) return 'PC';
    if (/iPad/.test(navigator.userAgent)) return 'iPad';
    if (/iPhone/.test(navigator.userAgent)) return 'iPhone';
    return 'Navigateur';
  },

  // ---- Appels au Worker (authentifies par la cle partagee des Parametres) ----
  async post(chemin, corps) {
    const conf = CC.rappels.conf();
    if (!conf.serveur) return { error: 'Aucune adresse de serveur dans les Paramètres.' };
    let r;
    try {
      r = await fetch(conf.serveur + chemin, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + conf.cle },
        body: JSON.stringify(corps || {})
      });
    } catch (e) { return { error: 'Serveur injoignable : ' + (e.message || e) }; }
    let j = {};
    try { j = await r.json(); } catch (_) {}
    if (!r.ok) return { error: j.error || ('Erreur serveur ' + r.status) };
    return j;
  },

  // -------------------------------------------------------------------------
  // Au demarrage de l'app
  // -------------------------------------------------------------------------
  async demarrage() {
    const conf = CC.rappels.conf();
    if (!conf.actif) return;
    // 1) Ce qui est du aujourd'hui, affiche ici meme (PC uniquement : sur
    //    l'iPhone ces rappels arrivent par push, les afficher en double serait
    //    du bruit).
    if (CC.notifs.estElectron()) {
      try { await CC.notifs.notifierPc(); } catch (_) {}
    }
    // 2) On repousse les rappels a venir vers le serveur, pour l'iPhone.
    if (conf.serveur) { try { await CC.notifs.envoyerDigest(true); } catch (_) {} }
  },

  async notifierPc() {
    const conf = CC.rappels.conf();
    const dus = CC.rappels.dus();
    const vus = CC.rappels.vus();
    const aMontrer = [];

    // Au-dela de 3 rappels d'un coup, on resume : une avalanche de bulles se
    // fait balayer sans etre lue.
    if (dus.length > 3) {
      aMontrer.push({
        id: 'lot-' + CC.util.toISO(new Date()),
        titre: dus.length + ' rappels en attente',
        corps: dus.slice(0, 3).map((r) => r.titre).join(' · ') + '…',
        onglet: 'today'
      });
      CC.rappels.marquerVus(dus.map((r) => r.id));
    } else {
      dus.forEach((r) => aMontrer.push(r));
      CC.rappels.marquerVus(dus.map((r) => r.id));
    }

    // Agenda et mails : calcules en direct (ils ne se prevoient pas a l'avance).
    // Une fois par jour au maximum, d'ou la cle datee.
    const jour = CC.util.toISO(new Date());
    if (conf.pc.agenda && !vus['agenda-' + jour]) {
      const a = await CC.notifs.agendaDuJour();
      if (a) { aMontrer.push(a); CC.rappels.marquerVus([a.id]); }
    }
    if (conf.pc.mail && !vus['mail-' + jour]) {
      const m = await CC.notifs.mailsNonLus();
      if (m) { aMontrer.push(m); CC.rappels.marquerVus([m.id]); }
    }

    // Espacees de 900 ms : Windows empile sinon les bulles au meme instant.
    aMontrer.forEach((r, i) => {
      setTimeout(() => {
        try { window.api.notify.show({ titre: r.titre, corps: r.corps, onglet: r.onglet, tag: r.id }); } catch (_) {}
      }, i * 900);
    });
    return aMontrer.length;
  },

  async agendaDuJour() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    let res;
    try { res = await window.api.gcal.events({ timeMin: start.toISOString(), timeMax: end.toISOString(), maxResults: 20 }); }
    catch (_) { return null; }
    if (!res || res.error) return null;
    // On ne garde que ce qui reste a venir dans la journee : rappeler un rendez-vous
    // termine il y a trois heures n'apprend rien.
    const evs = (res.events || []).filter((e) => e.journee || !e.debut || new Date(e.debut) >= now);
    if (!evs.length) return null;
    const h = (e) => {
      if (e.journee || !e.debut) return 'journée';
      const d = new Date(e.debut);
      return String(d.getHours()).padStart(2, '0') + 'h' + String(d.getMinutes()).padStart(2, '0');
    };
    return {
      id: 'agenda-' + CC.util.toISO(now),
      titre: evs.length === 1 ? 'Rendez-vous aujourd’hui' : evs.length + ' rendez-vous aujourd’hui',
      corps: evs.slice(0, 4).map((e) => h(e) + ' ' + (e.titre || 'sans titre')).join(' · '),
      onglet: 'agenda'
    };
  },

  async mailsNonLus() {
    let r;
    try { r = await window.api.gmail.unread(); } catch (_) { return null; }
    if (!r || r.error || !r.count) return null;
    return {
      id: 'mail-' + CC.util.toISO(new Date()),
      titre: r.count + (r.count > 1 ? ' mails non lus' : ' mail non lu'),
      corps: 'Boîte de réception principale.',
      onglet: 'mails'
    };
  },

  // -------------------------------------------------------------------------
  // Activation sur CET appareil (bouton des Parametres : geste utilisateur)
  // -------------------------------------------------------------------------
  async activerAppareil() {
    const conf = CC.rappels.conf();

    // PC : rien a demander, Windows affiche les notifications de l'app.
    if (CC.notifs.estElectron()) {
      CC.rappels.set('actif', true);
      try { window.api.notify.show({ titre: 'Ma Compta', corps: 'Les notifications sont activées sur ce PC.', onglet: 'today', tag: 'test' }); } catch (_) {}
      return { ok: true, message: 'Notifications activées sur ce PC.' };
    }

    if (!CC.notifs.supportPush()) return { error: 'Cet appareil ne gère pas les notifications web.' };
    if (CC.notifs.iosPasInstallee()) {
      return { error: 'Sur iPhone, ajoute d’abord Ma Compta à l’écran d’accueil (Partager → « Sur l’écran d’accueil »), puis rouvre l’app depuis l’icône.' };
    }
    if (!conf.serveur || !conf.vapid) return { error: 'Renseigne l’adresse du serveur et la clé publique dans les Paramètres.' };

    // IMPORTANT (Safari/iOS) : la demande de permission doit partir DANS le geste
    // de clic. On la fait donc en tout premier, avant le moindre await.
    let perm;
    try { perm = await Notification.requestPermission(); }
    catch (_) { return { error: 'Autorisation refusée par le navigateur.' }; }
    if (perm !== 'granted') return { error: 'Notifications refusées. Réglages iOS → Ma Compta → Notifications pour changer d’avis.' };

    let reg;
    try { reg = await navigator.serviceWorker.ready; }
    catch (_) { return { error: 'Service worker indisponible (recharge l’app).' }; }

    let sub;
    try {
      sub = await reg.pushManager.getSubscription();
      if (sub) {
        // Un abonnement fabrique avec une AUTRE cle VAPID ne recevra jamais rien :
        // on le remplace plutot que de le garder par economie.
        const ancienne = sub.options && sub.options.applicationServerKey
          ? CC.notifs.b64(sub.options.applicationServerKey) : '';
        if (ancienne && ancienne !== conf.vapid.replace(/=+$/, '')) { await sub.unsubscribe(); sub = null; }
      }
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: CC.notifs.vapidBytes(conf.vapid)
        });
      }
    } catch (e) { return { error: 'Abonnement impossible : ' + (e.message || e) }; }

    const r = await CC.notifs.post('/abonner', {
      id: CC.notifs.appareilId(), nom: CC.notifs.appareilNom(), sub: sub.toJSON()
    });
    if (r.error) return r;

    CC.rappels.set('actif', true);
    await CC.notifs.envoyerDigest(true);
    return { ok: true, message: 'Notifications activées sur cet ' + CC.notifs.appareilNom() + '.' };
  },

  async desactiverAppareil() {
    if (!CC.notifs.estElectron() && CC.notifs.supportPush()) {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      } catch (_) {}
      await CC.notifs.post('/desabonner', { id: CC.notifs.appareilId() });
    }
    CC.rappels.set('actif', false);
    return { ok: true };
  },

  // Cle VAPID base64url -> Uint8Array (format attendu par pushManager.subscribe)
  vapidBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(s);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  },
  // ArrayBuffer -> base64url (pour comparer la cle d'un abonnement existant)
  b64(buf) {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },

  // -------------------------------------------------------------------------
  // Envoi du paquet de rappels au Worker
  // -------------------------------------------------------------------------
  async envoyerDigest(silencieux) {
    const conf = CC.rappels.conf();
    if (!conf.serveur) { if (!silencieux) CC.toast('Aucune adresse de serveur.', 'err'); return { error: 'pas de serveur' }; }
    const digest = CC.rappels.digest();
    const r = await CC.notifs.post('/digest', {
      digest,
      clients: conf.push.mail ? CC.notifs.clientsRecents() : [],
      mail: !!conf.push.mail
    });
    if (!silencieux) {
      if (r.error) CC.toast('Envoi des rappels impossible : ' + r.error, 'err');
      else CC.toast(digest.items.length + ' rappel(s) programmé(s) sur le serveur ✓', 'ok');
    }
    return r;
  },

  // Noms de clients servant au filtrage des mails cote Worker. On se limite aux
  // clients FACTURES DEPUIS 18 MOIS et aux noms assez longs pour ne pas
  // declencher sur n'importe quel expediteur (« NICE » matcherait tout).
  clientsRecents() {
    const S = CC.state;
    const limite = CC.util.addDays(new Date(), -548);
    const noms = new Set();
    (S.factures || []).forEach((f) => {
      const d = CC.util.parseDate(f.dateEncaissement || f.dateEnvoi || f.dateEcheance);
      if (d && d < limite) return;
      const n = CC.util.clientKey(f.libelle);
      if (n && n.length >= 6 && n !== '(SANS NOM)') noms.add(n);
    });
    return Array.from(noms).slice(0, 80);
  },

  async testerPush() {
    const r = await CC.notifs.post('/test', { id: CC.notifs.appareilId() });
    if (r.error) CC.toast('Test impossible : ' + r.error, 'err');
    else CC.toast('Notification de test envoyée — elle doit arriver sur tes appareils abonnés.', 'ok');
    return r;
  },

  // Cet appareil est-il REELLEMENT abonne (permission accordee + abonnement
  // push vivant) ? Seul moyen honnete de renseigner la pastille d'etat.
  async abonnementLocal() {
    if (!CC.notifs.supportPush() || Notification.permission !== 'granted') return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      return !!(await reg.pushManager.getSubscription());
    } catch (_) { return false; }
  },

  // -------------------------------------------------------------------------
  // Carte « Notifications » des Parametres
  // -------------------------------------------------------------------------
  render() {
    const conf = CC.rappels.conf();
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    const chk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };

    set('notifHeure', conf.heure);
    set('notifServeur', conf.serveur);
    set('notifVapid', conf.vapid);
    set('notifCle', conf.cle);
    chk('notifPcUrssaf', conf.pc.urssaf); chk('notifPcRetard', conf.pc.retard);
    chk('notifPcAgenda', conf.pc.agenda); chk('notifPcMail', conf.pc.mail);
    chk('notifPcDocs', conf.pc.docs);
    chk('notifPushUrssaf', conf.push.urssaf); chk('notifPushRetard', conf.push.retard);
    chk('notifPushHebdo', conf.push.hebdo); chk('notifPushMail', conf.push.mail);

    // Etat de CET appareil. Le reglage « actif » est partage par le fichier de
    // compta (donc vu par le PC et l'iPhone), mais l'autorisation et
    // l'abonnement, eux, sont propres a l'appareil : c'est ce qu'on affiche,
    // sinon l'iPhone se dirait « actif » sans etre abonne a quoi que ce soit.
    const pill = document.getElementById('notifEtat');
    if (pill) {
      if (CC.notifs.estElectron()) {
        pill.textContent = conf.actif ? 'actif sur ce PC' : 'inactif';
        pill.className = conf.actif ? 'pill ok' : 'pill';
      } else if (CC.notifs.iosPasInstallee()) {
        pill.textContent = 'ajoute l’app à l’écran d’accueil'; pill.className = 'pill';
      } else {
        pill.textContent = 'vérification…'; pill.className = 'pill';
        CC.notifs.abonnementLocal().then((abonne) => {
          pill.textContent = abonne ? 'actif sur cet ' + CC.notifs.appareilNom() : 'inactif sur cet appareil';
          pill.className = abonne ? 'pill ok' : 'pill';
        });
      }
    }

    // Le bloc PC (agenda/mails) ne concerne pas la PWA, et inversement.
    const blocPc = document.getElementById('notifBlocPc');
    if (blocPc) blocPc.classList.toggle('hidden', !CC.notifs.estElectron());

    // Apercu : les 4 prochains rappels reellement programmes.
    const box = document.getElementById('notifApercu');
    if (box) {
      const prochains = CC.rappels.liste().filter((r) => r.at > Date.now()).slice(0, 4);
      box.innerHTML = prochains.length
        ? prochains.map((r) => {
            const d = new Date(r.at);
            const q = d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' }) +
                      ' à ' + String(d.getHours()).padStart(2, '0') + 'h';
            return '<div class="ck-row"><div class="ck-main"><div class="ck-t">' + escN(r.titre) +
                   '</div><div class="ck-s">' + q + ' · ' + escN(r.corps) + '</div></div></div>';
          }).join('')
        : '<div class="ck-empty">Rien de programmé pour l’instant.</div>';
    }
  },

  bind() {
    const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    const coche = (id, chemin) => on(id, 'change', (e) => { CC.rappels.set(chemin, e.target.checked); CC.notifs.render(); });

    coche('notifPcUrssaf', 'pc.urssaf'); coche('notifPcRetard', 'pc.retard');
    coche('notifPcAgenda', 'pc.agenda'); coche('notifPcMail', 'pc.mail');
    coche('notifPcDocs', 'pc.docs');
    coche('notifPushUrssaf', 'push.urssaf'); coche('notifPushRetard', 'push.retard');
    coche('notifPushHebdo', 'push.hebdo'); coche('notifPushMail', 'push.mail');

    on('notifHeure', 'change', (e) => {
      let h = parseInt(e.target.value, 10); if (isNaN(h)) h = 9;
      CC.rappels.set('heure', Math.max(0, Math.min(23, h)));
      CC.notifs.render();
    });
    ['notifServeur', 'notifVapid', 'notifCle'].forEach((id) => {
      const chemin = { notifServeur: 'serveur', notifVapid: 'vapid', notifCle: 'cle' }[id];
      on(id, 'change', (e) => { CC.rappels.set(chemin, String(e.target.value || '').trim()); });
    });

    on('notifActiver', 'click', async (e) => {
      const b = e.target; const t = b.textContent;
      b.disabled = true; b.textContent = 'Activation…';
      const r = await CC.notifs.activerAppareil();
      b.disabled = false; b.textContent = t;
      if (r.error) CC.toast(r.error, 'err'); else CC.toast(r.message || 'Activé ✓', 'ok');
      CC.notifs.render();
    });
    on('notifDesactiver', 'click', async () => {
      await CC.notifs.desactiverAppareil();
      CC.toast('Notifications désactivées sur cet appareil.', 'ok');
      CC.notifs.render();
    });
    on('notifSync', 'click', () => CC.notifs.envoyerDigest(false));
    on('notifTest', 'click', () => CC.notifs.testerPush());

    // Clic sur une notification POUSSEE (iPhone) : si l'app etait ouverte, le
    // service worker nous transmet l'onglet ; si elle etait fermee, il la
    // rouvre avec ?onglet=... dans l'URL.
    if (navigator.serviceWorker && navigator.serviceWorker.addEventListener) {
      navigator.serviceWorker.addEventListener('message', (e) => {
        const d = e.data || {};
        if (d.type === 'notif-clic' && d.onglet) CC.switchTab(d.onglet);
      });
    }
    try {
      const onglet = new URLSearchParams(location.search).get('onglet');
      if (onglet) setTimeout(() => CC.switchTab(onglet), 300);
    } catch (_) {}
  }
};

function escN(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
