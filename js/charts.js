'use strict';
window.CC = window.CC || {};
CC._charts = {};

// ---------------------------------------------------------------------------
// Couleurs des graphiques
//
// Chaque couleur fait UN travail, et la palette a ete verifiee (separation pour
// les daltoniens, contraste sur la carte, clair ET sombre) :
//   - etat de l'argent : paye (vert), en attente (ambre), prevu (indigo),
//     en retard (rouge). Ordre de pose fixe paye > attente > prevu > retard :
//     le rouge et l'ambre ne se touchent jamais (trop proches pour un daltonien).
//   - une seule serie (activites, saisonnalite) : l'accent indigo.
//   - contexte (l'an passe) : un gris, qui ne rivalise pas avec l'annee en cours.
//   - annees comparees : une rampe indigo, de la plus ancienne (claire en mode
//     clair) a la plus recente (foncee) — l'ordre se lit dans la couleur.
// Le sombre a ses propres pas, pas une inversion automatique.
// ---------------------------------------------------------------------------
const PAL = {
  light: {
    paye: '#0ea371', attente: '#c2740a', prevu: '#6366f1', retard: '#dc2626',
    accent: '#4f46e5', contexte: '#9690b3', fond: '#ffffff',
    annees: ['#9aa6fb', '#818cf8', '#6366f1', '#4f46e5', '#3730a3']
  },
  dark: {
    paye: '#059669', attente: '#d97706', prevu: '#6366f1', retard: '#dc2626',
    accent: '#6366f1', contexte: '#6b6590', fond: '#201c36',
    annees: ['#4f46e5', '#6366f1', '#818cf8', '#a5b4fc', '#c7d2fe']
  }
};
let P = PAL.light;

// Encres (textes, grille) : relues depuis le CSS, source de verite du theme.
const COL = { text: '#6c6890', ink: '#1b1733', fort: '#2f2b48', grid: 'rgba(27,23,51,.08)' };

function refreshTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => (cs.getPropertyValue(name) || '').trim() || fallback;
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  P = dark ? PAL.dark : PAL.light;
  COL.text = v('--muted', COL.text);
  COL.ink = v('--ink', COL.ink);
  COL.fort = v('--text', COL.fort);
  COL.grid = dark ? 'rgba(255,255,255,.08)' : 'rgba(27,23,51,.08)';

  Chart.defaults.color = COL.text;
  Chart.defaults.locale = 'fr-FR';   // 14 000 et non 14,000
  Chart.defaults.font.family = 'Manrope, Segoe UI, system-ui, sans-serif';
  Chart.defaults.font.size = 11.5;
  Chart.defaults.animation.duration = 450;

  const tt = Chart.defaults.plugins.tooltip;
  tt.backgroundColor = dark ? 'rgba(12,10,24,.95)' : 'rgba(27,23,51,.95)';
  tt.borderColor = dark ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.18)';
  tt.borderWidth = 1;
  tt.cornerRadius = 10;
  tt.padding = { x: 12, y: 10 };
  tt.titleFont = { family: 'Sora, Segoe UI, system-ui, sans-serif', size: 12, weight: '600' };
  tt.bodyFont = { family: 'Manrope, Segoe UI, system-ui, sans-serif', size: 12 };
  tt.footerFont = { family: 'Manrope, Segoe UI, system-ui, sans-serif', size: 11, weight: '500' };
  tt.footerColor = 'rgba(255,255,255,.72)';
  tt.boxWidth = 8; tt.boxHeight = 8; tt.boxPadding = 5; tt.usePointStyle = true;
  tt.displayColors = false;

  const lg = Chart.defaults.plugins.legend;
  lg.position = 'bottom';
  lg.align = 'start';
  lg.labels.boxWidth = 8; lg.labels.boxHeight = 8;
  lg.labels.usePointStyle = true; lg.labels.pointStyle = 'rectRounded';
  lg.labels.padding = 14;
  lg.labels.color = COL.fort;
  lg.labels.font = { size: 11.5, weight: '500' };
}
refreshTheme();

CC.chartsRefreshTheme = function () {
  refreshTheme();
  try { if (CC.renderDashboard) CC.renderDashboard(); } catch (_) {}
};

