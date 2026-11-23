import { useMemo, useState } from 'react';
import { Heatmap, Marker } from '../components/Heatmap';
import { Plot } from '../components/Plot';
import { Card, Choice, Explain, Group, LabLayout, Metric, Metrics, Slider, Toggle, TryThis, TsButton, TsSection, Warn } from '../components/Controls';

const DICE = (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8.5 8.5h.01M15.5 8.5h.01M12 12h.01M8.5 15.5h.01M15.5 15.5h.01" />
  </svg>
);
import { fft } from '../dsp/fft';
import { MODS, ModName, constellation } from '../dsp/modulation';
import { Rng } from '../dsp/random';
import { C, db, si, undb } from '../dsp/units';

const FC_OPTS = [3.5, 7, 15, 28, 60, 140] as const; // GHz (FR1, FR3, FR3, FR2, FR2, sub-THz)
const SCS_OPTS = [15, 30, 60, 120, 240, 480, 960] as const; // kHz
const N_OPTS = [64, 128, 256, 512] as const;
const M_OPTS = [16, 32, 64, 128] as const;
const CP_RATIO = 144 / 2048; // 5G NR normal cyclic prefix ≈ 7 %
type Removal = 'Reciprocal (Y ÷ X)' | 'Matched (Y × X*)';
const REMOVALS: Removal[] = ['Reciprocal (Y ÷ X)', 'Matched (Y × X*)'];

interface Target {
  on: boolean;
  r: number; // m
  v: number; // m/s (positive = moving away)
  p: number; // echo strength relative to reference, dB
}

const COLORS = ['#ff4d6d', '#ffb703', '#4cc9f0'];

