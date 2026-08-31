// Pure merge logic shared by the update function — mirrors scripts/import_excel.py.
// Upsert rule: new company → added; new quarter → appended to history;
// SAME company + SAME quarter → the new entry REPLACES the old one.

// Column names are resolved by header text, never by position. Keep the metric
// keys and aliases in step with GROWTH_ALIASES in scripts/import_excel.py.
const GROWTH_FIELDS = {
  sales:    { yoy: ['YoY Sales Growth', 'SalesYoY'],         qoq: ['QoQ Sales Growth', 'SalesQoQ'] },
  opProfit: { yoy: ['YoY Op Profit Growth', 'OpProfitYoY'],   qoq: ['QoQ Op Profit Growth', 'OpProfitQoQ'] },
  eps:      { yoy: ['YoY EPS Growth', 'EPSYoY'],              qoq: ['QoQ EPS Growth', 'EPSQoQ'] },
  pat:      { yoy: ['YoY PAT Growth', 'PATYoY'],              qoq: ['QoQ PAT Growth', 'PATQoQ'] },
};

// Canonical names come FROM the research workbook (Research Stock 2026.xlsx), so
// the downloadable template mirrors the sheet you actually maintain. The second
// spelling in each list is the older template naming, still accepted so sheets
// downloaded before this change keep importing.
const FIELD_ALIASES = {
  industry:  ['Industry'],
  name:      ['Company Name', 'CompanyName'],
  marketCap: ['Market Cap', 'MarketCap'],
  tier:      ['Tier'],
  tvCode:    ['TradingView Code', 'TradingViewCode'],
  view:      ['View'],
  note:      ['Note'],
  // Valuation inputs, all optional — see EXTRA_OPTIONAL below.
  epsTtmRs:     ['EPS TTM', 'EPS (TTM)', 'TTM EPS', 'EPSTTM'],
  epsCagr3y:    ['EPS growth 3Years', 'EPS CAGR 3Y', '3Y EPS CAGR'],
  epsCagr5y:    ['EPS growth 5Years', 'EPS CAGR 5Y', '5Y EPS CAGR'],
  salesCagr3y:  ['Sales growth 3Years', 'Sales CAGR 3Y', '3Y Sales CAGR'],
  salesCagr5y:  ['Sales growth 5Years', 'Sales CAGR 5Y', '5Y Sales CAGR'],
  ebitdaCagr3y: ['EBIDT growth 3Years', 'EBITDA growth 3Years', '3Y EBITDA CAGR'],
  ebitdaCagr5y: ['EBIDT growth 5Years', 'EBITDA growth 5Years', '5Y EBITDA CAGR'],
  peAvg5y:      ['5Y Avg P/E', '5Y Avg PE', '5 Year Avg PE', 'Median PE', 'Avg PE 5Y'],
  peIndustry:   ['Industry P/E', 'Industry PE', 'Sector PE'],
  bvps:         ['Book Value', 'Book Value per Share', 'BVPS'],
};

// Column order as it appears in the workbook, so a column-by-column paste lines
// up and the template reads like the sheet.
const SHEET_ORDER = [
  'Industry', 'Company Name',
  'YoY Sales Growth', 'QoQ Sales Growth',
  'YoY Op Profit Growth', 'QoQ Op Profit Growth',
  'YoY EPS Growth', 'QoQ EPS Growth',
  'YoY PAT Growth', 'QoQ PAT Growth',
  'Market Cap', 'Tier', 'TradingView Code', 'View', 'Note',
  'EPS TTM', '5Y Avg P/E', 'Industry P/E', 'Book Value',
  'EPS growth 3Years', 'EPS growth 5Years',
  'Sales growth 3Years', 'Sales growth 5Years',
  'EBIDT growth 3Years', 'EBIDT growth 5Years',
];

const nk = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');

// Row objects are keyed by the sheet's own header text, so resolve by a
// normalised form rather than an exact string.
function pick(row, aliases) {
  if (row.__nk === undefined) {
    const map = {};
    for (const k of Object.keys(row)) map[nk(k)] = row[k];
    Object.defineProperty(row, '__nk', { value: map, enumerable: false });
  }
  for (const a of aliases) {
    const v = row.__nk[nk(a)];
    if (v !== undefined) return v;
  }
  return undefined;
}

// '24.1', '24.1%', 24.1 -> 24.1 ; blank/garbage -> null (never 0)
function pctNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  if (v == null) return null;
  const t = String(v).replace(/[^0-9.\-]/g, '');
  if (t === '' || t === '-' || t === '.' || t === '-.') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function readGrowth(row) {
  const out = {};
  for (const [metric, bases] of Object.entries(GROWTH_FIELDS)) {
    const m = {};
    for (const basis of ['yoy', 'qoq']) {
      const v = pctNum(pick(row, bases[basis]));
      if (v != null) m[basis] = v;
    }
    if (Object.keys(m).length) out[metric] = m;
  }
  return Object.keys(out).length ? out : null;
}

