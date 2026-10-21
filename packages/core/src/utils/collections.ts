/** Read a required entry from an internally constructed collection. */
export function requireArrayValue<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new RangeError(`Missing required collection entry at index ${index}`);
  }
  return value;
}
