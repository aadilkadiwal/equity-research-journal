// Shared row rendering — used both at build time (SSR in index.astro) and on the
// client (filter/sort/paginate). Keeping it in one place means the server-rendered
// HTML and the client-rendered HTML are always identical.
import { formatMcap, quarterKey, prevQuarterLabel, yoyQuarterLabel } from './format.js';
import { score, epsTtmFor, BANDS, priceWindow } from './score.js';

export const VIEW_ORDER = ['Positive', 'Watch', 'Concern', 'Negative'];
// Never ▲/▼: those mean "price up/down" in the EMA pills, the day-change and the
// growth table on the same card, so "▲ Positive" read as "the price went up".
export const VIEW_GLYPH = { Positive: '●', Watch: '◐', Concern: '◆', Negative: '✕' };

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

// The most recent quarter anywhere in the dataset — the one the "what changed"
// digest reports on.
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
function emaPillsHTML(c, commonDate) {
  const r = c.ema;
  if (!r || !r.dist) return '';
  const pills = ['10W', '20W', '40W'].map((w) => {
    const d = r.dist[w];
    if (d == null) return '';
    const above = d >= 0;
    // The pill stays terse; the tap is where "EMA" gets said in words.
    const weeks = w.replace('W', '');
    const tip = `The average price over the last ${weeks} weeks — its ${weeks}-week trend line. `
      + `Today's price is ${Math.abs(d).toFixed(1)}% ${above ? 'above' : 'below'} it, `
      + `so buyers have been ${above ? 'in control over that stretch' : 'losing ground over that stretch'}.`;
    return `<span class="ema-pill ${above ? 'above' : 'below'}" role="button" tabindex="0"`
      + ` data-tip="${esc(tip)}" data-tip-head="${weeks}-week trend line" title="${esc(tip)}">`
      + `${w} <b>${above ? '▲' : '▼'}${Math.abs(d).toFixed(1)}%</b></span>`;
  }).join('');
  if (!pills) return '';
  const chg = (r.dayChangePct == null) ? '' : (() => {
    const up = r.dayChangePct >= 0;
    return `<span class="ema-chg ${up ? 'up' : 'down'}"><span class="arw">${up ? '▲' : '▼'}</span>${Math.abs(r.dayChangePct).toFixed(2)}%</span>`;
  })();
  // 119 of 120 companies carry the same refresh date, so printing it on every card
  // is 24 copies of one fact. The page states it once; a card only dates itself when
  // its price is OLDER than the rest of the book, which is the case worth flagging.
  const stale = r.asOf && commonDate && r.asOf !== commonDate;
  const tag = r.asOf && (!commonDate || stale)
    ? `<span class="ema-tag${stale ? ' stale' : ''}">${fmtDate(r.asOf)}</span>` : '';
  return `<div class="ema compact">
        <div class="ema-head"><span class="ema-k">Price</span><span class="ema-price">${fmtINR(r.price)}</span>${chg}${tag}</div>
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


// ---- Multibagger setup score -------------------------------------------------
// Rendered from score.js on both the server and the client, so the two paints stay
// identical (same rule as everything else in this file). The band uses an indigo
// ramp, never the view palette — green/blue/amber/red already mean Positive /
// Watch / Concern / Negative, so a green badge here would read as a view.
// No per-band glyph: four bands meant four shapes to learn before the badge said
// anything, and the band's own word already says it. Colour still carries the ramp.
const bandLabel = (b) => BANDS[b].label;

// One decimal below 10x, where the difference between 8.2x and 8.7x is real money.
const fmtX = (v) => `${v < 10 ? v.toFixed(1) : v.toFixed(0)}×`;
const YRS = 5;

// Everything score() needs beyond the quarter itself — currently just the
// quarter's own trailing EPS, which turns the stored price into a P/E.
const scoreCtx = (c, e) => {
  const ttm = epsTtmFor(e);
  // industry lives on the company, not the quarter, and decides the valuation lens.
  // marketCap likewise — it is reported, never scored. peRange is attached on the
  // company page only; it is report-only, so the band is identical with or without
  // it and the list payload stays lean.
  return { epsTtm: ttm ? ttm.value : null, industry: c.industry ?? null,
    marketCap: c.marketCap ?? null, peRange: c.peRange ?? null };
};

// score() is pure, and the list asked it the same question three or four times per
// company per pass — once in the filter, once per COMPARISON in the sort, once per
// rendered row — on every keystroke. Cached on the company against the quarter and
// price snapshot it was built from, so a data change still rescores.
const SCORE_CACHE = new WeakMap();
export function scoreFor(c, e) {
  const stamp = `${e && e.quarter}|${c.ema && c.ema.asOf}|${c.ema && c.ema.price}|${c.peRange ? 'r' : ''}`;
  const hit = SCORE_CACHE.get(c);
  if (hit && hit.stamp === stamp) return hit.result;
  const result = score(e, c.ema, scoreCtx(c, e));
  SCORE_CACHE.set(c, { stamp, result });
  return result;
}

const flagChips = (flags) =>
  flags.map((f) => `<span class="mb-flag">⚠ ${esc(f.label)}</span>`).join('');

// List and table views carry the BAND only — a one-word read while scanning.
// The number, the three components and the flags are detail-page material; showing
// them per row turned the list into a wall of digits. Returns '' when unscoreable
// so a row is never padded with a placeholder it has to explain.
// One place the band comes from, so the badge on a card and the filter that hides
// it can never disagree. Null when the company cannot be scored at all — which is
// what the filter's "Not scored" option selects on.
export function setupBand(c, e) {
  const r = scoreFor(c, e);
  return r.insufficient ? null : r.band;
}

// The three-year outlook as a plain multiple, for sorting. Same source as the
// badge, so a sort can never disagree with what the row displays.
export function setupOutlook(c, e) {
  const r = scoreFor(c, e);
  return (r.insufficient || r.outlook3y == null) ? null : r.outlook3y + 1;
}

// The sortable rank, and the reason the list and the badge can no longer disagree:
// the SCORE is the whole part, so order follows the number every row prints, and the
// outlook only ever moves the fraction. A projection the flags undermine breaks no
// ties at all — it was precisely the flagged names that the old outlook-only sort
// lifted to the top. Capped at x20 so one runaway multiple cannot carry a whole point.
const TIEBREAK_CAP = 20;
export function setupRank(c, e) {
  const r = scoreFor(c, e);
  if (r.insufficient) return null;
  const usable = r.outlookReliable && r.outlook3y != null;
  return r.score + (usable ? Math.min(r.outlook3y + 1, TIEBREAK_CAP) / (TIEBREAK_CAP + 1) : 0);
}

// Band, score out of 100, and one caution glyph standing in for the flags — which
// stay on the detail page. The denominator is what lets the ladder order itself for
// a reader who does not already know that Good outranks Average.
export function scoreBadgeHTML(c, e) {
  const r = scoreFor(c, e);
  if (r.insufficient) return '';
  const warn = r.flags.length
    ? ` <span class="mb-warn" aria-hidden="true">⚠</span>` : '';
  // Trailing stops are stripped because the parts join with a separator — an
  // un-stripped one reads as "…on the figures alone. · 56 out of 100".
  const tip = [`${r.score} out of 100 (${bandLabel(r.band)}) — how strong the case looks `
      + `on the figures alone, before anyone has read the earnings call`,
    r.verdict,
    r.gate ? `Capped: ${r.gate}` : '',
    r.flags.length ? `Caution: ${r.flags.map((f) => f.label).join(', ')}` : '',
    r.outlook3y != null
      ? `If it compounds for 3 more years: ×${(r.outlook3y + 1).toFixed(1)}`
        + (r.outlookReliable ? '' : ' — but the flags undermine that projection, '
          + 'so it cannot be leaned on')
      : '',
  ].filter(Boolean).map((t) => String(t).trim().replace(/\.$/, '')).join(' · ');
  // data-tip drives the tappable popover (taptip.js); title= is the fallback for a
  // page that does not load it.
  return `<span class="mb-badge mb-${r.band.toLowerCase()}" role="button" tabindex="0"`
    + ` data-tip="${esc(tip)}" data-tip-head="Multibagger potential" title="${esc(tip)}"`
    + ` aria-label="Multibagger potential ${r.score} out of 100, ${bandLabel(r.band)}">`
    + `${bandLabel(r.band)}<b class="mb-n">${r.score}<s>/100</s></b>${warn}</span>`;
}

// A sentence anyone can read, before any notation. Deliberately avoids "multiple",
// "CAGR", "PEG" and the quadrant nicknames — the four words a non-investor would
// have to look up, and the reason this panel read as a wall of symbols. The
// quadrant name still appears further down for the reader who wants it.
const RUPEE_OF_PROFIT = 'the price-tag on its earnings';
// Mirrors MIN_GROWTH in score.js — the rate below which the band is capped.
const MIN_GROWTH_BAR = 15;
// The nicknames come from the framework image and are worth keeping — but on their
// own "The Treadmill" reads as futility, directly under a lead that says "cheap, and
// growing fast". One plain clause each removes the contradiction.
const QUADRANT_PLAIN = {
  Q1: 'earnings climbing and buyers already paying more for them',
  Q2: 'buyers paying more for earnings that are not growing',
  Q3: 'earnings climbing while the price-tag on them has not — no re-rating yet',
  Q4: 'earnings falling and the price-tag falling with them',
};
export function plainSummary(r) {
  // A whole number reads better, except where rounding would make the sentence
  // contradict itself: 14.94 printed as "grew 15% a year, and a re-pricing needs
  // more than 15%". One decimal whenever the rounded figure would reach the bar.
  const g = Math.abs(r.growth);
  const rate = `${(Math.round(g) >= MIN_GROWTH_BAR && g < MIN_GROWTH_BAR
    ? g.toFixed(1) : g.toFixed(0))}%`;
  const cheaper = r.deltaMultiple < 1;
  // A gate means the band is held down by the growth rate itself, so the quadrant
  // wording would overpromise. Say why instead.
  if (!(r.growth > 0)) {
    return { head: 'Earnings are shrinking, not growing.',
      body: `Profit per share fell ${rate} a year over the window measured. Nothing
        compounds from here until that turns, whatever the price does.` };
  }
  if (r.gate) {
    return { head: 'Growing, but too slowly to re-price.',
      body: `Profit per share grew ${rate} a year. A big re-pricing usually needs
        more than ${MIN_GROWTH_BAR}% a year, so the score is capped no matter how cheap
        it looks.` };
  }
  switch (r.quadrant.key) {
    case 'Q1': return { head: 'Growing fast — and the market has noticed.',
      body: `Profit per share grew ${rate} a year, and buyers now pay more for each
        rupee of it than they did a year ago. Some of the re-pricing has already happened.` };
    case 'Q2': return { head: 'The price has run ahead of the earnings.',
      body: `Buyers pay more for each rupee of profit than a year ago, but profit
        itself grew only ${rate} a year. The price is running on expectation.` };
    case 'Q3': return { head: 'Cheap, and growing fast.',
      body: `Profit per share grew ${rate} a year, while ${RUPEE_OF_PROFIT} actually
        got ${cheaper ? 'smaller' : 'no dearer'}. That gap — real growth nobody has
        paid up for — is exactly what this score looks for.` };
    default: return { head: `Both the earnings and ${RUPEE_OF_PROFIT} are falling.`,
      body: `Profit grew ${rate} a year but buyers pay less for each rupee of it than
        they did, so the price has gone nowhere. Two things have to turn, not one.` };
  }
}

// Collapsed by default, and rendered on the list page as well as the detail page —
// the list is where the unexplained words are. The first three terms are the three
// badges a card prints, in the order it prints them.
export function glossaryHTML(opts) {
  const open = !!(opts && opts.open);
  const terms = [
    ['View', 'My own call on the company after reading its results and earnings call — Positive (looks promising), Watch (keep an eye on), Concern (be cautious), Negative (avoid for now). A judgement, not a calculation.'],
    ['Tier (1–4)', 'How fast the business is growing, graded on the weaker of its yearly sales and profit growth. Tier 1 is both above 20%, Tier 4 is either below 10%. Arithmetic, not an opinion.'],
    ['Multibagger potential', 'A 0–100 score of how strong the case looks on the figures alone — cheapness, growth the market has not paid for yet, growth quality, returns on capital and the price trend. It has NOT read the earnings call; the View has.'],
    ['Multibagger', 'A stock that returns several times what you paid. It takes both growing earnings and a rising P/E — which is what the potential score measures.'],
    ['P/E', 'What you pay for ₹1 of yearly profit. 20× means ₹20 of share price for every ₹1 the company earns a year.'],
    ['EPS', 'Earnings per share — the profit belonging to one share.'],
    ['CAGR', 'The steady yearly rate that would take you from the starting figure to the ending one. A 3-year CAGR of 40% means it grew as if 40% every year for three years.'],
    ['Re-rating / re-pricing', 'The market deciding to pay more for the same ₹1 of profit. The P/E rises without the earnings changing. This is the half of a multibagger that is not growth.'],
    ['YoY / QoQ', 'Against the same quarter a year ago (YoY) / against the quarter just before (QoQ).'],
    ['Book value', 'What one share owns of the company on paper — assets minus debts, divided by the shares. Useful where profits are lumpy and the P/E misleads.'],
    ['Trend line · EMA (10W / 20W / 40W)', 'A smoothed average of the price over the last 10, 20 or 40 weeks. Price above all three means buyers have been in control for a while.'],
    ['Market cap', 'What the whole company costs at today\u2019s price — the share price times every share there is.'],
  ];
  return `<details class="gloss"${open ? ' open' : ''}><summary>What do these words mean?</summary>
    <dl>${terms.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>
    <p class="gloss-more"><a href="/how-to-read/">See a real card taken apart, piece by piece →</a></p>
  </details>`;
}

// The three "what it trades on" tiles. Labels say what the ratio IS — "LAST YEAR
// ×1.07" told a reader nothing — with the notation kept on the sub-line.
// Shared: the panel prints them inline, the company page's rail prints the same
// three, and two copies drifted apart the moment one label was reworded.
function statTilesHTML(r) {
  const tile = (k, v, sub) => `<div class="mb-t"><span class="mb-tk">${k}</span>
    <b>${v}</b>${sub ? `<span class="mb-ts">${sub}</span>` : ''}</div>`;
  const priceFactor = (1 + r.growth / 100) * r.deltaMultiple;
  return [
    r.pb != null ? tile('Price vs its book value', `${r.pb.toFixed(1)}×`,
      `P/B — ₹${r.bvps.toFixed(0)} of book value per share`) : '',
    r.peForward != null ? tile('Price vs next year\u2019s profit', `${fmtX(r.peForward)}`,
      'forward P/E — what an entry pays now') : '',
    tile('Price over the last year', `×${priceFactor.toFixed(2)}`,
      `earnings ×${(1 + r.growth / 100).toFixed(2)}, price-tag ×${r.deltaMultiple.toFixed(2)}`),
  ].filter(Boolean).join('');
}

export function scorePanelHTML(c, e, opts) {
  const split = !!(opts && opts.split);
  const r = scoreFor(c, e);
  const head = '<h2 class="section-title">Multibagger potential';
  if (r.insufficient) {
    return `<section class="panel mb-panel">${head}</h2>
      <p class="mb-say">No score — ${esc(r.reason)}. The eight growth columns arrive with the
      quarter's Excel import; until then a number here would be invented.</p></section>`;
  }
  // Level first: it answers "is this cheap now", which is the question that finds a
  // company the market has not looked at yet. Unpaid growth answers how the
  // multiple moved over the year. Level is omitted entirely when there is no P/E,
  // and its points fold into unpaid growth.
  // Questions, not nouns: "Unpaid growth" told a non-investor nothing, while the
  // question it answers is one anyone can follow. The technical reading stays
  // underneath, word for word — this is still a research page.
  // The window the multiple change was measured over, said plainly: a 3-year price
  // return against a 3-year CAGR where both exist, one year where they do not.
  const mWin = r.multipleWindow === '3y' ? 'over 3 years' : 'over the year';
  const rowspec = [
    ...(r.components.level != null
      ? [['Is it cheap right now?', r.why.level, r.components.level, r.max.level]] : []),
    ['Has the market paid for this growth yet?', `ΔMultiple ×${r.deltaMultiple.toFixed(2)} a year `
      + `(×${r.deltaMultipleFull.toFixed(2)} ${mWin}) — ${r.why.unpaid}`, r.components.unpaid, r.max.unpaid],
    ['Is the growth real, or flattered?', r.why.quality.slice(0, 2).join('; ') || '—', r.components.quality, r.max.quality],
    ['What does it earn on its own money?', r.why.efficiency, r.components.efficiency, r.max.efficiency],
    ['Is the price trend agreeing?', r.why.confirmation, r.components.confirmation, r.max.confirmation],
  // lettered by position: with no P/E the level row is absent, and the remaining
  // rows must still read A B C rather than B C D
  ];
  // Every row shared one track while the maxima differ (25/15/30/10/20), so a full
  // 20/20 bar drew longer than 17/25. The TRACK is scaled by the row's own maximum,
  // which makes a point worth the same width on every line.
  const widest = Math.max(...rowspec.map(([, , , mx]) => mx));
  const rows = rowspec.map(([lab, sub, pts, mx]) => `<div class="mb-r">
      <span class="mb-lab">${esc(lab)}<span class="mb-sub">${esc(sub)}</span></span>
      <span class="mb-pts">${pts}<s>/${mx}</s></span>
      <span class="mb-bar" style="width:${((100 * mx) / widest).toFixed(1)}%"><i style="width:${Math.round((100 * pts) / mx)}%"></i></span>
    </div>`).join('');

  const proxy = r.proxy
    ? ` Price move is a <b>proxy</b> (distance from the 40-week EMA) until <code>ret1y</code> is stored.`
    : '';
  // The forward view leads. Whether a double or a triple is plausible is answered
  // by naming the multiple each would demand and comparing it to what this company
  // has actually averaged — a fact, not a forecast.
  const bench = r.peBenchmark;
  // With a fetched 5-year range the verdict stops being a comparison against one
  // average and becomes a fact about where the multiple has actually been. Without
  // one it falls back to the average, which is all the sheet can tell us.
  const rng = r.peRange;
  const verdictFor = (need) => {
    if (need == null) return '';
    if (rng) {
      return need <= rng.low ? `below anything it traded at in ${YRS} years`
        : need <= rng.median ? `inside its 5-year range, under the ${fmtX(rng.median)} median`
        : need <= rng.high ? `it has traded there — high was ${fmtX(rng.high)}`
        : `never traded above ${fmtX(rng.high)} in ${YRS} years`;
    }
    if (!bench) return '';
    const x = need / bench.value;
    return x <= 0.8 ? 'comfortably inside its own history'
      : x <= 1.1 ? 'about its normal multiple'
      : x <= 1.6 ? 'a stretch beyond its history'
      : 'a multiple it has not averaged';
  };
  const rupee = (v) => `₹${Math.round(v).toLocaleString('en-IN')}`;
  // The old block led with "TO DOUBLE, NEEDS 21×", which buried the striking part:
  // 21x is BELOW today's 29x, so this can double while getting cheaper. Lead with
  // that sentence and put the price in rupees, which needs no explaining.
  const px = c.ema.price;
  // Guarded: with no P/E benchmark there is no outlook at all, and bench is null.
  const dblHead = r.outlook3y == null ? ''
    : r.needFor2x < r.pe * 0.97
      ? `It could double even as ${RUPEE_OF_PROFIT} shrinks`
      : rng
        ? (r.needFor2x <= rng.high
          ? 'Doubling needs a price-tag it has reached before'
          : 'Doubling needs a price-tag it has never reached')
        : (r.needFor2x <= bench.value
          ? 'Doubling needs a price-tag it has averaged before'
          : 'Doubling needs a price-tag above its own average');
  // Size is a fact about the ODDS, not about the case, so it is stated next to the
  // projection rather than folded into the score above it.
  const crore = (v) => `₹${Math.round(v).toLocaleString('en-IN')} cr`;
  const sizeNote = r.size ? ` This is a <b>${r.size.label}</b> at ${crore(r.size.marketCap)}`
    + `${r.flags.some((f) => f.key === 'size-headwind')
      ? ` — size is the headwind here: a triple means the market finding ${crore(r.size.tripleTo - r.size.marketCap)} of new value.`
      : `, so the odds of a re-rate are not fighting its own size.`}` : '';
  const outlook = r.outlook3y != null ? `
    <div class="mb-out">
      <div class="mb-dbl">
        <b class="mb-dbl-h">${dblHead}</b>
        <p class="mb-dbl-b">${rupee(px)} → <b>${rupee(px * 2)}</b> needs the P/E at
          <b>${fmtX(r.needFor2x)}</b> — it is ${fmtX(r.pe)} today${rng
            ? `, and has ranged ${fmtX(rng.low)} to ${fmtX(rng.high)} over the last ${YRS} years`
            : ''}. The rest would come from earnings growing as they have.</p>
      </div>
      <div class="mb-out-h">
        <span class="mb-tk">If this keeps up for 3 more years</span>
        <b class="mb-big">×${(r.outlook3y + 1).toFixed(1)}</b>
        <span class="mb-out-sub">${r.outlook3y >= 0 ? '+' : ''}${(r.outlook3y * 100).toFixed(0)}%
          — profit growing ${r.growth.toFixed(0)}% a year, and buyers paying
          ${fmtX(r.peTarget)} for it${r.peTargetCapped ? '' : ' again'}</span>
      </div>
      <div class="mb-need">
        <div class="mb-n"><span class="mb-tk">To triple, the P/E must be</span><b>${fmtX(r.needFor3x)}</b>
          <span class="mb-ts">${verdictFor(r.needFor3x)}</span></div>
        ${rng ? `
        <div class="mb-n"><span class="mb-tk">Pays today · 5-year range</span><b>${fmtX(r.pe)} · ${fmtX(rng.low)}–${fmtX(rng.high)}</b>
          <span class="mb-ts">usual level ${fmtX(rng.median)} · ${rng.points} weeks of history</span></div>` : `
        <div class="mb-n"><span class="mb-tk">Pays today · its average</span><b>${fmtX(r.pe)} / ${fmtX(bench.value)}</b>
          <span class="mb-ts">${esc(bench.basis)}</span></div>`}
      </div>
      ${r.peTargetCapped ? `<p class="mb-say mb-fine mb-capline"><b>Target capped at ${fmtX(r.peTarget)}</b>
        — its ${fmtX(bench.value)} five-year average came from near-zero earnings.</p>` : ''}
    </div>` : `
    <div class="mb-out"><p class="mb-say">${r.growth > 0
      ? 'No forward view — no multiple to re-rate toward is recorded.'
      : 'No forward view — earnings are not compounding, so there is nothing to project.'}</p></div>`;

  // Both blocks move to the page's right rail when split, so building them here
  // would be work discarded on all 127 company pages.
  const stats = split ? '' : statTilesHTML(r);
  const win = split ? '' : windowHTML(c, r, priceWindow(e, c.ema, scoreCtx(c, e)));

  // The score reads figures; the View is the one thing on the page that has read the
  // concall. When they point opposite ways a reader skimming for "Strong" would take
  // the wrong signal away, so say it outright rather than leaving two badges to
  // contradict each other quietly. 5 of 109 companies currently disagree this way.
  // Three states, not two. Moderate is the middle: it contradicts neither view, and
  // treating it as "the figures are not positive" is what made BHEL print
  // "56 / 100 · Moderate", then "your view is Positive and the figures are not",
  // then "Growing fast — and the market has noticed" down one column.
  const upbeat = ['STRONG', 'FAIR'].includes(r.band);
  const downbeat = ['WEAK', 'NONE'].includes(r.band);
  const cautious = ['Concern', 'Negative'].includes(e.view);
  const clash = upbeat && cautious
    ? `<p class="mb-clash"><b>⚠ Your own view on this company is ${esc(e.view)}.</b>
        Read the note above first — this score reads the figures, and it has not read
        the concall.</p>`
    : (downbeat && e.view === 'Positive'
      ? `<p class="mb-clash"><b>⚠ Your own view here is Positive, and the figures are not.</b>
          The note above is where the reason lives; the score only sees the numbers.</p>`
      : '');
  const say = plainSummary(r);

  // Five grey paragraphs used to stack at the bottom of this panel — 392px of a
  // phone screen, on all 127 pages, saying things worth reading once. They move
  // behind one disclosure; the lead, the verdict and the one-line cap note stay out.
  const method = `<details class="mb-how"><summary>How this is calculated</summary>
    <div class="mb-how-body">
      ${r.outlook3y != null ? `<p class="mb-say mb-fine">This is arithmetic, not a forecast —
        <b>Return = ΔEPS × ΔMultiple</b>. It says what would have to be true, not how likely it is, and
        "earnings keep growing at this rate for three more years" is the assumption doing the most
        work.${rng ? '' : ` There is <b>no 5-year range on file</b> for this company, so the comparison
        falls back to its average alone.`}${sizeNote}</p>` : ''}
      ${r.peTargetCapped ? `<p class="mb-say mb-fine"><b>Why the target is capped at ${fmtX(r.peTarget)}.</b>
        This company averaged ${fmtX(bench.value)} over five years, but a multiple that high comes from
        near-zero earnings rather than from what buyers chose to pay — projecting a return to it would
        price in the collapse, not the recovery. ${fmtX(r.peTarget)} is what a ${r.growth.toFixed(0)}%
        grower supports.</p>` : ''}
      ${r.gate ? `<p class="mb-say mb-fine"><b>Band capped:</b> ${esc(r.gate)}.</p>` : ''}
      <p class="mb-say mb-fine">Growth rate used: <b>${r.growth.toFixed(1)}%</b> — the weakest of
        EPS / Sales / Op-profit from <b>${esc(r.growthBasis)}</b>${r.growth === 60 ? ', capped at 60%' : ''}${
          r.growthQuarter != null && r.growthWindow === '3y'
            ? `. Latest quarter reads ${r.growthQuarter.toFixed(0)}%.` : '.'}${proxy}</p>
    </div>
  </details>`;

  return `<section class="panel mb-panel">${head}
      <span class="st-tag"><span class="mb-badge mb-${r.band.toLowerCase()}">${bandLabel(r.band)}<b class="mb-n">${r.score}<s>/100</s></b></span></span></h2>
    ${clash}
    <p class="mb-lead"><b>${say.head}</b> ${say.body.replace(/\s+/g, ' ')}</p>
    ${outlook}
    <div class="mb-quad"><b>${esc(r.quadrant.name)}</b><span class="mb-ax">${esc(QUADRANT_PLAIN[r.quadrant.key] || r.quadrant.axis)}</span>${flagChips(r.flags)}</div>
    <div class="mb-rows">${rows}</div>
    ${stats ? `<div class="mb-stats">${stats}</div>` : ''}
    ${win}
    <p class="mb-say mb-verdict">${esc(r.verdict)}</p>
    ${method}
  </section>`;
}

