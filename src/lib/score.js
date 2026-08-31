// Multibagger Setup Score — how much of a company's delivered earnings growth the
// market has NOT paid for yet. Pure and derived: nothing here is stored, so the
// score can never go stale against the daily price refresh.
//
// The whole thing rests on one identity: Price = EPS x Multiple, so a price move
// is (EPS growth) x (multiple change). Rearranged, the multiple change falls out
// of two things we already have — which is why the absolute P/E is never needed:
//
//     dMultiple = (1 + price return) / (1 + growth)
//
// measured over the same window the growth is — three years where a 3-year return
// is stored, one year where it is not. See multipleChange().

const GROWTH_CAP = 60;      // above this a rate is a base reset, not compounding
// A 3-year CAGR this high still means earnings restarted from near zero (GVT&D
// printed 490%). The bar is lower than the quarterly one because three years of
// compounding cannot be a single lumpy quarter.
const CAGR_BASE_EFFECT = 100;
// How far the latest quarter has to diverge from the 3-year record before the
// disagreement is information rather than noise.
const DIVERGENCE = 30;
// "Multibaggers only happen when there is a valuation multiple rerating + HIGH
// earnings growth." Cheapness alone was reaching the top bands on 3% growth — the
// image's own Q2 Hope Trade scored 82. Below this bar a company is not a
// multibagger candidate no matter how cheap, so the BAND is capped (the score is
// left intact and the reason exposed, so the cap is explainable rather than magic).
const MIN_GROWTH = 15;
const COLLAPSE_FLOOR = -80; // below this the multiple ratio divides by ~zero
// How far above its yardstick a P/E must sit before "still expensive" is a fair
// claim. Half of any set is above its own average, so firing at 1.0 condemned
// half the book on rounding errors.
const PRICED_IN_MARGIN = 1.20;
// Two different jobs, so two thresholds. ANCHOR caps level marks as the multiple
// climbs — a smooth taper, so "0.60x its own average" at 119x earnings cannot read
// as cheap. STRETCH_FLAG is the warning, set well above it: this book's median P/E
// is ~53x, so flagging at 60 would mark 42% of companies and carry no information.
const ABSOLUTE_ANCHOR = 60;
const STRETCH_FLAG = 90;
// The most a growth rate can justify paying, used to cap the re-rating TARGET the
// 3-year projection aims at. PEG 1 — a 30% grower supports 30x — is the oldest
// rule of thumb there is, and it is here because a company's own P/E history stops
// being a target the moment the earnings underneath it were abnormal.
const PEG_FAIR = 1;

// The multiple the 3-year projection aims at. A company's own average is the
// starting point, but past STRETCH_FLAG that average is not a valuation the market
// chose — it is a near-zero denominator — so it is capped at what the growth rate
// supports. Both the outlook and priceWindow() aim at this same target, or the panel
// would quote two different "own average" prices.
function rerateTarget(peAvg5y, growth) {
  if (!(peAvg5y > 0)) return null;
  if (!(growth > 0) || peAvg5y <= STRETCH_FLAG) return peAvg5y;
  return Math.min(peAvg5y, growth * PEG_FAIR);
}

// Sectors where reported earnings are a poor guide to value: developers book
// revenue in lumps on project completion, and financials carry the balance sheet
// as the business. For these, price-to-book is the conventional lens. The bands
// below are a sector heuristic, not a derived benchmark — there is no P/B history
// in the sheet to compare against, so this is judged in absolute terms and said
// out loud via the `earnings-lens` flag.
const ASSET_HEAVY = /real estate|bank|financ|nbfc|broking|capital market|insur|invit|reit/i;

function bookFraction(pb) {
  if (pb <= 1.0) return [1.00, 'at or below book value'];
  if (pb <= 2.0) return [0.80, 'a modest premium to book'];
  if (pb <= 3.5) return [0.55, 'a fair premium to book'];
  if (pb <= 6.0) return [0.25, 'a rich premium to book'];
  return [0.00, 'far above book value'];
}

// The growth axis. The framework measures "EARNINGS GROWTH (EPS CAGR)" over three
// years, so the 3-year figure leads and the latest quarter is only a fallback —
// one quarter said STLTECH grew 60% while its 3-year EPS CAGR was -74%.
//
// EPS alone, deliberately. min(EPS, sales, EBITDA) charged a margin-driven grower
// three times over: once by capping this axis at its sales line, again in the
// quality leg's backing test, and a third time via `not-sales-backed`. Operating
// leverage — earnings growing faster than the top line — is a real multibagger
// engine, not a disqualification. It is discounted ONCE, in earningsQuality, where
// the deduction is visible and explainable. Sales and EBITDA still travel with the
// window so that leg can read them.
function trustedGrowth(entry) {
  const backing = (eps, sales) => ({
    epsRaw: eps ?? null, salesRaw: sales ?? null,
  });
  if (entry.epsCagr3y != null) {
    const raw = entry.epsCagr3y;
    return { value: Math.min(raw, GROWTH_CAP), raw, window: '3y',
             basis: '3-year EPS CAGR', ...backing(entry.epsCagr3y, entry.salesCagr3y) };
  }
  const g = entry.growth || {};
  const raw = (g.eps || {}).yoy;
  if (raw == null) return null;
  return { value: Math.min(raw, GROWTH_CAP), raw, window: '1q',
           basis: "the latest quarter's YoY EPS growth",
           ...backing((g.eps || {}).yoy, (g.sales || {}).yoy) };
}

