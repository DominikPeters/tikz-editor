import type { ParagraphLayoutReport } from "../../knuth-plass/paragraph/report.js";
import type { SourceCoordinateSpace } from "../../source-coordinates.js";
import {
  roundTexPt,
} from "../fonts/units.js";
import {
  texVListX,
  texVListY,
} from "../coordinates.js";
import type {
  TexGraphicsPlacement,
  TexVListLinePlacement,
} from "./types.js";

/**
 * Lift source-backed inline graphics from line reports into the positioned
 * VList coordinate system used by rendering and hit testing.
 */
export function collectTexGraphicsPlacements<
  Space extends SourceCoordinateSpace,
>(
  reports: readonly ParagraphLayoutReport<Space>[],
  linePlacements: readonly TexVListLinePlacement[]
): readonly TexGraphicsPlacement<Space>[] {
  const placementByLine = new Map(
    linePlacements.map((placement) => [placement.lineIndex, placement])
  );
  const result: TexGraphicsPlacement<Space>[] = [];
  for (const report of reports) {
    for (const line of report.lines) {
      const linePlacement = placementByLine.get(line.lineIndex);
      if (!linePlacement) {
        continue;
      }
      const hasInlineListLabel = line.segments.some(
        (segment) => segment.role === "list-label"
      );
      const lineRootX = hasInlineListLabel
        ? Number(line.xStart)
        : Math.max(Number(line.xStart), Number(linePlacement.x));
      for (const [segmentIndex, segment] of line.segments.entries()) {
        for (const [graphicsIndex, graphic] of (
          segment.graphics ?? []
        ).entries()) {
          const baselineY = texVListY(roundTexPt(
            Number(linePlacement.y) + Number(line.ascent)
          ));
          result.push({
            id:
              `${report.paragraphId}:graphics:${line.lineIndex}:` +
              `${segmentIndex}:${graphicsIndex}:` +
              `${graphic.sourceStartRaw}-${graphic.sourceEndRaw}`,
            sourceCoordinateSpace: report.sourceCoordinateSpace,
            paragraphId: report.paragraphId,
            lineIndex: line.lineIndex,
            asset: graphic.asset,
            sourceSpan: {
              start: graphic.sourceStartRaw,
              end: graphic.sourceEndRaw,
            },
            filenameSpan: {
              start: graphic.filenameStartRaw,
              end: graphic.filenameEndRaw,
            },
            options: graphic.options,
            caretPolicy: graphic.caretPolicy,
            bounds: {
              x: texVListX(roundTexPt(
                lineRootX +
                Number(graphic.x) -
                Number(line.xStart)
              )),
              y: texVListY(roundTexPt(
                Number(baselineY) + Number(graphic.y)
              )),
              width: graphic.width,
              height: graphic.height,
            },
            baselineY,
            ...(graphic.crop ? { crop: graphic.crop } : {}),
          });
        }
      }
    }
  }
  return result;
}
