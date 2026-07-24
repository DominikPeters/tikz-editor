import type {
  BeamerDocumentModel,
  BeamerPageGeometry,
} from "./types.js";
import { resolveBeamerTheme } from "./theme/resolve.js";
import type { ResolvedBeamerTheme } from "./theme/types.js";

const TEX_POINTS_PER_CM = 72.27 / 2.54;

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
 * Theme-controlled horizontal dimensions arrive through the resolved theme;
 * this module has no knowledge of aggregate theme names or templates.
 */
export function resolveBeamerPageGeometry(
  document: BeamerDocumentModel,
  theme: ResolvedBeamerTheme = resolveBeamerTheme(document)
): BeamerPageGeometry {
  const aspectRatio = documentClassOption(document, "aspectratio") ?? "43";
  const [widthCm, heightCm] =
    STANDARD_PAGE_SIZES_CM[aspectRatio] ?? customPageSizeCm(aspectRatio);
  const pageWidth = cmToTexPt(widthCm);
  const pageHeight = cmToTexPt(heightCm);
  const marginLeft = theme.dimensions.textMarginLeftPt;
  const marginRight = theme.dimensions.textMarginRightPt;
  const sidebarLeft = resolveHorizontalThemeDimension(
    theme.dimensions.sidebarWidthLeft,
    pageWidth
  );
  const sidebarRight = resolveHorizontalThemeDimension(
    theme.dimensions.sidebarWidthRight,
    pageWidth
  );
  const frameWidth = Math.max(0, pageWidth - sidebarLeft - sidebarRight);

  return {
    aspectRatio,
    page: {
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
    },
    frameArea: {
      x: sidebarLeft,
      y: 0,
      width: frameWidth,
      height: pageHeight,
    },
    textArea: {
      x: sidebarLeft + marginLeft,
      y: 0,
      width: Math.max(0, frameWidth - marginLeft - marginRight),
      height: pageHeight,
    },
    themeId: theme.id,
  };
}

function resolveHorizontalThemeDimension(
  dimension: ResolvedBeamerTheme["dimensions"]["sidebarWidthLeft"],
  pageWidth: number
): number {
  return dimension.kind === "page-width"
    ? dimension.ratio * pageWidth
    : dimension.valuePt;
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

function customPageSizeCm(aspectRatio: string): readonly [number, number] {
  if (!/^\d+$/.test(aspectRatio)) {
    return STANDARD_PAGE_SIZES_CM["43"];
  }
  const split = aspectRatio.length < 4 ? 1 : 2;
  const numerator = Number(aspectRatio.slice(0, -split));
  const denominator = Number(aspectRatio.slice(-split));
  if (!(numerator > 0 && denominator > 0)) {
    return STANDARD_PAGE_SIZES_CM["43"];
  }
  const height = 9.6;
  return [height * numerator / denominator, height];
}

function cmToTexPt(value: number): number {
  return value * TEX_POINTS_PER_CM;
}