function makeChart(id, config) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (CC._charts[id]) CC._charts[id].destroy();
  CC._charts[id] = new Chart(ctx, config);
}

// ---- Axes -----------------------------------------------------------------
// Montants courts sur les axes (« 12 k€ »), en clair dans les infobulles.
function euroCourt(v) {
  if (CC.state && CC.state.privacy) return '•••';
  const a = Math.abs(v);
  if (a >= 1000) return (v / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k€';
  return Math.round(v).toLocaleString('fr-FR') + ' €';
}
// Axe des montants : grille en filet fin et discret, pas de trait d'axe.
function axeMontant(extra) {
  return Object.assign({
    beginAtZero: true,
    grid: { color: COL.grid, lineWidth: 1, drawTicks: false },
    border: { display: false },
    ticks: { color: COL.text, padding: 8, maxTicksLimit: 6, callback: (v) => euroCourt(v) }
  }, extra || {});
}
// Axe des categories : pas de grille, une ligne de base fine.
function axeCategories(extra) {
  return Object.assign({
    grid: { display: false },
    border: { display: true, color: COL.grid },
    ticks: { color: COL.text, padding: 6 }
  }, extra || {});
}

// ---- Barres -----------------------------------------------------------------
// Barres fines (24 px max), bout arrondi a 4 px, base carree.
function barres(label, data, color, extra) {
  return Object.assign({
    label, data, backgroundColor: color, hoverBackgroundColor: color,
    borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24,
    categoryPercentage: 0.72, barPercentage: 0.92
  }, extra || {});
}

// Segment visible le plus en bout d'une pile, pour un index donne.
function boutDePile(chart, i, stack) {
  const ds = chart.data.datasets;
  for (let d = ds.length - 1; d >= 0; d--) {
    if (stack && ds[d].stack !== stack) continue;
    if (chart.isDatasetVisible(d) && +ds[d].data[i] > 0) return d;
  }
  return -1;
}
// Piles : seul le dernier segment a le bout arrondi ; entre deux segments, un
// espace de 2 px couleur de la carte (et non un trait) les separe.
function empiler(datasets, horizontal) {
  datasets.forEach((ds) => {
    ds.borderRadius = (c) => (boutDePile(c.chart, c.dataIndex, ds.stack) === c.datasetIndex ? 4 : 0);
    ds.borderWidth = (c) => (boutDePile(c.chart, c.dataIndex, ds.stack) === c.datasetIndex ? 0
      : (horizontal ? { right: 2 } : { top: 2 }));
    ds.borderColor = P.fond;
    ds.hoverBorderColor = P.fond;
  });
  return datasets;
}

// Etiquettes en bout de barre (ou de pile) : texte en encre, jamais en couleur de
// serie. `texte(i)` renvoie le libelle ou '' pour ne rien ecrire (etiquetage
// selectif). `stack` limite le calcul du bout a une pile.
function etiquettes(texte, horizontal, stack) {
  return {
    id: 'etiquettes',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      ctx.save();
      ctx.font = '600 11px Manrope, Segoe UI, system-ui, sans-serif';
      ctx.fillStyle = COL.fort;
      chart.data.labels.forEach((_, i) => {
        const t = texte(i);
        if (!t) return;
        const d = boutDePile(chart, i, stack);
        if (d < 0) return;
        const el = chart.getDatasetMeta(d).data[i];
        if (!el) return;
        if (horizontal) { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(t, el.x + 7, el.y); }
        else { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(t, el.x, el.y - 6); }
      });
      ctx.restore();
    }
  };
}

const tipEuro = (c) => ` ${c.dataset.label} : ${CC.util.eur0(c.parsed[c.chart.options.indexAxis === 'y' ? 'x' : 'y'])}`;
const legende = (visible) => ({ display: !!visible });

