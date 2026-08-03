# Stock Research Journal

A fast, single-page site for your personal equity-research notes — one **row** per company,
coloured by your view (Positive / Watch / Concern / Negative), searchable by name/symbol and
filterable by quarter, view, tier and industry. Only companies you've actually studied appear.
The note is shown **inline** (no clicking); each row links out to the AI **Concall report**,
TradingView and Screener.in, and carries a weekly-EMA trend panel (price, 1-day change,
10/20/40-week EMAs). Once a company has more than one quarter, an inline **"Earlier quarters"**
toggle reveals the older notes — each with its own report link — in place.

**Public read, you're the only editor. Free to host on Cloudflare Pages. Not investment advice.**

## Stack

- **Astro** — ships near-zero JS, instant loads, mobile-first, dark mode. Only the first page
  of rows is server-rendered; the client paginates the rest on load.
- **Vanilla JS** — instant substring search (company **name / symbol** only — use the dropdowns
  for industry and tier), quarter + view + tier + industry filters, EMA screening chips, sort,
  removable active-filter chips, watchlist export, and pagination (24/page desktop, 12 on
  phones). Single page, no routes.
- **TradingView / Screener.in** — deep-research links from each row.
- **`/admin`** — GitHub-login upload page: drop in a quarter's Excel sheet and it
  merges into `companies.json` and commits. Runs on Cloudflare Pages Functions
  (`functions/`). See [`ADMIN-SETUP.md`](ADMIN-SETUP.md).
- **Data** — two build-time JSON files, no backend and no database:
  `src/data/companies.json` (studied companies only, hand/`/admin`-updated each quarter) and
  `src/data/emas.json` (prices + weekly EMAs, refreshed by a daily GitHub Action).

## What's on the page

- **View summary bar + legend** — the distribution of your current views, each with its
  plain-English meaning (Positive = looks promising, Watch = keep an eye on, …).
- **"What changed in `<quarter>`"** — a collapsible digest of upgrades, downgrades and newly
  covered companies for the newest quarter. A row whose view moved also shows a
  `↕ from <View>` chip.
- **Weekly-EMA panel per row** — price, 1-day change vs the previous close, and 10W / 20W / 40W
  EMA tiles (green above the EMA, red below), each with its % distance from price.
- **EMA screening chips** — *Near an EMA (≤2%)*: `10W` / `20W` / `40W`, plus
  `⇉ Converging EMAs` (all three EMAs bunched within 5% — a weekly squeeze). Chips combine, and
  companies without price data drop out while any chip is active.
- **Sort** — View · newest first (default), Market cap, Name A–Z, Tier.
- **`⬇ Watchlist`** — downloads the currently filtered list as `NSE:SYMBOL` lines, ready to
  import into TradingView.
- **Deep links** — click a company name to copy a link to it (`#c-<slug>`); opening such a link
  resets filters, jumps to the right page and flashes the row.
- **Keyboard** — `/` focuses search, `Esc` clears it, and the dropdowns are arrow-key navigable.

## Design notes

- Brand accent is indigo — deliberately not one of the four view colours, so "selected"
  never reads as "Watch". Views also carry a glyph (▲ ● ◆ ▼) for colour-blind / grayscale.
- Rows use a faint view tint; view is the only coloured element in the header, with tier +
  market cap in one muted line. (The EMA tiles add their own green/red, scoped to price.)
  Respects `prefers-reduced-motion`.

## Tiers

Tier = the weaker of YoY Sales growth and YoY PAT growth:
Tier 1 = both ≥ 20% · Tier 2 = both ≥ 15% · Tier 3 = both ≥ 10% · Tier 4 = either < 10%.
(Explained on the site via the ⓘ tooltip in the **Tier** dropdown.)

## Local development

Node 22 (see `.nvmrc`).

```bash
npm install
npm run dev            # http://localhost:4321
npm run build          # outputs static site to dist/
npm run preview        # serve the built dist/
npm run preview:cf     # build + serve through wrangler (closest to production)

python3 scripts/emas/test_ema_core.py   # EMA math unit + golden tests
```

## Updating the data

The full quarter-by-quarter workflow lives in [`DATA-FLOW.md`](DATA-FLOW.md); the short version:

### Bulk (every quarter) — from Excel
```bash
npm run import -- \
  --input "/path/to/Research Stock 2026.xlsx" \
  --sheet "Q426 Earning" \
  --quarter "Q1 2027"
```
(`npm run import` is `python3 scripts/import_excel.py`; `npm run template` writes a blank
upload template.)

