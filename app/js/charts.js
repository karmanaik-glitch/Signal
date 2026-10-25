/**
 * STRATA Markets v3.0 — Canvas multi-pane chart engine.
 *
 * export function mount(canvas, tipEl, cfg) → { redraw(), destroy() }
 *
 * cfg = {
 *   x:       string[]          — date labels
 *   xfmt?:   fn(str) → str     — label formatter (default: show MM-DD)
 *   panes:   Pane[]
 *   markers?: Marker[]
 * }
 *
 * Pane = {
 *   h:        number             — relative height weight
 *   label?:   string             — pane header text (shown top-left)
 *   fmt?:     fn(v) → str        — y-axis value formatter
 *   tipfmt?:  fn(v) → str        — tooltip value formatter
 *   range?:   [min, max]         — fixed y range
 *   zero?:    boolean            — include 0 in range
 *   lines?:   { v, color? }[]   — horizontal reference lines
 *   series:   Series[]
 * }
 *
 * Series = {
 *   type?:    'line'|'candle'|'bar'|'hist'  (default: 'line')
 *   y?:       number[]           — close / value series
 *   o,h,l,c?: number[]           — OHLC (candle type)
 *   color?:   string             — CSS colour
 *   name?:    string             — tooltip label
 *   w?:       number             — line width
 * }
 *
 * Marker = { i: number, side: 'B'|'S', label?: string }
 */
import { num, f2 } from './util.js';

const C = () => {
  const get = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  return {
    bg:     get('--bg-raised'),
    border: get('--border'),
    tx:     get('--text-muted'),
    fg:     get('--text-primary'),
    up:     get('--pos'),
    dn:     get('--neg'),
    acc:    get('--accent'),
  };
};

