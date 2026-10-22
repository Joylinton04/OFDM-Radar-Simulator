import { qfunc } from './units';
import { Rng } from './random';

export type ModName = 'BPSK' | 'QPSK' | '16-QAM' | '64-QAM' | '256-QAM';
export const MODS: ModName[] = ['BPSK', 'QPSK', '16-QAM', '64-QAM', '256-QAM'];

export const bitsPerSymbol: Record<ModName, number> = {
  BPSK: 1,
  QPSK: 2,
  '16-QAM': 4,
  '64-QAM': 6,
  '256-QAM': 8,
};

export interface Constellation {
  name: ModName;
  k: number; // bits per symbol
  re: Float64Array; // points, unit average energy
  im: Float64Array;
}

function gray(n: number) {
  return n ^ (n >> 1);
}

const cache = new Map<ModName, Constellation>();

/** Gray-coded square constellation normalised to unit average energy. */
export function constellation(name: ModName): Constellation {
  const hit = cache.get(name);
  if (hit) return hit;
  const k = bitsPerSymbol[name];
  const M = 1 << k;
  const re = new Float64Array(M);
  const im = new Float64Array(M);
  if (name === 'BPSK') {
    re[0] = -1;
    re[1] = 1;
  } else {
    const kh = k / 2;
    const side = 1 << kh;
    // Map Gray index -> amplitude level so neighbours differ by one bit.
    const levelOf = new Array<number>(side);
    for (let i = 0; i < side; i++) levelOf[gray(i)] = 2 * i - (side - 1);
    let es = 0;
    for (let s = 0; s < M; s++) {
      const iBits = s >> kh;
      const qBits = s & (side - 1);
      re[s] = levelOf[iBits];
      im[s] = levelOf[qBits];
      es += re[s] * re[s] + im[s] * im[s];
    }
    const norm = Math.sqrt(es / M);
    for (let s = 0; s < M; s++) {
      re[s] /= norm;
      im[s] /= norm;
    }
  }
  const c = { name, k, re, im };
  cache.set(name, c);
  return c;
}

/** Nearest-point (maximum-likelihood under AWGN) decision. Returns symbol index. */
export function demap(c: Constellation, r: number, i: number): number {
  let best = 0;
  let bd = Infinity;
  for (let s = 0; s < c.re.length; s++) {
    const dr = r - c.re[s];
    const di = i - c.im[s];
    const d = dr * dr + di * di;
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

export function bitErrors(a: number, b: number): number {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += x & 1;
    x >>= 1;
  }
  return n;
}

/** Textbook BER under AWGN with Gray coding (approximation for M-QAM). */
export function theoreticalBer(name: ModName, ebn0Lin: number): number {
  const k = bitsPerSymbol[name];
  if (k <= 2) return qfunc(Math.sqrt(2 * ebn0Lin));
  const M = 1 << k;
  const ber = (4 / k) * (1 - 1 / Math.sqrt(M)) * qfunc(Math.sqrt((3 * k * ebn0Lin) / (M - 1)));
  return Math.min(ber, 0.5);
}

/** Random symbol indices. */
export function randomSymbols(rng: Rng, n: number, k: number): Int32Array {
  const out = new Int32Array(n);
  const M = 1 << k;
  for (let i = 0; i < n; i++) out[i] = rng.int(M);
  return out;
}

/** Peak-to-average power ratio (dB) of a complex sequence. */
export function paprDb(re: ArrayLike<number>, im: ArrayLike<number>): number {
  let peak = 0;
  let mean = 0;
  for (let i = 0; i < re.length; i++) {
    const p = re[i] * re[i] + im[i] * im[i];
    if (p > peak) peak = p;
    mean += p;
  }
  mean /= re.length;
  return 10 * Math.log10(peak / Math.max(mean, 1e-300));
}
