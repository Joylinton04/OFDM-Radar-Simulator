import { useEffect, useRef, useState } from 'react';
import { fmtTick, niceTicks, resolveColor, setupCanvas } from './canvas';
import { useThemeVersion, useWidth } from './useSize';

export interface Series {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  label?: string;
  color?: string;
  mode?: 'line' | 'scatter' | 'stem' | 'step';
  width?: number;
  dash?: number[];
  size?: number; // marker radius for scatter
  alpha?: number;
}

export interface Band {
  x0: number;
  x1: number;
  color?: string;
  label?: string;
}

export interface RefLine {
  v: number;
  color?: string;
  label?: string;
  dash?: number[];
}

export interface PlotProps {
  series: Series[];
  title?: string;
  xLabel?: string;
  yLabel?: string;
  xLim?: [number, number];
  yLim?: [number, number];
  height?: number;
  bands?: Band[];
  vLines?: RefLine[];
  hLines?: RefLine[];
  square?: boolean; // equal x/y scale, for constellations
  legend?: boolean;
  logY?: boolean;
  logX?: boolean;
  note?: string;
}

function extent(series: Series[], key: 'x' | 'y', logY: boolean, logX = false): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of series) {
    const a = s[key];
    for (let i = 0; i < a.length; i++) {
      const v = a[i];
      if (!isFinite(v)) continue;
      if (key === 'y' && logY && v <= 0) continue;
      if (key === 'x' && logX && v <= 0) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (!isFinite(lo)) return [0, 1];
  if (lo === hi) return [lo - 1, hi + 1];
  if (key === 'y' && !logY) {
    const pad = (hi - lo) * 0.06;
    return [lo - pad, hi + pad];
  }
  return [lo, hi];
}

export function Plot(props: PlotProps) {
  const { series, height = 240, legend = true } = props;
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useThemeVersion();
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const geom = useRef<{ l: number; t: number; pw: number; ph: number; x0: number; x1: number; y0: number; y1: number; logY: boolean; logX: boolean } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const ctx = setupCanvas(canvas, width, height);
    const col = (c: string | undefined, f?: string) => resolveColor(canvas, c, f);
    const fg = col('var(--text-muted)', '#666');
    const grid = col('var(--grid)', '#ddd');
    const axis = col('var(--border-strong)', '#999');
    ctx.clearRect(0, 0, width, height);

    const logY = !!props.logY;
    const logX = !!props.logX;
    let [x0, x1] = props.xLim ?? extent(series, 'x', false, logX);
    if (logX) {
      x0 = Math.log10(Math.max(x0, 1e-300));
      x1 = Math.log10(Math.max(x1, 1e-300));
      if (x1 - x0 < 1e-9) x1 = x0 + 1;
    }
    let [y0, y1] = props.yLim ?? extent(series, 'y', logY);
    if (logY) {
      y0 = Math.log10(Math.max(y0, 1e-12));
      y1 = Math.log10(Math.max(y1, 1e-12));
      if (y1 - y0 < 1) y0 = y1 - 1;
    }

    const l = 52;
    const r = 12;
    const t = props.title ? 26 : 10;
    const b = props.xLabel ? 40 : 26;
    let pw = width - l - r;
    let ph = height - t - b;
    let left = l;
    let top = t;
    if (props.square) {
      const s = Math.min(pw, ph);
      left = l + (pw - s) / 2;
      top = t + (ph - s) / 2;
      pw = ph = s;
    }
    geom.current = { l: left, t: top, pw, ph, x0, x1, y0, y1, logY, logX };

    const X = (v: number) => left + (((logX ? Math.log10(Math.max(v, 1e-300)) : v) - x0) / (x1 - x0)) * pw;
    const XL = (lv: number) => left + ((lv - x0) / (x1 - x0)) * pw; // x already in axis units
    const Y = (v: number) => {
      const vv = logY ? Math.log10(Math.max(v, 1e-300)) : v;
      return top + ph - ((vv - y0) / (y1 - y0)) * ph;
    };

    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    // Title
    if (props.title) {
      ctx.fillStyle = col('var(--text)', '#222');
      ctx.font = '600 12.5px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(props.title, l, 13);
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    }

    // Bands
    for (const bd of props.bands ?? []) {
      const a = Math.max(left, X(Math.min(bd.x0, bd.x1)));
      const z = Math.min(left + pw, X(Math.max(bd.x0, bd.x1)));
      if (z <= a) continue;
      ctx.fillStyle = col(bd.color ?? 'var(--band)', 'rgba(120,120,255,0.12)');
      ctx.fillRect(a, top, z - a, ph);
      if (bd.label) {
        ctx.fillStyle = fg;
        ctx.textAlign = 'center';
        ctx.fillText(bd.label, (a + z) / 2, top + 9);
      }
    }

    // Grid + ticks
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = fg;
    let xt: number[];
    if (logX) {
      xt = [];
      for (let e = Math.ceil(x0 - 1e-9); e <= Math.floor(x1 + 1e-9); e++) xt.push(e);
    } else xt = niceTicks(x0, x1, Math.max(3, Math.floor(pw / 80)));
    ctx.textAlign = 'center';
    for (const v of xt) {
      const px = Math.round(XL(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, top);
      ctx.lineTo(px, top + ph);
      ctx.stroke();
      ctx.fillText(logX ? fmtTick(Math.pow(10, v)) : fmtTick(v), px, top + ph + 12);
    }
    let yt: number[];
    if (logY) {
      yt = [];
      for (let e = Math.ceil(y0); e <= Math.floor(y1); e++) yt.push(e);
    } else yt = niceTicks(y0, y1, Math.max(3, Math.floor(ph / 45)));
    ctx.textAlign = 'right';
    for (const v of yt) {
      const py = Math.round(top + ph - ((v - y0) / (y1 - y0)) * ph) + 0.5;
      ctx.beginPath();
      ctx.moveTo(left, py);
      ctx.lineTo(left + pw, py);
      ctx.stroke();
      ctx.fillText(logY ? `1e${v}` : fmtTick(v), left - 6, py);
    }
    ctx.strokeStyle = axis;
    ctx.strokeRect(left + 0.5, top + 0.5, pw, ph);

    // Axis labels
    if (props.xLabel) {
      ctx.textAlign = 'center';
      ctx.fillText(props.xLabel, left + pw / 2, top + ph + 29);
    }
    if (props.yLabel) {
      ctx.save();
      ctx.translate(12, top + ph / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(props.yLabel, 0, 0);
      ctx.restore();
    }

    // Clip to plot area for data
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, pw, ph);
    ctx.clip();

    const refLine = (rl: RefLine, vertical: boolean) => {
      ctx.strokeStyle = col(rl.color ?? 'var(--text-muted)');
      ctx.setLineDash(rl.dash ?? [4, 4]);
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      if (vertical) {
        const px = X(rl.v);
        ctx.moveTo(px, top);
        ctx.lineTo(px, top + ph);
      } else {
        const py = Y(rl.v);
        ctx.moveTo(left, py);
        ctx.lineTo(left + pw, py);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (rl.label) {
        ctx.fillStyle = col(rl.color ?? 'var(--text-muted)');
        if (vertical) {
          ctx.textAlign = 'left';
          ctx.fillText(rl.label, X(rl.v) + 4, top + ph - 10);
        } else {
          ctx.textAlign = 'right';
          ctx.fillText(rl.label, left + pw - 4, Y(rl.v) - 8);
        }
      }
    };

    for (const s of series) {
      const c = col(s.color ?? 'var(--s1)', '#36c');
      ctx.strokeStyle = c;
      ctx.fillStyle = c;
      ctx.globalAlpha = s.alpha ?? 1;
      ctx.lineWidth = s.width ?? 1.6;
      ctx.setLineDash(s.dash ?? []);
      const n = Math.min(s.x.length, s.y.length);
      const mode = s.mode ?? 'line';
      if (mode === 'line' || mode === 'step') {
        ctx.beginPath();
        let started = false;
        let prevY = 0;
        for (let i = 0; i < n; i++) {
          const yv = s.y[i];
          if (!isFinite(yv) || (logY && yv <= 0)) {
            started = false;
            continue;
          }
          const px = X(s.x[i]);
          const py = Y(yv);
          if (!started) {
            ctx.moveTo(px, py);
            started = true;
          } else if (mode === 'step') {
            ctx.lineTo(px, prevY);
            ctx.lineTo(px, py);
          } else ctx.lineTo(px, py);
          prevY = py;
        }
        ctx.stroke();
      } else if (mode === 'stem') {
        const base = logY ? top + ph : Y(Math.max(y0, Math.min(y1, 0)));
        for (let i = 0; i < n; i++) {
          const px = X(s.x[i]);
          const py = Y(s.y[i]);
          ctx.beginPath();
          ctx.moveTo(px, base);
          ctx.lineTo(px, py);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(px, py, s.size ?? 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        const rad = s.size ?? 1.8;
        for (let i = 0; i < n; i++) {
          const px = X(s.x[i]);
          const py = Y(s.y[i]);
          ctx.beginPath();
          ctx.arc(px, py, rad, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    for (const v of props.vLines ?? []) refLine(v, true);
    for (const h of props.hLines ?? []) refLine(h, false);
    ctx.restore();

    // Legend
    const labelled = series.filter((s) => s.label);
    if (legend && labelled.length) {
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      let lx = left + pw - 8;
      const widths = labelled.map((s) => ctx.measureText(s.label!).width + 22);
      const total = widths.reduce((a, b) => a + b, 0);
      lx = left + pw - total - 6;
      if (lx < left + 4) lx = left + 4;
      const ly = top + 10;
      ctx.fillStyle = col('var(--surface)', '#fff');
      ctx.globalAlpha = 0.85;
      ctx.fillRect(lx - 4, ly - 8, total + 6, 16);
      ctx.globalAlpha = 1;
      labelled.forEach((s, i) => {
        ctx.fillStyle = col(s.color ?? 'var(--s1)');
        ctx.fillRect(lx, ly - 1.5, 12, 3);
        ctx.fillStyle = fg;
        ctx.fillText(s.label!, lx + 16, ly);
        lx += widths[i];
      });
    }
  }, [series, width, height, theme, props.xLim, props.yLim, props.bands, props.vLines, props.hLines, props.title, props.xLabel, props.yLabel, props.square, props.logY, props.logX, legend]);

  const onMove = (e: React.MouseEvent) => {
    const g = geom.current;
    if (!g) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    if (px < g.l || px > g.l + g.pw || py < g.t || py > g.t + g.ph) {
      setHover(null);
      return;
    }
    let x = g.x0 + ((px - g.l) / g.pw) * (g.x1 - g.x0);
    if (g.logX) x = Math.pow(10, x);
    let y = g.y0 + ((g.t + g.ph - py) / g.ph) * (g.y1 - g.y0);
    if (g.logY) y = Math.pow(10, y);
    setHover({ x, y });
  };

  return (
    <div className="plot" ref={wrapRef}>
      <canvas ref={canvasRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      {hover && (
        <div className="plot-readout">
          x = {fmtTick(hover.x)}, y = {fmtTick(hover.y)}
        </div>
      )}
      {props.note && <div className="plot-note">{props.note}</div>}
    </div>
  );
}
