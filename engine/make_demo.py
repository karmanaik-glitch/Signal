"""Build the bundled DEMO dataset by running the real pipeline on synthetic prices.

Everything is random-walk data; nothing here is a real quote or a real signal.
Usage: python engine/make_demo.py   (writes app/snapshot.json, charts.json, backtest.json)
"""
import json, shutil, sys, tempfile
from pathlib import Path
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import types
try:
    import yfinance  # noqa: F401
except ImportError:  # the demo never touches the network, so a stub is enough
    sys.modules['yfinance'] = types.ModuleType('yfinance')
import run_pipeline as rp

SECTORS = {'Financial Services': ['HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK', 'BAJFINANCE'],
           'Information Technology': ['TCS', 'INFY', 'WIPRO', 'HCLTECH', 'TECHM', 'LTIM'],
           'Energy': ['RELIANCE', 'ONGC', 'NTPC', 'POWERGRID', 'COALINDIA'],
           'Consumer Staples': ['ITC', 'HINDUNILVR', 'NESTLEIND', 'BRITANNIA', 'DABUR'],
           'Automobiles': ['MARUTI', 'M&M', 'BAJAJ-AUTO', 'EICHERMOT', 'HEROMOTOCO'],
           'Healthcare': ['SUNPHARMA', 'DRREDDY', 'CIPLA', 'DIVISLAB'],
           'Industrials': ['LT', 'SIEMENS', 'ABB', 'BHEL'],
           'Metals': ['TATASTEEL', 'JSWSTEEL', 'HINDALCO', 'VEDL']}
END = pd.Timestamp('2026-10-23')


def synth(n_days, seed, drift):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range(end=END, periods=n_days)
    ret = rng.normal(drift, 0.016, n_days)
    close = rng.uniform(150, 3500) * np.exp(np.cumsum(ret))
    opn = close * (1 + rng.normal(0, 0.004, n_days))
    hi = np.maximum(opn, close) * (1 + np.abs(rng.normal(0, 0.006, n_days)))
    lo = np.minimum(opn, close) * (1 - np.abs(rng.normal(0, 0.006, n_days)))
    vol = rng.integers(8e5, 6e6, n_days).astype(float)
    return pd.DataFrame({'Open': opn, 'High': hi, 'Low': lo, 'Close': close, 'Volume': vol}, index=idx)


def main():
    root = Path(tempfile.mkdtemp())
    (root / 'data').mkdir(); (root / 'app').mkdir()
    rows, full, seed = [], {}, 3
    for sector, syms in SECTORS.items():
        for s in syms:
            seed += 1
            full[s + '.NS'] = synth(780, seed, 0.0003 + (seed % 5 - 2) * 0.00005)
            rows.append((s, s.title(), sector))
    pd.DataFrame(rows, columns=['symbol', 'company', 'industry']).to_csv(root / 'data' / 'universe.csv', index=False)
    nifty = synth(780, 99, 0.0004)['Close']
    rp.ROOT, rp.DATA = root, root / 'data'
    rng = np.random.default_rng(5)
    rp.fetch_fundamentals = lambda t, sym, co, ind, cache, refresh=False: {
        'symbol': sym, 'company': co, 'industry': ind, 'PE_Ratio': round(float(rng.uniform(8, 60)), 1),
        'EPS_TTM': 10.0, 'Market_Cap_Cr': round(float(rng.uniform(5e3, 9e5)), 0), 'PB_Ratio': round(float(rng.uniform(1, 9)), 1),
        'ROE_pct': round(float(rng.uniform(4, 30)), 1), 'Debt_Equity': round(float(rng.uniform(0, 180)), 1),
        'Div_Yield_pct': round(float(rng.uniform(0, 3)), 2), 'Revenue_Growth_pct': round(float(rng.uniform(-6, 24)), 1),
        'Currency': 'INR', 'fetched_at': 'DEMO SYNTHETIC', 'source': 'synthetic_demo'}
    sessions = list(range(7, 0, -1))  # 7 trailing sessions, one pipeline run each
    for cut in sessions:
        rp.fetch_history = lambda tickers, period='3y', c=cut: {t: full[t].iloc[:len(full[t]) - c + 1] for t in tickers if t in full}
        def fi(period='1y', c=cut):
            ser = nifty.iloc[:len(nifty) - c + 1]; rp.NIFTY_SERIES = ser
            mk = lambda s, k: {'close': round(float(s.iloc[-1]) * k, 2), 'change_pct': round(float(s.iloc[-1] / s.iloc[-2] - 1) * 100, 3),
                               'return_20d_pct': round(float(s.iloc[-1] / s.iloc[-21] - 1) * 100, 3), 'date': s.index[-1].date().isoformat()}
            return {'nifty50': mk(ser, 8), 'sensex': mk(ser, 26), 'banknifty': mk(ser, 18),
                    'india_vix': {'close': 14.2, 'change_pct': -1.1, 'return_20d_pct': -4.0, 'date': ser.index[-1].date().isoformat()}}
        rp.fetch_indices = fi
        sys.argv = ['x', '--universe', str(root / 'data' / 'universe.csv'), '--minimum-coverage', '0.5']
        rp.main()
    snap = json.loads((root / 'app' / 'snapshot.json').read_text())
    snap.update({'data_mode': 'DEMO', 'source': 'synthetic_demo', 'status': 'DEMO', 'universe_label': 'DEMO · SYNTHETIC SAMPLE',
                 'notice': 'Synthetic random-walk data. Not real prices, not real signals, not for investment use.'})
    app = Path(__file__).resolve().parents[1] / 'app'
    (app / 'snapshot.json').write_text(json.dumps(snap, separators=(',', ':')))
    # Copy sharded charts (WP-5)
    if (root / 'app' / 'charts').exists():
        if (app / 'charts').exists():
            shutil.rmtree(app / 'charts')
        shutil.copytree(root / 'app' / 'charts', app / 'charts')
    for f in ('charts.json', 'backtest.json'):
        if (root / 'app' / f).exists(): shutil.copy(root / 'app' / f, app / f)
    chart_count = len(list((app / 'charts').glob('*.json'))) - 1 if (app / 'charts').exists() else 0
    print('demo written:', len(snap['signals']), 'signals;', f'{chart_count} chart shards;', 'backtest' if (app / 'backtest.json').exists() else 'no backtest')



if __name__ == '__main__':
    main()
