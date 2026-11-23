import { useMemo, useState } from 'react';
import type { TabId } from '../App';
import { Explain } from '../components/Controls';
import { Plot, Series } from '../components/Plot';

const STEPS: { id: TabId; n: string; title: string; text: string; q: string }[] = [
  { id: 'signals', n: '1', title: 'Signals & bandwidth', text: 'Time vs frequency, spectra, and what happens when the channel cuts off high frequencies.', q: 'What is bandwidth and why does it limit data rate?' },
  { id: 'modulation', n: '2', title: 'Modulation & transmission', text: 'Bits → QAM symbols → pulse shaping → carrier → noise → receiver. Eye diagrams, constellations, BER.', q: 'How does a waveform actually get transmitted?' },
  { id: 'channel', n: '3', title: 'The channel', text: 'Link budget (path loss, noise kTB, Shannon capacity), multipath echoes, and Doppler fading.', q: 'What is a channel and what does it do to my signal?' },
  { id: 'ofdm', n: '4', title: 'OFDM', text: 'Subcarriers, numerology Δf, cyclic prefix, resource grid, pilot channel estimation, PAPR.', q: 'Why does 4G/5G/Wi-Fi use OFDM?' },
  { id: 'radar', n: '5', title: 'OFDM radar (ISAC)', text: 'Use the same OFDM signal to detect targets: range-Doppler maps, resolution, ambiguity, data removal.', q: 'How can a data signal also be a radar?' },
  { id: 'array', n: '6', title: 'Antenna arrays', text: 'Beamforming, beamwidth, grating lobes, and serving two users in the same band.', q: 'How is space used as a resource?' },
  { id: 'coop', n: '7', title: 'Cooperative ISAC localisation', text: 'Several base stations sense the same objects and fuse range, angle and Doppler. Map fusion, WLS, CRLB, GDOP, Monte Carlo.', q: 'How do many stations locate an object better than one?' },
];

const LANE = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
const N_HERO = [4, 8, 16] as const;

/** Subcarrier spectra: sinc lobes spaced Δf apart. Each peak sits on every other lobe's zero. */
function OfdmScreen() {
  const [n, setN] = useState<number>(8);
  const series = useMemo(() => {
    const xs: number[] = [];
    for (let x = -2; x <= n + 1; x += 0.02) xs.push(x);
    const sinc = (t: number) => (Math.abs(t) < 1e-9 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t));
    const out: Series[] = [];
    for (let k = 0; k < n; k++) out.push({ x: xs, y: xs.map((x) => sinc(x - k)), color: LANE[k % LANE.length], width: 1.4 });
    out.push({ x: Array.from({ length: n }, (_, k) => k), y: Array.from({ length: n }, () => 1), mode: 'scatter', color: 'var(--text)', size: 2.5 });
    return out;
  }, [n]);
  return (
    <div className="hero-screen">
      <div className="card-head">
        <h3>{n} subcarriers, one OFDM symbol</h3>
        <div className="seg small" role="radiogroup" aria-label="Number of subcarriers">
          {N_HERO.map((v) => (
            <button key={v} role="radio" aria-checked={v === n} className={v === n ? 'on' : ''} onClick={() => setN(v)}>
              N = {v}
            </button>
          ))}
        </div>
      </div>
      <Plot series={series} height={260} legend={false} xLabel="Frequency (multiples of Δf)" yLabel="Amplitude" yLim={[-0.3, 1.1]} />
    </div>
  );
}

export default function Home({ go }: { go: (t: TabId) => void }) {
  return (
    <div className="home">
      <div className="hero">
        <div className="hero-text">
          <h1>One waveform that talks and sees</h1>
          <p>
            Learn how a signal uses time, frequency and space, then use the same OFDM signal as a radar. Every control re-runs a
            real simulation in your browser.
          </p>
          <button className="btn primary hero-cta" onClick={() => go('signals')}>
            Start with lab 1
          </button>
        </div>
        <OfdmScreen />
      </div>

      <ol className="path">
        {STEPS.map((s) => (
          <li key={s.id}>
            <button className="step" onClick={() => go(s.id)}>
              <span className="step-n">{s.n}</span>
              <span className="step-title">{s.title}</span>
              <span className="step-q">{s.q}</span>
            </button>
          </li>
        ))}
      </ol>

      <Explain title="Glossary">
        <dl className="glossary">
          <dt>Bandwidth (B)</dt><dd>Width of the frequency range a signal occupies or a channel passes, in Hz.</dd>
          <dt>Carrier (fc)</dt><dd>The high-frequency sine wave that the information rides on, so it can radiate from an antenna.</dd>
          <dt>Symbol</dt><dd>One "letter" sent per time slot: a point in the constellation carrying log₂M bits.</dd>
          <dt>SNR</dt><dd>Signal power ÷ noise power. Usually in dB: 10 dB = 10×, 20 dB = 100×.</dd>
          <dt>BER</dt><dd>Bit error rate: fraction of bits received wrongly.</dd>
          <dt>Channel</dt><dd>Everything between Tx and Rx antennas: loss, echoes (multipath), Doppler, noise.</dd>
          <dt>OFDM</dt><dd>Splits bandwidth into many orthogonal subcarriers, each carrying slow QAM symbols.</dd>
          <dt>ISAC</dt><dd>Integrated sensing and communication: one radio and one signal for both data and radar.</dd>
          <dt>dB / dBm</dt><dd>Log scale for ratios / power relative to 1 mW (0 dBm = 1 mW, 30 dBm = 1 W).</dd>
        </dl>
      </Explain>
    </div>
  );
}
