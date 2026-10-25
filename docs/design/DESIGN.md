# STRATA Markets v3.0 — Design Document

> This document is the single source of truth for visual decisions.  
> All CSS variables flow from the tokens defined here. Do not make ad-hoc colour or spacing choices in components.

---

## 1. Design Principles

1. **Data first, chrome second.** Every pixel of layout exists to surface market information faster. Decoration is earned, not assumed.
2. **Precision over warmth.** This is a research terminal, not a consumer app. Type is tight, numbers are monospaced, grids are dense.
3. **Two first-class themes.** Dark and Light are designed independently. Dark is not an inversion of Light — both must pass WCAG AA contrast and feel deliberate.
4. **Motion is purposeful.** Transitions convey state change (route, expand, load). They are short (≤150 ms), never looping, and always respect `prefers-reduced-motion`.
5. **Keyboard everywhere.** Every interactive element — including table reorder, watchlist management, and signal filters — must be reachable and operable by keyboard alone.
6. **Honest empty states.** If data is unavailable, say so plainly. Never show a placeholder number or a spinner that never resolves.

---

## 2. Moodboard in Words

**Inspiration:** Bloomberg Terminal reimagined for the open web. Quant research dashboard. High-density data grid with a surgeon's precision.

**Not:** Consumer fintech (bright gradients, large friendly type, chunky cards).  
**Not:** The v2.0 near-black + amber palette.

**Keywords:** graphite, cool ivory, teal accent, hairlines, tabular numerals, workspace, cockpit.

**Comparable aesthetic references (described):**
- A professional trading terminal in muted charcoal and cream
- A TeX-typeset research report — sharp, legible, no noise
- A code editor's file explorer — information-dense, icon + label
- A precision instrument panel — gauges, bars, real values only

---

## 3. Colour Tokens

### 3.1 Semantic colour roles

| Role | Purpose |
|---|---|
| `--bg-base` | Page / app background |
| `--bg-raised` | Panels, cards, header |
| `--bg-sunken` | Input fields, table rows hover, inner inset areas |
| `--bg-overlay` | Dialogs, tooltips, floating panels |
| `--border` | 1px hairline between regions |
| `--border-focus` | Focus ring |
| `--text-primary` | Body text |
| `--text-secondary` | Labels, subtitles, column headers |
| `--text-muted` | Placeholders, disabled, footnotes |
| `--accent` | Interactive: links, active states, progress, cursor |
| `--accent-subtle` | Accent backgrounds at low opacity |

Signal colours are **never reused** for non-signal purposes:

| Signal | Token | Dark | Light |
|---|---|---|---|
| STRONG BUY | `--sig-sb` | `#22c55e` | `#16a34a` |
| BUY | `--sig-b` | `#86efac` | `#4ade80` |
| HOLD | `--sig-h` | `#94a3b8` | `#64748b` |
| SELL | `--sig-s` | `#fb923c` | `#ea580c` |
| STRONG SELL | `--sig-ss` | `#ef4444` | `#dc2626` |
| DATA BLOCKED | `--sig-x` | `#475569` | `#94a3b8` |

Change direction (not signals):
| Role | Token | Dark | Light |
|---|---|---|---|
| Positive / up | `--pos` | `#22c55e` | `#16a34a` |
| Negative / down | `--neg` | `#ef4444` | `#dc2626` |
| Neutral / flat | `--flat` | `--text-muted` | `--text-muted` |

### 3.2 Dark theme palette

```
--bg-base:     #0f1117   (very dark graphite, not pure black)
--bg-raised:   #161b24   (card / panel)
--bg-sunken:   #0c1018   (inputs, inset)
--bg-overlay:  #1e2533   (dialogs, tooltips)
--border:      #2a3347   (1px hairlines)
--border-focus: #00d4aa  (accent)

--text-primary:   #e8edf5
--text-secondary: #8b96a9
--text-muted:     #5a6476

--accent:        #00d4aa  (teal)
--accent-subtle: rgba(0,212,170,0.12)
--accent-hover:  #00e8bb

--pos:  #22c55e
--neg:  #ef4444
--warn: #f59e0b
```

### 3.3 Light theme palette