// ---------------------------------------------------------------------------
CC.renderDashboard = function () {
  refreshTheme();
  const S = CC.state, settings = S.settings, year = S.selectedYear, all = S.factures;
  const fy = CC.stats.forYear(all, year);
  const sums = CC.stats.sums(fy, settings);

  // Cotisations (annee ou cumul si "toutes")
  let cot;
  if (year === 'all') {
    let urssaf = 0, encaisse = 0;
    CC.stats.years(all).forEach((y) => { const c = CC.stats.cotisationsYear(CC.stats.forYear(all, y), y, settings); urssaf += c.urssaf; encaisse += c.encaisse; });
    const impot = settings.versementActif ? encaisse * (settings.tauxImpot || 0) / 100 : 0;
    cot = { urssaf, encaisse, impot, net: encaisse - urssaf - impot, trims: null };
  } else {
    cot = CC.stats.cotisationsYear(fy, year, settings);
  }

  // ---------- KPIs ----------
  const recues = fy.filter(CC.stats.isPaid).length;
  const impayes = fy.filter((f) => !CC.stats.isPaid(f) && !CC.stats.isPrevu(f)).length;
  const prevus = fy.filter((f) => CC.stats.isPrevu(f)).length;
  const yoy = (year !== 'all') ? CC.stats.yoyRealtime(all, year) : null;
  const yoyTxt = (!yoy || yoy.pct == null) ? '—' : (yoy.pct >= 0 ? '+' : '') + CC.util.pct(yoy.pct);
  const yoyCls = (!yoy || yoy.pct == null) ? '' : (yoy.pct >= 0 ? 'pos' : 'neg');

  const kpis = [
    { cls: 'green', label: 'CA encaissé', value: CC.util.eur0(cot.encaisse), hint: `${recues} facture(s) reçue(s)` },
    { cls: 'amber', label: 'En attente', value: CC.util.eur0(sums.aVenir), hint: `${impayes} émise(s)${prevus ? ' · ' + prevus + ' prévue(s)' : ''}` },
    { cls: 'red', label: 'URSSAF ' + (year === 'all' ? 'cumul' : year), value: CC.util.eur0(cot.urssaf), hint: 'à régler par trimestre' },
    { cls: '', label: 'Net perçu', value: CC.util.eur0(cot.net), hint: settings.versementActif ? 'après URSSAF + impôt' : 'après URSSAF' },
    { cls: '', label: 'Croissance (temps réel)', value: yoyTxt, valueCls: yoyCls, hint: (year === 'all' ? 'choisir une année' : `vs ${year - 1} à la même date`) }
  ];
  document.getElementById('kpiGrid').innerHTML = kpis.map((k) => `
    <div class="kpi ${k.cls}">
      <div class="label">${k.label}</div>
      <div class="value ${k.valueCls || ''}">${k.value}</div>
      <div class="hint">${k.hint}</div>
    </div>`).join('');

  // ---------- URSSAF par trimestre ----------
  renderUrssafQuarters(year, fy, cot);

  // ---------- CA par trimestre ----------
  renderTrimestres(all, year);

  // ---------- Encaissé par mois (ou par an) ----------
  // Une seule série : pas de légende. On n'étiquette que le meilleur mois.
  if (year !== 'all') {
    const enc = CC.stats.monthlyEncaisse(all, year);
    const max = Math.max(...enc);
    const sub = document.getElementById('monthlySub');
    if (sub) sub.textContent = max > 0 ? `Meilleur mois : ${CC.MOIS[enc.indexOf(max)]} (${CC.util.eur0(max)}).` : 'Aucun encaissement cette année.';
    makeChart('chartMonthly', {
      type: 'bar',
      data: { labels: CC.MOIS, datasets: [barres('Encaissé', enc, P.paye)] },
      plugins: [etiquettes((i) => (enc[i] === max && max > 0 ? euroCourt(max) : ''))],
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } },
        scales: { x: axeCategories(), y: axeMontant() },
        plugins: { legend: legende(false), tooltip: { callbacks: { label: tipEuro } } }
      }
    });
  } else {
    const years = CC.stats.years(all);
    const vals = years.map((y) => CC.stats.encaisseYear(all, y));
    const sub = document.getElementById('monthlySub');
    if (sub) sub.textContent = 'Encaissé de chaque année.';
    makeChart('chartMonthly', {
      type: 'bar',
      data: { labels: years, datasets: [barres('Encaissé', vals, P.paye, { maxBarThickness: 24 })] },
      plugins: [etiquettes((i) => euroCourt(vals[i]))],
      options: {
        responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } },
        scales: { x: axeCategories(), y: axeMontant() },
        plugins: { legend: legende(false), tooltip: { callbacks: { label: tipEuro } } }
      }
    });
  }

  // ---------- Où en est l'argent de la période ----------
  renderEtatArgent(sums, year);

  // ---------- Comparaison annuelle ----------
  // L'année choisie en accent, les autres en gris de contexte.
  const years = CC.stats.years(all);
  const parAn = years.map((y) => CC.stats.encaisseYear(all, y));
  const phare = year === 'all' ? years[years.length - 1] : year;
  makeChart('chartYears', {
    type: 'bar',
    data: { labels: years, datasets: [barres('Encaissé', parAn, years.map((y) => (y === phare ? P.accent : P.contexte)))] },
    plugins: [etiquettes((i) => euroCourt(parAn[i]))],
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } },
      scales: { x: axeCategories(), y: axeMontant() },
      plugins: { legend: legende(false), tooltip: { callbacks: { label: tipEuro } } }
    }
  });

  // ---------- Top clients ----------
  // Chaque barre : payé, en attente (émis, retard compris), prévu. Le % au bout
  // = part du client dans le total de la période.
  const top = CC.stats.topClients(fy, 8);
  const caTotal = fy.reduce((a, f) => a + CC.stats.ht(f), 0);
  const payeTotal = fy.reduce((a, f) => a + (CC.stats.isPaid(f) ? CC.stats.ht(f) : 0), 0);
  top.forEach((c) => {
    c.pct = caTotal ? (c.total / caTotal) * 100 : 0;
    c.pctPaye = payeTotal ? (c.paye / payeTotal) * 100 : 0;
  });
  makeChart('chartClients', {
    type: 'bar',
    data: {
      labels: top.map((c) => c.nom || c.client),
      datasets: empiler([
        barres('Payé', top.map((c) => c.paye), P.paye, { stack: 'ca', maxBarThickness: 18 }),
        barres('En attente', top.map((c) => c.attente), P.attente, { stack: 'ca', maxBarThickness: 18 }),
        barres('Prévu', top.map((c) => c.prevu), P.prevu, { stack: 'ca', maxBarThickness: 18 })
      ], true)
    },
    plugins: [etiquettes((i) => CC.util.pct(top[i].pct, top[i].pct < 10 ? 1 : 0), true, 'ca')],
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 48 } },
      interaction: { mode: 'index', axis: 'y', intersect: false },
      scales: {
        x: axeMontant({ stacked: true }),
        y: axeCategories({ stacked: true, border: { display: false }, ticks: { color: COL.fort, padding: 8 } })
      },
      plugins: {
        legend: legende(true),
        tooltip: {
          displayColors: true,
          filter: (c) => c.parsed.x > 0,
          callbacks: {
            label: tipEuro,
            footer: (items) => {
              const c = top[items[0].dataIndex];
              return [`Total ${CC.util.eur0(c.total)} · ${CC.util.pct(c.pct, 1)} du CA`, `${CC.util.pct(c.pctPaye, 1)} de l'encaissé · ${c.count} facture(s)`];
            }
          }
        }
      }
    }
  });

  // ---------- Saisonnalité ----------
  // Une ligne fine sur un voile léger ; le meilleur mois est signalé.
  const saison = CC.stats.seasonality(all);
  const maxS = Math.max(...saison);
  makeChart('chartSeason', {
    type: 'line',
    data: {
      labels: CC.MOIS,
      datasets: [{
        label: 'Encaissé moyen', data: saison,
        borderColor: P.accent, borderWidth: 2, borderJoinStyle: 'round', borderCapStyle: 'round',
        backgroundColor: P.accent + '1a', fill: 'origin', cubicInterpolationMode: 'monotone',
        pointRadius: saison.map((v) => (v === maxS && maxS > 0 ? 4.5 : 0)),
        pointHoverRadius: 5, pointBackgroundColor: P.accent, pointBorderColor: P.fond, pointBorderWidth: 2, pointHitRadius: 14
      }]
    },
    plugins: [{
      id: 'maxSaison',
      afterDatasetsDraw(chart) {
        if (!(maxS > 0)) return;
        const i = saison.indexOf(maxS);
        const pt = chart.getDatasetMeta(0).data[i];
        if (!pt) return;
        const ctx = chart.ctx;
        ctx.save();
        ctx.font = '600 11px Manrope, Segoe UI, system-ui, sans-serif';
        ctx.fillStyle = COL.fort; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
        ctx.fillText(euroCourt(maxS), pt.x, pt.y - 9);
        ctx.restore();
      }
    }],
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 20 } },
      interaction: { mode: 'index', intersect: false },
      scales: { x: axeCategories(), y: axeMontant() },
      plugins: { legend: legende(false), tooltip: { callbacks: { label: tipEuro } } }
    }
  });

  // ---------- CA par activité ----------
  // Barres horizontales classées, une seule couleur : la longueur dit l'ordre,
  // l'étiquette donne le montant et la part.
  const cats = CC.stats.caByCategory(fy, false).filter((c) => c.total > 0);
  const totCats = cats.reduce((a, c) => a + c.total, 0);
  makeChart('chartCategories', {
    type: 'bar',
    data: { labels: cats.map((c) => c.categorie), datasets: [barres('CA', cats.map((c) => c.total), P.accent, { maxBarThickness: 18 })] },
    plugins: [etiquettes((i) => `${euroCourt(cats[i].total)} · ${CC.util.pct(totCats ? cats[i].total / totCats * 100 : 0, 0)}`, true)],
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      layout: { padding: { right: 96 } },
      scales: {
        x: axeMontant({ ticks: { display: false }, grid: { display: false } }),
        y: axeCategories({ border: { display: false }, ticks: { color: COL.fort, padding: 8 } })
      },
      plugins: { legend: legende(false), tooltip: { callbacks: { label: tipEuro } } }
    }
  });

  CC.renderForecast(year);
  CC.renderBonus(fy, year);
};

