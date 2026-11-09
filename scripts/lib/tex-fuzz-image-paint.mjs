import { readFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execOracleTool } from "./oracle-tool-process.mjs";
import { compareColorMasks } from "./beamer-paint-compare.mjs";

const colors = ["#df2020", "#20b8cf", "#e8b020", "#2846aa"].map(color => ({ color }));

/** Independent TeX paint, with the same final rasterizer as the native SVG.
 * Poppler/Splash and librsvg/Cairo sample bitmap edges differently even when
 * given identical geometry. Keep that cross-rasterizer difference as a control,
 * rather than attributing it to the editor. Geometry still comes from TeX's PDF.
 */
export function compareTexFuzzImagePaint({ pdfPath, nativePngPath, directory, width, height }) {
  const svg = join(directory, "tex-image-paint.svg");
  // MuPDF 1.23 appends a page number even without a placeholder; newer
  // versions honor the literal filename. An explicit pattern works in both.
  const svgPattern = join(directory, "tex-image-paint-page-%d.svg");
  const pageSvg = join(directory, "tex-image-paint-page-1.svg");
  const png = join(directory, "tex-image-paint.png");
  const poppler = join(directory, "tex-pdf-paint");
  rmSync(pageSvg, { force: true });
  execOracleTool("mutool", ["draw", "-q", "-F", "svg", "-o", svgPattern, pdfPath, "1"], { stdio: "ignore" });
  renameSync(pageSvg, svg);
  const source = readFileSync(svg, "utf8");
  if (!source.includes("<svg") || /data:;base64,/u.test(source)) throw new Error("Invalid TeX image-paint SVG");
  execOracleTool("rsvg-convert", ["-w", String(width), "-h", String(height), "-b", "white", "-f", "png", "-o", png, svg]);
  execOracleTool("pdftoppm", ["-png", "-singlefile", "-scale-to-x", String(width), "-scale-to-y", String(height), pdfPath, poppler]);
  return {
    reference: "MuPDF SVG / librsvg",
    masks: compareColorMasks(nativePngPath, png, width, height, colors),
    // Diagnostic only: both images below come from the exact same TeX PDF.
    popplerControl: compareColorMasks(`${poppler}.png`, png, width, height, colors),
    nativeVsPoppler: compareColorMasks(nativePngPath, `${poppler}.png`, width, height, colors),
  };
}
