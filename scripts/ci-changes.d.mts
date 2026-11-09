export type CiChanges = Record<"checks" | "unit" | "web" | "desktop" | "images" | "landing" | "ipad", boolean>;
export function classifyCiChanges(files: readonly string[]): CiChanges;
