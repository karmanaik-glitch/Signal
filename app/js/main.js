/**
 * STRATA Markets v3.0 — Application bootstrap.
 *
 * Responsibilities:
 *  - Shell: top bar chrome, rail, mobile tabs, footer, palette, toasts
 *  - Router: 5 modules + Stock View
 *  - Data load / refresh lifecycle
 */
import { $, $$, esc, num, f2, pct, cls, store, debounce, normalizeSymbol } from './util.js';
import { D, loadSnapshot, ageDays, isDemo } from './data.js';
import { parseHash, pushState, saveScroll, navigate, goBack } from './router.js';
import * as V from './views.js';

// ---- 5-module navigation --------------------------------------------------

const ROUTES = [
  ['home',      'Home',      'i-home'],
  ['signals',   'Signals',   'i-signals'],
  ['watchlist', 'Watchlist', 'i-watchlist'],
  ['rulebot',   'Rulebot',   'i-rulebot'],
  ['more',      'More',      'i-more'],
];

const railLink = ([id, label, icon]) =>
  `<a href="#/${id}" class="rail-link" data-r="${id}" aria-label="${esc(label)}" title="${esc(label)}" tabindex="0">` +
  `<svg width="18" height="18" aria-hidden="true"><use href="#${icon}"/></svg>` +
  `</a>`;

const tabLink = ([id, label, icon]) =>
  `<a href="#/${id}" class="tab-link" data-r="${id}" aria-label="${esc(label)}">` +
  `<svg><use href="#${icon}"/></svg>${esc(label)}</a>`;

// Build rail + tabs (rail is icon-only with clean tooltips)
$('#rail').innerHTML = ROUTES.map(railLink).join('');
$('#tabs').innerHTML = ROUTES.map(tabLink).join('');

// ---- Toast ----------------------------------------------------------------

const toastEl = $('#toast');
let toastTimer;
export const toast = msg => {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2400);
};

// ---- EOD Ticker Tape (Continuous Moving + Every Stock) --------------------