// All three lists are derived from SHEET_ORDER, so they cannot drift apart.
const GROWTH_NAMES = new Set(Object.values(GROWTH_FIELDS).flatMap((b) => [b.yoy[0], b.qoq[0]]));
// Optional beyond the growth columns: in the template so it gets filled going
// forward, but never required, so every sheet downloaded before it existed and
// every sheet that leaves it blank still uploads.
const EXTRA_OPTIONAL = new Set(['EPS TTM', '5Y Avg P/E', 'Industry P/E', 'Book Value',
  'EPS growth 3Years', 'EPS growth 5Years', 'Sales growth 3Years', 'Sales growth 5Years',
  'EBIDT growth 3Years', 'EBIDT growth 5Years']);

// Required for a valid upload. The eight growth columns are deliberately NOT
// here — a sheet without them must still import, yielding no "growth" key, which
// the site renders as "not recorded" rather than zero.
export const REQUIRED_COLUMNS = SHEET_ORDER.filter((c) => !GROWTH_NAMES.has(c) && !EXTRA_OPTIONAL.has(c));
// What the downloadable template contains: every column, in the workbook's own order.
export const TEMPLATE_COLUMNS = SHEET_ORDER;

// Alias-aware header check for uploads: returns the canonical names that are
// missing, so a sheet spelling 'CompanyName' still satisfies 'Company Name'.
export function missingColumns(headers) {
  const seen = new Set((headers || []).map(nk));
  return REQUIRED_COLUMNS.filter((c) => {
    const field = Object.keys(FIELD_ALIASES).find((f) => FIELD_ALIASES[f].includes(c));
    const names = field ? FIELD_ALIASES[field] : [c];
    return !names.some((n) => seen.has(nk(n)));
  });
}

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
}

// The raw workbook stores Market Cap as text ('9,171.02'), the template as a
// number. Accept both; anything non-numeric becomes null.
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  if (v == null) return null;
  const t = String(v).replace(/[^0-9.\-]/g, '');
  if (t === '' || t === '-' || t === '.' || t === '-.') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const str = (v) => (v != null && String(v).trim() ? String(v).trim() : null);

/**
 * @param data   current companies.json object ({meta, companies})
 * @param rows   array of row objects keyed by sheet headers
 * @param opts   { quarter: 'Q4 2026' }
 * Returns { data, added, updated, quarterUpserts }.
 */
export function mergeRows(data, rows, { quarter }) {
  if (!quarter) throw new Error('quarter is required');
  data = data && data.companies ? data : { companies: [] };

  const byKey = new Map();
  for (const c of data.companies) byKey.set((c.tvCode || c.name).toUpperCase(), c);

  let added = 0, updated = 0, quarterUpserts = 0;
  for (const row of rows) {
    const name = str(pick(row, FIELD_ALIASES.name));
    if (!name) continue;
    const tv = str(pick(row, FIELD_ALIASES.tvCode));
    const key = String(tv || name).toUpperCase();
    const view = str(pick(row, FIELD_ALIASES.view));          // Positive / Watch / Concern / Negative
    const note = str(pick(row, FIELD_ALIASES.note));          // the note
    const tier = str(pick(row, FIELD_ALIASES.tier));
    const mcap = num(pick(row, FIELD_ALIASES.marketCap));
    const industry = str(pick(row, FIELD_ALIASES.industry));
    const growth = readGrowth(row);
    const VAL_FIELDS = ['epsTtmRs', 'peAvg5y', 'peIndustry', 'bvps',
      'epsCagr3y', 'epsCagr5y', 'salesCagr3y', 'salesCagr5y', 'ebitdaCagr3y', 'ebitdaCagr5y'];
    const vals = {};
    for (const f of VAL_FIELDS) { const v = num(pick(row, FIELD_ALIASES[f])); if (v != null) vals[f] = v; }

    let comp = byKey.get(key);
    const isNew = !comp;
    if (!comp) {
      comp = { slug: slugify(tv || name), name, tvCode: tv, industry, marketCap: mcap, tier, quarters: [] };
      data.companies.push(comp);
      byKey.set(key, comp);
    } else {
      if (mcap != null) comp.marketCap = mcap;
      if (industry) comp.industry = industry;
      if (tier) comp.tier = tier;
    }

    // Count only rows that produce a quarter entry — others are dropped below.
    if (view || note) {
      const prior = comp.quarters.find((q) => q.quarter === quarter);
      const entry = { quarter, tier, view, note: note || '' };
      if (growth) entry.growth = growth;
      Object.assign(entry, vals);
      if (prior && prior.reportUrl) entry.reportUrl = prior.reportUrl; // preserve linked report
      comp.quarters = comp.quarters.filter((q) => q.quarter !== quarter); // upsert: drop same quarter first
      comp.quarters.push(entry);
      quarterUpserts++;
      if (isNew) added++; else updated++;
    }
  }

  // keep only companies that have at least one studied quarter, sort by market cap desc
  data.companies = data.companies.filter((c) => c.quarters && c.quarters.length);
  data.companies.sort((a, b) => (a.marketCap == null ? 1 : b.marketCap == null ? -1 : b.marketCap - a.marketCap));
  return { data, added, updated, quarterUpserts };
}