// The quarterly EPS figure, kept alongside so a divergence from the 3-year record
// is visible rather than silently discarded. Same line as the axis it is compared
// against, so "the quarter runs ahead of the 3-year record" compares like with like.
function quarterGrowth(entry) {
  const q = ((entry.growth || {}).eps || {}).yoy;
  return q == null ? null : Math.min(q, GROWTH_CAP);
}

// Trailing-twelve-month diluted EPS in rupees, recorded per quarter in the sheet.
// TTM rather than the quarter's own figure on purpose: annualising one quarter (x4)
// overstates a growing company's earnings, which understates its P/E and makes an
// expensive stock look cheap — the opposite of what the level check is for.
// A loss or a zero yields no P/E at all, so it returns null rather than a number.
export function epsTtmFor(entry) {
  const v = entry && entry.epsTtmRs;
  return v > 0 ? { value: Number(v), approx: false } : null;
}

// Size decides the ODDS of a multibagger, not the strength of its case: tripling a
// Rs 2.66 lakh cr company means the market finding Rs 5.3 lakh cr of new value, and
// no amount of cheapness changes that arithmetic. It is therefore reported and
// flagged, never scored — folding it into the number would let a market cap quietly
// overwrite the earnings and valuation work, and the score would stop meaning
// "how strong is the case".
const SIZE_BUCKETS = [
  [1000, 'micro', 'micro-cap'],
  [7500, 'small', 'small-cap'],
  [30000, 'mid', 'mid-cap'],
  [100000, 'large', 'large-cap'],
  [Infinity, 'mega', 'mega-cap'],
];
// Above this a triple has to add Rs 1 lakh cr of market value — possible, but a
// different proposition from the same triple on a small-cap.
const SIZE_HEADWIND = 50000;

function sizeOf(marketCap) {
  if (!(marketCap > 0)) return null;
  const [, bucket, label] = SIZE_BUCKETS.find(([ceil]) => marketCap < ceil);
  return { marketCap, bucket, label, tripleTo: Math.round(marketCap * 3) };
}

// Flags that break one of the assumptions the 3-year projection rests on.
const OUTLOOK_BREAKERS = new Set([
  'base-effect', 'falling-knife', 'not-sales-backed', 'earnings-collapse',
]);

const QUADRANTS = {
  Q1: { key: 'Q1', name: 'The Multibagger',    axis: 'growth \u2191 \u00b7 multiple \u2191' },
  Q2: { key: 'Q2', name: 'The Hope Trade',     axis: 'growth \u2193 \u00b7 multiple \u2191' },
  Q3: { key: 'Q3', name: 'The Treadmill',      axis: 'growth \u2191 \u00b7 multiple \u2193' },
  Q4: { key: 'Q4', name: 'The Double Whammy',  axis: 'growth \u2193 \u00b7 multiple \u2193' },
};

// The strength of the CASE for this company, and nothing more. "Case" is chosen
// deliberately: it names an argument you still have to check rather than a
// forecast, and it is reason-agnostic — 64% of low-band companies are there for
// lack of growth rather than for price, so a price-flavoured ladder ("fully paid",
// "overpaid") would mislabel most of them.
//
// Says nothing about which quadrant. Conflating the two produced nonsense like
// calling a de-rated company "late to the re-rate".
// One word each. The panel heading and the filter's "All potential" placeholder
// carry the noun, so the badge does not have to repeat it on every row.
// Floors are set from the live distribution, not from round numbers. At 80/65/48/30
// the median company scored 47 and the whole book topped out at 82: 93% of it fell
// into THIN or below, and the top rung of verdictFor (s >= 85) could not fire on
// anything real. Re-measured against the five-leg score, these floors make STRONG a
// shortlist (~8 of 109) and FAIR a watchlist (~16 more).
// The ladder has to order itself: "Fair" above "Moderate" only reads as an order to
// someone who knows the scale, and "No case" read as missing data rather than as a
// judgement — which the separate "Not enough data" filter option actually is.
export const BANDS = {
  STRONG: { min: 75, label: 'Strong' },
  FAIR:   { min: 65, label: 'Good' },
  THIN:   { min: 50, label: 'Average' },
  WEAK:   { min: 32, label: 'Weak' },
  NONE:   { min: 0,  label: 'Poor' },
};

export function bandFor(s) {
  for (const [key, b] of Object.entries(BANDS)) if (s >= b.min) return key;
  return 'NONE';
}

