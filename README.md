# Stock Research Journal

A fast, single-page site for your personal equity-research notes — one **row** per company,
coloured by your view (Positive / Watch / Concern / Negative), searchable and filterable
by quarter, tier and industry. Only companies you've actually studied appear. The note is
shown **inline** (no clicking); each row links out to the AI **Concall report**, TradingView
and Screener.in. Once a company has more than one quarter, an inline "history" toggle reveals
the older notes in place.

**Public read, you're the only editor. Free to host on Cloudflare Pages. Not investment advice.**

## Stack

- **Astro** — ships near-zero JS, instant loads, mobile-first, dark mode.
- **Vanilla JS** — instant substring search (name / symbol / industry / inside notes),
  quarter + view + tier + industry filters, sort, removable active-filter chips,
  pagination (24/page), and the company popup (with ← → keyboard browsing). Single page, no routes.
- **TradingView / Screener.in** — deep-research links from each company popup.
- **`/admin`** — GitHub-login upload page: drop in a quarter's Excel sheet and it
  merges into `companies.json` and commits. Runs on Cloudflare Pages Functions
  (`functions/`). See `ADMIN-SETUP.md`.
- **Data** — a single `src/data/companies.json` (studied companies only). No backend, no database.

## Design notes

- Brand accent is indigo — deliberately not one of the four view colours, so "selected"
  never reads as "Watch". Views also carry a glyph (▲ ● ◆ ▼) for colour-blind / grayscale.
- Cards use a faint view tint; view is the only coloured element, tier + market cap sit
  in one muted line. Respects `prefers-reduced-motion`.

## Multibagger setup score

Each company page carries a 0-100 **case-strength score** with a band
(Strong ≥75 / Fair ≥65 / Moderate ≥50 / Weak ≥32 / None); the list and table show the
score and the band. Floors are set from the live distribution rather than round
numbers — at the old 80/65/48/30 the median company scored 47 and 93% of the book
fell into Moderate or below, which is not a ranking.
It answers one question: **how much of the earnings growth this company has already
delivered has the market not paid for yet?** The bands are phrased as *cases*
deliberately — a case is an argument you still have to check, never a forecast, and
it stays honest about the reason: 64% of low-scoring companies are there for lack
of growth rather than for price, so a price-flavoured ladder would mislabel them.

It rests on `Price = EPS × Multiple`, so `ΔMultiple = (1 + price return) ÷ (1 + growth)`
— the multiple's move falls out of two numbers already on hand. Measured over the
same window the growth is: where a 3-year return is stored, `ΔMultiple =
(1 + 3y return) ÷ (1 + CAGR)³`, annualised back so the thresholds keep their
meaning; one year where it is not. Points come from five places: **A** valuation
level (25), **B** unpaid growth (15), **C** earnings quality (30, is the growth
sales-backed and repeatable), **D** capital efficiency (10, what it earns on its own
book), **E** confirmation (20, EMA structure — the only leg that tells a coiled
spring from a falling knife).

The **growth axis is EPS**, not the weakest of EPS/sales/EBITDA. Taking the minimum
charged a margin-driven grower three times over — once by capping the axis at its
sales line, again in the quality leg's backing test, and a third time via the
`EPS not sales-backed` flag. Operating leverage is a real multibagger engine, so it
is discounted **once**, in the quality leg, where the deduction is visible.

**Capital efficiency** is `EPS TTM ÷ Book Value` — an implied ROE, recorded for 125
of 127 companies and previously unused. Without it a 3%-on-book business and a
71%-on-book one were separated only by their multiples. A missing book value is
*unknown*, not bad: it scores the middle rather than the floor.

**Market cap is reported, never scored.** Size decides the *odds* of a multibagger,
not the strength of its case — tripling a ₹2.66 lakh cr company means the market
finding ₹5.3 lakh cr of new value, and no amount of cheapness changes that
arithmetic. It surfaces as a `size is the headwind` flag and a line beside the
projection, so it informs the read without quietly overwriting the analysis.

