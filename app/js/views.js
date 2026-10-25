/**
 * STRATA Markets v3.0 — View modules.
 *
 * Exports:
 *   home(el, params, toast)
 *   signals(el, params, toast)
 *   watchlist(el, params, toast)
 *   rulebot(el, params, toast)
 *   more(el, params, toast)
 *   stockView(el, sym, toast)       ← one shared implementation
 *
 * All stock navigation uses data-stock="SYM" attributes.
 * No inline style= attributes — use CSS classes only.
 */
import { $, $$, esc, num, f2, f0, inr, pct, cls, SIGS, badge, scoreBar, store, csv, download, spark } from './util.js';
import { D, WL, lvl, loadChart, loadBacktest, ageDays, isDemo, stopLevel } from './data.js';
import { navigate, goBack, peekPrevious } from './router.js';
import { mount } from './charts.js';

// ---- Shared helpers -------------------------------------------------------

const S    = () => D.snap;
const sigs = () => S().signals || [];

const symCell = r =>
  `<td class="sym" data-stock="${esc(r.symbol)}" tabindex="0" role="link" aria-label="Open ${esc(r.symbol)}">` +
  `${esc(r.symbol)}<small>${esc(r.company)}</small></td>`;

const rowAttr = s =>
  `data-stock="${esc(s)}" tabindex="0" role="link" aria-label="Open ${esc(s)}"`;

const panel = (title, body, subtitle = '', flush = true) =>
  `<section class="panel"><div class="panel-header"><h2>${title}</h2>` +
  (subtitle ? `<span class="dimmed">${subtitle}</span>` : '') +
  `</div><div class="panel-body${flush ? ' flush' : ''}">${body}</div></section>`;

const kpiCard = (label, value, sub = '', colorClass = '') =>
  `<div class="kpi-card"><div class="kpi-label">${label}</div>` +
  `<div class="kpi-value ${colorClass}">${value}</div>` +
  `<div class="kpi-sub">${sub}</div></div>`;

const empty = (msg, icon = '–') =>
  `<div class="empty"><div class="empty-icon">${icon}</div><div class="empty-title">${esc(msg)}</div></div>`;

// Charts cleanup on navigation
const _charts = [];
export const disposeCharts = () => _charts.splice(0).forEach(c => c?.destroy?.());

const chartBox = (id, cssH = '360px') =>
  `<div class="chartbox" style="--chart-h:${cssH}"><canvas id="${id}" role="img" aria-label="Chart"></canvas>` +
  `<div class="chart-tip" id="${id}Tip" hidden></div></div>`;

const plotChart = (id, cfg) => {
  const c = document.getElementById(id);
  if (c) _charts.push(mount(c, document.getElementById(id + 'Tip'), cfg));
};

// ====================================================================
// HOME — Market cockpit
// ====================================================================