```
--bg-base:     #f1f4f8   (cool ivory, not pure white)
--bg-raised:   #ffffff
--bg-sunken:   #e8ecf2
--bg-overlay:  #ffffff
--border:      #d0d7e3
--border-focus: #0aa888

--text-primary:   #111827
--text-secondary: #4b5563
--text-muted:     #9ca3af

--accent:        #0aa888  (slightly deeper teal for light bg contrast)
--accent-subtle: rgba(10,168,136,0.10)
--accent-hover:  #088a6e

--pos:  #16a34a
--neg:  #dc2626
--warn: #d97706
```

---

## 4. Typography

### 4.1 Typefaces

| Role | Family | Source |
|---|---|---|
| UI / body | **Inter Variable** | `app/fonts/inter-variable.woff2` (self-hosted) |
| Numbers / code | **JetBrains Mono** | `app/fonts/jetbrains-mono.woff2` (self-hosted) |

Remote font hosts (`fonts.googleapis.com`, etc.) are **forbidden** by the CSP. All font files must be in `app/fonts/`.

### 4.2 Type scale

| Name | Size | Line Height | Weight | Usage |
|---|---|---|---|---|
| `--text-xs` | 11px | 1.4 | 500 | Column headers, badges, chips |
| `--text-sm` | 12px | 1.5 | 400 | Secondary labels, table cells |
| `--text-base` | 13px | 1.6 | 400 | Body, default |
| `--text-md` | 14px | 1.5 | 500 | Card titles, panel headings |
| `--text-lg` | 16px | 1.4 | 600 | Page headings (h1) |
| `--text-xl` | 20px | 1.3 | 700 | KPI values, key numbers |
| `--text-2xl` | 24px | 1.2 | 700 | Hero numbers (equity total) |
| `--text-mono-sm` | 11px | 1.4 | 500 | Small numerals |
| `--text-mono-base` | 13px | 1.5 | 400 | Table number cells |
| `--text-mono-lg` | 16px | 1.3 | 600 | Large price values |

All numeric data cells (prices, percentages, scores) use `font-family: var(--font-mono); font-variant-numeric: tabular-nums`.

---

## 5. Spacing

8-point grid. All spacing values are multiples of 4px:

```
--space-1:  4px
--space-2:  8px
--space-3: 12px
--space-4: 16px
--space-5: 20px
--space-6: 24px
--space-8: 32px
--space-10: 40px
--space-12: 48px
```

Component-specific:
```
--top-bar-h:   44px
--rail-w:      48px   (collapsed) / 200px (expanded)
--rail-w-expanded: 200px
--footer-h:    28px
--context-w:   320px  (right panel, ≥1280px)
--row-h:       32px   (compact) / 40px (comfortable)
--cell-px:     10px
```

---

## 6. Border Radii

```
--radius-sm:  4px   (badges, inputs, small chips)
--radius-md:  8px   (panels, cards, buttons)
--radius-lg:  12px  (dialogs, dropdowns)
--radius-xl:  16px  (large card)
--radius-full: 9999px  (pills)
```

---

## 7. Elevation / Shadow

Only floating layers get shadows. In-flow panels use border only.

```
--shadow-sm:  0 1px 3px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.12)
--shadow-md:  0 4px 12px rgba(0,0,0,0.25), 0 2px 6px rgba(0,0,0,0.15)
--shadow-lg:  0 16px 48px rgba(0,0,0,0.40), 0 8px 20px rgba(0,0,0,0.20)
```

Light theme shadows use lower opacity (0.08 / 0.06 / 0.15).

---

## 8. Motion

```
--ease-default:   cubic-bezier(0.4, 0, 0.2, 1)   /* material standard */
--ease-out:       cubic-bezier(0.0, 0, 0.2, 1)
--ease-in:        cubic-bezier(0.4, 0, 1, 1)

--duration-fast:   80ms   (micro-interactions: hover, focus)
--duration-base:  120ms   (state transitions: open, active)
--duration-slow:  200ms   (route change fade, panel slide)
```

`@media (prefers-reduced-motion: reduce)` → `--duration-fast: 0ms; --duration-base: 0ms; --duration-slow: 0ms`

---

## 9. Grid / Layout

