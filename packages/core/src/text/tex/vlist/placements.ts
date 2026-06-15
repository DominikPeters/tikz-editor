import type { LineReport } from "../../knuth-plass/paragraph/report.js";
import { roundTexPt } from "../fonts/units.js";
import type {
  PositionedTexVListItem,
  TexParagraphItem,
  TexVListLinePlacement,
  TexVListParagraphBoxMeasurement,
  TexVListParagraphPlacement,
} from "./types.js";
import { flattenPositionedTexVListItems } from "./traversal.js";
import { texVListPathKey } from "./paths.js";

interface MeasuredPositionedTexParagraph {
  readonly item: PositionedTexVListItem & { readonly item: TexParagraphItem };
  readonly measurement: TexVListParagraphBoxMeasurement;
}

export function texVListLinePlacements(
  items: readonly PositionedTexVListItem[],
  paragraphMeasurements: ReadonlyMap<string, TexVListParagraphBoxMeasurement>,
  lineHeight: number
): readonly TexVListLinePlacement[] {
  const linePlacementsByIndex = new Map<number, TexVListLinePlacement>();
  for (const { item, measurement } of measuredPositionedTexParagraphs(
    items,
    paragraphMeasurements
  )) {
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
  paragraphMeasurements: ReadonlyMap<string, TexVListParagraphBoxMeasurement>
): readonly TexVListParagraphPlacement[] {
  const placements: TexVListParagraphPlacement[] = [];
  for (const { item, measurement } of measuredPositionedTexParagraphs(
    items,
    paragraphMeasurements
  )) {
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

function measuredPositionedTexParagraphs(
  items: readonly PositionedTexVListItem[],
  paragraphMeasurements: ReadonlyMap<string, TexVListParagraphBoxMeasurement>
): readonly MeasuredPositionedTexParagraph[] {
  const measured: MeasuredPositionedTexParagraph[] = [];
  const paragraphMeasurementsByBlockIndex = texVListParagraphMeasurementBlockIndexMap(
    paragraphMeasurements
  );
  for (const item of flattenPositionedTexVListItems(items)) {
    if (!isPositionedTexParagraph(item)) {
      continue;
    }
    const key = texVListPathKey(item.path);
    const blockIndex = texPositionedParagraphBlockIndex(item.item);
    const measurement = paragraphMeasurements.get(key) ??
      paragraphMeasurementsByBlockIndex.get(blockIndex);
    if (!measurement) {
      throw new Error(
        `TeX vlist layout is missing paragraph measurement for path ${key}.`
      );
    }
    if (measurement.blockIndex !== blockIndex) {
      throw new Error(
        `TeX vlist paragraph measurement path ${key} block identity mismatch: item ${blockIndex}, measurement ${measurement.blockIndex}.`
      );
    }
    measured.push({
      item,
      measurement,
    });
  }
  return measured;
}

function texVListParagraphMeasurementBlockIndexMap(
  paragraphMeasurements: ReadonlyMap<string, TexVListParagraphBoxMeasurement>
): ReadonlyMap<number, TexVListParagraphBoxMeasurement> {
  const byBlockIndex = new Map<number, TexVListParagraphBoxMeasurement>();
  for (const measurement of paragraphMeasurements.values()) {
    if (!byBlockIndex.has(measurement.blockIndex)) {
      byBlockIndex.set(measurement.blockIndex, measurement);
    }
  }
  return byBlockIndex;
}

function isPositionedTexParagraph(
  item: PositionedTexVListItem
): item is PositionedTexVListItem & { readonly item: TexParagraphItem } {
  return item.item.kind === "paragraph";
}

function texPositionedParagraphBlockIndex(item: TexParagraphItem): number {
  if (item.blockIndex !== item.paragraph.blockIndex) {
    throw new Error(
      `TeX vlist paragraph block identity mismatch: item ${item.blockIndex}, paragraph ${item.paragraph.blockIndex}.`
    );
  }
  return item.blockIndex;
}
