import { useMemo, useState } from 'react';
import { Plot } from '../components/Plot';
import { Card, Choice, Explain, Group, LabIntro, LabLayout, Metric, Metrics, Slider, Toggle, TryThis } from '../components/Controls';
import { fft } from '../dsp/fft';
import { Rng } from '../dsp/random';
import { C, db, si } from '../dsp/units';

const FS = 200_000; // simulation sample rate (Hz)
const N = 8192; // samples in the simulated window (~41 ms)

type SigKind = 'Square wave' | 'Single pulse' | 'Data bits' | 'Two tones';
const KINDS: SigKind[] = ['Square wave', 'Single pulse', 'Data bits', 'Two tones'];
type FilterKind = 'Ideal' | 'RC (gentle)';

function makeSignal(kind: SigKind, f0: number, pulseMs: number, bitRate: number, seed: number): Float64Array {
  const x = new Float64Array(N);
  const rng = new Rng(seed);
  if (kind === 'Square wave') {
    for (let i = 0; i < N; i++) {
      const ph = ((i / FS) * f0) % 1;
      x[i] = ph < 0.5 ? 1 : -1;
    }
  } else if (kind === 'Single pulse') {
    const w = Math.max(1, Math.round((pulseMs / 1000) * FS));
    const start = Math.round(N / 2 - w / 2);
    for (let i = start; i < start + w && i < N; i++) x[i] = 1;
  } else if (kind === 'Data bits') {
    const spb = FS / bitRate;
    let bit = 0;
    for (let i = 0; i < N; i++) {
      const b = Math.floor(i / spb);
      if (b !== bit || i === 0) {
        bit = b;
        x[i] = rng.uniform() < 0.5 ? -1 : 1;
      } else x[i] = x[i - 1];
    }
  } else {
    for (let i = 0; i < N; i++) {
      const t = i / FS;
      x[i] = 0.7 * Math.sin(2 * Math.PI * f0 * t) + 0.5 * Math.sin(2 * Math.PI * 7.3 * f0 * t);
    }
  }
  return x;
}

