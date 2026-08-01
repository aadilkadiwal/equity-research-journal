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
results season. Columns used by the importer:

| Column | Meaning |
|---|---|
| `CompanyName` | Company name |
| `Industry` | Sector |
| `MarketCap` | ₹ crore |
| `Tier` | Tier 1–4 (weaker of YoY Sales & PAT growth) |
| `View` | **View** — Positive / Watch / Concern / Negative |
| `Note` | **The note** (plain-English take) |
| `TradingView Code` | Symbol (for Chart/Screener links) |

Only rows that have a View/Note become companies on the site.

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

## One-off single-company edit
- Quickest: edit `src/data/companies.json` by hand, then `npm run build`.
- Browser editing: `/admin` takes a one-quarter sheet and commits it for you.
  Re-uploading the same quarter replaces just that quarter. See `ADMIN-SETUP.md`.
