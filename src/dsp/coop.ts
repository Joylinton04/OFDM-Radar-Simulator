// Cooperative (multi-monostatic) OFDM ISAC localisation.
//
// Each base station (BS) transmits an OFDM frame (N subcarriers x M symbols)
// from one antenna and listens to the echoes on a uniform linear array of Na
// half-wavelength-spaced elements. Locally it estimates range, angle and radial
// velocity of every object it sees. A fusion centre then combines the
// measurements of all cooperating stations in two stages:
//   1. coarse: add up the stations' range-angle maps on a common x-y grid and
//      pick the peaks (candidate objects);
//   2. fine: associate each station's detections to a candidate and solve a
//      weighted least-squares (WLS) problem for its position.
// Cramér-Rao lower bounds (CRLB) give the best accuracy any unbiased
// estimator could reach, for comparison.

import { fft } from './fft';
import type { Constellation } from './modulation';
import { Rng } from './random';
import { C, K_BOLTZMANN } from './units';

export interface BaseStation {
  x: number;
  y: number;
  az: number; // array boresight, radians, counter-clockwise from +x
}

export interface SceneObject {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rcs: number; // radar cross-section, dBsm
}

export type Removal = 'reciprocal' | 'matched';

export interface CoopConfig {
  fc: number; // carrier, Hz
  df: number; // subcarrier spacing, Hz
  N: number; // subcarriers (power of two)
  M: number; // OFDM symbols (power of two)
  Na: number; // receive antennas (power of two or 1)
  cpRatio: number; // cyclic prefix / useful symbol
  ptDbm: number; // transmit power
  nfDb: number; // receiver noise figure
  elemGainDbi: number; // gain of one antenna element at broadside
  removal: Removal;
  window: boolean; // Hann windows in the coarse (FFT) stage
  fov: number; // half field of view, radians
  rView: number; // largest range the fusion centre cares about, m
  thresholdDb: number; // detection threshold above the median noise floor
}

export interface Derived {
  lambda: number;
  T: number;
  Tcp: number;
  Tsym: number;
  B: number;
  dR: number; // range resolution c/2B
  Rmax: number; // unambiguous range c/2Δf
  Rcp: number; // CP-limited range
  dV: number; // velocity resolution
  Vmax: number; // unambiguous radial speed
  hpbw: number; // array half-power beamwidth at broadside, rad (uniform weights)
}

export function derive(cfg: CoopConfig): Derived {
  const lambda = C / cfg.fc;
  const T = 1 / cfg.df;
  const Tcp = cfg.cpRatio * T;
  const Tsym = T + Tcp;
  const B = cfg.N * cfg.df;
  return {
    lambda,
    T,
    Tcp,
    Tsym,
    B,
    dR: C / (2 * B),
    Rmax: C / (2 * cfg.df),
    Rcp: (C * Tcp) / 2,
    dV: lambda / (2 * cfg.M * Tsym),
    Vmax: lambda / (4 * Tsym),
    hpbw: cfg.Na > 1 ? Math.min(Math.PI, (0.886 * 2) / cfg.Na) : Math.PI,
  };
}

export const wrapPi = (a: number) => {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x < -Math.PI) x += 2 * Math.PI;
  return x;
};

export interface Geometry {
  R: number;
  bearing: number; // global direction BS -> object, rad
  theta: number; // angle off boresight, rad
  vr: number; // radial velocity, m/s (positive = moving away)
  inFov: boolean;
}

export function geometry(bs: BaseStation, o: { x: number; y: number; vx?: number; vy?: number }, fov: number): Geometry {
  const dx = o.x - bs.x;
  const dy = o.y - bs.y;
  const R = Math.max(1e-6, Math.hypot(dx, dy));
  const bearing = Math.atan2(dy, dx);
  const theta = wrapPi(bearing - bs.az);
  const vr = ((o.vx ?? 0) * dx + (o.vy ?? 0) * dy) / R;
  return { R, bearing, theta, vr, inFov: Math.abs(theta) <= fov };
}