// The two reference blocks. They answer "what is it on today" and "at what price does
// this change" — lookups, not narrative — so the company page puts them in its rail,
// where they shorten the main column and fill 1,419px of column that ran empty.
function windowHTML(c, r, window) {
  if (!window) return '';
  return `<div class="mb-win">
      <span class="mb-tk">At what price this changes</span>
      <div class="mb-wrow"><b>${BANDS[window.band].label}</b> from
        <b>₹${window.low.toLocaleString('en-IN')}</b> to <b>₹${window.high.toLocaleString('en-IN')}</b>
        <span>· now ₹${Math.round(c.ema.price).toLocaleString('en-IN')}</span></div>
      <div class="mb-wrow">${[
        window.above ? `above <b>₹${window.above.price.toLocaleString('en-IN')}</b> → ${BANDS[window.above.band].label}` : '',
        window.below ? `below <b>₹${window.below.price.toLocaleString('en-IN')}</b> → ${BANDS[window.below.band].label}` : '',
      ].filter(Boolean).join(' &nbsp;·&nbsp; ')}</div>
      ${window.moderateAt ? `<p class="mb-say mb-fine">At <b>₹${window.moderateAt.toLocaleString('en-IN')}</b> the
        price-tag on its earnings reaches the ${r.peTarget ? fmtX(r.peTarget) : ''} it is being projected toward —
        the point where being cheap against that yardstick is used up.</p>` : ''}
    </div>`;
}

