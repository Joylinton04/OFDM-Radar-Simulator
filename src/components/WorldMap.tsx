import { useEffect, useRef, useState } from 'react';
import { fmtTick, niceTicks, resolveColor, setupCanvas, viridis } from './canvas';
import { useThemeVersion, useWidth } from './useSize';

/** Shapes are given in world coordinates (metres). */
export type Shape =
  | { kind: 'circle'; x: number; y: number; r: number; color: string; width?: number; dash?: number[]; alpha?: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: string; width?: number; dash?: number[]; alpha?: number }
  | { kind: 'wedge'; x: number; y: number; r: number; a0: number; a1: number; color: string; alpha?: number }
  | { kind: 'ellipse'; x: number; y: number; cov: [number, number, number]; k: number; color: string; width?: number; dash?: number[] }
  | {
      kind: 'dot';
      x: number;
      y: number;
      color: string;
      size?: number;
      label?: string;
      shape?: 'circle' | 'ring' | 'cross' | 'plus' | 'triangle' | 'diamond';
      rot?: number; // triangle direction, radians
    };

export interface Handle {
  id: string;
  x: number;
  y: number;
}

export interface WorldMapProps {
  xRange: [number, number];
  yRange: [number, number];
  shapes: Shape[];
  heat?: { data: Float64Array; rows: number; cols: number; zRange: [number, number] }; // covers xRange × yRange, row 0 at the bottom
  handles?: Handle[];
  onDrag?: (id: string, x: number, y: number) => void;
  title?: string;
  maxHeight?: number;
  unit?: string;
}

