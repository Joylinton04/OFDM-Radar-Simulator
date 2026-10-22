import type { TabId } from '../App';

const STEPS: { id: TabId; n: string; title: string; text: string; q: string }[] = [
  { id: 'signals', n: '1', title: 'Signals & Bandwidth', text: 'Time vs frequency, spectra, and what happens when the channel cuts off high frequencies.', q: 'What is bandwidth and why does it limit data rate?' },
  { id: 'modulation', n: '2', title: 'Modulation & Transmission', text: 'Bits → QAM symbols → pulse shaping → carrier → noise → receiver. Eye diagrams, constellations, BER.', q: 'How does a waveform actually get transmitted?' },
  { id: 'channel', n: '3', title: 'The Channel', text: 'Link budget (path loss, noise kTB, Shannon capacity), multipath echoes, and Doppler fading.', q: 'What is a channel and what does it do to my signal?' },
  { id: 'ofdm', n: '4', title: 'OFDM', text: 'Subcarriers, numerology Δf, cyclic prefix, resource grid, pilot channel estimation, PAPR.', q: 'Why does 4G/5G/Wi-Fi use OFDM?' },
  { id: 'radar', n: '5', title: 'OFDM Radar (ISAC)', text: 'Use the same OFDM signal to detect targets: range-Doppler maps, resolution, ambiguity, data removal.', q: 'How can a data signal also be a radar?' },
  { id: 'array', n: '6', title: 'Antenna Arrays', text: 'Beamforming, beamwidth, grating lobes, and serving two users in the same band.', q: 'How is space used as a resource?' },
];

export default function Home({ go }: { go: (t: TabId) => void }) {
  return (
    <div className="home">
      <div className="hero">
        <h1>Wireless &amp; ISAC Lab</h1>
        <p>
          An interactive bench for learning how signals use <b>time</b>, <b>frequency</b> and <b>space</b>, what a
          <b> channel</b> does to them, and how one OFDM waveform can both <b>communicate</b> and <b>sense</b>. Every slider
          re-runs a real simulation (FFT, filters, noise, multipath) in your browser.
        </p>
        <div className="resource-row">
          <div><b>Time</b><span>symbol duration, cyclic prefix, frame length</span></div>
          <div><b>Frequency</b><span>bandwidth, subcarriers, spacing Δf, carrier fc</span></div>
          <div><b>Space</b><span>antennas, beams, direction</span></div>
          <div><b>Power</b><span>Tx power, SNR, modulation order</span></div>
        </div>
      </div>
      <div className="step-grid">
        {STEPS.map((s) => (
          <button key={s.id} className="step" onClick={() => go(s.id)}>
            <span className="step-n">{s.n}</span>
            <span className="step-title">{s.title}</span>
            <span className="step-q">{s.q}</span>
            <span className="step-text">{s.text}</span>
          </button>
        ))}
      </div>
      <div className="card glossary">
        <h3>Quick glossary</h3>
        <dl>
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
      </div>
    </div>
  );
}
