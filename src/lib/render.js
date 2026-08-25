// Shared row rendering — used both at build time (SSR in index.astro) and on the
// client (filter/sort/paginate). Keeping it in one place means the server-rendered
// HTML and the client-rendered HTML are always identical.
import { formatMcap, quarterKey, prevQuarterLabel, yoyQuarterLabel } from './format.js';

export const VIEW_ORDER = ['Positive', 'Watch', 'Concern', 'Negative'];
export const VIEW_GLYPH = { Positive: '▲', Watch: '●', Concern: '◆', Negative: '▼' };

// Sort rank for a view; unknown/unrated ranks LAST (a raw indexOf -1 would sort
// it first). Shared by server + client sorts.
export const viewRank = (v) => { const i = VIEW_ORDER.indexOf(v); return i < 0 ? VIEW_ORDER.length : i; };

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// esc() stops attribute breakout but not the scheme — gate hrefs to http(s) so a
// `javascript:` reportUrl can't execute.
const safeHttpUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);
const vslug = (v) => (v ? String(v).toLowerCase() : 'unrated');

export const latestEntry = (c) => {
  const qs = c.quarters || [];
  return qs.length ? qs.reduce((a, b) => (quarterKey(b.quarter) >= quarterKey(a.quarter) ? b : a)) : null;
};

// The most recent quarter anywhere in the dataset. Cards from this quarter get
// the "fresh" treatment on their quarter label, and it's the quarter the
// "what changed" panel reports on.
export const newestQuarter = (companies) => {
  let best = null;
  for (const c of companies) {
    const e = latestEntry(c);
    if (e && (!best || quarterKey(e.quarter) > quarterKey(best))) best = e.quarter;
  }
  return best;
};

// Companies bucketed by the quarter their CURRENT view comes from. A company
// revisited in a newer quarter belongs to that newer one only, so the buckets
// partition the book — they sum to the company count with nothing counted twice.
export function quarterBuckets(companies) {
  const counts = {};
  for (const c of companies) {
    const e = latestEntry(c);
    if (e) counts[e.quarter] = (counts[e.quarter] || 0) + 1;
  }
  return Object.keys(counts)
    .sort((a, b) => quarterKey(b) - quarterKey(a))
    .map((quarter) => ({ quarter, count: counts[quarter] }));
}

const fmtINR = (n) =>
  (n == null || isNaN(n)) ? '—'
    : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${+m[3]} ${MON[+m[2] - 1]} '${m[1].slice(2)}` : (iso || '');
};

// Weekly-EMA trend panel. Renders only when EMA data (c.ema) is present, so
// companies without price data (or the first paint before data exists) are
// unaffected. Tiles are green when price is above the EMA, red when below.
// Compact variant for the list card: the EMA's rupee value is reference, not
// signal — it lives on the company page. The pill carries the distance and its
// sign, which is what the screening chips key off and what you scan for.
function emaPillsHTML(c) {
  const r = c.ema;
  if (!r || !r.dist) return '';
  const pills = ['10W', '20W', '40W'].map((w) => {
    const d = r.dist[w];
    if (d == null) return '';
    const above = d >= 0;
    return `<span class="ema-pill ${above ? 'above' : 'below'}">${w} <b>${above ? '▲' : '▼'}${Math.abs(d).toFixed(1)}%</b></span>`;
  }).join('');
  if (!pills) return '';
  const chg = (r.dayChangePct == null) ? '' : (() => {
    const up = r.dayChangePct >= 0;
    return `<span class="ema-chg ${up ? 'up' : 'down'}"><span class="arw">${up ? '▲' : '▼'}</span>${Math.abs(r.dayChangePct).toFixed(2)}%</span>`;
  })();
  return `<div class="ema compact">
        <div class="ema-head"><span class="ema-k">Price</span><span class="ema-price">${fmtINR(r.price)}</span>${chg}${r.asOf ? `<span class="ema-tag">${fmtDate(r.asOf)}</span>` : ''}</div>
        <div class="ema-pills">${pills}</div>
      </div>`;
}