function updateTape() {
  const track = $('#tapeTrack');
  if (!track) return;
  const s = D.snap;
  if (!s) {
    track.innerHTML = '<span class="tape-item dimmed"><span class="tape-dot"></span>No market data</span>';
    return;
  }
  const b = s.benchmark || {};
  const age = ageDays();
  const demo = isDemo();
  const dateStr = s.exchange_date || b.date;

  const item = (label, val, chg, suffix = '') => {
    const hasVal = num(val);
    const hasChg = num(chg);
    const valStr = hasVal ? f2(val) : '—';
    const chgCls = hasChg ? cls(chg) : 'flat';
    const chgStr = hasChg ? pct(chg) : (hasVal ? '0.00%' : '—');
    return `<div class="tape-item" title="${label}: ${valStr} (${chgStr})">` +
      `<span class="tape-label">${label}</span>` +
      `<span class="tape-val mono">${valStr}</span>` +
      `<span class="tape-chg mono ${chgCls}">${chgStr}${suffix ? ` <small class="tape-suffix">${suffix}</small>` : ''}</span>` +
      `</div>`;
  };

  const stockItem = r => {
    const hasPrice = num(r.price);
    const hasChg = num(r.change_pct);
    const priceStr = hasPrice ? f2(r.price) : '—';
    const chgCls = hasChg ? cls(r.change_pct) : 'flat';
    const chgStr = hasChg ? pct(r.change_pct) : '0.00%';
    return `<a href="#/stock/${esc(r.symbol)}" class="tape-item tape-stock" title="${esc(r.symbol)} · ${esc(r.company || '')}: ₹${priceStr} (${chgStr})">` +
      `<span class="tape-label tape-sym">${esc(r.symbol)}</span>` +
      `<span class="tape-val mono">${priceStr}</span>` +
      `<span class="tape-chg mono ${chgCls}">${chgStr}</span>` +
      `</a>`;
  };

  let modeBadge = '';
  if (demo) {
    modeBadge = `<span class="tape-badge demo" title="Synthetic random-walk prices for demonstration">DEMO</span>`;
  } else if (age != null && age > 4) {
    modeBadge = `<span class="tape-badge bad" title="Session data is ${age} days old">STALE (${age}d)</span>`;
  } else {
    modeBadge = `<span class="tape-badge live" title="Verified EOD session">EOD</span>`;
  }

  const vixItem = () => {
    const hasVix = num(b.india_vix);
    const vixVal = hasVix ? f2(b.india_vix) : '—';
    const has20d = num(b.india_vix_change_20d_pct);
    const chg20d = has20d
      ? `<span class="tape-chg mono ${cls(b.india_vix_change_20d_pct)}">${pct(b.india_vix_change_20d_pct)}<small class="tape-suffix"> 20d</small></span>`
      : '';
    return `<div class="tape-item" title="India VIX: ${vixVal}">` +
      `<span class="tape-label">INDIA VIX</span>` +
      `<span class="tape-val mono">${vixVal}</span>` +
      chg20d +
      `</div>`;
  };

  const regime = s.market_regime?.label;
  const regimeHtml = regime
    ? `<div class="tape-item tape-regime" title="Market Regime: ${esc(regime)}"><span class="tape-label">REGIME</span><span class="tape-regime-val">${esc(regime)}</span></div>`
    : '';

  // Build complete list of items: Date & Mode, Benchmark Indices, followed by every stock
  const stockItems = (s.signals || []).map(stockItem);
  const coreItems = [
    `<div class="tape-meta">` +
      `<span class="tape-date"><span class="tape-dot"></span>EOD ${esc(dateStr || '—')}</span>` +
      modeBadge +
    `</div>`,
    item('NIFTY 50', b.nifty50_close, b.nifty50_change_pct),
    item('SENSEX', b.sensex_close, b.sensex_change_pct),
    item('BANK NIFTY', b.banknifty_close, b.banknifty_change_pct),
    vixItem(),
    regimeHtml,
    ...stockItems
  ].filter(Boolean);

  const fullContent = coreItems.join('<span class="tape-sep" aria-hidden="true">/</span>');

  // Render two identical groups for seamless infinite continuous scroll animation
  track.innerHTML = `<div class="tape-group">${fullContent}</div><span class="tape-sep" aria-hidden="true">/</span><div class="tape-group" aria-hidden="true">${fullContent}</div>`;
}

// ---- Chrome update (top bar + footer + tape) ------------------------------

function updateChrome() {
  const s = D.snap, chip = $('#freshChip');
  if (!s) { chip.textContent = 'no data'; chip.className = 'bad'; updateTape(); return; }
  const age = ageDays();
  if (isDemo()) { chip.textContent = 'DEMO'; chip.className = 'demo'; }
  else if (age != null && age > 4) { chip.textContent = `STALE · ${s.exchange_date}`; chip.className = 'bad'; }
  else { chip.textContent = `EOD ${s.exchange_date}`; chip.className = 'ok'; }

  // Footer
  const date  = $('#footerDate');
  const univ  = $('#footerUniverse');
  const rule  = $('#footerRuleset');
  const reg   = $('#footerRegime');
  if (date)  date.textContent  = s.exchange_date ? `EOD ${s.exchange_date}` : '—';
  if (univ)  univ.textContent  = esc(s.universe_label || '');
  if (rule)  rule.textContent  = esc(s.ruleset_version || '');
  if (reg)   reg.textContent   = esc(s.market_regime?.label || '');

  // Persistent EOD Tape
  updateTape();
}

// ---- Active rail indicator ------------------------------------------------

function markActive(route) {
  $$('[data-r]').forEach(el =>
    el.dataset.r === route
      ? el.setAttribute('aria-current', 'page')
      : el.removeAttribute('aria-current')
  );
}

