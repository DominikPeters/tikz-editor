/** Require an internal invariant without discarding nullability checks at callers. */
export function requireDefined<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}