// Rail companions to scorePanelHTML(c, e, { split: true }). Empty string when the
// company cannot be scored, so the page renders no empty boxes.
export function sidePanelsHTML(c, e) {
  const r = scoreFor(c, e);
  if (r.insufficient) return '';
  const stats = statTilesHTML(r);
  const win = windowHTML(c, r, priceWindow(e, c.ema, scoreCtx(c, e)));
  if (!stats && !win) return '';
  // ONE panel, not two. A second heading and a second set of panel padding cost more
  // on a phone (+83px) than splitting saved there; the window keeps its own inline
  // label as a sub-heading inside this one.
  return `<section class="panel dt-figures">
      <h2 class="section-title">What it trades on</h2>
      ${stats ? `<div class="mb-stats">${stats}</div>` : ''}
      ${win}
    </section>`;
}

export function rowHTML(c, e, redundant) {
  const hide = redundant || {};
  const vs = vslug(e.view);
  const symbol = c.tvCode ? `NSE:${c.tvCode}` : null;
  const report = safeHttpUrl(e.reportUrl);
  const chrono = [...(c.quarters || [])].sort((a, b) => quarterKey(a.quarter) - quarterKey(b.quarter));
  const ci = chrono.findIndex((x) => x.quarter === e.quarter);
  const prev = ci > 0 ? chrono[ci - 1] : null;
  const flip = prev && prev.view && e.view && prev.view !== e.view ? prev.view : null;
  return `<div class="row view-${vs}" id="c-${esc(c.slug)}" data-slug="${esc(c.slug)}">
      <div class="row-head">
        <div class="row-view">
          <span class="badge view-${vs}"><span class="gly">${VIEW_GLYPH[e.view] || ''}</span>${esc(e.view || 'Unrated')}</span>
          ${e.tier && !hide.tier ? `<span class="badge tier">${esc(e.tier)}</span>` : ''}
          ${scoreBadgeHTML(c, e)}
          ${hide.quarter ? '' : `<span class="row-view-q">${esc(e.quarter || '')}</span>`}
        </div>
        <div class="row-id">
          <div class="row-name"><a class="row-nm" href="/company/${esc(c.slug)}/">${esc(c.name)}</a>${c.tvCode ? ` <span class="row-sym">${esc(c.tvCode)}</span>` : ''}${flip ? ` <span class="flip-chip">↕ from ${esc(flip)}</span>` : ''}</div>
          <div class="row-submeta">${[c.industry].filter(Boolean).map(esc).join(' · ')}${c.marketCap != null ? `${c.industry ? ' · ' : ''}<span class="row-cap">${esc(formatMcap(c.marketCap))}</span>` : ''}</div>
          <div class="row-note preview${e.note ? '' : ' empty'}">${esc(e.note || 'No note this quarter.')}</div>
          ${emaPillsHTML(c, hide.asOf)}
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
export function tableRowHTML(c, e) {
  const vs = vslug(e.view);
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
      <td class="tv col-view"><span class="t-view view-${vs}"><span class="gly">${VIEW_GLYPH[e.view] || ''}</span><span class="t-vw">${esc(e.view || 'Unrated')}</span></span></td>
      <td class="col-name"><a class="t-nm" href="/company/${esc(c.slug)}/">${esc(c.name)}</a>${c.tvCode ? `<span class="t-sym">${esc(c.tvCode)}</span>` : ''}</td>
      <td class="col-ind"><span class="t-ind">${esc(c.industry || '')}</span></td>
      <td class="col-quarter"><span class="t-q">${esc(e.quarter || '')}</span></td>
      <td class="col-tier"><span class="t-tier">${esc(e.tier || c.tier || '')}</span></td>
      <td class="col-setup">${scoreBadgeHTML(c, e) || '<span class="t-th empty">—</span>'}</td>
      <td class="r"><span class="t-cap">${esc(formatMcap(c.marketCap))}</span></td>
      <td class="r">${r.price != null ? `<span class="t-px">${fmtINR(r.price)}</span>${chg}` : '—'}</td>
      ${dist('10W')}${dist('20W')}${dist('40W')}
      <td class="col-thesis">${note}</td>
    </tr>`;
}

