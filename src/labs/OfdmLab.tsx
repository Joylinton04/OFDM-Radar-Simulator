import { useMemo, useState } from 'react';
import { Heatmap } from '../components/Heatmap';
import { Plot, Series } from '../components/Plot';
import { Card, Choice, Explain, Group, LabLayout, Metric, Metrics, Slider, TryThis, Warn } from '../components/Controls';
import { PROFILES, PROFILE_NAMES } from '../dsp/channels';
import { fft } from '../dsp/fft';
import { MODS, ModName, bitErrors, constellation, demap, paprDb } from '../dsp/modulation';
import { Rng } from '../dsp/random';
import { db, si, undb } from '../dsp/units';

const N_OPTS = [16, 32, 64, 128, 256, 512] as const;
const SCS_OPTS = [15, 30, 60, 120, 240] as const; // kHz, 5G NR numerologies μ = 0..4
const CP_OPTS = ['None', '1/32', '1/16', '1/8', '1/4'] as const;
type CpOpt = (typeof CP_OPTS)[number];
const cpFrac: Record<CpOpt, number> = { None: 0, '1/32': 1 / 32, '1/16': 1 / 16, '1/8': 1 / 8, '1/4': 1 / 4 };
const EQ_OPTS = ['None', 'Pilot (LS estimate)', 'Perfect CSI'] as const;
type EqOpt = (typeof EQ_OPTS)[number];
const M = 14; // OFDM symbols per slot (symbol 0 carries pilots)

const PALETTE = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];

