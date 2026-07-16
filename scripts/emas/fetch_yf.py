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


def fetch_many(symbols, chunk=25, pause=1.5):
    import yfinance as yf
    session = _session()
    out = {}
    for i in range(0, len(symbols), chunk):
        part = symbols[i:i + chunk]
        try:
            df = yf.download(part, period="6y", interval="1d", auto_adjust=True,
                             group_by="ticker", threads=True, progress=False,
                             session=session)
        except Exception as e:
            print(f"  chunk {i//chunk} download failed: {e}")
            for s in part:
                out[s] = None
            time.sleep(pause)
            continue
        for sym in part:
            try:
                sub = df[sym] if len(part) > 1 else df
                closes = sub["Close"].dropna()
                rows = [(idx.date(), float(v)) for idx, v in closes.items()]
                # The Action runs after the NSE close, so the last daily close IS
                # the price — no extra per-symbol live-quote call needed.
                out[sym] = {"price": rows[-1][1], "rows": rows} if rows else None
            except Exception:
                out[sym] = None
        time.sleep(pause)
    return out
