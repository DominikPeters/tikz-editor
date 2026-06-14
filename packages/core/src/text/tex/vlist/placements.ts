import type { LineReport } from "../../knuth-plass/paragraph/report.js";
import { roundTexPt } from "../fonts/units.js";
import type {
  PositionedTexVListItem,
  TexVListLinePlacement,
  TexVListParagraphBoxMeasurement,
  TexVListParagraphPlacement,
} from "./types.js";
import { flattenPositionedTexVListItems } from "./traversal.js";

export function texVListLinePlacements(
  items: readonly PositionedTexVListItem[],
  paragraphMeasurements: ReadonlyMap<number, TexVListParagraphBoxMeasurement>,
  lineHeight: number
): readonly TexVListLinePlacement[] {
  const linePlacementsByIndex = new Map<number, TexVListLinePlacement>();
  for (const item of flattenPositionedTexVListItems(items)) {
    if (item.item.kind !== "paragraph") {
      continue;
    }
    const measurement = paragraphMeasurements.get(item.item.paragraph.blockIndex);
    if (!measurement) {
      throw new Error(
        `TeX vlist layout is missing paragraph measurement for block ${item.item.paragraph.blockIndex}.`
      );
    }
    for (const line of measurement.lineOffsets) {
      if (linePlacementsByIndex.has(line.lineIndex)) {
        throw new Error(`TeX vlist layout placed line ${line.lineIndex} more than once.`);
      }
      linePlacementsByIndex.set(line.lineIndex, {
        lineIndex: line.lineIndex,
        x: item.x,
        y: roundTexPt(item.y + line.y),
        height: lineHeight,
      });
    }
  }
  return Array.from(linePlacementsByIndex.values())
    .sort((left, right) => left.lineIndex - right.lineIndex);
}

export function assertAllReportLinesPlaced(
  lines: readonly LineReport[],
  linePlacements: readonly TexVListLinePlacement[]
): void {
  const placedLineIndices = new Set(linePlacements.map((placement) => placement.lineIndex));
  for (const line of lines) {
    if (!placedLineIndices.has(line.lineIndex)) {
      throw new Error(`TeX vlist layout did not place line ${line.lineIndex}.`);
    }
  }
}

export function texVListParagraphPlacements(
  items: readonly PositionedTexVListItem[],
  paragraphMeasurements: ReadonlyMap<number, TexVListParagraphBoxMeasurement>
): readonly TexVListParagraphPlacement[] {
  const placements: TexVListParagraphPlacement[] = [];
  for (const item of flattenPositionedTexVListItems(items)) {
    if (item.item.kind !== "paragraph") {
      continue;
    }
    const measurement = paragraphMeasurements.get(item.item.paragraph.blockIndex);
    if (!measurement) {
      throw new Error(
        `TeX vlist layout is missing paragraph measurement for block ${item.item.paragraph.blockIndex}.`
      );
    }
    placements.push({
      blockIndex: item.item.paragraph.blockIndex,
      vlistPath: item.path,
      sourceSpan: item.item.sourceSpan,
      lineIndices: measurement.lineIndices,
      x: item.x,
      y: item.y,
      metrics: item.metrics,
    });
  }
  return placements;
}
