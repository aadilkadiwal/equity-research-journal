"""Pure P/E-range logic — no network, no filesystem, so it can be tested.

Mirrors scripts/emas/ema_core.py: the arithmetic and parsing live here, the HTTP
calls live in fetch_pe_history.py.
"""
import datetime
import re
import statistics

MIN_POINTS = 20   # fewer weeks than this is not a five-year range


def company_path_from_search(hits):
    """The first company page path in Screener's search results, or None.

    Needed because a BSE-only listing (Concord Control, CFF Fluid, BMW Industries)
    has no /company/<NSE symbol>/ page to guess at — search is the only way in.
    """
    for hit in (hits or []):
        url = hit.get("url") or ""
        if re.match(r"^/company/[^/]+/", url):
            return url
    return None


def id_from_page(html):
    """The internal company id the chart endpoint answers to.

    Deliberately NOT parsed out of the URL: Concord Control's page lives at
    /company/543619/ (its BSE scrip code) while the chart endpoint only answers to
    1275319. The two are unrelated numbers, and treating the URL's as the id gets
    a 404 on every BSE-only listing.
    """
    m = re.search(r'data-company-id="(\d+)"', html or "")
    if m:
        return m.group(1)
    m = re.search(r"/api/company/(\d+)/", html or "")
    return m.group(1) if m else None


def pe_range_from_series(data, years=5):
    """Low / median / high of the 'Price to Earning' series over the last `years`.

    The window is measured back from the series' own last point, not from today —
    a stale download then reports the range it actually covers instead of nothing.
    Returns None when there is no P/E series (loss-making companies have an EPS
    series and no P/E) or too few points to call a range.
    """
    series = next((ds.get("values") or [] for ds in data.get("datasets", [])
                   if ds.get("metric") == "Price to Earning"), [])
    pts = [(datetime.date.fromisoformat(d), float(v))
           for d, v in series if v is not None]
    if not pts:
        return None
    cutoff = pts[-1][0] - datetime.timedelta(days=years * 365)
    window = [v for d, v in pts if d >= cutoff and v > 0]
    if len(window) < MIN_POINTS:
        return None
    return {
        "high": round(max(window), 1),
        "low": round(min(window), 1),
        "median": round(statistics.median(window), 1),
        "points": len(window),
        "asOf": pts[-1][0].isoformat(),
    }
