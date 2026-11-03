import type { FrameLocalPoint, FrameLocalVector, SourceCmPoint } from "../../coords/points.js";
import { sourceCmPoint } from "../../coords/points.js";
import { cm } from "../../coords/scalars.js";
import { ptToCm } from "../../coords/source.js";

/**
 * Writer-internal (checker rule F3): frame-local pt as the numbers a source
 * coordinate carries, cm-equivalent. Whether a number means cm or a step
 * along PGF's axis vector is the spelling's business, which chose the frame.
 */
export function localToSourceUnits(local: Pick<FrameLocalPoint, "x" | "y"> | Pick<FrameLocalVector, "x" | "y">): SourceCmPoint {
  return sourceCmPoint(cm(ptToCm(local.x)), cm(ptToCm(local.y)));
}
