import type { TexDisplayMathLayoutProfile, TexListLayoutProfile } from "../../text/tex/layout-options.js";
import { requireDefined } from "../../utils/invariants.js";
import { requireArrayValue } from "../../utils/collections.js";
import type { BeamerDocumentModel } from "../types.js";
import type { ResolvedBeamerTheme } from "./types.js";
import { beamerClassFontOption, beamerClassOptionEntries } from "../class-options.js";

const names = ["tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge"] as const;
export type BeamerNamedFontSize = typeof names[number];
type Size = readonly [sizePt: number, baselineSkipPt: number];

// The class loads sizeNN.clo. @xipt/@xivpt/@xviipt/@xxpt/@xxvpt are
// 10.95/14.4/17.28/20.74/24.88pt, including in the extsizes profiles.
const profiles = {
  "8": [[5,6],[5,6],[6,7],[7,8],[8,9.5],[10,10.95],[10.95,12],[12,14],[14.4,18],[17.28,22]],
  "9": [[5,6],[6,7],[7,8],[8,9],[9,10.95],[10,12],[10.95,13],[12,14],[14.4,18],[17.28,22]],
  "10": [[5,6],[7,8],[8,9.5],[9,11],[10,12],[12,14],[14.4,18],[17.28,22],[20.74,25],[24.88,30]],
  "11": [[6,7],[8,9.5],[9,11],[10,12],[10.95,13.6],[12,14],[14.4,18],[17.28,22],[20.74,25],[24.88,30]],
  "12": [[6,7],[8,9.5],[10,12],[10.95,13.6],[12,14.5],[14.4,18],[17.28,22],[20.74,25],[24.88,30],[24.88,30]],
  "14": [[6,7],[8,9.5],[10,12],[12,14],[14.4,17],[17.28,22],[20.74,25],[24.88,30],[29.86,35],[35.83,40]],
  "17": [[8,9],[10,11],[12,14],[14.4,17],[17.28,22],[20.74,25],[24.88,30],[29.86,35],[35.83,41],[42.99,52]],
  "20": [[10,11],[12,14],[14.4,17],[17.28,22],[20.74,25],[24.88,30],[29.86,35],[35.83,41],[42.99,52],[51.59,63]],
} satisfies Readonly<Record<string, readonly Size[]>>;
const profileLookup: Readonly<Partial<Record<string, readonly Size[]>>> = profiles;

export function beamerClassFontSize(document: BeamerDocumentModel): string {
  let size = "11";
  for (const option of beamerClassOptionEntries(document)) {
    const value = beamerClassFontOption(option);
    if (value !== null) size = value;
  }
  return size;
}

export function beamerNamedFontSizes(theme?: Pick<ResolvedBeamerTheme, "options">): readonly (readonly [BeamerNamedFontSize, number, number])[] {
  const sizes = profileLookup[String(theme?.options["class-font-size"] ?? "11")] ?? profiles["11"];
  return names.map((name, index) => [name, ...requireArrayValue(sizes, index)] as const);
}

export function beamerNamedFontSize(classSize: string, name: BeamerNamedFontSize): { sizePt: number; lineHeightPt: number } {
  const sizes = profileLookup[classSize] ?? profiles["11"];
  const [sizePt, lineHeightPt] = requireArrayValue(sizes, names.indexOf(name));
  return { sizePt, lineHeightPt };
}

/** Normal-size \topsep from the same sizeNN.clo profile, used by trivlist. */
export function beamerTrivlistSpacing(theme?: Pick<ResolvedBeamerTheme, "options">): { naturalPt: number; stretchPt: number; shrinkPt: number } {
  const spacingProfiles = {
    "8": [6,2,3], "9": [6,2,3], "10": [8,2,4], "11": [9,3,5],
    "12": [10,4,6], "14": [12,5,7], "17": [14,6,8], "20": [16,7,9],
  } satisfies Record<string, readonly [number, number, number]>;
  const spacingLookup: Readonly<Partial<Record<string, readonly [number, number, number]>>> = spacingProfiles;
  const [naturalPt, stretchPt, shrinkPt] = spacingLookup[String(theme?.options["class-font-size"] ?? "11")] ?? spacingProfiles["11"];
  return { naturalPt, stretchPt, shrinkPt };
}