export function home(root) {
  const s = S(), b = s.benchmark || {}, mr = s.market_regime;
  const rows = sigs().filter(r => r.data_quality !== 'BLOCKED');
  const adv  = rows.filter(r => r.change_pct > 0).length;
  const dec  = rows.filter(r => r.change_pct < 0).length;
  const unch = rows.length - adv - dec;
  const total = SIGS.reduce((a, k) => a + (s.counts?.[k] || 0), 0) || 1;
  const g = mr?.score;
  const gp = num(g) ? (g + 100) / 2 : 50;

  // Signal distribution colours — must match CSS sig- classes but expressed as inline SVG fill
  // We use CSS custom properties here, not hardcoded hex
  const sigColMap = {
    'STRONG BUY': 'var(--sig-sb)', 'BUY': 'var(--sig-b)', 'HOLD': 'var(--sig-h)',
    'SELL': 'var(--sig-s)', 'STRONG SELL': 'var(--sig-ss)', 'DATA BLOCKED': 'var(--sig-x)'
  };

  const movers = [...rows].filter(r => num(r.change_pct)).sort((a, b) => b.change_pct - a.change_pct);
  const moverTable = list =>
    `<div class="table-wrap auto"><table><tbody>` +
    list.map(r =>
      `<tr ${rowAttr(r.symbol)}>${symCell(r)}` +
      `<td class="n mono">${f2(r.price)}</td>` +
      `<td class="n ${cls(r.change_pct)} mono">${pct(r.change_pct)}</td>` +
      `<td>${badge(r.signal)}</td></tr>`
    ).join('') + `</tbody></table></div>`;

  const sectors = (s.sector_rotation || []).map(x => {
    const t = x.avg_change_1d_pct, pos = (t || 0) >= 0;
    const alpha = Math.min(60, Math.round((Math.abs(t || 0) / 4 + 0.08) * 100));
    const bg = `color-mix(in srgb,${pos ? 'var(--pos)' : 'var(--neg)'} ${alpha}%,var(--bg-raised))`;
    return `<button class="heat-tile" data-sector="${esc(x.industry)}" style="background:${bg}">` +
      `<div class="heat-tile-name">${esc(x.industry)}</div>` +
      `<div class="heat-tile-pct ${cls(t)}">${pct(t, 1)}</div>` +
      `<div class="heat-tile-meta">${x.bullish_setups}↑ ${x.bearish_setups}↓ · ${x.symbols} stocks</div></button>`;
  }).join('');

  // Market Overview Cards
  const idxCard = (title, tag, val, chg, sub = '') => {
    const hasVal = num(val);
    const hasChg = num(chg);
    return `<div class="index-card">` +
      `<div class="index-card-head">` +
        `<span class="index-card-title">${title}</span>` +
        `<span class="index-card-tag">${tag}</span>` +
      `</div>` +
      `<div class="index-card-val mono">${hasVal ? f2(val) : '—'}</div>` +
      `<div class="index-card-foot">` +
        (hasChg ? `<span class="index-card-chg mono ${cls(chg)}">${chg >= 0 ? '▲ ' : '▼ '}${pct(chg)}</span>` : '<span class="dimmed">—</span>') +
        (sub ? `<span class="index-card-sub dimmed">${sub}</span>` : '') +
      `</div>` +
    `</div>`;
  };

  const formatRegimeComponent = k => {
    const map = {
      trend: 'Trend',
      breadth: 'Breadth',
      rsi_momentum: 'RSI Momentum',
      volatility_penalty: 'Volatility Penalty'
    };
    return map[k] || k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  root.innerHTML = `<div class="page">
    <h1>Market <span class="page-title-sub">${esc(s.universe_label || '')} · ${esc(s.exchange_date)}</span></h1>

    <!-- Market Overview Grid -->
    <div class="grid g4">
      ${idxCard('NIFTY 50', 'NSE Benchmark', b.nifty50_close, b.nifty50_change_pct, num(b.return_20d_pct) ? `20D ${pct(b.return_20d_pct)}` : 'Large Cap')}
      ${idxCard('SENSEX', 'BSE Benchmark', b.sensex_close, b.sensex_change_pct, 'Blue Chip')}
      ${idxCard('BANK NIFTY', 'Banking Sector', b.banknifty_close, b.banknifty_change_pct, 'Financials')}
      ${idxCard('INDIA VIX', 'Volatility', b.india_vix, b.india_vix_change_20d_pct, num(b.india_vix) ? (b.india_vix < 16 ? 'Low Volatility' : 'Elevated') : 'Implied Vol')}
    </div>

    <!-- Breadth + Regime -->
    <div class="grid g2">
      ${panel('Market breadth', `
        <div class="panel-body">
          <div class="grid g3" style="margin-bottom:12px">
            <div><div class="dimmed">Advancing</div><div class="kpi-value up">${adv}</div></div>
            <div><div class="dimmed">Declining</div><div class="kpi-value dn">${dec}</div></div>
            <div><div class="dimmed">Unchanged</div><div class="kpi-value">${unch}</div></div>
          </div>
          <div class="sig-stack">
            ${SIGS.map(k => `<span title="${k}: ${s.counts?.[k] || 0}" style="width:${(s.counts?.[k] || 0) / total * 100}%;background:${sigColMap[k]}"></span>`).join('')}
          </div>
          <div class="pills" style="margin-top:10px">
            ${SIGS.map(k => `<button class="pill" data-sig="${k}" style="color:${sigColMap[k]}">${k} · ${s.counts?.[k] || 0}</button>`).join('')}
          </div>
        </div>`)}
      ${panel('Market regime', `
        <div class="panel-body">
          <div class="kpi-value" style="font-size:18px;margin-bottom:10px">${esc(mr?.label || 'n/a')} <span class="dimmed" style="font-size:14px">${num(g) ? g.toFixed(0) : ''}</span></div>
          <div class="gauge"><div class="gauge-needle" style="left:${gp}%"></div></div>
          <dl class="kv" style="margin-top:14px">
            ${Object.entries(mr?.components || {}).map(([k, v]) =>
              `<dt>${esc(formatRegimeComponent(k))}</dt><dd class="${cls(k === 'volatility_penalty' ? -v : v)}">${num(v) ? v.toFixed(2) : '—'}</dd>`
            ).join('')}
          </dl>
          <p class="dimmed" style="margin-top:8px;font-size:11px">Heuristic from benchmark trend, breadth, RSI and VIX. A caution flag, not a forecast.</p>
        </div>`)}
    </div>

    <!-- Sector heatmap -->
    ${panel('Sector heatmap', `<div class="panel-body"><div class="heatmap">${sectors || empty('No sector data')}</div></div>`, '1-day move · setup tilt')}

    <!-- Movers -->
    <div class="grid g2">
      ${panel('Top gainers', moverTable(movers.slice(0, 8)))}
      ${panel('Top losers',  moverTable(movers.slice(-8).reverse()))}
    </div>

    <!-- What changed teaser -->
    ${(() => { const c = S().changes; if (!c?.available) return ''; const ords = (S().bot?.pending_orders || []).filter(o => !String(o.status).startsWith('rejected') && o.status !== 'filled'); return panel('What changed', `<div class="panel-body"><div class="grid g4">
      ${kpiCard('Upgrades', c.upgrades ?? 0, '', 'up')}
      ${kpiCard('Downgrades', c.downgrades ?? 0, '', 'dn')}
      ${kpiCard('Orders queued', ords.length, 'paper trades')}
      ${kpiCard('Total changes', c.items.length, `${esc(c.from)} → ${esc(c.to)}`)}
    </div><div style="margin-top:10px"><a href="#/signals" class="btn btn-ghost btn-sm" data-route="signals">View all changes →</a></div></div>`); })()}
  </div>`;

  // Wire sector click → signals with sector filter
  root.addEventListener('click', e => {
    const sBtn = e.target.closest('[data-sig]');
    if (sBtn) { store.set('screener', { ...store.get('screener', {}), sigs: [sBtn.dataset.sig] }); navigate('#/signals?tab=screener'); }
    const hBtn = e.target.closest('[data-sector]');
    if (hBtn) { store.set('screener', { ...store.get('screener', {}), sector: hBtn.dataset.sector, sigs: [] }); navigate('#/signals?tab=screener'); }
  });
}

// ====================================================================
// SIGNALS — Screener / Changes / History
// ====================================================================

export function signals(root, params, toast) {
  const qs = new URLSearchParams(params?.includes('?') ? params.split('?')[1] : '');
  const initTab = qs.get('tab') || store.get('signals-tab', 'screener');

  const tabs = [
    ['screener', 'Screener'],
    ['changes',  'Changes'],
    ['history',  'History'],
  ];

  root.innerHTML = `<div class="page">
    <h1>Signals</h1>
    <div class="panel">
      <div class="tab-bar" role="tablist" id="sigTabs">
        ${tabs.map(([id, lbl]) =>
          `<button class="tab-item" role="tab" aria-selected="${id === initTab}" aria-controls="sigPanel-${id}" id="sigTab-${id}">${lbl}</button>`
        ).join('')}
      </div>
      <div id="sigContent"></div>
    </div>
  </div>`;

  function switchTab(tabId) {
    store.set('signals-tab', tabId);
    $$('#sigTabs .tab-item').forEach(b => b.setAttribute('aria-selected', b.id === `sigTab-${tabId}`));
    const content = $('#sigContent');
    content.innerHTML = '';
    if (tabId === 'screener') renderScreener(content, toast);
    else if (tabId === 'changes') renderChanges(content);
    else renderHistory(content);
  }

  $('#sigTabs').addEventListener('click', e => {
    const btn = e.target.closest('.tab-item');
    if (btn) switchTab(btn.id.replace('sigTab-', ''));
  });

  switchTab(initTab);
}

// ---- Screener tab ----------------------------------------------------------

const COLS = [
  ['symbol', 'Symbol',   r => r.symbol,                       'sym'],
  ['signal', 'Signal',   r => lvl[r.signal] ?? -9,            ''],
  ['score',  'Score',    r => r.score ?? -1,                   ''],
  ['price',  'Price',    r => r.price,                         'n'],
  ['chg',    '1D',       r => r.change_pct,                    'n'],
  ['rsi',    'RSI',      r => r.technical?.RSI14,              'n'],
  ['s50',    'vs SMA50', r => dist(r, 'SMA50'),                'n hide-s'],
  ['rs',     'RS 20D',   r => r.technical?.RELATIVE_STRENGTH_20D, 'n hide-s'],
  ['vol',    'Vol×',     r => r.technical?.VOLUME_RATIO20,     'n hide-s'],
  ['tv',     'Traded',   r => r.technical?.TRADED_VALUE20,     'n hide-s'],
  ['setup',  'Setup',    r => r.setup_type || '',              'hide-s'],
];
const dist = (r, k) =>
  num(r.technical?.[k]) && num(r.technical?.Close)
    ? (r.technical.Close / r.technical[k] - 1) * 100 : null;

function renderScreener(root, toast) {
  const saved = store.get('screener-saved-filters', {});
  const st = {
    q: '', sigs: [], sector: '', min: 0, liquid: false, held: false,
    sort: 'score', dir: -1, limit: 100,
    ...store.get('screener', {})
  };
  const sectors = [...new Set(sigs().map(r => r.industry))].sort();

  const run = () => {
    const q = st.q.trim().toUpperCase();
    let r = sigs().filter(x =>
      (!q || x.symbol.includes(q) || (x.company || '').toUpperCase().includes(q)) &&
      (!st.sigs.length || st.sigs.includes(x.signal)) &&
      (!st.sector || x.industry === st.sector) &&
      (x.score ?? 0) >= st.min &&
      (!st.liquid || x.liquid !== false) &&
      (!st.held || D.held.has(x.symbol))
    );
    const col = COLS.find(c => c[0] === st.sort) || COLS[2];
    r.sort((a, b) => {
      const A = col[2](a), B = col[2](b);
      if (A == null || A === '') return 1;
      if (B == null || B === '') return -1;
      return (A > B ? 1 : A < B ? -1 : 0) * st.dir || a.symbol.localeCompare(b.symbol);
    });
    return r;
  };

  root.innerHTML = `
    <div class="bar">
      <input type="search" id="scQ" class="input" placeholder="Filter symbol / company" aria-label="Filter" value="${esc(st.q)}">
      <select id="scSec" aria-label="Sector">
        <option value="">All sectors</option>
        ${sectors.map(s => `<option${s === st.sector ? ' selected' : ''}>${esc(s)}</option>`).join('')}
      </select>
      <label class="dimmed" style="display:flex;align-items:center;gap:6px;font-size:12px">Min score <input type="number" id="scMin" class="input" min="0" max="100" step="5" value="${st.min}" style="width:64px"></label>
      <label class="dimmed" style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="scLiq"${st.liquid ? ' checked' : ''}> Liquid only</label>
      <label class="dimmed" style="display:flex;align-items:center;gap:6px;font-size:12px"><input type="checkbox" id="scHeld"${st.held ? ' checked' : ''}> Held by bot</label>
      <div class="bar-right">
        <button class="btn btn-sm" id="scSave">Save filter</button>
        <button class="btn btn-sm" id="scCsv">Export CSV</button>
        <button class="btn btn-sm btn-ghost" id="scReset">Reset</button>
      </div>
    </div>
    <div class="bar pills" id="scSigs">
      ${SIGS.map(k => `<button class="pill" data-s="${k}" aria-pressed="${st.sigs.includes(k)}">${k}</button>`).join('')}
    </div>
    ${Object.keys(saved).length ? `<div class="bar" id="scSavedBar" style="gap:6px">
      <span class="dimmed" style="font-size:11px">Saved:</span>
      ${Object.keys(saved).map(n => `<button class="pill" data-saved="${esc(n)}">${esc(n)}</button>`).join('')}
    </div>` : ''}
    <div class="table-wrap"><table><thead><tr id="scHead"></tr></thead><tbody id="scBody"></tbody></table></div>
    <div class="bar" id="scMore"></div>`;

  let currentRows = [];
  const draw = () => {
    store.set('screener', { q: st.q, sigs: st.sigs, sector: st.sector, min: st.min, liquid: st.liquid, held: st.held, sort: st.sort, dir: st.dir });
    currentRows = run();
    const header = $('#scHead');
    const body   = $('#scBody');
    const count  = root.closest('.page')?.querySelector('h1');
    if (count) count.childNodes[0].textContent = `Signals`;

    header.innerHTML = COLS.map(c =>
      `<th class="${c[3]} sortable" data-k="${c[0]}" tabindex="0" aria-sort="${st.sort === c[0] ? (st.dir > 0 ? 'ascending' : 'descending') : 'none'}">${c[1]}</th>`
    ).join('');

    body.innerHTML = currentRows.slice(0, st.limit).map(x =>
      `<tr ${rowAttr(x.symbol)}>${symCell(x)}` +
      `<td>${badge(x.signal)}${x.liquid === false ? ' <span class="warn" title="Illiquid: not paper-traded">◔</span>' : ''}</td>` +
      `<td>${scoreBar(x.score)}</td>` +
      `<td class="n mono">${f2(x.price)}</td>` +
      `<td class="n ${cls(x.change_pct)} mono">${pct(x.change_pct)}</td>` +
      `<td class="n mono">${f0(x.technical?.RSI14)}</td>` +
      `<td class="n hide-s ${cls(dist(x, 'SMA50'))} mono">${pct(dist(x, 'SMA50'), 1)}</td>` +
      `<td class="n hide-s ${cls(x.technical?.RELATIVE_STRENGTH_20D)} mono">${pct(x.technical?.RELATIVE_STRENGTH_20D, 1)}</td>` +
      `<td class="n hide-s mono">${f2(x.technical?.VOLUME_RATIO20)}</td>` +
      `<td class="n hide-s mono">${inr(x.technical?.TRADED_VALUE20)}</td>` +
      `<td class="hide-s">${esc(x.setup_type || '')}</td></tr>`
    ).join('') || `<tr><td colspan="11">${empty('No stocks match these filters.')}</td></tr>`;

    $('#scMore').innerHTML = currentRows.length > st.limit
      ? `<button class="btn btn-sm" id="scShowMore">Show ${Math.min(200, currentRows.length - st.limit)} more</button><span class="dimmed">${st.limit} of ${currentRows.length}</span>`
      : `<span class="dimmed">${currentRows.length} results</span>`;

    $$('#scSigs .pill').forEach(p => p.setAttribute('aria-pressed', st.sigs.includes(p.dataset.s)));
  };

  const sortBy = k => { st.dir = st.sort === k ? -st.dir : (k === 'symbol' || k === 'setup' ? 1 : -1); st.sort = k; draw(); };
  root.addEventListener('click', e => {
    const th = e.target.closest('th[data-k]'); if (th) { sortBy(th.dataset.k); return; }
    const pl = e.target.closest('.pill[data-s]'); if (pl) { const k = pl.dataset.s; st.sigs = st.sigs.includes(k) ? st.sigs.filter(x => x !== k) : [...st.sigs, k]; st.limit = 100; draw(); return; }
    const sv = e.target.closest('[data-saved]'); if (sv) { const f = saved[sv.dataset.saved]; if (f) { Object.assign(st, f); draw(); } return; }
    if (e.target.id === 'scShowMore') { st.limit += 200; draw(); }
  });
  root.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('th[data-k]')) sortBy(e.target.dataset.k); });

  const bind = (id, fn, ev = 'input') => $(id)?.addEventListener(ev, e => { fn(e.target); st.limit = 100; draw(); });
  bind('#scQ', t => st.q = t.value);
  bind('#scSec', t => st.sector = t.value, 'change');
  bind('#scMin', t => st.min = +t.value || 0);
  bind('#scLiq', t => st.liquid = t.checked, 'change');
  bind('#scHeld', t => st.held = t.checked, 'change');

  $('#scReset')?.addEventListener('click', () => { Object.assign(st, { q: '', sigs: [], sector: '', min: 0, liquid: false, held: false }); draw(); });
  $('#scSave')?.addEventListener('click', () => {
    const n = prompt('Save filter as:'); if (!n?.trim()) return;
    const sf = store.get('screener-saved-filters', {});
    sf[n.trim()] = { q: st.q, sigs: [...st.sigs], sector: st.sector, min: st.min, liquid: st.liquid, held: st.held };
    store.set('screener-saved-filters', sf);
    toast('Filter saved: ' + n.trim());
  });
  $('#scCsv')?.addEventListener('click', () =>
    download(`signal-screener-${S().exchange_date}.csv`,
      csv(currentRows, ['symbol','company','industry','signal','score','price','change_pct','rsi','setup']),
      'text/csv')
  );
  draw();
}

