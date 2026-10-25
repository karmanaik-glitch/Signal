"""Fetch EOD data with yfinance, calculate deterministic signals, and update model ledger."""
import argparse, json, math, os, time, warnings
from datetime import datetime, timezone, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
import numpy as np
import pandas as pd
import yfinance as yf
from indicators import enrich_ohlcv
from rules import score_stock, RULESET_VERSION
from market_rules import classify_market_regime, sector_rotation
from portfolio import initial_state, process_open, queue_signals, mark_to_market
from history_store import store_history_snapshot
from backtest import run_backtest
from notify import send_alerts

warnings.filterwarnings('ignore')
IST = ZoneInfo('Asia/Kolkata')
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'


def clean(v):
    if v is None: return None
    if isinstance(v, (np.integer,)): return int(v)
    if isinstance(v, (np.floating, float)):
        return float(v) if math.isfinite(float(v)) else None
    if isinstance(v, (np.bool_,)): return bool(v)
    if pd.isna(v): return None
    if hasattr(v, 'isoformat'): return v.isoformat()
    return v


def dump_json(path, obj, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + '.tmp')
    kwargs = {'separators': (',', ':')} if compact else {'indent': 2}
    tmp.write_text(json.dumps(obj, ensure_ascii=False, default=str, **kwargs), encoding='utf-8')
    tmp.replace(path)


def load_json(path, default):
    try: return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError): return default


def as_float(info, key, multiplier=1.0):
    val = info.get(key)
    try:
        val = float(val)
        return round(val * multiplier, 4) if math.isfinite(val) else None
    except (TypeError, ValueError): return None


def fetch_history(tickers, period='1y'):
    """Download in chunks; returns a mapping of Yahoo ticker to OHLCV frame."""
    result = {}
    for start in range(0, len(tickers), 40):
        batch = tickers[start:start+40]
        raw = None
        for attempt in range(3):
            try:
                # auto_adjust=True: split/bonus-adjusted OHLC so corporate actions do not
                # create fake crashes in moving averages, returns or sell signals.
                raw = yf.download(batch, period=period, interval='1d', auto_adjust=True,
                                  group_by='ticker', threads=True, progress=False, timeout=30)
            except Exception as exc:
                print(f'      batch {start // 40 + 1} attempt {attempt + 1} failed: {str(exc)[:120]}')
                raw = None
            if raw is not None and not raw.empty:
                break
            time.sleep(2 * (attempt + 1))
        if raw is None or raw.empty:
            continue
        if isinstance(raw.columns, pd.MultiIndex):
            level0 = set(raw.columns.get_level_values(0))
            for ticker in batch:
                if ticker in level0:
                    frame = raw[ticker].copy()
                else:
                    try: frame = raw.xs(ticker, axis=1, level=1).copy()
                    except (KeyError, ValueError): continue
                frame = frame.dropna(subset=['Close'])
                if not frame.empty: result[ticker] = frame
        else:
            # yfinance may return a flat frame for a one-ticker request.
            if len(batch) == 1:
                frame = raw.dropna(subset=['Close'])
                if not frame.empty: result[batch[0]] = frame
        time.sleep(0.2)
    return result


NIFTY_SERIES = None
INDEX_SYMBOLS = {'nifty50': '^NSEI', 'sensex': '^BSESN', 'banknifty': '^NSEBANK', 'india_vix': '^INDIAVIX'}


def fetch_indices(period='1y'):
    """Free index/VIX closes from the same provider. Missing indices stay None (never fabricated)."""
    out = {}
    global NIFTY_SERIES
    try:
        frames = fetch_history(list(INDEX_SYMBOLS.values()), period)
    except Exception as exc:
        print(f'      index fetch failed: {str(exc)[:120]}')
        frames = {}
    for key, ticker in INDEX_SYMBOLS.items():
        frame = frames.get(ticker)
        close = pd.to_numeric(frame['Close'], errors='coerce').dropna() if frame is not None else pd.Series(dtype=float)
        if len(close) < 2:
            out[key] = None; continue
        if key == 'nifty50': NIFTY_SERIES = close
        last, prev = float(close.iloc[-1]), float(close.iloc[-2])
        out[key] = {'close': round(last, 2), 'change_pct': round((last / prev - 1) * 100, 3) if prev else None,
                    'return_20d_pct': round((last / float(close.iloc[-21]) - 1) * 100, 3) if len(close) >= 21 else None,
                    'date': close.index[-1].date().isoformat()}
    return out


