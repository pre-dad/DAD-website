/* ==========================================================================
   DAD Impact Map

   Data arrives columnar: every indicator is an array parallel to State.d.fips.
   Scoring therefore works on whole columns, which is what keeps the Need Index
   sliders instant across all 3,144 counties with no server round-trip.

   "Severity" is always 0-100 where 100 is worst-off, regardless of whether the
   underlying measure counts something good or something bad. Direction is
   resolved once, in the pipeline. Nothing downstream has to think about it.
   ========================================================================== */

import { computeIndex as scoreIndex, computeGap as scoreGap } from './scoring.js?v=ae905405';

(() => {
'use strict';

const State = {
  d: null,            // counties.json
  meta: null,         // meta.json
  topo: null,
  idx: new Map(),     // fips -> row position
  indicators: new Map(), // key -> {…registry meta, sourceKey, group, coverage}
  sources: [],

  mode: 'single',
  active: null,       // active indicator key in single-layer mode
  weights: {},        // indicator key -> 0..100
  gapSupply: 'human_services_per_10k',
  gapNeedShare: 60,

  filters: { minPop: 0, state: '', completeOnly: false },
  shortlist: new Set(),
  selected: null,

  scores: null,       // current per-county value being drawn
  scoreLabel: '',
};

const POP_STEPS = [0, 1000, 5000, 10000, 50000, 100000, 500000];

// Brand heat ramp: quiet ink-teal -> gold -> kinetic red -> deep ember.
// Reads on the dark ledger background without washing out.
const RAMP = d3.piecewise(d3.interpolateRgb.gamma(2.2), [
  '#16302E', '#2E5A50', '#7E9A55', '#E3B341', '#FFB800',
  '#FF7A33', '#FF4A22', '#C21F0E', '#7A0B06',
]);

const STATE_NAMES = {
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California',
  CO:'Colorado', CT:'Connecticut', DE:'Delaware', DC:'Washington DC', FL:'Florida',
  GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa',
  KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland',
  MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri',
  MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey',
  NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio',
  OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina',
  SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont',
  VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming',
};

/* ------------------------------------------------------------------ utils */

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmtInt = d3.format(',');

function fmtValue(v, ind) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  switch (ind && ind.unit) {
    case 'percent':       return `${v.toFixed(ind.decimals ?? 1)}%`;
    case 'dollars':       return `$${fmtInt(Math.round(v))}`;
    case 'count':         return fmtInt(Math.round(v));
    case 'rate_per_100k': return `${fmtInt(Math.round(v))} / 100k`;
    case 'rate_per_10k':  return `${v.toFixed(1)} / 10k`;
    default:              return typeof v === 'number' ? v.toFixed(1) : String(v);
  }
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const allFinite = (...nums) => nums.every(Number.isFinite);

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape a value for HTML text or a quoted attribute. */
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESCAPES[c]);

/** Only web links from the data are made clickable. */
const safeUrl = u => (/^https:\/\//i.test(String(u)) ? String(u) : '');

const fetchJson = url => fetch(url).then(r => {
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
});

/** Run fn on the next animation frame, once however many times it is called before then. */
function frameOnce(fn) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(); });
  };
}

/* --------------------------------------------------------- mobile sheets */

const MOBILE_QUERY = '(max-width: 1040px)';
const isMobile = () => window.matchMedia(MOBILE_QUERY).matches;

/** Which bottom sheet is showing: 'layers', 'rank', or null. */
let openSheetName = null;

function openSheet(name) {
  openSheetName = name;
  document.body.classList.toggle('sheet-layers', name === 'layers');
  document.body.classList.toggle('sheet-rank', name === 'rank');
  syncTabBar();
}

function closeSheets() {
  openSheetName = null;
  document.body.classList.remove('sheet-layers', 'sheet-rank');
  syncTabBar();
}

function syncTabBar() {
  $$('#mobile-bar [data-sheet]').forEach(b => {
    const on =
      (b.dataset.sheet === 'layers' && openSheetName === 'layers') ||
      (b.dataset.sheet === 'rank' && openSheetName === 'rank');
    b.classList.toggle('is-active', on);
    if (b.hasAttribute('aria-controls')) b.setAttribute('aria-expanded', String(on));
  });
  const t = $('#sheet-title-right');
  if (t) t.textContent = State.selected ? 'County detail' : 'Ranking';
}

function openSearch() {
  document.body.classList.add('search-open');
  const input = $('#search');
  input.focus();
  input.select();
}

function closeSearch() {
  document.body.classList.remove('search-open');
  $('#search-results').hidden = true;
  $('#search').value = '';
}

/**
 * Apply a zoom transform. Animates normally, but jumps straight there when the
 * tab is hidden (requestAnimationFrame is throttled, so a transition would
 * silently never run) or when the user has asked for reduced motion.
 */
function applyZoom(transform, duration = 700) {
  const instant =
    document.visibilityState === 'hidden' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (instant) svg.call(zoomBehavior.transform, transform);
  else svg.transition().duration(duration).call(zoomBehavior.transform, transform);
}

/**
 * The zoom transform is applied to a <g> inside the SVG, so all zoom maths must
 * be in viewBox units - not CSS pixels. Those differ whenever preserveAspectRatio
 * scales the SVG, and the element rect can read 0 in a hidden or background tab.
 */
function viewBoxDims() {
  const vb = (svg && svg.attr('viewBox') || '').split(/[\s,]+/).map(Number);
  return (vb.length === 4 && vb[2] >= 2 && vb[3] >= 2)
    ? { width: vb[2], height: vb[3] }
    : null;
}

/* ------------------------------------------------------------------- boot */

