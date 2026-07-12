# Stock Research Journal

A fast, single-page site for your personal equity-research notes — one **row** per company,
coloured by your view (Positive / Watch / Concern / Negative), searchable and filterable
by quarter, tier and industry. Only companies you've actually studied appear. The note is
shown **inline** (no clicking); each row links out to the AI **Concall report**, TradingView
and Screener.in. Once a company has more than one quarter, an inline "history" toggle reveals
the older notes in place.

**Public read, you're the only editor. Free to host on Netlify. Not investment advice.**

## Stack

- **Astro** — ships near-zero JS, instant loads, mobile-first, dark mode.
- **Vanilla JS** — instant substring search (name / symbol / industry / inside notes),
  quarter + view + tier + industry filters, sort, removable active-filter chips,
  pagination (24/page), and the company popup (with ← → keyboard browsing). Single page, no routes.
- **TradingView / Screener.in** — deep-research links from each company popup.
- **Sveltia CMS** — Git-based `/admin` editor that commits `companies.json` to your repo.
- **Data** — a single `src/data/companies.json` (studied companies only). No backend, no database.

## Design notes

- Brand accent is indigo — deliberately not one of the four view colours, so "selected"
  never reads as "Watch". Views also carry a glyph (▲ ● ◆ ▼) for colour-blind / grayscale.
- Cards use a faint view tint; view is the only coloured element, tier + market cap sit
  in one muted line. Respects `prefers-reduced-motion`.

## Tiers

Tier = the weaker of YoY Sales growth and YoY PAT growth:
Tier 1 = both ≥ 20% · Tier 2 = both ≥ 15% · Tier 3 = both ≥ 10% · Tier 4 = either < 10%.
(Shown on the site via the "What are tiers?" button.)

## Local development

```bash
npm install
npm run dev        # http://localhost:4321
npm run build      # outputs static site to dist/
npm run preview    # serve the built dist/
```

## Updating the data

### Bulk (every quarter) — from Excel
```bash
python3 scripts/import_excel.py \
  --input "/path/to/Research Stock 2026.xlsx" \
  --sheet "Q426 Earning" \
  --quarter "Q1 2027"
```
The importer **merges**: it upserts each company and adds that quarter's note to the
company's timeline, keeping earlier quarters. Re-running the same quarter replaces
just that quarter's entry.

Column mapping (source sheet): `CompanyName`=1, `Industry`=2, `MarketCap`=3, `Tier`=4,
`TradingView Code`=14, `View`=17, `Note`=18.

### AI report links

Each row shows a **✨ AI report** link to the AI-generated PDF in the GitHub research repo
(`aadilkadiwal/india-stock-research`). Reports live in **weekly folders** and are named by the
company's slugified name, so the link is **resolved per company** (not a fixed pattern) and
stored in each company's `reportUrl` in `companies.json`.

Report links are resolved **automatically** on every `/admin` upload by the server-side
`linkReports.mjs`: it lists the reports repo via the GitHub API, matches each company (handles
`&`/`and`, `Ltd`, `India` suffixes), picks the **most recent week**, and writes the `reportUrl`.
Companies with no report found simply show no AI-report link.

> **Note:** the research repo is **private**, so these links only open for GitHub accounts with
> access. To let public visitors open them, make the repo **public**, or mirror the PDFs into the
> site's `public/` folder and point `reportUrl` there.

### One at a time — in the browser (after hosting)
Go to `/admin`, log in, add/edit a company and its quarter note, save. Sveltia commits
`companies.json` and Netlify redeploys. Set your GitHub repo in `public/admin/config.yml`
first (`backend.repo`).

## Deploy (free)

1. Push this folder to a GitHub repo.
2. On Netlify: **New site → import from GitHub**. Build command `npm run build`,
   publish directory `dist` (already in `netlify.toml`).
3. For the `/admin` editor: set `backend.repo` in `public/admin/config.yml` to your repo,
   and connect a Git backend (GitHub OAuth / Netlify Identity).
4. (Optional) Add a custom domain (~₹800/yr).

## Data shape (`src/data/companies.json`)

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
          "note": "…" }
      ]
    }
  ]
}
```

## Roadmap ideas (not built yet)
Thematic tags, quarter-over-quarter diff page, import-time view/note consistency check,
visitor bookmarks (localStorage), PWA/offline, price column across the list (Netlify
scheduled function), privacy-friendly analytics.
