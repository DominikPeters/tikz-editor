export const EDIT_FIELDS: readonly ["text", "class-font", "aspect", "theme", "alignment", "date", "width", "rotation", "overlay", "color", "comment", "title", "scope", "bounds-width"];
export type EditField = typeof EDIT_FIELDS[number];
export type BeamerEditAction =
  | { kind: "set"; field: EditField; value: string; mode: "typing" | "command" | "race"; render: boolean }
  | { kind: "navigate"; frame: number; step: number; picture?: boolean }
  | { kind: "layer"; enabled: boolean }
  | { kind: "mask"; enabled: boolean }
  | { kind: "undo" }
  | { kind: "render" }
  | { kind: "neighbors" }
  | { kind: "abort"; afterYields: number };
export type BeamerEditSequence = { formatVersion: 1; probeVersion?: 1 | 2; seed: number; family: string; source: string; actions: BeamerEditAction[] };
export function withEditProbes(source: string): string;
export function setBeamerEditField(source: string, field: EditField, value: string, probeVersion?: number): string;
export function generateBeamerEditSequence(source: string, family: string, seed: number, steps: number): BeamerEditSequence;
