import { useEffect, useRef } from 'react';
import { resolveColor, setupCanvas } from './canvas';
import { useThemeVersion, useWidth } from './useSize';

export interface PolarSeries {
  angleDeg: ArrayLike<number>; // -90..90, 0 = broadside (straight ahead)
  db: ArrayLike<number>; // relative gain, 0 dB max
  color?: string;
}

export interface PolarProps {
  series: PolarSeries[];
  floorDb?: number;
  height?: number;
  title?: string;
  spokes?: { angleDeg: number; color?: string; label?: string }[];
}

/** Half-plane polar plot (front of the array) for beam patterns. */
export function PolarPlot({ series, floorDb = -40, height = 300, title, spokes = [] }: PolarProps) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useThemeVersion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0) return;
    const ctx = setupCanvas(canvas, width, height);
    const col = (c: string, f?: string) => resolveColor(canvas, c, f);
    ctx.clearRect(0, 0, width, height);
    const top = title ? 26 : 10;
    const R = Math.min(width / 2 - 24, height - top - 24);
    const cx = width / 2;
    const cy = top + R + 6;
    const fg = col('var(--text-muted)', '#666');
    ctx.font = '11px Archivo, ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'middle';

    if (title) {
      ctx.fillStyle = col('var(--text)', '#222');
      ctx.font = '600 12.5px Archivo, ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(title, 10, 13);
      ctx.font = '11px Archivo, ui-sans-serif, system-ui, sans-serif';
    }

    // Polar angle: 0° points up (broadside). Screen angle = -90° + θ.
    const pt = (thDeg: number, rr: number): [number, number] => {
      const a = ((thDeg - 90) * Math.PI) / 180;
      return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
    };

    ctx.strokeStyle = col('var(--grid)', '#ddd');
    ctx.lineWidth = 1;
    const rings = 4;
    for (let i = 1; i <= rings; i++) {
      const rr = (R * i) / rings;
      ctx.beginPath();
      ctx.arc(cx, cy, rr, Math.PI, 2 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = fg;
      ctx.textAlign = 'left';
      const lvl = floorDb + ((0 - floorDb) * i) / rings;
      ctx.fillText(`${lvl.toFixed(0)} dB`, cx + 3, cy - rr + 8);
    }
    for (let a = -90; a <= 90; a += 30) {
      const [x, y] = pt(a, R);
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.stroke();
      const [lx, ly] = pt(a, R + 13);
      ctx.fillStyle = fg;
      ctx.textAlign = 'center';
      ctx.fillText(`${a}°`, lx, ly);
    }

    for (const s of spokes) {
      const [x, y] = pt(s.angleDeg, R);
      ctx.strokeStyle = col(s.color ?? 'var(--text-muted)');
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (s.label) {
        ctx.fillStyle = col(s.color ?? 'var(--text-muted)');
        const [lx, ly] = pt(s.angleDeg, R * 0.92);
        ctx.textAlign = 'center';
        ctx.fillText(s.label, lx, ly - 8);
      }
    }

    for (const s of series) {
      ctx.strokeStyle = col(s.color ?? 'var(--s1)', '#36c');
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < s.angleDeg.length; i++) {
        const d = Math.max(floorDb, s.db[i]);
        const rr = ((d - floorDb) / -floorDb) * R;
        const [x, y] = pt(s.angleDeg[i], rr);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Array drawn as a bar along the base
    ctx.fillStyle = col('var(--text)', '#222');
    ctx.fillRect(cx - 30, cy + 2, 60, 4);
  }, [series, floorDb, height, title, spokes, width, theme]);

  return (
    <div className="plot" ref={wrapRef}>
      <canvas ref={canvasRef} />
    </div>
  );
}
