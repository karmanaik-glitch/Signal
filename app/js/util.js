/** STRATA v3 — Shared utilities. Keep pure; no DOM access here. */

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// HTML escape — every external string goes through this
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ENT[c]);

// Numeric guard
export const num = v => typeof v === 'number' && Number.isFinite(v);

// Symbol normalizer — canonical NSE identifier
export function normalizeSymbol(raw) {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\.NS$/i, '')
    .replace(/[^A-Z0-9&_-]/g, '');
}

// Formatters (en-IN locale)
const nf = d => new Intl.NumberFormat('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
const N2 = nf(2), N0 = nf(0);
export const f2  = v => num(v) ? N2.format(v) : '—';
export const f0  = v => num(v) ? N0.format(v) : '—';
export const inr = v => {
  if (!num(v)) return '—';
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e7) return s + '₹' + N2.format(a / 1e7) + ' Cr';
  if (a >= 1e5) return s + '₹' + N2.format(a / 1e5) + ' L';
  return s + '₹' + N2.format(a);
};
export const pct = (v, d = 2) => num(v) ? (v > 0 ? '+' : '') + v.toFixed(d) + '%' : '—';
export const cls = v => !num(v) || v === 0 ? 'flat' : v > 0 ? 'up' : 'dn';

// Signal metadata
export const SIGS = ['STRONG BUY', 'BUY', 'HOLD', 'SELL', 'STRONG SELL', 'DATA BLOCKED'];
export const sigClass = s => ({
  'STRONG BUY': 'sig sig-sb', 'BUY': 'sig sig-b', 'HOLD': 'sig sig-h',
  'SELL': 'sig sig-s', 'STRONG SELL': 'sig sig-ss', 'DATA BLOCKED': 'sig sig-x',
  'STOP': 'sig sig-ss'
}[s] || 'sig sig-x');
export const badge = s => `<span class="${sigClass(s)}">${esc(s)}</span>`;

// Score bar (0–100, no inline styles)
export const scoreBar = v => {
  if (!num(v)) return '<span class="muted">—</span>';
  const pct = Math.max(0, Math.min(100, v));
  return `<span class="score-bar mono">${v.toFixed(0)}<span class="score-bar-track"><span class="score-bar-fill" style="width:${pct}%"></span></span></span>`;
};

// localStorage wrapper
export const store = {
  get(k, d) { try { const v = localStorage.getItem('strata:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('strata:' + k, JSON.stringify(v)); } catch { /* blocked */ } }
};

// Debounce
export const debounce = (fn, ms = 160) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// CSV with formula-injection guard
export function csv(rows, cols) {
  const cell = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n');
}

// Download helper
export function download(name, text, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// Inline sparkline SVG
export const spark = (vals, w = 80, h = 22) => {
  const v = vals.filter(num); if (v.length < 2) return '';
  const mn = Math.min(...v), mx = Math.max(...v), r = mx - mn || 1;
  const p = v.map((y, i) => `${(i / (v.length - 1) * w).toFixed(1)},${(h - 1 - (y - mn) / r * (h - 2)).toFixed(1)}`).join(' ');
  const dir = v.at(-1) >= v[0] ? 'up' : 'dn';
  return `<svg class="spark ${dir}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${p}" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
};