// ---- Changes tab -----------------------------------------------------------

function renderChanges(root) {
  const c = S().changes;
  if (!c?.available) {
    root.innerHTML = panel('Since last session',
      empty(isDemo() && !c?.items?.length ? 'No prior session to compare yet.' : 'Needs two consecutive live sessions. The feed fills after the second pipeline run.'));
    return;
  }
  const group = (t, k) => {
    const items = c.items.filter(x => x.kind === k);
    return panel(`${t} · ${items.length}`, items.length
      ? `<ul class="feed">${items.map(x =>
          `<li class="feed-item" ${rowAttr(x.symbol)}>
            <strong>${esc(x.symbol)}</strong>
            ${badge(x.from)}<span class="feed-arrow">→</span>${badge(x.to)}
            <div class="feed-right">
              <span class="mono muted hide-s">${num(x.score_from) ? x.score_from.toFixed(0) : '—'} → ${num(x.score_to) ? x.score_to.toFixed(0) : '—'}</span>
              <span class="mono ${cls(x.change_pct)}">${pct(x.change_pct)}</span>
            </div>
          </li>`).join('')}</ul>`
      : empty('None'));
  };
  const orders = (S().bot?.pending_orders || []).filter(o => !String(o.status).startsWith('rejected') && o.status !== 'filled');
  root.innerHTML = `
    <div class="panel-body">
      <div class="grid g4">
        ${kpiCard('Upgrades', c.upgrades ?? 0, '', 'up')}
        ${kpiCard('Downgrades', c.downgrades ?? 0, '', 'dn')}
        ${kpiCard('Orders queued', orders.length, 'paper trades')}
        ${kpiCard('Total changes', c.items.length, `${esc(c.from)} → ${esc(c.to)}`)}
      </div>
    </div>
    <div class="grid g2" style="padding:12px">
      ${group('Upgrades', 'upgrade')}${group('Downgrades', 'downgrade')}
    </div>
    ${orders.length ? panel('Orders queued by Rule Bot', `<ul class="feed">${orders.map(o =>
      `<li class="feed-item" ${rowAttr(o.symbol)}>
        <strong>${esc(o.symbol)}</strong>
        <span class="sig${o.side === 'BUY' ? ' sig-b' : ' sig-s'}">${o.side}</span>
        ${badge(o.signal)}
        <span class="muted" style="margin-left:auto">${esc(String(o.status).replace(/_/g, ' '))}</span>
      </li>`).join('')}</ul>`) : ''}`;
}

// ---- History tab -----------------------------------------------------------

function renderHistory(root) {
  root.innerHTML = panel('Signal history', empty('Signal history is stored in data/history/*.json.gz and will be available after the first live pipeline run. Once available, select a symbol to see its full signal timeline.', '📊'));
}

// ====================================================================
// WATCHLIST
// ====================================================================

