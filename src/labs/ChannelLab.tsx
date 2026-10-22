import { useMemo, useState } from 'react';
import { Plot } from '../components/Plot';
import { Card, Choice, Explain, Group, LabLayout, Metric, Metrics, Slider, Toggle, TryThis, Warn } from '../components/Controls';
import { PROFILES, PROFILE_NAMES } from '../dsp/channels';
import { Rng } from '../dsp/random';
import { C, db, si, undb } from '../dsp/units';

type Part = 'Link budget' | 'Multipath' | 'Mobility (Doppler)';
const PARTS: Part[] = ['Link budget', 'Multipath', 'Mobility (Doppler)'];

export default function ChannelLab() {
  const [part, setPart] = useState<Part>('Link budget');
  return (
    <div>
      <div className="subtabs">
        {PARTS.map((p) => (
          <button key={p} className={p === part ? 'on' : ''} onClick={() => setPart(p)}>
            {p}
          </button>
        ))}
      </div>
      {part === 'Link budget' && <LinkBudget />}
      {part === 'Multipath' && <Multipath />}
      {part === 'Mobility (Doppler)' && <Mobility />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 1. Link budget: how much power arrives, how much noise, how fast    */
/* ------------------------------------------------------------------ */

const ENVS = { 'Free space': 2, 'Rural': 2.4, 'Urban': 3.2, 'Indoor (walls)': 4 } as const;
type Env = keyof typeof ENVS;

function pathLossDb(fHz: number, d: number, n: number) {
  const fspl1m = 20 * Math.log10((4 * Math.PI * fHz) / C); // free-space loss at 1 m
  return fspl1m + 10 * n * Math.log10(Math.max(d, 1));
}

function LinkBudget() {
  const [pt, setPt] = useState(23);
  const [gt, setGt] = useState(8);
  const [gr, setGr] = useState(0);
  const [fcG, setFcG] = useState(3.5);
  const [d, setD] = useState(300);
  const [bwM, setBwM] = useState(100);
  const [nf, setNf] = useState(7);
  const [env, setEnv] = useState<Env>('Urban');

  const fc = fcG * 1e9;
  const B = bwM * 1e6;
  const n = ENVS[env];
  const pl = pathLossDb(fc, d, n);
  const pr = pt + gt + gr - pl;
  const noise = -174 + 10 * Math.log10(B) + nf; // dBm
  const snr = pr - noise;
  const cap = B * Math.log2(1 + undb(snr));
  const lambda = C / fc;

  const curves = useMemo(() => {
    // Capacity vs bandwidth at fixed received power
    const bs: number[] = [];
    const caps: number[] = [];
    const ideal: number[] = [];
    const prW = undb(pr - 30);
    const n0 = undb(-174 + nf - 30); // W/Hz
    for (let i = 0; i <= 200; i++) {
      const b = Math.pow(10, 4 + (i / 200) * 6); // 10 kHz .. 10 GHz
      bs.push(b / 1e6);
      caps.push((b * Math.log2(1 + prW / (n0 * b))) / 1e6);
      ideal.push(1.4427 * (prW / n0) / 1e6);
    }
    // SNR vs distance for this frequency and for two references
    const ds: number[] = [];
    const s1: number[] = [];
    const s2: number[] = [];
    const s3: number[] = [];
    for (let i = 0; i <= 200; i++) {
      const dd = Math.pow(10, (i / 200) * 4); // 1 m .. 10 km
      ds.push(dd);
      s1.push(pt + gt + gr - pathLossDb(fc, dd, n) - noise);
      s2.push(pt + gt + gr - pathLossDb(0.9e9, dd, n) - noise);
      s3.push(pt + gt + gr - pathLossDb(28e9, dd, n) - noise);
    }
    return { bs, caps, ideal, ds, s1, s2, s3 };
  }, [pr, nf, pt, gt, gr, fc, n, noise]);

  const controls = (
    <>
      <Group title="Transmitter">
        <Slider label="Transmit power Pt" value={pt} onChange={setPt} min={-10} max={46} step={1} format={(v) => `${v} dBm (${si(undb(v - 30), 'W')})`} hint="Phone ≈ 23 dBm (0.2 W), base station ≈ 43–46 dBm." />
        <Slider label="Tx antenna gain Gt" value={gt} onChange={setGt} min={0} max={30} step={1} format={(v) => `${v} dBi`} hint="Focusing power in one direction (see the Antenna Array lab)." />
      </Group>
      <Group title="Channel">
        <Slider label="Carrier frequency fc" value={fcG} onChange={setFcG} min={0.4} max={150} log format={(v) => si(v * 1e9, 'Hz')} />
        <Slider label="Distance d" value={d} onChange={setD} min={1} max={10000} log format={(v) => si(v, 'm')} />
        <Choice label="Environment (path-loss exponent)" value={env} options={Object.keys(ENVS) as Env[]} onChange={setEnv} hint={`Power falls as 1/d^${n}. Free space = 2.`} />
      </Group>
      <Group title="Receiver">
        <Slider label="Rx antenna gain Gr" value={gr} onChange={setGr} min={0} max={30} step={1} format={(v) => `${v} dBi`} />
        <Slider label="Bandwidth B" value={bwM} onChange={setBwM} min={0.18} max={2000} log format={(v) => si(v * 1e6, 'Hz')} hint="More bandwidth = more data, but also more noise." />
        <Slider label="Noise figure NF" value={nf} onChange={setNf} min={0} max={15} step={0.5} format={(v) => `${v} dB`} hint="How much noise the receiver electronics add." />
      </Group>
    </>
  );

  return (
    <LabLayout controls={controls}>
      <div className="lab-intro">
        <h2>The channel: link budget</h2>
        <p>
          The <b>channel</b> is everything between the transmitter's antenna and the receiver's antenna: air, distance,
          walls, buildings and moving objects. It isn't a "pipe" that carries the signal. The radio wave travels through
          it by itself, at the speed of light, and the channel changes the wave on the way. The first thing it does is
          make the wave <b>weaker</b>: the power spreads over a growing sphere. Then the receiver adds <b>noise</b>.
        </p>
        <div className="chain eq">
          <span>Pt {pt} dBm</span>+<span>Gt {gt} dB</span>−<span className="ch">Path loss {pl.toFixed(1)} dB</span>+<span>Gr {gr} dB</span>=
          <span><b>Pr {pr.toFixed(1)} dBm</b></span>vs<span>Noise {noise.toFixed(1)} dBm</span>⇒<span><b>SNR {snr.toFixed(1)} dB</b></span>
        </div>
      </div>
      <Metrics>
        <Metric label="Wavelength λ" value={si(lambda, 'm')} sub={`λ/2 antenna ≈ ${si(lambda / 2, 'm')}`} />
        <Metric label="Path loss" value={`${pl.toFixed(1)} dB`} sub={`power ÷ ${undb(pl).toExponential(1)}`} />
        <Metric label="Received power" value={`${pr.toFixed(1)} dBm`} sub={si(undb(pr - 30), 'W')} />
        <Metric label="Noise power kTB·NF" value={`${noise.toFixed(1)} dBm`} sub="−174 dBm/Hz + 10log₁₀B + NF" />
        <Metric label="SNR" value={`${snr.toFixed(1)} dB`} tone={snr > 15 ? 'good' : snr > 0 ? 'warn' : 'bad'} />
        <Metric label="Shannon capacity" value={si(cap, 'bit/s')} sub="B·log₂(1+SNR)" />
        <Metric label="Spectral efficiency" value={`${(cap / B).toFixed(2)} bit/s/Hz`} />
      </Metrics>
      {snr < 0 && <Warn tone="bad">The signal is below the noise floor. Add antenna gain, more power, less bandwidth, or move closer.</Warn>}

      <div className="grid2">
        <Card title="Capacity vs bandwidth (same received power)">
          <Plot
            series={[
              { x: curves.bs, y: curves.caps, label: 'Capacity', color: 'var(--s1)', width: 2 },
              { x: curves.bs, y: curves.ideal, label: 'Ceiling 1.44·Pr/N0', color: 'var(--s4)', dash: [5, 4] },
            ]}
            logX
            logY
            xLabel="Bandwidth (MHz)"
            yLabel="Capacity (Mbit/s)"
            vLines={[{ v: bwM, label: 'your B', color: 'var(--s3)' }]}
            height={260}
          />
        </Card>
        <Card title="SNR vs distance">
          <Plot
            series={[
              { x: curves.ds, y: curves.s2, label: '900 MHz', color: 'var(--s2)', width: 1.4 },
              { x: curves.ds, y: curves.s1, label: `${si(fc, 'Hz')} (yours)`, color: 'var(--s1)', width: 2.2 },
              { x: curves.ds, y: curves.s3, label: '28 GHz', color: 'var(--s5)', width: 1.4 },
            ]}
            logX
            xLabel="Distance (m)"
            yLabel="SNR (dB)"
            yLim={[-30, 80]}
            vLines={[{ v: d, label: 'you', color: 'var(--s3)' }]}
            hLines={[{ v: 0, label: 'signal = noise' }]}
            height={260}
          />
        </Card>
      </div>
      <TryThis
        items={[
          <>Double the distance. In free space you lose 6 dB (¼ of the power). In Urban you lose about 10 dB.</>,
          <>Raise B from 20 MHz to 400 MHz. SNR drops (noise grows with B) but capacity still goes up, until it reaches the dashed ceiling. Bandwidth helps, but with diminishing returns.</>,
          <>Move fc from 3.5 GHz to 28 GHz with the same antennas. The loss grows by 20·log₁₀(8) ≈ 18 dB. mmWave needs high-gain arrays (Gt, Gr ≈ 20–30 dBi) to make up for it.</>,
        ]}
      />
      <Explain title="Why does higher frequency lose more?">
        <p>
          The free-space formula is FSPL = (4πd/λ)². Strictly, the wave doesn't spread more at high frequency. What
          happens is that a fixed-gain antenna at short wavelength is physically <i>smaller</i>, so it collects less of the
          spreading power. The upside of small antennas: you can fit many of them in the same space and steer a narrow
          beam (the Antenna Array lab), which wins the power back.
        </p>
      </Explain>
    </LabLayout>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Multipath: echoes cause ISI in time and fading in frequency      */
/* ------------------------------------------------------------------ */


function Multipath() {
  const [profile, setProfile] = useState('Urban (vehicular)');
  const [scale, setScale] = useState(1);
  const [bwM, setBwM] = useState(5);
  const [seed, setSeed] = useState(3);

  const sim = useMemo(() => {
    const rng = new Rng(seed);
    const pr = PROFILES[profile];
    const delays = pr.d.map((x) => x * scale * 1e-6);
    const pow = pr.p.map(undb);
    const ptot = pow.reduce((a, b) => a + b, 0);
    // Complex gain per path (random phase, fixed average power)
    const gr: number[] = [];
    const gi: number[] = [];
    for (let i = 0; i < delays.length; i++) {
      const a = Math.sqrt(pow[i] / ptot);
      const ph = i === 0 && profile === 'LOS only' ? 0 : 2 * Math.PI * rng.uniform();
      gr.push(a * Math.cos(ph));
      gi.push(a * Math.sin(ph));
    }
    // RMS delay spread
    let m1 = 0;
    let m2 = 0;
    for (let i = 0; i < delays.length; i++) {
      const w = pow[i] / ptot;
      m1 += w * delays[i];
      m2 += w * delays[i] ** 2;
    }
    const tauRms = Math.sqrt(Math.max(0, m2 - m1 * m1));
    const tauMax = Math.max(...delays);
    const Bc = tauRms > 0 ? 1 / (5 * tauRms) : Infinity;

    // Frequency response over the signal band
    const B = bwM * 1e6;
    const fs: number[] = [];
    const hdB: number[] = [];
    let hmin = Infinity;
    let hmax = -Infinity;
    for (let i = 0; i <= 600; i++) {
      const f = -B / 2 + (i / 600) * B;
      let re = 0;
      let im = 0;
      for (let p = 0; p < delays.length; p++) {
        const ph = -2 * Math.PI * f * delays[p];
        re += gr[p] * Math.cos(ph) - gi[p] * Math.sin(ph);
        im += gr[p] * Math.sin(ph) + gi[p] * Math.cos(ph);
      }
      const v = db(re * re + im * im);
      fs.push(f / 1e6);
      hdB.push(v);
      hmin = Math.min(hmin, v);
      hmax = Math.max(hmax, v);
    }

    // Time domain: BPSK pulses at symbol rate = B go through the channel
    const Ts = 1 / B;
    const nSym = 24;
    const bits: number[] = [];
    for (let i = 0; i < nSym; i++) bits.push(rng.uniform() < 0.5 ? -1 : 1);
    const pulse = (t: number) => {
      // smooth-edged rectangular pulse (raised-cosine edges, 10% of Ts)
      if (t < 0 || t > Ts) return 0;
      const e = 0.1 * Ts;
      if (t < e) return 0.5 - 0.5 * Math.cos((Math.PI * t) / e);
      if (t > Ts - e) return 0.5 - 0.5 * Math.cos((Math.PI * (Ts - t)) / e);
      return 1;
    };
    const tx = (t: number) => {
      const k = Math.floor(t / Ts);
      if (k < 0 || k >= nSym) return 0;
      return bits[k] * pulse(t - k * Ts);
    };
    const tt: number[] = [];
    const xs: number[] = [];
    const ys: number[] = [];
    const tEnd = nSym * Ts + tauMax;
    const NP = 1500;
    for (let i = 0; i <= NP; i++) {
      const t = (i / NP) * tEnd;
      tt.push(t * 1e6);
      xs.push(tx(t));
      let y = 0;
      for (let p = 0; p < delays.length; p++) y += gr[p] * tx(t - delays[p]);
      ys.push(y);
    }
    // Scale the received trace to the same RMS level as the sent one
    const rmsX = Math.sqrt(xs.reduce((acc, v) => acc + v * v, 0) / xs.length) || 1;
    const rmsY = Math.sqrt(ys.reduce((acc, v) => acc + v * v, 0) / ys.length) || 1;
    for (let i = 0; i < ys.length; i++) ys[i] *= rmsX / rmsY;

    return { delays, pr, fs, hdB, hmin, hmax, tauRms, tauMax, Bc, tt, xs, ys, Ts };
  }, [profile, scale, bwM, seed]);

  const B = bwM * 1e6;
  const flat = B < sim.Bc / 2;
  const isiSymbols = sim.tauMax / sim.Ts;

  const controls = (
    <>
      <Group title="Environment">
        <Choice label="Delay profile" value={profile} options={PROFILE_NAMES} onChange={setProfile} hint="Each path = one echo off a wall, building or hill. Based on 3GPP EPA/EVA/ETU models." />
        <Slider label="Stretch delays ×" value={scale} onChange={setScale} min={0.1} max={10} log format={(v) => `${v}×`} hint="Bigger area means longer echoes." />
        <button className="btn" onClick={() => setSeed(seed + 1)}>New channel realisation (new phases)</button>
      </Group>
      <Group title="Your signal">
        <Slider label="Signal bandwidth B" value={bwM} onChange={setBwM} min={0.01} max={200} log format={(v) => si(v * 1e6, 'Hz')} hint="Symbol duration ≈ 1/B." />
      </Group>
    </>
  );

  return (
    <LabLayout controls={controls}>
      <div className="lab-intro">
        <h2>The channel: multipath</h2>
        <p>
          The signal reaches the receiver along <b>several paths</b>: one direct, others bounced off buildings. Each
          copy arrives a little later, weaker and with a different phase. <b>In time</b>, the copies overlap and smear
          symbols into each other (inter-symbol interference, ISI). <b>In frequency</b>, the copies add up at some
          frequencies and cancel at others, so the channel has dips (frequency-selective fading).
        </p>
      </div>
      <Metrics>
        <Metric label="RMS delay spread τ_rms" value={si(sim.tauRms, 's')} />
        <Metric label="Max excess delay" value={si(sim.tauMax, 's')} />
        <Metric label="Coherence bandwidth Bc" value={si(sim.Bc, 'Hz')} sub="≈ 1/(5·τ_rms)" hint="Over this range of frequencies the channel looks roughly constant." />
        <Metric label="Your bandwidth B" value={si(B, 'Hz')} sub={flat ? 'B ≪ Bc → flat fading' : 'B > Bc → frequency-selective'} tone={flat ? 'good' : 'warn'} />
        <Metric label="Symbol duration ≈ 1/B" value={si(sim.Ts, 's')} />
        <Metric label="Symbols smeared by echoes" value={isiSymbols.toFixed(2)} sub="max delay ÷ symbol time" tone={isiSymbols < 0.1 ? 'good' : isiSymbols < 1 ? 'warn' : 'bad'} />
        <Metric label="Fade depth across band" value={`${(sim.hmax - sim.hmin).toFixed(1)} dB`} />
      </Metrics>
      {isiSymbols > 1 && (
        <Warn>Echoes last longer than a symbol, so every symbol is corrupted by the ones before it. A single-carrier system would need a complex equaliser. <b>OFDM</b> solves this by splitting B into many slow subcarriers, each with long symbols (see the OFDM lab).</Warn>
      )}
      <div className="grid2">
        <Card title="Power delay profile (the echoes)">
          <Plot
            series={[{ x: sim.delays.map((v) => v * 1e6), y: sim.pr.p, mode: 'stem', color: 'var(--s1)', size: 3.5 }]}
            xLabel="Delay (µs)"
            yLabel="Relative power (dB)"
            yLim={[-25, 3]}
            xLim={[-0.05 * Math.max(sim.tauMax * 1e6, 0.1), Math.max(sim.tauMax * 1e6, 0.1) * 1.1]}
            legend={false}
            height={240}
          />
        </Card>
        <Card title="Channel frequency response |H(f)| over your band">
          <Plot
            series={[{ x: sim.fs, y: sim.hdB, color: 'var(--s1)', width: 2 }]}
            xLabel="Frequency offset from carrier (MHz)"
            yLabel="Gain (dB)"
            yLim={[Math.min(-25, sim.hmin - 2), Math.max(8, sim.hmax + 2)]}
            legend={false}
            height={240}
          />
        </Card>
      </div>
      <Card title="Time domain: sent symbols vs what arrives (sum of echoes)">
        <Plot
          series={[
            { x: sim.tt, y: sim.xs, label: 'Sent', color: 'var(--s2)', width: 1.4 },
            { x: sim.tt, y: sim.ys, label: 'Received (normalised)', color: 'var(--s1)', width: 1.8 },
          ]}
          xLabel="Time (µs)"
          yLabel="Amplitude"
          height={240}
        />
      </Card>
      <TryThis
        items={[
          <>Urban profile, B = 100 kHz. The response is almost flat and the received symbols look like the sent ones. Now raise B to 20 MHz. Dips appear across the band and the received symbols are badly smeared.</>,
          <>Click <b>New channel realisation</b>. The same echoes with different phases move the dips around. That's fading.</>,
          <>Choose <b>LOS only</b>. With a single path there's no fading at any bandwidth.</>,
        ]}
      />
      <Explain title="What is a channel, mathematically?">
        <p>
          For radio, the channel is modelled as a set of paths. Each path has a <b>gain</b> (how strong), a <b>delay</b> τ (how
          long it took), a <b>Doppler shift</b> (if things move) and an <b>angle</b> (direction). The received signal is
          y(t) = Σ αₚ · x(t − τₚ) + noise. This is exactly the "path parameters" (delay, Doppler, AoA/AoD, gain) in your ISAC
          paper. Communication treats them as a nuisance to equalise. <b>Sensing extracts them</b> to find where objects are.
        </p>
      </Explain>
    </LabLayout>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Mobility: Doppler shift and time-varying fading                  */
/* ------------------------------------------------------------------ */

function Mobility() {
  const [kmh, setKmh] = useState(60);
  const [fcG, setFcG] = useState(3.5);
  const [losOn, setLosOn] = useState(false);
  const [kDb, setKDb] = useState(6);
  const [seed, setSeed] = useState(11);

  const v = kmh / 3.6;
  const fc = fcG * 1e9;
  const fD = (v * fc) / C;
  const Tc = fD > 0 ? 0.423 / fD : Infinity;

  const sim = useMemo(() => {
    const rng = new Rng(seed);
    const M = 48;
    const ang: number[] = [];
    const ph: number[] = [];
    for (let i = 0; i < M; i++) {
      ang.push(2 * Math.PI * rng.uniform());
      ph.push(2 * Math.PI * rng.uniform());
    }
    const K = losOn ? undb(kDb) : 0;
    const span = fD > 0 ? Math.min(2, 25 / fD) : 0.1; // seconds shown
    const tt: number[] = [];
    const env: number[] = [];
    let below = 0;
    const NP = 1500;
    for (let i = 0; i <= NP; i++) {
      const t = (i / NP) * span;
      let re = 0;
      let im = 0;
      for (let m = 0; m < M; m++) {
        const p = 2 * Math.PI * fD * Math.cos(ang[m]) * t + ph[m];
        re += Math.cos(p);
        im += Math.sin(p);
      }
      re /= Math.sqrt(M);
      im /= Math.sqrt(M);
      // Rician: add a steady line-of-sight component
      const sc = Math.sqrt(1 / (K + 1));
      const los = Math.sqrt(K / (K + 1));
      const r = sc * re + los * Math.cos(2 * Math.PI * fD * 0.7 * t);
      const q = sc * im + los * Math.sin(2 * Math.PI * fD * 0.7 * t);
      const pdb = db(r * r + q * q);
      tt.push(t * 1000);
      env.push(pdb);
      if (pdb < -10) below++;
    }
    // Jakes Doppler spectrum (theory)
    const fx: number[] = [];
    const sy: number[] = [];
    for (let i = 1; i < 400; i++) {
      const f = -fD + (i / 400) * 2 * fD;
      fx.push(f);
      sy.push(1 / (Math.PI * fD * Math.sqrt(Math.max(1e-6, 1 - (f / fD) ** 2))));
    }
    return { tt, env, outage: below / (NP + 1), fx, sy };
  }, [fD, losOn, kDb, seed]);

  const controls = (
    <>
      <Group title="Motion">
        <Slider label="Speed" value={kmh} onChange={setKmh} min={0} max={500} step={5} format={(x) => `${x} km/h (${(x / 3.6).toFixed(1)} m/s)`} hint="Walking 5, car 60–120, high-speed train 350." />
        <Slider label="Carrier frequency" value={fcG} onChange={setFcG} min={0.4} max={150} log format={(x) => si(x * 1e9, 'Hz')} />
      </Group>
      <Group title="Scattering">
        <Toggle label="Strong line-of-sight path (Rician)" value={losOn} onChange={setLosOn} />
        {losOn && <Slider label="K-factor (LOS ÷ scattered power)" value={kDb} onChange={setKDb} min={-5} max={20} step={1} format={(x) => `${x} dB`} />}
        <button className="btn" onClick={() => setSeed(seed + 1)}>New realisation</button>
      </Group>
    </>
  );

  return (
    <LabLayout controls={controls}>
      <div className="lab-intro">
        <h2>The channel: mobility and Doppler</h2>
        <p>
          When the transmitter, the receiver or the reflectors move, every echo's path length changes over time. Its phase rotates
          at the <b>Doppler frequency</b> f_D = v·fc / c. Echoes that add up now cancel a few centimetres later, so the received
          power <b>fades</b> up and down over time. The faster you move (or the higher fc), the faster it fades.
        </p>
      </div>
      <Metrics>
        <Metric label="Max Doppler shift f_D" value={si(fD, 'Hz')} sub="v · fc / c" />
        <Metric label="Coherence time Tc" value={si(Tc, 's')} sub="≈ 0.423 / f_D" hint="How long the channel stays about the same." />
        <Metric label="Half-wavelength travelled in" value={si(v > 0 ? C / fc / 2 / v : Infinity, 's')} sub="distance between deep fades ≈ λ/2" />
        <Metric label="Time in deep fade (< −10 dB)" value={`${(sim.outage * 100).toFixed(1)} %`} tone={sim.outage < 0.03 ? 'good' : 'warn'} />
        <Metric label="OFDM symbols per Tc (30 kHz SCS)" value={isFinite(Tc) ? (Tc / 35.7e-6).toFixed(0) : '∞'} hint="How many 5G NR symbols (35.7 µs incl. CP) fit before the channel changes." />
        <Metric label="Radar: Doppler for 2-way echo" value={si(2 * fD, 'Hz')} sub="monostatic radar sees 2·v·fc/c" />
      </Metrics>
      <Card title="Received power over time (fast fading)">
        <Plot series={[{ x: sim.tt, y: sim.env, color: 'var(--s1)', width: 1.5 }]} xLabel="Time (ms)" yLabel="Power (dB)" yLim={[-40, 10]} legend={false} hLines={[{ v: -10, label: '−10 dB' }]} height={260} />
      </Card>
      <Card title="Doppler spectrum (Jakes): where scattered energy lands in frequency">
        <Plot series={[{ x: sim.fx, y: sim.sy, color: 'var(--s5)', width: 2 }]} xLabel="Frequency shift (Hz)" yLabel="Density" legend={false} height={200} />
      </Card>
      <TryThis
        items={[
          <>Go from 5 km/h (walking) to 120 km/h at 3.5 GHz. The fades come about 24× faster.</>,
          <>Keep 120 km/h and move fc from 3.5 to 28 GHz. f_D is 8× larger. At mmWave even moderate speeds give fast fading.</>,
          <>Turn on the line-of-sight path with K = 10 dB. Deep fades almost disappear, which is why LOS links are so much more reliable.</>,
        ]}
      />
    </LabLayout>
  );
}
