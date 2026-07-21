"""Pure, dependency-free weekly-EMA helpers shared by the data pipeline.

Produces 10/20/40-week EMAs for NSE stocks that match TradingView / Zerodha.
Method (validated against SFL on TradingView — see scripts/emas/README.md):
  1. resample daily *adjusted* closes to Friday-anchored weekly closes (W-FRI),
  2. seed each EMA with an N-period SMA, then iterate the standard recurrence,
  3. include the current (developing) week so the value tracks the live price.

Kept free of third-party deps so it is trivially unit-testable and so the
GitHub Action and any local generator compute *identically*.
"""
from datetime import timedelta

WINDOWS = (10, 20, 40)


def week_friday(d):
    """Friday of d's trading week. NSE trades Mon-Fri (weekday 0..4), all of
    which map to that same week's Friday — matching pandas resample('W-FRI')."""
    return d + timedelta(days=(4 - d.weekday()))


def weekly_closes_from_daily(rows):
    """rows: iterable of (date, close) daily bars, any order.
    Returns chronological list of (friday_date, close) using the last trading
    day's close in each week. Equivalent to pandas resample('W-FRI').last()."""
    by_week = {}
    for d, c in rows:
        if c is None:
            continue
        fri = week_friday(d)
        cur = by_week.get(fri)
        if cur is None or d >= cur[0]:
            by_week[fri] = (d, c)
    return [(fri, by_week[fri][1]) for fri in sorted(by_week)]


def ema(values, n):
    """SMA-seeded EMA over `values`; None if fewer than n points."""
    if values is None or len(values) < n:
        return None
    k = 2.0 / (n + 1)
    e = sum(values[:n]) / n           # SMA seed at bar n
    for c in values[n:]:
        e = c * k + e * (1 - k)
    return e


def distance_pct(price, ema_val):
    """Signed % of price above (+) / below (-) the EMA."""
    if ema_val in (None, 0) or price is None:
        return None
    return (price - ema_val) / ema_val * 100.0


def build_record(slug, price, weekly_closes, prev_close=None, use_live_close=True):
    """Build the per-company EMA record the frontend consumes.

    weekly_closes: chronological list of weekly close floats (incl current week).
    prev_close: previous trading day's close. When given (and non-zero) with a
      live `price`, emits `prevClose` and `dayChangePct` — the Screener-style
      1-day change, (price - prevClose) / prevClose. Omitted when not computable
      (e.g. a brand-new listing with a single close) so the frontend can simply
      skip the chip. The daily fetch already has this as the second-to-last bar.
    use_live_close: set the developing (latest) week's close to `price`. This is
      what makes the EMA match TradingView / Zerodha intraday — the current
      weekly bar closes at the live price. At EOD price == that close, so it is a
      no-op; run mid-session it keeps the value tracking the live price.
    Also emits `min_abs_dist` (distance to the closest EMA — used for the
    "closest to EMA" sort) and `spread` (how far apart the three EMAs are, in %,
    driving the "converging" filter). The client applies the "near" threshold
    against `dist`.
    """
    price = round(price, 2) if price is not None else None
    closes = [c for c in (weekly_closes or []) if c is not None]
    if use_live_close and closes and price is not None:
        closes = closes[:-1] + [price]   # developing week close = live price
    emas, dists = {}, {}
    for n in WINDOWS:
        e = ema(closes, n)
        emas[n] = e
        dists[n] = distance_pct(price, e)

    rec = {
        "slug": slug,
        "price": price,
        "weeks": len(closes),
        "ema": {f"{n}W": (round(emas[n], 2) if emas[n] is not None else None) for n in WINDOWS},
        "dist": {f"{n}W": (round(dists[n], 2) if dists[n] is not None else None) for n in WINDOWS},
    }
    have = [d for d in dists.values() if d is not None]
    rec["min_abs_dist"] = round(min(abs(d) for d in have), 2) if have else None
    es = [e for e in emas.values() if e is not None]
    rec["spread"] = round((max(es) - min(es)) / min(es) * 100, 2) if len(es) == 3 else None
    if price is not None and prev_close not in (None, 0):
        rec["prevClose"] = round(prev_close, 2)
        rec["dayChangePct"] = round((price - prev_close) / prev_close * 100, 2)
    return rec
