/**
 * STRATA v3 — Data layer.
 * All data fetching lives here. Never fabricate or hallucinate values.
 * If a field is unavailable, it is null/undefined — callers display '—'.
 */
import { store, num } from './util.js';

export const D = {
  snap: null,
  chartIndex: null,   // app/charts/index.json (symbol → file path)
  chartCache: {},     // per-symbol chart payloads
  bt: null,
  benchmark: null,    // data/benchmark.json or null
  by: {},             // symbol → signal row
  held: new Set(),
  loadedAt: null,
  error: null,
};

// ----- Fetch helper ---------------------------------------------------------

async function j(url) {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(url + ' → ' + r.status);
  return r.json();
}

// ----- Snapshot ------------------------------------------------------------

export async function loadSnapshot() {
  try {
    const s = await j('snapshot.json');
    if (!Array.isArray(s.signals)) throw new Error('snapshot has no signals array');
    D.snap = s;
    D.by = Object.fromEntries(s.signals.map(x => [x.symbol, x]));
    D.held = new Set(Object.keys(s.bot?.positions || {}));
    D.loadedAt = Date.now();
    D.error = null;
  } catch (e) {
    D.error = e.message;
  }
  return D.snap;
}

// ----- Chart data (sharded) ------------------------------------------------

/**
 * Load the chart index file. Falls back gracefully to the legacy monolithic
 * charts.json so the app still works during the transition period.
 */
export async function loadChartIndex() {
  if (D.chartIndex) return D.chartIndex;
  try {
    D.chartIndex = await j('charts/index.json');
  } catch {
    // Legacy: charts.json monolith. Wrap it into the index format.
    try {
      const legacy = await j('charts.json');
      D.chartIndex = { _legacy: legacy };
    } catch {
      D.chartIndex = {};
    }
  }
  return D.chartIndex;
}

/**
 * Load chart data for a single symbol.
 * Returns the chart object or null if unavailable.
 */
export async function loadChart(symbol) {
  if (D.chartCache[symbol] !== undefined) return D.chartCache[symbol];
  const idx = await loadChartIndex();

  // Sharded path
  if (idx[symbol]) {
    try {
      D.chartCache[symbol] = await j(idx[symbol]);
      return D.chartCache[symbol];
    } catch { /* fall through */ }
  }

  // Legacy monolith fallback
  if (idx._legacy) {
    const c = idx._legacy[symbol];
    D.chartCache[symbol] = c && !Array.isArray(c) ? c : null;
    return D.chartCache[symbol];
  }

  D.chartCache[symbol] = null;
  return null;
}

// ----- Backtest ------------------------------------------------------------

export async function loadBacktest() {
  if (D.bt !== null && D.bt !== undefined) return D.bt;
  try { D.bt = await j('backtest.json'); }
  catch { D.bt = false; }
  return D.bt;
}

// ----- Freshness (IST, trading-calendar aware) ----------------------------

/**
 * Returns how many calendar days old the snapshot date is from now (IST).
 * Returns null if the date is unparseable.
 * Note: NSE holidays are not modelled here yet (WP-2); weekend detection only.
 */
export function ageDays() {
  const d = D.snap?.exchange_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return null;
  return Math.floor((Date.now() - Date.parse(d + 'T00:00:00+05:30')) / 864e5);
}

export const isDemo = () => D.snap?.data_mode !== 'LIVE_PIPELINE';

// ----- Stop level ----------------------------------------------------------

export function stopLevel(pos) {
  const m = D.snap?.bot?.config?.atr_stop_mult;
  return num(pos?.peak_price) && num(pos?.atr) && m
    ? pos.peak_price - m * pos.atr
    : null;
}

// ----- Signal level map ----------------------------------------------------

export const lvl = { 'STRONG BUY': 2, 'BUY': 1, 'HOLD': 0, 'SELL': -1, 'STRONG SELL': -2 };

// ----- Watchlists (localStorage, versioned) --------------------------------

const WL_VERSION = 2;

function wlDefault() {
  return {
    _version: WL_VERSION,
    lists: [{ id: 'main', name: 'My Watchlist', symbols: [], created: new Date().toISOString() }],
    active: 'main',
  };
}

function migrateWL(w) {
  if (!w) return wlDefault();
  // v1 → v2: add _version and created fields
  if (!w._version) {
    w._version = WL_VERSION;
    (w.lists || []).forEach(l => { if (!l.created) l.created = new Date(0).toISOString(); });
  }
  if (!w.lists?.length) w.lists = wlDefault().lists;
  if (!w.active) w.active = w.lists[0].id;
  return w;
}

export const WL = {
  all() {
    const raw = store.get('watchlists', null);
    return migrateWL(raw ? JSON.parse(JSON.stringify(raw)) : null);
  },
  save(w) { store.set('watchlists', { ...w, _version: WL_VERSION }); },
  active() { const w = this.all(); return w.lists.find(l => l.id === w.active) || w.lists[0]; },

  /** Returns all lists that include this symbol */
  listsFor(sym) { return this.all().lists.filter(l => l.symbols.includes(sym)); },

  /** Returns true if sym is in ANY list */
  has(sym) { return this.all().lists.some(l => l.symbols.includes(sym)); },

  /** Toggle sym in the currently-active list (legacy behaviour) */
  toggle(sym) {
    const w = this.all();
    const l = w.lists.find(x => x.id === w.active) || w.lists[0];
    l.symbols = l.symbols.includes(sym)
      ? l.symbols.filter(s => s !== sym)
      : [...l.symbols, sym];
    this.save(w);
  },

  /** Add sym to a specific list by id; no-op if already present */
  addTo(sym, listId) {
    const w = this.all();
    const l = w.lists.find(x => x.id === listId);
    if (l && !l.symbols.includes(sym)) l.symbols.push(sym);
    this.save(w);
  },

  /** Remove sym from a specific list by id */
  removeFrom(sym, listId) {
    const w = this.all();
    const l = w.lists.find(x => x.id === listId);
    if (l) l.symbols = l.symbols.filter(s => s !== sym);
    this.save(w);
  },

  import(obj) {
    if (!obj || !Array.isArray(obj.lists)) throw new Error('Not a STRATA watchlist export');
    const lists = obj.lists.slice(0, 20).map((l, i) => ({
      id: 'l' + Date.now() + i,
      name: String(l.name || 'List').slice(0, 40),
      symbols: [...new Set((l.symbols || []).map(s => String(s).toUpperCase().replace(/[^A-Z0-9&_-]/g, '')).filter(Boolean))].slice(0, 500),
      created: l.created || new Date().toISOString(),
    }));
    if (!lists.length) throw new Error('No lists found');
    this.save({ _version: WL_VERSION, lists, active: lists[0].id });
  },
};
