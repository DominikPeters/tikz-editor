import { requireArrayValue } from "../utils/collections.js";
export type EditableTargetKind = "statement" | "node-adornment";

export type ParsedEditableTargetId =
  | {
      kind: "statement";
      id: string;
    }
  | {
      kind: "node-adornment";
      id: string;
      ownerNodeId: string;
      adornmentKind: "label" | "pin";
      adornmentIndex: number;
    };

export function parseEditableTargetId(id: string): ParsedEditableTargetId {
  const trimmed = id.trim();
  const match = /^node-adornment:(.+):(label|pin):(\d+)$/.exec(trimmed);
  if (!match) {
    return {
      kind: "statement",
      id: trimmed
    };
  }

  return {
    kind: "node-adornment",
    id: trimmed,
    ownerNodeId: requireArrayValue(match, 1),
    adornmentKind: match[2] as "label" | "pin",
    adornmentIndex: Number.parseInt(requireArrayValue(match, 3), 10)
  };
}

export function isAdornmentTargetId(id: string): boolean {
  return parseEditableTargetId(id).kind === "node-adornment";
}
