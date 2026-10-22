/**
 * Root-raised-cosine pulse, sampled at `sps` samples per symbol,
 * spanning `span` symbols either side. Normalised to unit energy.
 */
export function rrc(alpha: number, sps: number, span: number): Float64Array {
  const n = 2 * span * sps + 1;
  const h = new Float64Array(n);
  const a = Math.max(alpha, 1e-4);
  for (let i = 0; i < n; i++) {
    const t = (i - span * sps) / sps; // in symbol periods
    let v: number;
    if (Math.abs(t) < 1e-9) {
      v = 1 - a + (4 * a) / Math.PI;
    } else if (Math.abs(Math.abs(4 * a * t) - 1) < 1e-9) {
      v =
        (a / Math.SQRT2) *
        ((1 + 2 / Math.PI) * Math.sin(Math.PI / (4 * a)) + (1 - 2 / Math.PI) * Math.cos(Math.PI / (4 * a)));
    } else {
      const num = Math.sin(Math.PI * t * (1 - a)) + 4 * a * t * Math.cos(Math.PI * t * (1 + a));
      const den = Math.PI * t * (1 - (4 * a * t) ** 2);
      v = num / den;
    }
    h[i] = v;
  }
  let e = 0;
  for (let i = 0; i < n; i++) e += h[i] * h[i];
  const s = Math.sqrt(e);
  for (let i = 0; i < n; i++) h[i] /= s;
  return h;
}

/** Plain linear convolution, output length x.length + h.length - 1. */
export function convolve(x: ArrayLike<number>, h: ArrayLike<number>): Float64Array {
  const out = new Float64Array(x.length + h.length - 1);
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    if (xi === 0) continue;
    for (let j = 0; j < h.length; j++) out[i + j] += xi * h[j];
  }
  return out;
}
