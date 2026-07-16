# Weekly EMA pipeline

Adds 10/20/40-week EMAs + % distance-from-price to every company, for on-site
screening: filter by which stocks are **near** the 10W / 20W / 40W EMA (within
2%) or have **converging** EMAs (all three bunched together). Each company also
carries its own `asOf` date, and stale companies are refreshed first.

## How it runs (free tier)

`.github/workflows/refresh-emas.yml` runs **once daily after NSE close**
(`45 10 * * 1-5` UTC = ~16:15 IST, weekdays), computes `src/data/emas.json`, and
commits it if changed. Netlify then auto-rebuilds and the static site serves the
new numbers. No runtime functions, no database — the data is baked in.

Private-repo Actions minutes: a ~2-min daily job ≈ 60 min/month (2,000 free).

## Pieces

| File | Role |
|------|------|
| `ema_core.py` | Pure, dependency-free math: W-FRI weekly resample, SMA-seeded EMA, % distance, `build_record`. Sets the developing week's close to the live price so values match TradingView / Zerodha. |
| `fetch_yf.py` | Production price fetch via `yfinance` (+ `curl_cffi` browser impersonation to avoid Yahoo 429s). Used by the Action. |
| `fetch_browser.py` | Bootstrap / fallback fetch via headless Chromium (real TLS fingerprint). Used to seed the data file locally. |
| `compute_emas.py` | Orchestrator → writes `src/data/emas.json`. |
| `test_ema_core.py` | `python3 test_ema_core.py` — unit + golden regression tests. |
| `fixtures/sfl_weekly.json` | Frozen SFL weekly closes; golden anchor. |

## Data source

Yahoo Finance (`SYMBOL.NS`), ~6y daily **adjusted** closes resampled to
Friday-anchored weeks. Symbols derive from `tvCode` in `companies.json`.
Fallback if Yahoo blocks: Twelve Data paid India tier (swap `fetch_yf`; EMA math
unchanged).

## Run locally

```bash
python3 scripts/emas/test_ema_core.py                    # tests
python3 scripts/emas/compute_emas.py --source browser    # regenerate emas.json (needs playwright)
python3 scripts/emas/compute_emas.py --source yf         # as the Action does (needs yfinance)
```

## Validation

Method verified equal to pandas `ewm` and matched TradingView/Zerodha for SFL
(10W 696.8 · 20W 649.6 · 40W 635.1). The key rule: **resample daily→W-FRI
yourself** (don't trust Yahoo's `1wk` bars) and use the **live price as the
developing week's close**.
