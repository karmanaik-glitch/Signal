"""Optional free Telegram alerts. No-ops unless TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set.

Watched symbols = current model holdings + symbols listed (one per line) in data/watchlist.txt.
"""
import os
from pathlib import Path


def build_message(snapshot, watch):
    lines = []
    for c in (snapshot.get('changes') or {}).get('items', []):
        if c['symbol'] in watch:
            lines.append(f"{c['symbol']}: {c['from']} → {c['to']} @ {c.get('price')}")
    for o in (snapshot.get('bot') or {}).get('pending_orders', []):
        if o.get('status') == 'pending_next_open' and o.get('signal_date') == snapshot.get('exchange_date'):
            lines.append(f"PAPER ORDER {o['side']} {o['symbol']} ({o.get('signal')}) at next open")
    if not lines: return None
    return f"STRATA {snapshot.get('exchange_date')}\n" + '\n'.join(lines[:30]) + '\n(Model output, not advice.)'


def send_alerts(snapshot, data_dir):
    token, chat = os.getenv('TELEGRAM_BOT_TOKEN'), os.getenv('TELEGRAM_CHAT_ID')
    if not token or not chat: return False
    import requests
    wl = Path(data_dir) / 'watchlist.txt'
    watch = {l.strip().upper() for l in wl.read_text().splitlines() if l.strip()} if wl.exists() else set()
    watch |= set((snapshot.get('bot') or {}).get('positions', {}))
    msg = build_message(snapshot, watch)
    if not msg: return False
    r = requests.post(f'https://api.telegram.org/bot{token}/sendMessage', json={'chat_id': chat, 'text': msg}, timeout=15)
    return r.ok
