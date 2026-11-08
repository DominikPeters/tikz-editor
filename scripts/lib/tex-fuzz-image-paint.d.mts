import type { BeamerColorMaskComparison } from "./beamer-paint-compare.mjs";
export function compareTexFuzzImagePaint(options: {
  pdfPath: string; nativePngPath: string; directory: string; width: number; height: number;
}): {
  reference: string; masks: BeamerColorMaskComparison[];
  popplerControl: BeamerColorMaskComparison[]; nativeVsPoppler: BeamerColorMaskComparison[];
};
