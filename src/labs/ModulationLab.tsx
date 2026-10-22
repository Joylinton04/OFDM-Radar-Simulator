import { useMemo, useState } from 'react';
import { Plot, Series } from '../components/Plot';
import { Card, Choice, Explain, Group, LabLayout, Metric, Metrics, Slider, Toggle, TryThis } from '../components/Controls';
import { fft } from '../dsp/fft';
import { convolve, rrc } from '../dsp/filters';
import { MODS, ModName, bitErrors, constellation, demap, theoreticalBer } from '../dsp/modulation';
import { Rng } from '../dsp/random';
import { db, si, undb } from '../dsp/units';

const SPAN = 4; // RRC filter span (symbols either side)
const N_WAVE = 192; // symbols simulated as a full waveform (for plots/spectrum)
const N_BER = 20000; // symbols simulated at symbol level for BER

function welch(x: Float64Array, fs: number, seg = 1024): { f: number[]; p: number[] } {
  const hop = seg / 2;
  const acc = new Float64Array(seg / 2 + 1);
  const w = new Float64Array(seg);
  for (let i = 0; i < seg; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (seg - 1));
  let count = 0;
  for (let s = 0; s + seg <= x.length; s += hop) {
    const re = new Float64Array(seg);
    const im = new Float64Array(seg);
    for (let i = 0; i < seg; i++) re[i] = x[s + i] * w[i];
    fft(re, im);
    for (let k = 0; k <= seg / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    count++;
  }
  const f: number[] = [];
  const p: number[] = [];
  let peak = 0;
  for (let k = 0; k <= seg / 2; k++) peak = Math.max(peak, acc[k]);
  for (let k = 0; k <= seg / 2; k++) {
    f.push((k * fs) / seg);
    p.push(db(acc[k] / Math.max(peak, 1e-300) + 1e-12));
  }
  void count;
  return { f, p };
}

export default function ModulationLab() {
  const [mod, setMod] = useState<ModName>('QPSK');
  const [rsK, setRsK] = useState(10); // symbol rate in kBd
  const [alpha, setAlpha] = useState(0.35);
  const [fcK, setFcK] = useState(60); // carrier in kHz
  const [ebn0, setEbn0] = useState(12);
  const [noiseOn, setNoiseOn] = useState(true);
  const [seed, setSeed] = useState(7);

  const c = constellation(mod);
  const k = c.k;
  const Rs = rsK * 1000;
  // Keep the simulation sample rate manageable: carrier at most 15 × symbol rate.
  const fcMaxK = Math.min(200, 15 * rsK);
  const fcEffK = Math.min(fcK, fcMaxK);
  const fc = fcEffK * 1000;
  const occBw = Rs * (1 + alpha);
  const carrierOk = fc > occBw / 2;

  const sim = useMemo(() => {
    const rng = new Rng(seed);
    const ebn0Lin = undb(ebn0);
    const n0 = noiseOn ? 1 / (k * ebn0Lin) : 0; // Es = 1
    const sigma = Math.sqrt(n0 / 2);

    // ---------- Waveform simulation (what you see) ----------
    const sps = Math.min(64, Math.max(8, Math.ceil((4 * (fc + occBw / 2)) / Rs)));
    const fs = sps * Rs;
    const h = rrc(alpha, sps, SPAN);
    const syms = new Int32Array(N_WAVE);
    for (let i = 0; i < N_WAVE; i++) syms[i] = rng.int(1 << k);
    const upI = new Float64Array(N_WAVE * sps);
    const upQ = new Float64Array(N_WAVE * sps);
    for (let i = 0; i < N_WAVE; i++) {
      upI[i * sps] = c.re[syms[i]];
      upQ[i * sps] = c.im[syms[i]];
    }
    const bI = convolve(upI, h);
    const bQ = convolve(upQ, h);
    const L = bI.length;
    // Add complex baseband noise (equivalent to noise added on the air), per-sample var n0.
    const rI = new Float64Array(L);
    const rQ = new Float64Array(L);
    for (let i = 0; i < L; i++) {
      rI[i] = bI[i] + sigma * rng.gauss();
      rQ[i] = bQ[i] + sigma * rng.gauss();
    }
    // Passband (real RF signal): s(t) = I cos(2πfct) − Q sin(2πfct)
    const tx = new Float64Array(L);
    const rx = new Float64Array(L);
    for (let i = 0; i < L; i++) {
      const w = (2 * Math.PI * fc * i) / fs;
      const cw = Math.cos(w);
      const sw = Math.sin(w);
      tx[i] = bI[i] * cw - bQ[i] * sw;
      rx[i] = rI[i] * cw - rQ[i] * sw;
    }
    // Receiver matched filter
    const mI = convolve(rI, h);
    const delay = 2 * SPAN * sps; // total filter delay

    // Plot windows
    const showSym = 10;
    const off = SPAN * sps + 4 * sps; // skip filter start-up
    const nShow = showSym * sps;
    const step = Math.max(1, Math.floor(nShow / 1200));
    const tt: number[] = [];
    const iBase: number[] = [];
    const pTx: number[] = [];
    const pRx: number[] = [];
    const g = Math.sqrt(sps); // undo unit-energy filter scaling so amplitudes match symbol values
    for (let i = 0; i < nShow; i += step) {
      tt.push(((i / fs) * 1000));
      iBase.push(bI[off + i] * g);
      pTx.push(tx[off + i] * g);
      pRx.push(rx[off + i] * g);
    }
    const symT: number[] = [];
    const symV: number[] = [];
    for (let s = 0; s < showSym; s++) {
      const idx = off + s * sps;
      const sIdx = (idx - SPAN * sps) / sps;
      if (Number.isInteger(sIdx) && sIdx >= 0 && sIdx < N_WAVE) {
        symT.push(((s * sps) / fs) * 1000);
        symV.push(c.re[syms[sIdx]]);
      }
    }

    // Eye diagram from matched-filter output (I branch), two symbols per trace
    const eye: Series[] = [];
    const eyeLen = 2 * sps;
    for (let s = 8; s < Math.min(N_WAVE - 8, 70); s++) {
      const halfS = Math.floor(sps / 2);
      const start = delay + s * sps - halfS;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i <= eyeLen; i++) {
        xs.push((i - halfS) / sps);
        ys.push(mI[start + i]);
      }
      eye.push({ x: xs, y: ys, color: 'var(--s1)', width: 1, alpha: 0.35 });
    }

    const spec = welch(rx.subarray(SPAN * sps, L - SPAN * sps), fs, 1024);
    const specTx = welch(tx.subarray(SPAN * sps, L - SPAN * sps), fs, 1024);

    // ---------- Symbol-level simulation (for BER and constellation) ----------
    let errs = 0;
    let evmNum = 0;
    const cx: number[] = [];
    const cy: number[] = [];
    for (let i = 0; i < N_BER; i++) {
      const s = rng.int(1 << k);
      const yr = c.re[s] + sigma * rng.gauss();
      const yi = c.im[s] + sigma * rng.gauss();
      const d = demap(c, yr, yi);
      errs += bitErrors(s, d);
      evmNum += (yr - c.re[s]) ** 2 + (yi - c.im[s]) ** 2;
      if (i < 2500) {
        cx.push(yr);
        cy.push(yi);
      }
    }
    const ber = errs / (N_BER * k);
    const evm = Math.sqrt(evmNum / N_BER); // Es = 1

    const firstBits = Array.from(syms.subarray(0, 6)).map((s) => s.toString(2).padStart(k, '0'));

    return {
      fs,
      sps,
      baseband: [
        { x: tt, y: iBase, label: 'I(t): shaped symbols', color: 'var(--s1)', width: 1.8 },
        { x: symT, y: symV, label: 'symbol values', color: 'var(--s3)', mode: 'stem' as const, size: 3 },
      ],
      passband: [
        { x: tt, y: pRx, label: 'Received (with noise)', color: 'var(--s2)', width: 1, alpha: 0.75 },
        { x: tt, y: pTx, label: 'Transmitted RF signal', color: 'var(--s1)', width: 1.4 },
      ],
      spec: [
        { x: spec.f.map((v) => v / 1000), y: spec.p, label: 'Received', color: 'var(--s2)', width: 1.2, alpha: 0.8 },
        { x: specTx.f.map((v) => v / 1000), y: specTx.p, label: 'Transmitted', color: 'var(--s1)', width: 1.6 },
      ],
      eye,
      cons: [
        { x: cx, y: cy, mode: 'scatter' as const, color: 'var(--s2)', size: 1.4, alpha: 0.5 },
        { x: Array.from(c.re), y: Array.from(c.im), mode: 'scatter' as const, color: 'var(--s3)', size: 3.2 },
      ],
      ber,
      errs,
      evm,
      firstBits,
      firstSyms: Array.from(syms.subarray(0, 6)).map((s) => [c.re[s], c.im[s]]),
    };
  }, [mod, k, c, Rs, fc, occBw, alpha, ebn0, noiseOn, seed]);

  const Rb = Rs * k;
  const se = Rb / occBw;
  const snrDb = ebn0 + db(Rb / occBw);
  const capacity = occBw * Math.log2(1 + undb(snrDb));
  const berTh = theoreticalBer(mod, undb(ebn0));
  const lim = mod === 'BPSK' ? 2 : 1.6;

  const controls = (
    <>
      <Group title="1 · Bits → symbols (modulation)">
        <Choice label="Modulation" value={mod} options={MODS} onChange={setMod} hint={`${k} bit${k > 1 ? 's' : ''} per symbol · ${1 << k} constellation points`} />
      </Group>
      <Group title="2 · Symbols → waveform">
        <Slider label="Symbol rate Rs" value={rsK} onChange={setRsK} min={1} max={40} step={1} format={(v) => si(v * 1000, 'Bd')} hint="Symbols sent per second (baud)." />
        <Slider label="Roll-off α" value={alpha} onChange={setAlpha} min={0} max={1} step={0.05} format={(v) => v.toFixed(2)} hint="Pulse-shaping excess bandwidth. 0 = tightest spectrum, 1 = easiest timing." />
      </Group>
      <Group title="3 · Waveform → radio (carrier)">
        <Slider label="Carrier frequency fc" value={fcEffK} onChange={setFcK} min={5} max={fcMaxK} step={1} format={(v) => si(v * 1000, 'Hz')} hint="Real radios use MHz–GHz; scaled down here so you can see the wave." />
      </Group>
      <Group title="4 · Channel noise">
        <Toggle label="Add noise" value={noiseOn} onChange={setNoiseOn} />
        <Slider label="Eb/N0" value={ebn0} onChange={setEbn0} min={-2} max={30} step={0.5} format={(v) => `${v.toFixed(1)} dB`} hint="Energy per bit vs noise density: the fair way to compare modulations." />
        <button className="btn" onClick={() => setSeed(seed + 1)}>New random data</button>
      </Group>
    </>
  );

  return (
    <LabLayout controls={controls}>
      <div className="lab-intro">
        <h2>Modulation &amp; Transmission</h2>
        <p>
          How do bits actually become a radio wave? Follow the chain left to right. Each stage below has its own plot.
        </p>
        <div className="chain">
          <span>Bits</span>→<span>Mapper ({mod})</span>→<span>Pulse shaping (RRC, α={alpha.toFixed(2)})</span>→
          <span>Mixer × cos(2π·{fcEffK}k·t)</span>→<span className="ch">Channel + noise</span>→<span>Mixer</span>→
          <span>Matched filter</span>→<span>Decision</span>→<span>Bits</span>
        </div>
        <div className="bits">
          First symbols:{' '}
          {sim.firstBits.map((b, i) => (
            <code key={i}>
              {b} → ({sim.firstSyms[i][0].toFixed(2)}, {sim.firstSyms[i][1].toFixed(2)})
            </code>
          ))}
        </div>
      </div>

      <Metrics>
        <Metric label="Bit rate" value={si(Rb, 'bit/s')} sub={`= Rs × ${k}`} />
        <Metric label="Occupied bandwidth" value={si(occBw, 'Hz')} sub="= Rs × (1 + α)" />
        <Metric label="Spectral efficiency" value={`${se.toFixed(2)} bit/s/Hz`} />
        <Metric label="SNR in that bandwidth" value={`${snrDb.toFixed(1)} dB`} hint="SNR = Eb/N0 × (bit rate / bandwidth)" />
        <Metric label="Measured BER" value={noiseOn ? (sim.ber === 0 ? `< ${(1 / (N_BER * k)).toExponential(0)}` : sim.ber.toExponential(2)) : '0'} sub={`${sim.errs} errors / ${N_BER * k} bits`} tone={sim.ber < 1e-4 ? 'good' : sim.ber < 1e-2 ? 'warn' : 'bad'} />
        <Metric label="Theory BER" value={noiseOn ? berTh.toExponential(2) : '0'} />
        <Metric label="EVM" value={`${(sim.evm * 100).toFixed(1)} %`} hint="Average distance of received points from the ideal ones." />
        <Metric label="Shannon limit in B" value={si(capacity, 'bit/s')} sub={Rb > capacity ? 'bit rate exceeds limit!' : `you use ${((Rb / capacity) * 100).toFixed(0)}%`} tone={Rb > capacity ? 'bad' : undefined} />
      </Metrics>

      {!carrierOk && (
        <div className="warn bad">The carrier is lower than half the signal bandwidth, so the spectrum folds over 0 Hz. Raise fc or lower Rs.</div>
      )}

      <div className="grid2">
        <Card title="② Baseband: symbols shaped into a smooth waveform (I branch)">
          <Plot series={sim.baseband} xLabel="Time (ms)" yLabel="Amplitude" height={230} />
        </Card>
        <Card title="③ RF: waveform riding on the carrier">
          <Plot series={sim.passband} xLabel="Time (ms)" yLabel="Amplitude" height={230} />
        </Card>
      </div>
      <Card title="Spectrum of the RF signal: it sits around fc and is Rs(1+α) wide">
        <Plot
          series={sim.spec}
          xLabel="Frequency (kHz)"
          yLabel="Power (dB)"
          yLim={[-60, 3]}
          xLim={[0, Math.min(sim.fs / 2000, fcEffK + Math.max(rsK * 3, 20))]}
          bands={[{ x0: fcEffK - (occBw / 2000), x1: fcEffK + occBw / 2000, label: 'occupied bandwidth' }]}
          vLines={[{ v: fcEffK, label: 'fc', color: 'var(--s4)' }]}
          height={240}
        />
      </Card>
      <div className="grid2">
        <Card title="⑦ Eye diagram after matched filter">
          <Plot series={sim.eye} xLabel="Time (symbol periods)" yLabel="Amplitude" height={260} legend={false} vLines={[{ v: 0, label: 'sample here' }]} />
        </Card>
        <Card title="⑧ Received constellation (decision space)">
          <Plot series={sim.cons} xLabel="In-phase (I)" yLabel="Quadrature (Q)" height={260} square xLim={[-lim, lim]} yLim={[-lim, lim]} legend={false} />
        </Card>
      </div>

      <TryThis
        items={[
          <>Raise the modulation from QPSK to 64-QAM at Eb/N0 = 12 dB. The bit rate triples in the <b>same bandwidth</b>, but the points crowd together and BER goes up.</>,
          <>Slide <b>α</b> from 0 to 1. The spectrum widens (more bandwidth used) but the eye opens wider (less sensitive to timing errors).</>,
          <>Double <b>Rs</b>. Both the bit rate and the occupied bandwidth double. Spectral efficiency (bit/s/Hz) stays the same.</>,
          <>Lower Eb/N0 until the eye closes. That's the point where the receiver starts making mistakes.</>,
          <>Move <b>fc</b>. The spectrum shifts but keeps its shape. The carrier only decides <i>where</i> in the spectrum the signal sits.</>,
        ]}
      />

      <Explain title="How does a waveform get transmitted?">
        <ol>
          <li><b>Mapping:</b> groups of k bits pick one point in the constellation. The point is a complex number I + jQ: an amplitude and a phase.</li>
          <li><b>Pulse shaping:</b> each symbol is turned into a smooth pulse (root-raised-cosine). Sharp jumps would need infinite bandwidth (see the Signals lab).</li>
          <li><b>Up-conversion:</b> I(t) multiplies a cosine and Q(t) multiplies a sine at the carrier fc. This moves the signal up to radio frequency so an antenna can radiate it. Antennas need to be about λ/2 in size, so higher fc means smaller antennas.</li>
          <li><b>Channel:</b> the wave travels through the air. It gets weaker (path loss), arrives by several paths (multipath) and picks up noise. See the Channel lab.</li>
          <li><b>Receiver:</b> it multiplies by the carrier again to bring the signal back to 0 Hz, applies a matched filter (the same RRC pulse) to maximise SNR, samples once per symbol at the eye's widest point, and picks the nearest constellation point.</li>
        </ol>
      </Explain>
    </LabLayout>
  );
}