export function mount(canvas, tip, cfg) {
  let state = { cx: null };
  const ctx = canvas.getContext('2d');

  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    canvas.width  = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const c = C();
    const n = cfg.x.length;
    if (n < 2) return;

    const L = 6, R = 60, B = 20, T = 4;
    const GAP = 5;
    const pw = W - L - R;
    const step = pw / n;
    const X = i => L + step * (i + 0.5);

    const panes = cfg.panes;
    const tot = panes.reduce((a, p) => a + (p.h || 1), 0);
    const avail = H - B - T - GAP * (panes.length - 1);

    const geo = [];
    let y0 = T;

    ctx.font = `11px var(--font-mono, ui-monospace, monospace)`;
    ctx.textBaseline = 'middle';

    panes.forEach(p => {
      const ph = avail * (p.h || 1) / tot;
      let mn = Infinity, mx = -Infinity;

      p.series.forEach(s => {
        const arrs = s.type === 'candle' ? [s.h, s.l] : [s.y];
        arrs.forEach(a => (a || []).forEach(v => {
          if (num(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); }
        }));
      });
      (p.lines || []).forEach(l => {
        if (num(l.v)) { mn = Math.min(mn, l.v); mx = Math.max(mx, l.v); }
      });
      if (p.zero) { mn = Math.min(mn, 0); mx = Math.max(mx, 0); }
      if (p.range) { [mn, mx] = p.range; }
      if (!Number.isFinite(mn)) { mn = 0; mx = 1; }
      const pad = (mx - mn) * 0.07 || 1;
      mn -= pad; mx += pad;
      const Y = v => y0 + ph - (v - mn) / (mx - mn) * ph;
      geo.push({ p, y0, ph, mn, mx, Y });

      // Grid lines
      ctx.strokeStyle = c.border;
      ctx.lineWidth = 0.5;
      ctx.textAlign = 'left';
      ctx.fillStyle = c.tx;
      const ticks = p.h >= 2 ? 5 : 3;
      for (let k = 0; k <= ticks; k++) {
        const first = geo.length === 1;
        if (!first && (k === 0 || k === ticks)) continue;
        const v = mn + (mx - mn) * k / ticks;
        const yy = Y(v);
        ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(W - R, yy); ctx.stroke();
        ctx.fillText((p.fmt || f2)(v), W - R + 6, yy);
      }

      // Reference lines (RSI 30/70, etc.)
      (p.lines || []).forEach(l => {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = l.color || c.tx;
        ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.moveTo(L, Y(l.v)); ctx.lineTo(W - R, Y(l.v)); ctx.stroke();
        ctx.restore();
      });

      // Series
      p.series.forEach(s => {
        if (s.type === 'candle') {
          const bw = Math.max(1, step * 0.62);
          for (let i = 0; i < n; i++) {
            const o = s.o?.[i], cl = s.c?.[i], h = s.h?.[i], l = s.l?.[i];
            if (!num(o) || !num(cl)) continue;
            const col = cl >= o ? c.up : c.dn;
            ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(X(i), Y(h)); ctx.lineTo(X(i), Y(l)); ctx.stroke();
            const top = Y(Math.max(o, cl));
            const hh = Math.max(1, Math.abs(Y(o) - Y(cl)));
            ctx.fillRect(X(i) - bw / 2, top, bw, hh);
          }
        } else if (s.type === 'bar' || s.type === 'hist') {
          const bw = Math.max(1, step * 0.7);
          const base = Y(s.type === 'hist' ? 0 : mn);
          for (let i = 0; i < n; i++) {
            const v = s.y?.[i];
            if (!num(v)) continue;
            ctx.fillStyle = s.type === 'hist'
              ? (v >= 0 ? c.up : c.dn)
              : (s.color || c.tx);
            ctx.globalAlpha = 0.55;
            ctx.fillRect(X(i) - bw / 2, Math.min(Y(v), base), bw, Math.abs(base - Y(v)));
            ctx.globalAlpha = 1;
          }
        } else {
          // Line
          ctx.strokeStyle = s.color || c.acc;
          ctx.lineWidth = s.w || 1.5;
          ctx.lineJoin = 'round';
          ctx.beginPath();
          let on = false;
          (s.y || []).forEach((v, i) => {
            if (!num(v)) { on = false; return; }
            on ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v));
            on = true;
          });
          ctx.stroke();
        }
      });

      // Pane label
      if (p.label) {
        ctx.fillStyle = c.tx;
        ctx.textAlign = 'left';
        ctx.font = '10px var(--font-mono, ui-monospace, monospace)';
        ctx.fillText(p.label, L + 4, y0 + 9);
        ctx.font = '11px var(--font-mono, ui-monospace, monospace)';
      }

      y0 += ph + GAP;
    });

    // X-axis labels
    ctx.fillStyle = c.tx;
    ctx.textAlign = 'center';
    ctx.font = '11px var(--font-mono, ui-monospace, monospace)';
    const every = Math.max(1, Math.round(n / Math.max(2, Math.floor(pw / 80))));
    for (let i = 0; i < n; i += every) {
      const lab = (cfg.xfmt || (d => String(d).slice(5)))(cfg.x[i]);
      const tw = ctx.measureText(lab).width;
      ctx.fillText(lab, Math.max(L + tw / 2, X(i)), H - 8);
    }

    // Trade markers (buy ▲ / sell ▼)
    (cfg.markers || []).forEach(m => {
      const g = geo[0];
      const firstSeries = cfg.panes[0]?.series?.[0];
      const v = firstSeries?.c ? firstSeries.c[m.i] : firstSeries?.y?.[m.i];
      if (!num(v)) return;
      const x = X(m.i), yy = g.Y(v), buy = m.side === 'B';
      ctx.fillStyle = buy ? c.up : c.dn;
      ctx.beginPath();
      if (buy) {
        ctx.moveTo(x, yy + 5); ctx.lineTo(x - 7, yy + 15); ctx.lineTo(x + 7, yy + 15);
      } else {
        ctx.moveTo(x, yy - 5); ctx.lineTo(x - 7, yy - 15); ctx.lineTo(x + 7, yy - 15);
      }
      ctx.fill();
    });

    // Crosshair + tooltip
    if (state.cx != null) {
      const i = Math.max(0, Math.min(n - 1, Math.floor((state.cx - L) / step)));
      const x = X(i);
      ctx.strokeStyle = c.tx;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, H - B); ctx.stroke();
      ctx.setLineDash([]);

      // Tooltip rows
      const rows = [`<b>${cfg.x[i]}</b>`];
      cfg.panes.forEach(p => p.series.forEach(s => {
        if (s.type === 'candle') {
          rows.push(`O ${f2(s.o?.[i])} H ${f2(s.h?.[i])} L ${f2(s.l?.[i])} C <b>${f2(s.c?.[i])}</b>`);
        } else if (s.name && num(s.y?.[i])) {
          const fmt = p.tipfmt || p.fmt || f2;
          rows.push(`<span style="color:${s.color || c.acc}">${s.name}</span> ${fmt(s.y[i])}`);
        }
      }));
      const mk = (cfg.markers || []).find(m => m.i === i);
      if (mk) rows.push(`<b>${mk.side === 'B' ? 'BUY' : 'SELL'}</b> ${mk.label || ''}`);

      if (tip) {
        tip.innerHTML = rows.join('<br>');
        tip.hidden = false;
        const tw = tip.offsetWidth;
        tip.style.left = Math.min(Math.max(4, x + 14), W - tw - 4) + 'px';
        tip.style.top = '10px';
      }
    } else {
      if (tip) tip.hidden = true;
    }
  };

  // Event handlers
  const move = e => {
    const r = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    state.cx = t.clientX - r.left;
    draw();
  };
  const leave = () => { state.cx = null; draw(); };

  canvas.addEventListener('mousemove', move);
  canvas.addEventListener('mouseleave', leave);
  canvas.addEventListener('touchstart', move, { passive: true });
  canvas.addEventListener('touchmove', move, { passive: true });
  canvas.addEventListener('touchend', leave);

  const ro = new ResizeObserver(draw);
  ro.observe(canvas);
  draw();

  return {
    redraw: draw,
    destroy: () => {
      canvas.removeEventListener('mousemove', move);
      canvas.removeEventListener('mouseleave', leave);
      canvas.removeEventListener('touchstart', move);
      canvas.removeEventListener('touchmove', move);
      canvas.removeEventListener('touchend', leave);
      ro.disconnect();
    }
  };
}