// Caps the SCORE when the earnings engine is missing, rather than relabelling the
// band underneath an unchanged number. Capping only the band left ACE showing 74
// beside the word "Fair" — fine while the list printed the band alone, a plain
// contradiction once the score sits next to it. Ceilings are one below the next
// band's floor, so bandFor(score) then agrees with the label by construction.
const BAND_CEILING = { THIN: BANDS.FAIR.min - 1, WEAK: BANDS.THIN.min - 1 };
function applyGate(score, growth) {
  if (!(growth > 0))
    return [Math.min(score, BAND_CEILING.WEAK),
      'earnings are not growing over the measured window'];
  if (growth < MIN_GROWTH)
    return [Math.min(score, BAND_CEILING.THIN),
      `growth of ${growth.toFixed(1)}% is below the ${MIN_GROWTH}% bar a re-rate needs`];
  return [score, null];
}

// The multiple change, measured over the same window the growth rate is. Dividing
// a ONE-year price return by a THREE-year CAGR only holds if the trailing year
// happened to grow at the CAGR; where ret3y is stored, the identity can run over
// its own window instead:
//
//     dMultiple(3y) = (1 + 3-year return) / (1 + CAGR)^3
//
// The result is annualised back to a per-year figure so the unpaidGrowth bands —
// calibrated on a one-year move — keep meaning the same thing either way.
// A stock down ~100% drives the numerator to zero, so the 3-year form is skipped
// rather than quoted; a quarterly growth rate is never cubed, because it was never
// a three-year rate.
function multipleChange(growth, pxMove, ret3y) {
  const denom1 = 1 + growth / 100;
  if (ret3y != null && denom1 > 0) {
    const full = (1 + ret3y / 100) / Math.pow(denom1, 3);
    if (full > 0) return { annual: Math.cbrt(full), full, window: '3y' };
  }
  const full = (1 + pxMove / 100) / denom1;
  return { annual: full, full, window: '1y' };
}

function quadrantFor(growth, deltaMultiple) {
  const up = growth > 0, rerate = deltaMultiple > 1;
  if (up && rerate) return QUADRANTS.Q1;
  if (!up && rerate) return QUADRANTS.Q2;
  if (up && !rerate) return QUADRANTS.Q3;
  return QUADRANTS.Q4;
}

// The valuation half of the score is 50 points, split because it answers two
// different questions. LEVEL asks "is this cheap right now" — the one that finds
// a company the market has not looked at yet. CHANGE asks "how did the multiple
// move over the year". Level carries more weight: a stock can be at a fraction of
// its historical multiple while that multiple drifted up this year, and the old
// single-component version scored that badly (BORORENEW sat at 0.20x its own
// average and scored 47).
// Trimmed from 30/20 when capital efficiency joined: the valuation half gives up
// 10 points so the five legs still total 100. The 5:3 ratio between them is kept —
// level still carries more, for the reason above.
const LEVEL_MAX = 25, UNPAID_MAX = 15;

// How cheap, as a fraction of a yardstick. 1.0 means trading exactly at it.
function levelFraction(ratio) {
  if (ratio <= 0.60) return [1.00, 'deeply below'];
  if (ratio <= 0.80) return [0.85, 'well below'];
  if (ratio <= 1.00) return [0.65, 'below'];
  if (ratio <= 1.20) return [0.40, 'about level with'];
  if (ratio <= 1.50) return [0.15, 'above'];
  return [0.00, 'far above'];
}

// How cheap the multiple is relative to the growth behind it. A low multiple on
// fast growth is cheap even when it sits above the company's own past — IMFA at
// 14x growing 35% scored WEAK before this leg existed, purely on the ratio.
function pegFraction(pe, growth) {
  if (!(growth > 0)) return null;
  const peg = pe / growth;
  if (peg <= 0.50) return [1.00, 'very cheap for its growth'];
  if (peg <= 0.80) return [0.85, 'cheap for its growth'];
  if (peg <= 1.20) return [0.60, 'fair for its growth'];
  if (peg <= 2.00) return [0.30, 'dear for its growth'];
  return [0.00, 'expensive for its growth'];
}

