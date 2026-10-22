// Radix-2 FFT working on separate real/imag arrays (in place).
// Length must be a power of two.

export function isPow2(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (!isPow2(n)) throw new Error(`FFT length ${n} is not a power of two`);

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }

  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

/** Swap halves so that DC sits in the middle (like MATLAB/NumPy fftshift). */
export function fftshift(a: Float64Array): Float64Array {
  const n = a.length;
  const out = new Float64Array(n);
  const h = Math.floor(n / 2);
  for (let i = 0; i < n; i++) out[i] = a[(i + h) % n];
  return out;
}

/**
 * Magnitude spectrum of a real signal, in dB or linear.
 * Returns one-sided frequencies [0, fs/2] and normalised power.
 */
export function realSpectrum(
  x: ArrayLike<number>,
  fs: number,
  opts: { pad?: number; window?: boolean } = {},
): { f: Float64Array; p: Float64Array } {
  const n = nextPow2(Math.max(x.length, 16) * (opts.pad ?? 1));
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const L = x.length;
  for (let i = 0; i < L; i++) {
    const w = opts.window ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (L - 1)) : 1;
    re[i] = x[i] * w;
  }
  fft(re, im);
  const half = n / 2;
  const f = new Float64Array(half + 1);
  const p = new Float64Array(half + 1);
  for (let k = 0; k <= half; k++) {
    f[k] = (k * fs) / n;
    p[k] = (re[k] * re[k] + im[k] * im[k]) / (L * L);
  }
  return { f, p };
}

/** Two-sided spectrum of a complex signal, fftshifted (frequencies -fs/2..fs/2). */
export function complexSpectrum(
  re0: ArrayLike<number>,
  im0: ArrayLike<number>,
  fs: number,
  pad = 1,
): { f: Float64Array; p: Float64Array } {
  const L = re0.length;
  const n = nextPow2(Math.max(L, 16) * pad);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < L; i++) {
    re[i] = re0[i];
    im[i] = im0[i];
  }
  fft(re, im);
  const p = new Float64Array(n);
  for (let k = 0; k < n; k++) p[k] = (re[k] * re[k] + im[k] * im[k]) / (L * L);
  const ps = fftshift(p);
  const f = new Float64Array(n);
  for (let k = 0; k < n; k++) f[k] = ((k - n / 2) * fs) / n;
  return { f, p: ps };
}