export default function SignalsLab() {
  const [kind, setKind] = useState<SigKind>('Square wave');
  const [f0, setF0] = useState(1000);
  const [pulseMs, setPulseMs] = useState(0.5);
  const [bitRate, setBitRate] = useState(4000);
  const [bw, setBw] = useState(8000);
  const [filter, setFilter] = useState<FilterKind>('Ideal');
  const [showDb, setShowDb] = useState(true);
  const [seed, setSeed] = useState(1);

  const sim = useMemo(() => {
    const x = makeSignal(kind, f0, pulseMs, bitRate, seed);

    // Go to the frequency domain, apply the channel's bandwidth limit, come back.
    const re = Float64Array.from(x);
    const im = new Float64Array(N);
    fft(re, im);
    const H = new Float64Array(N);
    const pIn = new Float64Array(N / 2 + 1);
    const pOut = new Float64Array(N / 2 + 1);
    const f = new Float64Array(N / 2 + 1);
    for (let k = 0; k < N; k++) {
      const fk = (k <= N / 2 ? k : k - N) * (FS / N);
      const af = Math.abs(fk);
      let hr = 1;
      let hi = 0;
      if (filter === 'Ideal') {
        hr = af <= bw ? 1 : 0;
      } else {
        // first-order RC low-pass: H = 1 / (1 + j f/B)
        const r = fk / bw;
        const d = 1 + r * r;
        hr = 1 / d;
        hi = -r / d;
      }
      H[k] = Math.hypot(hr, hi);
      const a = re[k];
      const b = im[k];
      if (k <= N / 2) {
        f[k] = fk;
        pIn[k] = (a * a + b * b) / (N * N);
      }
      re[k] = a * hr - b * hi;
      im[k] = a * hi + b * hr;
      if (k <= N / 2) pOut[k] = (re[k] * re[k] + im[k] * im[k]) / (N * N);
    }
    fft(re, im, true);
    const y = re;

    // Energy and distortion
    let eIn = 0;
    let eOut = 0;
    let err = 0;
    for (let i = 0; i < N; i++) {
      eIn += x[i] * x[i];
      eOut += y[i] * y[i];
      err += (x[i] - y[i]) ** 2;
    }

    // 99 % power bandwidth of the original signal
    let tot = 0;
    for (let k = 0; k <= N / 2; k++) tot += pIn[k] * (k === 0 || k === N / 2 ? 1 : 2);
    let cum = 0;
    let b99 = FS / 2;
    for (let k = 0; k <= N / 2; k++) {
      cum += pIn[k] * (k === 0 || k === N / 2 ? 1 : 2);
      if (cum >= 0.99 * tot) {
        b99 = f[k];
        break;
      }
    }

    // Time axis window to show
    let span: number;
    let t0: number;
    if (kind === 'Square wave' || kind === 'Two tones') {
      span = Math.min(N / FS / 2, 4 / f0);
      t0 = N / FS / 4;
    } else if (kind === 'Single pulse') {
      span = Math.min(N / FS, Math.max(6 * (pulseMs / 1000), 2e-3));
      t0 = N / FS / 2 - span / 2;
    } else {
      span = Math.min(N / FS / 2, 16 / bitRate);
      t0 = N / FS / 4;
    }
    const i0 = Math.floor(t0 * FS);
    const i1 = Math.min(N, Math.ceil((t0 + span) * FS));
    const step = Math.max(1, Math.floor((i1 - i0) / 1500));
    const tt: number[] = [];
    const xx: number[] = [];
    const yy: number[] = [];
    for (let i = i0; i < i1; i += step) {
      tt.push(((i - i0) / FS) * 1000);
      xx.push(x[i]);
      yy.push(y[i]);
    }

    // Spectrum (show up to a sensible max frequency)
    const fMax = Math.min(FS / 2, Math.max(bw * 3, b99 * 1.5, 5000));
    const kMax = Math.ceil((fMax / FS) * N);
    const fk: number[] = [];
    const sIn: number[] = [];
    const sOut: number[] = [];
    const sH: number[] = [];
    const peak = Math.max(...Array.from(pIn.subarray(0, kMax)));
    for (let k = 0; k <= kMax; k++) {
      fk.push(f[k] / 1000);
      if (showDb) {
        sIn.push(db(pIn[k] / peak));
        sOut.push(db(pOut[k] / peak));
        sH.push(20 * Math.log10(Math.max(H[k], 1e-6)));
      } else {
        sIn.push(Math.sqrt(pIn[k] / peak));
        sOut.push(Math.sqrt(pOut[k] / peak));
        sH.push(H[k]);
      }
    }

    return {
      time: [
        { x: tt, y: xx, label: 'Sent (input)', color: 'var(--s2)', width: 1.4 },
        { x: tt, y: yy, label: 'Received (after bandwidth limit)', color: 'var(--s1)', width: 2 },
      ],
      spec: [
        { x: fk, y: sIn, label: 'Input spectrum', color: 'var(--s2)', width: 1.2, alpha: 0.8 },
        { x: fk, y: sOut, label: 'Output spectrum', color: 'var(--s1)', width: 1.6 },
        { x: fk, y: sH, label: 'Channel |H(f)|', color: 'var(--s4)', width: 1.4, dash: [5, 4] },
      ],
      kept: eOut / eIn,
      nmse: err / eIn,
      b99,
      fMaxK: fMax / 1000,
    };
  }, [kind, f0, pulseMs, bitRate, bw, filter, showDb, seed]);

  const harmonics = kind === 'Square wave' ? Math.floor((bw / f0 + 1) / 2) : 0;
  const riseTime = filter === 'Ideal' ? 0.45 / bw : 0.35 / bw;
  const nyquistRate = 2 * bw;
  const bitsOk = kind !== 'Data bits' || bitRate <= nyquistRate;

  const controls = (
    <>
      <Group title="1 · Pick a signal to send">
        <Choice label="Signal" value={kind} options={KINDS} onChange={setKind} />
        {(kind === 'Square wave' || kind === 'Two tones') && (
          <Slider label="Fundamental frequency f₀" value={f0} onChange={setF0} min={100} max={10000} log format={(v) => si(v, 'Hz')} hint="How many times per second the pattern repeats." />
        )}
        {kind === 'Single pulse' && (
          <Slider label="Pulse duration T" value={pulseMs} onChange={setPulseMs} min={0.02} max={5} log format={(v) => si(v / 1000, 's')} hint="Short pulse in time = wide spectrum." />
        )}
        {kind === 'Data bits' && (
          <>
            <Slider label="Bit rate" value={bitRate} onChange={setBitRate} min={200} max={40000} log format={(v) => si(v, 'bit/s')} />
            <button className="btn" onClick={() => setSeed(seed + 1)}>New random bits</button>
          </>
        )}
      </Group>
      <Group title="2 · Set the channel bandwidth">
        <Slider label="Bandwidth B" value={bw} onChange={setBw} min={100} max={60000} log format={(v) => si(v, 'Hz')} hint="The range of frequencies the channel lets through (0 to B)." />
        <Choice label="Filter shape" value={filter} options={['Ideal', 'RC (gentle)'] as const} onChange={setFilter} hint="Ideal = brick wall. RC = how a simple cable/circuit behaves." />
      </Group>
      <Group title="Display">
        <Toggle label="Spectrum in dB" value={showDb} onChange={setShowDb} />
      </Group>
    </>
  );

  return (
    <LabLayout controls={controls}>
      <LabIntro>
        <h2>Signals &amp; Bandwidth</h2>
        <p>
          Every signal is a <b>sum of sine waves at different frequencies</b>. The list of those frequencies and their
          strengths is the signal's <b>spectrum</b>. A channel (cable, air, filter) only passes a limited range of
          frequencies, and the width of that range is its <b>bandwidth</b>. Cut off the high frequencies and the sharp
          edges in time disappear.
        </p>
      </LabIntro>

      <Metrics>
        <Metric label="Channel bandwidth" value={si(bw, 'Hz')} />
        <Metric label="Signal's 99% bandwidth" value={si(sim.b99, 'Hz')} hint="Frequency range that holds 99% of the signal's power." tone={sim.b99 > bw ? 'warn' : 'good'} sub={sim.b99 > bw ? 'wider than the channel' : 'fits in the channel'} />
        <Metric label="Power kept" value={`${(sim.kept * 100).toFixed(1)} %`} tone={sim.kept > 0.97 ? 'good' : sim.kept > 0.85 ? 'warn' : 'bad'} />
        <Metric label="Distortion (error power)" value={`${db(sim.nmse).toFixed(1)} dB`} hint="Output minus input, relative to the input power. More negative is better." tone={sim.nmse < 0.01 ? 'good' : sim.nmse < 0.1 ? 'warn' : 'bad'} />
        <Metric label="Edge rise time ≈" value={si(riseTime, 's')} hint="How long a sharp step takes to rise after the filter: ≈ 0.35/B for RC, ≈ 0.45/B ideal." />
        {kind === 'Square wave' && <Metric label="Harmonics passed" value={`${harmonics}`} sub={`odd multiples of f₀ ≤ B`} />}
        {kind === 'Single pulse' && <Metric label="Pulse main-lobe width" value={si(1 / (pulseMs / 1000), 'Hz')} sub="≈ 1/T (first null)" />}
        {kind === 'Data bits' && (
          <Metric label="Max clean symbol rate" value={si(nyquistRate, 'Bd')} sub="Nyquist: 2 × B" tone={bitsOk ? 'good' : 'bad'} hint="Above this, neighbouring bits smear into each other (inter-symbol interference)." />
        )}
        <Metric label="Radar range resolution" value={si(C / (2 * bw), 'm')} sub="c / 2B" hint="Same bandwidth used for sensing: two objects closer than this can't be told apart. (Real radars use MHz–GHz.)" />
      </Metrics>

      <Card title="Time domain: what the waveform looks like">
        <Plot series={sim.time} xLabel="Time (ms)" yLabel="Amplitude" height={260} />
      </Card>
      <Card title="Frequency domain: what the waveform is made of">
        <Plot
          series={sim.spec}
          xLabel="Frequency (kHz)"
          yLabel={showDb ? 'Relative power (dB)' : 'Relative amplitude'}
          yLim={showDb ? [-70, 5] : [0, 1.1]}
          xLim={[0, sim.fMaxK]}
          bands={[{ x0: 0, x1: bw / 1000, label: 'passband' }]}
          vLines={[{ v: bw / 1000, label: `B = ${si(bw, 'Hz')}`, color: 'var(--s4)' }]}
          height={260}
        />
      </Card>

      <TryThis
        items={[
          <>Square wave at 1 kHz. Slide <b>B</b> from 60 kHz down to 1.5 kHz. The corners round off, then only a single sine (the fundamental) is left. A square wave is just a sum of sines at f₀, 3f₀, 5f₀ and so on.</>,
          <>Single pulse. Make <b>T</b> shorter and watch the spectrum get <b>wider</b>. Short in time means wide in frequency. That's why fast data needs lots of bandwidth.</>,
          <>Data bits at 4 kbit/s. Lower <b>B</b> below 2 kHz (half the bit rate). The bits smear together and become hard to read. That's the Nyquist limit: at most 2B symbols per second.</>,
          <>Switch to <b>RC (gentle)</b>. A real channel doesn't cut off sharply, so some high frequencies leak through, just weaker.</>,
        ]}
      />

      <Explain title="Key ideas in plain language">
        <ul>
          <li><b>Signal</b>: a quantity that changes over time (voltage, field strength) and carries information.</li>
          <li><b>Frequency</b>: how many times per second something repeats, measured in hertz (Hz).</li>
          <li><b>Spectrum</b>: the recipe. It says which frequencies, and how much of each, add up to the signal. The FFT turns time into frequency.</li>
          <li><b>Bandwidth</b>: the width of the frequency range. A signal's bandwidth is the range it occupies, and a channel's bandwidth is the range it lets through.</li>
          <li><b>Why bandwidth matters</b>: fast changes in time need high frequencies. More bandwidth means more symbols per second (data rate) and sharper timing (finer radar range resolution, c/2B).</li>
          <li><b>Cost</b>: bandwidth is scarce and licensed. Also, more bandwidth lets in more noise (noise power = kTB). See the Channel lab.</li>
        </ul>
      </Explain>
    </LabLayout>
  );
}

