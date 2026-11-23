import { useMemo, useState } from 'react';
import { Plot } from '../components/Plot';
import { PolarPlot } from '../components/PolarPlot';
import { Card, Choice, Explain, Group, LabIntro, LabLayout, Metric, Metrics, Slider, Toggle, TryThis, Warn } from '../components/Controls';
import { C, db, si } from '../dsp/units';

type Taper = 'Uniform' | 'Hann' | 'Chebyshev-like (−30 dB)';
const TAPERS: Taper[] = ['Uniform', 'Hann', 'Chebyshev-like (−30 dB)'];

function weights(n: number, taper: Taper): number[] {
  const w: number[] = [];
  for (let i = 0; i < n; i++) {
    if (taper === 'Uniform' || n === 1) w.push(1);
    else if (taper === 'Hann') w.push(0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / (n + 1)));
    else {
      // Taylor-ish taper: raised cosine on a pedestal
      const x = (i - (n - 1) / 2) / ((n - 1) / 2);
      w.push(0.08 + 0.92 * Math.cos((Math.PI * x) / 2) ** 2);
    }
  }
  return w;
}

/** Normalised array factor (dB) of a uniform linear array steered to `steer`. */
function arrayFactor(n: number, dLam: number, steerDeg: number, w: number[], angles: number[]): number[] {
  const s0 = Math.sin((steerDeg * Math.PI) / 180);
  const wsum = w.reduce((a, b) => a + b, 0);
  return angles.map((a) => {
    const s = Math.sin((a * Math.PI) / 180);
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const ph = 2 * Math.PI * dLam * i * (s - s0);
      re += w[i] * Math.cos(ph);
      im += w[i] * Math.sin(ph);
    }
    return db((re * re + im * im) / (wsum * wsum));
  });
}

