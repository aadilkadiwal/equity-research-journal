"""Bootstrap / fallback price fetch via headless Chromium.

A real browser has a legitimate TLS fingerprint, so Yahoo serves it even when a
plain HTTP client gets 429'd. Used to generate the initial emas.json locally and
as a documented fallback. Requires playwright. Same return shape as fetch_yf.
"""
import datetime
import json
from urllib.parse import quote

CHART = ("https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
         "?interval=1d&range=6y&includeAdjustedClose=true")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120 Safari/537.36")


def _parse(txt):
    if not txt:
        return None
    try:
        d = json.loads(txt)
        r = d["chart"]["result"][0]
        meta, ts = r["meta"], r.get("timestamp")
        if not ts:
            return None
        adj = r["indicators"].get("adjclose", [{}])[0].get("adjclose")
        cl = r["indicators"]["quote"][0].get("close")
        src = adj if adj else cl
        rows = [(datetime.datetime.fromtimestamp(t, datetime.timezone.utc).date(), c)
                for t, c in zip(ts, src) if c is not None]
        if not rows:
            return None
        return {"price": meta.get("regularMarketPrice"), "rows": rows}
    except Exception:
        return None


def fetch_many(symbols, pause_ms=150):
    from playwright.sync_api import sync_playwright
    out = {}
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        pg = b.new_context(user_agent=UA).new_page()
        try:
            pg.goto("https://finance.yahoo.com/", wait_until="domcontentloaded", timeout=30000)
        except Exception:
            pass
        pg.wait_for_timeout(700)
        for sym in symbols:
            url = CHART.format(sym=quote(sym, safe=".^"))
            try:
                txt = pg.evaluate(
                    "async (u)=>{try{const r=await fetch(u);"
                    "if(r.status!==200)return null;return await r.text();}catch(e){return null;}}", url)
            except Exception:
                txt = None
            out[sym] = _parse(txt)
            pg.wait_for_timeout(pause_ms)
        b.close()
    return out