/** Echo SNR in one resource element on one antenna (radar equation, monostatic). */
export function snrPerRe(cfg: CoopConfig, g: Geometry, rcsDb: number): number {
  if (!g.inFov) return 0;
  const lambda = C / cfg.fc;
  const pt = Math.pow(10, (cfg.ptDbm - 30) / 10);
  const ge = Math.pow(10, cfg.elemGainDbi / 10) * Math.max(0, Math.cos(g.theta)); // element pattern ~ cos θ
  const sigma = Math.pow(10, rcsDb / 10);
  const R = Math.max(g.R, 1);
  const pr = (pt * ge * ge * lambda * lambda * sigma) / (Math.pow(4 * Math.PI, 3) * Math.pow(R, 4));
  const noise = K_BOLTZMANN * 290 * Math.pow(10, cfg.nfDb / 10) * cfg.N * cfg.df;
  return pr / noise;
}

/** Amplitude loss when the round-trip delay exceeds the cyclic prefix. */
export function cpFactor(cfg: CoopConfig, R: number): number {
  const d = derive(cfg);
  const tau = (2 * R) / C;
  return tau > d.Tcp ? Math.max(0, 1 - (tau - d.Tcp) / d.T) : 1;
}

/** Integrated SNR (all N·M·Na cells added coherently, known data). */
export function snrIntegrated(cfg: CoopConfig, g: Geometry, rcsDb: number): number {
  const cp = cpFactor(cfg, g.R);
  return snrPerRe(cfg, g, rcsDb) * cp * cp * cfg.N * cfg.M * cfg.Na;
}

/** Single-target CRLB standard deviations for range, angle and radial velocity. */
export function measurementSigmas(cfg: CoopConfig, snrInt: number, theta: number) {
  const d = derive(cfg);
  const s = Math.max(snrInt, 1e-12);
  const sigR = (C / 2 / (2 * Math.PI * cfg.df)) * Math.sqrt(6 / (s * (cfg.N * cfg.N - 1)));
  const sigS = cfg.Na > 1 ? Math.sqrt(6 / (s * (cfg.Na * cfg.Na - 1))) / Math.PI : Infinity;
  const sigTheta = sigS / Math.max(0.05, Math.cos(theta));
  const sigV = cfg.M > 1 ? (d.lambda / 2 / (2 * Math.PI * d.Tsym)) * Math.sqrt(6 / (s * (cfg.M * cfg.M - 1))) : Infinity;
  return { sigR, sigTheta, sigV };
}

export interface Detection {
  R: number;
  theta: number;
  bearing: number;
  vr: number;
  snrDb: number; // estimated integrated SNR
  sigR: number;
  sigTheta: number;
  sigV: number;
}

export interface BsResult {
  dets: Detection[];
  ra: Float64Array; // range-angle power / noise floor, rows = Pa sin-θ bins (row 0: sinθ = -1), cols = Kr range bins
  Pa: number;
  Kr: number;
  rBin: number; // metres per range bin
}

/** Maximise f on [a, b] by golden-section search. */
function goldenMax(f: (x: number) => number, a: number, b: number, iters = 30): number {
  const g = (Math.sqrt(5) - 1) / 2;
  let x1 = b - g * (b - a);
  let x2 = a + g * (b - a);
  let f1 = f(x1);
  let f2 = f(x2);
  for (let i = 0; i < iters; i++) {
    if (f1 < f2) {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + g * (b - a);
      f2 = f(x2);
    } else {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - g * (b - a);
      f1 = f(x1);
    }
  }
  return (a + b) / 2;
}

/** |Σ v[i] e^{j w i}|² using a rotating phasor. */
function dtftPow(vr: Float64Array, vi: Float64Array, w: number): number {
  const cs = Math.cos(w);
  const sn = Math.sin(w);
  let cr = 1;
  let ci = 0;
  let ar = 0;
  let ai = 0;
  for (let i = 0; i < vr.length; i++) {
    ar += vr[i] * cr - vi[i] * ci;
    ai += vr[i] * ci + vi[i] * cr;
    const t = cr * cs - ci * sn;
    ci = cr * sn + ci * cs;
    cr = t;
  }
  return ar * ar + ai * ai;
}

function phasors(n: number, w: number): [Float64Array, Float64Array] {
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    re[i] = Math.cos(w * i);
    im[i] = Math.sin(w * i);
  }
  return [re, im];
}

const hann = (n: number, on: boolean) => {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = on && n > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / n) : 1;
  return w;
};

/**
 * Simulate one monostatic BS: generate the echo cube, remove the data, run the
 * range / Doppler / angle FFTs, detect peaks and refine each one.
 */