// ---------------------------------------------------------------------------
// Où en est l'argent : une barre segmentée (part de chaque état) et, dessous,
// la liste des montants. Le texte porte l'information ; la couleur la repère.
function renderEtatArgent(sums, year) {
  const box = document.getElementById('statusBox');
  if (!box) return;
  const parts = [
    { k: 'paye', lib: 'Encaissé', v: sums.encaisse, c: P.paye, d: 'payé, compte dans le CA' },
    { k: 'attente', lib: 'En attente', v: sums.attente, c: P.attente, d: 'émis, pas encore échu' },
    { k: 'prevu', lib: 'Prévisionnel', v: sums.prevu, c: P.prevu, d: 'pas encore facturé' },
    { k: 'retard', lib: 'En retard', v: sums.retard, c: P.retard, d: 'échéance dépassée, à relancer' }
  ];
  const tot = parts.reduce((a, p) => a + p.v, 0);
  if (!tot) { box.innerHTML = '<p class="muted">Aucune facture sur la période.</p>'; return; }
  const pct = (v) => (v / tot) * 100;
  const segs = parts.filter((p) => p.v > 0).map((p) =>
    `<span class="ea-seg" style="flex-grow:${p.v.toFixed(2)};background:${p.c}" title="${p.lib} : ${CC.util.eur0(p.v)}"></span>`).join('');
  const lignes = parts.map((p) => `
    <li class="ea-ligne${p.v ? '' : ' vide'}${p.k === 'retard' && p.v ? ' alerte' : ''}">
      <span class="ea-puce" style="background:${p.c}"></span>
      <span class="ea-lib"><span class="ea-nom">${p.k === 'retard' && p.v ? '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>' : ''}${p.lib}</span><small>${p.d}</small></span>
      <span class="ea-val">${CC.util.eur0(p.v)}</span>
      <span class="ea-pct">${CC.util.pct(pct(p.v), 0)}</span>
    </li>`).join('');
  box.innerHTML = `
    <div class="ea-tete"><span class="ea-total">${CC.util.eur0(tot)}</span><span class="ea-sous">facturé ou prévu ${year === 'all' ? 'toutes années' : 'en ' + year}</span></div>
    <div class="ea-barre" role="img" aria-label="${parts.map((p) => p.lib + ' ' + CC.util.pct(pct(p.v), 0)).join(', ')}">${segs}</div>
    <ul class="ea-liste">${lignes}</ul>`;
}

