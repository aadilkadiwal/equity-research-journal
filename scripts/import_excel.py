#!/usr/bin/env python3
"""
Import a research Excel sheet into src/data/companies.json.

Merges by company (TradingView code / name): each run upserts the company's
fixed info and adds/replaces ONE quarter entry in its timeline, so running it
every quarter builds up the history instead of overwriting it.

NOTE: the upsert rules here mirror netlify/functions/_lib/merge.mjs (the /admin
upload path). Two differences are intentional: this script reads by column
*index* (the raw source sheet), while merge.mjs reads by header *name* (the
template); and merge.mjs validates REQUIRED_COLUMNS while this local script does
not. Keep the upsert/keying/sort behaviour in sync between the two.

Usage:
    python3 scripts/import_excel.py \
        --input "/path/to/Research Stock 2026.xlsx" \
        --sheet "Q426 Earning" \
        --quarter "Q4 FY26"

Requires: openpyxl  (pip install openpyxl)
"""
import argparse, json, os, re, sys

try:
    import openpyxl
except ImportError:
    sys.exit("Please install openpyxl:  pip install openpyxl")

# 1-indexed column positions in the source sheet
COL = {"name": 1, "industry": 2, "marketCap": 3, "tier": 4, "tvCode": 14, "view": 17, "note": 18}


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-") or "x"


def cell(ws, r, key):
    v = ws.cell(row=r, column=COL[key]).value
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Path to the .xlsx file")
    ap.add_argument("--sheet", default="Q426 Earning", help="Worksheet name")
    ap.add_argument("--quarter", required=True, help='Quarter label, e.g. "Q4 FY26"')
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--json", default=os.path.join(here, "..", "src", "data", "companies.json"))
    args = ap.parse_args()

    wb = openpyxl.load_workbook(args.input, data_only=True)
    ws = wb[args.sheet]

    # load existing dataset (keeps prior quarters)
    target = os.path.abspath(args.json)
    if os.path.exists(target):
        with open(target) as f:
            data = json.load(f)
    else:
        data = {"companies": []}

    by_key = {}
    for c in data["companies"]:
        by_key[(c.get("tvCode") or c["name"]).upper()] = c

    added, updated = 0, 0
    for r in range(2, ws.max_row + 1):
        name = cell(ws, r, "name")
        if not name:
            continue
        tv = cell(ws, r, "tvCode")
        key = (str(tv) if tv else str(name)).upper()

        view, note, tier = cell(ws, r, "view"), cell(ws, r, "note"), cell(ws, r, "tier")
        mcap, industry = cell(ws, r, "marketCap"), cell(ws, r, "industry")

        comp = by_key.get(key)
        if comp is None:
            comp = {
                "slug": slugify(tv or name),
                "name": str(name).strip(),
                "tvCode": (str(tv).strip() if tv else None),
                "industry": (str(industry).strip() if industry else None),
                "marketCap": (round(float(mcap), 2) if isinstance(mcap, (int, float)) else None),
                "tier": (str(tier).strip() if tier else None),
                "quarters": [],
            }
            data["companies"].append(comp)
            by_key[key] = comp
            added += 1
        else:
            # refresh latest fixed info
            if isinstance(mcap, (int, float)):
                comp["marketCap"] = round(float(mcap), 2)
            if industry:
                comp["industry"] = str(industry).strip()
            if tier:
                comp["tier"] = str(tier).strip()
            updated += 1

        # upsert this quarter's entry
        if (view and str(view).strip()) or (note and str(note).strip()):
            entry = {
                "quarter": args.quarter,
                "tier": (str(tier).strip() if tier else None),
                "view": (str(view).strip() if view else None),
                "note": (str(note).strip() if note else ""),
            }
            comp["quarters"] = [q for q in comp["quarters"] if q.get("quarter") != args.quarter]
            comp["quarters"].append(entry)

    # keep only companies that have at least one quarter's research note
    data["companies"] = [c for c in data["companies"] if c.get("quarters")]

    # market-cap desc, unknown last
    data["companies"].sort(key=lambda c: (c["marketCap"] is None, -(c["marketCap"] or 0)))

    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"{args.quarter}: {added} new, {updated} existing companies. "
          f"Total: {len(data['companies'])} -> {target}")


if __name__ == "__main__":
    main()