export function simulateBs(cfg: CoopConfig, cons: Constellation, bs: BaseStation, objs: SceneObject[], rng: Rng): BsResult {
  const { N, M, Na, df } = cfg;
  const d = derive(cfg);
  const NM = N * M;
  const cells = NM * Na;
  const Pn = 2 * N;
  const Pm = Math.max(2, 2 * M);
  const Pa = 64;
  const rBin = d.Rmax / Pn;
  const Kr = Math.min(Pn, Math.ceil(cfg.rView / rBin) + 3);

  // Transmitted data (same on every receive antenna).
  const Xr = new Float64Array(NM);
  const Xi = new Float64Array(NM);
  const nsym = 1 << cons.k;
  for (let i = 0; i < NM; i++) {
    const s = rng.int(nsym);
    Xr[i] = cons.re[s];
    Xi[i] = cons.im[s];
  }

  // Channel H[a,m,n] = Σ amp · e^{-j2πnΔfτ} · e^{+j2πmT fD} · e^{+jπ a sinθ}
  const Hr = new Float64Array(cells);
  const Hi = new Float64Array(cells);
  for (const o of objs) {
    const g = geometry(bs, o, cfg.fov);
    if (!g.inFov) continue;
    const amp = Math.sqrt(snrPerRe(cfg, g, o.rcs)) * cpFactor(cfg, g.R);
    if (amp <= 0) continue;
    const tau = (2 * g.R) / C;
    const fD = (-2 * g.vr) / d.lambda;
    const [enr, eni] = phasors(N, -2 * Math.PI * df * tau);
    const [emr, emi] = phasors(M, 2 * Math.PI * d.Tsym * fD);
    const [ear, eai] = phasors(Na, Math.PI * Math.sin(g.theta));
    const ph0 = 2 * Math.PI * rng.uniform();
    const c0r = amp * Math.cos(ph0);
    const c0i = amp * Math.sin(ph0);
    for (let a = 0; a < Na; a++) {
      const ar = c0r * ear[a] - c0i * eai[a];
      const ai = c0r * eai[a] + c0i * ear[a];
      for (let m = 0; m < M; m++) {
        const br = ar * emr[m] - ai * emi[m];
        const bi = ar * emi[m] + ai * emr[m];
        const base = (a * M + m) * N;
        for (let n = 0; n < N; n++) {
          Hr[base + n] += br * enr[n] - bi * eni[n];
          Hi[base + n] += br * eni[n] + bi * enr[n];
        }
      }
    }
  }

  // Y = X·H + w, then data removal → Z (reuse H arrays).
  const ns = Math.SQRT1_2;
  let noiseSum = 0; // Σ of per-cell noise variance after removal (for SNR estimates)
  let sigSum = 0; // Σ of per-cell signal gain after removal
  for (let a = 0; a < Na; a++) {
    for (let mn = 0; mn < NM; mn++) {
      const i = a * NM + mn;
      const xr = Xr[mn];
      const xi = Xi[mn];
      const yr = xr * Hr[i] - xi * Hi[i] + ns * rng.gauss();
      const yi = xr * Hi[i] + xi * Hr[i] + ns * rng.gauss();
      const e = xr * xr + xi * xi;
      if (cfg.removal === 'reciprocal') {
        Hr[i] = (yr * xr + yi * xi) / e;
        Hi[i] = (yi * xr - yr * xi) / e;
        if (a === 0) {
          noiseSum += 1 / e;
          sigSum += 1;
        }
      } else {
        Hr[i] = yr * xr + yi * xi;
        Hi[i] = yi * xr - yr * xi;
        if (a === 0) {
          noiseSum += e;
          sigSum += e;
        }
      }
    }
  }
  noiseSum *= Na;
  sigSum *= Na;
  const Zr = Hr;
  const Zi = Hi;

  // Coarse stage: windowed FFTs.
  const wn = hann(N, cfg.window);
  const wm = hann(M, cfg.window);
  const wa = hann(Na, cfg.window);
  // range: IFFT over n for each (a, m); keep the first Kr bins → R1[(a*M+m)*Kr + r]
  const R1r = new Float64Array(Na * M * Kr);
  const R1i = new Float64Array(Na * M * Kr);
  const bufR = new Float64Array(Pn);
  const bufI = new Float64Array(Pn);
  for (let a = 0; a < Na; a++) {
    for (let m = 0; m < M; m++) {
      bufR.fill(0);
      bufI.fill(0);
      const base = (a * M + m) * N;
      const w = wm[m] * wa[a];
      for (let n = 0; n < N; n++) {
        bufR[n] = Zr[base + n] * wn[n] * w;
        bufI[n] = Zi[base + n] * wn[n] * w;
      }
      fft(bufR, bufI, true);
      const o = (a * M + m) * Kr;
      for (let r = 0; r < Kr; r++) {
        R1r[o + r] = bufR[r] * Pn; // undo the 1/n scaling of the inverse FFT
        R1i[o + r] = bufI[r] * Pn;
      }
    }
  }
  // Doppler: FFT over m for each (a, r) → cube[(a*Pm+q)*Kr + r]
  const Cr = new Float64Array(Na * Pm * Kr);
  const Ci = new Float64Array(Na * Pm * Kr);
  const dR = new Float64Array(Pm);
  const dI = new Float64Array(Pm);
  for (let a = 0; a < Na; a++) {
    for (let r = 0; r < Kr; r++) {
      dR.fill(0);
      dI.fill(0);
      for (let m = 0; m < M; m++) {
        dR[m] = R1r[(a * M + m) * Kr + r];
        dI[m] = R1i[(a * M + m) * Kr + r];
      }
      fft(dR, dI);
      for (let q = 0; q < Pm; q++) {
        Cr[(a * Pm + q) * Kr + r] = dR[q];
        Ci[(a * Pm + q) * Kr + r] = dI[q];
      }
    }
  }
  // Range-Doppler power, summed over antennas
  const rd = new Float64Array(Pm * Kr);
  for (let a = 0; a < Na; a++)
    for (let i = 0; i < Pm * Kr; i++) {
      const j = a * Pm * Kr + i;
      rd[i] += Cr[j] * Cr[j] + Ci[j] * Ci[j];
    }
  const floor = Float64Array.from(rd).sort()[Math.floor(rd.length / 2)] || 1e-30;
  const thr = floor * Math.pow(10, cfg.thresholdDb / 10);

  const angleSpectrum = (q: number, r: number): Float64Array => {
    const re = new Float64Array(Pa);
    const im = new Float64Array(Pa);
    for (let a = 0; a < Na; a++) {
      re[a] = Cr[(a * Pm + q) * Kr + r];
      im[a] = Ci[(a * Pm + q) * Kr + r];
    }
    fft(re, im);
    const p = new Float64Array(Pa);
    for (let k = 0; k < Pa; k++) p[(k + Pa / 2) % Pa] = re[k] * re[k] + im[k] * im[k]; // row 0 ↔ sinθ = -1
    return p;
  };

  // Range-angle map: for each range bin, the angle spectrum at its strongest Doppler bin.
  const ra = new Float64Array(Pa * Kr);
  for (let r = 0; r < Kr; r++) {
    let qb = 0;
    for (let q = 1; q < Pm; q++) if (rd[q * Kr + r] > rd[qb * Kr + r]) qb = q;
    const p = angleSpectrum(qb, r);
    for (let k = 0; k < Pa; k++) ra[k * Kr + r] = p[k];
  }
  const raFloor = Float64Array.from(ra).sort()[Math.floor(ra.length / 2)] || 1e-30;
  for (let i = 0; i < ra.length; i++) ra[i] /= raFloor;

  // Detection: local maxima in the range-Doppler map, then peaks in angle.
  type Coarse = { r: number; q: number; k: number; p: number };
  const coarse: Coarse[] = [];
  for (let r = 1; r < Kr - 1; r++) {
    for (let q = 0; q < Pm; q++) {
      const v = rd[q * Kr + r];
      if (v < thr) continue;
      let isMax = true;
      for (let dq = -1; dq <= 1 && isMax; dq++)
        for (let dr = -1; dr <= 1; dr++) {
          if (!dq && !dr) continue;
          const qq = (q + dq + Pm) % Pm;
          if (rd[qq * Kr + r + dr] > v) {
            isMax = false;
            break;
          }
        }
      if (!isMax) continue;
      if (Na === 1) {
        coarse.push({ r, q, k: Pa / 2, p: v });
        continue;
      }
      const sp = angleSpectrum(q, r);
      let best = 0;
      for (let k = 0; k < Pa; k++) best = Math.max(best, sp[k]);
      for (let k = 0; k < Pa; k++) {
        const v0 = sp[k];
        if (v0 < best * 0.03) continue; // within 15 dB of the strongest direction in this cell
        if (v0 >= sp[(k + 1) % Pa] && v0 > sp[(k - 1 + Pa) % Pa]) coarse.push({ r, q, k, p: v0 });
      }
    }
  }
  coarse.sort((a, b) => b.p - a.p);
  const picked = coarse.slice(0, 8);

  // Fine stage: collapse the unwindowed cube onto each axis and maximise each 1-D periodogram.
  const dets: Detection[] = [];
  for (const cd of picked) {
    const tau0 = cd.r / (Pn * df);
    const q0 = cd.q >= Pm / 2 ? cd.q - Pm : cd.q;
    const f0 = q0 / (Pm * d.Tsym);
    const s0 = Na > 1 ? (2 * (cd.k - Pa / 2)) / Pa : 0;
    const [enr, eni] = phasors(N, -2 * Math.PI * df * tau0);
    const [emr, emi] = phasors(M, 2 * Math.PI * d.Tsym * f0);
    const [ear, eai] = phasors(Na, Math.PI * s0);
    const vnr = new Float64Array(N);
    const vni = new Float64Array(N);
    const vmr = new Float64Array(M);
    const vmi = new Float64Array(M);
    const var_ = new Float64Array(Na);
    const vai = new Float64Array(Na);
    for (let a = 0; a < Na; a++) {
      for (let m = 0; m < M; m++) {
        // conj(ea·em)
        const pr = ear[a] * emr[m] - eai[a] * emi[m];
        const pi = -(ear[a] * emi[m] + eai[a] * emr[m]);
        const base = (a * M + m) * N;
        let smr = 0;
        let smi = 0;
        let sar = 0;
        let sai = 0;
        for (let n = 0; n < N; n++) {
          const zr = Zr[base + n];
          const zi = Zi[base + n];
          vnr[n] += zr * pr - zi * pi;
          vni[n] += zr * pi + zi * pr;
          // conj(en)
          const tr = zr * enr[n] + zi * eni[n];
          const ti = zi * enr[n] - zr * eni[n];
          smr += tr;
          smi += ti;
        }
        // into vm: multiply by conj(ea)
        vmr[m] += smr * ear[a] + smi * eai[a];
        vmi[m] += smi * ear[a] - smr * eai[a];
        // into va: multiply by conj(em)
        sar = smr * emr[m] + smi * emi[m];
        sai = smi * emr[m] - smr * emi[m];
        var_[a] += sar;
        vai[a] += sai;
      }
    }
    const binT = 1 / (Pn * df);
    const tau = goldenMax((t) => dtftPow(vnr, vni, 2 * Math.PI * df * t), tau0 - binT, tau0 + binT);
    const binF = 1 / (Pm * d.Tsym);
    const fD = M > 1 ? goldenMax((f) => dtftPow(vmr, vmi, -2 * Math.PI * d.Tsym * f), f0 - binF, f0 + binF) : 0;
    let s = 0;
    if (Na > 1) {
      const binS = 2 / Pa;
      s = goldenMax((x) => dtftPow(var_, vai, -Math.PI * x), s0 - binS, s0 + binS);
      s = Math.max(-1, Math.min(1, s));
    }
    // Coherent sum with all three refined phasors → integrated SNR estimate.
    // Signal part = sigSum·h, noise variance = noiseSum (both known from the data X).
    const [fnr, fni] = phasors(N, -2 * Math.PI * df * tau);
    const [fmr, fmi] = phasors(M, 2 * Math.PI * d.Tsym * fD);
    const [far, fai] = phasors(Na, Math.PI * s);
    let Sr = 0;
    let Si = 0;
    for (let a = 0; a < Na; a++)
      for (let m = 0; m < M; m++) {
        const base = (a * M + m) * N;
        let tr = 0;
        let ti = 0;
        for (let n = 0; n < N; n++) {
          const zr = Zr[base + n];
          const zi = Zi[base + n];
          tr += zr * fnr[n] + zi * fni[n];
          ti += zi * fnr[n] - zr * fni[n];
        }
        // × conj(ea·em)
        const pr = far[a] * fmr[m] - fai[a] * fmi[m];
        const pi = far[a] * fmi[m] + fai[a] * fmr[m];
        Sr += tr * pr + ti * pi;
        Si += ti * pr - tr * pi;
      }
    const snr = Math.max(1e-3, (Sr * Sr + Si * Si - noiseSum) / noiseSum);
    const R = (C * Math.max(0, tau)) / 2;
    const theta = Math.asin(s);
    const vr = (-fD * d.lambda) / 2;
    const sig = measurementSigmas(cfg, snr, theta);
    dets.push({ R, theta, bearing: wrapPi(bs.az + theta), vr, snrDb: 10 * Math.log10(snr), ...sig });
  }
  return { dets, ra, Pa, Kr, rBin };
}