// ---------------------------------------------------------------------------
const MOIS_LONG = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

// Chiffre d'affaires par trimestre.
// Année choisie : payé / en attente / prévu empilés sur leur trimestre de
// rattachement (celui de l'encaissement pour ce qui est payé ; une facture
// impayée d'un trimestre passé glisse sur le trimestre en cours, comme dans le
// reste de l'app), et à côté, en gris, l'encaissé du même trimestre l'an passé.
// « Toutes années » : l'encaissé de chaque trimestre, une teinte par année
// (de la plus ancienne, claire, à la plus récente, foncée).
function renderTrimestres(all, year) {
  const labels = ['T1 · jan–mar', 'T2 · avr–juin', 'T3 · juil–sep', 'T4 · oct–déc'];
  const sub = document.getElementById('trimSub');
  const today = new Date();
  const settings = CC.state.settings;
  let datasets, plugins = [];
  if (year === 'all') {
    const years = CC.stats.years(all).slice(-P.annees.length);
    const teintes = P.annees.slice(-years.length);
    datasets = years.map((y, i) => barres(String(y), [1, 2, 3, 4].map((t) => CC.stats.encaisseTrim(all, y, t)), teintes[i], { maxBarThickness: 22 }));
    if (sub) sub.textContent = 'Encaissé de chaque trimestre, année par année.';
  } else {
    const parts = { recue: [0, 0, 0, 0], attente: [0, 0, 0, 0], prevu: [0, 0, 0, 0] };
    CC.stats.forYear(all, year).forEach((f) => {
      const t = CC.stats.trimOf(f);
      if (!(t >= 1 && t <= 4)) return;
      const st = CC.stats.statut(f, settings, today);
      const k = st === 'recue' ? 'recue' : (st === 'prevu' ? 'prevu' : 'attente');
      parts[k][t - 1] += CC.stats.ht(f);
    });
    datasets = empiler([
      barres('Payé', parts.recue, P.paye, { stack: 'annee' }),
      barres('En attente', parts.attente, P.attente, { stack: 'annee' }),
      barres('Prévu', parts.prevu, P.prevu, { stack: 'annee' })
    ], false);
    const prev = [1, 2, 3, 4].map((t) => CC.stats.encaisseTrim(all, year - 1, t));
    const avecPrev = prev.some((v) => v > 0);
    if (avecPrev) datasets.push(barres('Encaissé ' + (year - 1), prev, P.contexte, { stack: 'avant' }));
    const totaux = [0, 1, 2, 3].map((i) => parts.recue[i] + parts.attente[i] + parts.prevu[i]);
    plugins = [etiquettes((i) => (totaux[i] ? euroCourt(totaux[i]) : ''), false, 'annee')];
    if (sub) sub.textContent = `Payé, en attente et prévu, rangés sur leur trimestre${avecPrev ? ` · en gris, l'encaissé du même trimestre en ${year - 1}` : ''}.`;
  }
  makeChart('chartTrimestres', {
    type: 'bar',
    data: { labels, datasets },
    plugins,
    options: {
      responsive: true, maintainAspectRatio: false, layout: { padding: { top: 18 } },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: axeCategories({ stacked: year !== 'all' }),
        y: axeMontant({ stacked: year !== 'all' })
      },
      plugins: {
        legend: legende(true),
        tooltip: {
          displayColors: true,
          filter: (c) => c.parsed.y > 0,
          callbacks: {
            label: tipEuro,
            footer: (items) => {
              if (year === 'all') return '';
              const tot = items.filter((c) => c.dataset.stack === 'annee').reduce((a, c) => a + c.parsed.y, 0);
              return tot ? `Total ${year} : ${CC.util.eur0(tot)}` : '';
            }
          }
        }
      }
    }
  });
}