export function watchlist(root, _params, toast) {
  const draw = () => {
    const w = WL.all(), l = WL.active();
    const rows = l.symbols.map(s => D.by[s] || { symbol: s, company: 'Not in universe', missing: true });

    root.innerHTML = `<div class="page">
      <h1>Watchlist</h1>
      <section class="panel">
        <div class="bar">
          <select id="wSel" aria-label="Select watchlist">
            ${w.lists.map(x => `<option value="${esc(x.id)}"${x.id === l.id ? ' selected' : ''}>${esc(x.name)} (${x.symbols.length})</option>`).join('')}
          </select>
          <button class="btn btn-sm" id="wNew">+ New list</button>
          <button class="btn btn-sm" id="wRen">Rename</button>
          <button class="btn btn-sm btn-danger" id="wDel">Delete</button>
          <div class="bar-right">
            <input type="text" id="wAdd" class="input" placeholder="Add symbol, e.g. TCS" aria-label="Add symbol" list="wSymlist" style="width:160px">
            <datalist id="wSymlist">${sigs().map(r => `<option value="${esc(r.symbol)}">`).join('')}</datalist>
            <button class="btn btn-primary btn-sm" id="wAddB">Add</button>
            <button class="btn btn-sm" id="wExp"><svg width="14" height="14"><use href="#i-export"/></svg> Export</button>
            <label class="btn btn-sm"><svg width="14" height="14"><use href="#i-import"/></svg> Import<input type="file" id="wImp" accept="application/json" hidden></label>
          </div>
        </div>
        <div class="table-wrap auto"><table>
          <thead><tr>
            <th style="width:28px"></th>
            <th>Symbol</th><th>Signal</th><th>Score</th>
            <th class="n">Price</th><th class="n">1D</th>
            <th class="n hide-s">RSI</th>
            <th class="dimmed" style="font-size:11px">Session</th>
            <th style="width:80px"></th>
          </tr></thead>
          <tbody>${rows.length ? rows.map((r, i) => r.missing
            ? `<tr>
                <td class="drag-handle" data-drag-i="${i}" title="Drag to reorder" aria-label="Reorder"><svg width="14" height="14"><use href="#i-grip"/></svg></td>
                <td class="sym">${esc(r.symbol)}<small>${esc(r.company)}</small></td>
                <td colspan="6" class="dimmed">Not in current universe</td>
                <td>
                  <button class="btn btn-sm btn-danger" data-rm="${esc(r.symbol)}" aria-label="Remove ${esc(r.symbol)}">✕</button>
                </td>
              </tr>`
            : `<tr ${rowAttr(r.symbol)} data-drag-i="${i}">
                <td class="drag-handle" title="Drag to reorder" aria-label="Reorder"><svg width="14" height="14"><use href="#i-grip"/></svg></td>
                ${symCell(r)}
                <td>${badge(r.signal)}</td>
                <td>${scoreBar(r.score)}</td>
                <td class="n mono">${f2(r.price)}</td>
                <td class="n ${cls(r.change_pct)} mono">${pct(r.change_pct)}</td>
                <td class="n hide-s mono">${f0(r.technical?.RSI14)}</td>
                <td class="dimmed" style="font-size:11px">${esc(r.date || '')}</td>
                <td style="display:flex;gap:4px;align-items:center">
                  <button class="btn btn-sm btn-ghost" data-mv="${esc(r.symbol)}" title="Move to list" aria-label="Move ${esc(r.symbol)} to another list">⇄</button>
                  <button class="btn btn-sm btn-danger" data-rm="${esc(r.symbol)}" aria-label="Remove ${esc(r.symbol)}">✕</button>
                </td>
              </tr>`
          ).join('') : `<tr><td colspan="9">${empty('Empty list. Add a symbol above or use ★ on any stock page.')}</td></tr>`}
          </tbody>
        </table></div>
      </section>
      <p class="dimmed" style="font-size:12px">Lists are stored in this browser only. Export JSON to back up or transfer devices.</p>
    </div>`;

    // Wire list selector
    $('#wSel').onchange = e => { const w2 = WL.all(); w2.active = e.target.value; WL.save(w2); draw(); };

    // Add
    const add = () => {
      const v = $('#wAdd').value.trim().toUpperCase().replace(/\.NS$/, '');
      if (!v) return;
      if (!/^[A-Z0-9&_-]{1,20}$/.test(v)) { toast('Invalid symbol'); return; }
      const w2 = WL.all(), k = w2.lists.find(x => x.id === w2.active);
      if (!k.symbols.includes(v)) k.symbols.push(v);
      WL.save(w2); draw();
    };
    $('#wAddB').onclick = add;
    $('#wAdd').onkeydown = e => { if (e.key === 'Enter') add(); };

    // New / rename / delete
    $('#wNew').onclick = () => {
      const n = prompt('New list name'); if (!n) return;
      const w2 = WL.all(), id = 'l' + Date.now();
      w2.lists.push({ id, name: n.slice(0, 40), symbols: [], created: new Date().toISOString() });
      w2.active = id; WL.save(w2); draw();
    };
    $('#wRen').onclick = () => {
      const n = prompt('Rename list', l.name); if (!n) return;
      const w2 = WL.all(); w2.lists.find(x => x.id === w2.active).name = n.slice(0, 40);
      WL.save(w2); draw();
    };
    $('#wDel').onclick = () => {
      const w2 = WL.all();
      if (w2.lists.length < 2) { toast('Keep at least one list'); return; }
      if (!confirm(`Delete "${l.name}"?`)) return;
      w2.lists = w2.lists.filter(x => x.id !== w2.active); w2.active = w2.lists[0].id;
      WL.save(w2); draw();
    };

    // Export / import
    $('#wExp').onclick = () => download('signal-watchlists.json', JSON.stringify(WL.all(), null, 2), 'application/json');
    $('#wImp').onchange = async e => {
      try { WL.import(JSON.parse(await e.target.files[0].text())); toast('Imported'); draw(); }
      catch (x) { toast('Import failed: ' + x.message); }
    };

    // Remove / move
    root.addEventListener('click', e => {
      const rm = e.target.closest('[data-rm]');
      if (rm) { const w2 = WL.all(), k = w2.lists.find(x => x.id === w2.active); k.symbols = k.symbols.filter(s => s !== rm.dataset.rm); WL.save(w2); draw(); return; }
      const mv = e.target.closest('[data-mv]');
      if (mv) {
        const sym = mv.dataset.mv;
        const w2 = WL.all();
        const opts = w2.lists.filter(x => x.id !== w2.active).map(x => `${x.name}`).join('\n');
        const choice = prompt(`Move ${sym} to which list?\n${w2.lists.filter(x => x.id !== w2.active).map((x, i) => `${i + 1}. ${x.name}`).join('\n')}\n\nEnter number:`);
        if (!choice) return;
        const idx = parseInt(choice) - 1;
        const others = w2.lists.filter(x => x.id !== w2.active);
        if (idx >= 0 && idx < others.length) {
          const from = w2.lists.find(x => x.id === w2.active);
          from.symbols = from.symbols.filter(s => s !== sym);
          if (!others[idx].symbols.includes(sym)) others[idx].symbols.push(sym);
          WL.save(w2); draw(); toast(`Moved ${sym} to ${others[idx].name}`);
        }
      }
    });
  };
  draw();
}

// ====================================================================
// RULEBOT
// ====================================================================

export function rulebot(root) {
  const b = S().bot, cfg = b.config;
  const eh = b.equity_history || [], last = eh.at(-1);
  const pos = Object.values(b.positions || {}), tr = b.trades || [];
  const eq = last?.equity ?? cfg.starting_capital;
  const ret = (eq / cfg.starting_capital - 1) * 100;
  const dd = eh.length ? Math.min(...eh.map(x => x.drawdown_pct)) : 0;
  const wins = tr.filter(t => t.net_pnl > 0);
  const gl = -tr.filter(t => t.net_pnl < 0).reduce((a, t) => a + t.net_pnl, 0);
  const gp = wins.reduce((a, t) => a + t.net_pnl, 0);
  const unreal = pos.reduce((a, p) => a + (p.unrealised_pnl || 0), 0);
  const pend = (b.pending_orders || []).filter(o => !String(o.status).startsWith('rejected') && o.status !== 'filled');

  // Sector allocation (from positions)
  const bySector = {};
  pos.forEach(p => { bySector[p.industry || 'Unknown'] = (bySector[p.industry || 'Unknown'] || 0) + (p.market_value || 0); });
  const totalInvested = Object.values(bySector).reduce((a, v) => a + v, 0) || 1;

  root.innerHTML = `<div class="page">
    <h1>Rule Bot <span class="sig sig-h" style="font-size:11px">PAPER · long-only cash equity</span></h1>

    <!-- Portfolio band -->
    <div class="grid g4">
      ${kpiCard('Equity', inr(eq), `<span class="${cls(ret)}">${pct(ret)}</span> since start`, '')}
      ${kpiCard('Invested', inr(last?.invested), `Cash ${inr(b.cash)}`, '')}
      ${kpiCard('Unrealised P&amp;L', `<span class="${cls(unreal)}">${inr(unreal)}</span>`, `${pos.length}/${cfg.max_positions} positions`, '')}
      ${kpiCard('Max drawdown', `<span class="dn">${f2(dd)}%</span>`, `${tr.length} closed · ${tr.length ? (wins.length / tr.length * 100).toFixed(0) : '—'}% win · PF ${gl ? (gp / gl).toFixed(2) : '—'}`, '')}
    </div>

    <!-- Equity vs Nifty chart -->
    ${panel('Equity curve', eh.length > 1 ? chartBox('eq', '260px') : empty('Needs at least two sessions.'), `Costs: ${cfg.cost_bps_per_side + cfg.slippage_bps_per_side} bps/side · not net of taxes`)}

    <!-- Sector allocation -->
    ${Object.keys(bySector).length ? panel('Allocation by sector', `<div class="panel-body">
      <div class="sig-stack" style="height:10px;border-radius:5px">
        ${Object.entries(bySector).map(([s, v]) => `<span title="${esc(s)}: ${(v/totalInvested*100).toFixed(1)}%" style="width:${(v/totalInvested*100).toFixed(1)}%;background:var(--accent-dim)"></span>`).join('')}
      </div>
      <div class="pills" style="margin-top:8px">${Object.entries(bySector).map(([s, v]) => `<span class="pill">${esc(s)} ${(v/totalInvested*100).toFixed(0)}%</span>`).join('')}</div>
    </div>`) : ''}

    <div class="grid split">
      <!-- Open positions -->
      ${panel('Open positions', `<div class="table-wrap auto"><table>
        <thead><tr><th>Symbol</th><th class="n">Qty</th><th class="n">Entry</th><th class="n">Last</th><th class="n">P&amp;L</th><th class="n hide-s">Wt%</th><th class="hide-s stop-dist-col">Stop</th></tr></thead>
        <tbody>${pos.map(p => {
          const stop = stopLevel(p);
          const stopDist = num(stop) && num(p.last_price) ? (p.last_price - stop) / p.last_price * 100 : null;
          return `<tr ${rowAttr(p.symbol)}>
            <td class="sym">${esc(p.symbol)}<small>${esc(p.industry || '')}</small></td>
            <td class="n mono">${f0(p.quantity)}</td>
            <td class="n mono">${f2(p.entry_price)}</td>
            <td class="n mono">${f2(p.last_price)}</td>
            <td class="n ${cls(p.unrealised_pnl)} mono">${inr(p.unrealised_pnl)}</td>
            <td class="n hide-s mono">${f2(p.weight_pct)}%</td>
            <td class="hide-s">
              ${num(stop) ? `<div style="font-size:11px" class="mono muted">${f2(stop)}</div>
              <div class="stop-bar" title="Distance to stop: ${num(stopDist) ? stopDist.toFixed(1) : '?'}%">
                <div class="stop-bar-fill" style="width:${num(stopDist) ? Math.min(100, 100 - stopDist) : 50}%"></div>
              </div>` : '—'}
            </td>
          </tr>`;
        }).join('') || `<tr><td colspan="7">${empty('No open positions')}</td></tr>`}
        </tbody>
      </table></div>`)}

      <!-- Pending orders -->
      ${panel(`Pending orders · ${pend.length}`, pend.length
        ? `<ul class="feed">${pend.map(o =>
            `<li class="feed-item" ${rowAttr(o.symbol)}>
              <strong>${esc(o.symbol)}</strong>
              <span class="sig${o.side === 'BUY' ? ' sig-b' : ' sig-s'}">${o.side}</span>
              ${badge(o.signal)}
              <span class="muted" style="margin-left:auto">${esc(String(o.status).replace(/_/g, ' '))}</span>
            </li>`).join('')}</ul>`
        : empty('Nothing queued'))}
    </div>

    <!-- Closed trades -->
    ${panel('Closed trades', `
      <div class="bar"><button class="btn btn-sm" id="trCsv">Export CSV</button></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Symbol</th><th>Entry</th><th>Exit</th><th class="n">Net P&amp;L</th><th class="n">Return</th><th class="n hide-s">Days</th><th class="hide-s">Exit by</th></tr></thead>
        <tbody>${[...tr].reverse().map(t =>
          `<tr ${rowAttr(t.symbol)}>
            <td class="sym mono">${esc(t.symbol)}</td>
            <td>${esc(t.entry_date)}</td>
            <td>${esc(t.exit_date)}</td>
            <td class="n ${cls(t.net_pnl)} mono">${inr(t.net_pnl)}</td>
            <td class="n ${cls(t.return_pct_net)} mono">${pct(t.return_pct_net)}</td>
            <td class="n hide-s mono">${f0(t.holding_sessions)}</td>
            <td class="hide-s">${badge(t.exit_signal || 'SELL')}</td>
          </tr>`
        ).join('') || `<tr><td colspan="7">${empty('No closed trades yet')}</td></tr>`}
        </tbody>
      </table></div>`)}

    <p class="dimmed" style="font-size:12px">Simulation only: no broker, no real orders, no shorting or derivatives. Fills at next session open after costs and slippage.
    ${cfg.atr_stop_mult ? `${cfg.atr_stop_mult}×ATR trailing stop and ${cfg.cooldown_days}-day re-entry cooldown.` : ''}</p>
  </div>`;

  // Equity chart (with Nifty if available)
  if (eh.length > 1) {
    const series = [{ y: eh.map(x => x.equity), color: 'var(--accent)', name: 'Strategy', w: 2 }];
    // Benchmark overlay — uses bot equity_history nifty if stored (WP-3 adds this; graceful absent)
    const niftySeries = eh.map(x => x.nifty_rebased).filter(num);
    if (niftySeries.length > 0) {
      series.unshift({ y: eh.map(x => x.nifty_rebased), color: 'var(--flat)', name: 'Nifty 50', w: 1.4 });
    }
    const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    plotChart('eq', {
      x: eh.map(x => x.date),
      panes: [
        { h: 3, fmt: v => (v / 1e5).toFixed(1) + 'L', tipfmt: inr, series: series.map(s => ({ ...s, color: s.color.startsWith('var') ? css(s.color.slice(4, -1)) : s.color })), lines: [{ v: cfg.starting_capital }] },
        { h: 1, label: 'DD%', zero: true, series: [{ type: 'hist', y: eh.map(x => x.drawdown_pct), name: 'DD%' }] }
      ]
    });
  }

  $('#trCsv')?.addEventListener('click', () =>
    download('signal-trades.csv', csv(tr, ['symbol','entry_date','entry_price','exit_date','exit_price','quantity','gross_pnl','costs','net_pnl','return_pct_net','holding_sessions','exit_signal']))
  );
}