def _r(v, nd=2):
    v = clean(v)
    return None if v is None else round(float(v), nd)


def compact_chart(enriched, rows=120):
    """Columnar, rounded chart payload; only fields the dashboard renders."""
    t = enriched.tail(rows)
    col = lambda name: [_r(x) for x in t[name]] if name in t.columns else None
    return {'d': [i.date().isoformat() for i in t.index], 'o': col('Open'), 'h': col('High'), 'l': col('Low'),
            'c': col('Close'), 'v': [None if clean(x) is None else int(x) for x in t['Volume']],
            's20': col('SMA20'), 's50': col('SMA50'), 's200': col('SMA200'),
            'bb_upper': col('BB_UPPER20'), 'bb_mid': col('SMA20'), 'bb_lower': col('BB_LOWER20'),
            'r': col('RSI14'), 'mh': [_r(a - b, 3) if clean(a) is not None and clean(b) is not None else None for a, b in zip(t['MACD'], t['MACD_SIGNAL'])]}


def fetch_fundamentals(ticker, symbol, company, industry, cache, refresh=False):
    now = datetime.now(timezone.utc)
    cached = cache.get(symbol)
    if cached and not refresh:
        try:
            fetched = datetime.fromisoformat(cached.get('fetched_at', '').replace('Z', '+00:00'))
            if (now - fetched).days < 7:
                return {**cached, 'symbol': symbol, 'company': company, 'industry': industry, 'cache_hit': True}
        except (ValueError, TypeError): pass
    try:
        info = yf.Ticker(ticker).info or {}
        row = {
            'symbol': symbol, 'company': info.get('longName') or info.get('shortName') or company,
            'industry': industry, 'PE_Ratio': as_float(info, 'trailingPE'),
            'Forward_PE': as_float(info, 'forwardPE'), 'EPS_TTM': as_float(info, 'trailingEps'),
            'Market_Cap_Cr': round(as_float(info, 'marketCap', 1e-7) or 0, 2) if info.get('marketCap') else None,
            'PB_Ratio': as_float(info, 'priceToBook'),
            'ROE_pct': as_float(info, 'returnOnEquity', 100),
            'Debt_Equity': as_float(info, 'debtToEquity'),
            'Div_Yield_pct': as_float(info, 'dividendYield', 100),
            'Revenue_Growth_pct': as_float(info, 'revenueGrowth', 100),
            'Current_Ratio': as_float(info, 'currentRatio'),
            'Profit_Margins_pct': as_float(info, 'profitMargins', 100),
            'Operating_Margins_pct': as_float(info, 'operatingMargins', 100),
            'Book_Value': as_float(info, 'bookValue'),
            'Currency': info.get('currency') or 'INR',
            'fetched_at': now.isoformat(), 'source': 'yfinance', 'cache_hit': False,
        }
        cache[symbol] = row
        return row
    except Exception as exc:
        if cached:
            return {**cached, 'symbol': symbol, 'company': company, 'industry': industry,
                    'cache_hit': True, 'stale': True, 'fetch_error': str(exc)[:180]}
        return {'symbol': symbol, 'company': company, 'industry': industry, 'source': 'yfinance',
                'fetched_at': now.isoformat(), 'fetch_error': str(exc)[:180], 'cache_hit': False}


LEVEL = {'STRONG SELL': -2, 'SELL': -1, 'HOLD': 0, 'BUY': 1, 'STRONG BUY': 2}


