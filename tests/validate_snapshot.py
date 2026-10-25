"""Schema gate for snapshot.json: used by CI and importable by the pipeline."""
import json, sys
ALLOWED = {'STRONG BUY', 'BUY', 'HOLD', 'SELL', 'STRONG SELL', 'DATA BLOCKED'}


def validate(d):
    errs = []
    for k in ('schema_version', 'data_mode', 'exchange_date', 'signals', 'bot', 'counts', 'coverage', 'market_regime', 'changes'):
        if k not in d: errs.append(f'missing key {k}')
    if d.get('schema_version') != 3: errs.append('schema_version must be 3')
    seen = set()
    for r in d.get('signals', []):
        if r.get('signal') not in ALLOWED: errs.append(f"{r.get('symbol')}: bad signal {r.get('signal')}")
        if r.get('symbol') in seen: errs.append(f"duplicate {r.get('symbol')}")
        seen.add(r.get('symbol'))
        if r.get('signal') != 'DATA BLOCKED' and not isinstance(r.get('score'), (int, float)): errs.append(f"{r.get('symbol')}: missing score")
        p = r.get('price')
        if p is not None and (not isinstance(p, (int, float)) or p <= 0): errs.append(f"{r.get('symbol')}: bad price")
    if sum(d.get('counts', {}).values()) != len(d.get('signals', [])): errs.append('counts do not sum to signal rows')
    b = d.get('bot', {})
    if b.get('cash', 0) < -1: errs.append('negative cash')
    if len(b.get('positions', {})) > b.get('config', {}).get('max_positions', 10**9): errs.append('too many positions')
    return errs


if __name__ == '__main__':
    e = validate(json.load(open(sys.argv[1])))
    print('\n'.join(e) or 'snapshot OK'); sys.exit(1 if e else 0)
