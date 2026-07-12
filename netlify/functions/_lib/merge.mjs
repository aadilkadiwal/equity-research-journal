// Pure merge logic shared by the update function — mirrors scripts/import_excel.py.
// Upsert rule: new company → added; new quarter → appended to history;
// SAME company + SAME quarter → the new entry REPLACES the old one.

// The column headers an uploaded sheet must contain. Single source of truth —
// used by update.mjs to validate uploads and by scripts/make_template.mjs to
// build the downloadable template, so the three can never drift apart.
export const REQUIRED_COLUMNS = ['CompanyName', 'Industry', 'MarketCap', 'Tier', 'TradingView Code', 'View', 'Note'];

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'x';
}

const num = (v) => (typeof v === 'number' && !Number.isNaN(v) ? Math.round(v * 100) / 100 : null);
const str = (v) => (v != null && String(v).trim() ? String(v).trim() : null);

/**
 * @param data   current companies.json object ({meta, companies})
 * @param rows   array of row objects keyed by sheet headers
 * @param opts   { quarter: 'Q1 FY27' }
 * Returns { data, added, updated, quarterUpserts }.
 */
export function mergeRows(data, rows, { quarter }) {
  if (!quarter) throw new Error('quarter is required');
  data = data && data.companies ? data : { companies: [] };

  const byKey = new Map();
  for (const c of data.companies) byKey.set((c.tvCode || c.name).toUpperCase(), c);

  let added = 0, updated = 0, quarterUpserts = 0;
  for (const row of rows) {
    const name = str(row['CompanyName']);
    if (!name) continue;
    const tv = str(row['TradingView Code']);
    const key = String(tv || name).toUpperCase();
    const view = str(row['View']);          // Positive / Watch / Concern / Negative
    const note = str(row['Note']);          // the note
    const tier = str(row['Tier']);
    const mcap = num(row['MarketCap']);
    const industry = str(row['Industry']);

    let comp = byKey.get(key);
    if (!comp) {
      comp = { slug: slugify(tv || name), name, tvCode: tv, industry, marketCap: mcap, tier, quarters: [] };
      data.companies.push(comp);
      byKey.set(key, comp);
      added++;
    } else {
      if (mcap != null) comp.marketCap = mcap;
      if (industry) comp.industry = industry;
      if (tier) comp.tier = tier;
      updated++;
    }

    if (view || note) {
      const entry = { quarter, tier, view, note: note || '' };
      comp.quarters = comp.quarters.filter((q) => q.quarter !== quarter); // upsert: drop same quarter first
      comp.quarters.push(entry);
      quarterUpserts++;
    }
  }

  // keep only companies that have at least one studied quarter, sort by market cap desc
  data.companies = data.companies.filter((c) => c.quarters && c.quarters.length);
  data.companies.sort((a, b) => (a.marketCap == null ? 1 : b.marketCap == null ? -1 : b.marketCap - a.marketCap));
  return { data, added, updated, quarterUpserts };
}