// ====================================================================
// MORE — Settings / System / Methodology / Backtest / Data health
// ====================================================================

export async function more(root, params, toast) {
  const qs = new URLSearchParams(params?.includes('?') ? params.split('?')[1] : '');
  const initTab = qs.get('tab') || 'system';
  const tabs = [['system','System'],['backtest','Backtest'],['methodology','Methodology'],['settings','Settings']];

  root.innerHTML = `<div class="page">
    <h1>More</h1>
    <div class="panel">
      <div class="tab-bar" role="tablist" id="moreTabs">
        ${tabs.map(([id, lbl]) => `<button class="tab-item" role="tab" aria-selected="${id === initTab}" id="moreTab-${id}">${lbl}</button>`).join('')}
      </div>
      <div id="moreContent"></div>
    </div>
  </div>`;

  const renderTab = async tabId => {
    $$('#moreTabs .tab-item').forEach(b => b.setAttribute('aria-selected', b.id === `moreTab-${tabId}`));
    const c = $('#moreContent'); c.innerHTML = '';
    if (tabId === 'system')      renderSystem(c, toast);
    else if (tabId === 'backtest')    await renderBacktest(c);
    else if (tabId === 'methodology') renderMethodology(c);
    else if (tabId === 'settings')    renderSettings(c);
  };

  $('#moreTabs').addEventListener('click', e => { const b = e.target.closest('.tab-item'); if (b) renderTab(b.id.replace('moreTab-', '')); });
  await renderTab(initTab);
}

function renderSystem(root, toast) {
  const s = S(), cv = s.coverage || {}, age = ageDays();
  const blocked = sigs().filter(r => r.signal === 'DATA BLOCKED');
  const bar = v => `<div class="stop-bar" style="height:6px"><div class="stop-bar-fill" style="width:${Math.min(100, v || 0)}%"></div></div>`;
  root.innerHTML = `<div class="panel-body">
    <div class="brand-hero">
      <img src="icons/Signal_Wordmark.svg" class="brand-hero-logo logo-dark" alt="Signal — Signal over noise" height="42">
      <img src="icons/Signal_Wordmark_Light.svg" class="brand-hero-logo logo-light" alt="Signal — Signal over noise" height="42">
    </div>
    <div class="grid g3">
      ${kpiCard('Data status', esc(s.status), esc(s.data_mode), s.status === 'OK' ? 'up' : 'warn')}
      ${kpiCard('Session', esc(s.exchange_date), age == null ? '' : `${age} day(s) old`)}
      ${kpiCard('Ruleset', esc(s.ruleset_version), `schema v${s.schema_version}`)}
    </div>
    <div class="grid g2" style="margin-top:14px">
      <div>
        <h2 style="margin-bottom:8px">Coverage</h2>
        <dl class="kv">
          <dt>Price histories</dt><dd>${cv.price_histories}/${cv.expected} (${f2(cv.price_coverage_pct)}%)</dd>
        </dl>
        ${bar(cv.price_coverage_pct)}
        <dl class="kv" style="margin-top:10px">
          <dt>Fundamentals</dt><dd>${f2(cv.fundamentals_coverage_pct)}%</dd>
        </dl>
        ${bar(cv.fundamentals_coverage_pct)}
        <dl class="kv" style="margin-top:12px">
          <dt>Provider</dt><dd>${esc(s.source)}</dd>
          <dt>Generated</dt><dd>${esc(s.generated_at_ist || s.generated_at)}</dd>
          <dt>Run ID</dt><dd>${esc(s.pipeline_run_id || '—')}</dd>
        </dl>
      </div>
      <div>
        <h2 style="margin-bottom:8px">Data-blocked symbols · ${blocked.length}</h2>
        ${blocked.length
          ? `<div class="table-wrap auto"><table><tbody>${blocked.map(r =>
              `<tr ${rowAttr(r.symbol)}>${symCell(r)}<td class="muted">${esc((r.reasons || []).at(-1) || '')}</td></tr>`
            ).join('')}</tbody></table></div>`
          : empty('None')}
      </div>
    </div>
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-sm" id="dlSnap">Download snapshot.json</button>
      <button class="btn btn-sm" id="reloadData">Reload data</button>
    </div>
  </div>`;
  $('#dlSnap')?.addEventListener('click', () => download('signal-snapshot.json', JSON.stringify(S()), 'application/json'));
  $('#reloadData')?.addEventListener('click', () => {
    document.dispatchEvent(new Event('signal:reload'));
    document.dispatchEvent(new Event('strata:reload'));
  });
}

