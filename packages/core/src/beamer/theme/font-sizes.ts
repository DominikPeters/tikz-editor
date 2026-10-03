import type { BeamerDocumentModel } from "../types.js";
import type { ResolvedBeamerTheme } from "./types.js";

const names = ["tiny", "scriptsize", "footnotesize", "small", "normalsize", "large", "Large", "LARGE", "huge", "Huge"] as const;
export type BeamerNamedFontSize = typeof names[number];
type Size = readonly [sizePt: number, baselineSkipPt: number];

// The class loads sizeNN.clo. @xipt/@xivpt/@xviipt/@xxpt/@xxvpt are
// 10.95/14.4/17.28/20.74/24.88pt, including in the extsizes profiles.
const profiles: Readonly<Record<string, readonly Size[]>> = {
  "8": [[5,6],[5,6],[6,7],[7,8],[8,9.5],[10,10.95],[10.95,12],[12,14],[14.4,18],[17.28,22]],
  "9": [[5,6],[6,7],[7,8],[8,9],[9,10.95],[10,12],[10.95,13],[12,14],[14.4,18],[17.28,22]],
  "10": [[5,6],[7,8],[8,9.5],[9,11],[10,12],[12,14],[14.4,18],[17.28,22],[20.74,25],[24.88,30]],
  "11": [[6,7],[8,9.5],[9,11],[10,12],[10.95,13.6],[12,14],[14.4,18],[17.28,22],[20.74,25],[24.88,30]],
  "12": [[6,7],[8,9.5],[10,12],[10.95,13.6],[12,14.5],[14.4,18],[17.28,22],[20.74,25],[24.88,30],[24.88,30]],
  "14": [[6,7],[8,9.5],[10,12],[12,14],[14.4,17],[17.28,22],[20.74,25],[24.88,30],[29.86,35],[35.83,40]],
  "17": [[8,9],[10,11],[12,14],[14.4,17],[17.28,22],[20.74,25],[24.88,30],[29.86,35],[35.83,41],[42.99,52]],
  "20": [[10,11],[12,14],[14.4,17],[17.28,22],[20.74,25],[24.88,30],[29.86,35],[35.83,41],[42.99,52],[51.59,63]],
};

export function beamerClassFontSize(document: BeamerDocumentModel): string {
  let size = "11";
  for (const option of (document.preamble.documentClass?.options?.value ?? "").split(",")) {
    const match = /^(8|9|10|11|12|14|17|20)pt$/u.exec(option.trim());
    if (match) size = match[1];
  }
  return size;
}

export function beamerNamedFontSizes(theme?: Pick<ResolvedBeamerTheme, "options">): readonly (readonly [BeamerNamedFontSize, number, number])[] {
  const sizes = profiles[String(theme?.options["class-font-size"] ?? "11")] ?? profiles["11"];
  return names.map((name, index) => [name, ...sizes[index]] as const);
}

export function beamerNamedFontSize(classSize: string, name: BeamerNamedFontSize): { sizePt: number; lineHeightPt: number } {
  const sizes = profiles[classSize] ?? profiles["11"];
  const [sizePt, lineHeightPt] = sizes[names.indexOf(name)];
  return { sizePt, lineHeightPt };
}

/** Normal-size \topsep from the same sizeNN.clo profile, used by trivlist. */
export function beamerTrivlistSpacing(theme?: Pick<ResolvedBeamerTheme, "options">): { naturalPt: number; stretchPt: number; shrinkPt: number } {
  const profiles: Record<string, readonly [number, number, number]> = {
    "8": [6,2,3], "9": [6,2,3], "10": [8,2,4], "11": [9,3,5],
    "12": [10,4,6], "14": [12,5,7], "17": [14,6,8], "20": [16,7,9],
  };
  const [naturalPt, stretchPt, shrinkPt] = profiles[String(theme?.options["class-font-size"] ?? "11")] ?? profiles["11"];
  return { naturalPt, stretchPt, shrinkPt };
}