export function emaPanelHTML(c) {
  const r = c.ema;
  if (!r || !r.ema) return '';
  const tiles = ['10W', '20W', '40W'].map((w) => {
    const val = r.ema[w], d = r.dist ? r.dist[w] : null;
    if (val == null || d == null) return '';
    const above = d >= 0;
    return `<div class="ema-tile ${above ? 'above' : 'below'}">
        <div class="tl">${w} EMA</div>
        <div class="tv">${fmtINR(val)}</div>
        <div class="td"><span class="arw">${above ? '▲' : '▼'}</span>${above ? '+' : ''}${d.toFixed(1)}%</div>
      </div>`;
  }).join('');
  if (!tiles) return '';
  // 1-day change vs the previous trading day's close (Screener-style). Direction
  // is carried by the arrow + colour; shown only when the pipeline emitted it.
  const chg = (r.dayChangePct == null) ? '' : (() => {
    const up = r.dayChangePct >= 0;
    return `<span class="ema-chg ${up ? 'up' : 'down'}"><span class="arw">${up ? '▲' : '▼'}</span>${Math.abs(r.dayChangePct).toFixed(2)}%</span>`;
  })();
  return `<div class="ema">
        <div class="ema-head"><span class="ema-k">Price</span><span class="ema-price">${fmtINR(r.price)}</span>${chg}${r.asOf ? `<span class="ema-tag">as of ${fmtDate(r.asOf)}</span>` : ''}</div>
        <div class="ema-grid">${tiles}</div>
      </div>`;
}

export function rowHTML(c, e, newestQ) {
  const vs = vslug(e.view);
  const symbol = c.tvCode ? `NSE:${c.tvCode}` : null;
  const report = safeHttpUrl(e.reportUrl);
  const chrono = [...(c.quarters || [])].sort((a, b) => quarterKey(a.quarter) - quarterKey(b.quarter));
  const ci = chrono.findIndex((x) => x.quarter === e.quarter);
  const prev = ci > 0 ? chrono[ci - 1] : null;
  const flip = prev && prev.view && e.view && prev.view !== e.view ? prev.view : null;
  const fresh = newestQ && e.quarter === newestQ ? ' fresh' : '';
  return `<div class="row view-${vs}" id="c-${esc(c.slug)}" data-slug="${esc(c.slug)}">
      <div class="row-head">
        <div class="row-view">
          <span class="badge view-${vs}"><span class="gly">${VIEW_GLYPH[e.view] || ''}</span>${esc(e.view || 'Unrated')}</span>
          ${e.tier ? `<span class="badge tier">${esc(e.tier)}</span>` : ''}
          <span class="row-view-q${fresh}">${esc(e.quarter || '')}</span>
        </div>
        <div class="row-id">
          <div class="row-name"><a class="row-nm" href="/company/${esc(c.slug)}/">${esc(c.name)}</a>${c.tvCode ? ` <span class="row-sym">${esc(c.tvCode)}</span>` : ''}${flip ? ` <span class="flip-chip">↕ from ${esc(flip)}</span>` : ''}</div>
          <div class="row-submeta">${[c.industry].filter(Boolean).map(esc).join(' · ')}${c.marketCap != null ? `${c.industry ? ' · ' : ''}<span class="row-cap">${esc(formatMcap(c.marketCap))}</span>` : ''}</div>
          <div class="row-note preview${e.note ? '' : ' empty'}">${esc(e.note || 'No note this quarter.')}</div>
          ${emaPillsHTML(c)}
        </div>
        <div class="row-actions">
          <span class="ra-links">
            ${report ? `<a class="link-chip primary" href="${esc(report)}" target="_blank" rel="noopener">✨ AI report</a>` : ''}
            ${symbol ? `<a class="ilink" href="https://www.tradingview.com/symbols/${encodeURIComponent(symbol)}/" target="_blank" rel="noopener">Chart<span class="ext"> ↗</span></a>` : ''}
            ${c.tvCode ? `<a class="ilink" href="https://www.screener.in/company/${encodeURIComponent(c.tvCode)}/" target="_blank" rel="noopener">Screener<span class="ext"> ↗</span></a>` : ''}
          </span>
          <span class="ra-own">
            <button class="row-copy" type="button" data-copy="${esc(c.slug)}" title="Copy link to this company" aria-label="Copy link to ${esc(c.name)}">🔗</button>
            <a class="row-more" href="/company/${esc(c.slug)}/">Full note →</a>
          </span>
        </div>
      </div>
    </div>`;
}

