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
        --quarter "Q4 2026"

Requires: openpyxl  (pip install openpyxl)
"""
import argparse, json, math, os, re, sys

try:
    import openpyxl
except ImportError:
    sys.exit("Please install openpyxl:  pip install openpyxl")

# 1-indexed column positions in the source sheet
COL = {"name": 1, "industry": 2, "marketCap": 3, "tier": 4, "tvCode": 14, "view": 17, "note": 18}
KNOWN_VIEWS = {"positive", "watch", "concern", "negative"}


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", str(s).lower()).strip("-") or "x"


def round2(x):
    # Round half UP to match merge.mjs (JS Math.round) so CLI and /admin agree.
    return math.floor(x * 100 + 0.5) / 100


def parse_mcap(v):
    # Accept numeric-looking text ("2,458.10", "₹1,234") too, else it drops to None.
    if isinstance(v, (int, float)):
        return round2(float(v))
    if v is None:
        return None
    s = re.sub(r"[^0-9.\-]", "", str(v))
    try:
        return round2(float(s)) if s not in ("", "-", ".") else None
    except ValueError:
        return None


def cell(ws, r, key):
    v = ws.cell(row=r, column=COL[key]).value
    return v


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Path to the .xlsx file")
    ap.add_argument("--sheet", default="Q426 Earning", help="Worksheet name")
    ap.add_argument("--quarter", required=True, help='Quarter label, e.g. "Q4 2026"')
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--json", default=os.path.join(here, "..", "src", "data", "companies.json"))
    args = ap.parse_args()

    wb = openpyxl.load_workbook(args.input, data_only=True)
    try:
        ws = wb[args.sheet]
    except KeyError:
        sys.exit(f"Sheet '{args.sheet}' not found. Available sheets: {', '.join(wb.sheetnames)}")

    # We read by fixed column INDEX, so a moved/removed column would silently pull
    # every field from the wrong place. Require enough columns and confirm the
    # View column holds recognizable values before trusting the layout.
    if ws.max_column < max(COL.values()):
        sys.exit(f"Sheet '{args.sheet}' has {ws.max_column} columns; expected at least "
                 f"{max(COL.values())}. Is this the right sheet / layout?")
    seen_views = sum(
        1 for r in range(2, ws.max_row + 1)
        if str(cell(ws, r, "view") or "").strip().lower() in KNOWN_VIEWS
    )
    if ws.max_row > 5 and seen_views == 0:
        sys.exit("No recognizable View values (Positive/Watch/Concern/Negative) found in "
                 f"column {COL['view']}. The source columns look misaligned — aborting.")

    # load existing dataset (keeps prior quarters)
    target = os.path.abspath(args.json)
    if os.path.exists(target):
        with open(target) as f:
            data = json.load(f)
    else:
        data = {"companies": []}

    by_key = {}
    for c in data["companies"]:
        by_key[str(c.get("tvCode") or c.get("name") or "").upper()] = c

    added, updated = 0, 0
    for r in range(2, ws.max_row + 1):
        name = cell(ws, r, "name")
        if not name:
            continue
        tv = cell(ws, r, "tvCode")
        key = (str(tv) if tv else str(name)).upper()

        view, note, tier = cell(ws, r, "view"), cell(ws, r, "note"), cell(ws, r, "tier")
        mcap, industry = cell(ws, r, "marketCap"), cell(ws, r, "industry")

        mcap_val = parse_mcap(mcap)
        comp = by_key.get(key)
        is_new = comp is None
        if comp is None:
            comp = {
                "slug": slugify(tv or name),
                "name": str(name).strip(),
                "tvCode": (str(tv).strip() if tv else None),
                "industry": (str(industry).strip() if industry else None),
                "marketCap": mcap_val,
                "tier": (str(tier).strip() if tier else None),
                "quarters": [],
            }
            data["companies"].append(comp)
            by_key[key] = comp
        else:
            # refresh latest fixed info
            if mcap_val is not None:
                comp["marketCap"] = mcap_val
            if industry:
                comp["industry"] = str(industry).strip()
            if tier:
                comp["tier"] = str(tier).strip()

        # Count only rows that produce a quarter entry — others are dropped below.
        if (view and str(view).strip()) or (note and str(note).strip()):
            prior = next((q for q in comp["quarters"] if q.get("quarter") == args.quarter), None)
            entry = {
                "quarter": args.quarter,
                "tier": (str(tier).strip() if tier else None),
                "view": (str(view).strip() if view else None),
                "note": (str(note).strip() if note else ""),
            }
            # The CLI path never re-runs linkReports, so keep any existing link.
            if prior and prior.get("reportUrl"):
                entry["reportUrl"] = prior["reportUrl"]
            comp["quarters"] = [q for q in comp["quarters"] if q.get("quarter") != args.quarter]
            comp["quarters"].append(entry)
            if is_new:
                added += 1
            else:
                updated += 1

    # keep only companies that have at least one quarter's research note
    data["companies"] = [c for c in data["companies"] if c.get("quarters")]

    # market-cap desc, unknown last
    data["companies"].sort(key=lambda c: (c.get("marketCap") is None, -(c.get("marketCap") or 0)))

    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"{args.quarter}: {added} new, {updated} existing companies. "
          f"Total: {len(data['companies'])} -> {target}")


if __name__ == "__main__":
    main()