// `key` must match the sort keys in index.astro's apply(), so a header click and
// the Sort dropdown drive the same state.
// Order matters twice over: the first two columns are PINNED (they answer "which
// company is this row"), so they lead; and Thesis is free text that will take every
// pixel it is given, so it goes last where it can only push the scroll wider.
const TH = [
  ['view', 'View', 'col-view'],
  ['name', 'Company', 'col-name'],
  [null, 'Industry', 'col-ind'],
  ['quarter', 'Quarter', 'col-quarter'],
  ['tier', 'Tier', 'col-tier'],
  [null, 'Potential', 'col-setup'],
  ['mcap', 'Mkt cap', 'r'],
  ['price', 'Price', 'r'],
  ['d10', '10W', 'r'],
  ['d20', '20W', 'r'],
  ['d40', '40W', 'r'],
  [null, 'Thesis', 'col-thesis'],
];

export function tableHTML(rows, sort, redundant) {
  const s = sort || {};
  const hide = redundant || {};
  // Hidden by class rather than by omitting cells: the column count stays fixed, so
  // nth-child widths and the sticky first columns keep working untouched.
  const hidden = ['view', 'quarter', 'tier'].filter((k) => hide[k]).map((k) => `hide-${k}`).join(' ');
  const head = TH.map(([key, label, cls]) => {
    const classes = [cls, key ? 'sortable' : '', key && key === s.key ? 'sorted' : ''].filter(Boolean).join(' ');
    const attrs = key ? ` data-sort="${key}" aria-sort="${key === s.key ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"` : '';
    const arrow = key && key === s.key ? `<span class="th-dir" aria-hidden="true">${s.dir === 'asc' ? '▲' : '▼'}</span>` : '';
    return `<th${classes ? ` class="${classes}"` : ''}${attrs}>${key ? `<button type="button" class="th-btn">${label}${arrow}</button>` : label}</th>`;
  }).join('');
  return `<div class="tblwrap"><table class="tbl${hidden ? ' ' + hidden : ''}">
      <thead><tr>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

// Table density on a phone: the 11-column table needs a sideways swipe per row
// at 390px, so a compact row carries the same fields without one.
export function compactRowHTML(c, e, redundant) {
  const hide = redundant || {};
  const vs = vslug(e.view);
  const r = c.ema || {};
  let near = '';
  if (r.dist) {
    // Always the same EMA down the whole list. Picking whichever the price happened
    // to be nearest put "10W +5.2%", "20W +1.7%" and "40W -3.6%" in one column,
    // colour-coded against each other though they measure different things. 40W
    // leads because it is the trend anchor; the shorter ones are only a fallback.
    const w = ['40W', '20W', '10W'].find((k) => r.dist[k] != null);
    if (w) {
      const d = r.dist[w], up = d >= 0;
      near = `<span class="c-ema ${up ? 'up' : 'down'}">${w} ${up ? '▲' : '▼'}${Math.abs(d).toFixed(1)}%</span>`;
    }
  }
  const sub = [
    hide.quarter ? '' : `<span class="c-q">${esc(e.quarter || '')}</span>`,
    hide.tier || !e.tier ? '' : esc(e.tier),
  ].filter(Boolean).join(' · ');
  return `<div class="crow view-${vs}" id="c-${esc(c.slug)}" data-slug="${esc(c.slug)}">
      <span class="c-gly" aria-hidden="true">${VIEW_GLYPH[e.view] || ''}</span>
      <span class="c-id">
        <a class="c-nm" href="/company/${esc(c.slug)}/">${esc(c.name)}</a>
        ${sub ? `<span class="c-sub">${sub}</span>` : ''}
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
  const ranked = companies
    .map((c) => ({ c, e: latestEntry(c) }))
    .filter(({ e }) => e)
    .sort((a, b) =>
      (viewRank(a.e.view) - viewRank(b.e.view)) ||
      (quarterKey(b.e.quarter) - quarterKey(a.e.quarter)) ||
      ((b.c.marketCap || 0) - (a.c.marketCap || 0)));
  // Computed over the WHOLE book, not the first page — the client recomputes over
  // its full filtered set, and the two must agree or the SSR'd rows reflow on load.
  const redundant = redundantFields(ranked.map(({ c }) => c));
  return (limit ? ranked.slice(0, limit) : ranked)
    .map(({ c, e }) => rowHTML(c, e, redundant))
    .join('');
}