// ---- Table density: one line per company ----
// Same information, no boxes. The quarter is a column here because it is the
// field that says whether you are reading current thinking or something months
// old — newest takes the accent pill, older stays muted.
export function tableRowHTML(c, e, newestQ) {
  const vs = vslug(e.view);
  const fresh = newestQ && e.quarter === newestQ ? ' fresh' : '';
  const r = c.ema || {};
  const dist = (w) => {
    const d = r.dist ? r.dist[w] : null;
    if (d == null) return '<td class="r">—</td>';
    const up = d >= 0;
    return `<td class="r"><span class="t-e ${up ? 'up' : 'down'}">${up ? '▲' : '▼'}${Math.abs(d).toFixed(1)}%</span></td>`;
  };
  const chg = (r.dayChangePct == null) ? '' : (() => {
    const up = r.dayChangePct >= 0;
    return `<span class="t-chg ${up ? 'up' : 'down'}">${up ? '▲' : '▼'}${Math.abs(r.dayChangePct).toFixed(2)}%</span>`;
  })();
  const note = e.note ? `<span class="t-th" title="${esc(e.note)}">${esc(e.note)}</span>` : '<span class="t-th empty">—</span>';
  return `<tr class="view-${vs}" id="c-${esc(c.slug)}" data-slug="${esc(c.slug)}">
      <td class="tv"><span class="t-view view-${vs}"><span class="gly">${VIEW_GLYPH[e.view] || ''}</span><span class="t-vw">${esc(e.view || 'Unrated')}</span></span></td>
      <td><a class="t-nm" href="/company/${esc(c.slug)}/">${esc(c.name)}</a>${c.tvCode ? `<span class="t-sym">${esc(c.tvCode)}</span>` : ''}</td>
      <td class="col-thesis">${note}</td>
      <td><span class="t-q${fresh}">${esc(e.quarter || '')}</span></td>
      <td class="col-tier"><span class="t-tier">${esc(e.tier || c.tier || '')}</span></td>
      <td class="col-ind"><span class="t-ind">${esc(c.industry || '')}</span></td>
      <td class="r"><span class="t-cap">${esc(formatMcap(c.marketCap))}</span></td>
      <td class="r">${r.price != null ? `<span class="t-px">${fmtINR(r.price)}</span>${chg}` : '—'}</td>
      ${dist('10W')}${dist('20W')}${dist('40W')}
    </tr>`;
}

// `key` must match the sort keys in index.astro's apply(), so a header click and
// the Sort dropdown drive the same state.
const TH = [
  ['view', 'View', ''],
  ['name', 'Company', ''],
  [null, 'Thesis', 'col-thesis'],
  ['quarter', 'Quarter', ''],
  ['tier', 'Tier', 'col-tier'],
  [null, 'Industry', 'col-ind'],
  ['mcap', 'Mkt cap', 'r'],
  ['price', 'Price', 'r'],
  ['d10', '10W', 'r'],
  ['d20', '20W', 'r'],
  ['d40', '40W', 'r'],
];

