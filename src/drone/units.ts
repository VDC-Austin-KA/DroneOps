// US-customary unit helpers. The engine computes in SI (metres, m/s) because the
// geodetic math requires it; everything the operator *sees or types* is in US feet,
// miles and miles-per-hour. Convert only at the UI / string boundary.

export const M_PER_FT = 0.3048;
export const FT_PER_M = 1 / M_PER_FT;          // 3.28084
export const MPH_PER_MPS = 2.2369362920544;
export const FT_PER_MILE = 5280;

/** metres → feet */
export const mToFt = (m: number) => m * FT_PER_M;
/** feet → metres */
export const ftToM = (ft: number) => ft * M_PER_FT;
/** metres/second → miles/hour */
export const mpsToMph = (v: number) => v * MPH_PER_MPS;
/** miles/hour → metres/second */
export const mphToMps = (v: number) => v / MPH_PER_MPS;

/** Round metres to whole feet for display. */
export const ftRound = (m: number) => Math.round(m * FT_PER_M);

/** "123 ft" from metres. */
export const fmtFt = (m: number) => `${Math.round(m * FT_PER_M).toLocaleString()} ft`;

/** Distance from metres: feet under ~1000 ft, otherwise miles. */
export function fmtDist(m: number): string {
  const ft = m * FT_PER_M;
  if (ft < 1000) return `${Math.round(ft).toLocaleString()} ft`;
  return `${(ft / FT_PER_MILE).toFixed(2)} mi`;
}

/** "12 mph" from metres/second. */
export const fmtMph = (mps: number) => `${Math.round(mps * MPH_PER_MPS)} mph`;