// ---------------------------------------------------------------- fusion

export type Method = 'single' | 'grid' | 'range' | 'angle' | 'both';
export const METHODS: Method[] = ['single', 'grid', 'range', 'angle', 'both'];
export const METHOD_LABEL: Record<Method, string> = {
  single: 'Best single BS',
  grid: 'Grid map fusion (coarse)',
  range: 'WLS: ranges only',
  angle: 'WLS: angles only',
  both: 'WLS: range + angle',
};

export interface Est {
  x: number;
  y: number;
  cov?: [number, number, number]; // [σxx², σxy, σyy²] predicted by the WLS
}

export interface Meas {
  bs: number; // station index
  det: Detection;
}

export interface Candidate {
  x: number;
  y: number;
  score: number;
  meas: Meas[];
  est: Partial<Record<Method, Est>>;
  vel: { vx: number; vy: number } | null;
}

/** Gauss-Newton weighted least squares for a 2-D position. */
export function wls(bss: BaseStation[], meas: Meas[], init: [number, number], mode: 'range' | 'angle' | 'both'): Est | null {
  let [x, y] = init;
  const useR = mode !== 'angle';
  const useA = mode !== 'range';
  let rows = 0;
  for (const m of meas) rows += (useR ? 1 : 0) + (useA && isFinite(m.det.sigTheta) ? 1 : 0);
  if (rows < 2) return null;
  let cov: [number, number, number] | undefined;
  for (let it = 0; it < 20; it++) {
    let a11 = 0;
    let a12 = 0;
    let a22 = 0;
    let b1 = 0;
    let b2 = 0;
    for (const m of meas) {
      const p = bss[m.bs];
      const dx = x - p.x;
      const dy = y - p.y;
      const R = Math.max(1e-6, Math.hypot(dx, dy));
      if (useR) {
        const w = 1 / (m.det.sigR * m.det.sigR);
        const hx = dx / R;
        const hy = dy / R;
        const res = m.det.R - R;
        a11 += w * hx * hx;
        a12 += w * hx * hy;
        a22 += w * hy * hy;
        b1 += w * hx * res;
        b2 += w * hy * res;
      }
      if (useA && isFinite(m.det.sigTheta)) {
        const w = 1 / (m.det.sigTheta * m.det.sigTheta);
        const hx = -dy / (R * R);
        const hy = dx / (R * R);
        const res = wrapPi(m.det.bearing - Math.atan2(dy, dx));
        a11 += w * hx * hx;
        a12 += w * hx * hy;
        a22 += w * hy * hy;
        b1 += w * hx * res;
        b2 += w * hy * res;
      }
    }
    const det = a11 * a22 - a12 * a12;
    if (!(det > 0) || !isFinite(det) || det < 1e-18 * (a11 * a22 + 1e-300)) return null;
    const ix = (a22 * b1 - a12 * b2) / det;
    const iy = (a11 * b2 - a12 * b1) / det;
    x += ix;
    y += iy;
    cov = [a22 / det, -a12 / det, a11 / det];
    if (Math.hypot(ix, iy) < 1e-7) break;
  }
  if (!isFinite(x) || !isFinite(y)) return null;
  return { x, y, cov };
}