// sizeNN.clo changes display and first-level list registers only in these
// three declarations. Other named sizes inherit the active registers.
type RegisterCommand = "normalsize" | "small" | "footnotesize";
type DisplayRegisters = readonly [normal: number, stretch: number, shrink: number, aboveShortStretch: number, belowShort: number, belowShortStretch: number, belowShortShrink: number];
const displayRegisters: Readonly<Record<string, Readonly<Record<RegisterCommand, DisplayRegisters>>>> = {
  "8": { normalsize: [8, 4, 4, 3, 5, 3, 3], small: [5, 2, 2, 1, 3, 1, 2], footnotesize: [4, 2, 2, 1, 2.5, 1, 1] },
  "9": { normalsize: [8, 4, 4, 3, 5, 3, 3], small: [5, 2, 2, 1, 3, 1, 2], footnotesize: [4, 2, 2, 1, 2.5, 1, 1] },
  "10": { normalsize: [10, 2, 5, 3, 6, 3, 3], small: [8.5, 3, 4, 2, 4, 2, 2], footnotesize: [6, 2, 4, 1, 3, 1, 2] },
  "11": { normalsize: [11, 3, 6, 3, 6.5, 3.5, 3], small: [10, 2, 5, 3, 6, 3, 3], footnotesize: [8, 2, 4, 1, 4, 2, 2] },
  "12": { normalsize: [12, 3, 7, 3, 6.5, 3.5, 3], small: [11, 3, 6, 3, 6.5, 3.5, 3], footnotesize: [10, 2, 5, 3, 6, 3, 3] },
  "14": { normalsize: [14, 3, 7, 4, 7, 4, 3], small: [12, 3, 7, 3, 6.5, 3.5, 3], footnotesize: [10, 2, 5, 3, 6, 3, 3] },
  "17": { normalsize: [15, 4, 8, 4, 8, 4, 3], small: [12, 3, 7, 3, 7, 4, 3], footnotesize: [12, 3, 7, 3, 6.5, 3.5, 3] },
  "20": { normalsize: [17, 5, 8, 5, 10, 5, 4], small: [14, 3, 7, 4, 9, 4, 3], footnotesize: [14, 3, 7, 3, 7, 4, 3] },
};

export function beamerDisplayMathProfile(theme?: Pick<ResolvedBeamerTheme, "options">): TexDisplayMathLayoutProfile {
  const classSize = String(theme?.options["class-font-size"] ?? "11");
  const registers = displayRegisters[classSize] ?? requireDefined(displayRegisters["11"], "Missing default Beamer display registers");
  const convert = ([sizePt, stretchPt, shrinkPt, aboveShortStretch, belowShort, belowShortStretch, belowShortShrink]: DisplayRegisters) => {
    const normal = { sizePt, stretchPt, shrinkPt };
    return {
      above: { normal, short: { sizePt: 0, stretchPt: aboveShortStretch, shrinkPt: 0 } },
      below: { normal, short: { sizePt: belowShort, stretchPt: belowShortStretch, shrinkPt: belowShortShrink } },
    };
  };
  return { ...convert(registers.normalsize),
    leadingDisplay: { emptyLineBaselineSkipPt: beamerNamedFontSize(classSize, "normalsize").lineHeightPt },
    sizeOverrides: { normalsize: convert(registers.normalsize), small: convert(registers.small), footnotesize: convert(registers.footnotesize) },
  };
}

type ListRegisters = readonly [topsep: number, topsepStretch: number, topsepShrink: number, parsep: number, parsepStretch: number, parsepShrink: number];
const listRegisters: Readonly<Record<string, readonly [ListRegisters, ListRegisters]>> = {
  "8": [[3, 1, 1, 2, 1, 1], [3, 1, 1, 2, 1, 1]],
  "9": [[3, 1, 1, 2, 1, 1], [3, 1, 1, 2, 1, 1]],
  "10": [[4, 2, 2, 2, 1, 1], [3, 1, 1, 2, 1, 1]],
  "11": [[6, 2, 2, 3, 2, 1], [4, 2, 2, 2, 1, 1]],
  "12": [[9, 3, 5, 4.5, 2, 1], [6, 2, 2, 3, 2, 1]],
  "14": [[9, 3, 5, 4.5, 2, 1], [6, 2, 2, 3, 2, 1]],
  "17": [[10, 4, 6, 5, 2, 1], [9, 3, 5, 4.5, 2, 1]],
  "20": [[12, 5, 6, 6, 3, 2], [10, 4, 6, 5, 2, 1]],
};

export function beamerListSizeOverrides(theme?: Pick<ResolvedBeamerTheme, "options">): NonNullable<TexListLayoutProfile["sizeOverrides"]> {
  const classSize = String(theme?.options["class-font-size"] ?? "11");
  const registers = listRegisters[classSize] ?? requireDefined(listRegisters["11"], "Missing default Beamer list registers");
  return (["small", "footnotesize"] as const).map((name, index) => {
    const [topsepPt, topsepStretchPt, topsepShrinkPt, parsepPt, parsepStretchPt, parsepShrinkPt] = requireArrayValue(registers, index);
    return { fontSizePt: beamerNamedFontSize(classSize, name).sizePt,
      topsepPt, topsepStretchPt, topsepShrinkPt, parsepPt, parsepStretchPt, parsepShrinkPt,
      itemsepPt: parsepPt, itemsepStretchPt: parsepStretchPt, itemsepShrinkPt: parsepShrinkPt };
  });
}
