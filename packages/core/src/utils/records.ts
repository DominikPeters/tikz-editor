/** Narrow a non-null object to properties that must each be checked before use. */
export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