function renderUrssafQuarters(year, fy, cot) {
  const box = document.getElementById('urssafQuarters');
  const sched = document.getElementById('urssafSchedule');
  if (year === 'all' || !cot.trims) {
    box.innerHTML = `<div class="qcell total" style="grid-column:1/-1"><div class="qt">URSSAF — cumul toutes années</div><div class="qv">${CC.util.eur0(cot.urssaf)}</div><div class="qd">Sélectionnez une année pour le détail par trimestre</div></div>`;
    if (sched) renderUrssafSchedule();
    return;
  }
  const cells = cot.trims.map((t) => {
    const due = CC.stats.urssafDueDate(year, t.trimestre);
    return `
    <div class="qcell">
      <div class="qt">T${t.trimestre} · ${CC.util.pct(t.taux)}</div>
      <div class="qv">${CC.util.eur0(t.urssaf)}</div>
      <div class="qd">sur ${CC.util.eur0(t.encaisse)} encaissé</div>
      <div class="qd">prélevé ~ ${MOIS_LONG[due.mois]} ${due.annee}</div>
    </div>`;
  }).join('');
  box.innerHTML = cells + `
    <div class="qcell total">
      <div class="qt">Total ${year}</div>
      <div class="qv">${CC.util.eur0(cot.urssaf)}</div>
      <div class="qd">net après cotisations : ${CC.util.eur0(cot.net)}</div>
    </div>`;
  if (sched) renderUrssafSchedule();
}

