export const C = 299_792_458; // speed of light, m/s
export const K_BOLTZMANN = 1.380649e-23;

export const db = (x: number) => 10 * Math.log10(Math.max(x, 1e-300));
export const undb = (x: number) => Math.pow(10, x / 10);
export const dbm2w = (dbm: number) => Math.pow(10, (dbm - 30) / 10);
export const w2dbm = (w: number) => 10 * Math.log10(Math.max(w, 1e-300)) + 30;

const PREFIX: [number, string][] = [
  [1e12, 'T'],
  [1e9, 'G'],
  [1e6, 'M'],
  [1e3, 'k'],
  [1, ''],
  [1e-3, 'm'],
  [1e-6, 'µ'],
  [1e-9, 'n'],
  [1e-12, 'p'],
];

/** Format a number with an SI prefix, e.g. si(2.5e6,'Hz') -> "2.5 MHz". */
export function si(value: number, unit: string, digits = 3): string {
  if (!isFinite(value)) return `∞ ${unit}`;
  if (value === 0) return `0 ${unit}`;
  const abs = Math.abs(value);
  for (const [scale, p] of PREFIX) {
    if (abs >= scale * 0.9995) {
      return `${trim(value / scale, digits)} ${p}${unit}`;
    }
  }
  return `${value.toExponential(2)} ${unit}`;
}

export function trim(v: number, digits = 3): string {
  if (!isFinite(v)) return '∞';
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  return Number(v.toPrecision(digits)).toString();
}

export function fmtDb(v: number, digits = 1): string {
  if (!isFinite(v)) return v > 0 ? '∞ dB' : '−∞ dB';
  return `${v.toFixed(digits)} dB`;
}

/** Complementary error function (Numerical Recipes approximation, ~1e-7). */
export function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

/** Gaussian Q-function. */
export const qfunc = (x: number) => 0.5 * erfc(x / Math.SQRT2);