// A1 · Valuation level (0-30). Three lenses, because no single one is enough: its
// own 5-year average (sector-neutral, the heaviest), its industry (keeps a
// developer away from speciality chemicals), and PEG (relates the multiple to the
// growth paying for it). Weights renormalise over whichever are available, the
// same way Confirmation does. A multiple that is high in absolute terms is then
// capped, so "cheap versus its own inflated past" cannot earn full marks.
// peFwd is the framework's "starting forward multiple" — what an entry actually
// pays for next year's earnings. It drives PEG and the absolute anchor. The RATIO
// legs stay on trailing P/E because peAvg5y and peIndustry are trailing figures;
// mixing the two would make every grower look cheap by a factor of (1 + growth).
function valuationLevel(pe, peFwd, peAvg5y, peIndustry, growth, industry, bvps, price) {
  // "FALLING P/E ON FALLING EPS IS NOT CHEAP" — the framework's own tell for Q4.
  // A low multiple on shrinking earnings is not a discount, it is a warning.
  if (!(growth > 0)) {
    return { points: 0, ratio: null, basis: 'its shrinking earnings', value: null, peg: null,
      why: 'earnings are not growing — a low multiple here is not a discount' };
  }
  // Asset-heavy first: a P/E reading here is noise, so book value takes over
  // entirely rather than being blended with a number that does not mean anything.
  if (ASSET_HEAVY.test(industry || '') && bvps > 0 && price > 0) {
    const pb = price / bvps;
    const [frac, word] = bookFraction(pb);
    return {
      points: Math.round(LEVEL_MAX * frac),
      ratio: pb, basis: 'its book value', value: bvps, peg: null, lens: 'book',
      why: `P/B ${pb.toFixed(1)}× — ${word}; earnings are lumpy in this sector so P/E is set aside`,
    };
  }
  const legs = [];
  if (pe > 0 && peAvg5y > 0) legs.push({ w: 0.5, ratio: pe / peAvg5y, basis: 'its own 5-year average', value: peAvg5y });
  if (pe > 0 && peIndustry > 0) legs.push({ w: 0.2, ratio: pe / peIndustry, basis: 'its industry', value: peIndustry });
  const peg = peFwd > 0 ? pegFraction(peFwd, growth) : null;
  if (peg) legs.push({ w: 0.3, peg: true, frac: peg[0], word: peg[1] });
  if (!legs.length) return null;

  const wsum = legs.reduce((a, l) => a + l.w, 0);
  let frac = 0;
  for (const l of legs) frac += (l.w / wsum) * (l.peg ? l.frac : levelFraction(l.ratio)[0]);

  // absolute anchor: a stretched multiple cannot score full level marks
  const stretch = (peFwd > 0 ? peFwd : pe) / ABSOLUTE_ANCHOR;
  if (stretch > 1) frac = Math.min(frac, 1 / stretch);

  const primary = legs.find((l) => !l.peg);
  const [, word] = primary ? levelFraction(primary.ratio) : [null, null];
  return {
    points: Math.round(LEVEL_MAX * frac),
    ratio: primary ? primary.ratio : null,
    basis: primary ? primary.basis : 'its growth rate',
    value: primary ? primary.value : null,
    peg: (peFwd > 0 && growth > 0) ? peFwd / growth : null,
    why: primary
      ? `P/E ${pe.toFixed(0)}× is ${primary.ratio.toFixed(2)}× ${primary.basis} `
        + `of ${primary.value.toFixed(0)}× — ${word} it`
        + (peg ? `; forward PEG ${(peFwd / growth).toFixed(2)} — ${peg[1]}` : '')
      : `P/E ${pe.toFixed(0)}× — forward PEG ${(peFwd / growth).toFixed(2)}, ${peg[1]}`,
  };
}

// A2 · Unpaid growth (0-20) — has the market paid for this growth over the year?
function unpaidGrowth(dm, max = UNPAID_MAX) {
  const f = (x) => Math.round(max * x);
  if (dm <= 0.70) return [f(1.00), 'market has paid for none of it'];
  if (dm <= 0.85) return [f(0.84), 'mostly unpaid'];
  if (dm <= 1.00) return [f(0.64), 'slight de-rate'];
  if (dm <= 1.20) return [f(0.40), 'multiple flat'];
  if (dm <= 1.60) return [f(0.16), 're-rate underway — late'];
  return [0, 'already re-rated'];
}

// B · Earnings quality (0-30) — is the growth real and repeatable? Reasons are
// returned deductions-first so the UI shows what went wrong, not what went right.
function earningsQuality(eps, sales, epsQoq) {
  let pts = 0;
  const good = [], bad = [];

  // The backing test compares how fast EPS grew against sales, so it only means
  // anything when EPS actually grew. A negative ratio (EPS down, sales up) used to
  // slip through the `<= 1.2` branch and collect full marks.
  if (eps <= 0) {
    bad.push('EPS fell year-on-year');
  } else if (sales > 0) {
    const ratio = eps / sales;
    if (ratio <= 1.2) { pts += 15; good.push('EPS fully backed by sales'); }
    else if (ratio <= 2.0) { pts += 11; good.push('mostly sales-backed'); }
    else if (ratio <= 4.0) { pts += 6; bad.push('margin-assisted'); }
    else { pts += 2; bad.push('margin/one-off driven'); }
  } else {
    bad.push('sales not growing');
  }

  if (epsQoq == null) pts += 5;                                        // unknown, not punished
  else if (epsQoq >= 0) { pts += 10; good.push('QoQ holding'); }
  else if (epsQoq >= -15) pts += 7;
  else if (epsQoq >= -40) { pts += 4; bad.push('QoQ softening'); }
  else bad.push('QoQ collapsed — a spike, not a trend');

  if (eps <= 0) { /* no credit for a decline */ }
  else if (eps <= 60) pts += 5;
  else if (eps <= 150) pts += 3;
  else bad.push('growth rate not repeatable');

  return [pts, [...bad, ...good]];
}