// ---- Render ---------------------------------------------------------------

const main  = $('#main');
const charts = [];
export const disposeCharts = () => charts.splice(0).forEach(c => c?.destroy?.());

let renderToken = 0;

async function render() {
  const my = ++renderToken;
  disposeCharts();
  main.textContent = '';

  const { route, params } = parseHash();
  markActive(route === 'stock' ? '' : route);

  if (!D.snap) {
    main.innerHTML = `<div class="page"><div class="banner bad">Could not load market data: ${esc(D.error || 'unknown error')}. <button class="btn btn-sm" id="retryBtn">Retry</button></div></div>`;
    $('#retryBtn').onclick = boot;
    return;
  }

  // Banners (demo / stale)
  const banners = [];
  const age = ageDays();
  if (isDemo()) {
    banners.push(`<div class="banner demo"><strong>DEMO</strong> Synthetic random-walk data for illustration only — not real prices or signals. Run the pipeline to publish live data.</div>`);
  } else if (age != null && age > 4) {
    banners.push(`<div class="banner bad"><strong>Stale data.</strong> Last session ${esc(D.snap.exchange_date)} is ${age} days old. Check the GitHub Actions run.</div>`);
  }

  const holder = document.createElement('div');
  holder.className = 'page';
  holder.innerHTML = banners.join('') + '<div id="view"></div>';
  main.append(holder);
  main.scrollTop = 0;

  const view = $('#view');

  // Move focus to main on route change (accessibility)
  main.focus();

  try {
    if (route === 'stock') {
      const sym = normalizeSymbol(params);
      await V.stockView(view, sym, toast);
      document.title = sym ? `${sym} · Signal` : 'Signal';
    } else {
      const fn = V[route] || V.home;
      await fn(view, params, toast);
      const label = ROUTES.find(r => r[0] === route)?.[1] || 'Signal';
      document.title = `${label} · Signal`;
    }
    if (my !== renderToken) return;
  } catch (e) {
    console.error('View render error:', e);
    if (view) view.innerHTML = `<div class="banner bad">This view failed to render: ${esc(e.message)}</div>`;
  }
}

// ---- Command palette -------------------------------------------------------

const pal    = $('#pal');
const palIn  = $('#palIn');
const palList = $('#palList');
let palItems = [], palSel = 0;

function palRender() {
  const q = palIn.value.trim().toLowerCase();
  const cmds = [
    ...ROUTES.map(([id, n]) => ({ t: 'Go to ' + n, k: 'nav', go: '#/' + id })),
    { t: 'Toggle theme', k: 'cmd', fn: toggleTheme },
    { t: 'Reload data',  k: 'cmd', fn: boot },
  ];
  const stocks = (D.snap?.signals || [])
    .filter(r => q && (r.symbol.toLowerCase().startsWith(q) || (r.company || '').toLowerCase().includes(q)))
    .slice(0, 8)
    .map(r => ({ t: `${r.symbol} — ${r.company}`, k: r.signal, go: '#/stock/' + r.symbol }));
  palItems = [...stocks, ...cmds.filter(c => !q || c.t.toLowerCase().includes(q))].slice(0, 12);
  palSel = Math.min(palSel, palItems.length - 1);
  palList.innerHTML = palItems.map((x, i) =>
    `<li class="pal-item" role="option" aria-selected="${i === palSel}" data-i="${i}">` +
    `<span>${esc(x.t)}</span><span class="pal-item-meta">${esc(x.k)}</span></li>`
  ).join('') || `<li class="pal-item muted">No matches</li>`;
}

const runPal = i => {
  const x = palItems[i]; if (!x) return;
  pal.close();
  if (x.go) navigate(x.go); else x.fn?.();
};

