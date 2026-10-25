"""Deterministic model portfolio ledger; never connects to a broker."""
from copy import deepcopy
from datetime import datetime, timezone, date as _date

DEFAULT_CONFIG = {
    'starting_capital': 1000000.0,
    'max_positions': 15,
    'max_position_pct': 0.10,
    'max_sector_pct': 0.25,
    'cost_bps_per_side': 15.0,
    'slippage_bps_per_side': 5.0,
    'atr_stop_mult': 3.0,      # chandelier trailing stop: peak close - mult * ATR14
    'cooldown_days': 14,       # calendar days before re-entering a symbol after an exit
}


def initial_state(config=None):
    cfg = {**DEFAULT_CONFIG, **(config or {})}
    return {'schema_version': 1, 'config': cfg, 'cash': cfg['starting_capital'], 'positions': {},
            'pending_orders': [], 'trades': [], 'cooldowns': {}, 'equity_history': [], 'processed_signal_dates': [],
            'created_at': datetime.now(timezone.utc).isoformat(), 'last_updated': None}


def _cost(notional, cfg):
    return notional * (cfg['cost_bps_per_side'] + cfg['slippage_bps_per_side']) / 10000.0


def _is_active(order):
    status = str(order.get('status', ''))
    return status != 'filled' and not status.startswith('rejected')


def _mark_value(p):
    q = float(p.get('quantity', 0) or 0)
    return float(p.get('market_value') or q * float(p.get('last_price', p.get('entry_price', 0)) or 0))


def _prune_orders(orders, date, keep_days=30, max_wait_days=5):
    """Expire stale unfilled orders and drop old resolved ones so state stays bounded."""
    from datetime import date as _d
    try: today = _d.fromisoformat(date)
    except (TypeError, ValueError): return orders
    out = []
    for o in orders:
        try: sd = _d.fromisoformat(str(o.get('signal_date')))
        except (TypeError, ValueError): out.append(o); continue
        age = (today - sd).days
        if _is_active(o) and age > max_wait_days:
            o = {**o, 'status': 'rejected_expired', 'resolved_date': date}
        if not _is_active(o) and age > keep_days:
            continue
        out.append(o)
    return out


