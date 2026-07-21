"""Production price fetch via yfinance — used by the daily GitHub Action.

Pulls ~6 years of daily *adjusted* closes (auto_adjust=True) so weekly EMAs are
split/bonus-safe and match TradingView. Uses a browser-impersonating curl_cffi
session when available to dodge Yahoo's datacenter-IP throttling (HTTP 429), and
chunks requests to stay gentle. Returns {symbol: {"price", "rows":[(date,close)]}}.
"""
import time


def _session():
    try:
        from curl_cffi import requests as cffi
        return cffi.Session(impersonate="chrome")
    except Exception:
        return None


def fetch_many(symbols, chunk=25, pause=1.5, retries=3):
    import yfinance as yf
    session = _session()
    out = {}
    for i in range(0, len(symbols), chunk):
        part = symbols[i:i + chunk]
        # Yahoo throttles datacenter IPs (429); retry a failed chunk with backoff
        # instead of dropping 25 symbols on one transient blip.
        df = None
        for attempt in range(retries):
            try:
                df = yf.download(part, period="6y", interval="1d", auto_adjust=True,
                                 group_by="ticker", threads=True, progress=False,
                                 session=session)
                break
            except Exception as e:
                wait = pause * (2 ** attempt)
                print(f"  chunk {i//chunk} attempt {attempt+1}/{retries} failed: {e}; retry in {wait:.1f}s")
                time.sleep(wait)
        if df is None:
            print(f"  chunk {i//chunk} gave up after {retries} attempts ({len(part)} symbols dropped)")
            for s in part:
                out[s] = None
            continue
        for sym in part:
            try:
                sub = df[sym] if len(part) > 1 else df
                closes = sub["Close"].dropna()
                rows = [(idx.date(), float(v)) for idx, v in closes.items()]
                # The Action runs after the NSE close, so the last daily close IS
                # the price — no extra per-symbol live-quote call needed.
                if rows:
                    out[sym] = {"price": rows[-1][1], "rows": rows}
                else:
                    out[sym] = None   # no data (delisted / bad symbol) — distinct from an error
            except Exception as e:
                print(f"  parse {sym} failed: {e}")
                out[sym] = None
        time.sleep(pause)
    return out