/** Square, equal-aspect x-y map with optional heat background and draggable handles. */
export function WorldMap(p: WorldMapProps) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useThemeVersion();
  const geom = useRef<{ l: number; t: number; side: number } | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; z?: number } | null>(null);
  const [overHandle, setOverHandle] = useState(false);

  const maxH = p.maxHeight ?? 560;
  const l = 48;
  const r = p.heat ? 58 : 14;
  const t = p.title ? 26 : 10;
  const b = 34;
  const side = Math.max(120, Math.min(width - l - r, maxH));
  const height = side + t + b;
  const unit = p.unit ?? 'm';

  const [x0, x1] = p.xRange;
  const [y0, y1] = p.yRange;
  const X = (v: number) => l + ((v - x0) / (x1 - x0)) * side;
  const Y = (v: number) => t + side - ((v - y0) / (y1 - y0)) * side;
  const pxPerM = side / (x1 - x0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const ctx = setupCanvas(canvas, width, height);
    const col = (c: string, f?: string) => resolveColor(canvas, c, f);
    ctx.clearRect(0, 0, width, height);
    geom.current = { l, t, side };
    const fg = col('var(--text-muted)', '#666');

    // background
    if (p.heat) {
      const { data, rows, cols, zRange } = p.heat;
      const img = new ImageData(cols, rows);
      for (let j = 0; j < rows; j++) {
        const yr = rows - 1 - j;
        for (let i = 0; i < cols; i++) {
          const [R, G, B] = viridis((data[j * cols + i] - zRange[0]) / (zRange[1] - zRange[0]));
          const o = (yr * cols + i) * 4;
          img.data[o] = R;
          img.data[o + 1] = G;
          img.data[o + 2] = B;
          img.data[o + 3] = 255;
        }
      }
      const off = document.createElement('canvas');
      off.width = cols;
      off.height = rows;
      off.getContext('2d')!.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, l, t, side, side);
    } else {
      ctx.fillStyle = col('var(--surface-2)', '#f4f4f4');
      ctx.fillRect(l, t, side, side);
    }

    // grid + ticks
    ctx.font = '11px Archivo, ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = col(p.heat ? 'rgba(255,255,255,0.12)' : 'var(--grid)', '#ddd');
    ctx.lineWidth = 1;
    ctx.fillStyle = fg;
    const xt = niceTicks(x0, x1, Math.max(3, Math.floor(side / 70)));
    const yt = niceTicks(y0, y1, Math.max(3, Math.floor(side / 70)));
    ctx.textAlign = 'center';
    for (const v of xt) {
      ctx.beginPath();
      ctx.moveTo(X(v) + 0.5, t);
      ctx.lineTo(X(v) + 0.5, t + side);
      ctx.stroke();
      ctx.fillText(fmtTick(v), X(v), t + side + 12);
    }
    ctx.textAlign = 'right';
    for (const v of yt) {
      ctx.beginPath();
      ctx.moveTo(l, Y(v) + 0.5);
      ctx.lineTo(l + side, Y(v) + 0.5);
      ctx.stroke();
      ctx.fillText(fmtTick(v), l - 6, Y(v));
    }
    ctx.textAlign = 'center';
    ctx.fillText(`x (${unit})`, l + side / 2, t + side + 27);
    ctx.save();
    ctx.translate(12, t + side / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`y (${unit})`, 0, 0);
    ctx.restore();
    if (p.title) {
      ctx.fillStyle = col('var(--text)', '#222');
      ctx.font = '600 12.5px Archivo, ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(p.title, l, 13);
      ctx.font = '11px Archivo, ui-sans-serif, system-ui, sans-serif';
    }

    // shapes
    ctx.save();
    ctx.beginPath();
    ctx.rect(l, t, side, side);
    ctx.clip();
    for (const s of p.shapes) {
      const c = col(s.color, '#888');
      ctx.setLineDash('dash' in s && s.dash ? s.dash : []);
      ctx.globalAlpha = 'alpha' in s && s.alpha !== undefined ? s.alpha : 1;
      ctx.strokeStyle = c;
      ctx.fillStyle = c;
      ctx.lineWidth = 'width' in s && s.width ? s.width : 1.5;
      if (s.kind === 'circle') {
        ctx.beginPath();
        ctx.arc(X(s.x), Y(s.y), Math.max(0.5, s.r * pxPerM), 0, Math.PI * 2);
        ctx.stroke();
      } else if (s.kind === 'line') {
        ctx.beginPath();
        ctx.moveTo(X(s.x1), Y(s.y1));
        ctx.lineTo(X(s.x2), Y(s.y2));
        ctx.stroke();
      } else if (s.kind === 'wedge') {
        ctx.beginPath();
        ctx.moveTo(X(s.x), Y(s.y));
        // canvas y is flipped: world angle a → canvas angle -a
        ctx.arc(X(s.x), Y(s.y), s.r * pxPerM, -s.a1, -s.a0);
        ctx.closePath();
        ctx.fill();
      } else if (s.kind === 'ellipse') {
        const [sxx, sxy, syy] = s.cov;
        const tr = sxx + syy;
        const dt = Math.sqrt(Math.max(0, ((sxx - syy) / 2) ** 2 + sxy * sxy));
        const l1 = Math.max(0, tr / 2 + dt);
        const l2 = Math.max(0, tr / 2 - dt);
        const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        const a = s.k * Math.sqrt(l1);
        const bb = s.k * Math.sqrt(l2);
        ctx.beginPath();
        for (let i = 0; i <= 72; i++) {
          const u = (i / 72) * Math.PI * 2;
          const ex = a * Math.cos(u);
          const ey = bb * Math.sin(u);
          const wx = s.x + ex * Math.cos(ang) - ey * Math.sin(ang);
          const wy = s.y + ex * Math.sin(ang) + ey * Math.cos(ang);
          if (i === 0) ctx.moveTo(X(wx), Y(wy));
          else ctx.lineTo(X(wx), Y(wy));
        }
        ctx.stroke();
      } else if (s.kind === 'dot') {
        const px = X(s.x);
        const py = Y(s.y);
        const z = s.size ?? 6;
        ctx.setLineDash([]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        switch (s.shape ?? 'circle') {
          case 'circle':
            ctx.arc(px, py, z, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = col('var(--surface)', '#fff');
            ctx.lineWidth = 1.5;
            ctx.stroke();
            break;
          case 'ring':
            ctx.arc(px, py, z, 0, Math.PI * 2);
            ctx.stroke();
            break;
          case 'cross':
            ctx.moveTo(px - z, py - z);
            ctx.lineTo(px + z, py + z);
            ctx.moveTo(px + z, py - z);
            ctx.lineTo(px - z, py + z);
            ctx.stroke();
            break;
          case 'plus':
            ctx.moveTo(px - z, py);
            ctx.lineTo(px + z, py);
            ctx.moveTo(px, py - z);
            ctx.lineTo(px, py + z);
            ctx.stroke();
            break;
          case 'diamond':
            ctx.moveTo(px, py - z);
            ctx.lineTo(px + z, py);
            ctx.lineTo(px, py + z);
            ctx.lineTo(px - z, py);
            ctx.closePath();
            ctx.stroke();
            break;
          case 'triangle': {
            const a0 = -(s.rot ?? Math.PI / 2);
            ctx.moveTo(px + z * 1.4 * Math.cos(a0), py + z * 1.4 * Math.sin(a0));
            ctx.lineTo(px + z * Math.cos(a0 + 2.4), py + z * Math.sin(a0 + 2.4));
            ctx.lineTo(px + z * Math.cos(a0 - 2.4), py + z * Math.sin(a0 - 2.4));
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = col('var(--surface)', '#fff');
            ctx.lineWidth = 1.5;
            ctx.stroke();
            break;
          }
        }
        if (s.label) {
          ctx.font = '600 11px Archivo, ui-sans-serif, system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.lineWidth = 3;
          ctx.strokeStyle = col('var(--surface)', '#fff');
          ctx.strokeText(s.label, px + z + 3, py - z - 2);
          ctx.fillStyle = c;
          ctx.fillText(s.label, px + z + 3, py - z - 2);
        }
      }
    }
    ctx.restore();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = col('var(--border-strong)', '#999');
    ctx.lineWidth = 1;
    ctx.strokeRect(l + 0.5, t + 0.5, side, side);

    // colour bar
    if (p.heat) {
      const cbx = l + side + 12;
      const cbw = 10;
      for (let i = 0; i < side; i++) {
        const [R, G, B] = viridis(1 - i / side);
        ctx.fillStyle = `rgb(${R},${G},${B})`;
        ctx.fillRect(cbx, t + i, cbw, 1);
      }
      ctx.strokeRect(cbx + 0.5, t + 0.5, cbw, side);
      ctx.fillStyle = fg;
      ctx.textAlign = 'left';
      const [z0, z1] = p.heat.zRange;
      for (const v of niceTicks(z0, z1, 5)) ctx.fillText(fmtTick(v), cbx + cbw + 4, t + side - ((v - z0) / (z1 - z0)) * side);
      ctx.fillText('dB', cbx, t + side + 14);
    }
  }, [p.shapes, p.heat, p.title, x0, x1, y0, y1, width, height, side, theme]);

  const toWorld = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    return {
      px,
      py,
      x: x0 + ((px - l) / side) * (x1 - x0),
      y: y0 + ((t + side - py) / side) * (y1 - y0),
    };
  };
  const findHandle = (px: number, py: number) => {
    let best: string | null = null;
    let bd = 14;
    for (const h of p.handles ?? []) {
      const d = Math.hypot(X(h.x) - px, Y(h.y) - py);
      if (d < bd) {
        bd = d;
        best = h.id;
      }
    }
    return best;
  };
  const clamp = (v: number, a: number, b2: number) => Math.min(b2, Math.max(a, v));

  const onDown = (e: React.PointerEvent) => {
    const w = toWorld(e);
    const id = findHandle(w.px, w.py);
    if (id && p.onDrag) {
      setDrag(id);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const w = toWorld(e);
    if (drag && p.onDrag) {
      p.onDrag(drag, clamp(w.x, x0, x1), clamp(w.y, y0, y1));
      return;
    }
    setOverHandle(!!findHandle(w.px, w.py));
    if (w.px < l || w.px > l + side || w.py < t || w.py > t + side) {
      setHover(null);
      return;
    }
    let z: number | undefined;
    if (p.heat) {
      const i = Math.min(p.heat.cols - 1, Math.max(0, Math.floor(((w.x - x0) / (x1 - x0)) * p.heat.cols)));
      const j = Math.min(p.heat.rows - 1, Math.max(0, Math.floor(((w.y - y0) / (y1 - y0)) * p.heat.rows)));
      z = p.heat.data[j * p.heat.cols + i];
    }
    setHover({ x: w.x, y: w.y, z });
  };
  const onUp = (e: React.PointerEvent) => {
    if (drag) (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setDrag(null);
  };

  return (
    <div className="plot" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={() => !drag && setHover(null)}
        style={{ cursor: drag ? 'grabbing' : overHandle ? 'grab' : 'crosshair', touchAction: p.handles?.length ? 'none' : 'auto' }}
      />
      {hover && (
        <div className="plot-readout">
          x = {fmtTick(hover.x)} {unit}, y = {fmtTick(hover.y)} {unit}
          {hover.z !== undefined ? `, ${fmtTick(hover.z)} dB` : ''}
        </div>
      )}
    </div>
  );
}
