"""Technical-rules backtest with next-open fills, costs and a Nifty buy-and-hold benchmark.

Only price-derived rules are tested. Yahoo provides *current* fundamentals only, so
testing them historically would look ahead; they are excluded on purpose.
Survivorship bias remains (today's constituents) and is stated in the output.
"""
import math
import numpy as np
import pandas as pd

CFG = {'capital': 1_000_000.0, 'max_positions': 15, 'max_position_pct': 0.10, 'cost_bps': 20.0,
       'atr_mult': 3.0, 'exit_buffer': 0.98, 'cooldown': 10, 'min_traded_value': 2e7}


def entry_ok(r):
    return (r['Close'] > r['SMA50'] and r['Close'] > r['SMA200'] and 45 <= r['RSI14'] <= 68
            and r['MACD'] > r['MACD_SIGNAL'] and r['RETURN_20D'] > 0)


def _stats(eq, rf=0.065):
    eq = pd.Series(eq).astype(float)
    if len(eq) < 3: return {}
    ret = eq.pct_change().dropna()
    yrs = max(len(eq) / 252, 1e-9)
    cagr = (eq.iloc[-1] / eq.iloc[0]) ** (1 / yrs) - 1
    vol = ret.std() * math.sqrt(252)
    sharpe = ((ret.mean() * 252 - rf) / vol) if vol else None
    dd = (eq / eq.cummax() - 1).min()
    return {'total_return_pct': round((eq.iloc[-1] / eq.iloc[0] - 1) * 100, 2), 'cagr_pct': round(cagr * 100, 2),
            'vol_pct': round(vol * 100, 2), 'sharpe': None if sharpe is None else round(sharpe, 2),
            'max_drawdown_pct': round(dd * 100, 2)}


def run_backtest(frames, bench, cfg=None):
    """frames: {symbol: enriched OHLCV+indicator frame}; bench: Nifty close Series."""
    c = {**CFG, **(cfg or {})}
    syms = sorted(frames)
    idx = sorted(set().union(*[f.index for f in frames.values()]))
    idx = pd.DatetimeIndex(idx)
    cols = ['Open', 'Close', 'SMA50', 'SMA200', 'RSI14', 'MACD', 'MACD_SIGNAL', 'RETURN_20D', 'ATR14', 'VOLUME_SMA20']
    P = {s: frames[s].reindex(idx)[cols] for s in syms}
    start = next((i for i in range(len(idx)) if sum(not np.isnan(P[s]['SMA200'].iloc[i]) for s in syms) > 0), None)
    if start is None or len(idx) - start < 60: return None
    cash, pos, last_exit, eq, trades, exposure = c['capital'], {}, {}, [], [], []
    pending = []
    cost = c['cost_bps'] / 1e4
    for i in range(start + 1, len(idx)):
        d = idx[i]
        # 1) fills at today's open from yesterday's close decisions
        for s, side in pending:
            o = P[s]['Open'].iloc[i]
            if np.isnan(o) or o <= 0: continue
            if side == 'S' and s in pos:
                q = pos.pop(s); cash += q['q'] * o * (1 - cost)
                trades.append({'symbol': s, 'ret_pct': round(((o * (1 - cost)) / (q['px'] * (1 + cost)) - 1) * 100, 2),
                               'entry': q['d'], 'exit': d.date().isoformat(), 'days': (d - pd.Timestamp(q['d'])).days})
                last_exit[s] = i
            elif side == 'B' and s not in pos and len(pos) < c['max_positions']:
                eqv = cash + sum(p['q'] * (P[k]['Close'].iloc[i - 1] if not np.isnan(P[k]['Close'].iloc[i - 1]) else p['px']) for k, p in pos.items())
                q = int(min(cash, eqv * c['max_position_pct']) // (o * (1 + cost)))
                if q > 0:
                    cash -= q * o * (1 + cost); pos[s] = {'q': q, 'px': o, 'peak': o, 'd': d.date().isoformat()}
        # 2) mark to close
        val = cash
        for s, p in pos.items():
            cl = P[s]['Close'].iloc[i]
            if not np.isnan(cl): p['last'] = cl; p['peak'] = max(p['peak'], cl)
            val += p['q'] * p.get('last', p['px'])
        eq.append((d, val)); exposure.append((val - cash) / val if val else 0)
        # 3) decide for next open
        pending = []
        for s, p in pos.items():
            r = P[s].iloc[i]
            if np.isnan(r['Close']): continue
            stop = (not np.isnan(r['ATR14'])) and r['Close'] <= p['peak'] - c['atr_mult'] * r['ATR14']
            if stop or (not np.isnan(r['SMA50']) and r['Close'] < r['SMA50'] * c['exit_buffer']): pending.append((s, 'S'))
        cands = []
        for s in syms:
            if s in pos or (s in last_exit and i - last_exit[s] < c['cooldown']): continue
            r = P[s].iloc[i]
            if r[['Close', 'SMA50', 'SMA200', 'RSI14', 'MACD', 'MACD_SIGNAL', 'RETURN_20D']].isna().any(): continue
            if (r['VOLUME_SMA20'] or 0) * r['Close'] < c['min_traded_value']: continue
            if entry_ok(r): cands.append((r['RETURN_20D'], s))
        cands.sort(reverse=True)
        free = c['max_positions'] - len(pos) + sum(1 for _, x in pending if x == 'S')
        pending += [(s, 'B') for _, s in cands[:max(0, free)]]
    if len(eq) < 30: return None
    ser = pd.Series([v for _, v in eq], index=[d for d, _ in eq])
    b = bench.reindex(ser.index).ffill().dropna() if bench is not None else None
    bser = (b / b.iloc[0] * c['capital']) if b is not None and len(b) > 2 else None
    wins = [t for t in trades if t['ret_pct'] > 0]
    out = {'method': 'Technical rules only; next-open fills; 20 bps/side costs; ATR trailing stop; survivorship-biased (current constituents); fundamentals excluded (no point-in-time data).',
           'config': c, 'strategy': _stats(ser), 'benchmark': _stats(bser) if bser is not None else None,
           'exposure_pct': round(float(np.mean(exposure)) * 100, 1), 'trades': len(trades),
           'win_rate_pct': round(len(wins) / len(trades) * 100, 1) if trades else None,
           'avg_trade_pct': round(float(np.mean([t['ret_pct'] for t in trades])), 2) if trades else None,
           'dates': [d.date().isoformat() for d in ser.index], 'equity': [round(float(v), 0) for v in ser],
           'bench_equity': None if bser is None else [round(float(v), 0) for v in bser.reindex(ser.index).ffill().bfill()]}
    return out