The importer **merges**: it upserts each company and adds that quarter's note to the
company's timeline, keeping earlier quarters. Re-running the same quarter replaces
just that quarter's entry.

Column mapping (source sheet): `CompanyName`=1, `Industry`=2, `MarketCap`=3, `Tier`=4,
`TradingView Code`=14, `View`=17, `Note`=18.

### One at a time — in the browser
Go to `/admin`, sign in with GitHub, upload the quarter's sheet. See
[`ADMIN-SETUP.md`](ADMIN-SETUP.md).

### AI report links

Each row shows a **✨ AI report** link to the AI-generated PDF in the GitHub research repo
(`aadilkadiwal/india-stock-research`). Reports live in **quarter folders** (`Q4-FY26/` or
`Q4-2026/`) and are named by the company's slugified name, so the link is **resolved per
company per quarter** (not a fixed pattern) and stored as `reportUrl` on each quarter entry in
`companies.json` — which is why an earlier quarter in the history panel still links its own
report.

Report links are resolved **automatically** on every `/admin` upload by the server-side
`functions/_lib/linkReports.js`: it lists the reports repo via the GitHub API, matches each
company by name (handles `&`/`and`, `Ltd`, `India` and similar suffixes), and writes the
`reportUrl` for the matching quarter. Quarters with no report found simply show no
AI-report link.

> **Note:** `aadilkadiwal/india-stock-research` must stay **public** — the report links point
> straight at files in it, so making it private would 404 for every visitor. If you ever do need
> it private, mirror the PDFs into the site's `public/` folder and point `reportUrl` there first.

### Prices and weekly EMAs — automatic

`.github/workflows/refresh-emas.yml` runs on weekdays after the NSE close (10:45 UTC),
computes `src/data/emas.json` from Yahoo Finance closes via `scripts/emas/compute_emas.py`, and
commits only if the numbers changed — Cloudflare then rebuilds. Symbols come from `tvCode` in
`companies.json`, so a newly imported company picks up prices on the next run with no extra
step. Details and local commands: [`scripts/emas/README.md`](scripts/emas/README.md).

## Deploy (free)

1. Push this folder to a GitHub repo.
2. On Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**. Framework preset
   **Astro**, build command `npm run build`, output directory `dist` (also in `wrangler.toml`).
   The `functions/` directory becomes `/api/*` automatically.
3. For `/admin`: add the environment variables listed in `ADMIN-SETUP.md`.
4. (Optional) Add a custom domain (~₹800/yr) — and update `site` in `astro.config.mjs`.

Why Cloudflare and not Netlify: the weekday EMA job commits `emas.json` ~22 times a month, and
each commit is a rebuild. Netlify's free plan bills 15 credits per deploy against a 300-credit
cap (≈20 deploys), so the bot alone overran it. Cloudflare Pages allows 500 builds/month with
unlimited bandwidth.

## Data shape

`src/data/companies.json` — your research, one entry per studied company:

```jsonc
{
  "companies": [
    {
      "slug": "netweb",
      "name": "Netweb Technologies India Ltd",
      "tvCode": "NETWEB",
      "industry": "Technology",
      "marketCap": 23145,
      "tier": "Tier 1",
      "quarters": [
        { "quarter": "Q4 2026", "tier": "Tier 1", "view": "Positive",
          "note": "…",
          "reportUrl": "https://github.com/aadilkadiwal/india-stock-research/blob/main/Q4-2026/netweb-technologies-india-ltd.pdf" }
      ]
    }
  ]
}
```

`src/data/emas.json` — generated, keyed by the same `slug`:

```jsonc
{
  "companies": {
    "netweb": {
      "asOf": "2026-08-03",
      "price": 494.45, "prevClose": 492.05, "dayChangePct": 0.49,
      "ema":  { "10W": 479.97, "20W": 449.13, "40W": 401.84 },
      "dist": { "10W": 3.02,   "20W": 10.09,  "40W": 23.05  },  // % price vs EMA
      "min_abs_dist": 3.02, "spread": 19.44, "weeks": 138
    }
  }
}
```

A company missing from `emas.json` just renders no EMA panel.

## Contributing

Changes go through pull requests from a fork — see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Roadmap ideas (not built yet)
Thematic tags, quarter-over-quarter diff page, import-time view/note consistency check,
visitor bookmarks (localStorage), PWA/offline, privacy-friendly analytics.
