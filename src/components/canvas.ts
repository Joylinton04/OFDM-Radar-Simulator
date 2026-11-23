// Shared helpers for the canvas-based charts.

/** Resolve "var(--name)" against the document so canvas can use theme colours. */
export function resolveColor(el: Element, c: string | undefined, fallback = '#888'): string {
  if (!c) return fallback;
  const m = /^var\((--[\w-]+)\)$/.exec(c.trim());
  if (!m) return c;
  const v = getComputedStyle(el).getPropertyValue(m[1]).trim();
  return v || fallback;
}

/** "Nice" tick values covering [min, max]. */
export function niceTicks(min: number, max: number, target = 6): number[] {
  if (!isFinite(min) || !isFinite(max) || min === max) return [min];
  const span = max - min;
  const raw = span / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.ceil(min / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return ticks;
}

export function fmtTick(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 1e5 || a < 1e-3) return v.toExponential(0);
  return Number(v.toPrecision(4)).toString();
}

/** Size a canvas for crisp drawing on high-DPI screens; returns a scaled 2-D context. */
export function setupCanvas(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // Instrument-style labels: Archivo at a narrower width.
  if ('fontStretch' in ctx) ctx.fontStretch = 'semi-condensed';
  return ctx;
}

// Perceptually uniform colour map (viridis-like stops).
const VIRIDIS = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 74, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [109, 205, 89],
  [180, 222, 44],
  [253, 231, 37],
];

export function viridis(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t)) * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(x));
  const f = x - i;
  const a = VIRIDIS[i];
  const b = VIRIDIS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