async function boot() {
  try {
    const [counties, meta, topo] = await Promise.all([
      fetchJson('data/counties.json'),
      fetchJson('data/meta.json'),
      fetchJson('data/us-counties.topo.json'),
    ]);

    State.d = counties;
    State.meta = meta;
    State.topo = topo;
    counties.fips.forEach((f, i) => State.idx.set(f, i));

    State.sources = meta.registry.sources;
    for (const src of State.sources) {
      for (const ind of src.indicators) {
        if (!counties.indicators[ind.key]) continue;
        State.indicators.set(ind.key, {
          ...ind,
          sourceKey: src.key,
          sourceName: src.name,
          group: src.group,
          coverage: counties.indicators[ind.key].coverage,
        });
      }
    }

    buildLayerList();
    buildWeightList();
    buildGapControls();
    buildStateFilter();
    wireEvents();

    // Open on the strongest complete indicator we have.
    State.active = counties.default_scored[0] || [...State.indicators.keys()][0];
    syncLayerList();
    setDefaultWeights('balanced');

    initMap();
    render();

    // Debug handle for the browser console, only with ?debug in the URL.
    if (new URLSearchParams(location.search).has('debug')) {
      window.DADMap = {
        State,
        bounds: fips => {
          const f = countyFeature(fips);
          return f ? pathGen.bounds(f) : null;
        },
        feature: countyFeature,
        path: () => pathGen,
        projection: () => projectionRef,
      };
    }

    $('#boot').classList.add('is-gone');
    setTimeout(() => $('#boot').remove(), 400);
  } catch (err) {
    $('#boot-err').textContent = 'The map data could not be loaded. Please try again later.';
    console.error(err);
  }
}

/* -------------------------------------------------------------- scoring */

const computeIndex = weights => scoreIndex(State.d, weights);
const computeGap = () => scoreGap(State.d, State.weights, State.gapSupply, State.gapNeedShare);

function currentScores() {
  if (State.mode === 'single') {
    const ind = State.indicators.get(State.active);
    const col = State.d.indicators[State.active];
    return {
      values: col.raw.map(v => (v === null ? NaN : v)),
      sev: col.sev,
      label: ind ? ind.label : State.active,
      ind,
      isIndex: false,
    };
  }
  if (State.mode === 'index') {
    const { scores } = computeIndex(State.weights);
    return { values: [...scores], sev: [...scores], label: 'Need Index', ind: null, isIndex: true };
  }
  const { scores, missingSupply } = computeGap();
  return {
    values: [...scores], sev: [...scores],
    label: 'Need vs. Supply', ind: null, isIndex: true, missingSupply,
  };
}

/* -------------------------------------------------------------- filtering */