The valuation half is split because it answers two different questions. **Level**
asks *is this cheap right now* — the question that finds a company the market has
not looked at yet, scored against its own 5-year average P/E (weight 0.7) and its
industry P/E (0.3), renormalised over whichever are recorded. **Unpaid growth**
asks *how did the multiple move over the measured window* (ΔMultiple). A single
component could not do both: a stock can sit at a fraction of its historical
multiple while that multiple drifted up this year. With no P/E recorded, level is
omitted and its points fold into unpaid growth. The **band** says how good the setup is; the **quadrant**
(Multibagger / Treadmill / Hope Trade / Double Whammy) says which box it sits in —
they are deliberately separate. Flags (`base effect`, `EPS not sales-backed`,
`falling knife`, `priced in`) override the number where it would mislead.

Your own `View` is deliberately **not** an input — it sits beside the score so
agreement and disagreement stay visible.

The list offers two different questions, kept separate on purpose. **Case strength**
ranks by the score every row prints, using the 3-year outlook only to break ties
inside a band — and a projection its own flags undermine breaks no ties at all.
**Upside · 3y** ranks by that projection alone, for when the *size* of the prize is
the question. Sorting the one under the other's name is how a flagged, de-rating
Moderate company came to sit above a clean Strong one.

ΔMultiple knows direction, not level: a fall from 70× and a fall from 12× are the
same ratio and opposite situations. The six optional **valuation columns** fix that.
`EPS TTM` gives the current P/E (and since ΔMultiple *is* `pe_now / pe_then`, both
ends of the move); `5Y Avg P/E` says whether the fallen multiple is *still* rich
against the company's own history, which fires the `priced in` flag; `Book Value`
gives P/B for the names where P/E is the wrong lens. Yardstick order is
`5Y Avg P/E` → `Industry P/E` → a 75th-percentile fallback across the book, and
with none of them recorded the score simply does not make the claim.

The flag needs a **margin**, not just "above the yardstick": roughly half of any
set sits above its own average, so firing at 1.0x condemned half the book on
rounding errors (a company at 1.00x its own average is fair, not expensive).
`priced in` fires above **1.2x** the yardstick and withholds more credit above
**1.5x** — see `PRICED_IN_MARGIN` / `PRICED_IN_HARD` in `src/lib/score.js`.

### Written for a non-investor

The panel used to open with `×3.7 — at 41% a year, with the multiple back at 39×`,
which assumes the reader knows what a multiple is. It now opens with a sentence:
*"Cheap, and growing fast. Profit per share grew 41% a year, while the price-tag on
its earnings actually got smaller."* Four such sentences cover the whole book,
chosen by quadrant and gate (`plainSummary` in `src/lib/render.js`).

Three further changes follow from the same rule — **plain on top, the notation
directly underneath, nothing removed**:

- The forward block leads with the finding rather than the figure. `TO DOUBLE,
  NEEDS 21×` hid the striking part: 21x is *below* today's 29x, so it can double
  while getting cheaper. That is now the headline, and the target is in rupees.
- Component rows are **questions**, not nouns — *Has the market paid for this
  growth yet?* instead of *Unpaid growth*. `ΔMultiple ×0.76` stays on the sub-line.
- The quadrant nickname gets one plain clause. "The Treadmill" alone reads as
  futility sitting directly under a lead that says "cheap, and growing fast".

**Where the score and your View disagree, the panel says so.** Five companies
currently score Strong/Fair under a Concern/Negative view. Two badges quietly
contradicting each other is how a reader skimming for "Strong" takes away the wrong
signal, so the panel states it and points at the note. The notice is neutral-toned
with a concern-coloured rule: filling it with the concern colour would make it read
as a *view badge*, which is the confusion it exists to remove.

A collapsed **glossary** (`glossaryHTML`) defines every term the panel still uses —
P/E, EPS, CAGR, re-rating, YoY/QoQ, book value, EMA, multibagger. It sits last in
the company page's right rail, which previously ran out of content halfway down.