def build_changes(prev, rows, date):
    """Diff today's signals against the previously published snapshot."""
    if not prev or prev.get('data_mode') != 'LIVE_PIPELINE' or prev.get('exchange_date') == date:
        return {'available': False, 'from': prev.get('exchange_date') if prev else None, 'to': date, 'items': []}
    old = {r['symbol']: r for r in prev.get('signals', [])}
    items = []
    for r in rows:
        o = old.get(r['symbol'])
        if not o or o.get('signal') == r['signal']: continue
        a, b = LEVEL.get(o.get('signal')), LEVEL.get(r['signal'])
        kind = 'blocked' if r['signal'] == 'DATA BLOCKED' else 'unblocked' if o.get('signal') == 'DATA BLOCKED' else ('upgrade' if b > a else 'downgrade')
        items.append({'symbol': r['symbol'], 'company': r.get('company'), 'industry': r.get('industry'), 'from': o.get('signal'), 'to': r['signal'],
                      'kind': kind, 'score_from': o.get('score'), 'score_to': r.get('score'), 'price': r.get('price'), 'change_pct': r.get('change_pct')})
    items.sort(key=lambda x: -abs((LEVEL.get(x['to']) or 0) - (LEVEL.get(x['from']) or 0)))
    return {'available': True, 'from': prev.get('exchange_date'), 'to': date, 'items': items,
            'upgrades': sum(i['kind'] == 'upgrade' for i in items), 'downgrades': sum(i['kind'] == 'downgrade' for i in items)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--universe', default=str(DATA / 'universe.csv'))
    parser.add_argument('--starting-capital', type=float, default=None)
    parser.add_argument('--refresh-fundamentals', action='store_true')
    parser.add_argument('--period', default='3y')
    parser.add_argument('--min-traded-value', type=float, default=2e7, help='20d avg traded value (INR) below which a stock is flagged illiquid and not paper-traded')
    parser.add_argument('--skip-backtest', action='store_true')
    parser.add_argument('--minimum-coverage', type=float, default=0.90)
    args = parser.parse_args()
    started = datetime.now(timezone.utc)
    universe_path = Path(args.universe)
    if not universe_path.is_absolute(): universe_path = ROOT / universe_path
    if not universe_path.exists():
        raise SystemExit(f'Missing universe file: {universe_path}. See README and import a permitted Nifty 500 constituent CSV first.')
    universe = pd.read_csv(universe_path)
    required = {'symbol'}
    if not required.issubset({c.lower() for c in universe.columns}):
        raise SystemExit('Universe CSV needs a symbol column. Run engine/import_universe.py first.')
    universe.columns = [c.lower() for c in universe.columns]
    universe['symbol'] = universe['symbol'].astype(str).str.strip().str.upper().str.replace(r'\.NS$', '', regex=True)
    if 'company' not in universe: universe['company'] = universe['symbol']
    if 'industry' not in universe: universe['industry'] = 'Unknown'
    universe = universe.drop_duplicates('symbol')
    if len(universe) < 1: raise SystemExit('Universe is empty; refusing to publish signals.')
    if len(universe) < 400: print(f'WARNING: only {len(universe)} symbols in universe; this is not a full Nifty 500 run.')
    tickers = [f'{s}.NS' for s in universe['symbol']]
    symbol_meta = {row['symbol']: {'company': str(row['company']), 'industry': str(row['industry'])}
                   for row in universe.to_dict('records')}

    cache_path = DATA / 'fundamentals_cache.json'
    cache = load_json(cache_path, {})
    print(f'[1/5] Downloading daily OHLCV for {len(tickers)} symbols…')
    histories = fetch_history(tickers, args.period)
    history_count = len(histories)
    print(f'      Price histories available: {history_count}/{len(tickers)}')
    indices = fetch_indices(args.period)
    nifty = indices.get('nifty50') or {}
    benchmark_return_20d = nifty.get('return_20d_pct')
    benchmark_date = nifty.get('date')
    vix = indices.get('india_vix') or {}
    # VIX 20-session change feeds the regime's volatility penalty only when a real value exists.
    vix_change_20d = vix.get('return_20d_pct')
    min_required = max(1, math.ceil(len(tickers) * args.minimum_coverage))
    if history_count < min_required:
        report = {'status': 'failed', 'reason': 'price_coverage_below_threshold', 'expected': len(tickers),
                  'received': history_count, 'minimum_required': min_required,
                  'started_at': started.isoformat(), 'finished_at': datetime.now(timezone.utc).isoformat()}
        dump_json(DATA / 'run_report.json', report)
        raise SystemExit(f'Coverage {history_count}/{len(tickers)} below threshold {min_required}; last good snapshot preserved.')

    print('[2/5] Refreshing fundamentals (7-day cache; use --refresh-fundamentals to force)…')
    fund_rows = []
    for i, row in enumerate(universe.to_dict('records'), 1):
        symbol = row['symbol']; meta = symbol_meta[symbol]
        fund_rows.append(fetch_fundamentals(f'{symbol}.NS', symbol, meta['company'], meta['industry'], cache, args.refresh_fundamentals))
        if i % 50 == 0: print(f'      Fundamentals checked: {i}/{len(universe)}')
        time.sleep(0.08)
    dump_json(cache_path, cache)
    fundamentals = {x['symbol']: x for x in fund_rows}

    print('[3/5] Calculating indicators and deterministic signals…')
    signal_rows, price_rows, chart_series = [], [], {}
    opens, closes = {}, {}
    latest_dates, enriched_all = [], {}
    for ticker, raw in histories.items():
        symbol = ticker.replace('.NS', '')
        frame = raw.copy()
        # Ensure provider fields are normalised; ignore adjusted-close for indicator inputs.
        for col in ('Open', 'High', 'Low', 'Close', 'Volume'):
            if col not in frame.columns: frame[col] = np.nan
        frame = frame.dropna(subset=['Open', 'High', 'Low', 'Close'])
        if frame.empty: continue
        # Reject impossible OHLC rows and negative volume before indicator calculation.
        valid = (frame['High'] >= frame[['Open','Close','Low']].max(axis=1)) & (frame['Low'] <= frame[['Open','Close','High']].min(axis=1))
        if 'Volume' in frame.columns:
            valid &= frame['Volume'].isna() | (frame['Volume'] >= 0)
        frame = frame.loc[valid].copy()
        if frame.empty: continue
        enriched = enrich_ohlcv(frame)
        enriched_all[symbol] = enriched
        last = enriched.iloc[-1]
        session_date = enriched.index[-1].date().isoformat()
        latest_dates.append(session_date)
        opens[symbol] = clean(last['Open']); closes[symbol] = clean(last['Close'])
        fund = fundamentals.get(symbol, {})
        tech = {key: clean(last.get(key)) for key in ('Open','High','Low','Close','Volume','SMA20','SMA50','SMA200','RSI14','MACD','MACD_SIGNAL','ATR14','VOLUME_SMA20','VOLUME_RATIO20','RETURN_1D','RETURN_20D','BB_MID20','BB_UPPER20','BB_LOWER20','ADX14','PLUS_DI14','MINUS_DI14')}
        data_ok = (tech['Close'] is not None and tech['SMA50'] is not None and
                   sum(fund.get(k) is not None for k in ('ROE_pct','Debt_Equity','Revenue_Growth_pct','PE_Ratio')) >= 2)
        if tech['RETURN_20D'] is not None and benchmark_return_20d is not None:
            tech['RELATIVE_STRENGTH_20D'] = round(float(tech['RETURN_20D']) - float(benchmark_return_20d), 4)
        else:
            tech['RELATIVE_STRENGTH_20D'] = None
        tv = (tech['VOLUME_SMA20'] or 0) * (tech['Close'] or 0)
        tech['TRADED_VALUE20'] = round(tv, 0)
        liquid = tv >= args.min_traded_value
        held = False  # set from existing state immediately before final signal calculation below
        signal = score_stock(tech, fund, held=held, data_ok=data_ok)
        previous_close = clean(enriched['Close'].iloc[-2]) if len(enriched) > 1 else None
        change = ((tech['Close'] / previous_close) - 1) * 100 if previous_close else None
        price_rows.append({'symbol': symbol, 'company': symbol_meta.get(symbol, {}).get('company', symbol),
            'industry': symbol_meta.get(symbol, {}).get('industry', 'Unknown'), 'close': tech['Close'],
            'open': tech['Open'], 'high': tech['High'], 'low': tech['Low'], 'volume': tech['Volume'],
            'change_pct': clean(change), 'date': session_date, 'source': 'yfinance'})
        chart_series[symbol] = compact_chart(enriched)
        signal_rows.append({'symbol': symbol, 'company': symbol_meta.get(symbol, {}).get('company', symbol),
            'industry': symbol_meta.get(symbol, {}).get('industry', 'Unknown'), 'price': tech['Close'],
            'change_pct': clean(change), 'date': session_date, 'technical': tech, 'fundamentals': fund,
            **signal, 'liquid': liquid, 'tradable': liquid, 'data_quality': 'OK' if signal['signal'] != 'DATA BLOCKED' else 'BLOCKED'})
    if not signal_rows: raise SystemExit('No usable rows after validation; refusing to publish.')
    session_date = max(latest_dates)
    # Market regime uses the observed universe breadth plus benchmark trend and available indicators.
    ready_rows = [r for r in signal_rows if r.get('data_quality') != 'BLOCKED']
    sma50_rows = [r for r in ready_rows if r.get('technical', {}).get('SMA50') is not None]
    sma200_rows = [r for r in ready_rows if r.get('technical', {}).get('SMA200') is not None]
    pct_above_sma50 = (sum(r['technical']['Close'] > r['technical']['SMA50'] for r in sma50_rows) / len(sma50_rows) * 100) if sma50_rows else None
    pct_above_sma200 = (sum(r['technical']['Close'] > r['technical']['SMA200'] for r in sma200_rows) / len(sma200_rows) * 100) if sma200_rows else None
    rsi_values = [r['technical']['RSI14'] for r in ready_rows if r.get('technical', {}).get('RSI14') is not None]
    adx_values = [r['technical']['ADX14'] for r in ready_rows if r.get('technical', {}).get('ADX14') is not None]
    market_regime = classify_market_regime(benchmark_return_20d=benchmark_return_20d, pct_above_sma50=pct_above_sma50,
        pct_above_sma200=pct_above_sma200, average_rsi=(sum(rsi_values)/len(rsi_values) if rsi_values else None),
        average_adx=(sum(adx_values)/len(adx_values) if adx_values else None),
        volatility_change_20d=vix_change_20d)
    sectors = sector_rotation(signal_rows)
    for row in signal_rows:
        row['market_regime'] = market_regime['label']
        if row.get('signal') != 'DATA BLOCKED' and market_regime['label'] in ('RISK-OFF','STRONG RISK-OFF') and row.get('signal') in ('STRONG BUY', 'BUY'):
            row.setdefault('risk_warnings', []).append('Broad market regime is risk-off; this is a caution, not an automatic veto.')
    # A symbol with an older last bar must not generate a fresh signal or fill an order.
    for row in signal_rows:
        if row.get('date') != session_date:
            row['signal'] = 'DATA BLOCKED'
            row['score'] = None
            row['data_quality'] = 'BLOCKED'
            row['reasons'] = (row.get('reasons') or []) + [f'Latest price bar is {row.get("date")} while snapshot date is {session_date}.']
            row['failed_conditions'] = (row.get('failed_conditions') or []) + ['Price freshness gate']
    opens = {s: px for s, px in opens.items() if any(r['symbol'] == s and r['date'] == session_date for r in signal_rows)}
    closes = {s: px for s, px in closes.items() if any(r['symbol'] == s and r['date'] == session_date for r in signal_rows)}

    print('[4/5] Updating Rule Bot model portfolio…')
    state_path = DATA / 'bot_state.json'
    state = load_json(state_path, None)
    if state is not None and any(str(x.get('date', '')).startswith('DEMO') for x in state.get('equity_history', [])):
        print('      Discarding bundled demo bot state; starting a fresh model portfolio.')
        state = None
    if state is None:
        state = initial_state({'starting_capital': args.starting_capital or 1000000.0})
    elif args.starting_capital is not None and not state.get('equity_history') and not state.get('positions'):
        state['config']['starting_capital'] = args.starting_capital; state['cash'] = args.starting_capital
    # Re-evaluate exit signals using actual current model holdings.
    for row in signal_rows:
        if row['symbol'] in state['positions']:
            revised = score_stock(row['technical'], row['fundamentals'], held=True,
                                  data_ok=row['signal'] != 'DATA BLOCKED' and row.get('date') == session_date)
            row.update(revised)
            row['data_quality'] = 'OK' if row['signal'] != 'DATA BLOCKED' else 'BLOCKED'
            row['tradable'] = True  # never trap an existing holding behind the liquidity filter
            row['liquid'] = row.get('liquid', True)
    state = process_open(state, session_date, opens)
    state = mark_to_market(state, session_date, closes)
    state = queue_signals(state, session_date, signal_rows, closes)
    dump_json(state_path, state)

    print('[5/5] Publishing validated snapshot and CSV exports…')
    fund_df = pd.DataFrame(fund_rows)
    fund_df.to_csv(DATA / 'fundamentals.csv', index=False)
    pd.DataFrame(price_rows).to_csv(DATA / 'prices_latest.csv', index=False)
    pd.DataFrame([{k: v for k, v in row.items() if k not in ('technical','fundamentals','reasons','failed_conditions')}
                  for row in signal_rows]).to_csv(DATA / 'signals_latest.csv', index=False)
    prev = load_json(DATA / 'latest_snapshot.json', {})
    changes = build_changes(prev, signal_rows, session_date)
    bt = None
    if not args.skip_backtest:
        try:
            print('      Running technical backtest…')
            bt = run_backtest(enriched_all, NIFTY_SERIES)
        except Exception as exc:
            print(f'      backtest skipped: {str(exc)[:160]}')
    snapshot = {
        'app': 'STRATA Markets', 'schema_version': 3, 'changes': changes, 'data_mode': 'LIVE_PIPELINE',
        'source': 'yfinance', 'universe_label': 'NIFTY 500' if len(universe) >= 400 else 'CUSTOM TEST UNIVERSE', 'ruleset_version': RULESET_VERSION,
        'generated_at': datetime.now(timezone.utc).isoformat(), 'generated_at_ist': datetime.now(IST).isoformat(),
        'pipeline_run_id': os.getenv('GITHUB_RUN_ID') or f'local-{started.strftime("%Y%m%dT%H%M%SZ")}',
        'market_regime': market_regime, 'sector_rotation': sectors,
        'benchmark': {'symbol':'^NSEI','date':benchmark_date,'return_20d_pct':benchmark_return_20d,'source':'yfinance',
                      'nifty50_close': nifty.get('close'), 'nifty50_change_pct': nifty.get('change_pct'),
                      'sensex_close': (indices.get('sensex') or {}).get('close'), 'sensex_change_pct': (indices.get('sensex') or {}).get('change_pct'),
                      'banknifty_close': (indices.get('banknifty') or {}).get('close'), 'banknifty_change_pct': (indices.get('banknifty') or {}).get('change_pct'),
                      'india_vix': vix.get('close'), 'india_vix_change_20d_pct': vix_change_20d},
        'exchange_date': session_date, 'status': 'OK' if history_count == len(tickers) else 'PARTIAL',
        'coverage': {'expected': len(tickers), 'price_histories': history_count,
                     'price_coverage_pct': round(history_count / len(tickers) * 100, 2),
                     'fundamentals_with_any_fields': sum(any(f.get(k) is not None for k in ('PE_Ratio','ROE_pct','EPS_TTM','Debt_Equity')) for f in fund_rows),
                     'fundamentals_coverage_pct': round(sum(any(f.get(k) is not None for k in ('PE_Ratio','ROE_pct','EPS_TTM','Debt_Equity')) for f in fund_rows) / len(fund_rows) * 100, 2)},
        'counts': {sig: sum(1 for r in signal_rows if r['signal'] == sig) for sig in ('STRONG BUY','BUY','HOLD','SELL','STRONG SELL','DATA BLOCKED')},
        'signals': signal_rows, 'bot': state, 'charts_dir': 'charts/',
        'notice': 'Signals are rule outputs, not guarantees of performance. Data is supplied by an unofficial yfinance interface.'
    }
    # Compact JSON keeps the repo, Cloudflare payload and mobile download small. Charts live in
    # their own lazily-fetched file and are kept out of the audit history.
    dump_json(DATA / 'latest_snapshot.json', snapshot, compact=True)
    dump_json(ROOT / 'app' / 'snapshot.json', snapshot, compact=True)
    # WP-5: shard charts into per-symbol files for fast lazy loading on the frontend.
    # Also write legacy monolith for one-cycle backward compatibility (remove after full rollout).
    charts_dir = ROOT / 'app' / 'charts'
    charts_dir.mkdir(parents=True, exist_ok=True)
    chart_index = {}
    for sym, payload in chart_series.items():
        sym_path = charts_dir / f'{sym}.json'
        dump_json(sym_path, payload, compact=True)
        chart_index[sym] = f'charts/{sym}.json'
    dump_json(charts_dir / 'index.json', chart_index, compact=True)
    dump_json(ROOT / 'app' / 'charts.json', chart_series, compact=True)  # legacy; remove in v3.1
    if bt: dump_json(ROOT / 'app' / 'backtest.json', bt, compact=True)
    try: send_alerts(snapshot, DATA)
    except Exception as exc: print(f'      alerts skipped: {str(exc)[:120]}')
    store_history_snapshot(DATA / 'history', session_date, snapshot, keep=252)
    report = {'status': snapshot['status'], 'exchange_date': session_date, 'pipeline_run_id': snapshot['pipeline_run_id'], 'expected': len(tickers),
        'price_histories': history_count, 'signal_rows': len(signal_rows), 'ruleset_version': RULESET_VERSION,
        'started_at': started.isoformat(), 'finished_at': datetime.now(timezone.utc).isoformat(),
        'fundamentals_cache_hits': sum(bool(x.get('cache_hit')) for x in fund_rows),
        'fundamentals_errors': sum(bool(x.get('fetch_error')) for x in fund_rows)}
    dump_json(DATA / 'run_report.json', report)
    print(json.dumps(report, indent=2))

if __name__ == '__main__':
    main()