export default function RadarLab() {
  const [fcG, setFcG] = useState<number>(28);
  const [scs, setScs] = useState<number>(120);
  const [N, setN] = useState<number>(256);
  const [M, setM] = useState<number>(64);
  const [mod, setMod] = useState<ModName>('QPSK');
  const [removal, setRemoval] = useState<Removal>('Reciprocal (Y ÷ X)');
  const [hann, setHann] = useState(true);
  const [ici, setIci] = useState(true);
  const [snrDb, setSnrDb] = useState(-5);
  const [viewFrac, setViewFrac] = useState(0.1);
  const [seed, setSeed] = useState(2);
  const [targets, setTargets] = useState<Target[]>([
    { on: true, r: 18, v: 12, p: 0 },
    { on: true, r: 40, v: -25, p: -6 },
    { on: false, r: 20, v: 12, p: -3 },
  ]);

  const fc = fcG * 1e9;
  const lambda = C / fc;
  const df = scs * 1e3;
  const T = 1 / df;
  const Tcp = CP_RATIO * T;
  const Tsym = T + Tcp;
  const B = N * df;
  const dR = C / (2 * B);
  const Rmax = C / (2 * df);
  const Rcp = (C * Tcp) / 2;
  const dV = lambda / (2 * M * Tsym);
  const Vmax = lambda / (4 * Tsym);
  const c = constellation(mod);

  const sim = useMemo(() => {
    const rng = new Rng(seed);
    const Pn = 2 * N; // zero-padding ×2 in range
    const Pm = 2 * M; // ×2 in Doppler
    const nsig = Math.sqrt(1 / undb(snrDb) / 2); // noise std per real dim (unit-power symbols)

    // Transmit symbols
    const Xr = new Float64Array(N * M);
    const Xi = new Float64Array(N * M);
    for (let i = 0; i < N * M; i++) {
      const s = rng.int(1 << c.k);
      Xr[i] = c.re[s];
      Xi[i] = c.im[s];
    }

    // Received echo grid: Y = X · Σ a e^{-j2π n Δf τ} e^{+j2π m Tsym fD} + noise (+ ICI)
    const Yr = new Float64Array(N * M);
    const Yi = new Float64Array(N * M);
    let iciVar = 0;
    const act = targets.filter((t) => t.on);
    for (const t of act) {
      const tau = (2 * t.r) / C;
      const fD = (2 * t.v * fc) / C;
      let amp = Math.sqrt(undb(t.p));
      // Echo arriving after the CP: part of the FFT window is missing → weaker, leaks
      if (tau > Tcp) amp *= Math.max(0, 1 - (tau - Tcp) / T);
      if (ici) iciVar += amp * amp * ((Math.PI * fD * T) ** 2) / 3;
      const ph0 = 2 * Math.PI * rng.uniform();
      for (let m = 0; m < M; m++) {
        const pm = 2 * Math.PI * m * Tsym * fD + ph0;
        for (let n = 0; n < N; n++) {
          const ph = pm - 2 * Math.PI * n * df * tau;
          const hr = amp * Math.cos(ph);
          const hi = amp * Math.sin(ph);
          const i = m * N + n;
          Yr[i] += Xr[i] * hr - Xi[i] * hi;
          Yi[i] += Xr[i] * hi + Xi[i] * hr;
        }
      }
    }
    const tsig = Math.sqrt(nsig * nsig + iciVar / 2);
    for (let i = 0; i < N * M; i++) {
      Yr[i] += tsig * rng.gauss();
      Yi[i] += tsig * rng.gauss();
    }

    // Data removal
    const Zr = new Float64Array(N * M);
    const Zi = new Float64Array(N * M);
    for (let i = 0; i < N * M; i++) {
      const xr = Xr[i];
      const xi = Xi[i];
      if (removal === 'Reciprocal (Y ÷ X)') {
        const d = xr * xr + xi * xi;
        Zr[i] = (Yr[i] * xr + Yi[i] * xi) / d;
        Zi[i] = (Yi[i] * xr - Yr[i] * xi) / d;
      } else {
        Zr[i] = Yr[i] * xr + Yi[i] * xi;
        Zi[i] = Yi[i] * xr - Yr[i] * xi;
      }
    }

    // Windows
    const wn = new Float64Array(N);
    const wm = new Float64Array(M);
    for (let n = 0; n < N; n++) wn[n] = hann ? 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (N - 1)) : 1;
    for (let m = 0; m < M; m++) wm[m] = hann ? 0.5 - 0.5 * Math.cos((2 * Math.PI * m) / (M - 1)) : 1;

    // Range: IFFT across subcarriers (per symbol). Result Rr[m][r]
    const RDr = new Float64Array(Pm * Pn);
    const RDi = new Float64Array(Pm * Pn);
    for (let m = 0; m < M; m++) {
      const re = new Float64Array(Pn);
      const im = new Float64Array(Pn);
      for (let n = 0; n < N; n++) {
        re[n] = Zr[m * N + n] * wn[n] * wm[m];
        im[n] = Zi[m * N + n] * wn[n] * wm[m];
      }
      fft(re, im, true);
      for (let r = 0; r < Pn; r++) {
        RDr[m * Pn + r] = re[r];
        RDi[m * Pn + r] = im[r];
      }
    }
    // Doppler: FFT across symbols (per range bin), with fftshift
    const map = new Float64Array(Pm * Pn); // rows = Doppler (bottom = most negative), cols = range
    let peak = 0;
    for (let r = 0; r < Pn; r++) {
      const re = new Float64Array(Pm);
      const im = new Float64Array(Pm);
      for (let m = 0; m < M; m++) {
        re[m] = RDr[m * Pn + r];
        im[m] = RDi[m * Pn + r];
      }
      fft(re, im);
      for (let q = 0; q < Pm; q++) {
        const row = (q + Pm / 2) % Pm; // shift zero Doppler to centre
        const p = re[q] * re[q] + im[q] * im[q];
        map[row * Pn + r] = p;
        if (p > peak) peak = p;
      }
    }

    // Noise floor (median) and simple peak detection
    const sorted = Float64Array.from(map).sort();
    const floor = sorted[Math.floor(sorted.length / 2)];
    const thr = floor * undb(15);
    const dets: { r: number; v: number; p: number }[] = [];
    for (let row = 1; row < Pm - 1; row++) {
      for (let col = 1; col < Pn - 1; col++) {
        const v = map[row * Pn + col];
        if (v < thr) continue;
        let isMax = true;
        for (let a = -1; a <= 1 && isMax; a++)
          for (let b = -1; b <= 1; b++) {
            if ((a || b) && map[(row + a) * Pn + col + b] > v) {
              isMax = false;
              break;
            }
          }
        if (isMax) dets.push({ r: (col / Pn) * Rmax, v: ((row - Pm / 2) / Pm) * 2 * Vmax, p: db(v / peak) });
      }
    }
    dets.sort((a, b) => b.p - a.p);

    const mapDb = new Float64Array(Pm * Pn);
    for (let i = 0; i < mapDb.length; i++) mapDb[i] = db(map[i] / peak);

    // Cuts through the strongest cell
    let pi = 0;
    for (let i = 0; i < map.length; i++) if (map[i] > map[pi]) pi = i;
    const prow = Math.floor(pi / Pn);
    const pcol = pi % Pn;
    const rx: number[] = [];
    const ry: number[] = [];
    for (let col = 0; col < Pn; col++) {
      rx.push((col / Pn) * Rmax);
      ry.push(mapDb[prow * Pn + col]);
    }
    const vx: number[] = [];
    const vy: number[] = [];
    for (let row = 0; row < Pm; row++) {
      vx.push(((row - Pm / 2) / Pm) * 2 * Vmax);
      vy.push(mapDb[row * Pn + pcol]);
    }

    return { mapDb, Pn, Pm, dets: dets.slice(0, 6), floorDb: db(floor / peak), rx, ry, vx, vy };
  }, [N, M, df, Tsym, T, Tcp, fc, c, removal, hann, ici, snrDb, seed, targets, Rmax, Vmax]);

  const setT = (i: number, patch: Partial<Target>) => setTargets(targets.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  const markers: Marker[] = targets
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.on)
    .map(({ t, i }) => ({ x: t.r, y: t.v, label: `T${i + 1}`, color: COLORS[i] }));

  const warnings: string[] = [];
  targets.forEach((t, i) => {
    if (!t.on) return;
    if (t.r > Rmax) warnings.push(`T${i + 1} is beyond the unambiguous range (${si(Rmax, 'm')}). It will appear at the wrong ("aliased") range.`);
    else if (t.r > Rcp) warnings.push(`T${i + 1}'s echo arrives after the cyclic prefix (CP-limited range ${si(Rcp, 'm')}), so it gets weaker and smeared.`);
    if (Math.abs(t.v) > Vmax) warnings.push(`T${i + 1}'s speed exceeds ±${Vmax.toFixed(1)} m/s. Its Doppler wraps around and it shows the wrong velocity.`);
  });
  const t1 = targets[0];
  const t3 = targets[2];
  if (t1.on && t3.on && Math.abs(t1.r - t3.r) < dR && Math.abs(t1.v - t3.v) < dV)
    warnings.push(`T1 and T3 are closer than one resolution cell (${si(dR, 'm')}, ${dV.toFixed(2)} m/s), so they merge into one blob.`);

  const peakSnr = snrDb + db(N * M);
  const rate = (N * c.k) / Tsym;
  const xMaxView = Math.max(dR * 8, Rmax * viewFrac);

  const simulationTab = (
    <>
      <Group title="Radio band & numerology">
        <Choice label="Carrier fc" value={fcG} options={FC_OPTS} onChange={(v) => setFcG(v)} format={(v) => `${v} GHz`} hint="3.5 = FR1, 7–15 = FR3 (upper mid-band), 28–60 = mmWave, 140 = sub-THz" />
        <Choice label="Subcarrier spacing Δf" value={scs} options={SCS_OPTS} onChange={(v) => setScs(v)} format={(v) => `${v}k`} />
        <Choice label="Subcarriers N" hint="Sets the bandwidth B = N·Δf." value={N} options={N_OPTS} onChange={(v) => setN(v)} />
        <Choice label="Symbols M" hint="OFDM symbols. Sets the observation time." value={M} options={M_OPTS} onChange={(v) => setM(v)} />
      </Group>
      <Group title="Data & processing">
        <Choice label="Modulation" value={mod} options={MODS} onChange={setMod} />
        <Choice label="Data removal" value={removal} options={REMOVALS} onChange={setRemoval} hint="Reciprocal cancels the data exactly but boosts noise on weak symbols. Matched keeps the data's amplitude ripple." />
        <Toggle label="Hann window" hint="Lower sidelobes." value={hann} onChange={setHann} />
        <Toggle label="Model ICI from Doppler" value={ici} onChange={setIci} hint="Motion during one symbol breaks orthogonality: ICI ≈ (π·fD·T)²/3." />
        <Slider label="SNR per RE" value={snrDb} onChange={setSnrDb} min={-30} max={30} step={1} format={(v) => `${v} dB`} hint="SNR per resource element: echo power vs noise in ONE grid cell, before processing gain." />
      </Group>
      <TsSection title="Run">
        <TsButton icon={DICE} label="New noise" onClick={() => setSeed(seed + 1)} title="New data + noise" />
      </TsSection>
    </>
  );
  const targetsTab = (
    <>
      {targets.map((t, i) => (
        <Group key={i} title={`Target T${i + 1}`}>
          <Toggle label={<span style={{ color: COLORS[i], fontWeight: 600 }}>enabled</span>} value={t.on} onChange={(on) => setT(i, { on })} />
          {t.on && (
            <>
              <Slider label="Range" value={t.r} onChange={(r) => setT(i, { r })} min={1} max={Math.max(300, Rmax * 1.3)} log format={(v) => si(v, 'm')} />
              <Slider label="Velocity (radial)" value={t.v} onChange={(v) => setT(i, { v })} min={-120} max={120} step={0.5} format={(v) => `${v} m/s (${(v * 3.6).toFixed(0)} km/h)`} />
              <Slider label="Echo strength" value={t.p} onChange={(p) => setT(i, { p })} min={-30} max={10} step={1} format={(v) => `${v} dB`} />
            </>
          )}
        </Group>
      ))}
    </>
  );
  const viewTab = (
    <>
      <Group title="View">
        <Slider label="Range axis zoom" value={viewFrac} onChange={setViewFrac} min={0.005} max={1} log format={(v) => `0 – ${si(Math.max(dR * 8, Rmax * v), 'm')}`} />
      </Group>
    </>
  );

  return (
    <LabLayout
      tabs={[
        { id: 'sim', label: 'SIMULATION', content: simulationTab },
        { id: 'targets', label: 'TARGETS', content: targetsTab },
        { id: 'view', label: 'VIEW', content: viewTab },
      ]}
    >
      <div className="lab-intro">
        <h2>OFDM Radar: sensing with a communication signal (ISAC)</h2>
        <p>
          The base station sends its normal OFDM data and listens for <b>echoes</b> (monostatic sensing). It knows what it sent, so it
          divides the data out of each grid cell. What remains is the channel: a target at range R adds a phase ramp
          <b> across subcarriers</b> (delay τ = 2R/c), and a moving target adds a phase ramp <b>across symbols</b> (Doppler f_D = 2v/λ).
          A <b>2-D FFT</b> turns those ramps into a bright spot at (range, velocity).
        </p>
        <div className="chain">
          <span>Tx grid X[n,m]</span>→<span className="ch">Echoes from targets + noise</span>→<span>Rx grid Y[n,m]</span>→
          <span>Remove data: Y/X</span>→<span>IFFT over n → range</span>→<span>FFT over m → velocity</span>→<span>Detect peaks</span>
        </div>
      </div>
      <Metrics>
        <Metric label="Bandwidth B = N·Δf" value={si(B, 'Hz')} />
        <Metric label="Range resolution" value={si(dR, 'm')} sub="c / 2B" />
        <Metric label="Max unambiguous range" value={si(Rmax, 'm')} sub="c / 2Δf" />
        <Metric label="CP-limited range" value={si(Rcp, 'm')} sub="c·T_CP / 2" />
        <Metric label="Velocity resolution" value={`${dV.toFixed(2)} m/s`} sub="λ / (2·M·T_sym)" />
        <Metric label="Max unambiguous velocity" value={`± ${Vmax.toFixed(1)} m/s`} sub="λ / (4·T_sym)" />
        <Metric label="Frame time" value={si(M * Tsym, 's')} sub={`${M} × ${si(Tsym, 's')}`} />
        <Metric label="Processing gain" value={`${db(N * M).toFixed(1)} dB`} sub={`N·M = ${N * M} cells → peak SNR ≈ ${peakSnr.toFixed(0)} dB`} />
        <Metric label="Comm data rate (same signal)" value={si(rate, 'bit/s')} />
      </Metrics>
      {warnings.map((w, i) => (
        <Warn key={i}>{w}</Warn>
      ))}

      <Card title="Range-Doppler map (circles = true target positions)">
        <Heatmap
          data={sim.mapDb}
          rows={sim.Pm}
          cols={sim.Pn}
          xRange={[0, Rmax]}
          yRange={[-Vmax, Vmax]}
          zRange={[-60, 0]}
          xView={[0, Math.min(Rmax, xMaxView)]}
          xLabel="Range (m)"
          yLabel="Velocity (m/s)"
          zLabel="dB"
          markers={markers}
          height={360}
        />
      </Card>
      <div className="grid2">
        <Card title="Range profile (through strongest peak)">
          <Plot series={[{ x: sim.rx, y: sim.ry, color: 'var(--s1)', width: 1.5 }]} xLim={[0, Math.min(Rmax, xMaxView)]} yLim={[-70, 3]} xLabel="Range (m)" yLabel="dB" legend={false} height={220} hLines={[{ v: sim.floorDb, label: 'noise floor' }]} />
        </Card>
        <Card title="Doppler profile (through strongest peak)">
          <Plot series={[{ x: sim.vx, y: sim.vy, color: 'var(--s5)', width: 1.5 }]} yLim={[-70, 3]} xLabel="Velocity (m/s)" yLabel="dB" legend={false} height={220} hLines={[{ v: sim.floorDb, label: 'noise floor' }]} />
        </Card>
      </div>
      <Card title={`Detections (peaks 15 dB above the median noise floor): ${sim.dets.length}`}>
        <table className="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Range</th>
              <th>Velocity</th>
              <th>Power (rel. peak)</th>
            </tr>
          </thead>
          <tbody>
            {sim.dets.map((d, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{si(d.r, 'm')}</td>
                <td>{d.v.toFixed(2)} m/s</td>
                <td>{d.p.toFixed(1)} dB</td>
              </tr>
            ))}
            {sim.dets.length === 0 && (
              <tr>
                <td colSpan={4}>Nothing detected. Raise the SNR, the echo strength, or N and M (more processing gain).</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <TryThis
        items={[
          <>Set SNR to −25 dB. One grid cell is buried in noise, yet the target still shows, because the 2-D FFT adds up N·M cells coherently (processing gain). Now drop N and M and watch it disappear.</>,
          <>Turn on T3 (2 m from T1, same speed). At N = 256 and Δf = 120 kHz (30.7 MHz, ΔR ≈ 4.9 m) they merge. Raise N to 512 and Δf to 480k (ΔR ≈ 0.6 m) to separate them.</>,
          <>Switch from QPSK to 256-QAM with <b>Reciprocal</b> removal at low SNR. The floor rises (noise is boosted on the small inner points). Now try <b>Matched</b>. You get less noise boost but more "data sidelobes" all over the map.</>,
          <>At 28 GHz, push T2 to 120 m/s. With Δf = 15 kHz, ±v_max is only about 37 m/s, so it wraps. Raise Δf: shorter symbols give a larger v_max but a smaller max range. That's your numerology trade-off.</>,
          <>Put T1 at 200 m with Δf = 120k. It's past the CP-limited range (≈ 88 m), so the echo weakens. This matches the "28 GHz, 120 kHz → about 88 m" result we worked out.</>,
        ]}
      />
      <Explain title="Where the formulas come from">
        <ul>
          <li><b>Range resolution c/2B</b>: the IFFT across N subcarriers has range bins spaced 1/(NΔf) in delay. Halve it for the round trip.</li>
          <li><b>Max range c/2Δf</b>: the phase step between subcarriers, 2πΔfτ, wraps after τ = 1/Δf.</li>
          <li><b>Velocity resolution λ/(2MT)</b>: you watch for M symbols. A longer look gives finer Doppler.</li>
          <li><b>Max velocity λ/(4T)</b>: the phase step between symbols, 2πf_D·T, must stay within ±π.</li>
          <li><b>Processing gain N·M</b>: noise adds randomly, but the target's phase ramps add coherently.</li>
          <li><b>Simplifications here</b>: point targets, perfect self-interference cancellation, no clutter or phase noise. The CP and ICI effects use simple approximations. Your project simulator should model these in more detail.</li>
        </ul>
      </Explain>
    </LabLayout>
  );
}