### The 5-year P/E range

`5Y Avg P/E` from the sheet says where the multiple *usually* sat. It cannot say
where the multiple has *been* — and that is the question the forward arithmetic
actually turns on. A triple that needs 25x is a different proposition in a company
that has traded from 10x to 58x than in one that never passed 22x.

`scripts/pe/fetch_pe_history.py` fills that in: it reads each company's P/E history
from Screener's chart endpoint and writes the 5-year **low / median / high** to
`src/data/pe.json`, keyed by slug — a separate machine-written file, the same
arrangement as `emas.json`, so a bot's writes never collide with an `/admin` upload
into `companies.json`.

```bash
python3 scripts/pe/fetch_pe_history.py                  # resumes: skips what it has
python3 scripts/pe/fetch_pe_history.py --refresh        # re-fetch everything
python3 scripts/pe/fetch_pe_history.py --only SKIPPER   # one company
```

Run it **once a quarter**, not daily — the range barely moves week to week, and the
daily EMA job already supplies the live price. Screener rate-limits at roughly the
30th company, so the script backs off (30s / 90s / 240s) and resumes by default:
re-run it until the failure count is zero.

The range is deliberately **report-only** — it does not move the score. The
endpoint is undocumented, and letting it feed the points would mean a change on
Screener's side silently re-banding the whole book overnight. It replaces the
wording on the panel ("a stretch beyond its history" becomes "never traded above
141x in 5 years") and nothing else. Companies with no entry — loss-making names
with no meaningful P/E, or a fetch that failed — fall back to the average from
the sheet.

As a free check on the hand-entered data, the computed median lands very close to
the `5Y Avg P/E` typed into the sheet (Acutaas 58.9 vs 59.2, CGPower 82.4 vs 81.4,
Skipper 38.3 vs 38.5). Where the two diverge badly it is usually a P/E spike
dragging the *mean* up while the median holds — Borosil Renewables' mean is 96x
against a 50x median, because it briefly touched 231x.

Not investment advice. See `src/lib/score.js` and `npm test`.

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

Columns are matched **by header name**, not position, so the sheet's layout can move
without breaking the import. Canonical names and order come from the research
workbook itself (`Industry`, `Company Name`, the eight growth columns, `Market Cap`,
`Tier`, `TradingView Code`, `View`, `Note`, and the six valuation columns) and the
`/admin` template mirrors them;
the older spellings (`CompanyName`, `MarketCap`) still work. The eight growth
columns are optional — a sheet without them imports fine and the site shows
"not recorded" rather than zero.

### AI report links

Each row shows a **✨ AI report** link to the AI-generated PDF in the GitHub research repo
(`aadilkadiwal/india-stock-research`). Reports live in **weekly folders** and are named by the
company's slugified name, so the link is **resolved per company** (not a fixed pattern) and
stored in each company's `reportUrl` in `companies.json`.

Report links are resolved **automatically** on every `/admin` upload by the server-side
`functions/_lib/linkReports.js`: it lists the reports repo via the GitHub API, matches each
company (handles `&`/`and`, `Ltd`, `India` suffixes), picks the **most recent week**, and writes
the `reportUrl`. Companies with no report found simply show no AI-report link.

> **Note:** `aadilkadiwal/india-stock-research` must stay **public** — the report links point
> straight at files in it, so making it private would 404 for every visitor. If you ever do need
> it private, mirror the PDFs into the site's `public/` folder and point `reportUrl` there first.

### One at a time — in the browser
Go to `/admin`, sign in with GitHub, upload the quarter's sheet. See `ADMIN-SETUP.md`.

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
          "note": "…",
          "epsTtmRs": 189.94, "peAvg5y": 32.5, "bvps": 798 }
      ]
    }
  ]
}
```

## Roadmap ideas (not built yet)
Thematic tags, quarter-over-quarter diff page, import-time view/note consistency check,
visitor bookmarks (localStorage), PWA/offline, price column across the list (Cloudflare
scheduled Worker), privacy-friendly analytics.
