import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { Heatmap, Marker } from '../components/Heatmap';
import { Plot, Series } from '../components/Plot';
import { Shape, WorldMap } from '../components/WorldMap';
import { Card, Explain, LabIntro, Metric, Metrics, Slider, Toolstrip, ToolstripLayout, TryThis, TsButton, TsCheck, TsCol, TsSection, TsSelect, TsSlider, Warn } from '../components/Controls';
import {
  BaseStation,
  BsResult,
  CoopConfig,
  Est,
  METHODS,
  METHOD_LABEL,
  Method,
  SceneObject,
  derive,
  fuse,
  gdop,
  geometry,
  positionCrlb,
  reciprocalLossDb,
  simulateBs,
  snrIntegrated,
} from '../dsp/coop';
import { MODS, ModName, constellation } from '../dsp/modulation';
import { Rng } from '../dsp/random';
import { si } from '../dsp/units';

const FC_OPTS = [3.5, 7, 15, 28, 60] as const; // GHz
const SCS_OPTS = [15, 30, 60, 120] as const; // kHz
const N_OPTS = [256, 512, 1024] as const;
const M_OPTS = [8, 16, 32] as const;
const NA_OPTS = [1, 2, 4, 8, 16] as const;
const CP_RATIO = 144 / 2048;
const FOV = (60 * Math.PI) / 180;
type RemovalLabel = 'Reciprocal (Y ÷ X)' | 'Matched (Y × X*)';
const REMOVALS: RemovalLabel[] = ['Reciprocal (Y ÷ X)', 'Matched (Y × X*)'];
const BS_OPTS = [1, 2, 3, 4, 5, 6] as const;
type RcsPreset = 'Person' | 'Car' | 'Truck' | 'Custom';
const RCS_PRESETS: RcsPreset[] = ['Person', 'Car', 'Truck', 'Custom'];
const RCS_OF: Record<Exclude<RcsPreset, 'Custom'>, number> = { Person: 0, Car: 10, Truck: 20 };
const rcsPreset = (rcs: number): RcsPreset => (rcs === 0 ? 'Person' : rcs === 10 ? 'Car' : rcs === 20 ? 'Truck' : 'Custom');

const ico = (d: string) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ICONS = {
  reset: ico('M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4'),
  dice: ico('M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01'),
  heat: ico('M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16'),
  rings: ico('M12 12m-8.5 0a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0M12 12m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0M12 12L20 6'),
};

const OBJ_COLORS = ['#ff4d6d', '#ffb703', '#4cc9f0'];
const METHOD_COLOR: Record<Method, string> = {
  single: 'var(--s4)',
  grid: 'var(--s6)',
  range: 'var(--s2)',
  angle: 'var(--s5)',
  both: 'var(--s1)',
};
const METHOD_SHAPE: Record<Method, 'cross' | 'plus' | 'diamond' | 'ring'> = {
  single: 'cross',
  grid: 'diamond',
  range: 'plus',
  angle: 'ring',
  both: 'plus',
};

interface Obj {
  on: boolean;
  x: number;
  y: number;
  speed: number; // m/s
  heading: number; // degrees, counter-clockwise from +x
  rcs: number; // dBsm
}

interface Pt {
  x: number;
  y: number;
}

/** Corners first (good geometry for small K), then the middle of two edges. */
const defaultBs = (W: number): Pt[] => [
  { x: 0, y: 0 },
  { x: W, y: 0 },
  { x: W, y: W },
  { x: 0, y: W },
  { x: W / 2, y: 0 },
  { x: W / 2, y: W },
];

const toBs = (p: Pt, W: number): BaseStation => {
  const dx = W / 2 - p.x;
  const dy = W / 2 - p.y;
  return { x: p.x, y: p.y, az: Math.hypot(dx, dy) < 1e-6 ? Math.PI / 2 : Math.atan2(dy, dx) };
};

const toScene = (o: Obj): SceneObject => ({
  x: o.x,
  y: o.y,
  vx: o.speed * Math.cos((o.heading * Math.PI) / 180),
  vy: o.speed * Math.sin((o.heading * Math.PI) / 180),
  rcs: o.rcs,
});

const fmtLen = (m: number) => (Number.isNaN(m) ? '–' : !isFinite(m) ? '∞' : m < 0.01 ? `${(m * 1000).toFixed(2)} mm` : m < 1 ? `${(m * 100).toFixed(1)} cm` : `${m.toFixed(2)} m`);
const deg = (r: number) => (r * 180) / Math.PI;

interface McResult {
  key: string;
  ks: number[];
  rmse: Record<Method, number[]>;
  success: Record<Method, number[]>;
  crlbBoth: number[];
  crlbRange: number[];
  scatter: Pt[];
  trials: number;
}

