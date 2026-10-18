/** Largest magnitude the API accepts for a big number. */
export const BIG_NUMBER_LIMIT = 1e15;

/** Decimal places `value` was written with (at most 6), so formatting never rounds it. */
export function fractionDigits(value: number): number {
  const text = String(Math.abs(value));
  if (text.includes("e")) return 0;
  return Math.min(text.split(".")[1]?.length ?? 0, 6);
}
