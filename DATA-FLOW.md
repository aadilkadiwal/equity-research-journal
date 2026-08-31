# Data flow — how new / updated data gets on the site

All content lives in **one file**: `src/data/companies.json`. It's built into the
static site — there's no database. Each quarter you update it, then publish.
Report links are resolved automatically when you upload via `/admin`.

```
 (1) Study & record          (2) Generate AI reports         (3) Import notes            (4) Link reports              (5) Publish
 ───────────────────         ──────────────────────          ────────────────           ─────────────────             ──────────
 Edit the Excel sheet   →    /concall-tracker skill      →   npm run import ...     →    linkReports.mjs runs      →   npm run build
 (view + note + tier)        pushes Q<n>-FY<yy>/*.pdf         merges into                on /admin upload              → deploy
                             to the public GitHub repo        companies.json             (adds reportUrl, auto)        (Cloudflare)
```

## Each quarter (the normal flow)

### 1. Study & record your views — the Excel sheet
Update your research workbook (e.g. `Research Stock 2026.xlsx`) for the new
results season. Columns are matched **by header name** (either spelling works), so
moving them around the sheet is safe:

Names and order below are taken from the workbook itself, so the `/admin`
template is a mirror of the sheet you maintain:

| # | Column | Meaning |
|---|---|---|
| 1 | `Industry` | Sector |
| 2 | `Company Name` | Company name |
| 3–10 | *growth columns* | see below |
| 11 | `Market Cap` | ₹ crore (text like `9,171.02` is fine) |
| 12 | `Tier` | Tier 1–4 (weaker of YoY Sales & PAT growth) |
| 13 | `TradingView Code` | Symbol (for Chart/Screener links) |
| 14 | `View` | **View** — Positive / Watch / Concern / Negative |
| 15 | `Note` | **The note** (plain-English take) |
| 16 | `EPS TTM` | **Trailing-twelve-month diluted EPS in ₹**. `price ÷ this` = the P/E. |
| 17 | `5Y Avg P/E` | The company's **own** 5-year average P/E — the yardstick for "still expensive". |
| 18 | `Industry P/E` | Sector P/E. Used only when `5Y Avg P/E` is blank. |
| 19 | `Book Value` | Per share, ₹. Gives P/B, which matters where P/E is the wrong lens. |

Columns 16–19 are the **valuation columns** — all optional, all read per quarter, and
all supplied whenever a company is added or a new quarter's results are recorded.

The older template spellings (`CompanyName`, `MarketCap`) are still accepted, so
sheets downloaded before this change keep importing.

Columns 3–10 are the eight **optional** growth columns, percentages
(`24.1` = +24.1%):

| Column | | Column | |
|---|---|---|---|
| `YoY Sales Growth` | `QoQ Sales Growth` | `YoY EPS Growth` | `QoQ EPS Growth` |
| `YoY Op Profit Growth` | `QoQ Op Profit Growth` | `YoY PAT Growth` | `QoQ PAT Growth` |

### The valuation columns (16–19)

`EPS TTM` is the **trailing-twelve-month** diluted figure in rupees — the number
Screener's P/E is built on, not the single quarter's EPS. Trailing on purpose:
multiplying one quarter by four overstates a growing company's earnings, which
understates its P/E and makes an expensive stock look cheap — the exact error the
level check exists to catch. On Screener, `Current Price ÷ Stock P/E` gives it.

`5Y Avg P/E` is the most valuable of the six. Without it the score can only see the
*direction* the multiple moved, not the level it moved from — and a fall from 70× to
58× reads identically to a fall from 12× to 10×, though one is earnings catching up
to a price already paid and the other is growth nobody has paid for. With it, "still
expensive" means *expensive against this company's own history*, so a developer is
never benchmarked against speciality chemicals. Yardstick order: `5Y Avg P/E`, then
`Industry P/E`, then a 75th-percentile fallback across the book.

`Book Value` gives P/B, which replaces P/E entirely for the real-estate and
financial names where lumpy revenue recognition makes earnings a poor guide.

Recording these every quarter also builds a comparable series (Q1 2027 vs Q1 2026),
which is what a real multi-year EPS CAGR needs.

A blank cell means **not recorded** — never zero. A metric with both cells empty is
omitted, and the company page says so rather than showing a misleading 0%.

Only rows that have a View/Note become companies on the site. The `/admin`
template (`npm run template`) ships all 16 in this order. It omits the workbook's
`Halal`, `Wrap Suggestion`, `Chart Setup` and `Q1…  Concall` columns, which the
site does not read — so `View`/`Note` sit at 14–15 in the template but 18–19 in
the workbook. Uploading the raw sheet works either way.

### 2. Generate the AI concall reports
Run the **concall-tracker** skill for the season's companies. It asks which
quarter folder to publish under (suggesting past/current/next), then pushes one
PDF per company to `Q<n>-FY<yy>/<company>.pdf` in the **public** repo
`aadilkadiwal/india-stock-research`.

### 3. Import the notes  →  `companies.json`
```bash
npm run import -- \
  --input "/path/Research Stock 2027.xlsx" \
  --sheet "Q127 Earning" \
  --quarter "Q1 2027"
```
- **Merges** — it upserts each company and **appends this quarter** to the
  company's timeline, keeping earlier quarters. Re-running the same quarter
  replaces just that quarter's entry.
- Refreshes market cap / tier / industry to the latest.
- The `--quarter` label (`Q1 2027`) must match the report folder (`Q1-2027`).

### 4. Link the AI reports  →  `reportUrl` per quarter
Resolved **automatically** — the `/admin` upload runs server-side `linkReports.js`
right after merging. It lists the reports repo via the GitHub API, matches each
company (handles `&`/`and`, `Ltd`, `India`), and writes `reportUrl` onto **each
quarter entry**, so every quarter's note links its own report. No separate command.

### 5. Publish
```bash
npm run build      # static output in dist/
```
Then deploy: push to the site's GitHub repo — Cloudflare Pages auto-builds. Or run
`npx wrangler pages deploy dist` for a one-off manual deploy.

## What changes on the site automatically
- The new quarter becomes the **latest note** per company; the previous quarter
  drops into the **"▸ history"** expander.
- The **"What changed last quarter"** digest auto-populates (upgrades / downgrades).
- A company's **"↕ from …"** chip appears when its view changed vs last quarter.
- AI-report links point to the new quarter's PDFs.

## Once a quarter — refresh the 5-year P/E range

```bash
python3 scripts/pe/fetch_pe_history.py
```

Writes `src/data/pe.json` (low / median / high per company) from Screener's chart
endpoint. Nothing to fill in by hand. It **resumes** — Screener rate-limits around
the 30th company, so run it again until it reports `0 failed`; already-fetched
companies are skipped unless you pass `--refresh`.

This feeds the company page's forward block only, and never the score — see the
"5-year P/E range" section in `README.md` for why.

## One-off single-company edit
- Quickest: edit `src/data/companies.json` by hand, then `npm run build`.
- Browser editing: `/admin` takes a one-quarter sheet and commits it for you.
  Re-uploading the same quarter replaces just that quarter. See `ADMIN-SETUP.md`.
