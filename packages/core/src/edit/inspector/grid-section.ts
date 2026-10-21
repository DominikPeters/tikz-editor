import { uniqueStrings } from "../statement-find.js";
import { resolveGridInspectorState } from "./grid-state.js";
import type { SectionBuilder } from "./section-builder.js";

const GRID_STEP_CLEAR_KEYS = ["xstep", "x step", "ystep", "y step"] as const;
const GRID_XSTEP_CLEAR_KEYS = ["x step"] as const;
const GRID_YSTEP_CLEAR_KEYS = ["y step"] as const;

export const buildGridSection: SectionBuilder = (context) => {
  if (context.element.kind !== "Path") return null;
  const state = resolveGridInspectorState(context.element, context.source, context.parseOptions);
  if (!state) return null;

  return {
    id: "grid",
    title: "Grid",
    sourceLevel: "command",
    properties: [
      {
        kind: "number",
        id: "grid-step",
        label: "Step",
        value: state.step,
        step: 0.1,
        unit: "cm",
        minExclusive: 0,
        defaultValue: 1,
        clearKeys: uniqueStrings(GRID_STEP_CLEAR_KEYS),
        write: context.writePropertyForElementId(state.keywordId, "step")
      },
      {
        kind: "number",
        id: "grid-xstep",
        label: "X step",
        value: state.xstep,
        step: 0.1,
        unit: "cm",
        minExclusive: 0,
        defaultValue: 1,
        clearKeys: uniqueStrings(GRID_XSTEP_CLEAR_KEYS),
        write: context.writePropertyForElementId(state.keywordId, "xstep")
      },
      {
        kind: "number",
        id: "grid-ystep",
        label: "Y step",
        value: state.ystep,
        step: 0.1,
        unit: "cm",
        minExclusive: 0,
        defaultValue: 1,
        clearKeys: uniqueStrings(GRID_YSTEP_CLEAR_KEYS),
        write: context.writePropertyForElementId(state.keywordId, "ystep")
      }
    ]
  };
};