export function tableHTML(rows, sort) {
  const s = sort || {};
  const head = TH.map(([key, label, cls]) => {
    const classes = [cls, key ? 'sortable' : '', key && key === s.key ? 'sorted' : ''].filter(Boolean).join(' ');
    const attrs = key ? ` data-sort="${key}" aria-sort="${key === s.key ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"` : '';
    const arrow = key && key === s.key ? `<span class="th-dir" aria-hidden="true">${s.dir === 'asc' ? '▲' : '▼'}</span>` : '';
    return `<th${classes ? ` class="${classes}"` : ''}${attrs}>${key ? `<button type="button" class="th-btn">${label}${arrow}</button>` : label}</th>`;
  }).join('');
  return `<div class="tblwrap"><table class="tbl">
      <thead><tr>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

// Table density on a phone: the 11-column table needs a sideways swipe per row
// at 390px, so a compact row carries the same fields without one.
export function compactRowHTML(c, e, newestQ) {
  const vs = vslug(e.view);
  const fresh = newestQ && e.quarter === newestQ ? ' fresh' : '';
  const r = c.ema || {};
  let near = '';
  if (r.dist) {
    const best = ['10W', '20W', '40W']
      .filter((w) => r.dist[w] != null)
      .sort((a, b) => Math.abs(r.dist[a]) - Math.abs(r.dist[b]))[0];
    if (best) {
      const d = r.dist[best], up = d >= 0;
      near = `<span class="c-ema ${up ? 'up' : 'down'}">${best} ${up ? '▲' : '▼'}${Math.abs(d).toFixed(1)}%</span>`;
    }
  }
  return `<div class="crow view-${vs}" id="c-${esc(c.slug)}" data-slug="${esc(c.slug)}">
      <span class="c-gly" aria-hidden="true">${VIEW_GLYPH[e.view] || ''}</span>
      <span class="c-id">
        <a class="c-nm" href="/company/${esc(c.slug)}/">${esc(c.name)}</a>
        <span class="c-sub"><span class="c-q${fresh}">${esc(e.quarter || '')}</span>${e.tier ? ` · ${esc(e.tier)}` : ''}</span>
      </span>
      <span class="c-num">
        ${r.price != null ? `<span class="c-px">${fmtINR(r.price)}</span>` : ''}
        ${near}
      </span>
    </div>`;
}

export function compactListHTML(rows) {
  return `<div class="clist">${rows}</div>`;
}

// First paint, ordered to match the client's default "Sort: View" so nothing
// reorders once JS runs. `limit` renders only the first page (client paginates
// on load), avoiding a full second copy of every row on top of the JSON island.
// The three sort keys here MUST stay identical to the 'view' branch of apply()
// in index.astro — any divergence shows up as a visible reflow on load.
export function initialListHTML(companies, limit) {
  const newestQ = newestQuarter(companies);
  const ranked = companies
    .map((c) => ({ c, e: latestEntry(c) }))
    .filter(({ e }) => e)
    .sort((a, b) =>
      (viewRank(a.e.view) - viewRank(b.e.view)) ||
      (quarterKey(b.e.quarter) - quarterKey(a.e.quarter)) ||
      ((b.c.marketCap || 0) - (a.c.marketCap || 0)));
  return (limit ? ranked.slice(0, limit) : ranked)
    .map(({ c, e }) => rowHTML(c, e, newestQ))
    .join('');
}

// View distribution over each company's latest quarter (for the summary bar).
export function viewCounts(companies) {
  const counts = { Positive: 0, Watch: 0, Concern: 0, Negative: 0 };
  for (const c of companies) {
    const e = latestEntry(c);
    if (e && counts[e.view] != null) counts[e.view]++;
  }
  return counts;
}

/* ============================================================
   The "what changed" digest — counts only
   The old version needed two adjacent quarters AND a differing view before it
   could say anything, which left the largest fact unreported: most of the book
   has not been revisited. Every company now lands in exactly one bucket, so the
   five counts partition the list and each one can drive a filter.
   ============================================================ */
export function changeClass(c, newestQ) {
  const qs = [...(c.quarters || [])].sort((a, b) => quarterKey(a.quarter) - quarterKey(b.quarter));
  if (!qs.length) return null;
  const cur = qs[qs.length - 1];
  if (cur.quarter !== newestQ) return 'stale';
  if (qs.length === 1) return 'new';
  const prev = qs[qs.length - 2];
  if (!prev.view || !cur.view || prev.view === cur.view) return 'same';
  return viewRank(cur.view) < viewRank(prev.view) ? 'up' : 'down';
}

export function digestCounts(companies) {
  const newestQ = newestQuarter(companies);
  const out = { quarter: newestQ, up: 0, down: 0, new: 0, same: 0, stale: 0, oldestStale: null };
  for (const c of companies) {
    const k = changeClass(c, newestQ);
    if (!k) continue;
    out[k]++;
    if (k === 'stale') {
      const e = latestEntry(c);
      if (e && (!out.oldestStale || quarterKey(e.quarter) < quarterKey(out.oldestStale))) out.oldestStale = e.quarter;
    }
  }
  return out;
}

/* ============================================================
   Company page components
   ============================================================ */
const GROWTH_ROWS = [
  ['sales', 'Sales', 'SALES', true],
  ['opProfit', 'Operating profit', 'OP PROFIT', false],
  ['eps', 'EPS', 'EPS', false],
  ['pat', 'PAT', 'PAT', true],
];
// A true minus sign, and one decimal — matches the EMA panel's number style.
const pct = (v) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(1)}%`;
const sgn = (v) => (v == null ? 'flat-n' : v >= 0 ? 'up-n' : 'down-n');
const arw = (v) => (v >= 0 ? '▲' : '▼');
const hasGrowth = (e) => !!(e && e.growth && GROWTH_ROWS.some(([k]) => e.growth[k] && (e.growth[k].yoy != null || e.growth[k].qoq != null)));

// The Tier rule, shown instead of asserted: the weaker of YoY Sales and YoY PAT.
function tierFootnote(g) {
  const s = g.sales && g.sales.yoy, p = g.pat && g.pat.yoy;
  if (s == null || p == null) return '';
  const weaker = Math.min(s, p);
  const which = s <= p ? 'Sales' : 'PAT';
  const band = weaker >= 20 ? ['Tier 1', '≥ 20%'] : weaker >= 15 ? ['Tier 2', '≥ 15%'] : weaker >= 10 ? ['Tier 3', '≥ 10%'] : ['Tier 4', 'under 10%'];
  return `<p class="gm-foot"><b>Tinted rows drive the Tier.</b> Tier = the weaker of YoY Sales and YoY PAT growth.
      Here the weaker is ${which} at ${pct(weaker)}, which is ${band[1]} → <b>${band[0]}</b>.</p>`;
}

export function growthMatrixHTML(e) {
  const g = (e && e.growth) || {};
  const head = `<h2 class="section-title">Growth <span class="st-tag">${esc(e.quarter)}</span></h2>`;
  if (!hasGrowth(e)) {
    return `<section class="panel dt-growth">${head}
      <div class="g-none">Growth figures are not recorded for this quarter. They start from the first quarter you enter them.</div>
    </section>`;
  }
  // Colour only on YoY: the March quarter is seasonally the largest for most
  // Indian companies, so a June-quarter QoQ fall is a calendar effect.
  const rows = GROWTH_ROWS.map(([key, label, , tierRow]) => {
    const v = g[key] || {};
    const yoyCell = (n) => (n == null
      ? '<td><span class="v flat-n">—</span></td>'
      : `<td><span class="v ${sgn(n)}"><span class="arw">${arw(n)}</span> ${pct(n)}</span></td>`);
    const qoqCell = (n) => (n == null
      ? '<td class="qoq"><span class="v flat-n">—</span></td>'
      : `<td class="qoq"><span class="v seq">${pct(n)}</span></td>`);
    return `<tr${tierRow ? ' class="hi"' : ''}><th class="m">${label}</th>${yoyCell(v.yoy)}${qoqCell(v.qoq)}</tr>`;
  }).join('');
  return `<section class="panel dt-growth">${head}
      <div class="gm-wrap"><table class="gmatrix">
        <thead><tr><th class="m">Metric</th>
          <th>YoY<span class="gm-vs">vs ${esc(yoyQuarterLabel(e.quarter) || '—')}</span></th>
          <th class="qoq">QoQ<span class="gm-vs"><span class="gm-seq">sequential, </span>vs ${esc(prevQuarterLabel(e.quarter) || '—')}</span></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      ${tierFootnote(g)}
      <p class="gm-foot seq-foot"><b>QoQ is sequential, not a trend.</b> For most Indian companies the March quarter is
        seasonally the largest, so a June-quarter fall against it is a calendar effect. Only the YoY column feeds the Tier.</p>
    </section>`;
}

// Four tiles, always in the same column order, so reading the first column down
// the rail gives you Sales YoY quarter by quarter. That alignment is the trend
// view — it needs no chart.
function growthTilesHTML(e) {
  if (!hasGrowth(e)) return '<div class="tl-none">Growth figures not recorded for this quarter.</div>';
  const tiles = GROWTH_ROWS.map(([key, , short]) => {
    const v = (e.growth || {})[key] || {};
    const cls = v.yoy == null ? '' : v.yoy >= 0 ? 'up' : 'down';
    const row = (n, k, sub) => (n == null ? '' : `<div class="g-row${sub ? ' sub' : ''}"><span class="gp ${sub ? 'seq' : sgn(n)}">${sub ? '' : `<span class="arw">${arw(n)}</span>`}${pct(n)}</span><span class="gk">${k}</span></div>`);
    return `<div class="g-tile ${cls}"><div class="gl">${short}</div>${row(v.yoy, 'YoY', false)}${row(v.qoq, 'QoQ', true)}</div>`;
  }).join('');
  return `<div class="tl-g">${tiles}</div>`;
}

// Earlier quarters as a rail: one line, one ring per quarter in that quarter's
// view colour, so the trajectory of the views reads by scanning the rings. No
// boxes — the rail supplies the structure the old nested cards were doing.
export function timelineHTML(c, currentQuarter) {
  const chrono = [...(c.quarters || [])].sort((a, b) => quarterKey(a.quarter) - quarterKey(b.quarter));
  const ci = chrono.findIndex((x) => x.quarter === currentQuarter);
  const older = chrono.slice(0, ci < 0 ? chrono.length : ci);
  if (!older.length) return '';
  const items = [...older].reverse().map((h) => {
    const idx = chrono.findIndex((x) => x.quarter === h.quarter);
    const before = idx > 0 ? chrono[idx - 1] : null;
    const flip = before && before.view && h.view && before.view !== h.view ? before.view : null;
    const hr = safeHttpUrl(h.reportUrl);
    const vs = vslug(h.view);
    return `<div class="tl-item view-${vs}">
        <div class="tl-top">
          <span class="tl-q">${esc(h.quarter)}</span>
          ${h.view ? `<span class="tl-view view-${vs}"><span class="gly">${VIEW_GLYPH[h.view] || ''}</span>${esc(h.view)}</span>` : ''}
          ${h.tier ? `<span class="badge tier">${esc(h.tier)}</span>` : ''}
          ${flip ? `<span class="flip-chip">↕ from ${esc(flip)}</span>` : ''}
          ${hr ? `<a class="ilink tl-rep" href="${esc(hr)}" target="_blank" rel="noopener">✨ AI report ↗</a>` : ''}
        </div>
        <div class="tl-note">${esc(h.note || '—')}</div>
        ${growthTilesHTML(h)}
      </div>`;
  }).join('');
  return `<section class="panel dt-hist">
      <h2 class="section-title">Earlier quarters <span class="st-tag">${older.length}</span></h2>
      <div class="qtl">${items}</div>
    </section>`;
}