// Echeancier : derniere echeance passee + prochaines a venir
function renderUrssafSchedule() {
  const box = document.getElementById('urssafSchedule');
  if (!box) return;
  const all = CC.stats.urssafSchedule(CC.state.factures, CC.state.settings)
    .filter((e) => e.urssaf > 0 || e.statut === 'a-venir');
  const past = all.filter((e) => e.statut === 'preleve');
  const future = all.filter((e) => e.statut === 'a-venir' && e.urssaf > 0);
  const list = past.slice(-1).concat(future.slice(0, 4));
  if (!list.length) { box.innerHTML = ''; return; }

  const rows = list.map((e) => {
    const tag = e.statut === 'a-venir' ? '<span class="sd-tag">à venir</span>' : '<span class="sd-tag past">prélevé</span>';
    return `<div class="sd-row ${e.statut}">
      <span class="sd-date">${MOIS_LONG[e.due.mois]} ${e.due.annee}</span>
      <span class="sd-src">T${e.trimestre} ${e.annee} · sur ${CC.util.eur0(e.encaisse)}</span>
      <span class="sd-amt">${CC.util.eur0(e.urssaf)}</span>
      ${tag}
    </div>`;
  }).join('');
  box.innerHTML = `<div class="sd-title">Échéancier des prélèvements</div>${rows}`;
}

// ---------------------------------------------------------------------------
CC.renderForecast = function (year) {
  const box = document.getElementById('forecastBox');
  if (year === 'all') { box.innerHTML = '<p class="muted">Sélectionnez une année précise pour voir le prévisionnel.</p>'; return; }
  const fc = CC.stats.forecast(CC.state.factures, year, CC.state.settings);
  const cards = [];
  cards.push({ t: 'Encaissé à ce jour', v: CC.util.eur0(fc.encaisse), d: fc.isCurrent ? `jour ${fc.dayOfYear} / ${fc.totalDays}` : 'année complète' });
  cards.push({ t: 'En attente', v: CC.util.eur0(fc.aVenir), d: 'factures émises, non payées' });
  if (fc.prevu > 0) cards.push({ t: 'Prévisionnel', v: CC.util.eur0(fc.prevu), d: 'ventes prévues, pas encore facturées' });
  if (fc.isCurrent) {
    // La projection est un MAX, pas une somme : le sous-titre dit laquelle des
    // deux lectures est affichee, et rappelle le montant de l'autre.
    const parCarnet = fc.carnet >= fc.rythme;
    cards.push({
      t: "Projection fin d'année", v: CC.util.eur0(fc.projete),
      d: parCarnet
        ? 'encaissé + en attente + prévisionnel'
        : 'au rythme actuel · carnet engagé : ' + CC.util.eur0(fc.carnet)
    });
    cards.push({ t: 'URSSAF projetée', v: CC.util.eur0(fc.urssafProj), d: 'sur la projection' });
    cards.push({ t: 'Net projeté', v: CC.util.eur0(fc.netProj), d: 'après cotisations' });
  }
  if (fc.histAvg != null) {
    const ref = fc.isCurrent ? fc.projete : fc.encaisse;
    const diff = ref - fc.histAvg;
    cards.push({ t: 'vs moyenne passée', v: (diff >= 0 ? '+' : '') + CC.util.eur0(diff), d: `moyenne : ${CC.util.eur0(fc.histAvg)}` });
  }
  box.innerHTML = cards.map((c) => `<div class="fc"><div class="t">${c.t}</div><div class="v">${c.v}</div><div class="d">${c.d}</div></div>`).join('');
};