function passesFilter(i) {
  const f = State.filters;
  const pop = State.d.population[i];
  if (f.minPop && (pop === null || pop < f.minPop)) return false;
  if (f.state && State.d.state_abbr[i] !== f.state) return false;
  if (f.completeOnly) {
    for (const k of State.d.default_scored) {
      if (State.d.indicators[k].sev[i] === null) return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------- map */

let svg, gRoot, gCounties, gStates, pathGen, zoomBehavior, projectionRef;

function initMap() {
  const el = $('#map');
  // Fall back to sane dimensions if the element has no size yet - the page may
  // be loading in a background tab or a collapsed pane. The ResizeObserver
  // below re-fits the moment it gains real dimensions.
  // If either dimension is missing, use a whole fallback pair rather than
  // mixing a real value with a fallback - that yields a wrong aspect ratio.
  const r0 = el.getBoundingClientRect();
  const usable = r0.width >= 2 && r0.height >= 2;
  const width = usable ? r0.width : 960;
  const height = usable ? r0.height : 600;

  svg = d3.select(el).append('svg')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  gRoot = svg.append('g');
  gCounties = gRoot.append('g');
  gStates = gRoot.append('g');

  const counties = topojson.feature(State.topo, State.topo.objects.counties);
  const statesMesh = topojson.mesh(State.topo, State.topo.objects.states, (a, b) => a !== b);

  const projection = d3.geoAlbersUsa().fitSize([width, height], counties);
  projectionRef = projection;
  pathGen = d3.geoPath(projection);

  gCounties.selectAll('path')
    .data(counties.features, d => d.id)
    .join('path')
      .attr('class', 'county')
      .attr('d', pathGen)
      .on('mousemove', onHover)
      .on('mouseleave', onLeave)
      .on('click', (e, d) => {
        const opening = State.selected !== d.id;
        selectCounty(d.id);
        if (opening) zoomToCounty(d.id);   // clicking a county dives into it
        else resetZoom();                   // clicking it again zooms back out
      });

  gStates.append('path')
    .attr('class', 'state-line')
    .attr('d', pathGen(statesMesh));

  zoomBehavior = d3.zoom()
    .scaleExtent([1, 24])
    .on('zoom', e => {
      gRoot.attr('transform', e.transform);
      // stroke widths are handled by vector-effect: non-scaling-stroke
    });
  svg.call(zoomBehavior);

  // Re-fit whenever the map element actually changes size. A plain window
  // resize listener is not enough: fitting to a 0x0 element collapses the
  // projection to scale 0 for good - the already-drawn paths still look
  // correct, but every later bounds() call returns zeros and zooming breaks.
  let lastW = 0, lastH = 0;
  const doRefit = () => {
    const b = el.getBoundingClientRect();
    if (b.width < 2 || b.height < 2) return;
    if (Math.abs(b.width - lastW) < 1 && Math.abs(b.height - lastH) < 1) return;
    lastW = b.width; lastH = b.height;

    svg.attr('viewBox', `0 0 ${b.width} ${b.height}`);
    projection.fitSize([b.width, b.height], counties);
    gCounties.selectAll('path').attr('d', pathGen);
    gStates.select('path').attr('d', pathGen(statesMesh));

    // Re-fitting moved every path coordinate, so an existing zoom transform is
    // now meaningless and would fling the map off-screen. Reset it, then
    // restore whatever the user was actually looking at.
    svg.call(zoomBehavior.transform, d3.zoomIdentity);
    if (State.selected) zoomToCounty(State.selected);
    else if (State.filters.state) zoomToState(State.filters.state);
  };

  const refit = debounce(doRefit, 120);
  new ResizeObserver(refit).observe(el);
  window.addEventListener('resize', refit);

  // Fit as early as possible so the map never flashes at the fallback size,
  // and retry across the frames where layout may not have settled yet. doRefit
  // early-returns when the size is unchanged, so the extra calls are free.
  doRefit();
  requestAnimationFrame(doRefit);
  window.addEventListener('load', doRefit);
  setTimeout(doRefit, 250);
}

function paintMap(score) {
  const vals = score.sev;
  const nodata = getCss('--nodata');
  gCounties.selectAll('path').each(function (d) {
    const i = State.idx.get(d.id);
    const node = d3.select(this);

    if (i === undefined) {
      node.attr('fill', nodata).classed('is-nodata', true);
      return;
    }
    const v = vals[i];
    const missing = v === null || v === undefined || Number.isNaN(v);
    const filtered = !passesFilter(i);

    node
      .attr('fill', missing ? nodata : RAMP(v / 100))
      .classed('is-nodata', missing)
      .classed('is-filtered', filtered)
      .classed('is-selected', State.selected === d.id)
      .classed('is-pinned', State.shortlist.has(d.id));
  });
}

function getCss(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/* ---------------------------------------------------------------- render */

function render() {
  const score = currentScores();
  State.scores = score;
  State.scoreLabel = score.label;

  paintMap(score);
  renderHeader(score);
  renderLegend(score);
  renderCoverageWarning(score);
  renderRanking(score);
  renderDetail();
  for (const el of [$('#shortlist-count'), $('#shortlist-count-m')]) {
    if (el) el.textContent = State.shortlist.size;
  }
  syncTabBar();
}

function renderHeader(score) {
  const title = $('#map-title'), sub = $('#map-sub');

  if (State.mode === 'single') {
    const ind = score.ind;
    title.textContent = ind ? ind.label : score.label;
    const cov = Math.round((ind?.coverage ?? 0) * 100);
    sub.textContent = ind
      ? `${ind.sourceName} · ${ind.description} · ${cov}% of counties have data`
      : '';
  } else if (State.mode === 'index') {
    const active = Object.entries(State.weights).filter(([, w]) => w > 0);
    title.textContent = 'Need Index';
    sub.textContent = active.length
      ? `Weighted composite of ${active.length} measure${active.length > 1 ? 's' : ''}. Darker means worse off.`
      : 'No measures weighted — move a slider to build an index.';
  } else {
    const supply = State.indicators.get(State.gapSupply);
    title.textContent = 'Need vs. Supply';
    sub.textContent = supply
      ? `${State.gapNeedShare}% need / ${100 - State.gapNeedShare}% service scarcity, measured by ${supply.label.toLowerCase()}. Darkest = high need, fewest organisations.`
      : 'Supply data is not available yet.';
  }
}

function renderLegend(score) {
  const el = $('#legend');
  const steps = 7;
  const swatches = d3.range(steps)
    .map(i => `<div class="legend-swatch" style="background:${RAMP(i / (steps - 1))}"></div>`)
    .join('');

  let lo = 'lower', hi = 'higher';
  if (State.mode === 'single' && score.ind) {
    lo = score.ind.direction === 'higher_is_better' ? 'better' : 'lower';
    hi = score.ind.direction === 'higher_is_better' ? 'worse' : 'higher';
  } else {
    lo = 'lower need'; hi = 'higher need';
  }

  el.innerHTML = `
    <div>
      <div class="legend-scale">${swatches}</div>
      <div class="legend-ends"><span>${lo}</span><span>${hi}</span></div>
    </div>
    <div class="legend-nodata"><i></i> no data</div>
    <div class="legend-label">${State.d.count.toLocaleString()} counties · percentile shading</div>`;
}

function renderCoverageWarning(score) {
  const el = $('#coverage-warning');
  const msgs = [];

  if (State.mode === 'single' && score.ind && score.ind.coverage < 0.95) {
    const missing = State.d.count - Math.round(score.ind.coverage * State.d.count);
    const src = State.sources.find(s => s.key === score.ind.sourceKey);
    const critical = (src?.caveats || []).find(c => c.startsWith('CRITICAL'));
    msgs.push(
      `<strong>${missing.toLocaleString()} counties have no data for this measure.</strong> ` +
      `They are shown in grey — that means unknown, never zero.` +
      (critical ? ` ${esc(critical.replace(/^CRITICAL[:\s-]*/i, ''))}` : '')
    );
  }

  if (State.mode !== 'single') {
    const weak = Object.keys(State.weights)
      .filter(k => State.weights[k] > 0)
      .map(k => State.indicators.get(k))
      .filter(i => i && i.coverage < 0.9);
    if (weak.length) {
      msgs.push(
        `<strong>Incomplete measures are carrying weight:</strong> ` +
        weak.map(i => `${esc(i.label)} (${Math.round(i.coverage * 100)}%)`).join(', ') +
        `. Counties missing them are ranked on whatever is left, so treat the ordering as indicative.`
      );
    }
  }

  if (score.missingSupply) {
    msgs.push('<strong>Supply data is not available yet.</strong> This view cannot be drawn without it.');
  }

  el.innerHTML = msgs.join('<br>');
  el.hidden = msgs.length === 0;
}

/* ------------------------------------------------------------ layer list */

function buildLayerList() {
  const byGroup = new Map();
  for (const [key, ind] of State.indicators) {
    if (!byGroup.has(ind.group)) byGroup.set(ind.group, []);
    byGroup.get(ind.group).push({ key, ...ind });
  }

  const order = ['Water', 'Housing', 'Food', 'Health', 'Hardship', 'Economic', 'Safety', 'Supply'];
  const groups = [...byGroup.keys()].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  $('#layer-list').innerHTML = groups.map(g => `
    <div class="layer-group">
      <div class="layer-group-name">${esc(g)}</div>
      ${byGroup.get(g).map(i => layerItemHtml(i)).join('')}
    </div>`).join('');
  syncLayerList();
}

/** Mark the active layer's radio and row, so the opening map has a visible selection. */
function syncLayerList() {
  $$('.layer-item').forEach(el => {
    const on = el.dataset.key === State.active;
    el.classList.toggle('is-active', on);
    el.querySelector('input').checked = on;
  });
}

function layerItemHtml(i) {
  const cov = Math.round(i.coverage * 100);
  const flag = i.coverage < 0.9 ? `<span class="layer-flag">${cov}%</span>` : '';
  return `
    <label class="layer-item" data-key="${esc(i.key)}">
      <input type="radio" name="layer" value="${esc(i.key)}">
      <span class="layer-item-body">
        <span class="layer-item-label">${esc(i.label)}${flag}</span>
        <span class="layer-item-meta">${esc(i.sourceName)}</span>
      </span>
    </label>`;
}

/* ----------------------------------------------------------- weight list */

const PRESETS = {
  balanced: null, // every complete, scored indicator at equal weight
  food:   { food_insecurity_pct: 100, food_stamps_pct: 60, health_diabetes_pct: 40,
            no_transportation_pct: 50, poverty_rate: 60 },
  health: { health_poor_health_pct: 100, uninsured_adults_pct: 80, health_checkup_pct: 60,
            health_diabetes_pct: 60, health_mental_distress_pct: 50, health_disability_pct: 40 },
  water:  { water_pop_health_violation_pct: 100, water_serious_violator_pct: 80,
            utility_shutoff_threat_pct: 70, poverty_rate: 50 },
  clear:  {},
};

function setDefaultWeights(name) {
  const preset = PRESETS[name];
  State.weights = {};
  if (name === 'balanced' || preset === null) {
    for (const k of State.d.default_scored) State.weights[k] = 50;
  } else {
    for (const [k, v] of Object.entries(preset)) {
      if (State.d.indicators[k]) State.weights[k] = v;
    }
  }
  syncWeightInputs();
}

function buildWeightList() {
  const rows = [...State.indicators.entries()]
    .filter(([, i]) => i.scored)
    .sort((a, b) => a[1].group.localeCompare(b[1].group) || a[1].label.localeCompare(b[1].label));

  $('#weight-list').innerHTML = rows.map(([key, i]) => {
    const cov = Math.round(i.coverage * 100);
    const flag = i.coverage < 0.9 ? `<span class="layer-flag">${cov}%</span>` : '';
    return `
      <div class="weight-row" data-key="${esc(key)}">
        <div class="weight-head">
          <span class="weight-name">${esc(i.label)}${flag}</span>
          <span class="weight-val" data-out="${esc(key)}">0</span>
        </div>
        <input type="range" min="0" max="100" step="5" value="0" data-weight="${esc(key)}" aria-label="${esc(i.label)} weight">
      </div>`;
  }).join('');
}

function syncWeightInputs() {
  $$('[data-weight]').forEach(el => {
    const k = el.dataset.weight;
    const v = State.weights[k] || 0;
    el.value = v;
    $(`[data-out="${k}"]`).textContent = v;
    el.closest('.weight-row').classList.toggle('is-zero', v === 0);
  });
}

function buildGapControls() {
  const supply = [...State.indicators.entries()].filter(([, i]) => i.group === 'Supply');
  const opts = supply.length
    ? supply.map(([k, i]) => `<option value="${esc(k)}">${esc(i.label)}</option>`).join('')
    : `<option value="">(supply data not available yet)</option>`;

  $('#gap-controls').innerHTML = `
    <label class="field">
      <span class="field-label">Measure service supply by</span>
      <select id="gap-supply">${opts}</select>
    </label>
    <label class="field">
      <span class="field-label">Need vs. scarcity balance</span>
      <input type="range" id="gap-balance" min="10" max="90" step="10" value="${State.gapNeedShare}">
      <output id="gap-balance-out">${State.gapNeedShare}% need / ${100 - State.gapNeedShare}% scarcity</output>
    </label>
    <p class="block-hint">
      The Need Index weights on the previous tab define "need" here.
    </p>`;
}

function buildStateFilter() {
  const states = [...new Set(State.d.state_abbr)].filter(Boolean).sort();
  $('#state-select').innerHTML =
    `<option value="">All states</option>` +
    states.map(s => `<option value="${esc(s)}">${esc(STATE_NAMES[s] || s)}</option>`).join('');
}

function zoomToState(abbr) {
  if (!abbr) { resetZoom(); return; }
  // Collect every county polygon belonging to the state and fit to their bounds.
  const feats = topojson.feature(State.topo, State.topo.objects.counties).features
    .filter(f => {
      const i = State.idx.get(f.id);
      return i !== undefined && State.d.state_abbr[i] === abbr;
    });
  if (!feats.length) return;

  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const f of feats) {
    const [[a, b], [c, d]] = pathGen.bounds(f);
    if (!allFinite(a, b, c, d)) continue;
    if (a < x0) x0 = a; if (b < y0) y0 = b;
    if (c > x1) x1 = c; if (d > y1) y1 = d;
  }
  const vb = viewBoxDims();
  if (!vb || !allFinite(x0, y0, x1, y1)) return;

  const spanX = Math.max(x1 - x0, 1), spanY = Math.max(y1 - y0, 1);
  const k = Math.min(9, 0.86 / Math.max(spanX / vb.width, spanY / vb.height));
  if (!Number.isFinite(k) || k <= 0) return;

  applyZoom(
    d3.zoomIdentity
      .translate(vb.width / 2, vb.height / 2)
      .scale(k)
      .translate(-(x0 + x1) / 2, -(y0 + y1) / 2),
    750
  );
}

/* ---------------------------------------------------------------- ranking */

function rankedRows(score, limit = 25) {
  const rows = [];
  for (let i = 0; i < State.d.count; i++) {
    const v = score.sev[i];
    if (v === null || v === undefined || Number.isNaN(v)) continue;
    if (!passesFilter(i)) continue;
    rows.push({ i, fips: State.d.fips[i], v, raw: score.values[i] });
  }
  rows.sort((a, b) => b.v - a.v);
  return limit ? rows.slice(0, limit) : rows;
}

function renderRanking(score) {
  const rows = rankedRows(score, 25);
  $('#rank-title').textContent = `Top 25 · ${score.label}`;

  if (!rows.length) {
    $('#ranking').innerHTML = `<p class="empty">No counties match the current filters.</p>`;
    return;
  }

  $('#ranking').innerHTML = rows.map((r, n) => {
    const val = score.isIndex
      ? r.v.toFixed(1)
      : fmtValue(r.raw, score.ind);
    const pinned = State.shortlist.has(r.fips);
    return `
      <div class="rank-row ${State.selected === r.fips ? 'is-selected' : ''}" data-fips="${esc(r.fips)}">
        <span class="rank-n">${n + 1}</span>
        <button type="button" class="rank-name" title="${esc(State.d.name[r.i])}">${esc(State.d.name[r.i])}</button>
        <span class="rank-val">${esc(val)}</span>
        <button class="rank-pin ${pinned ? 'is-on' : ''}" data-pin="${esc(r.fips)}" aria-pressed="${pinned}"
                aria-label="Pin ${esc(State.d.name[r.i])} to shortlist" title="${pinned ? 'Remove from shortlist' : 'Add to shortlist'}">●</button>
      </div>`;
  }).join('');
}

/* ----------------------------------------------------------------- detail */

function selectCounty(fips) {
  State.selected = State.selected === fips ? null : fips;
  showRightView(State.selected ? 'county' : 'rank');
  // On a phone the detail lives in a bottom sheet, so surface it on tap.
  if (isMobile() && State.selected) openSheet('rank');
  render();
}

/** The right panel swaps between the ranking and one county's detail. */
function showRightView(which, { resetScroll = true } = {}) {
  $('#rank-view').hidden = which === 'county';
  $('#county-view').hidden = which !== 'county';
  const scroll = $('#panel-right .panel-scroll');
  if (scroll && resetScroll) scroll.scrollTop = 0;
  if (which === 'county') $('#btn-back').focus({ preventScroll: true });
}

function clearSelection() {
  State.selected = null;
  showRightView('rank');
  resetZoom();
  render();
}

function renderDetail() {
  const el = $('#detail');
  if (!State.selected || !State.idx.has(State.selected)) {
    el.innerHTML = '';
    showRightView('rank', { resetScroll: false });
    return;
  }

  const i = State.idx.get(State.selected);
  const pinned = State.shortlist.has(State.selected);
  const score = State.scores;
  const rank = score ? rankOf(i, score) : null;

  const groups = new Map();
  for (const [key, ind] of State.indicators) {
    if (!groups.has(ind.group)) groups.set(ind.group, []);
    groups.get(ind.group).push({ key, ind });
  }

  const body = [...groups.entries()].map(([g, items]) => `
    <div class="layer-group">
      <div class="layer-group-name">${esc(g)}</div>
      ${items.map(({ key, ind }) => statRowHtml(key, ind, i)).join('')}
    </div>`).join('');

  el.innerHTML = `
    <div class="detail-head">
      <div>
        <h2 class="detail-name">${esc(State.d.county[i])}</h2>
        <div class="detail-state">${esc(State.d.state[i])} · FIPS ${esc(State.d.fips[i])}</div>
        <div class="detail-pop">${fmtInt(State.d.population[i] ?? 0)} residents</div>
      </div>
    </div>
    ${rank ? `<div class="detail-pop">${esc(score.label)}: ${ordinal(rank.pos)} of ${fmtInt(rank.total)}</div>` : ''}
    <div class="detail-actions">
      <button class="btn btn-sm" id="btn-pin">${pinned ? 'Unpin' : 'Add to shortlist'}</button>
      <button class="btn btn-sm" id="btn-brief">County brief</button>
      <button class="btn btn-sm" id="btn-zoom">Zoom to</button>
    </div>
    ${body}`;

  $('#btn-pin').onclick = () => { togglePin(State.selected); };
  $('#btn-brief').onclick = () => showBrief(State.selected);
  $('#btn-zoom').onclick = () => zoomToCounty(State.selected);
}

function statRowHtml(key, ind, i) {
  const col = State.d.indicators[key];
  const raw = col.raw[i], sev = col.sev[i];
  if (raw === null || sev === null) {
    return `<div class="stat-row"><span class="stat-name">${esc(ind.label)}</span>
            <span class="stat-na">no data</span></div>`;
  }
  return `
    <div class="stat-row" title="${esc(ind.description)}">
      <span class="stat-name">${esc(ind.label)}</span>
      <span class="stat-bar"><i style="width:${sev}%;background:${RAMP(sev / 100)}"></i></span>
      <span class="stat-val">${fmtValue(raw, ind)}</span>
      <span class="stat-rank">${ordinal(Math.round(sev))} pct</span>
    </div>`;
}

function rankOf(i, score) {
  const v = score.sev[i];
  if (v === null || Number.isNaN(v)) return null;
  let pos = 1, total = 0;
  for (let j = 0; j < State.d.count; j++) {
    const w = score.sev[j];
    if (w === null || w === undefined || Number.isNaN(w)) continue;
    total++;
    if (w > v) pos++;
  }
  return { pos, total };
}

/* -------------------------------------------------------------- shortlist */

function togglePin(fips) {
  State.shortlist.has(fips) ? State.shortlist.delete(fips) : State.shortlist.add(fips);
  saveShortlist();
  render();
}

function saveShortlist() {
  try { localStorage.setItem('dad.shortlist', JSON.stringify([...State.shortlist])); } catch {}
}

function loadShortlist() {
  try {
    const raw = localStorage.getItem('dad.shortlist');
    const saved = raw ? JSON.parse(raw) : null;
    if (Array.isArray(saved)) State.shortlist = new Set(saved.filter(f => State.idx.has(f)));
  } catch {}
}

function showShortlist() {
  if (!State.shortlist.size) {
    openModal(`<h2>Shortlist</h2><p class="empty">
      Nothing pinned yet. Click a county, then "Add to shortlist" — or use the dot
      beside any row in the ranking.</p>`);
    return;
  }

  const keys = State.d.default_scored.slice(0, 8);
  const head = keys.map(k => `<th>${esc(State.indicators.get(k)?.label ?? k)}</th>`).join('');
  const rows = [...State.shortlist].map(f => {
    const i = State.idx.get(f);
    if (i === undefined) return '';
    const cells = keys.map(k => {
      const ind = State.indicators.get(k);
      return `<td class="num">${fmtValue(State.d.indicators[k].raw[i], ind)}</td>`;
    }).join('');
    return `<tr><td>${esc(State.d.name[i])}</td><td class="num">${fmtInt(State.d.population[i] ?? 0)}</td>${cells}</tr>`;
  }).join('');

  openModal(`
    <h2>Shortlist</h2>
    <p class="block-hint">${State.shortlist.size} counties pinned for comparison.</p>
    <div style="overflow-x:auto">
      <table class="brief">
        <thead><tr><th>County</th><th>Population</th>${head}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="detail-actions">
      <button class="btn btn-sm" id="btn-export-short">Export CSV</button>
      <button class="btn btn-sm" id="btn-clear-short">Clear shortlist</button>
    </div>`);

  $('#btn-export-short').onclick = () => exportCsv([...State.shortlist], 'dad-shortlist');
  $('#btn-clear-short').onclick = () => { State.shortlist.clear(); saveShortlist(); closeModal(); render(); };
}

/* ----------------------------------------------------------------- brief */

function showBrief(fips) {
  const i = State.idx.get(fips);
  const score = State.scores;
  const rank = rankOf(i, score);

  const groups = new Map();
  for (const [key, ind] of State.indicators) {
    if (!groups.has(ind.group)) groups.set(ind.group, []);
    groups.get(ind.group).push({ key, ind });
  }

  const sections = [...groups.entries()].map(([g, items]) => `
    <h3>${esc(g)}</h3>
    <table class="brief">
      <thead><tr><th>Measure</th><th>Value</th><th>National percentile</th><th>Source</th></tr></thead>
      <tbody>${items.map(({ key, ind }) => {
        const raw = State.d.indicators[key].raw[i];
        const sev = State.d.indicators[key].sev[i];
        return `<tr>
          <td>${esc(ind.label)}</td>
          <td class="num">${esc(fmtValue(raw, ind))}</td>
          <td class="num">${sev === null ? '—' : ordinal(Math.round(sev))}</td>
          <td><small>${esc(ind.sourceName)}</small></td>
        </tr>`;
      }).join('')}</tbody>
    </table>`).join('');

  const usedSources = [...new Set([...State.indicators.values()].map(v => v.sourceKey))]
    .map(k => State.sources.find(s => s.key === k))
    .filter(Boolean);

  openModal(`
    <h2>${esc(State.d.county[i])}, ${esc(State.d.state[i])}</h2>
    <p class="block-hint">
      FIPS ${esc(fips)} · ${fmtInt(State.d.population[i] ?? 0)} residents
      ${rank ? ` · ${ordinal(rank.pos)} of ${fmtInt(rank.total)} on ${esc(score.label)}` : ''}
      · data built ${new Date(State.meta.generated).toLocaleDateString()}
    </p>
    ${sections}
    <h3>Sources &amp; vintages</h3>
    <ul class="caveats">
      ${usedSources.map(s => `<li><b>${esc(s.name)}</b> — ${esc(s.publisher)}. ${esc(s.release_pattern)}</li>`).join('')}
    </ul>
    <p class="block-hint" style="margin-top:14px">
      Percentiles rank this county against all ${fmtInt(State.d.count)} U.S. counties.
      Every measure carries caveats — open <b>Sources</b> before quoting any figure externally.
    </p>
    <div class="detail-actions">
      <button class="btn btn-sm" onclick="window.print()">Print / Save PDF</button>
    </div>`);
}

/* ---------------------------------------------------------------- sources */

function showSources() {
  const manifest = State.meta.manifest.sources || {};
  const cards = State.sources.map(s => {
    const m = manifest[s.key] || {};
    const built = s.indicators.filter(i => State.indicators.has(i.key)).length;
    const status = built
      ? `<b>${built}</b> of ${s.indicators.length} indicators loaded`
      : `<b style="color:var(--warn)">not ingested yet</b>`;
    return `
      <div class="source-card">
        <h3>${esc(s.name)}</h3>
        <div class="source-meta">
          <span><b>Publisher:</b> ${esc(s.publisher)}</span>
          <span><b>Updates:</b> ${esc(s.cadence)}</span>
          <span><b>Reported at:</b> ${esc(s.native_geography)}</span>
          ${m.vintage ? `<span><b>Vintage:</b> ${esc(m.vintage)}</span>` : ''}
          ${m.last_fetched ? `<span><b>Pulled:</b> ${new Date(m.last_fetched).toLocaleDateString()}</span>` : ''}
          <span>${status}</span>
        </div>
        <p class="block-hint" style="margin-bottom:6px">
          <b>Release pattern:</b> ${esc(s.release_pattern)}<br>
          <b>How we get it to county level:</b> ${esc(s.county_method)}
        </p>
        <ul class="caveats">
          ${s.caveats.map(c => `<li class="${c.startsWith('CRITICAL') ? 'is-critical' : ''}">${esc(c)}</li>`).join('')}
        </ul>
        ${safeUrl(s.landing_url) ? `<p class="block-hint"><a href="${esc(safeUrl(s.landing_url))}" target="_blank" rel="noopener">${esc(s.landing_url)}</a></p>` : ''}
      </div>`;
  }).join('');

  openModal(`
    <h2>Where every number comes from</h2>
    <p class="block-hint">
      Built ${new Date(State.meta.generated).toLocaleString()}. None of these sources
      update live — each has its own release cycle, shown below. Read the caveats
      before any figure leaves this screen.
    </p>
    ${cards}`);
}

/* ----------------------------------------------------------------- export */

function exportCsv(fipsList, filename) {
  const keys = [...State.indicators.keys()];
  const header = ['fips', 'county', 'state', 'population', ...keys];
  if (State.scores?.isIndex) header.push('score');

  const lines = [header.join(',')];
  for (const f of fipsList) {
    const i = State.idx.get(f);
    if (i === undefined) continue;
    const row = [
      f,
      `"${String(State.d.county[i]).replaceAll('"', '""')}"`,
      State.d.state_abbr[i],
      State.d.population[i] ?? '',
      ...keys.map(k => State.d.indicators[k].raw[i] ?? ''),
    ];
    if (State.scores?.isIndex) {
      const v = State.scores.sev[i];
      row.push(Number.isNaN(v) ? '' : v.toFixed(2));
    }
    lines.push(row.join(','));
  }

  download(new Blob([lines.join('\n')], { type: 'text/csv' }), `${filename}.csv`);
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportPng() {
  const node = svg.node();
  const { width, height } = node.getBoundingClientRect();
  const scale = 2;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const clone = node.cloneNode(true);
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);

  // The SVG is serialised out of the document, so the page stylesheet and its
  // custom properties are gone: carry the rules the map relies on, with values resolved.
  const style = document.createElementNS(SVG_NS, 'style');
  style.textContent =
    `.county{stroke:${getCss('--ink')};stroke-width:.4px;vector-effect:non-scaling-stroke}` +
    `.county.is-nodata{fill:${getCss('--nodata')}}` +
    '.county.is-filtered{opacity:.1}' +
    `.county.is-selected{stroke:${getCss('--cyan')};stroke-width:1.6px}` +
    `.county.is-pinned{stroke:${getCss('--gold')};stroke-width:1.3px}` +
    '.state-line{fill:none;stroke:rgba(248,249,250,.34);stroke-width:.7px;vector-effect:non-scaling-stroke}';
  clone.insertBefore(style, clone.firstChild);

  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', '100%');
  bg.setAttribute('height', '100%');
  bg.setAttribute('fill', getCss('--ink'));
  clone.insertBefore(bg, clone.firstChild);

  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    const canvas = Object.assign(document.createElement('canvas'), {
      width: width * scale, height: height * scale,
    });
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob(b => { if (b) download(b, `dad-impact-map-${Date.now()}.png`); });
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    console.error('Could not render the map image');
  };
  img.src = url;
}

/* ------------------------------------------------------------------ modal */

let modalOpener = null;
function openModal(html) {
  modalOpener = document.activeElement;
  $('#modal-body').innerHTML = html;
  $('#modal').hidden = false;
  document.body.classList.add('modal-open');
  $('#modal .modal-box').focus();
}
function closeModal() {
  $('#modal').hidden = true;
  document.body.classList.remove('modal-open');
  if (modalOpener && document.contains(modalOpener)) modalOpener.focus();
  modalOpener = null;
}

/* ---------------------------------------------------------------- tooltip */

function onHover(event, d) {
  const i = State.idx.get(d.id);
  const tip = $('#tooltip');
  if (i === undefined) { tip.hidden = true; return; }

  d3.select(event.currentTarget).classed('is-hover', true);

  const score = State.scores;
  const v = score.isIndex ? score.sev[i] : score.values[i];
  const shown = Number.isNaN(v) || v === null
    ? 'no data'
    : (score.isIndex ? v.toFixed(1) : fmtValue(v, score.ind));

  tip.innerHTML = `
    <div class="tooltip-name">${esc(State.d.name[i])}</div>
    <div class="tooltip-val">${esc(shown)}</div>
    <div class="tooltip-sub">${esc(score.label)} · ${fmtInt(State.d.population[i] ?? 0)} residents</div>`;
  tip.hidden = false;

  const pad = 14;
  const r = tip.getBoundingClientRect();
  let x = event.clientX + pad, y = event.clientY + pad;
  if (x + r.width > innerWidth) x = event.clientX - r.width - pad;
  if (y + r.height > innerHeight) y = event.clientY - r.height - pad;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}

function onLeave(event) {
  d3.select(event.currentTarget).classed('is-hover', false);
  $('#tooltip').hidden = true;
}

/* ------------------------------------------------------------------ zoom */

/** Cached lookup - rebuilding the whole FeatureCollection per call is wasteful. */
let _countyFeatures = null;
function countyFeature(fips) {
  if (!_countyFeatures) {
    _countyFeatures = new Map(
      topojson.feature(State.topo, State.topo.objects.counties)
        .features.map(f => [f.id, f])
    );
  }
  return _countyFeatures.get(fips) || null;
}

function zoomToCounty(fips) {
  const feature = countyFeature(fips);
  if (!feature) return;

  const [[x0, y0], [x1, y1]] = pathGen.bounds(feature);
  const vb = viewBoxDims();
  if (!vb || !allFinite(x0, y0, x1, y1)) return;

  // Fill roughly two-thirds of the viewport with the county - a real dive-in.
  const spanX = Math.max(x1 - x0, 1), spanY = Math.max(y1 - y0, 1);
  const k = Math.min(22, 0.65 / Math.max(spanX / vb.width, spanY / vb.height));
  if (!Number.isFinite(k) || k <= 0) return;

  applyZoom(
    d3.zoomIdentity
      .translate(vb.width / 2, vb.height / 2)
      .scale(k)
      .translate(-(x0 + x1) / 2, -(y0 + y1) / 2),
    700
  );
}

function resetZoom() {
  applyZoom(d3.zoomIdentity, 500);
}

/* ---------------------------------------------------------------- search */

function runSearch(q) {
  const box = $('#search-results');
  const term = q.trim().toLowerCase();
  if (term.length < 2) { box.hidden = true; return; }

  const hits = [];
  for (let i = 0; i < State.d.count && hits.length < 40; i++) {
    if (State.d.name[i].toLowerCase().includes(term)) hits.push(i);
  }

  box.innerHTML = hits.length
    ? hits.map(i => `
        <button type="button" class="search-item" data-fips="${esc(State.d.fips[i])}">
          ${esc(State.d.county[i])} <small>${esc(State.d.state[i])}</small>
        </button>`).join('')
    : `<div class="search-item">No match</div>`;
  box.hidden = false;
}

/* /* ---------------------------------------------------------------- events */

function wireEvents() {
  loadShortlist();
  const renderSoon = frameOnce(render);

  $$('.mode-btn').forEach(btn => btn.onclick = () => {
    State.mode = btn.dataset.mode;
    $$('.mode-btn').forEach(b => { b.classList.toggle('is-active', b === btn); b.setAttribute('aria-pressed', String(b === btn)); });
    $('#block-single').hidden = State.mode !== 'single';
    $('#block-index').hidden  = State.mode !== 'index';
    $('#block-gap').hidden    = State.mode !== 'gap';
    render();
  });

  $('#layer-list').addEventListener('change', e => {
    if (e.target.name !== 'layer') return;
    State.active = e.target.value;
    syncLayerList();
    render();
  });

  $('#weight-list').addEventListener('input', e => {
    const key = e.target.dataset.weight;
    if (!key) return;
    State.weights[key] = +e.target.value;
    $(`[data-out="${key}"]`).textContent = e.target.value;
    e.target.closest('.weight-row').classList.toggle('is-zero', +e.target.value === 0);
    renderSoon();
  });

  $$('[data-preset]').forEach(b => b.onclick = () => { setDefaultWeights(b.dataset.preset); render(); });

  $('#panel-left').addEventListener('input', e => {
    if (e.target.id === 'gap-supply') { State.gapSupply = e.target.value; renderSoon(); }
    if (e.target.id === 'gap-balance') {
      State.gapNeedShare = +e.target.value;
      $('#gap-balance-out').textContent =
        `${State.gapNeedShare}% need / ${100 - State.gapNeedShare}% scarcity`;
      renderSoon();
    }
  });

  $('#filter-pop').oninput = e => {
    State.filters.minPop = POP_STEPS[+e.target.value];
    $('#filter-pop-out').textContent =
      State.filters.minPop ? `${fmtInt(State.filters.minPop)}+ residents` : 'Any size';
    renderSoon();
  };
  $('#state-select').onchange = e => {
    State.filters.state = e.target.value;
    render();
    zoomToState(e.target.value);
  };
  $('#filter-complete').onchange = e => { State.filters.completeOnly = e.target.checked; render(); };

  $('#ranking').addEventListener('click', e => {
    const pin = e.target.closest('[data-pin]');
    if (pin) { e.stopPropagation(); togglePin(pin.dataset.pin); return; }
    const row = e.target.closest('[data-fips]');
    if (!row) return;
    // Selecting from the ranking dives into the county too, so the map and the
    // list behave the same way.
    const opening = State.selected !== row.dataset.fips;
    selectCounty(row.dataset.fips);
    if (opening) zoomToCounty(row.dataset.fips);
  });

  $('#search').addEventListener('input', debounce(e => runSearch(e.target.value), 140));
  $('#search-results').addEventListener('click', e => {
    const item = e.target.closest('[data-fips]');
    if (!item) return;
    const fips = item.dataset.fips;
    $('#search-results').hidden = true;
    $('#search').value = '';
    if (isMobile()) closeSearch();
    State.selected = fips;
    showRightView('county');
    if (isMobile()) openSheet('rank');
    render();
    zoomToCounty(fips);
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap') && !e.target.closest('[data-sheet="search"]')) {
      $('#search-results').hidden = true;
    }
  });

  $('#btn-back').onclick = clearSelection;
  $('#btn-shortlist').onclick = showShortlist;
  $('#btn-sources').onclick = showSources;
  $('#btn-cancel-search').onclick = closeSearch;

  // ---- mobile tab bar ----
  $$('#mobile-bar [data-sheet]').forEach(btn => {
    btn.onclick = () => {
      const which = btn.dataset.sheet;
      if (which === 'search')    { openSearch(); return; }
      if (which === 'sources')   { closeSheets(); showSources(); return; }
      if (which === 'shortlist') { closeSheets(); showShortlist(); return; }
      openSheetName === which ? closeSheets() : openSheet(which);
    };
  });

  $$('[data-close-sheet]').forEach(el => el.addEventListener('click', closeSheets));

  // Dropping below the mobile breakpoint must not leave a sheet stuck open.
  window.matchMedia(MOBILE_QUERY).addEventListener('change', e => {
    if (!e.matches) { closeSheets(); closeSearch(); }
  });
  $('#btn-reset-zoom').onclick = resetZoom;
  $('#btn-png').onclick = exportPng;
  $('#btn-export').onclick = () => exportCsv(rankedRows(State.scores, 0).map(r => r.fips), 'dad-ranking');

  $('#modal-close').onclick = closeModal;
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !$('#modal').hidden) {
      const f = [...$('#modal').querySelectorAll('a[href],button:not([disabled]),input,select,textarea,[tabindex="-1"]')].filter(el => el.offsetParent);
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    if (e.key !== 'Escape') return;
    // Escape backs out one level at a time.
    if (!$('#modal').hidden) closeModal();
    else if (document.body.classList.contains('search-open')) closeSearch();
    else if (openSheetName) closeSheets();
    else if (State.selected) clearSelection();
  });
}

boot();
})();