// D · Capital efficiency (0-10) — what the business earns on its own book. The
// strongest empirical multibagger marker is a high return on capital with somewhere
// to reinvest it, and the input was already in the sheet: epsTtmRs / bvps is an
// implied ROE, recorded for 125 of 127 companies. Without this leg a 3%-on-book
// compounder and a 71%-on-book one were separated only by their multiples.
//
// A missing book value is unknown, not bad — the same treatment QoQ gets, so a
// thin sheet costs a company the difference rather than the whole leg.
const EFFICIENCY_MAX = 10;
// Above this the ratio says more about the book than about the business: buybacks,
// write-offs and asset-light models all shrink the denominator. Full marks stand —
// the earnings are real — but the flag says why the number looks extraordinary.
const THIN_BOOK = 80;

function capitalEfficiency(roe) {
  if (roe == null) return [4, 'no book value recorded — return on capital unknown'];
  if (roe >= 25) return [10, `earns ${roe.toFixed(0)}% on its own book — high`];
  if (roe >= 18) return [8, `earns ${roe.toFixed(0)}% on its own book — good`];
  if (roe >= 12) return [5, `earns ${roe.toFixed(0)}% on its own book — fair`];
  if (roe >= 8) return [2, `earns ${roe.toFixed(0)}% on its own book — thin`];
  if (roe > 0) return [0, `earns only ${roe.toFixed(0)}% on its own book`];
  return [0, 'earns nothing on its book'];
}

// C · Confirmation (0-20) — is the market starting to agree? This is the only leg
// that separates a coiled spring from a falling knife; in A they look identical.
// 12 points come from the EMA structure and 8 are reserved for the concall verdict.
// While that verdict is unwired, C rescales over the legs it HAS, so the bands mean
// the same thing before and after it lands.
const EMA_MAX = 12, CONCALL_MAX = 8, C_MAX = EMA_MAX + CONCALL_MAX;

function confirmation(dist) {
  const ws = ['10W', '20W', '40W'].map((w) => dist[w]);
  if (ws.some((d) => d == null)) return [0, 'partial price data', true];
  const above = ws.filter((d) => d >= 0).length;
  if (above === 3) return [EMA_MAX, 'above all three EMAs — accumulation', false];
  if (above === 0) return [0, 'below all three EMAs — falling knife', false];
  if (dist['40W'] >= 0) return [8, 'above 40W, below the shorter EMAs', false];
  return [5, 'mixed EMA structure', false];
}

// Keyed to the band rather than to thresholds of its own. The two ladders drifted
// apart — the top rung sat at 85 while the book topped out at 82, so the sentence a
// reader most wanted to see could never appear. Deriving it from bandFor means every
// rung is reachable by construction, and moving a band floor moves both together.
function verdictFor(quadrant, s, flags) {
  const keys = flags.map((f) => f.key);
  if (keys.includes('base-effect'))
    return "Growth rate is a one-off base reset — the score can't be trusted. Check next quarter.";
  if (keys.includes('falling-knife'))
    return 'De-rating while below every EMA — value-trap risk, not a coiled spring.';
  const band = bandFor(s);
  if (quadrant.key === 'Q3') {
    if (band === 'STRONG') return "Earnings delivered, market hasn't paid yet. The pre-re-rate zone — read the concall.";
    if (band === 'FAIR') return 'Growth still unpaid, one leg weaker. Worth the concall read.';
    if (band === 'THIN') return 'Unpaid, but the growth quality is thin. Verify before acting.';
    return 'Cheap for a reason — the de-rate looks earned.';
  }
  if (quadrant.key === 'Q1')
    return (band === 'STRONG' || band === 'FAIR')
      ? "Both engines fired — but you're buying after the re-rate."
      : "Re-rated already, on growth that doesn't fully back it.";
  if (quadrant.key === 'Q2') return 'Multiple moved without the earnings — the return sits in sentiment.';
  return 'Both engines in reverse.';
}

/**
 * @param entry  a company's quarter entry from companies.json
 * @param ema    that company's record from emas.json (or null)
 * Returns either { insufficient, reason } or the full scorecard. The 100 companies
 * still on a quarter with no growth columns get the former — an honest blank beats
 * a number built on nothing.
 */