// ---------------------------------------------------------------------------
CC.renderBonus = function (fy, year) {
  const S = CC.state, settings = S.settings;
  const avgInv = CC.stats.avgInvoice(fy);
  const top = CC.stats.topClients(fy, 1)[0];

  let bestMonth = '—', bestVal = 0;
  if (year !== 'all') {
    const m = CC.stats.monthlyEncaisse(S.factures, year);
    const idx = m.indexOf(Math.max(...m));
    if (m[idx] > 0) { bestMonth = CC.MOIS[idx]; bestVal = m[idx]; }
  }
  let recordVal = 0, recordLib = '';
  fy.forEach((f) => { if ((+f.montant || 0) > recordVal) { recordVal = +f.montant; recordLib = CC.util.clientNom ? CC.util.clientNom(f.libelle) : CC.util.clientKey(f.libelle); } });

  const impayes = fy.filter((f) => !CC.stats.isPaid(f) && !CC.stats.isPrevu(f));
  const totalImp = impayes.reduce((a, f) => a + (+f.montant || 0), 0);
  const prevList = fy.filter((f) => CC.stats.isPrevu(f));
  const totalPrev = prevList.reduce((a, f) => a + (+f.montant || 0), 0);

  const rows = [];
  rows.push(['Nombre de factures', fy.length]);
  rows.push(['Facture moyenne', CC.util.eur0(avgInv)]);
  if (top) rows.push(['Meilleur client', `${top.nom || top.client} (${CC.util.eur0(top.total)})`]);
  if (year !== 'all') rows.push(['Meilleur mois', bestMonth === '—' ? '—' : `${bestMonth} (${CC.util.eur0(bestVal)})`]);
  rows.push(['Plus grosse facture', recordVal ? `${CC.util.eur0(recordVal)} — ${recordLib}` : '—']);
  rows.push(['Impayés en cours', impayes.length ? `${impayes.length} (${CC.util.eur0(totalImp)})` : 'aucun']);
  if (prevList.length) rows.push(['Prévisionnel', `${prevList.length} (${CC.util.eur0(totalPrev)})`]);

  const encaisse = CC.stats.sums(fy, settings).encaisse;
  let gauges = '';
  if (settings.plafond > 0 && year !== 'all') {
    const ratio = Math.min(100, (encaisse / settings.plafond) * 100);
    const cls = ratio > 90 ? 'danger' : ratio > 70 ? 'warn' : '';
    gauges += `<div class="gauge"><div class="lbl"><span>Plafond micro</span><span>${CC.util.pct(ratio, 0)}</span></div><div class="bar"><div class="fill ${cls}" style="width:${ratio}%"></div></div><div class="lbl"><span>${CC.util.eur0(encaisse)}</span><span>${CC.util.eur0(settings.plafond)}</span></div></div>`;
  }
  if (settings.objectif > 0 && year !== 'all') {
    const ratio = Math.min(100, (encaisse / settings.objectif) * 100);
    gauges += `<div class="gauge"><div class="lbl"><span>Objectif annuel</span><span>${CC.util.pct(ratio, 0)}</span></div><div class="bar"><div class="fill" style="width:${ratio}%"></div></div><div class="lbl"><span>${CC.util.eur0(encaisse)}</span><span>${CC.util.eur0(settings.objectif)}</span></div></div>`;
  }

  document.getElementById('bonusBox').innerHTML = rows.map((r) => `<div class="row"><span class="k">${r[0]}</span><span class="v">${r[1]}</span></div>`).join('') + gauges;
};
