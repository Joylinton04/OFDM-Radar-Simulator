import { useEffect, useRef, useState } from 'react';
import { fmtTick, niceTicks, resolveColor, setupCanvas, viridis } from './canvas';
import { useThemeVersion, useWidth } from './useSize';

export interface Marker {
  x: number;
  y: number;
  label?: string;
  color?: string;
  shape?: 'circle' | 'cross';
}

export interface HeatmapProps {
  data: Float64Array; // row-major: data[row * cols + col]; row 0 is the bottom (y0)
  rows: number;
  cols: number;
  xRange: [number, number];
  yRange: [number, number];
  zRange: [number, number];
  xLabel?: string;
  yLabel?: string;
  zLabel?: string;
  title?: string;
  height?: number;
  markers?: Marker[];
  xView?: [number, number]; // optional zoom on x
}

export function Heatmap(p: HeatmapProps) {
  const { height = 320 } = p;
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useThemeVersion();
  const [hover, setHover] = useState<{ x: number; y: number; z: number } | null>(null);
  const geom = useRef<{ l: number; t: number; pw: number; ph: number; vx0: number; vx1: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const ctx = setupCanvas(canvas, width, height);
    const col = (c: string, f?: string) => resolveColor(canvas, c, f);
    const fg = col('var(--text-muted)', '#666');
    ctx.clearRect(0, 0, width, height);

    const l = 56;
    const r = 66;
    const t = p.title ? 26 : 10;
    const b = 40;
    const pw = width - l - r;
    const ph = height - t - b;
    const [vx0, vx1] = p.xView ?? p.xRange;
    geom.current = { l, t, pw, ph, vx0, vx1 };

    // Build image at native resolution, then scale.
    const img = new ImageData(p.cols, p.rows);
    const [z0, z1] = p.zRange;
    for (let r0 = 0; r0 < p.rows; r0++) {
      const yr = p.rows - 1 - r0; // flip so row 0 is at the bottom
      for (let c = 0; c < p.cols; c++) {
        const v = p.data[r0 * p.cols + c];
        const [R, G, B] = viridis((v - z0) / (z1 - z0));
        const o = (yr * p.cols + c) * 4;
        img.data[o] = R;
        img.data[o + 1] = G;
        img.data[o + 2] = B;
        img.data[o + 3] = 255;
      }
    }
    const off = document.createElement('canvas');
    off.width = p.cols;
    off.height = p.rows;
    off.getContext('2d')!.putImageData(img, 0, 0);

    // Source x-window (zoom)
    const [x0, x1] = p.xRange;
    const sx0 = ((vx0 - x0) / (x1 - x0)) * p.cols;
    const sx1 = ((vx1 - x0) / (x1 - x0)) * p.cols;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, sx0, 0, Math.max(1, sx1 - sx0), p.rows, l, t, pw, ph);

    ctx.font = '11px Archivo, ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    if (p.title) {
      ctx.fillStyle = col('var(--text)', '#222');
      ctx.font = '600 12.5px Archivo, ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(p.title, l, 13);
      ctx.font = '11px Archivo, ui-sans-serif, system-ui, sans-serif';
    }
    ctx.strokeStyle = col('var(--border-strong)', '#999');
    ctx.strokeRect(l + 0.5, t + 0.5, pw, ph);
    ctx.fillStyle = fg;

    const X = (v: number) => l + ((v - vx0) / (vx1 - vx0)) * pw;
    const [y0, y1] = p.yRange;
    const Y = (v: number) => t + ph - ((v - y0) / (y1 - y0)) * ph;

    ctx.textAlign = 'center';
    for (const v of niceTicks(vx0, vx1, Math.max(3, Math.floor(pw / 80)))) {
      ctx.fillText(fmtTick(v), X(v), t + ph + 12);
    }
    ctx.textAlign = 'right';
    for (const v of niceTicks(y0, y1, Math.max(3, Math.floor(ph / 45)))) {
      ctx.fillText(fmtTick(v), l - 6, Y(v));
    }
    if (p.xLabel) {
      ctx.textAlign = 'center';
      ctx.fillText(p.xLabel, l + pw / 2, t + ph + 29);
    }
    if (p.yLabel) {
      ctx.save();
      ctx.translate(12, t + ph / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.fillText(p.yLabel, 0, 0);
      ctx.restore();
    }

    // Markers (true target positions)
    ctx.save();
    ctx.beginPath();
    ctx.rect(l, t, pw, ph);
    ctx.clip();
    for (const m of p.markers ?? []) {
      const px = X(m.x);
      const py = Y(m.y);
      ctx.strokeStyle = m.color ?? '#ff4d6d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (m.shape === 'cross') {
        ctx.moveTo(px - 6, py - 6);
        ctx.lineTo(px + 6, py + 6);
        ctx.moveTo(px + 6, py - 6);
        ctx.lineTo(px - 6, py + 6);
      } else ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.stroke();
      if (m.label) {
        ctx.fillStyle = m.color ?? '#ff4d6d';
        ctx.textAlign = 'left';
        ctx.font = '600 11px Archivo, ui-sans-serif, system-ui, sans-serif';
        ctx.fillText(m.label, px + 10, py - 9);
      }
    }
    ctx.restore();

    // Colour bar
    const cbx = l + pw + 14;
    const cbw = 12;
    for (let i = 0; i < ph; i++) {
      const [R, G, B] = viridis(1 - i / ph);
      ctx.fillStyle = `rgb(${R},${G},${B})`;
      ctx.fillRect(cbx, t + i, cbw, 1);
    }
    ctx.strokeStyle = col('var(--border-strong)', '#999');
    ctx.strokeRect(cbx + 0.5, t + 0.5, cbw, ph);
    ctx.fillStyle = fg;
    ctx.textAlign = 'left';
    for (const v of niceTicks(z0, z1, 5)) {
      const py = t + ph - ((v - z0) / (z1 - z0)) * ph;
      ctx.fillText(fmtTick(v), cbx + cbw + 4, py);
    }
    if (p.zLabel) {
      ctx.textAlign = 'center';
      ctx.fillText(p.zLabel, cbx + cbw / 2 + 10, t + ph + 18);
    }
  }, [p.data, p.rows, p.cols, p.xRange, p.yRange, p.zRange, p.markers, p.xView, p.title, p.xLabel, p.yLabel, p.zLabel, width, height, theme]);

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
    const x = g.vx0 + ((px - g.l) / g.pw) * (g.vx1 - g.vx0);
    const y = p.yRange[0] + ((g.t + g.ph - py) / g.ph) * (p.yRange[1] - p.yRange[0]);
    const c = Math.floor(((x - p.xRange[0]) / (p.xRange[1] - p.xRange[0])) * p.cols);
    const r = Math.floor(((y - p.yRange[0]) / (p.yRange[1] - p.yRange[0])) * p.rows);
    const z = p.data[Math.min(p.rows - 1, Math.max(0, r)) * p.cols + Math.min(p.cols - 1, Math.max(0, c))];
    setHover({ x, y, z });
  };

  return (
    <div className="plot" ref={wrapRef}>
      <canvas ref={canvasRef} onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      {hover && (
        <div className="plot-readout">
          {p.xLabel?.split(' ')[0] ?? 'x'} = {fmtTick(hover.x)}, {p.yLabel?.split(' ')[0] ?? 'y'} = {fmtTick(hover.y)},{' '}
          {fmtTick(hover.z)} dB
        </div>
      )}
    </div>
  );
}