export function score(entry, ema, ctx = {}) {
  // Industry drives the valuation lens. It lives on the company rather than the
  // quarter, so callers pass it through; entry.industry is accepted too for tests.
  const company_industry = ctx.industry ?? entry.industry ?? null;
  // Market cap lives on the company too, and is reported rather than scored.
  const size = sizeOf(ctx.marketCap ?? entry.marketCap ?? null);
  const g = (entry && entry.growth) || {};
  const eps = (g.eps || {}).yoy, epsQoq = (g.eps || {}).qoq;
  const sales = (g.sales || {}).yoy, op = (g.opProfit || {}).yoy;

  if (eps == null || sales == null) return { insufficient: true, reason: 'no growth columns for this quarter' };
  if (!ema || !ema.dist) return { insufficient: true, reason: 'no price data' };

  // Real 1-yr return once the price job stores it; until then the distance from the
  // 40-week EMA stands in, and `proxy` says so out loud.
  const proxy = ema.ret1y == null;
  const pxMove = proxy ? ema.dist['40W'] : ema.ret1y;
  if (pxMove == null) return { insufficient: true, reason: 'no price history' };

  const tg = trustedGrowth(entry);
  if (!tg) return { insufficient: true, reason: 'no growth figures for this quarter' };
  const growth = tg.value;
  const growthQuarter = quarterGrowth(entry);
  const mc = multipleChange(growth, pxMove, tg.window === '3y' ? ema.ret3y : null);
  const deltaMultiple = mc.annual, deltaMultipleFull = mc.full, multipleWindow = mc.window;

  const pe = (ctx.epsTtm > 0 && ema.price != null) ? ema.price / ctx.epsTtm : null;
  // The multiple at the START of the measured window — three years back where the
  // 3-year return carried it, one year back otherwise.
  const peThen = pe != null ? pe / deltaMultipleFull : null;
  const assetHeavy = ASSET_HEAVY.test(company_industry || '') && entry.bvps > 0 && ema.price > 0;
  const peForward = (pe != null && growth > 0) ? pe / (1 + growth / 100) : null;
  const valuation = (pe != null || assetHeavy)
    ? valuationLevel(pe, peForward, entry.peAvg5y, entry.peIndustry, growth,
                     company_industry, entry.bvps, ema.price)
    : null;

  // With no P/E to judge, the change carries the whole valuation half rather than
  // silently costing the company the level points it had no chance to earn.
  const [unpaid, unpaidWhy] = unpaidGrowth(deltaMultiple,
    valuation ? UNPAID_MAX : LEVEL_MAX + UNPAID_MAX);
  const level = valuation ? valuation.points : null;

  // Yardsticks in order of how much they actually mean — kept for the priced-in
  // flag and for the panel to name what it compared against.
  const peBenchmark =
    entry.peAvg5y > 0    ? { value: entry.peAvg5y, basis: 'its own 5-year average' }
    : entry.peIndustry > 0 ? { value: entry.peIndustry, basis: 'its industry' }
    : null;
  const peRatio = (pe != null && peBenchmark != null) ? pe / peBenchmark.value : null;
  // A historical average is only a credible re-rating TARGET while the earnings that
  // produced it were normal. BHEL averaged 130x for five years because profit was
  // near zero — projecting a return to 130x prices in the collapse, not the recovery,
  // and put a x5.5 headline on a mega-cap. So the target is capped at the multiple the
  // growth rate itself supports (PEG 1), while peBenchmark stays untouched as the
  // historical fact the level component and the priced-in flag read.
  // Only where the average is extreme in absolute terms: past STRETCH_FLAG a
  // five-year average P/E is not a valuation the market chose, it is a near-zero
  // denominator. An ordinary rich multiple — 30x on a 20% grower — is left alone,
  // because capping that would quietly de-rate most of the book.
  const peTarget = peBenchmark == null ? null
    : (rerateTarget(peBenchmark.value, growth) ?? peBenchmark.value);
  const peTargetCapped = peTarget != null && peTarget < peBenchmark.value;
  // The level component already withholds points for an expensive multiple, so this
  // no longer caps anything — it stays as a warning that the earnings are merely
  // catching up to a price the market already paid.
  const pricedIn = peRatio != null && deltaMultiple < 1 && peRatio > PRICED_IN_MARGIN;

  // Backing is judged over the window the growth axis came from — comparing a
  // 3-year EPS CAGR against a single quarter's sales line reads the wrong pair.
  const [quality, qualityWhy] = earningsQuality(tg.epsRaw ?? eps, tg.salesRaw ?? sales, epsQoq);
  const [emaPts, confWhy] = confirmation(ema.dist);
  const confirm = Math.round(emaPts * (C_MAX / EMA_MAX));

  // Implied return on book. Null — not zero — when there is no book to divide by,
  // so "unknown" and "earns nothing" stay distinguishable.
  const roe = (entry.bvps > 0 && entry.epsTtmRs != null)
    ? Number(((entry.epsTtmRs / entry.bvps) * 100).toFixed(1)) : null;
  const [efficiency, efficiencyWhy] = capitalEfficiency(roe);

  // The forward view — the point of the whole panel. Return = dEPS x dMultiple, run
  // over the framework's own three-year horizon:
  //
  //     return = (1 + CAGR)^3  x  (target multiple / current multiple)
  //
  // Trailing P/E on both sides, because the target (a 5-year average) is trailing;
  // mixing a forward entry with a trailing target invents a discount.
  //
  // This is NOT a probability. It states what has to be true — a growth rate that
  // persists and a multiple that returns to its own average — and inverts it to
  // name the multiple a double or a triple would demand. Whether that multiple is
  // precedented is then a fact about the company's history, not a guess.
  const canProject = pe > 0 && peBenchmark != null && growth > 0
    && !(valuation && valuation.lens === 'book');
  const dEps3 = canProject ? Math.pow(1 + growth / 100, 3) : null;
  const outlook3y = canProject ? (peTarget / pe) * dEps3 - 1 : null;
  const needFor2x = canProject ? (2 * pe) / dEps3 : null;
  const needFor3x = canProject ? (3 * pe) / dEps3 : null;

  // The 5-year P/E range (fetched, see scripts/pe/fetch_pe_history.py) turns a soft
  // comparison into a fact: a triple needing 31x is a different proposition when the
  // company has traded at 57x than when it has never passed 45x. Report-only on
  // purpose — it must not move the score, or a change to Screener's undocumented
  // chart API would silently re-band the book overnight.
  const peRange = (ctx.peRange && ctx.peRange.high > 0) ? ctx.peRange : null;
  const precedented = (need) =>
    (peRange == null || need == null) ? null : need <= peRange.high;
  // One-year version, kept for the shorter-horizon read.
  const headroom = canProject ? (peTarget / pe) * (1 + growth / 100) - 1 : null;

  const raw = Math.min(100, (level || 0) + unpaid + quality + confirm + efficiency);
  const [total, gate] = applyGate(raw, growth);
  const quadrant = quadrantFor(growth, deltaMultiple);

  const flags = [];
  if (tg.window === '3y' ? (tg.raw > CAGR_BASE_EFFECT) : (eps > 200))
    flags.push({ key: 'base-effect', label: 'base effect',
      detail: tg.window === '3y'
        ? `a ${Math.round(tg.raw)}% 3-year CAGR means earnings restarted from near zero`
        : `EPS +${Math.round(eps)}% is a base reset, not a compounding rate` });
  if (tg.window === '1q')
    flags.push({ key: 'short-history', label: 'short history',
      detail: 'no 3-year CAGR recorded, so the growth axis falls back to one quarter' });
  if (tg.window === '3y' && growthQuarter != null) {
    const gap = growthQuarter - growth;
    if (gap >= DIVERGENCE)
      flags.push({ key: 'inflection', label: 'inflection',
        detail: `the latest quarter (+${growthQuarter.toFixed(0)}%) runs well ahead of the `
          + `3-year record (${growth.toFixed(0)}%) — a turn, or a one-off` });
    else if (-gap >= DIVERGENCE)
      flags.push({ key: 'fading', label: 'fading',
        detail: `the latest quarter (+${growthQuarter.toFixed(0)}%) trails the 3-year record `
          + `(${growth.toFixed(0)}%) — the good run may be ending` });
  }
  const backEps = tg.epsRaw ?? eps, backSales = tg.salesRaw ?? sales;
  if (backSales > 0 && backEps > 0 && backEps / backSales > 2.5)
    flags.push({ key: 'not-sales-backed', label: 'EPS not sales-backed',
      detail: 'earnings growth is margin or one-off driven' });
  if (emaPts === 0 && deltaMultiple < 1)
    flags.push({ key: 'falling-knife', label: 'falling knife',
      detail: 'de-rating while below every EMA' });
  // Near -100% growth drives (1 + g/100) toward zero, so the multiple ratio blows
  // up (Sedemac printed 467x). The quadrant still reads correctly — earnings down,
  // multiple up is a Hope Trade — but the ratio itself must not be quoted.
  if (gate && growth > 0)
    flags.push({ key: 'low-growth', label: 'low growth', detail: gate });
  if (growth <= COLLAPSE_FLOOR)
    flags.push({ key: 'earnings-collapse', label: 'earnings collapse',
      detail: `earnings fell ${Math.abs(growth).toFixed(0)}% — the multiple ratio is not `
        + 'meaningful at this base' });
  if (size && size.marketCap >= SIZE_HEADWIND)
    flags.push({ key: 'size-headwind', label: 'size is the headwind',
      detail: `a ${size.label} — tripling from here means the market finding `
        + `about Rs ${Math.round(size.marketCap * 2 / 1000)},000 cr of new value` });
  if (roe != null && roe > THIN_BOOK)
    flags.push({ key: 'thin-book', label: 'thin book',
      detail: `a ${roe.toFixed(0)}% return on book says as much about the size of the `
        + 'book as about the business — check for buybacks or written-down assets' });
  if (valuation && valuation.lens === 'book')
    flags.push({ key: 'earnings-lens', label: 'judged on book value',
      detail: 'earnings are lumpy in this sector, so price-to-book replaces P/E here' });
  if (pe != null && pe > STRETCH_FLAG && !(valuation && valuation.lens === 'book'))
    flags.push({ key: 'absolute-stretch', label: 'absolute stretch',
      detail: `P/E ${pe.toFixed(0)}× is high in absolute terms whatever its own history says` });
  if (pricedIn)
    flags.push({ key: 'priced-in', label: 'priced in',
      detail: `the multiple fell ${peThen.toFixed(0)}x → ${pe.toFixed(0)}x but is still `
        + `${((peRatio - 1) * 100).toFixed(0)}% above ${peBenchmark.value.toFixed(0)}x `
        + `(${peBenchmark.basis}) — earnings catching up to a price already paid` });

  // The projection is (peAvg5y / pe) x (1 + CAGR)^3 — a product of two uncertain
  // terms, so it runs loudest exactly where its inputs are weakest. These four flags
  // each break one of the assumptions it rests on: a base reset is not a rate that
  // compounds, margin-driven growth may not survive three years, and a de-rate below
  // every EMA is the market disagreeing with the whole premise. The number still
  // stands — this only says how far it can be leaned on.
  const outlookReliable = outlook3y == null ? null
    : !flags.some((f) => OUTLOOK_BREAKERS.has(f.key));

  return {
    score: total, scoreUncapped: raw, band: bandFor(total), gate, quadrant,
    verdict: verdictFor(quadrant, total, flags),
    deltaMultiple, deltaMultipleFull, multipleWindow,
    growth, growthBasis: tg.basis, growthWindow: tg.window,
    growthQuarter, proxy, priceMove: pxMove,
    pe, peForward, peThen, peBenchmark, peTarget, peTargetCapped, headroom,
    outlook3y, dEps3, needFor2x, needFor3x,
    peRange, precedent2x: precedented(needFor2x), precedent3x: precedented(needFor3x),
    outlookReliable,
    bvps: entry.bvps ?? null,
    pb: (entry.bvps > 0 && ema.price != null) ? ema.price / entry.bvps : null,
    valuation,
    roe, size,
    components: { level, unpaid, quality, confirmation: confirm, efficiency },
    why: {
      level: valuation ? valuation.why : 'no P/E available',
      unpaid: unpaidWhy, quality: qualityWhy, confirmation: confWhy,
      efficiency: efficiencyWhy,
    },
    max: {
      level: valuation ? LEVEL_MAX : null,
      unpaid: valuation ? UNPAID_MAX : LEVEL_MAX + UNPAID_MAX,
      quality: 30, confirmation: C_MAX, efficiency: EFFICIENCY_MAX,
    },
    flags,
  };
}