/** Radial velocities from ≥2 stations → velocity vector (WLS). */
function fuseVelocity(bss: BaseStation[], meas: Meas[], pos: [number, number]) {
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let b1 = 0;
  let b2 = 0;
  for (const m of meas) {
    const p = bss[m.bs];
    const dx = pos[0] - p.x;
    const dy = pos[1] - p.y;
    const R = Math.max(1e-6, Math.hypot(dx, dy));
    const ux = dx / R;
    const uy = dy / R;
    const w = 1 / (m.det.sigV * m.det.sigV);
    a11 += w * ux * ux;
    a12 += w * ux * uy;
    a22 += w * uy * uy;
    b1 += w * ux * m.det.vr;
    b2 += w * uy * m.det.vr;
  }
  const det = a11 * a22 - a12 * a12;
  if (meas.length < 2 || !(det > 1e-9 * (a11 * a22))) return null;
  return { vx: (a22 * b1 - a12 * b2) / det, vy: (a11 * b2 - a12 * b1) / det };
}

export interface FusionResult {
  map: Float64Array; // rows × cols, row 0 at y = 0
  rows: number;
  cols: number;
  cands: Candidate[];
}

/**
 * Two-stage fusion over the stations in `active`.
 * Stage 1 sums each station's range-angle map (in dB above its noise floor)
 * on an x-y grid. Stage 2 refines every grid peak with WLS.
 */
