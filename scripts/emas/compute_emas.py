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

    data = json.load(open(COMPANIES))
    pairs = [(c["slug"], f"{c['tvCode']}.NS") for c in data["companies"] if c.get("tvCode")]
    slug_by_sym = {s: slug for slug, s in pairs}

    # Previous snapshot: (a) keep last-good data for any symbol that fails this
    # run, and (b) fetch the *stalest* companies first — if the run gets throttled
    # partway, the most out-of-date data still gets refreshed.
    prev = {}
    if os.path.exists(OUT):
        try:
            prev = json.load(open(OUT)).get("companies", {})
        except Exception:
            prev = {}
    pairs.sort(key=lambda p: (prev.get(p[0]) or {}).get("asOf", ""))  # "" (never fetched) leads
    symbols = [s for _, s in pairs]

    # IST run date (the workflow fires ~16:15 IST, after the NSE close).
    run_date = (datetime.datetime.now(datetime.timezone.utc)
                + datetime.timedelta(hours=5, minutes=30)).date().isoformat()
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
            r = build_record(slug, res.get("price"), weekly)
            if r["ema"]["10W"] is not None:      # need at least the 10W EMA to be useful
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