async function renderBacktest(root) {
  root.innerHTML = `<div class="panel-body"><div class="skel" style="height:200px"></div></div>`;
  const b = await loadBacktest();
  if (!b) { root.innerHTML = `<div class="panel-body">${empty('backtest.json is generated by the daily pipeline.', '📊')}</div>`; return; }
  const A = b.strategy, B = b.benchmark || {};
  const rowf = (n, k, fmt = v => f2(v)) =>
    `<tr><td>${n}</td><td class="n mono">${fmt(A[k])}</td><td class="n mono">${B ? fmt(B[k]) : '—'}</td></tr>`;
  const ex = num(A.cagr_pct) && num(B.cagr_pct) ? A.cagr_pct - B.cagr_pct : null;
  root.innerHTML = `<div class="panel-body">
    <div class="banner${ex != null && ex < 0 ? ' bad' : ' ok'}" style="margin-bottom:12px">
      ${ex == null ? 'No benchmark available.' : ex >= 0
        ? `Rules beat Nifty buy-and-hold by ${f2(ex)} pts/yr in this sample.`
        : `Rules <strong>trailed</strong> Nifty by ${f2(-ex)} pts/yr in this sample.`}
      ${isDemo() ? '<strong> Demo data: synthetic random walks.</strong>' : ''}
    </div>
    ${chartBox('bt', '320px')}
    <div class="grid g2" style="margin-top:12px">
      <table>
        <thead><tr><th></th><th class="n">Strategy</th><th class="n">Nifty 50</th></tr></thead>
        <tbody>
          ${rowf('Total return', 'total_return_pct', pct)}
          ${rowf('CAGR', 'cagr_pct', pct)}
          ${rowf('Volatility', 'vol_pct', v => f2(v) + '%')}
          ${rowf('Sharpe (rf 6.5%)', 'sharpe')}
          ${rowf('Max drawdown', 'max_drawdown_pct', v => f2(v) + '%')}
        </tbody>
      </table>
      <dl class="kv">
        <dt>Trades</dt><dd>${f0(b.trades)}</dd>
        <dt>Win rate</dt><dd>${f2(b.win_rate_pct)}%</dd>
        <dt>Avg trade</dt><dd>${pct(b.avg_trade_pct)}</dd>
        <dt>Avg exposure</dt><dd>${f2(b.exposure_pct)}%</dd>
        <dt>Costs/side</dt><dd>${b.config?.cost_bps} bps</dd>
        <dt>Trailing stop</dt><dd>${b.config?.atr_mult}× ATR</dd>
        <dt>Max positions</dt><dd>${b.config?.max_positions}</dd>
      </dl>
    </div>
    <div class="banner warn" style="margin-top:12px">
      <strong>Read this before trusting it.</strong> ${esc(b.method || '')} Past performance does not predict future results.
    </div>
  </div>`;
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  plotChart('bt', {
    x: b.dates, xfmt: d => d.slice(2, 7),
    panes: [{ h: 1, fmt: v => (v / 1e5).toFixed(0) + 'L', tipfmt: inr, series: [
      { y: b.bench_equity || [], color: css('--text-muted'), name: 'Nifty 50', w: 1.4 },
      { y: b.equity, color: css('--accent'), name: 'Strategy', w: 2 }
    ] }]
  });
}

function renderMethodology(root) {
  root.innerHTML = `<div class="panel-body">
    <h2 style="margin-bottom:10px">How signals work</h2>
    <p><strong>Score</strong> = 60% technical + 40% fundamental. Technical (100): close>SMA50 25, close>SMA200 20, RSI 45–68 20, MACD>signal 20, positive 20-day return 15.
    Fundamental (100): ROE≥12% 35, D/E≤1 25, revenue growth>0 25, P/E 0–45 15; <strong>leverage is skipped and rescaled for banks/NBFCs</strong>.</p>
    <ul class="why">
      <li><strong>Strong Buy</strong> score≥85, tech≥80, fund≥65, above SMA50 with MACD confirmation.</li>
      <li><strong>Buy</strong> score≥70, tech≥60, fund≥45, above SMA50.</li>
      <li><strong>Sell / Strong Sell</strong> — close <strong>2% below SMA50</strong> (anti-whipsaw) plus bearish confirmation.</li>
      <li><strong>Paper bot</strong>: next-open fills, 20 bps costs, ≤15 positions, ≤10% per stock, ≤25% per sector, 3×ATR trailing stop, 14-day re-entry cooldown, illiquid stocks (&lt;₹2 Cr/day) never bought.</li>
    </ul>
    <div class="banner warn" style="margin-top:14px">
      <strong>Limits.</strong> Thresholds are untested heuristics. Fundamentals are the provider's current values, not point-in-time, so they cannot be back-tested. Data is end-of-day from an unofficial source. Signals are research output, not investment advice, and not a SEBI-registered recommendation.
    </div>
  </div>`;
}

function renderSettings(root) {
  root.innerHTML = `<div class="panel-body">
    <dl class="kv">
      <dt>Theme</dt>
      <dd><select id="pTheme"><option value="dark">Dark</option><option value="light">Light</option></select></dd>
      <dt>Row density</dt>
      <dd><select id="pDen"><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></dd>
    </dl>
  </div>`;
  $('#pTheme').value = document.documentElement.dataset.theme || 'dark';
  $('#pDen').value = document.documentElement.dataset.density || 'compact';
  $('#pTheme').onchange = e => { document.documentElement.dataset.theme = e.target.value; store.set('theme', e.target.value); };
  $('#pDen').onchange = e => { document.documentElement.dataset.density = e.target.value; store.set('density', e.target.value); };
}

// ====================================================================
// STOCK VIEW — shared, route #/stock/<SYMBOL>
// ====================================================================

export async function stockView(root, sym, toast) {
  const r = D.by[sym];
  const prev = peekPrevious();
  const backLabel = prev ? `← ${prev.label || 'Back'}` : '← Back';

  if (!r) {
    root.innerHTML = `<div class="page">
      <button class="back-link btn btn-ghost btn-sm" id="backBtn">${esc(backLabel)}</button>
      <h1>${esc(sym || 'Unknown')}</h1>
      ${empty('Symbol not found in the current universe.', '🔍')}
    </div>`;
    $('#backBtn').onclick = () => goBack();
    return;
  }

  const t = r.technical || {}, f = r.fundamentals || {};
  const pos = S().bot?.positions?.[sym];
  const inWL = WL.has(sym);
  const tabs = ['Overview', 'Chart', 'Technicals', 'Fundamentals', 'Financials', 'News'];
  const st = {
    tab: 'Overview', type: 'candle', tf: '1Y',
    s20: false, s50: true, s200: true, bb: false, vol: true, rsi: true, macd: false,
    ...store.get('stock-prefs', {})
  };

  root.innerHTML = `<div class="page">
    <button class="back-link btn btn-ghost btn-sm" id="backBtn">${esc(backLabel)}</button>

    <!-- Stock header -->
    <div class="stock-header">
      <div>
        <div class="stock-symbol">${esc(sym)} ${badge(r.signal)}</div>
        <div class="stock-name">${esc(r.company)} · ${esc(r.industry)} · NSE</div>
        <div class="stock-meta">
          <span>${f2(r.price)}</span>
          <span class="${cls(r.change_pct)} mono">${pct(r.change_pct)}</span>
          <span>EOD ${esc(r.date || S().exchange_date)}</span>
        </div>
      </div>
      <div class="stock-actions">
        <div style="position:relative">
          <button class="btn" id="wlBtn" aria-pressed="${inWL}">
            <svg width="14" height="14"><use href="#${inWL ? 'i-star-on' : 'i-star-off'}"/></svg>
            ${inWL ? 'Watching' : 'Watch'}
          </button>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="panel">
      <div class="tab-bar" role="tablist" id="stockTabs">
        ${tabs.map(tab => `<button class="tab-item" role="tab" aria-selected="${tab === st.tab}" id="stTab-${tab}">${tab}</button>`).join('')}
      </div>
      <div id="stockContent"></div>
    </div>
  </div>`;

  // Back button
  $('#backBtn').onclick = () => goBack();

  // Watchlist toggle
  $('#wlBtn').onclick = e => {
    WL.toggle(sym);
    const on = WL.has(sym);
    e.currentTarget.setAttribute('aria-pressed', on);
    e.currentTarget.innerHTML = `<svg width="14" height="14"><use href="#${on ? 'i-star-on' : 'i-star-off'}"/></svg> ${on ? 'Watching' : 'Watch'}`;
    toast(on ? `Added ${sym} to watchlist` : `Removed ${sym}`);
  };

  // Tab switching
  const renderStockTab = async tab => {
    st.tab = tab;
    store.set('stock-prefs', { ...store.get('stock-prefs', {}), tab });
    $$('#stockTabs .tab-item').forEach(b => b.setAttribute('aria-selected', b.id === `stTab-${tab}`));
    disposeCharts();
    const content = $('#stockContent'); content.innerHTML = '';

    if (tab === 'Overview')      renderStockOverview(content, r, f, t, pos, sym);
    else if (tab === 'Chart')    await renderStockChart(content, r, sym, st, pos, toast);
    else if (tab === 'Technicals')   renderStockTechnicals(content, t);
    else if (tab === 'Fundamentals') renderStockFundamentals(content, f, r);
    else if (tab === 'Financials')   renderStockFinancials(content, f, r);
    else if (tab === 'News')         renderStockNews(content, sym);
  };

  $('#stockTabs').addEventListener('click', e => {
    const btn = e.target.closest('.tab-item'); if (btn) renderStockTab(btn.id.replace('stTab-', ''));
  });
  await renderStockTab(st.tab);
}

// ---- Stock Overview --------------------------------------------------------

