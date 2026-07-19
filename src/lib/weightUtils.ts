/**
 * Rounds net weight based on the user's specific rules:
 * - If the fractional part is exactly 0.5, returns the weight as is (e.g. 65.5).
 * - If the fractional part is > 0.5 (e.g. 65.56), rounds up to the nearest integer (66).
 * - If the fractional part is < 0.5 (e.g. 64.4), rounds down to the nearest integer (64).
 */
export function roundNetWeight(weight: number): number {
  if (weight < 0) return 0;
  const fraction = weight - Math.floor(weight);
  if (Math.abs(fraction - 0.5) < 0.001) {
    return Math.floor(weight) + 0.5;
  } else if (fraction > 0.5) {
    return Math.ceil(weight);
  } else {
    return Math.floor(weight);
  }
}
