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