function renderStockOverview(root, r, f, t, pos, sym) {
  root.innerHTML = `<div class="panel-body">
    <div class="grid g4">
      ${kpiCard('Close', f2(r.price), `<span class="${cls(r.change_pct)}">${pct(r.change_pct)}</span>`)}
      ${kpiCard('Score', num(r.score) ? r.score.toFixed(0) : '—', `Tech ${r.technical_score ?? '—'} · Fund ${num(r.fundamental_score) ? r.fundamental_score.toFixed(0) : '—'}`)}
      ${kpiCard('Setup', esc(r.setup_type || '—'), esc(S().market_regime?.label || ''))}
      ${kpiCard('Liquidity', inr(t.TRADED_VALUE20), r.liquid === false ? '<span class="warn">Below paper-trade minimum</span>' : '20d avg traded value')}
    </div>

    <div class="grid split" style="margin-top:12px">
      <!-- Signal explanation -->
      <div>
        ${panel('Why this signal', `<div class="panel-body">
          <ul class="why">
            ${(r.reasons || []).map(x => `<li class="ok-li">${esc(x)}</li>`).join('')}
            ${(r.failed_conditions || []).map(x => `<li class="no-li">Not met: ${esc(x)}</li>`).join('')}
          </ul>
          ${(r.risk_warnings || []).length ? `<div class="banner warn" style="margin-top:8px">${r.risk_warnings.map(esc).join('<br>')}</div>` : ''}
        </div>`)}
      </div>

      <!-- Position (if held) -->
      <div>
        ${pos ? panel('Model position', `<div class="panel-body">
          <dl class="kv">
            <dt>Quantity</dt><dd>${f0(pos.quantity)}</dd>
            <dt>Entry price</dt><dd>${f2(pos.entry_price)}</dd>
            <dt>Unrealised P&amp;L</dt><dd class="${cls(pos.unrealised_pnl)}">${inr(pos.unrealised_pnl)}</dd>
            <dt>Trailing stop</dt><dd>${f2(stopLevel(pos))}</dd>
          </dl>
        </div>`) : ''}
        ${panel('Key stats', `<div class="panel-body"><dl class="kv">
          <dt>Market cap</dt><dd>${inr(f.Market_Cap_Cr * 1e7)}</dd>
          <dt>P/E · P/B</dt><dd>${f2(f.PE_Ratio)} · ${f2(f.PB_Ratio)}</dd>
          <dt>ROE</dt><dd>${pct(f.ROE_pct, 1)}</dd>
          <dt>Revenue growth</dt><dd>${pct(f.Revenue_Growth_pct, 1)}</dd>
        </dl></div>`)}
      </div>
    </div>
    <p class="dimmed" style="font-size:11px;margin-top:8px">Signals are research output only — not investment advice, not a SEBI-registered recommendation.</p>
  </div>`;
}

// ---- Stock Chart -----------------------------------------------------------

async function renderStockChart(root, r, sym, st, pos, toast) {
  const TFS = ['1M', '3M', '6M', '1Y', '3Y'];
  root.innerHTML = `
    <div class="bar" style="flex-wrap:wrap;gap:8px">
      <div class="seg" role="group" aria-label="Chart type">
        <button class="seg-btn" data-t="candle" aria-pressed="${st.type==='candle'}">Candles</button>
        <button class="seg-btn" data-t="line"   aria-pressed="${st.type==='line'}">Line</button>
      </div>
      <div class="seg" role="group" aria-label="Timeframe">
        ${TFS.map(tf => `<button class="seg-btn" data-tf="${tf}" aria-pressed="${st.tf===tf}">${tf}</button>`).join('')}
      </div>
      <div class="pills">
        ${[['s20','SMA20'],['s50','SMA50'],['s200','SMA200'],['bb','BB'],['vol','Vol'],['rsi','RSI'],['macd','MACD']].map(([k,n]) =>
          `<button class="pill" data-o="${k}" aria-pressed="${st[k]}">${n}</button>`).join('')}
      </div>
    </div>
    <div id="cwrap" style="padding:8px"><div class="skel" style="height:340px"></div></div>`;

  const c = await loadChart(sym);
  const draw = () => {
    disposeCharts();
    const wrap = document.getElementById('cwrap'); if (!wrap) return;
    if (!c) { wrap.innerHTML = `<div class="panel-body">${empty('No chart data for this symbol.', '📊')}</div>`; return; }

    store.set('stock-prefs', { ...store.get('stock-prefs', {}), type: st.type, tf: st.tf, s20: st.s20, s50: st.s50, s200: st.s200, bb: st.bb, vol: st.vol, rsi: st.rsi, macd: st.macd });

    // Timeframe slice
    const tfDays = { '1M': 22, '3M': 66, '6M': 132, '1Y': 252, '3Y': 756 };
    const N = Math.min(c.d.length, tfDays[st.tf] || c.d.length);
    const slc = arr => arr ? arr.slice(-N) : null;
    const sd = { d: slc(c.d), o: slc(c.o), h: slc(c.h), l: slc(c.l), c: slc(c.c), v: slc(c.v),
                 s20: slc(c.s20), s50: slc(c.s50), s200: slc(c.s200),
                 r: slc(c.r), mh: slc(c.mh),
                 bb_upper: slc(c.bb_upper), bb_mid: slc(c.bb_mid), bb_lower: slc(c.bb_lower) };
    if (!sd.d?.length) { wrap.innerHTML = empty('Not enough data for this timeframe.'); return; }

    // Trade markers
    const trades = (S().bot?.trades || []).filter(x => x.symbol === sym);
    const mk = [];
    const ix = d => sd.d.indexOf(d);
    trades.forEach(x => {
      if (ix(x.entry_date) >= 0) mk.push({ i: ix(x.entry_date), side: 'B', label: f2(x.entry_price) });
      if (ix(x.exit_date)  >= 0) mk.push({ i: ix(x.exit_date),  side: 'S', label: f2(x.exit_price) });
    });
    if (pos && ix(pos.entry_date) >= 0) mk.push({ i: ix(pos.entry_date), side: 'B', label: f2(pos.entry_price) });

    const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
    const main = st.type === 'candle'
      ? [{ type: 'candle', o: sd.o, h: sd.h, l: sd.l, c: sd.c }]
      : [{ type: 'line',   y: sd.c, name: 'Close', color: css('--text-primary') }];
    if (st.s20 && sd.s20) main.push({ y: sd.s20, name: 'SMA20', color: css('--accent-hover'), w: 1.2 });
    if (st.s50 && sd.s50) main.push({ y: sd.s50, name: 'SMA50', color: css('--warn'), w: 1.2 });
    if (st.s200 && sd.s200) main.push({ y: sd.s200, name: 'SMA200', color: '#b48cff', w: 1.2 });
    if (st.bb && sd.bb_upper) {
      main.push({ y: sd.bb_upper, name: 'BB Upper', color: 'rgba(0,212,170,0.5)', w: 0.8 });
      main.push({ y: sd.bb_lower, name: 'BB Lower', color: 'rgba(0,212,170,0.5)', w: 0.8 });
    }

    const panes = [{ h: 5, series: main }];
    if (st.vol && sd.v) panes.push({ h: 1.2, label: 'VOL', fmt: v => (v / 1e5).toFixed(0) + 'L', series: [{ type: 'bar', y: sd.v, color: css('--text-muted'), name: 'Vol' }] });
    if (st.rsi && sd.r) panes.push({ h: 1.3, label: 'RSI', range: [10, 90], lines: [{ v: 70, color: css('--neg') }, { v: 30, color: css('--pos') }], fmt: v => v.toFixed(0), series: [{ y: sd.r, color: css('--accent'), name: 'RSI' }] });
    if (st.macd && sd.mh) panes.push({ h: 1.2, label: 'MACD hist', zero: true, series: [{ type: 'hist', y: sd.mh, name: 'Hist' }] });

    const h = 300 + 70 * (panes.length - 1);
    wrap.innerHTML = chartBox('stk', `${h}px`);
    plotChart('stk', { x: sd.d, panes, markers: mk });
  };

  root.addEventListener('click', e => {
    const tBtn = e.target.closest('[data-t]');
    if (tBtn) { st.type = tBtn.dataset.t; $$('[data-t]').forEach(b => b.setAttribute('aria-pressed', b === tBtn)); draw(); return; }
    const tfBtn = e.target.closest('[data-tf]');
    if (tfBtn) { st.tf = tfBtn.dataset.tf; $$('[data-tf]').forEach(b => b.setAttribute('aria-pressed', b === tfBtn)); draw(); return; }
    const oBtn = e.target.closest('[data-o]');
    if (oBtn) { st[oBtn.dataset.o] = !st[oBtn.dataset.o]; oBtn.setAttribute('aria-pressed', st[oBtn.dataset.o]); draw(); }
  });
  draw();
}

// ---- Technicals ------------------------------------------------------------

