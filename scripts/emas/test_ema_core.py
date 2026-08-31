"""Runnable tests for ema_core (no pytest dependency: `python3 test_ema_core.py`).

Anchored on two oracles:
  - a hand-computable 3-period EMA,
  - the SFL (Sheela Foam) values confirmed on TradingView / Zerodha:
        10W 696.84 · 20W 649.67 · 40W 635.19  (live ~761.55)
    reproduced here from real fetched weekly closes in fixtures/sfl_weekly.json.
"""
import json
import os
from datetime import date

from ema_core import (
    ema, weekly_closes_from_daily, distance_pct, week_friday, build_record,
    price_return,
)

HERE = os.path.dirname(os.path.abspath(__file__))
FAILS = []


def check(name, cond, extra=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}{(' — ' + extra) if extra else ''}")
    if not cond:
        FAILS.append(name)


def approx(a, b, t):
    return a is not None and b is not None and abs(a - b) <= t


# 1) EMA recurrence — hand-verifiable 3-period example (k=0.5):
#    seed SMA(10,12,11)=11 → 12 → 13.5 → 13.75
check("ema 3-period worked example == 13.75", approx(ema([10, 12, 11, 13, 15, 14], 3), 13.75, 1e-9))
check("ema returns None when < N", ema([1, 2], 3) is None)

# 2) distance %
check("distance +10%", approx(distance_pct(110, 100), 10.0, 1e-9))
check("distance -10%", approx(distance_pct(90, 100), -10.0, 1e-9))
check("distance None on zero EMA", distance_pct(100, 0) is None)

# 3) weekly resample (W-FRI) on trading-day data
check("week_friday Mon->Fri", week_friday(date(2026, 7, 13)) == date(2026, 7, 17))
check("week_friday Thu->Fri", week_friday(date(2026, 7, 16)) == date(2026, 7, 17))
check("week_friday Fri->Fri", week_friday(date(2026, 7, 17)) == date(2026, 7, 17))
_rows = [(date(2026, 7, 13), 100.0), (date(2026, 7, 14), 101.0),
         (date(2026, 7, 17), 105.0), (date(2026, 7, 20), 106.0)]
_wk = weekly_closes_from_daily(_rows)
check("resample keeps last close of week", _wk[0] == (date(2026, 7, 17), 105.0))
check("resample splits into two weeks", len(_wk) == 2 and _wk[1][1] == 106.0)

# 4) build_record metrics
_rec = build_record("x", 25.0, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
check("build_record computes 10W", _rec["ema"]["10W"] is not None)
check("build_record 40W None with <40 weeks", _rec["ema"]["40W"] is None)
check("build_record min_abs_dist set", _rec["min_abs_dist"] is not None)
check("build_record spread None when <3 EMAs", _rec["spread"] is None)
_flat = build_record("y", 100.0, [100.0] * 45)   # all EMAs equal → spread ~0
check("build_record spread ~0 for flat series", approx(_flat["spread"], 0.0, 1e-9))

# 4b) day-over-day change (Screener-style 1-day change vs previous close)
_up = build_record("u", 110.0, [100.0] * 12, prev_close=100.0)
check("day change +10% up", approx(_up.get("dayChangePct"), 10.0, 1e-9) and _up.get("prevClose") == 100.0)
_dn = build_record("d", 95.0, [100.0] * 12, prev_close=100.0)
check("day change -5% down", approx(_dn.get("dayChangePct"), -5.0, 1e-9))
check("no day change when prev_close absent", "dayChangePct" not in build_record("n", 100.0, [100.0] * 12))
check("no day change when prev_close zero", "dayChangePct" not in build_record("z", 100.0, [100.0] * 12, prev_close=0))

# 4c) trailing price return over N calendar days (feeds the Multibagger score).
#     The daily fetch already holds 6y of adjusted closes; this reads a window off it.
def _series(start, n, first, last):
    """n daily bars from `start`, linear from `first` to `last`."""
    step = (last - first) / (n - 1)
    from datetime import timedelta
    return [(start + timedelta(days=i), first + step * i) for i in range(n)]

# exactly 366 daily bars => the bar 365 days back IS the first bar, 100 -> 150
_yr = _series(date(2025, 8, 1), 366, 100.0, 150.0)
check("price_return 1y == +50% when the series spans exactly a year",
      approx(price_return(_yr, 365), 50.0, 1e-6), f"got {price_return(_yr, 365)}")
# with MORE than a year of history it must measure from a year back, not from the
# first bar — on a 400-day 100->150 ramp the base is ~104.26, so ~+43.9%, not +50%.
_long = _series(date(2025, 8, 1), 400, 100.0, 150.0)
check("price_return 1y measures from a year back, not the start of history",
      approx(price_return(_long, 365), 43.87, 0.2), f"got {price_return(_long, 365)}")
_flatyr = _series(date(2025, 8, 1), 400, 200.0, 200.0)
check("price_return 0% on a flat year", approx(price_return(_flatyr, 365), 0.0, 1e-9))
_down = _series(date(2025, 8, 1), 400, 100.0, 60.0)
check("price_return negative on a falling year", (price_return(_down, 365) or 0) < -30)
check("price_return None when history is shorter than the window",
      price_return(_series(date(2026, 5, 1), 60, 100.0, 120.0), 365) is None)
check("price_return None on empty rows", price_return([], 365) is None)
check("price_return None when the base close is zero",
      price_return([(date(2025, 1, 1), 0.0), (date(2026, 6, 1), 50.0)], 365) is None)
# 3y window off the same 6y history
_3y = _series(date(2023, 8, 1), 1200, 100.0, 300.0)
check("price_return 3y works off a longer series", price_return(_3y, 1095) is not None)
check("price_return 3y None when only 1y of history", price_return(_long, 1095) is None)

# 5) SFL end-to-end oracle (real weekly closes -> matches TradingView)
fx = os.path.join(HERE, "fixtures", "sfl_weekly.json")
if os.path.exists(fx):
    data = json.load(open(fx))
    closes = data["weekly_closes"]
    price = data["price"]
    rec = build_record("sheela-foam-ltd", price, closes)
    check("SFL 10W ~= 696.84 (TradingView)", approx(rec["ema"]["10W"], 696.84, 0.5), f"got {rec['ema']['10W']}")
    check("SFL 20W ~= 649.67 (TradingView)", approx(rec["ema"]["20W"], 649.67, 0.5), f"got {rec['ema']['20W']}")
    check("SFL 40W ~= 635.19 (TradingView)", approx(rec["ema"]["40W"], 635.19, 0.5), f"got {rec['ema']['40W']}")
else:
    print("  [skip] SFL fixture not present yet (fixtures/sfl_weekly.json)")

print(f"\n{'ALL PASS ✅' if not FAILS else 'FAILURES: ' + ', '.join(FAILS)}")
raise SystemExit(1 if FAILS else 0)