export default function OfdmLab() {
  const [N, setN] = useState<number>(64);
  const [scs, setScs] = useState<number>(30);
  const [cp, setCp] = useState<CpOpt>('1/8');
  const [mod, setMod] = useState<ModName>('16-QAM');
  const [snrDb, setSnrDb] = useState(25);
  const [profile, setProfile] = useState('Urban (vehicular)');
  const [scale, setScale] = useState(1);
  const [eq, setEq] = useState<EqOpt>('Pilot (LS estimate)');
  const [seed, setSeed] = useState(5);

  const df = scs * 1e3;
  const fs = N * df; // sample rate = bandwidth
  const Ts = 1 / fs;
  const T = 1 / df;
  const Ncp = Math.round(cpFrac[cp] * N);
  const Tcp = Ncp * Ts;
  const Ttot = T + Tcp;
  const c = constellation(mod);
  const k = c.k;

  const sim = useMemo(() => {
    const rng = new Rng(seed);
    const prof = PROFILES[profile];
    const pw = prof.p.map(undb);
    const ptot = pw.reduce((a, b) => a + b, 0);
    // Discrete taps at the sample rate
    const tapIdx: number[] = [];
    const tapR: number[] = [];
    const tapI: number[] = [];
    for (let p = 0; p < prof.d.length; p++) {
      const idx = Math.round((prof.d[p] * scale * 1e-6) / Ts);
      const a = Math.sqrt(pw[p] / ptot);
      const ph = profile === 'LOS only' ? 0 : 2 * Math.PI * rng.uniform();
      tapIdx.push(idx);
      tapR.push(a * Math.cos(ph));
      tapI.push(a * Math.sin(ph));
    }
    const maxDelay = Math.max(...prof.d) * scale * 1e-6;

    // True frequency response per subcarrier
    const Hr = new Float64Array(N);
    const Hi = new Float64Array(N);
    for (let kk = 0; kk < N; kk++) {
      for (let p = 0; p < tapIdx.length; p++) {
        const ph = (-2 * Math.PI * kk * tapIdx[p]) / N;
        Hr[kk] += tapR[p] * Math.cos(ph) - tapI[p] * Math.sin(ph);
        Hi[kk] += tapR[p] * Math.sin(ph) + tapI[p] * Math.cos(ph);
      }
    }

    // ---- Transmitter: grid → IFFT → add CP ----
    const pilot = constellation('QPSK');
    const symIdx = new Int32Array(N * M);
    const Xr = new Float64Array(N * M);
    const Xi = new Float64Array(N * M);
    const L = M * (N + Ncp);
    const txR = new Float64Array(L);
    const txI = new Float64Array(L);
    const sq = Math.sqrt(N);
    for (let m = 0; m < M; m++) {
      const re = new Float64Array(N);
      const im = new Float64Array(N);
      for (let kk = 0; kk < N; kk++) {
        let xr: number;
        let xi: number;
        if (m === 0) {
          const s = (kk * 7 + 3) % 4; // known pilot pattern
          xr = pilot.re[s];
          xi = pilot.im[s];
        } else {
          const s = rng.int(1 << k);
          symIdx[m * N + kk] = s;
          xr = c.re[s];
          xi = c.im[s];
        }
        Xr[m * N + kk] = xr;
        Xi[m * N + kk] = xi;
        re[kk] = xr;
        im[kk] = xi;
      }
      fft(re, im, true); // IFFT (includes 1/N)
      const base = m * (N + Ncp);
      for (let n = 0; n < N; n++) {
        txR[base + Ncp + n] = re[n] * sq; // unit average power
        txI[base + Ncp + n] = im[n] * sq;
      }
      for (let n = 0; n < Ncp; n++) {
        txR[base + n] = txR[base + N + n];
        txI[base + n] = txI[base + N + n];
      }
    }
    const papr = paprDb(txR, txI);

    // ---- Channel: multipath convolution + noise ----
    const sigma = Math.sqrt(1 / undb(snrDb) / 2);
    const rxR = new Float64Array(L);
    const rxI = new Float64Array(L);
    for (let n = 0; n < L; n++) {
      let yr = 0;
      let yi = 0;
      for (let p = 0; p < tapIdx.length; p++) {
        const j = n - tapIdx[p];
        if (j < 0) continue;
        yr += tapR[p] * txR[j] - tapI[p] * txI[j];
        yi += tapR[p] * txI[j] + tapI[p] * txR[j];
      }
      rxR[n] = yr + sigma * rng.gauss();
      rxI[n] = yi + sigma * rng.gauss();
    }

    // ---- Receiver: remove CP → FFT ----
    const Yr = new Float64Array(N * M);
    const Yi = new Float64Array(N * M);
    for (let m = 0; m < M; m++) {
      const re = new Float64Array(N);
      const im = new Float64Array(N);
      const base = m * (N + Ncp) + Ncp;
      for (let n = 0; n < N; n++) {
        re[n] = rxR[base + n];
        im[n] = rxI[base + n];
      }
      fft(re, im);
      for (let kk = 0; kk < N; kk++) {
        Yr[m * N + kk] = re[kk] / sq;
        Yi[m * N + kk] = im[kk] / sq;
      }
    }

    // Channel estimate from pilot symbol (least squares: Ĥ = Y / X)
    const Er = new Float64Array(N);
    const Ei = new Float64Array(N);
    for (let kk = 0; kk < N; kk++) {
      const yr = Yr[kk];
      const yi = Yi[kk];
      const xr = Xr[kk];
      const xi = Xi[kk];
      const d = xr * xr + xi * xi;
      Er[kk] = (yr * xr + yi * xi) / d;
      Ei[kk] = (yi * xr - yr * xi) / d;
    }

    // Equalise data symbols, decide, count errors
    let errs = 0;
    let evm = 0;
    const cx: number[] = [];
    const cy: number[] = [];
    for (let m = 1; m < M; m++) {
      for (let kk = 0; kk < N; kk++) {
        let yr = Yr[m * N + kk];
        let yi = Yi[m * N + kk];
        let hr = 1;
        let hi = 0;
        if (eq === 'Perfect CSI') {
          hr = Hr[kk];
          hi = Hi[kk];
        } else if (eq === 'Pilot (LS estimate)') {
          hr = Er[kk];
          hi = Ei[kk];
        }
        const d = hr * hr + hi * hi || 1e-12;
        const zr = (yr * hr + yi * hi) / d;
        const zi = (yi * hr - yr * hi) / d;
        yr = zr;
        yi = zi;
        const s = symIdx[m * N + kk];
        errs += bitErrors(s, demap(c, yr, yi));
        evm += (yr - c.re[s]) ** 2 + (yi - c.im[s]) ** 2;
        if (cx.length < 4000) {
          cx.push(yr);
          cy.push(yi);
        }
      }
    }
    const nData = (M - 1) * N;
    const ber = errs / (nData * k);
    const evmRms = Math.sqrt(evm / nData);

    // ---- Plots ----
    // Subcarrier spectra (8 neighbouring subcarriers)
    const nShowSc = 8;
    const sub: Series[] = [];
    const fx: number[] = [];
    for (let i = 0; i <= 800; i++) fx.push(-2 + (i / 800) * (nShowSc + 3));
    for (let s = 0; s < nShowSc; s++) {
      const y = fx.map((f) => {
        const u = f - s;
        return Math.abs(u) < 1e-9 ? 1 : Math.sin(Math.PI * u) / (Math.PI * u);
      });
      sub.push({ x: fx.map((f) => f * scs), y, color: PALETTE[s % PALETTE.length], width: 1.6 });
    }
    const centres = Array.from({ length: nShowSc }, (_, s) => s * scs);
    sub.push({ x: centres, y: centres.map(() => 1), mode: 'scatter', size: 4, color: 'var(--text)' });

    // Time-domain signal: first two symbols
    const nT = 2 * (N + Ncp);
    const os = 4; // simple linear interpolation for a smoother line
    const tt: number[] = [];
    const tr: number[] = [];
    const ta: number[] = [];
    for (let n = 0; n < nT - 1; n++) {
      for (let q = 0; q < os; q++) {
        const f = q / os;
        tt.push(((n + f) * Ts) * 1e6);
        const r = txR[n] * (1 - f) + txR[n + 1] * f;
        const i = txI[n] * (1 - f) + txI[n + 1] * f;
        tr.push(r);
        ta.push(Math.hypot(r, i));
      }
    }

    // Received grid magnitude in dB (rows = subcarriers, cols = symbols)
    const grid = new Float64Array(N * M);
    for (let kk = 0; kk < N; kk++) {
      for (let m = 0; m < M; m++) {
        grid[kk * M + m] = db(Yr[m * N + kk] ** 2 + Yi[m * N + kk] ** 2);
      }
    }

    const scIdx = Array.from({ length: N }, (_, i) => i);
    const hTrue = scIdx.map((i) => db(Hr[i] ** 2 + Hi[i] ** 2));
    const hEst = scIdx.map((i) => db(Er[i] ** 2 + Ei[i] ** 2));

    return {
      papr,
      ber,
      errs,
      nBits: nData * k,
      evmRms,
      maxDelay,
      sub,
      tt,
      tr,
      ta,
      grid,
      hTrue,
      hEst,
      scIdx,
      cons: [
        { x: cx, y: cy, mode: 'scatter' as const, color: 'var(--s2)', size: 1.5, alpha: 0.55 },
        { x: Array.from(c.re), y: Array.from(c.im), mode: 'scatter' as const, color: 'var(--s3)', size: 3.2 },
      ],
    };
  }, [N, scs, Ncp, Ts, mod, c, k, snrDb, profile, scale, eq, seed]);

  const B = N * df;
  const cpOk = sim.maxDelay <= Tcp + 1e-12;
  const dataRate = ((M - 1) / M) * ((N * k) / Ttot);
  const cpOverhead = Ncp / (N + Ncp);
  const lim = mod === 'BPSK' ? 2 : 1.7;

  const controls = (
    <>
      <Group title="Frequency resources">
        <Choice label="Subcarriers N" value={N} options={N_OPTS} onChange={(v) => setN(v)} hint="How many parallel narrow channels." />
        <Choice label="Spacing Δf" value={scs} options={SCS_OPTS} onChange={(v) => setScs(v)} format={(v) => `${v} kHz`} hint="5G numerology: Δf = 15·2^μ kHz. Larger Δf = shorter symbols." />
      </Group>
      <Group title="Time resources">
        <Choice label="Cyclic prefix" value={cp} options={CP_OPTS} onChange={setCp} hint="Fraction of the symbol. Guard time against echoes. 5G normal CP ≈ 1/14." />
      </Group>
      <Group title="Data">
        <Choice label="Modulation" hint="Modulation on every subcarrier." value={mod} options={MODS} onChange={setMod} />
      </Group>
      <Group title="Channel">
        <Choice label="Profile" value={profile} options={PROFILE_NAMES} onChange={setProfile} />
        <Slider label="Stretch delays ×" value={scale} onChange={setScale} min={0.1} max={10} log format={(v) => `${v}× (max ${si(Math.max(...PROFILES[profile].d) * v * 1e-6, 's')})`} />
        <Slider label="SNR" value={snrDb} onChange={setSnrDb} min={0} max={45} step={0.5} format={(v) => `${v} dB`} />
        <button className="btn" onClick={() => setSeed(seed + 1)}>New channel + data</button>
      </Group>
      <Group title="Receiver">
        <Choice label="Equaliser" value={eq} options={EQ_OPTS} onChange={setEq} hint="Pilot: symbol 0 carries known QPSK pilots, used to estimate H." />
      </Group>
    </>
  );

  return (
    <LabLayout controls={controls}>
      <div className="lab-intro">
        <h2>OFDM: many slow subcarriers instead of one fast carrier</h2>
        <p>
          OFDM splits the bandwidth B into <b>N subcarriers</b> spaced <b>Δf</b> apart. Each carries one QAM symbol per OFDM
          symbol, lasting T = 1/Δf. Those long symbols, plus a <b>cyclic prefix</b> (a copy of the symbol's tail placed in front),
          make multipath harmless. Each subcarrier just gets multiplied by one complex number H[k], which a "one-tap" equaliser
          removes.
        </p>
        <div className="chain">
          <span>QAM symbols on N×{M} grid</span>→<span>IFFT</span>→<span>Add CP</span>→<span className="ch">Multipath + noise</span>→
          <span>Remove CP</span>→<span>FFT</span>→<span>Divide by Ĥ[k]</span>→<span>Decide</span>
        </div>
      </div>
      <Metrics>
        <Metric label="Bandwidth B = N·Δf" value={si(B, 'Hz')} />
        <Metric label="Symbol time T = 1/Δf" value={si(T, 's')} />
        <Metric label="CP length" value={si(Tcp, 's')} sub={`${Ncp} samples`} tone={cpOk ? 'good' : 'bad'} />
        <Metric label="Max echo delay" value={si(sim.maxDelay, 's')} sub={cpOk ? 'inside CP ✓' : 'longer than CP ✗'} tone={cpOk ? 'good' : 'bad'} />
        <Metric label="CP overhead" value={`${(cpOverhead * 100).toFixed(1)} %`} hint="Time spent on the guard instead of data." />
        <Metric label="Data rate" value={si(dataRate, 'bit/s')} sub={`${((dataRate / B)).toFixed(2)} bit/s/Hz`} hint="Excludes the pilot symbol and CP." />
        <Metric label="Measured BER" value={sim.ber === 0 ? `< ${(1 / sim.nBits).toExponential(0)}` : sim.ber.toExponential(2)} sub={`${sim.errs} / ${sim.nBits} bits`} tone={sim.ber < 1e-3 ? 'good' : sim.ber < 3e-2 ? 'warn' : 'bad'} />
        <Metric label="EVM" value={`${(sim.evmRms * 100).toFixed(1)} %`} sub={`≈ ${(-db(sim.evmRms ** 2)).toFixed(1)} dB effective SNR`} />
        <Metric label="PAPR" value={`${sim.papr.toFixed(1)} dB`} hint="Peak-to-average power. OFDM has high peaks, so amplifiers need headroom." />
      </Metrics>
      {!cpOk && (
        <Warn tone="bad">Echoes last longer than the cyclic prefix. Part of the previous symbol leaks into the FFT window (ISI), and subcarriers stop being orthogonal (ICI). The constellation becomes a cloud even at high SNR. Fix: a longer CP or a smaller Δf.</Warn>
      )}
      {eq === 'None' && <Warn tone="info">With no equaliser, every subcarrier is rotated and scaled by H[k], so the constellation smears into rings.</Warn>}

      <div className="grid2">
        <Card title="Subcarrier spectra: overlapping but orthogonal">
          <Plot series={sim.sub} xLabel="Frequency (kHz)" yLabel="Amplitude" height={240} legend={false} hLines={[{ v: 0, dash: [2, 2] }]} />
          <p className="caption">At each subcarrier's centre (black dot) every other subcarrier passes through zero, so they don't interfere.</p>
        </Card>
        <Card title="Time-domain OFDM signal (2 symbols)">
          <Plot
            series={[
              { x: sim.tt, y: sim.ta, label: '|x(t)| envelope', color: 'var(--s4)', width: 1.2, alpha: 0.8 },
              { x: sim.tt, y: sim.tr, label: 'Re{x(t)}', color: 'var(--s1)', width: 1.3 },
            ]}
            bands={Ncp ? [{ x0: 0, x1: Tcp * 1e6, label: 'CP' }, { x0: Ttot * 1e6, x1: (Ttot + Tcp) * 1e6, label: 'CP' }] : []}
            vLines={[{ v: Ttot * 1e6, dash: [2, 3] }]}
            xLabel="Time (µs)"
            yLabel="Amplitude"
            height={240}
          />
          <p className="caption">The sum of N sinusoids looks like noise and has big peaks (high PAPR).</p>
        </Card>
      </div>
      <div className="grid2">
        <Card title="Resource grid: received power |Y[k, m]|">
          <Heatmap
            data={sim.grid}
            rows={N}
            cols={M}
            xRange={[0, M]}
            yRange={[0, N]}
            zRange={[-25, 8]}
            xLabel="OFDM symbol m"
            yLabel="Subcarrier k"
            zLabel="dB"
            height={260}
          />
          <p className="caption">Horizontal stripes are frequency-selective fading. Symbol 0 holds the pilots.</p>
        </Card>
        <Card title="Equalised constellation (all data subcarriers)">
          <Plot series={sim.cons} xLabel="I" yLabel="Q" square xLim={[-lim, lim]} yLim={[-lim, lim]} height={260} legend={false} />
        </Card>
      </div>
      <Card title="Channel per subcarrier: true |H[k]| vs pilot estimate |Ĥ[k]|">
        <Plot
          series={[
            { x: sim.scIdx, y: sim.hEst, label: 'Estimate from pilots', color: 'var(--s2)', mode: 'scatter', size: 2.2 },
            { x: sim.scIdx, y: sim.hTrue, label: 'True channel', color: 'var(--s1)', width: 2 },
          ]}
          xLabel="Subcarrier index k"
          yLabel="Gain (dB)"
          height={220}
        />
      </Card>
      <TryThis
        items={[
          <>Hilly profile with stretch 1× (5 µs echoes). Δf = 30 kHz with CP 1/16 (2.1 µs) breaks. CP 1/8 (4.2 µs) still breaks. CP 1/4 (8.3 µs) works.</>,
          <>Now keep CP 1/16 and lower Δf to 15 kHz. The symbols get longer, so the same fraction gives a longer CP (4.2 µs, almost enough), but you get half the bandwidth. That's the numerology trade-off in your project.</>,
          <>Set the equaliser to <b>None</b>. The constellation is scrambled. Switch to Pilot. One complex division per subcarrier fixes it.</>,
          <>Lower SNR to 10 dB with the pilot equaliser. The estimate gets noisy (orange dots), so the data gets worse too. That's why channel estimation quality matters.</>,
          <>Raise N with the other settings fixed. Bandwidth and data rate grow, and PAPR also tends to rise.</>,
          <>Compare <b>LOS only</b> with <b>Urban</b> using Perfect CSI. Even with a long enough CP, Urban still has bit errors. A few subcarriers sit in deep fades (the dips in |H[k]|) where the SNR is very low. Real systems spread coded bits across many subcarriers so a few bad ones can be corrected.</>,
        ]}
      />
      <Explain title="Time, frequency, and the resource grid">
        <p>
          OFDM resources form a 2-D grid: <b>frequency</b> (N subcarriers × Δf) and <b>time</b> (OFDM symbols of length T + T_CP).
          Each cell (a "resource element") carries one QAM symbol. The scheduler gives users or pilots blocks of this grid. In 5G a
          slot is 14 symbols. Notice the trade-off: a larger Δf gives a shorter T, which tolerates Doppler better but gives a shorter
          CP, so less tolerance to long echoes. For OFDM radar, the same grid becomes the sensing measurement (next lab).
        </p>
      </Explain>
    </LabLayout>
  );
}
