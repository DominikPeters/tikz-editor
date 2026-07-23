import type {
  BeamerDocumentModel,
  BeamerPageGeometry,
  BeamerThemeUseModel,
} from "./types.js";

const TEX_POINTS_PER_CM = 72.27 / 2.54;
const DEFAULT_NORMAL_SIZE_PT = 10.95;

const STANDARD_PAGE_SIZES_CM: Readonly<Record<string, readonly [number, number]>> = {
  "2013": [14, 9.1],
  "1610": [16, 10],
  "169": [16, 9],
  "149": [14, 9],
  "54": [12.5, 10],
  "43": [12.8, 9.6],
  "32": [13.5, 9],
  "141": [14.85, 10.5],
};

/**
 * Resolve the source-derived page geometry needed before frame layout.
 *
 * Page sizes mirror the aspectratio table in Beamer 3.72's `beamer.cls`.
 * Madrid uses `beamerouterthemeinfolines.sty`, which sets both text margins to
 * 1em. At Beamer's default 11pt class size, the normal size is 10.95pt.
 */
export function resolveBeamerPageGeometry(
  document: BeamerDocumentModel
): BeamerPageGeometry {
  const aspectRatio = documentClassOption(document, "aspectratio") ?? "43";
  const [widthCm, heightCm] =
    STANDARD_PAGE_SIZES_CM[aspectRatio] ?? customPageSizeCm(aspectRatio);
  const pageWidth = cmToTexPt(widthCm);
  const pageHeight = cmToTexPt(heightCm);
  const madrid = usesTheme(document.preamble.themes, "theme", "Madrid");
  const margin = madrid ? DEFAULT_NORMAL_SIZE_PT : cmToTexPt(1);
  // infolines: ht=2.25ex, dp=1ex. The measured value is retained as a
  // source-backed profile constant until the font/dimension executor exists.
  const footlineHeight = madrid ? 12.658004760742188 : 0;

  return {
    aspectRatio,
    page: {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    },
    textArea: {
      x: margin,
      y: 0,
      width: pageWidth - 2 * margin,
      height: pageHeight - footlineHeight,
    },
    headlineHeight: 0,
    footlineHeight,
    profile: madrid ? "madrid" : "beamer-default",
  };
}

function documentClassOption(
  document: BeamerDocumentModel,
  key: string
): string | null {
  const source = document.preamble.documentClass?.options?.value;
  if (!source) {
    return null;
  }
  for (const entry of source.split(",")) {
    const [rawKey, ...rawValue] = entry.split("=");
    if (rawKey?.trim() === key) {
      return rawValue.join("=").trim() || null;
    }
  }
  return null;
}

function usesTheme(
  themes: readonly BeamerThemeUseModel[],
  kind: BeamerThemeUseModel["kind"],
  name: string
): boolean {
  return themes.some(
    (theme) =>
      theme.kind === kind &&
      theme.name.value.trim().toLocaleLowerCase() === name.toLocaleLowerCase()
  );
}

function customPageSizeCm(aspectRatio: string): readonly [number, number] {
  if (!/^\d+$/.test(aspectRatio)) {
    return STANDARD_PAGE_SIZES_CM["43"]!;
  }
  const split = aspectRatio.length < 4 ? 1 : 2;
  const numerator = Number(aspectRatio.slice(0, -split));
  const denominator = Number(aspectRatio.slice(-split));
  if (!(numerator > 0 && denominator > 0)) {
    return STANDARD_PAGE_SIZES_CM["43"]!;
  }
  const height = 9.6;
  return [height * numerator / denominator, height];
}

function cmToTexPt(value: number): number {
  return value * TEX_POINTS_PER_CM;
}
