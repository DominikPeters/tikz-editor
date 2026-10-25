import { parseOptionListRaw } from "../options/parse.js";
import type { OptionEntry } from "../options/types.js";
import type { BeamerDocumentModel } from "./types.js";

export const BEAMER_ASPECT_RATIOS = [
  { value: "43", label: "4:3" }, { value: "169", label: "16:9" },
  { value: "1610", label: "16:10" }, { value: "149", label: "14:9" },
  { value: "141", label: "1.41:1 (A4)" }, { value: "54", label: "5:4" },
  { value: "32", label: "3:2" }, { value: "2013", label: "20:13" },
] as const;

export const BEAMER_CLASS_FONT_SIZES: readonly string[] = ["8", "9", "10", "11", "12", "14", "17", "20"];

export function beamerClassOptionEntries(document: BeamerDocumentModel): readonly OptionEntry[] {
  const options = document.preamble.documentClass?.options;
  return options ? parseOptionListRaw(document.source.slice(options.span.from, options.span.to), options.span.from).entries : [];
}

/** Numeric class flags are intentionally outside the TikZ flag grammar. */
export function beamerClassFontOption(entry: OptionEntry): string | null {
  const token = entry.kind === "kv" ? "" : entry.raw.trim();
  return /^(8|9|10|11|12|14|17|20)pt$/u.exec(token)?.[1] ?? null;
}

/** Beamer's key processing is in source order, including a bare aspectratio flag. */
export function beamerClassOptionValue(document: BeamerDocumentModel, key: "aspectratio"): string | null {
  const entry = [...beamerClassOptionEntries(document)].reverse().find(entry => entry.kind !== "unknown" && entry.key === key);
  if (!entry) return null;
  if (entry.kind !== "kv") return "43";
  const value = entry.valueRaw.trim();
  return value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1).trim() : value;
}