// The price date shared by the whole book, or null when prices are genuinely spread.
// A single outlier does not break it — that company dates itself on its own card.
export function commonAsOf(companies) {
  const tally = {};
  let total = 0;
  for (const c of companies) {
    const d = c.ema && c.ema.asOf;
    if (!d) continue;
    tally[d] = (tally[d] || 0) + 1;
    total++;
  }
  const best = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
  // "Most of the book" rather than "all of it": one stale refresh must not put the
  // date back on 119 other cards.
  return best && tally[best] / total > 0.8 ? best : null;
}

// Which of the scannable fields carry no information for THIS set of companies.
// On the default sort every row reads "Positive", "Tier 1" and "Q1 2027" — three
// badges, three columns and a subtitle line spent saying the same thing 24 times.
// A field is redundant only when every company shares one value AND there is more
// than one company: a single row is not a pattern, and hiding its tier would just
// lose the fact. Computed over the whole result set rather than the visible page,
// so paging never changes which badges appear.
export function redundantFields(companies) {
  const same = (of) => {
    if (companies.length < 2) return false;
    let first;
    for (let i = 0; i < companies.length; i++) {
      const v = of(companies[i]);
      if (v == null || v === '') return false;
      if (i === 0) first = v;
      else if (v !== first) return false;
    }
    return true;
  };
  const q = (c) => c._latest || latestEntry(c);
  return {
    tier: same((c) => { const e = q(c); return e && (e.tier || c.tier); }),
    quarter: same((c) => { const e = q(c); return e && e.quarter; }),
    view: same((c) => { const e = q(c); return e && e.view; }),
    asOf: commonAsOf(companies),
  };
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
// The fifth entry names the compounded fields on the quarter entry. Operating
// profit maps to EBITDA because that is what Screener publishes; PAT has no
// compounded column, so its CAGR cells show a dash.
const GROWTH_ROWS = [
  ['sales', 'Sales', 'SALES', true, ['salesCagr3y', 'salesCagr5y']],
  ['opProfit', 'Operating profit', 'OP PROFIT', false, ['ebitdaCagr3y', 'ebitdaCagr5y']],
  ['eps', 'EPS', 'EPS', false, ['epsCagr3y', 'epsCagr5y']],
  ['pat', 'PAT', 'PAT', true, [null, null]],
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
  // The 3-year CAGR is the score's growth axis, so it is coloured like YoY; the
  // 5-year column is muted, a durability reference rather than the live signal.
  // Both columns drop out entirely when nothing is recorded, so the table never
  // shows a pair of empty columns.
  const hasCagr = GROWTH_ROWS.some(([, , , , f]) => f[0] && e[f[0]] != null);
  const rows = GROWTH_ROWS.map(([key, label, , tierRow, cagrFields]) => {
    const v = g[key] || {};
    const yoyCell = (n) => (n == null
      ? '<td><span class="v flat-n">—</span></td>'
      : `<td><span class="v ${sgn(n)}"><span class="arw">${arw(n)}</span> ${pct(n)}</span></td>`);
    const qoqCell = (n) => (n == null
      ? '<td class="qoq"><span class="v flat-n">—</span></td>'
      : `<td class="qoq"><span class="v seq">${pct(n)}</span></td>`);
    const cagrCell = (n, muted) => (n == null
      ? `<td class="cagr${muted ? ' c5' : ''}"><span class="v flat-n">—</span></td>`
      : `<td class="cagr${muted ? ' c5' : ''}"><span class="v ${muted ? 'seq' : sgn(n)}">${pct(n)}</span></td>`);
    const cagrCells = hasCagr
      ? cagrCell(cagrFields[0] ? e[cagrFields[0]] : null, false)
        + cagrCell(cagrFields[1] ? e[cagrFields[1]] : null, true)
      : '';
    return `<tr${tierRow ? ' class="hi"' : ''}><th class="m">${label}</th>${yoyCell(v.yoy)}${qoqCell(v.qoq)}${cagrCells}</tr>`;
  }).join('');
  return `<section class="panel dt-growth">${head}
      <div class="gm-wrap"><table class="gmatrix">
        <thead><tr><th class="m">Metric</th>
          <th>This year vs last<span class="gm-vs">YoY · vs ${esc(yoyQuarterLabel(e.quarter) || '—')}</span></th>
          <th class="qoq">vs the quarter before<span class="gm-vs">QoQ<span class="gm-seq">, sequential</span> · vs ${esc(prevQuarterLabel(e.quarter) || '—')}</span></th>
          ${hasCagr ? `<th class="cagr">3-year yearly average<span class="gm-vs gm-comp">3Y CAGR · compounded</span></th>
          <th class="cagr c5">5-year yearly average<span class="gm-vs gm-comp">5Y CAGR · compounded</span></th>` : ''}
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