export default function CoopLab() {
  const [W, setW] = useState(200);
  const [K, setK] = useState(4);
  const [bsPos, setBsPos] = useState<Pt[]>(() => defaultBs(200));
  const [objs, setObjs] = useState<Obj[]>([
    { on: true, x: 120, y: 90, speed: 11, heading: 150, rcs: 10 },
    { on: true, x: 60, y: 150, speed: 1.5, heading: -90, rcs: 0 },
    { on: false, x: 124, y: 93, speed: 11, heading: 150, rcs: 10 },
  ]);
  const [fcG, setFcG] = useState<number>(28);
  const [scs, setScs] = useState<number>(30);
  const [N, setN] = useState<number>(1024);
  const [M, setM] = useState<number>(16);
  const [Na, setNa] = useState<number>(8);
  const [pt, setPt] = useState(30);
  const [mod, setMod] = useState<ModName>('QPSK');
  const [removal, setRemoval] = useState<RemovalLabel>('Reciprocal (Y ÷ X)');
  const [hann, setHann] = useState(true);
  const [seed, setSeed] = useState(1);
  const [showHeat, setShowHeat] = useState(true);
  const [showRings, setShowRings] = useState(true);
  const [raBs, setRaBs] = useState(1);
  const [trials, setTrials] = useState(30);
  const [mc, setMc] = useState<McResult | null>(null);
  const [mcProg, setMcProg] = useState<number | null>(null);
  const cancelRef = useRef(false);

  const cfg: CoopConfig = useMemo(
    () => ({
      fc: fcG * 1e9,
      df: scs * 1e3,
      N,
      M,
      Na,
      cpRatio: CP_RATIO,
      ptDbm: pt,
      nfDb: 7,
      elemGainDbi: 5,
      removal: removal.startsWith('Reciprocal') ? 'reciprocal' : 'matched',
      window: hann,
      fov: FOV,
      rView: W * Math.SQRT2 * 1.05,
      thresholdDb: 15,
    }),
    [fcG, scs, N, M, Na, pt, removal, hann, W],
  );
  const d = derive(cfg);
  const cons = constellation(mod);
  const bss = useMemo(() => bsPos.map((p) => toBs(p, W)), [bsPos, W]);
  const active = useMemo(() => Array.from({ length: K }, (_, i) => i), [K]);
  const scene = useMemo(() => objs.filter((o) => o.on).map(toScene), [objs]);
  const t1 = objs[0].on ? toScene(objs[0]) : null;

  // Heavy simulation runs on deferred inputs, so dragging stays smooth.
  const dIn = useDeferredValue({ cfg, bss, K, scene, seed, mod, W });
  const sim = useMemo(() => {
    const c = constellation(dIn.mod);
    const res: BsResult[] = [];
    for (let b = 0; b < dIn.K; b++) res.push(simulateBs(dIn.cfg, c, dIn.bss[b], dIn.scene, new Rng(dIn.seed * 7919 + b * 104729)));
    const act = Array.from({ length: dIn.K }, (_, i) => i);
    const f = fuse(dIn.cfg, dIn.bss, res, act, dIn.W);
    return { res, f };
  }, [dIn]);

  // ---------- metrics for T1
  const crlbFused = t1 ? positionCrlb(cfg, bss, active, t1, 'both') : null;
  const crlbRangeOnly = t1 ? positionCrlb(cfg, bss, active, t1, 'range') : null;
  const crlbSingle = t1 ? Math.min(...active.map((b) => positionCrlb(cfg, bss, [b], t1, 'both').rmse)) : Infinity;
  const coopGain = crlbFused && isFinite(crlbFused.rmse) && isFinite(crlbSingle) ? 20 * Math.log10(crlbSingle / crlbFused.rmse) : NaN;
  const geo = t1 ? gdop(bss, active, t1, FOV) : Infinity;
  const gate = 3 * d.dR + 4;
  const t1Cand = t1
    ? sim.f.cands.reduce<(typeof sim.f.cands)[number] | null>((best, c) => {
        const dc = Math.hypot(c.x - t1.x, c.y - t1.y);
        if (dc > gate) return best;
        return !best || dc < Math.hypot(best.x - t1.x, best.y - t1.y) ? c : best;
      }, null)
    : null;
  const err = (e?: Est) => (e && t1 ? Math.hypot(e.x - t1.x, e.y - t1.y) : NaN);

  // ---------- warnings
  const warnings: string[] = [];
  if (cfg.rView > d.Rmax) warnings.push(`The area is larger than the unambiguous range (${si(d.Rmax, 'm')}). Far echoes alias to the wrong range.`);
  else if (cfg.rView > d.Rcp)
    warnings.push(`Parts of the area are beyond the CP-limited range (${si(d.Rcp, 'm')} at Δf = ${scs} kHz). Echoes from there arrive after the cyclic prefix and get weaker. Try a smaller Δf.`);
  if (Na === 1) warnings.push('With 1 antenna a station measures range only (no angle). Each station gives a ring, and you need ≥ 2–3 stations to pin an object down.');
  objs.forEach((o, i) => {
    if (!o.on) return;
    const so = toScene(o);
    const seen = active.filter((b) => {
      const g = geometry(bss[b], so, FOV);
      return g.inFov && 10 * Math.log10(Math.max(1e-30, snrIntegrated(cfg, g, so.rcs))) >= cfg.thresholdDb;
    }).length;
    if (seen === 0) warnings.push(`T${i + 1} is not detectable by any active station (outside every field of view or too weak).`);
    const vmax = Math.max(...active.map((b) => Math.abs(geometry(bss[b], so, FOV).vr)));
    if (vmax > d.Vmax) warnings.push(`T${i + 1}'s radial speed exceeds ±${d.Vmax.toFixed(1)} m/s for some station, so its Doppler wraps around.`);
  });
  if (t1 && !t1Cand) warnings.push('The fusion centre did not find T1 in this run.');
  const falseCands = sim.f.cands.filter((c) => !scene.some((o) => Math.hypot(c.x - o.x, c.y - o.y) < gate)).length;
  if (falseCands) warnings.push(`${falseCands} fused detection(s) do not match any real object ("ghosts"). They happen where side lobes of different stations line up.`);

  // ---------- drag handling
  const onDrag = (id: string, x: number, y: number) => {
    const i = Number(id.slice(1));
    if (id[0] === 'b') setBsPos(bsPos.map((p, j) => (j === i ? { x, y } : p)));
    else setObjs(objs.map((o, j) => (j === i ? { ...o, x, y } : o)));
  };
  const changeW = (nw: number) => {
    const s = nw / W;
    setBsPos(bsPos.map((p) => ({ x: p.x * s, y: p.y * s })));
    setObjs(objs.map((o) => ({ ...o, x: o.x * s, y: o.y * s })));
    setW(nw);
  };
  const setObj = (i: number, patch: Partial<Obj>) => setObjs(objs.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  // ---------- world map shapes
  const shapes: Shape[] = [];
  if (!showHeat)
    for (const b of active) {
      const p = bss[b];
      shapes.push({ kind: 'wedge', x: p.x, y: p.y, r: W * 1.6, a0: p.az - FOV, a1: p.az + FOV, color: 'var(--accent)', alpha: 0.05 });
    }
  if (showRings)
    for (const b of active) {
      const p = bss[b];
      for (const det of sim.res[b]?.dets ?? []) {
        shapes.push({ kind: 'circle', x: p.x, y: p.y, r: det.R, color: showHeat ? '#ffffff' : 'var(--text-muted)', width: 1, alpha: 0.45, dash: [4, 4] });
        if (Na > 1)
          shapes.push({
            kind: 'line',
            x1: p.x,
            y1: p.y,
            x2: p.x + (det.R + 15) * Math.cos(det.bearing),
            y2: p.y + (det.R + 15) * Math.sin(det.bearing),
            color: showHeat ? '#ffffff' : 'var(--text-muted)',
            width: 1,
            alpha: 0.45,
          });
      }
    }
  objs.forEach((o, i) => {
    if (!o.on) return;
    const so = toScene(o);
    shapes.push({ kind: 'line', x1: o.x, y1: o.y, x2: o.x + so.vx * 1.5, y2: o.y + so.vy * 1.5, color: OBJ_COLORS[i], width: 2 });
    shapes.push({ kind: 'dot', x: o.x, y: o.y, color: OBJ_COLORS[i], size: 6, label: `T${i + 1}` });
  });
  sim.f.cands.forEach((c, i) => {
    const e = c.est.both ?? c.est.range ?? c.est.grid!;
    shapes.push({ kind: 'dot', x: e.x, y: e.y, color: showHeat ? '#ffffff' : 'var(--text)', shape: 'cross', size: 5, label: `E${i + 1}` });
  });
  for (const b of active) {
    const p = bss[b];
    shapes.push({ kind: 'dot', x: p.x, y: p.y, color: 'var(--accent)', shape: 'triangle', rot: p.az, size: 8, label: `BS${b + 1}` });
  }
  const handles = [
    ...active.map((b) => ({ id: `b${b}`, x: bss[b].x, y: bss[b].y })),
    ...objs.map((o, i) => ({ id: `o${i}`, x: o.x, y: o.y, on: o.on })).filter((h) => h.on),
  ];
  let heatMax = 1;
  for (let i = 0; i < sim.f.map.length; i++) heatMax = Math.max(heatMax, sim.f.map[i]);
  const heat = showHeat && sim.f.map.length === sim.f.rows * sim.f.cols ? { data: sim.f.map, rows: sim.f.rows, cols: sim.f.cols, zRange: [0, heatMax] as [number, number] } : undefined;
  const pad = W * 0.04;

  // ---------- zoom around T1
  const zoomShapes: Shape[] = [];
  let zoomHalf = 0.1;
  if (t1) {
    // Scale to the fine estimates and the CRLB; the coarse grid estimate may fall outside.
    const errs = (['single', 'range', 'angle', 'both'] as Method[]).map((m) => err(t1Cand?.est[m])).filter((e) => isFinite(e));
    const crlbR = crlbFused && isFinite(crlbFused.rmse) ? crlbFused.rmse : 0.05;
    zoomHalf = Math.max(0.05, 4 * crlbR, ...errs.map((e) => e * 1.3));
    zoomHalf = Math.min(zoomHalf, W / 2);
    const mcOk = mc && mc.key === mcKey();
    if (mcOk) for (const s of mc!.scatter) zoomShapes.push({ kind: 'dot', x: s.x, y: s.y, color: 'var(--s1)', size: 2, shape: 'circle' });
    if (crlbFused?.cov) {
      zoomShapes.push({ kind: 'ellipse', x: t1.x, y: t1.y, cov: crlbFused.cov, k: 1, color: 'var(--text)', width: 1.5 });
      zoomShapes.push({ kind: 'ellipse', x: t1.x, y: t1.y, cov: crlbFused.cov, k: 2.45, color: 'var(--text)', width: 1, dash: [5, 4] });
    }
    for (const b of active) {
      const p = bss[b];
      const g = geometry(p, t1, FOV);
      if (!g.inFov) continue;
      // direction to each station, as a short spoke
      zoomShapes.push({ kind: 'line', x1: t1.x, y1: t1.y, x2: t1.x - Math.cos(g.bearing) * zoomHalf * 2, y2: t1.y - Math.sin(g.bearing) * zoomHalf * 2, color: 'var(--accent)', width: 1, alpha: 0.35, dash: [2, 4] });
    }
    zoomShapes.push({ kind: 'dot', x: t1.x, y: t1.y, color: OBJ_COLORS[0], size: 6, label: 'T1 (true)' });
    if (t1Cand)
      for (const m of METHODS) {
        const e = t1Cand.est[m];
        if (e) zoomShapes.push({ kind: 'dot', x: e.x, y: e.y, color: METHOD_COLOR[m], shape: METHOD_SHAPE[m], size: m === 'both' ? 7 : 6 });
      }
  }

  // ---------- range-angle map of one station
  const raIdx = Math.min(raBs, K) - 1;
  const raView = useMemo(() => {
    const r = sim.res[raIdx];
    if (!r) return null;
    const rows = 91;
    const data = new Float64Array(rows * r.Kr);
    for (let j = 0; j < rows; j++) {
      const s = Math.sin(((-90 + 2 * j) * Math.PI) / 180);
      const k = Math.min(r.Pa - 1, Math.max(0, Math.round(((s + 1) / 2) * r.Pa)));
      for (let c = 0; c < r.Kr; c++) data[j * r.Kr + c] = Math.min(45, Math.max(0, 10 * Math.log10(r.ra[k * r.Kr + c])));
    }
    return { data, rows, cols: r.Kr, xMax: r.Kr * r.rBin };
  }, [sim, raIdx]);
  const raMarkers: Marker[] = [];
  if (raView && bss[raIdx]) {
    objs.forEach((o, i) => {
      if (!o.on) return;
      const g = geometry(bss[raIdx], toScene(o), FOV);
      if (g.inFov) raMarkers.push({ x: g.R, y: deg(g.theta), label: `T${i + 1}`, color: OBJ_COLORS[i] });
    });
    for (const det of sim.res[raIdx].dets) raMarkers.push({ x: det.R, y: deg(det.theta), color: '#ffffff', shape: 'cross' });
  }

  // ---------- Monte Carlo
  function mcKey() {
    return JSON.stringify([cfg, bsPos, K, objs, mod]);
  }
  const runMc = async () => {
    if (!t1) return;
    cancelRef.current = false;
    const key = mcKey();
    const c = cons;
    const sc = scene;
    const truth = t1;
    const ks = Array.from({ length: K }, (_, i) => i + 1);
    const sum: Record<Method, number[]> = Object.fromEntries(METHODS.map((m) => [m, ks.map(() => 0)])) as Record<Method, number[]>;
    const cnt: Record<Method, number[]> = Object.fromEntries(METHODS.map((m) => [m, ks.map(() => 0)])) as Record<Method, number[]>;
    const scatter: Pt[] = [];
    setMcProg(0);
    let done = 0;
    for (let tr = 0; tr < trials; tr++) {
      if (cancelRef.current) break;
      const res: BsResult[] = [];
      for (let b = 0; b < K; b++) res.push(simulateBs(cfg, c, bss[b], sc, new Rng(1_000_003 * (tr + 1) + b * 7919)));
      for (const k of ks) {
        const f = fuse(cfg, bss, res, Array.from({ length: k }, (_, i) => i), W, 120);
        let best: (typeof f.cands)[number] | null = null;
        let bd = gate;
        for (const cd of f.cands) {
          const e = cd.est.both ?? cd.est.grid!;
          const dd = Math.hypot(e.x - truth.x, e.y - truth.y);
          if (dd < bd) {
            bd = dd;
            best = cd;
          }
        }
        if (!best) continue;
        for (const m of METHODS) {
          const e = best.est[m];
          if (!e) continue;
          sum[m][k - 1] += (e.x - truth.x) ** 2 + (e.y - truth.y) ** 2;
          cnt[m][k - 1] += 1;
        }
        if (k === K && best.est.both) scatter.push({ x: best.est.both.x, y: best.est.both.y });
      }
      done++;
      setMcProg((tr + 1) / trials);
      await new Promise((r) => setTimeout(r, 0));
    }
    if (!done) {
      setMcProg(null);
      return;
    }
    const rmse = Object.fromEntries(METHODS.map((m) => [m, ks.map((_, i) => (cnt[m][i] ? Math.sqrt(sum[m][i] / cnt[m][i]) : NaN))])) as Record<Method, number[]>;
    const success = Object.fromEntries(METHODS.map((m) => [m, ks.map((_, i) => cnt[m][i] / done)])) as Record<Method, number[]>;
    setMc({
      key,
      ks,
      rmse,
      success,
      crlbBoth: ks.map((k) => positionCrlb(cfg, bss, Array.from({ length: k }, (_, i) => i), truth, 'both').rmse),
      crlbRange: ks.map((k) => positionCrlb(cfg, bss, Array.from({ length: k }, (_, i) => i), truth, 'range').rmse),
      scatter,
      trials: done,
    });
    setMcProg(null);
  };
  const mcStale = mc && mc.key !== mcKey();

  const mcSeries: Series[] = [];
  if (mc) {
    for (const m of METHODS) {
      const xs: number[] = [];
      const ys: number[] = [];
      mc.ks.forEach((k, i) => {
        if (isFinite(mc.rmse[m][i])) {
          xs.push(k);
          ys.push(mc.rmse[m][i]);
        }
      });
      if (!xs.length) continue;
      mcSeries.push({ x: xs, y: ys, label: METHOD_LABEL[m], color: METHOD_COLOR[m], width: m === 'both' ? 2.5 : 1.8 });
      mcSeries.push({ x: xs, y: ys, color: METHOD_COLOR[m], mode: 'scatter', size: 3.5 });
    }
    const cb = mc.ks.map((k, i) => [k, mc.crlbBoth[i]]).filter(([, v]) => isFinite(v));
    if (cb.length) mcSeries.push({ x: cb.map((p) => p[0]), y: cb.map((p) => p[1]), label: 'CRLB range + angle', color: 'var(--text)', dash: [6, 4], width: 1.5 });
    const cr = mc.ks.map((k, i) => [k, mc.crlbRange[i]]).filter(([, v]) => isFinite(v));
    if (cr.length) mcSeries.push({ x: cr.map((p) => p[0]), y: cr.map((p) => p[1]), label: 'CRLB ranges only', color: 'var(--text-muted)', dash: [2, 3], width: 1.5 });
  }

  const rate = (N * cons.k) / d.Tsym;
  const recLoss = cfg.removal === 'reciprocal' ? reciprocalLossDb(cons) : 0;

  const newNoiseBtn = <TsButton icon={ICONS.dice} label="New noise" onClick={() => setSeed(seed + 1)} title="New noise / data realisation" />;

  const simulationTab = (
    <>
      <TsSection title="Scene">
        <TsCol>
          <TsSlider label="Area" value={W} onChange={(v) => changeW(Math.round(v))} min={60} max={400} step={10} format={(v) => `${v} × ${v} m`} hint="Side of the square area. Drag stations (triangles) and objects (dots) on the map." />
          <TsSelect label="Stations" value={K} options={BS_OPTS} onChange={setK} format={(v) => `${v} BS`} hint="Cooperating base stations. Each one is a monostatic OFDM radar that hears its own echoes." />
        </TsCol>
        <TsButton icon={ICONS.reset} label="Reset BS" onClick={() => setBsPos(defaultBs(W))} title="Reset station positions" />
      </TsSection>
      <TsSection title="Radio & numerology">
        <TsCol>
          <TsSelect label="Carrier fc" value={fcG} options={FC_OPTS} onChange={setFcG} format={(v) => `${v} GHz`} />
          <TsSelect label="Spacing Δf" value={scs} options={SCS_OPTS} onChange={setScs} format={(v) => `${v} kHz`} hint="Sets the CP length, so the furthest usable range." />
        </TsCol>
        <TsCol>
          <TsSelect label="Subcarriers N" value={N} options={N_OPTS} onChange={setN} hint="Sets the bandwidth B = N·Δf, so the range resolution." />
          <TsSelect label="Symbols M" value={M} options={M_OPTS} onChange={setM} hint="OFDM symbols per frame. Sets the velocity resolution." />
        </TsCol>
        <TsCol>
          <TsSelect label="Antennas Na" value={Na} options={NA_OPTS} onChange={setNa} hint="Half-wavelength ULA facing the area centre, ±60° field of view. Sets the angular resolution." />
          <TsSlider label="Tx power" value={pt} onChange={setPt} min={0} max={46} step={1} format={(v) => `${v} dBm`} />
        </TsCol>
      </TsSection>
      <TsSection title="Data & processing">
        <TsCol>
          <TsSelect label="Modulation" value={mod} options={MODS} onChange={setMod} />
          <TsSelect label="Data removal" value={removal} options={REMOVALS} onChange={setRemoval} format={(v) => v.split(" (")[0]} hint="Reciprocal: Y ÷ X. Matched: Y × X*." />
        </TsCol>
        <TsCol>
          <TsCheck label="Hann window" value={hann} onChange={setHann} hint="Hann windows in the FFT stage. Lower side lobes → fewer ghosts. The fine stage never uses a window." />
        </TsCol>
      </TsSection>
      <TsSection title="Run">{newNoiseBtn}</TsSection>
    </>
  );

  const objectsTab = (
    <>
      {objs.map((o, i) => (
        <TsSection key={i} title={`Object T${i + 1}`}>
          <TsCol>
            <TsCheck label={<span style={{ color: OBJ_COLORS[i], fontWeight: 650 }}>T{i + 1} enabled</span>} value={o.on} onChange={(on) => setObj(i, { on })} />
            <div className="ts-note">{o.on ? `(${o.x.toFixed(1)}, ${o.y.toFixed(1)}) m · drag on map` : 'off'}</div>
            <TsSelect label="Preset" value={rcsPreset(o.rcs)} options={RCS_PRESETS} onChange={(p) => p !== 'Custom' && setObj(i, { rcs: RCS_OF[p] })} hint="Typical radar cross-sections." />
          </TsCol>
          {o.on && (
            <TsCol>
              <TsSlider label="Speed" value={o.speed} onChange={(v) => setObj(i, { speed: v })} min={0} max={40} step={0.5} format={(v) => `${v} m/s`} hint={`${(o.speed * 3.6).toFixed(0)} km/h`} />
              <TsSlider label="Heading" value={o.heading} onChange={(v) => setObj(i, { heading: v })} min={-180} max={180} step={5} format={(v) => `${v}°`} hint="Counter-clockwise from +x." />
              <TsSlider label="RCS" value={o.rcs} onChange={(v) => setObj(i, { rcs: v })} min={-20} max={20} step={1} format={(v) => `${v} dBsm`} hint="Person ≈ −5…0, car ≈ 10, truck ≈ 20." />
            </TsCol>
          )}
        </TsSection>
      ))}
    </>
  );

  const viewTab = (
    <>
      <TsSection title="Map layers">
        <TsButton icon={ICONS.heat} label="Likelihood" active={showHeat} onClick={() => setShowHeat(!showHeat)} title="Show fused likelihood map" />
        <TsButton icon={ICONS.rings} label="Rings" active={showRings} onClick={() => setShowRings(!showRings)} title="Show measured range rings & bearings" />
      </TsSection>
      <TsSection title="Run">{newNoiseBtn}</TsSection>
    </>
  );

  const toolstrip = (
    <Toolstrip
      tabs={[
        { id: 'sim', label: 'SIMULATION', content: simulationTab },
        { id: 'obj', label: 'OBJECTS', content: objectsTab },
        { id: 'view', label: 'VIEW', content: viewTab },
      ]}
      right={<span className="ts-status">{K} stations · {fcG} GHz · B = {si(d.B, 'Hz')}</span>}
    />
  );

  return (
    <ToolstripLayout toolstrip={toolstrip}>
      <LabIntro>
        <h2>Cooperative ISAC localisation</h2>
        <p>
          Several base stations each run the OFDM radar from Lab 5 on their own echoes, measuring <b>range</b> (from bandwidth),
          <b> angle</b> (from the antenna array) and <b>radial speed</b> (from Doppler). A fusion centre combines their
          measurements to locate each object far more precisely than any single station can.
        </p>
      </LabIntro>

      {warnings.map((w, i) => (
        <Warn key={i}>{w}</Warn>
      ))}

      <Metrics>
        <Metric label="Bandwidth B = N·Δf" value={si(d.B, 'Hz')} />
        <Metric label="Range resolution" value={si(d.dR, 'm')} sub="c / 2B" />
        <Metric label="Angular resolution" value={Na > 1 ? `${deg(d.hpbw).toFixed(1)}°` : 'none'} sub="≈ 0.886·2/Na at broadside" />
        <Metric label="Velocity resolution" value={`${d.dV.toFixed(2)} m/s`} sub="λ / (2·M·T_sym)" />
        <Metric label="CP-limited range" value={si(d.Rcp, 'm')} tone={cfg.rView > d.Rcp ? 'warn' : 'good'} sub={`area diagonal ${si(W * Math.SQRT2, 'm')}`} />
        <Metric label="Comm rate per station" value={si(rate, 'bit/s')} sub={`${mod}, same signal`} />
      </Metrics>

      <div className="grid2">
        <Card title="Area map (top view). Drag the stations and objects.">
          <WorldMap xRange={[-pad, W + pad]} yRange={[-pad, W + pad]} shapes={shapes} heat={heat} handles={handles} onDrag={onDrag} />
          <p className="caption">
            Triangles = base stations (pointing at their boresight). Dots = true objects, with a line showing their velocity. Dashed
            rings and lines = each station's measured range and bearing. ✕ E1, E2… = fused estimates. Background = the sum of all stations'
            range-angle maps (stage 1 of the fusion).
          </p>
        </Card>
        <Card title={`Zoom around T1 (±${fmtLen(zoomHalf)})`}>
          {t1 ? (
            <>
              <WorldMap xRange={[t1.x - zoomHalf, t1.x + zoomHalf]} yRange={[t1.y - zoomHalf, t1.y + zoomHalf]} shapes={zoomShapes} maxHeight={420} />
              <div className="legend-row">
                {METHODS.map((m) => (
                  <span key={m} style={{ color: METHOD_COLOR[m] }}>
                    {METHOD_SHAPE[m] === 'cross' ? '✕' : METHOD_SHAPE[m] === 'plus' ? '+' : METHOD_SHAPE[m] === 'diamond' ? '◇' : '○'} {METHOD_LABEL[m]}
                  </span>
                ))}
              </div>
              <p className="caption">
                Solid ellipse = 1σ CRLB of the fused position (the best any unbiased method can do); dashed = 95 % region. Dotted spokes
                point to the stations. Markers outside this window (often the coarse grid estimate) are not drawn. After a Monte Carlo run, small dots show where the range + angle estimate landed in each trial.
              </p>
            </>
          ) : (
            <p className="caption">Enable T1 to see its accuracy.</p>
          )}
        </Card>
      </div>

      {t1 && (
        <Metrics>
          <Metric label="T1 CRLB, best single station" value={fmtLen(crlbSingle)} sub="range + angle from one BS" />
          <Metric label={`T1 CRLB, ${K} stations fused`} value={fmtLen(crlbFused?.rmse ?? Infinity)} sub={`using ${crlbFused?.used ?? 0} station(s) that can detect it`} tone="good" />
          <Metric label="Cooperation gain" value={isFinite(coopGain) ? `${coopGain.toFixed(1)} dB` : '–'} sub="20·log₁₀(single ÷ fused)" />
          <Metric label="GDOP (ranges only)" value={isFinite(geo) ? geo.toFixed(2) : '∞'} sub={`CRLB ranges only: ${fmtLen(crlbRangeOnly?.rmse ?? Infinity)}`} tone={geo < 2 ? 'good' : geo < 5 ? 'warn' : 'bad'} hint="How the station geometry multiplies range errors into position error. Stations evenly spread around the object give the ideal 2/√K." />
          {METHODS.map((m) => (
            <Metric key={m} label={`Error, ${METHOD_LABEL[m]}`} value={fmtLen(err(t1Cand?.est[m]))} sub="this run" />
          ))}
          <Metric
            label="T1 velocity (fused radial speeds)"
            value={t1Cand?.vel ? `${Math.hypot(t1Cand.vel.vx, t1Cand.vel.vy).toFixed(2)} m/s` : '–'}
            sub={
              t1Cand?.vel
                ? `heading ${deg(Math.atan2(t1Cand.vel.vy, t1Cand.vel.vx)).toFixed(1)}° (true ${objs[0].speed} m/s, ${objs[0].heading}°)`
                : 'needs ≥ 2 stations'
            }
          />
        </Metrics>
      )}

      <Card title="What each station measured">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Station</th>
                <th>T1 true range / angle</th>
                <th>T1 SNR (theory)</th>
                <th>Detections</th>
                <th>Matched to T1: range, angle, radial v</th>
                <th>Est. SNR</th>
                <th>σ range / σ angle (CRLB)</th>
              </tr>
            </thead>
            <tbody>
              {active.map((b) => {
                const g = t1 ? geometry(bss[b], t1, FOV) : null;
                const snr = g && t1 ? snrIntegrated(cfg, g, t1.rcs) : 0;
                const mt = t1Cand?.meas.find((m) => m.bs === b)?.det;
                return (
                  <tr key={b}>
                    <td>BS{b + 1}</td>
                    <td>{g ? (g.inFov ? `${g.R.toFixed(2)} m / ${deg(g.theta).toFixed(1)}°` : 'outside view') : '–'}</td>
                    <td>{g?.inFov ? `${(10 * Math.log10(Math.max(snr, 1e-30))).toFixed(1)} dB` : '–'}</td>
                    <td>{sim.res[b]?.dets.length ?? 0}</td>
                    <td>{mt ? `${mt.R.toFixed(2)} m, ${deg(mt.theta).toFixed(2)}°, ${mt.vr.toFixed(2)} m/s` : '–'}</td>
                    <td>{mt ? `${mt.snrDb.toFixed(1)} dB` : '–'}</td>
                    <td>{mt ? `${fmtLen(mt.sigR)} / ${Na > 1 ? `${deg(mt.sigTheta).toFixed(3)}°` : '–'}` : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="caption">
          "Theory" SNR is the radar equation (power falls as 1/R⁴) times the processing gain N·M·Na. "Est. SNR" is what the station
          measured from its own echo{cfg.removal === 'reciprocal' && recLoss > 0.05 ? `; with ${mod} the reciprocal filter loses about ${recLoss.toFixed(1)} dB` : ''}.
        </p>
      </Card>

      <Card
        title="One station's range-angle map"
        right={
          K > 1 ? (
            <div className="seg small">
              {active.map((b) => (
                <button key={b} className={raIdx === b ? 'on' : ''} onClick={() => setRaBs(b + 1)}>
                  BS{b + 1}
                </button>
              ))}
            </div>
          ) : undefined
        }
      >
        {raView && (
          <Heatmap
            data={raView.data}
            rows={raView.rows}
            cols={raView.cols}
            xRange={[0, raView.xMax]}
            yRange={[-91, 91]}
            zRange={[0, 45]}
            xLabel="Range (m)"
            yLabel="Angle off boresight (°)"
            zLabel="dB"
            markers={raMarkers}
            height={280}
          />
        )}
        <p className="caption">
          What BS{raIdx + 1} sees on its own: bright spots at (range, angle). Range is sharp (bandwidth); angle is blurry unless there are many
          antennas. Circles = truth, ✕ = detections. Stage 1 of the fusion paints these maps onto the shared x-y grid and adds them up.
        </p>
      </Card>

      <Card title="Monte Carlo: T1 position error vs number of cooperating stations">
        <div className="mc-row">
          <Slider label="Trials" value={trials} onChange={(v) => setTrials(Math.round(v))} min={10} max={200} step={10} format={(v) => `${v}`} />
          {mcProg === null ? (
            <button className="btn primary" onClick={runMc} disabled={!t1}>
              Run {trials} trials × {K} station{K > 1 ? 's' : ''}
            </button>
          ) : (
            <button className="btn" onClick={() => (cancelRef.current = true)}>
              Stop ({Math.round(mcProg * 100)} %)
            </button>
          )}
        </div>
        {mcStale && <Warn tone="info">These results are for earlier settings. Run again to update.</Warn>}
        {mc ? (
          <>
            <Plot series={mcSeries} xLabel="Number of cooperating stations K (BS1…BSK)" yLabel="RMSE of T1 position (m)" logY legend={false} height={300} xLim={[0.8, mc.ks.length + 0.2]} />
            <div className="legend-row">
              {METHODS.filter((m) => mc.rmse[m].some((v) => isFinite(v))).map((m) => (
                <span key={m} style={{ color: METHOD_COLOR[m] }}>━ {METHOD_LABEL[m]}</span>
              ))}
              <span>╌ CRLB range + angle</span>
              <span className="muted">┈ CRLB ranges only</span>
            </div>
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Method</th>
                    {mc.ks.map((k) => (
                      <th key={k}>K = {k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {METHODS.map((m) => (
                    <tr key={m}>
                      <td style={{ color: METHOD_COLOR[m] }}>{METHOD_LABEL[m]}</td>
                      {mc.ks.map((k, i) => (
                        <td key={k}>
                          {isFinite(mc.rmse[m][i]) ? fmtLen(mc.rmse[m][i]) : '–'}
                          <span className="muted"> ({Math.round(mc.success[m][i] * 100)} %)</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <td>CRLB range + angle</td>
                    {mc.ks.map((k, i) => (
                      <td key={k}>{fmtLen(mc.crlbBoth[i])}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="caption">
              {mc.trials} trials, each with new noise and new random data. Each station is simulated once per trial and the fusion is re-run with
              the first K stations, so every K sees the same echoes. The percentage is how often the method produced a T1 estimate. Use this table
              and plot in your report.
            </p>
          </>
        ) : (
          <p className="caption">Runs the full simulation many times and measures the root-mean-square error of each method against the CRLB.</p>
        )}
      </Card>

      <TryThis
        items={[
          <>Set <b>Na = 1</b> (range only) and <b>K = 1</b>: the station sees only a ring. Raise K to 2 (two possible crossing points) and then 3 (one answer). This is trilateration.</>,
          <>Drag <b>BS2</b> next to BS1. The GDOP rises and the CRLB ellipse in the zoom stretches: the two stations see T1 from almost the same direction. Spread them out again.</>,
          <>Change <b>N</b> from 256 to 1024 (more bandwidth): the ellipse shrinks along the station directions. Change <b>Na</b> from 4 to 16: it shrinks across them.</>,
          <>Drag T1 away from all stations. SNR drops 40 dB per decade of distance (radar 1/R⁴) and the error grows. Raise the transmit power or K to recover.</>,
          <>Switch to <b>64-QAM</b> or <b>256-QAM</b> with reciprocal data removal and run the Monte Carlo again: the error grows well above the CRLB. Switch to matched removal and compare.</>,
          <>Set <b>Δf = 120 kHz</b>: the CP-limited range (≈ 88 m) is smaller than the area, so far stations get weak echoes. This is the numerology trade-off from Lab 5, now on a network.</>,
          <>Enable <b>T3</b> right next to T1 (same speed). With few antennas the two merge; more stations or more antennas separate them. Watch for ghosts (E-markers with no object).</>,
          <>Run the Monte Carlo with K = 6: the range + angle WLS curve should follow the CRLB, with diminishing returns as stations are added.</>,
        ]}
      />

      <Explain title="How the cooperative pipeline works">
        <ol>
          <li>
            <b>Local sensing (each station).</b> The station sends an OFDM frame (N subcarriers × M symbols), receives the echoes on Na antennas,
            divides out the known data, and runs FFTs over subcarriers (→ range), symbols (→ Doppler) and antennas (→ angle). It keeps the peaks that
            stand 15 dB above its noise floor.
          </li>
          <li>
            <b>Fine estimation.</b> Around every peak the station refines range, angle and Doppler by maximising the un-windowed periodogram
            (a maximum-likelihood estimate for one object), and estimates the echo's SNR from its own data.
          </li>
          <li>
            <b>Stage 1 fusion (coarse).</b> The fusion centre draws each station's range-angle map onto a common x-y grid and adds them up (in dB). Real
            objects light up in every map at the same place; the peaks are candidate positions.
          </li>
          <li>
            <b>Stage 2 fusion (fine).</b> For each candidate, every station's nearest detection is associated and a weighted least-squares problem is
            solved (Gauss-Newton). Each measurement is weighted by 1/σ², where σ comes from the CRLB at its measured SNR, so strong, close stations count
            more. With ≥ 2 stations the radial speeds are also combined into a full velocity vector.
          </li>
        </ol>
      </Explain>

      <Explain title="Where the formulas come from">
        <ul>
          <li>
            Echo SNR per resource element: <code>Pt·G²·λ²·σ / ((4π)³·R⁴·kT·NF·B)</code> (monostatic radar equation, element gain 5 dBi·cos θ, NF 7 dB).
            Integrated SNR = that × N·M·Na.
          </li>
          <li>
            Single-object CRLBs (white noise, centred indices): <code>σ_R = c/(4πΔf)·√(6/(SNR·(N²−1)))</code>,{' '}
            <code>σ_sinθ = √(6/(SNR·(Na²−1)))/π</code>, <code>σ_v = λ/(4π·T_sym)·√(6/(SNR·(M²−1)))</code>.
          </li>
          <li>
            Position Fisher information from station b: <code>J_b = u·uᵀ/σ_R² + p·pᵀ/(R²·σ_θ²)</code>, with u pointing from the station to the object and
            p perpendicular to it. Fused CRLB = <code>√trace((Σ J_b)⁻¹)</code>; the ellipse is drawn from <code>(Σ J_b)⁻¹</code>.
          </li>
          <li>
            GDOP = <code>√trace((HᵀH)⁻¹)</code> with H the unit vectors to the stations: the factor by which station geometry multiplies range errors.
          </li>
          <li>
            Reciprocal data removal divides by each symbol, so weak (inner) QAM points boost the noise. Its SNR loss is <code>10·log₁₀ E[1/|X|²]</code>{' '}
            ({mod}: {reciprocalLossDb(cons).toFixed(2)} dB). The CRLB assumes known data and has no such loss, so the gap you see is the price of the estimator.
          </li>
        </ul>
      </Explain>

      <Explain title="What this model leaves out (good topics for your report)">
        <ul>
          <li>Stations are assumed not to interfere with each other (separate time slots or sub-bands) and to cancel their own transmit leakage perfectly (full duplex).</li>
          <li>Multi-monostatic only: no bistatic links (station A transmits, station B listens), so no clock or synchronisation errors.</li>
          <li>Point objects with a constant radar cross-section from every direction, no clutter, no multipath, no blocking, 2-D only.</li>
          <li>Fusion uses greedy nearest-neighbour association. Real systems use global assignment and tracking (e.g. Kalman filters) over many frames.</li>
        </ul>
      </Explain>
    </ToolstripLayout>
  );
}