// ---- the price window -------------------------------------------------------
// The band is largely a function of price (70 of the 100 points move with it), so
// it is worth solving for WHERE it changes. That turns a static score into a price
// plan: the range over which today's band holds, and what it becomes either side.
//
// A price change scales the trailing return and every EMA distance by the same
// factor; the EMAs themselves are averages of PAST prices and do not move, which is
// what makes an instantaneous "what if the price were X" well defined.
//
// Deliberately scans rather than solves: the band is NOT monotonic in price —
// below its 40-week EMA the Confirmation component collapses and the falling-knife
// flag fires, so a cheaper price can score worse. A closed form would miss that.
function repriced(ema, k) {
  const scale = (v) => (v == null ? null : (1 + v / 100) * k * 100 - 100);
  return {
    ...ema,
    price: ema.price * k,
    ret1y: scale(ema.ret1y),
    ret3y: scale(ema.ret3y),
    dist: Object.fromEntries(Object.entries(ema.dist || {}).map(([w, d]) => [w, scale(d)])),
  };
}

export function priceWindow(entry, ema, ctx = {}) {
  if (!ema || !(ema.price > 0)) return null;
  const bandAt = (price) => {
    const r = score(entry, repriced(ema, price / ema.price), ctx);
    return r.insufficient ? null : r.band;
  };
  const now = score(entry, ema, ctx);
  if (now.insufficient) return null;
  // A gated band is held down by the growth rate, not the price — Nestle spanned
  // Rs 438 to Rs 5,772, a range that says nothing. Better to show no window than a
  // meaningless one.
  if (now.gate) return null;
  const here = now.band;

  // 0.3x to 4x of today covers every realistic re-rate; 1% steps are finer than
  // the price precision anyone acts on.
  const lo = Math.max(1, Math.round(ema.price * 0.3));
  const hi = Math.round(ema.price * 4);
  const step = Math.max(1, Math.round(ema.price * 0.01));

  let low = ema.price, high = ema.price;
  for (let p = ema.price; p >= lo; p -= step) { if (bandAt(p) !== here) break; low = p; }
  for (let p = ema.price; p <= hi; p += step) { if (bandAt(p) !== here) break; high = p; }

  const edge = (dir) => {
    for (let p = dir > 0 ? high + step : low - step;
         dir > 0 ? p <= hi : p >= lo; p += dir * step) {
      const b = bandAt(p);
      if (b && b !== here) return { price: Math.round(p), band: b };
    }
    return null;
  };
  // the price at which the multiple reaches its own yardstick — the moment the
  // "cheap versus its own past" argument is spent
  const tgw = trustedGrowth(entry);
  const targetPe = rerateTarget(entry.peAvg5y, tgw ? tgw.value : null);
  const target = targetPe > 0 && entry.epsTtmRs > 0 ? targetPe * entry.epsTtmRs : null;

  return {
    band: here,
    low: Math.round(low), high: Math.round(high),
    above: edge(+1), below: edge(-1),
    moderateAt: target ? Math.round(target) : null,
  };
}
