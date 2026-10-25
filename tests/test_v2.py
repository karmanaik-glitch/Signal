import sys, types, unittest
from pathlib import Path
import numpy as np, pandas as pd
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'engine'))
from rules import score_stock, is_financial
from portfolio import initial_state, queue_signals, process_open, mark_to_market
from backtest import run_backtest
from indicators import enrich_ohlcv
from notify import build_message
try: import yfinance  # noqa
except ImportError: sys.modules['yfinance'] = types.ModuleType('yfinance')
from run_pipeline import build_changes

FUND = {'ROE_pct': 20, 'Debt_Equity': 400, 'Revenue_Growth_pct': 15, 'PE_Ratio': 20}
TECH = {'Close': 150, 'SMA50': 120, 'SMA200': 100, 'RSI14': 55, 'MACD': 5, 'MACD_SIGNAL': 2, 'RETURN_20D': 12}


class RuleV4(unittest.TestCase):
    def test_bank_not_penalised_for_leverage(self):
        bank = score_stock(TECH, {**FUND, 'industry': 'Financial Services'})
        corp = score_stock(TECH, {**FUND, 'industry': 'Industrials'})
        self.assertGreater(bank['fundamental_score'], corp['fundamental_score'])
        self.assertTrue(is_financial('Private Sector Bank'))

    def test_exit_needs_two_percent_buffer(self):
        t = {'Close': 99, 'SMA50': 100, 'SMA200': 90, 'RSI14': 36, 'MACD': 1, 'MACD_SIGNAL': 2, 'RETURN_20D': -5}
        self.assertEqual(score_stock(t, FUND)['signal'], 'HOLD')           # 1% under: whipsaw zone
        self.assertEqual(score_stock({**t, 'Close': 95}, FUND)['signal'], 'SELL')


def _sig(sym, signal='BUY', **kw): return {'symbol': sym, 'signal': signal, 'score': 80, 'industry': 'X', 'technical': {'ATR14': 5}, **kw}


class PortfolioV2(unittest.TestCase):
    def test_illiquid_never_bought(self):
        s = queue_signals(initial_state(), '2026-01-05', [_sig('THIN', tradable=False), _sig('OK')], {'THIN': 10, 'OK': 10})
        self.assertEqual([o['symbol'] for o in s['pending_orders']], ['OK'])

    def test_trailing_stop_queues_exit(self):
        s = initial_state()
        s['positions']['A'] = {'symbol': 'A', 'quantity': 10, 'entry_price': 100, 'peak_price': 150, 'atr': 5, 'entry_date': '2026-01-01', 'last_price': 100, 'industry': 'X'}
        s = queue_signals(s, '2026-01-10', [_sig('A', 'HOLD')], {'A': 134})   # 150 - 3*5 = 135 > 134
        self.assertTrue(any(o['side'] == 'SELL' and o['signal'] == 'STOP' for o in s['pending_orders']))
        s2 = initial_state(); s2['positions']['A'] = {**s['positions']['A']}
        s2 = queue_signals(s2, '2026-01-10', [_sig('A', 'HOLD')], {'A': 140})
        self.assertFalse(s2['pending_orders'])

    def test_cooldown_blocks_reentry(self):
        s = initial_state(); s['cooldowns'] = {'A': '2026-01-05'}
        self.assertFalse(queue_signals(s, '2026-01-10', [_sig('A')], {'A': 10})['pending_orders'])
        self.assertTrue(queue_signals(s, '2026-02-10', [_sig('A')], {'A': 10})['pending_orders'])


class Backtest(unittest.TestCase):
    def test_random_walks_have_no_edge(self):
        """If the engine peeked at the future, iid random walks would show a large positive edge."""
        frames = {}
        for k in range(25):
            rng = np.random.default_rng(k); idx = pd.bdate_range('2022-01-03', periods=700)
            c = 100 * np.exp(np.cumsum(rng.normal(0.0003, 0.016, 700)))
            df = pd.DataFrame({'Open': c * (1 + rng.normal(0, .003, 700)), 'High': c * 1.01, 'Low': c * .99, 'Close': c, 'Volume': np.full(700, 5e6)}, index=idx)
            frames[f'S{k}'] = enrich_ohlcv(df)
        bench = pd.Series(100 * np.exp(np.cumsum(np.random.default_rng(99).normal(0.0003, 0.012, 700))), index=frames['S0'].index)
        out = run_backtest(frames, bench)
        self.assertIsNotNone(out)
        self.assertLess(out['strategy']['cagr_pct'], 15)
        self.assertEqual(len(out['dates']), len(out['equity']))


class Feed(unittest.TestCase):
    def test_changes_and_alert(self):
        prev = {'data_mode': 'LIVE_PIPELINE', 'exchange_date': '2026-01-01', 'signals': [{'symbol': 'A', 'signal': 'HOLD', 'score': 50}, {'symbol': 'B', 'signal': 'BUY', 'score': 75}]}
        rows = [{'symbol': 'A', 'signal': 'STRONG BUY', 'score': 90, 'price': 10, 'change_pct': 1}, {'symbol': 'B', 'signal': 'BUY', 'score': 76}]
        c = build_changes(prev, rows, '2026-01-02')
        self.assertEqual((c['upgrades'], c['downgrades'], len(c['items'])), (1, 0, 1))
        self.assertFalse(build_changes({}, rows, '2026-01-02')['available'])
        self.assertIn('A: HOLD → STRONG BUY', build_changes(prev, rows, '2026-01-02') and build_message({'exchange_date': 'd', 'changes': c, 'bot': {}}, {'A'}))
        self.assertIsNone(build_message({'changes': c, 'bot': {}}, {'ZZZ'}))


if __name__ == '__main__': unittest.main()