### Shell (desktop ≥900px)
```
┌────────────────────────────────────────────────────────┐
│  Top bar (44px)                                        │  row 1
├────┬───────────────────────────────────────┬───────────┤
│Rail│  Main content (scroll)                │ Context   │  row 2 (fills)
│48px│                                       │ 320px     │
├────┴───────────────────────────────────────┴───────────┤
│  Status footer (28px)                                  │  row 3
└────────────────────────────────────────────────────────┘
```

CSS Grid:
```css
#app {
  display: grid;
  grid-template-columns: var(--rail-w) 1fr var(--context-w, 0px);
  grid-template-rows: var(--top-bar-h) 1fr var(--footer-h);
  grid-template-areas: "top  top  top"
                       "rail main ctx"
                       "foot foot foot";
  height: 100dvh;
}
```

Context panel hidden by default; shown when a stock peek is active.

### Mobile (≤899px)
```css
#app {
  grid-template-columns: 1fr;
  grid-template-rows: var(--top-bar-h) 1fr;
  grid-template-areas: "top" "main";
}
/* Bottom tab bar replaces rail */
```

---

## 10. Component Inventory

### Core components (must be in `/#/__kit`)

| Component | Notes |
|---|---|
| **Button** | Primary (teal bg), Secondary (border), Ghost (transparent), Danger; sizes sm/md/lg |
| **Input** | Text, Search, Number; error state; prefix/suffix icon |
| **Select** | Native `<select>` styled; matches Input height |
| **Badge / Signal badge** | 5 signal levels + DATA BLOCKED; size xs/sm |
| **Chip** | Status chip (OK/DEMO/STALE/BAD) |
| **Score bar** | Inline bar showing 0–100 score with colour fill |
| **Tab bar** | Horizontal; scrollable on mobile; active indicator underline |
| **Table** | Sticky header, sticky first column, sortable headers, hoverable rows, keyboard-navigable |
| **Panel** | Card with header + body; `flush` variant (no body padding) |
| **Popover** | Small floating panel anchored to trigger |
| **Dialog** | Modal (`<dialog>`); focus-trapped; `Escape` closes |
| **Toast** | Bottom-center, `aria-live="polite"`, auto-dismiss 2.4 s |
| **Empty state** | Icon + heading + subtitle; variants: no data / error / offline |
| **Skeleton** | Animated shimmer placeholder; matches target shape |
| **Gauge** | Horizontal gradient bar with marker needle |
| **Sparkline** | Inline SVG, up/down colour |
| **Sector tile** | Heat-map coloured button for sector heatmap |
| **Command bar / Palette** | Full-width input at top (desktop); `<dialog>` on mobile |

---

## 11. Layout Sketches

### 11.1 Home (Market Cockpit)

```
TOP BAR: [STRATA]  [search cmd bar .........]  [RISK-ON]  [2026-10-23]  [◐]
RAIL:    🏠 Home ←active
         📊 Signals
         ★  Watchlist
         🤖 Rulebot
         ⋯  More
         ───
         [indicators: 2 items]
MAIN:
  ┌─ Indices strip (full-width row) ──────────────────────────────────────┐
  │  NIFTY 50  22,418  +0.43%  [spark]  │  SENSEX  73,x  +0.38%  │ ...  │
  └───────────────────────────────────────────────────────────────────────┘
  ┌─ Breadth bar ─────────────────────────────────────────────────────────┐
  │  [■■■■■■■■■ 62% advancing ░░░░░ 28% declining ░░ 10% unch]           │
  │  Universe breadth: 312 up / 144 dn / 44 unch    Regime: RISK-ON  68  │
  └───────────────────────────────────────────────────────────────────────┘
  ┌─ Sector heatmap ──────────────────────────┐ ┌─ What changed ─────────┐
  │  [IT +1.4%]  [Financials +0.8%]           │ │  ↑ 12 upgrades         │
  │  [Energy -0.2%]  [Healthcare +0.3%]       │ │  ↓  5 downgrades       │
  │  [Consumer -0.6%]  [Auto +0.2%]           │ │  → 2 orders queued     │
  │  [Metals -1.1%]  [Industrials +0.5%]      │ │  [Go to Signals]       │
  └───────────────────────────────────────────┘ └────────────────────────┘
  ┌─ Top gainers ──────────────────────┐ ┌─ Top losers ───────────────────┐
  │  TCS      +2.1%  BUY              │ │  BHEL     -3.2%  SELL          │
  │  INFY     +1.8%  STRONG BUY       │ │  VEDL     -2.8%  HOLD          │
  └────────────────────────────────────┘ └────────────────────────────────┘
FOOTER: EOD 2026-10-23 · NIFTY 500 · strata-rules-0.4.0 · PAPER ONLY
```

