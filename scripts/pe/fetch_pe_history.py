#!/usr/bin/env python3
"""Fetch each company's P/E history from Screener and write src/data/pe.json.

    python3 scripts/pe/fetch_pe_history.py            # all companies
    python3 scripts/pe/fetch_pe_history.py --only SKIPPER,BHAGERIA

WHY a separate file and not companies.json: this is machine-written, the same as
emas.json, while companies.json is the hand-edited source of truth you import into
each quarter. Mixing a bot's writes into that file invites collisions with /admin
uploads — the same reasoning that put ret1y in emas.json.

WHY quarterly and not daily: the P/E *range* barely moves week to week, and this
costs one page fetch plus one API call per company. The daily EMA job already
supplies the live price, so nothing here needs to be fresh.

The chart endpoint is undocumented and could change without notice. Every failure
is per-company and non-fatal: a missing entry simply means the precedent test falls
back to the 5-year average from the sheet.
"""
import argparse
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pe_core import company_path_from_search, id_from_page, pe_range_from_series  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
COMPANIES = os.path.normpath(os.path.join(HERE, "..", "..", "src", "data", "companies.json"))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "src", "data", "pe.json"))
SITE = "https://www.screener.in"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
YEARS = 5


# Screener starts returning 429 around the 30th company. Back off and wait rather
# than burning the rest of the book: the run is quarterly, so minutes are free.
BACKOFF = [30, 90, 240]


def get(url, referer=None):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/json, text/html;q=0.9",
        **({"Referer": referer, "X-Requested-With": "XMLHttpRequest"} if referer else {}),
    })
    for i, wait in enumerate([*BACKOFF, None]):
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code != 429 or wait is None:
                raise
            print(f"        429 — waiting {wait}s (attempt {i + 1}/{len(BACKOFF)})", flush=True)
            time.sleep(wait)


def company_id(code, name):
    """(internal id, page path) for a company, or (None, path).

    The id only ever comes from the page's markup — see id_from_page for why the
    URL's own number is not it. Most companies are reachable at
    /company/<NSE symbol>/; BSE-only listings 404 there, so search by name for the
    path first.
    """
    path = f"/company/{code}/consolidated/"
    try:
        return id_from_page(get(SITE + path)), path
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
    hits = json.loads(get(SITE + "/api/company/search/?q=" + urllib.parse.quote(name)))
    found = company_path_from_search(hits)
    if not found:
        return None, path
    return id_from_page(get(SITE + found)), found


def pe_range(cid, path):
    raw = get(f"{SITE}/api/company/{cid}/chart/"
              f"?q=Price+to+Earning-Median+PE-EPS&days=3650",
              referer=SITE + path)
    return pe_range_from_series(json.loads(raw), years=YEARS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="comma-separated TradingView codes")
    ap.add_argument("--pause", type=float, default=2.5, help="seconds between companies")
    ap.add_argument("--refresh", action="store_true",
                    help="re-fetch companies already in pe.json (default: skip them)")
    args = ap.parse_args()

    with open(COMPANIES) as f:
        companies = json.load(f)["companies"]
    wanted = {c.strip().upper() for c in args.only.split(",")} if args.only else None
    todo = [c for c in companies if c.get("tvCode")
            and (not wanted or c["tvCode"].upper() in wanted)]

    prev = {}
    if os.path.exists(OUT):
        try:
            with open(OUT) as f:
                prev = json.load(f).get("companies", {})
        except Exception as e:
            print(f"WARNING: could not read {OUT} ({e}); starting fresh")

    # Default to resuming, so a rate-limited run just needs running again.
    if not args.refresh:
        before = len(todo)
        todo = [c for c in todo if c["slug"] not in prev]
        if before != len(todo):
            print(f"skipping {before - len(todo)} already fetched (--refresh to redo them)")

    out, ok, kept, failed = dict(prev), 0, [], []
    print(f"fetching P/E history for {len(todo)} companies …", flush=True)
    for i, c in enumerate(todo, 1):
        code = c["tvCode"]
        try:
            cid, path = company_id(code, c["name"])
            if not cid:
                raise RuntimeError("no company id on the page or in search")
            rng = pe_range(cid, path)
            if not rng:
                raise RuntimeError("no usable P/E series")
            out[c["slug"]] = {**rng, "screenerId": cid}
            ok += 1
            print(f"  [{i}/{len(todo)}] {code:12} high {rng['high']:>7} · low {rng['low']:>6} "
                  f"· median {rng['median']:>6}  ({rng['points']} pts)", flush=True)
        except Exception as e:
            if c["slug"] in prev:
                kept.append(code)
            else:
                failed.append(f"{code} ({e})")
            print(f"  [{i}/{len(todo)}] {code:12} FAILED: {e}", flush=True)
        time.sleep(args.pause)

    # Same guard as the EMA job: never replace a good snapshot with an empty one.
    if todo and ok == 0 and not prev:
        sys.exit("ERROR: nothing fetched and no previous snapshot — not writing")

    with open(OUT, "w") as f:
        json.dump({
            "updatedAt": datetime.datetime.now(datetime.timezone.utc)
                         .isoformat(timespec="minutes"),
            "source": "screener.in chart api",
            "years": YEARS,
            "companies": dict(sorted(out.items())),
        }, f, indent=1)
        f.write("\n")
    print(f"\nwrote {OUT}\n  {ok} fresh · {len(kept)} kept last-good · {len(failed)} failed")
    if failed:
        print("  failed: " + ", ".join(failed[:10]))


if __name__ == "__main__":
    main()