function renderStockTechnicals(root, t) {
  const row = (label, val, note = '') =>
    `<tr><td class="dimmed">${label}</td><td class="n mono">${val}</td><td class="dimmed" style="font-size:11px">${note}</td></tr>`;
  const rsiNote = v => !num(v) ? '' : v > 70 ? 'Overbought' : v < 30 ? 'Oversold' : `${v.toFixed(0)}: positive, not overbought`;
  root.innerHTML = `<div class="panel-body"><table style="width:100%"><tbody>
    ${row('RSI 14', f2(t.RSI14), rsiNote(t.RSI14))}
    ${row('MACD / Signal', `${f2(t.MACD)} / ${f2(t.MACD_SIGNAL)}`, num(t.MACD) && num(t.MACD_SIGNAL) ? (t.MACD > t.MACD_SIGNAL ? 'Bullish' : 'Bearish') : '')}
    ${row('SMA 20 / 50 / 200', `${f2(t.SMA20)} / ${f2(t.SMA50)} / ${f2(t.SMA200)}`, '')}
    ${row('Bollinger Bands', `${f2(t.BB_LOWER20)} – ${f2(t.BB_UPPER20)}`, num(t.Close) && num(t.BB_UPPER20) ? (t.Close > t.BB_UPPER20 ? 'Above upper' : t.Close < t.BB_LOWER20 ? 'Below lower' : 'Inside bands') : '')}
    ${row('ADX 14', f2(t.ADX14), num(t.ADX14) ? (t.ADX14 < 15 ? 'Weak/choppy trend' : t.ADX14 < 25 ? 'Developing trend' : 'Strong trend') : '')}
    ${row('ATR 14', f2(t.ATR14), 'Avg true range (volatility proxy)')}
    ${row('Volume ratio 20d', f2(t.VOLUME_RATIO20), num(t.VOLUME_RATIO20) ? (t.VOLUME_RATIO20 > 1.5 ? 'Elevated volume' : 'Normal volume') : '')}
    ${row('Return 20d', pct(t.RETURN_20D, 1), '')}
    ${row('Rel. strength vs Nifty', pct(t.RELATIVE_STRENGTH_20D, 1), num(t.RELATIVE_STRENGTH_20D) ? (t.RELATIVE_STRENGTH_20D > 0 ? 'Outperforming' : 'Underperforming') : '')}
  </tbody></table></div>`;
}

// ---- Fundamentals ----------------------------------------------------------

function renderStockFundamentals(root, f, r) {
  const row = (label, val) => `<tr><td class="dimmed">${label}</td><td class="n mono">${val}</td></tr>`;
  const isFinancial = /financ|bank|nbfc|insurance/i.test(r.industry || '');
  root.innerHTML = `<div class="panel-body">
    <p class="dimmed" style="font-size:11px;margin-bottom:12px">Provider current values (yfinance) — not point-in-time. Do not use for backtesting.</p>
    <table style="width:100%"><tbody>
      ${row('Market cap', inr(f.Market_Cap_Cr * 1e7))}
      ${row('P/E (trailing)', f2(f.PE_Ratio))}
      ${row('Forward P/E', f2(f.Forward_PE))}
      ${row('P/B', f2(f.PB_Ratio))}
      ${row('EPS (TTM)', f2(f.EPS_TTM))}
      ${row('ROE', pct(f.ROE_pct, 1))}
      ${row('Profit margin', pct(f.Profit_Margins_pct, 1))}
      ${row('Operating margin', pct(f.Operating_Margins_pct, 1))}
      ${isFinancial ? '' : row('Debt / equity', f2(f.Debt_Equity))}
      ${isFinancial ? row('Debt / equity', 'n/a — financial sector') : ''}
      ${row('Current ratio', f2(f.Current_Ratio))}
      ${row('Revenue growth (TTM)', pct(f.Revenue_Growth_pct, 1))}
      ${row('Dividend yield', pct(f.Div_Yield_pct, 2))}
    </tbody></table>
  </div>`;
}

// ---- Financials (income/balance) ------------------------------------------

function renderStockFinancials(root, f, r) {
  root.innerHTML = `<div class="panel-body">
    <div class="banner" style="margin-bottom:12px">
      <span>Quarterly/annual financial statements (revenue, profit, balance-sheet history) are not yet reliably available from the current data provider. Only current valuation metrics are shown in Fundamentals. This will be updated once data-source verification (WP-6) confirms reliable coverage.</span>
    </div>
    ${empty('Not available from provider', '📋')}
  </div>`;
}

// ---- News ------------------------------------------------------------------

function renderStockNews(root, sym) {
  root.innerHTML = `<div class="panel-body">
    <div class="banner" style="margin-bottom:12px">
      <span>News requires a free source whose terms permit display in a static PWA. Source verification is pending (WP-6). Headlines will appear here once a compliant source is confirmed.</span>
    </div>
    ${empty('Not available from provider', '📰')}
  </div>`;
}

// ====================================================================
// Component kit page (/#/__kit)
// ====================================================================

export function __kit(root) {
  root.innerHTML = `<div class="page">
    <h1>Component Kit <span class="page-title-sub">v3.0 design system</span></h1>

    <section class="kit-section panel">
      <div class="panel-header"><h2>Buttons</h2></div>
      <div class="panel-body">
        <div class="kit-row">
          <button class="btn btn-primary">Primary</button>
          <button class="btn">Secondary</button>
          <button class="btn btn-ghost">Ghost</button>
          <button class="btn btn-danger">Danger</button>
          <button class="btn btn-sm">Small</button>
          <button class="btn btn-lg">Large</button>
        </div>
      </div>
    </section>

    <section class="kit-section panel">
      <div class="panel-header"><h2>Signal badges</h2></div>
      <div class="panel-body"><div class="kit-row">
        ${['STRONG BUY','BUY','HOLD','SELL','STRONG SELL','DATA BLOCKED'].map(badge).join('')}
      </div></div>
    </section>

    <section class="kit-section panel">
      <div class="panel-header"><h2>Score bars</h2></div>
      <div class="panel-body"><div class="kit-row">
        ${[100, 85, 70, 55, 40, 20].map(n => scoreBar(n)).join('')}
      </div></div>
    </section>

    <section class="kit-section panel">
      <div class="panel-header"><h2>Inputs</h2></div>
      <div class="panel-body"><div class="kit-row">
        <input type="search" class="input" placeholder="Search…">
        <input type="text" class="input" placeholder="Text input">
        <input type="number" class="input" placeholder="0" style="width:80px">
        <select><option>Select option</option></select>
      </div></div>
    </section>

    <section class="kit-section panel">
      <div class="panel-header"><h2>Segmented controls</h2></div>
      <div class="panel-body"><div class="kit-row">
        <div class="seg"><button class="seg-btn" aria-pressed="true">Candles</button><button class="seg-btn" aria-pressed="false">Line</button></div>
        <div class="seg"><button class="seg-btn" aria-pressed="false">1M</button><button class="seg-btn" aria-pressed="true">3M</button><button class="seg-btn" aria-pressed="false">1Y</button></div>
      </div></div>
    </section>

    <section class="kit-section panel">
      <div class="panel-header"><h2>Pills</h2></div>
      <div class="panel-body">
        <div class="pills">
          <button class="pill" aria-pressed="true">STRONG BUY</button>
          <button class="pill" aria-pressed="false">BUY</button>
          <button class="pill" aria-pressed="false">HOLD</button>
          <button class="pill" aria-pressed="true">IT</button>
        </div>
      </div>
    </section>

    <section class="kit-section panel">
      <div class="panel-header"><h2>KPI cards</h2></div>
      <div class="panel-body"><div class="grid g4">
        ${kpiCard('Equity', '₹11.24 L', '<span class="up">+12.4%</span> since start')}
        ${kpiCard('Drawdown', '<span class="dn">-6.2%</span>', 'max drawdown')}
        ${kpiCard('Positions', '8 / 15', 'open positions')}
        ${kpiCard('Coverage', '94.2%', 'price histories')}
      </div></div>
    </section>

    <section class="kit-section panel">
      <div class="panel-header"><h2>Banners</h2></div>
      <div class="panel-body" style="display:grid;gap:8px">
        <div class="banner demo">DEMO — Synthetic data, not real prices.</div>
        <div class="banner ok">All systems operational.</div>
        <div class="banner warn">Data is 2 days old. Check the pipeline.</div>
        <div class="banner bad">Pipeline failed. Last good snapshot preserved.</div>
      </div>
    </section>

    <section class="kit-section panel">
      <div class="panel-header"><h2>Empty states</h2></div>
      <div class="panel-body"><div class="grid g2">
        ${empty('No data available.', '📊')}
        ${empty('No results match your filters.', '🔍')}
      </div></div>
    </section>

    <section class="kit-section panel">
      <div class="panel-header"><h2>Skeleton loader</h2></div>
      <div class="panel-body">
        <div class="skel" style="height:14px;width:200px;margin-bottom:8px"></div>
        <div class="skel" style="height:14px;width:300px;margin-bottom:8px"></div>
        <div class="skel" style="height:80px"></div>
      </div>
    </section>

    <section class="kit-section panel">
      <div class="panel-header"><h2>Gauge</h2></div>
      <div class="panel-body">
        <div class="gauge" style="margin:10px 0"><div class="gauge-needle" style="left:65%"></div></div>
        <div class="dimmed" style="font-size:11px">Market regime: RISK-ON (score 68)</div>
      </div>
    </section>
  </div>`;
}