def process_open(state, date, open_prices):
    """Resolve pending orders from prior signals using today's open; idempotent by order id.

    Sells are processed before buys so freed cash/slots are available, and buys are
    taken in descending signal-score order so limited slots go to the best candidates
    rather than to whichever symbol happens to sort first.
    """
    state = deepcopy(state)
    cfg = state['config']
    orders = _prune_orders(state['pending_orders'], date)

    def eligible(o):
        return not (o.get('signal_date') == date or o.get('status') == 'filled' or str(o.get('status', '')).startswith('rejected'))

    def sort_key(o):
        # SELLs first; BUYs by score desc, then symbol for determinism.
        return (0 if o['side'] == 'SELL' else 1, -(o.get('signal_score') or 0), o['symbol'])

    todo = sorted((o for o in orders if eligible(o)), key=sort_key)
    for order in todo:
        symbol = order['symbol']; px = open_prices.get(symbol)
        if not px or px <= 0:
            order['status'] = 'waiting_for_valid_open'; continue
        if order['side'] == 'BUY':
            if symbol in state['positions'] or len(state['positions']) >= cfg['max_positions']:
                order['status'] = 'rejected_risk_gate'; order['resolved_date'] = date; continue
            # Size from current marked equity (not starting capital) and enforce sector limit.
            total_equity = state['cash'] + sum(_mark_value(p) for p in state['positions'].values())
            sector = order.get('industry', 'Unknown')
            sector_value = sum(_mark_value(p) for p in state['positions'].values() if p.get('industry', 'Unknown') == sector)
            max_sector_value = total_equity * float(cfg.get('max_sector_pct', 1.0))
            budget = min(state['cash'], total_equity * cfg['max_position_pct'], max(0.0, max_sector_value - sector_value))
            unit = px * (1 + (cfg['cost_bps_per_side'] + cfg['slippage_bps_per_side']) / 10000)
            qty = int(budget // unit)
            if qty <= 0:
                order['status'] = 'rejected_insufficient_cash'; order['resolved_date'] = date; continue
            notional = qty * px; fee = _cost(notional, cfg)
            state['cash'] -= notional + fee
            state['positions'][symbol] = {'symbol': symbol, 'quantity': qty, 'entry_price': px,
                'entry_date': date, 'entry_fee': fee, 'entry_signal_date': order['signal_date'], 'entry_signal': order.get('signal'),
                'market_segment': 'CASH_EQUITY', 'industry': order.get('industry', 'Unknown'), 'last_price': px,
                'peak_price': px, 'atr': order.get('atr')}
            order.update({'status': 'filled', 'fill_date': date, 'fill_price': px, 'quantity': qty, 'fees': fee})
        else:
            pos = state['positions'].get(symbol)
            if not pos:
                order['status'] = 'rejected_no_position'; order['resolved_date'] = date; continue
            qty = pos['quantity']; notional = qty * px; fee = _cost(notional, cfg)
            state['cash'] += notional - fee
            gross = (px - pos['entry_price']) * qty
            total_costs = fee + pos.get('entry_fee', 0)
            held = sum(1 for x in state['equity_history'] if pos['entry_date'] < str(x.get('date')) <= date)
            state['trades'].append({'symbol': symbol, 'quantity': qty, 'entry_date': pos['entry_date'],
                'entry_price': pos['entry_price'], 'exit_date': date, 'exit_price': px,
                'gross_pnl': round(gross, 2), 'costs': round(total_costs, 2),
                'net_pnl': round(gross - total_costs, 2),
                'return_pct_net': round((gross-total_costs)/(pos['entry_price']*qty)*100, 3),
                'holding_sessions': held, 'entry_signal_date': pos.get('entry_signal_date'),
                'exit_signal_date': order['signal_date'], 'exit_signal': order.get('signal'),
                'entry_signal': pos.get('entry_signal'), 'industry': pos.get('industry', 'Unknown'), 'market_segment': 'CASH_EQUITY'})
            del state['positions'][symbol]
            state.setdefault('cooldowns', {})[symbol] = date
            order.update({'status': 'filled', 'fill_date': date, 'fill_price': px, 'quantity': qty, 'fees': fee})
    state['pending_orders'] = orders
    return state


def queue_signals(state, date, signals, prices_by_symbol):
    """Queue at most one action per symbol/date; fills occur on a later session open.

    Buy candidates are ranked by score and limited to the slots that will be free,
    so the order book never contains more buys than the portfolio can hold.
    """
    state = deepcopy(state)
    if date in state['processed_signal_dates']:
        return state
    cfg = state['config']
    active = [o for o in state['pending_orders'] if _is_active(o)]
    pending_buy = {o['symbol'] for o in active if o.get('side') == 'BUY'}
    pending_sell = {o['symbol'] for o in active if o.get('side') == 'SELL'}
    keys = {(o['symbol'], o['signal_date'], o['side']) for o in state['pending_orders']}

    def make(item, side):
        sym = item['symbol']
        return {'id': f'{date}:{sym}:{side}', 'symbol': sym, 'side': side,
            'signal_date': date, 'status': 'pending_next_open', 'signal': item.get('signal'), 'signal_score': item.get('score'),
            'ruleset_version': item.get('ruleset_version'), 'market_segment': 'CASH_EQUITY',
            'industry': item.get('industry', 'Unknown'), 'reference_close': prices_by_symbol.get(sym),
            'atr': (item.get('technical') or {}).get('ATR14')}

    sells = [i for i in signals if i.get('signal') in ('STRONG SELL', 'SELL') and i.get('symbol') in state['positions']
             and i['symbol'] not in pending_sell and (i['symbol'], date, 'SELL') not in keys]
    # Trailing-stop exits: peak close minus N x ATR. Independent of the rule signal.
    mult = float(cfg.get('atr_stop_mult') or 0)
    by_sym = {i['symbol']: i for i in signals}
    for sym, pos in state['positions'].items():
        px, atr = prices_by_symbol.get(sym), pos.get('atr')
        item = by_sym.get(sym)
        if item and (item.get('technical') or {}).get('ATR14'): atr = item['technical']['ATR14']; pos['atr'] = atr
        peak = max(float(pos.get('peak_price') or 0), float(px or 0))
        if mult and px and atr and sym not in pending_sell and px <= peak - mult * float(atr) and (sym, date, 'SELL') not in keys:
            sells.append({**(item or {'symbol': sym, 'industry': pos.get('industry')}), 'signal': 'STOP', 'symbol': sym})
    for item in sorted(sells, key=lambda i: i['symbol']):
        if item['symbol'] in pending_sell: continue
        state['pending_orders'].append(make(item, 'SELL')); pending_sell.add(item['symbol'])

    slots = cfg['max_positions'] - (len(state['positions']) - len(pending_sell & set(state['positions']))) - len(pending_buy)
    def cooled(sym):
        last = (state.get('cooldowns') or {}).get(sym)
        try: return bool(last) and (_date.fromisoformat(date) - _date.fromisoformat(last)).days < cfg.get('cooldown_days', 0)
        except ValueError: return False
    buys = [i for i in signals if i.get('signal') in ('STRONG BUY', 'BUY') and i.get('symbol')
            and i.get('tradable', True) and not cooled(i['symbol'])
            and i['symbol'] not in state['positions'] and i['symbol'] not in pending_buy
            and (i['symbol'], date, 'BUY') not in keys]
    buys.sort(key=lambda i: (-(i.get('score') or 0), i['symbol']))
    for item in buys[:max(0, slots)]:
        state['pending_orders'].append(make(item, 'BUY'))
    state['processed_signal_dates'].append(date)
    state['processed_signal_dates'] = state['processed_signal_dates'][-400:]
    return state


def mark_to_market(state, date, close_prices):
    state = deepcopy(state)
    invested = 0.0
    for sym, pos in state['positions'].items():
        px = close_prices.get(sym, pos.get('last_price', pos['entry_price']))
        if px and px > 0:
            pos['last_price'] = float(px)
            pos['peak_price'] = max(float(pos.get('peak_price') or 0), float(px))
        pos['market_value'] = pos['quantity'] * pos['last_price']
        pos['unrealised_pnl'] = (pos['last_price'] - pos['entry_price']) * pos['quantity'] - pos.get('entry_fee', 0)
        pos['weight_pct'] = None
        invested += pos['market_value']
    equity = state['cash'] + invested
    for pos in state['positions'].values():
        pos['weight_pct'] = round(pos['market_value'] / equity * 100, 2) if equity else 0
    # Idempotent same-day reruns replace that date's mark rather than duplicate history rows.
    state['equity_history'] = [x for x in state['equity_history'] if x.get('date') != date]
    prev_peak = max([x.get('equity', equity) for x in state['equity_history']] + [equity])
    state['equity_history'].append({'date': date, 'cash': round(state['cash'], 2), 'invested': round(invested, 2),
        'equity': round(equity, 2), 'drawdown_pct': round((equity/prev_peak-1)*100, 3) if prev_peak else 0})
    state['last_updated'] = datetime.now(timezone.utc).isoformat()
    return state