palIn.addEventListener('input', () => { palSel = 0; palRender(); });
palIn.addEventListener('keydown', e => {
  if      (e.key === 'ArrowDown') { palSel = Math.min(palItems.length - 1, palSel + 1); e.preventDefault(); }
  else if (e.key === 'ArrowUp')   { palSel = Math.max(0, palSel - 1); e.preventDefault(); }
  else if (e.key === 'Enter')     { runPal(palSel); return; }
  else return;
  palRender();
  palList.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
});
palList.addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) runPal(+li.dataset.i); });

const openPal = () => { palIn.value = ''; palSel = 0; palRender(); pal.showModal(); palIn.focus(); };
$('#palBtn').onclick = openPal;
const palBtnMobile = $('#palBtnMobile');
if (palBtnMobile) palBtnMobile.onclick = openPal;
pal.addEventListener('click', e => { if (e.target === pal) pal.close(); });

// ---- Theme toggle ---------------------------------------------------------

function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  store.set('theme', t);
  document.querySelector('meta[name=theme-color]').content = t === 'dark' ? '#000000' : '#f5f7fa';
}
$('#themeBtn').onclick = toggleTheme;

// ---- Keyboard shortcuts ---------------------------------------------------

let gKey = 0;
document.addEventListener('keydown', e => {
  const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName);
  if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
    e.preventDefault(); openPal(); return;
  }
  if (typing || e.ctrlKey || e.metaKey) return;
  if (e.key === 'g') { gKey = Date.now(); return; }
  if (Date.now() - gKey < 900) {
    const map = { h: 'home', s: 'signals', w: 'watchlist', b: 'rulebot', m: 'more' };
    if (map[e.key]) { navigate('#/' + map[e.key]); gKey = 0; }
  }
});

// ---- Boot / refresh -------------------------------------------------------

window.addEventListener('hashchange', render);
document.addEventListener('signal:reload', () => boot());
document.addEventListener('strata:reload', () => boot());

async function boot() {
  await loadSnapshot();
  updateChrome();
  await render();
  if (D.snap) toast('Data refreshed');
}

// ---- Visibility-based refresh (after 30 min idle) -------------------------

document.addEventListener('visibilitychange', debounce(async () => {
  if (!document.hidden && D.loadedAt && Date.now() - D.loadedAt > 30 * 60_000) {
    const prev = D.snap?.exchange_date;
    await loadSnapshot();
    updateChrome();
    if (D.snap?.exchange_date !== prev) { render(); toast('New session data loaded'); }
  }
}, 400));

// ---- Install App on Phone Notification (Inactive / Commented out) ---------
/*
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
});

function initInstallNotification() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (isStandalone) return;

  const banner = $('#installBanner');
  const installBtn = $('#installBtn');
  const dismissBtn = $('#dismissInstallBtn');
  if (!banner || !installBtn) return;

  // Show notification banner each time website is opened
  setTimeout(() => {
    banner.hidden = false;

    // Also trigger native browser notification if permission already granted
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('Install Signal on your phone', {
          body: 'Add to Home Screen for fast, full-screen EOD research & offline access.',
          icon: 'icons/icon-192.png'
        });
      } catch (e) {}
    }
  }, 1200);

  installBtn.onclick = async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          new Notification('Install Signal on your phone', {
            body: 'Add to Home Screen for fast, full-screen EOD research & offline access.',
            icon: 'icons/icon-192.png'
          });
        }
      } catch (e) {}
    }

    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice?.outcome === 'accepted') {
        banner.hidden = true;
        toast('Installing Signal App…');
      }
      deferredInstallPrompt = null;
      return;
    }

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) {
      toast('Tap the Share button ⎋ in Safari, then tap "Add to Home Screen" ⊕');
      return;
    }

    toast('To install: click the Install icon ⊕ in your browser address bar.');
  };

  if (dismissBtn) {
    dismissBtn.onclick = () => {
      banner.hidden = true;
    };
  }
}
*/

// ---- Service worker -------------------------------------------------------

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---- Initial load ---------------------------------------------------------
await loadSnapshot();
updateChrome();
await render();
// initInstallNotification();

