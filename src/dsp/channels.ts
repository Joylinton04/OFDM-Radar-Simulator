// Tapped-delay-line multipath profiles (delays in µs, powers in dB).
// Shapes follow the 3GPP EPA / EVA / ETU models.
export const PROFILES: Record<string, { d: number[]; p: number[] }> = {
  'LOS only': { d: [0], p: [0] },
  'Indoor (office)': { d: [0, 0.03, 0.07, 0.09, 0.11, 0.19, 0.41], p: [0, -1, -2, -3, -8, -17.2, -20.8] },
  'Urban (vehicular)': { d: [0, 0.03, 0.15, 0.31, 0.37, 0.71, 1.09, 1.73, 2.51], p: [0, -1.5, -1.4, -3.6, -0.6, -9.1, -7, -12, -16.9] },
  'Hilly (typical urban)': { d: [0, 0.05, 0.12, 0.2, 0.23, 0.5, 1.6, 2.3, 5.0], p: [-1, -1, -1, 0, 0, 0, -3, -5, -7] },
};
export const PROFILE_NAMES = Object.keys(PROFILES);