### 11.2 Stock View

```
TOP BAR: [←]  TCS · NSE  ₹3,842.50  +1.24%  2026-10-23  [★ Add to watchlist ▾]
TABS:    [Overview] [Chart] [Technicals] [Fundamentals] [Financials] [News]
─ Chart tab ─────────────────────────────────────────────────────────────────
CONTROLS: [Candles|Line]  [1M][3M][6M][1Y][3Y]   [SMA20][SMA50][SMA200]
          [BB][Vol][RSI][MACD]
CHART:    ┌──────────────────────────────────────────────────────────────┐
          │  Candlestick / Line  + Bollinger Bands + SMA overlays       │
          │  Buy/Sell markers for Rulebot trades                        │
          ├──────────────────────────────────────────────────────────────┤
          │  Volume bars                                                 │
          ├──────────────────────────────────────────────────────────────┤
          │  RSI (0–100, 30/70 lines)                                   │
          └──────────────────────────────────────────────────────────────┘
```

### 11.3 Rulebot

```
TOP BAR: [STRATA]  [cmd]  [regime]  [date]  [◐]
RAIL:    🤖 Rulebot ←active
MAIN:
  ┌─ Portfolio band ──────────────────────────────────────────────────────┐
  │  Equity ₹11.24 L  +12.4% since start   Cash ₹3.2 L  Positions 8/15 │
  │  Unrealised P&L  +₹82,000   Max drawdown -6.2%   Win rate 58%       │
  └───────────────────────────────────────────────────────────────────────┘
  ┌─ Equity vs Nifty (rebased to 100) ────────────────────────────────────┐
  │  [line chart: Strategy in teal, Nifty in grey, drawdown histogram]   │
  └───────────────────────────────────────────────────────────────────────┘
  ┌─ Allocation by sector ──────────────────────────────────────────────── ┐
  │  [stacked bar: IT 28% | Financials 22% | Energy 18% | ...]           │
  └───────────────────────────────────────────────────────────────────────┘
  ┌─ Positions ──────────────────────────────────────────────────────────── ┐
  │  Symbol  Sector   Entry   Last   P&L     Wt%  [stop bar]             │
  │  TCS     IT       3,720  3,842  +3.3%   12%  ████░░  stop 3,560     │
  └───────────────────────────────────────────────────────────────────────┘
```

---

## 12. Accessibility Requirements

- **WCAG AA contrast** in both themes: 4.5:1 for body text, 3:1 for large text and UI components.
- **Focus ring:** `outline: 2px solid var(--accent); outline-offset: 2px` on all interactive elements.
- **Focus management:** On route change, move focus to the `<h1>` of the new page.
- **Keyboard path:** All tables navigable with arrow keys. Reorder via up/down buttons. Dialog focus-trapped.
- **`aria-live="polite"`** on the toast container.
- **`aria-sort`** on sortable table headers.
- **`aria-current="page"`** on active rail item.
- **No seizure-inducing animations** (no flashing, no fast looping).

---

## 13. Acceptance Criteria

1. `docs/design/before-after/dark-desktop.png` shows v2.0 and v3.0 side by side — immediately visually distinct.
2. `docs/design/before-after/light-desktop.png` — light theme is a deliberate first-class design, not an inversion.
3. `docs/design/before-after/mobile.png` — mobile five-tab bar, readable two-line table rows.
4. axe-core audit reports zero violations in both themes.
5. Lighthouse a11y ≥ 95, PWA ≥ 95, Best Practices ≥ 95 (mobile emulation).
6. `style-src 'self'` in CSP: no inline `style=` attributes anywhere in HTML or JS.
