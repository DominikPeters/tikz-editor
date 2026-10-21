import { requireArrayValue } from "../../utils/collections.js";
import { parseLength } from "../coords/parse-length.js";
import { normalizeOptionValue } from "./option-utils.js";

export function parseDashPattern(raw: string): number[] | null {
  const tokens = normalizeOptionValue(raw).split(/\s+/).filter((token) => token.length > 0);
  if (tokens.length < 2) {
    return null;
  }

  const result: number[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const mode = tokens[i]?.toLowerCase();
    const lengthRaw = tokens[i + 1];
    if (!mode || !lengthRaw || (mode !== "on" && mode !== "off")) {
      return null;
    }
    const length = parseLength(lengthRaw, "pt");
    if (length == null || length <= 0) {
      return null;
    }
    result.push(length);
  }

  return result.length > 0 ? result : null;
}

export function parseDashValue(raw: string): { pattern: number[] | null; phase: number | null } | null {
  const trimmed = normalizeOptionValue(raw);
  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed.toLowerCase();
  if (normalized === "solid" || normalized === "none") {
    return { pattern: null, phase: 0 };
  }

  const tokens = trimmed.split(/\s+/).filter((token) => token.length > 0);
  const patternTokens: string[] = [];
  let phase: number | null = null;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = requireArrayValue(tokens, index);
    if (token.toLowerCase() === "phase") {
      const next = tokens[index + 1];
      if (!next) {
        return null;
      }
      const parsedPhase = parseLength(next, "pt");
      if (parsedPhase == null) {
        return null;
      }
      phase = parsedPhase;
      index += 1;
      continue;
    }
    patternTokens.push(token);
  }

  const pattern = parseDashPattern(patternTokens.join(" "));
  if (!pattern) {
    return null;
  }
  return { pattern, phase };
}