export function fuse(cfg: CoopConfig, bss: BaseStation[], res: BsResult[], active: number[], W: number, gridN = 160): FusionResult {
  const d = derive(cfg);
  const rows = gridN;
  const cols = gridN;
  const cell = W / gridN;
  const map = new Float64Array(rows * cols);
  const cosFov = Math.cos(cfg.fov);
  for (const b of active) {
    const p = bss[b];
    const rr = res[b];
    const bx = Math.cos(p.az);
    const by = Math.sin(p.az);
    for (let j = 0; j < rows; j++) {
      const y = (j + 0.5) * cell - p.y;
      for (let i = 0; i < cols; i++) {
        const x = (i + 0.5) * cell - p.x;
        const R = Math.hypot(x, y);
        if (R < 1e-6) continue;
        const c = (x * bx + y * by) / R;
        if (c < cosFov) continue;
        const s = (-x * by + y * bx) / R; // sin θ
        const rb = Math.round(R / rr.rBin);
        if (rb >= rr.Kr) continue;
        let k = Math.round(((s + 1) / 2) * rr.Pa);
        if (k >= rr.Pa) k = rr.Pa - 1;
        const v = rr.ra[k * rr.Kr + rb];
        map[j * cols + i] += Math.min(40, Math.max(0, 10 * Math.log10(v)));
      }
    }
  }

  // Peaks of the fused map
  let mx = 0;
  for (let i = 0; i < map.length; i++) mx = Math.max(mx, map[i]);
  const minScore = Math.max(cfg.thresholdDb, 0.35 * mx);
  const peaks: { x: number; y: number; score: number }[] = [];
  for (let j = 1; j < rows - 1; j++)
    for (let i = 1; i < cols - 1; i++) {
      const v = map[j * cols + i];
      if (v < minScore) continue;
      let isMax = true;
      for (let dj = -1; dj <= 1 && isMax; dj++)
        for (let di = -1; di <= 1; di++) {
          if ((di || dj) && map[(j + dj) * cols + i + di] > v) {
            isMax = false;
            break;
          }
        }
      if (isMax) peaks.push({ x: (i + 0.5) * cell, y: (j + 0.5) * cell, score: v });
    }
  peaks.sort((a, b) => b.score - a.score);
  const kept: typeof peaks = [];
  const sep = Math.max(1.5 * d.dR, 2 * cell);
  for (const pk of peaks) {
    if (kept.every((k) => Math.hypot(k.x - pk.x, k.y - pk.y) > sep)) kept.push(pk);
    if (kept.length >= 5) break;
  }

  // Stage 2: associate and refine
  const cands: Candidate[] = [];
  for (const pk of kept) {
    const meas: Meas[] = [];
    for (const b of active) {
      const g = geometry(bss[b], pk, cfg.fov);
      const gateR = 1.5 * d.dR + 2 * cell;
      const gateA = Math.max(d.hpbw / Math.max(0.2, Math.cos(g.theta)), (2 * cell) / g.R);
      let best: Detection | null = null;
      let bestD = 1;
      for (const det of res[b].dets) {
        const dr = (det.R - g.R) / gateR;
        const da = cfg.Na > 1 ? wrapPi(det.bearing - g.bearing) / gateA : 0;
        const dd = dr * dr + da * da;
        if (dd < bestD) {
          bestD = dd;
          best = det;
        }
      }
      if (best) meas.push({ bs: b, det: best });
    }
    const est: Partial<Record<Method, Est>> = { grid: { x: pk.x, y: pk.y } };
    if (meas.length) {
      const top = meas.reduce((a, b) => (b.det.snrDb > a.det.snrDb ? b : a));
      if (cfg.Na > 1) {
        const p = bss[top.bs];
        est.single = { x: p.x + top.det.R * Math.cos(top.det.bearing), y: p.y + top.det.R * Math.sin(top.det.bearing) };
      }
      const r = wls(bss, meas, [pk.x, pk.y], 'range');
      if (r && meas.length >= 2) est.range = r;
      const a = cfg.Na > 1 ? wls(bss, meas, [pk.x, pk.y], 'angle') : null;
      if (a && meas.length >= 2) est.angle = a;
      const bth = wls(bss, meas, [pk.x, pk.y], 'both');
      if (bth) est.both = bth;
    }
    const ref = est.both ?? est.range ?? est.grid!;
    // Side-peaks of the same object refine to the same point: keep only the first (strongest).
    if (cands.some((c) => {
      const e = c.est.both ?? c.est.range ?? c.est.grid!;
      return Math.hypot(e.x - ref.x, e.y - ref.y) < sep;
    })) continue;
    cands.push({ x: pk.x, y: pk.y, score: pk.score, meas, est, vel: fuseVelocity(bss, meas, [ref.x, ref.y]) });
  }
  return { map, rows, cols, cands };
}

