/**
 * STRATA v3 — Client-side router.
 *
 * Routes:  #/home · #/signals[?tab=T] · #/watchlist · #/rulebot · #/more[?tab=T]
 *          #/stock/<SYMBOL>
 *
 * Navigation state stack: stored in sessionStorage so back-button always
 * returns to the exact previous module with its filter state and scroll position.
 *
 * Entry points: call navigate(hash) or use browser back/forward.
 * The browser back button and on-screen back button behave identically.
 */
import { store } from './util.js';

const STACK_KEY = 'strata:navstack';
const MAX_STACK = 20;

// ----- State stack helpers -----------------------------------------------

function getStack() {
  try { return JSON.parse(sessionStorage.getItem(STACK_KEY) || '[]'); }
  catch { return []; }
}

function setStack(stack) {
  try { sessionStorage.setItem(STACK_KEY, JSON.stringify(stack.slice(-MAX_STACK))); }
  catch { /* storage blocked */ }
}

export function pushState(entry) {
  // entry = { route, params, label, scrollTop, filterState }
  const stack = getStack();
  stack.push({ ...entry, ts: Date.now() });
  setStack(stack);
}

export function saveScroll() {
  const stack = getStack();
  if (!stack.length) return;
  const top = document.getElementById('main')?.scrollTop ?? 0;
  stack[stack.length - 1].scrollTop = top;
  setStack(stack);
}

export function popState() {
  const stack = getStack();
  stack.pop();
  setStack(stack);
  return stack.at(-1) || null;
}

export function peekPrevious() {
  const stack = getStack();
  return stack.length >= 2 ? stack[stack.length - 2] : null;
}

export function clearStack() { sessionStorage.removeItem(STACK_KEY); }

// ----- Route parsing -------------------------------------------------------

/**
 * Parse location.hash into { route, params, rawHash }.
 * Canonical format: #/<route>[/<params>]
 */
export function parseHash(hash = location.hash) {
  const m = hash.match(/^#\/([^/?]*)(?:\/(.*))?(?:\?(.*))?$/) || [];
  const route = (m[1] || 'home').toLowerCase();
  const params = m[2] ? decodeURIComponent(m[2]) : '';
  const qs = m[3] || '';
  const searchParams = Object.fromEntries(new URLSearchParams(qs));
  return { route, params, searchParams, rawHash: hash };
}

// ----- Module registry (filled by main.js) ---------------------------------

const handlers = {};

/** Register a view handler: register('home', async (el, ctx) => { ... }) */
export function register(route, fn) { handlers[route] = fn; }

// ----- Public navigation API -----------------------------------------------

let _currentRoute = null;
let _token = 0;

/**
 * Navigate to a hash. Saves scroll position of current view before navigating.
 * @param {string} hash - e.g. '#/home' or '#/stock/TCS'
 * @param {boolean} [replace=false] - replace history entry rather than push
 */
export function navigate(hash, replace = false) {
  if (replace) history.replaceState(null, '', hash);
  else history.pushState(null, '', hash);
  dispatchEvent(new HashChangeEvent('hashchange'));
}

/** Navigate back — uses browser history which respects the state stack. */
export function goBack() { history.back(); }

// ----- Render engine (stub — main.js calls render directly) ----------------
// The hashchange/popstate listeners live in main.js.

// ---- Link delegation — data-stock and data-route attributes ---------------
// Every stock link in the app uses <a data-stock="SYM"> or <tr data-stock="SYM">.
// Centralising click handling here means views never need to wire their own navigation.

document.addEventListener('click', e => {
  const stockEl = e.target.closest('[data-stock]');
  if (stockEl && !e.target.closest('button.btn, input, select')) {
    e.preventDefault();
    saveScroll();
    navigate('#/stock/' + encodeURIComponent(stockEl.dataset.stock));
    return;
  }
  const routeEl = e.target.closest('[data-route]');
  if (routeEl && !e.target.closest('button.btn, input, select')) {
    e.preventDefault();
    navigate('#/' + routeEl.dataset.route);
  }
});

document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-stock]')) {
    e.preventDefault();
    saveScroll();
    navigate('#/stock/' + encodeURIComponent(e.target.dataset.stock));
  }
});
