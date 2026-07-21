#!/usr/bin/env python3
"""Compute weekly 10/20/40W EMAs for every company and write src/data/emas.json.

Run daily after NSE close by .github/workflows/refresh-emas.yml.

  python3 scripts/emas/compute_emas.py --source yf       # production (GitHub Action)
  python3 scripts/emas/compute_emas.py --source browser  # local bootstrap / fallback

Reads company symbols from src/data/companies.json (tvCode + ".NS"), fetches
daily adjusted closes, resamples to Friday-anchored weekly closes, and computes
each EMA + % distance via ema_core (which sets the developing week's close to the
live price so values match TradingView / Zerodha).
"""
import argparse
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ema_core import weekly_closes_from_daily, build_record  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
COMPANIES = os.path.normpath(os.path.join(HERE, "..", "..", "src", "data", "companies.json"))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "src", "data", "emas.json"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", choices=["yf", "browser"], default="yf")
    args = ap.parse_args()

    with open(COMPANIES) as f:
        data = json.load(f)
    pairs = [(c["slug"], f"{c['tvCode']}.NS") for c in data["companies"] if c.get("tvCode")]
    slug_by_sym = {s: slug for slug, s in pairs}

    # Previous snapshot: (a) keep last-good data for any symbol that fails this
    # run, and (b) fetch the *stalest* companies first — if the run gets throttled
    # partway, the most out-of-date data still gets refreshed.
    prev = {}
    if os.path.exists(OUT):
        try:
            with open(OUT) as f:
                prev = json.load(f).get("companies", {})
        except Exception as e:
            # Loud, not silent: an empty fallback drops every company that also fails this run.
            print(f"WARNING: could not read previous {OUT} ({e}); last-good fallback is EMPTY this run")
            prev = {}
    pairs.sort(key=lambda p: (prev.get(p[0]) or {}).get("asOf", ""))  # "" (never fetched) leads
    symbols = [s for _, s in pairs]

    # IST run date (the workflow fires ~16:15 IST, after the NSE close).
    run_date_obj = (datetime.datetime.now(datetime.timezone.utc)
                    + datetime.timedelta(hours=5, minutes=30)).date()
    run_date = run_date_obj.isoformat()
    STALE_DAYS = 5   # a latest bar older than this ⇒ delisted/halted, not fresh
    print(f"fetching {len(symbols)} symbols via {args.source} (stalest first) …")

    fetch_many = (__import__("fetch_yf") if args.source == "yf" else __import__("fetch_browser")).fetch_many
    fetched = fetch_many(symbols)

    companies, ok, insufficient, kept, missing = {}, 0, [], [], []
    for sym in symbols:
        slug = slug_by_sym[sym]
        res = fetched.get(sym)
        rec = None
        if res and res.get("rows"):
            weekly = [c for _, c in weekly_closes_from_daily(res["rows"])]
            # Previous trading day's close for the 1-day change. Runs after the
            # NSE close, so rows[-1] is today's close (== price) and rows[-2] is
            # the prior session. None for a listing with a single daily bar.
            rows = res["rows"]
            prev_close = rows[-2][1] if len(rows) >= 2 else None
            # A delisted/halted symbol still returns its last bar; don't stamp that
            # frozen price as fresh — let it fall through to kept-last-good.
            stale = (run_date_obj - rows[-1][0]).days > STALE_DAYS
            r = build_record(slug, res.get("price"), weekly, prev_close=prev_close)
            if r["ema"]["10W"] is not None and not stale:   # need ≥10W EMA and a recent bar
                r["asOf"] = run_date
                rec = r
        if rec:
            companies[slug] = rec
            ok += 1
        elif slug in prev:
            companies[slug] = prev[slug]          # keep last-good (retains its older asOf)
            kept.append(sym)
        elif res and res.get("rows"):
            insufficient.append(sym)              # had data, but < 10 weeks of history
        else:
            missing.append(sym)

    # Mass-outage guard: if nothing fetched fresh, don't overwrite the good
    # snapshot with all-stale data — exit non-zero so no misleading commit lands.
    if symbols and ok == 0:
        print(f"ERROR: 0 of {len(symbols)} symbols returned fresh data — not writing {OUT}. "
              f"({len(kept)} would-be kept-last-good, {len(missing)} no data)")
        sys.exit(1)
    if symbols and ok < 0.5 * len(symbols):
        print(f"WARNING: only {ok}/{len(symbols)} symbols fresh — possible throttling/API issue")

    out = {
        "updatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="minutes"),
        "source": args.source,
        "companies": companies,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)

    print(f"wrote {OUT}")
    print(f"  {ok} fresh · {len(insufficient)} insufficient history · {len(kept)} kept last-good · {len(missing)} no data")
    if kept:
        print("  kept last-good:", ", ".join(kept))
    if missing:
        print("  no data (symbol/mapping?):", ", ".join(missing))


if __name__ == "__main__":
    main()