/** Position CRLB (2-D) from the stations in `active` that can detect the object. */
export function positionCrlb(cfg: CoopConfig, bss: BaseStation[], active: number[], o: SceneObject, mode: 'range' | 'angle' | 'both') {
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  let used = 0;
  for (const b of active) {
    const g = geometry(bss[b], o, cfg.fov);
    if (!g.inFov) continue;
    const snr = snrIntegrated(cfg, g, o.rcs);
    if (10 * Math.log10(Math.max(snr, 1e-30)) < cfg.thresholdDb) continue;
    used++;
    const s = measurementSigmas(cfg, snr, g.theta);
    const ux = Math.cos(g.bearing);
    const uy = Math.sin(g.bearing);
    if (mode !== 'angle') {
      const w = 1 / (s.sigR * s.sigR);
      a11 += w * ux * ux;
      a12 += w * ux * uy;
      a22 += w * uy * uy;
    }
    if (mode !== 'range' && isFinite(s.sigTheta)) {
      const w = 1 / (g.R * g.R * s.sigTheta * s.sigTheta);
      a11 += w * uy * uy;
      a12 -= w * ux * uy;
      a22 += w * ux * ux;
    }
  }
  const det = a11 * a22 - a12 * a12;
  if (!(det > 1e-12 * (a11 * a22)) || !isFinite(det) || det <= 0) return { rmse: Infinity, cov: null as [number, number, number] | null, used };
  const cov: [number, number, number] = [a22 / det, -a12 / det, a11 / det];
  return { rmse: Math.sqrt(cov[0] + cov[2]), cov, used };
}

/** Geometric dilution of precision for range-only positioning (unit range errors). */
export function gdop(bss: BaseStation[], active: number[], o: { x: number; y: number }, fov: number) {
  let a11 = 0;
  let a12 = 0;
  let a22 = 0;
  for (const b of active) {
    const g = geometry(bss[b], o, fov);
    if (!g.inFov) continue;
    const ux = Math.cos(g.bearing);
    const uy = Math.sin(g.bearing);
    a11 += ux * ux;
    a12 += ux * uy;
    a22 += uy * uy;
  }
  const det = a11 * a22 - a12 * a12;
  if (!(det > 1e-9)) return Infinity;
  return Math.sqrt((a11 + a22) / det);
}

/** Effective SNR loss of the reciprocal-filter estimator for a constellation (dB). */
export function reciprocalLossDb(cons: Constellation) {
  let s = 0;
  for (let i = 0; i < cons.re.length; i++) s += 1 / (cons.re[i] ** 2 + cons.im[i] ** 2);
  return 10 * Math.log10(s / cons.re.length);
}
