// Shared row rendering — used both at build time (SSR in index.astro) and on the
// client (filter/sort/paginate). Keeping it in one place means the server-rendered
// HTML and the client-rendered HTML are always identical.
import { formatMcap, quarterKey } from './format.js';

export const VIEW_ORDER = ['Positive', 'Watch', 'Concern', 'Negative'];
export const VIEW_GLYPH = { Positive: '▲', Watch: '●', Concern: '◆', Negative: '▼' };

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const vslug = (v) => (v ? String(v).toLowerCase() : 'unrated');

export const latestEntry = (c) => {
  const qs = c.quarters || [];
  return qs.length ? qs.reduce((a, b) => (quarterKey(b.quarter) >= quarterKey(a.quarter) ? b : a)) : null;
};

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
function emaPanelHTML(c) {
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
  return `<div class="ema">
        <div class="ema-head"><span class="ema-k">Price</span><span class="ema-price">${fmtINR(r.price)}</span>${r.asOf ? `<span class="ema-tag">as of ${fmtDate(r.asOf)}</span>` : ''}</div>
        <div class="ema-grid">${tiles}</div>
      </div>`;
}

function histEntryHTML(h) {
  return `<div class="entry view-${vslug(h.view)}">
      <div class="entry-top">
        <span class="entry-q">${esc(h.quarter)}</span>
        ${h.view ? `<span class="badge view-${vslug(h.view)}"><span class="gly">${VIEW_GLYPH[h.view] || ''}</span>${esc(h.view)}</span>` : ''}
        ${h.tier ? `<span class="badge tier">${esc(h.tier)}</span>` : ''}
        ${h.reportUrl ? `<a class="ilink" href="${esc(h.reportUrl)}" target="_blank" rel="noopener">✨ AI report ↗</a>` : ''}
      </div>
      <div class="entry-note">${esc(h.note || '—')}</div>
    </div>`;
}

export function rowHTML(c, e) {
  const vs = vslug(e.view);
  const symbol = c.tvCode ? `NSE:${c.tvCode}` : null;
  const report = e.reportUrl || null; // this quarter's report
  // Sort the timeline once (oldest→newest); derive both the "flip" and the
  // "older" list from it instead of sorting twice.
  const chrono = [...(c.quarters || [])].sort((a, b) => quarterKey(a.quarter) - quarterKey(b.quarter));
  const ci = chrono.findIndex((x) => x.quarter === e.quarter);
  const prev = ci > 0 ? chrono[ci - 1] : null;
  const flip = prev && prev.view && e.view && prev.view !== e.view ? prev.view : null;
  const older = chrono.filter((x) => x.quarter !== e.quarter).reverse();
  return `<div class="row view-${vs}" id="c-${esc(c.slug)}" data-slug="${esc(c.slug)}">
      <div class="row-head">
        <div class="row-view">
          <span class="badge view-${vs}"><span class="gly">${VIEW_GLYPH[e.view] || ''}</span>${esc(e.view || 'Unrated')}</span>
          ${e.tier ? `<span class="badge tier">${esc(e.tier)}</span>` : ''}
          <span class="row-view-q">${esc(e.quarter || '')}</span>
        </div>
        <div class="row-id">
          <div class="row-name"><span class="row-nm" role="button" tabindex="0" title="Copy link to this company">${esc(c.name)}</span>${c.tvCode ? ` <span class="row-sym">${esc(c.tvCode)}</span>` : ''}${flip ? ` <span class="flip-chip">↕ from ${esc(flip)}</span>` : ''}</div>
          <div class="row-submeta">${[c.industry].filter(Boolean).map(esc).join(' · ')}${c.marketCap != null ? `${c.industry ? ' · ' : ''}<span class="row-cap">${esc(formatMcap(c.marketCap))}</span>` : ''}</div>
          ${emaPanelHTML(c)}
          <div class="row-note${e.note ? '' : ' empty'}">${esc(e.note || 'No note this quarter.')}</div>
          ${older.length ? `<button class="hist-toggle" aria-expanded="false">▸ history (${older.length})</button>
            <div class="hist" hidden>${older.map(histEntryHTML).join('')}</div>` : ''}
        </div>
        <div class="row-actions">
          ${report ? `<a class="link-chip primary" href="${esc(report)}" target="_blank" rel="noopener">✨ AI report</a>` : ''}
          ${symbol ? `<a class="ilink" href="https://www.tradingview.com/symbols/${encodeURIComponent(symbol)}/" target="_blank" rel="noopener">Chart ↗</a>` : ''}
          ${c.tvCode ? `<a class="ilink" href="https://www.screener.in/company/${encodeURIComponent(c.tvCode)}/" target="_blank" rel="noopener">Screener ↗</a>` : ''}
        </div>
      </div>
    </div>`;
}

// Default order used for the server-rendered first paint (market cap desc).
export function initialListHTML(companies) {
  return companies
    .map((c) => ({ c, e: latestEntry(c) }))
    .filter(({ e }) => e)
    .sort((a, b) => (b.c.marketCap || 0) - (a.c.marketCap || 0))
    .map(({ c, e }) => rowHTML(c, e))
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

// Quarter-over-quarter changes: latest vs previous quarter per company.
export function quarterChanges(companies) {
  const rank = { Positive: 0, Watch: 1, Concern: 2, Negative: 3 }; // lower = better
  const out = [];
  for (const c of companies) {
    const qs = [...(c.quarters || [])].sort((a, b) => quarterKey(a.quarter) - quarterKey(b.quarter));
    if (qs.length < 2) continue;
    const cur = qs[qs.length - 1], prev = qs[qs.length - 2];
    if (!cur.view || !prev.view || cur.view === prev.view) continue;
    out.push({
      name: c.name, slug: c.slug, from: prev.view, to: cur.view,
      quarter: cur.quarter,
      dir: rank[cur.view] < rank[prev.view] ? 'up' : 'down',
    });
  }
  return out;
}
