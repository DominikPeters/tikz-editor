export function formatSvgNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const normalized = Math.abs(value) < 1e-9 ? 0 : value;
  return Number(normalized.toFixed(4)).toString();
}