export default function ArrayLab() {
  const [n, setN] = useState(8);
  const [dLam, setDLam] = useState(0.5);
  const [steer, setSteer] = useState(20);
  const [taper, setTaper] = useState<Taper>('Uniform');
  const [fcG, setFcG] = useState(28);
  const [twoUsers, setTwoUsers] = useState(true);
  const [user2, setUser2] = useState(-35);

  const angles = useMemo(() => Array.from({ length: 721 }, (_, i) => -90 + i * 0.25), []);
  const w = useMemo(() => weights(n, taper), [n, taper]);
  const af = useMemo(() => arrayFactor(n, dLam, steer, w, angles), [n, dLam, steer, w, angles]);
  const af2 = useMemo(() => (twoUsers ? arrayFactor(n, dLam, user2, w, angles) : []), [twoUsers, n, dLam, user2, w, angles]);

  // Half-power beamwidth measured from the pattern
  const iPeak = angles.findIndex((a) => Math.abs(a - steer) < 0.13);
  let lo = iPeak;
  let hi = iPeak;
  while (lo > 0 && af[lo] > -3) lo--;
  while (hi < af.length - 1 && af[hi] > -3) hi++;
  const hpbw = angles[hi] - angles[lo];

  // Highest sidelobe: largest local max outside the main lobe
  let sll = -Infinity;
  for (let i = 1; i < af.length - 1; i++) {
    if (i >= lo - 2 && i <= hi + 2) continue;
    if (af[i] > af[i - 1] && af[i] >= af[i + 1]) sll = Math.max(sll, af[i]);
  }

  const wsum = w.reduce((a, b) => a + b, 0);
  const w2 = w.reduce((a, b) => a + b * b, 0);
  const gainDb = db((wsum * wsum) / w2); // array gain incl. taper loss
  const lambda = C / (fcG * 1e9);
  const aperture = (n - 1) * dLam * lambda;
  const grating = dLam > 1 / (1 + Math.abs(Math.sin((steer * Math.PI) / 180)));

  // Interference between two users: beam 1 gain toward user 2
  const idx2 = angles.findIndex((a) => Math.abs(a - user2) < 0.13);
  const leak = twoUsers && idx2 >= 0 ? af[idx2] : -Infinity;

  const controls = (
    <>
      <Group title="Array">
        <Slider label="Number of antennas N" value={n} onChange={setN} min={1} max={64} step={1} format={(v) => `${v}`} hint="5G phones: 2–4, base stations: 32–256, mmWave arrays: 64+" />
        <Slider label="Element spacing d / λ" value={dLam} onChange={setDLam} min={0.1} max={1.5} step={0.05} format={(v) => `${v.toFixed(2)} λ`} hint="Standard choice: λ/2." />
        <Choice label="Amplitude taper" value={taper} options={TAPERS} onChange={setTaper} hint="Tapering lowers sidelobes but widens the beam." />
        <Choice label="Carrier" value={fcG} options={[3.5, 7, 28, 60, 140]} onChange={setFcG} format={(v) => `${v} GHz`} />
      </Group>
      <Group title="Beam steering">
        <Slider label="Steer beam 1 to" value={steer} onChange={setSteer} min={-80} max={80} step={1} format={(v) => `${v}°`} hint="Done by giving each antenna a different phase shift." />
        <Toggle label="Serve a second user (spatial multiplexing)" value={twoUsers} onChange={setTwoUsers} />
        {twoUsers && <Slider label="User 2 direction" value={user2} onChange={setUser2} min={-80} max={80} step={1} format={(v) => `${v}°`} />}
      </Group>
    </>
  );

  return (
    <LabLayout controls={controls}>
      <LabIntro>
        <h2>Antenna arrays: space as a resource</h2>
        <p>
          Time and frequency aren't the only resources. With many antennas, the transmitter can give each one a slightly
          different <b>phase</b> so the waves add up in one direction and cancel in others. This is <b>beamforming</b>.
          It concentrates power (more SNR), lets several users share the same time-frequency resources if they're in
          different directions (spatial multiplexing, MIMO), and for sensing it measures <b>angle</b> (AoA/AoD).
        </p>
      </LabIntro>
      <Metrics>
        <Metric label="Array gain" value={`${gainDb.toFixed(1)} dB`} sub={`≈ 10·log₁₀(N) = ${db(n).toFixed(1)} dB uniform`} />
        <Metric label="Half-power beamwidth" value={`${hpbw.toFixed(1)}°`} sub="≈ 0.886·λ / (N·d·cosθ)" />
        <Metric label="Angular resolution (radar)" value={`≈ ${hpbw.toFixed(1)}°`} hint="Two targets closer in angle than the beamwidth blur together." />
        <Metric label="Highest sidelobe" value={isFinite(sll) ? `${sll.toFixed(1)} dB` : '—'} tone={sll > -10 ? 'warn' : 'good'} />
        <Metric label="Aperture size" value={si(aperture, 'm')} sub={`at ${fcG} GHz, λ = ${si(lambda, 'm')}`} />
        {twoUsers && <Metric label="Beam 1 leakage to user 2" value={isFinite(leak) ? `${leak.toFixed(1)} dB` : '—'} tone={leak < -13 ? 'good' : leak < -6 ? 'warn' : 'bad'} sub="lower = less interference" />}
      </Metrics>
      {grating && <Warn tone="bad">Grating lobes: spacing above λ/(1+|sin θ|) creates extra full-strength beams in the wrong directions. Keep d ≤ λ/2.</Warn>}
      <div className="grid2">
        <Card title="Beam pattern (polar, top view)">
          <PolarPlot
            series={[{ angleDeg: angles, db: af, color: 'var(--s1)' }, ...(twoUsers ? [{ angleDeg: angles, db: af2, color: 'var(--s2)' }] : [])]}
            spokes={[{ angleDeg: steer, label: 'beam 1', color: 'var(--s1)' }, ...(twoUsers ? [{ angleDeg: user2, label: 'user 2', color: 'var(--s2)' }] : [])]}
            height={300}
          />
        </Card>
        <Card title="Beam pattern (dB vs angle)">
          <Plot
            series={[
              { x: angles, y: af, label: 'Beam 1', color: 'var(--s1)', width: 1.8 },
              ...(twoUsers ? [{ x: angles, y: af2, label: 'Beam 2', color: 'var(--s2)', width: 1.4 }] : []),
            ]}
            yLim={[-50, 2]}
            xLim={[-90, 90]}
            xLabel="Angle (°)"
            yLabel="Gain (dB)"
            hLines={[{ v: -3, label: '−3 dB' }]}
            height={300}
          />
        </Card>
      </div>
      <TryThis
        items={[
          <>Go from N = 4 to 32. The beam narrows and the gain rises by 9 dB. That's how mmWave makes up for its path loss.</>,
          <>Steer to 70°. The beam gets wider, because the array looks shorter from the side.</>,
          <>Set the spacing to 1.0 λ. Grating lobes appear: copies of the main beam in the wrong directions.</>,
          <>With two users, move user 2 close to beam 1. Interference rises sharply once they're inside each other's main lobe. Spatial multiplexing needs users to be separated in angle.</>,
          <>Try the Chebyshev-like taper. Sidelobes drop to about −30 dB but the main lobe gets wider. You can't have both.</>,
        ]}
      />
      <Explain title="Why phase shifts steer a beam">
        <p>
          A wave arriving from angle θ reaches each antenna d·sinθ later than its neighbour, which is a phase difference of 2π·(d/λ)·sinθ.
          If the transmitter applies the <i>opposite</i> phase shift to each element, signals toward θ line up and add (N× stronger in amplitude,
          N² in power, divided over N× more total power gives N× gain). In other directions they add with mismatched phases and mostly cancel.
          The ISAC paper's digital, analog and hybrid architectures are different hardware ways of applying these weights.
        </p>
      </Explain>
    </LabLayout>
  );
}
