import { requireArrayValue } from "../../utils/collections.js";
import type { OptionListAst } from "../../options/types.js";
import {
  resolveNodeShapeGeometryParams,
  type SignalDirection
} from "../../semantic/nodes/shape-geometry.js";
import type { NodeShapePresetId } from "./presets.js";

type ShapeAdaptiveControlBase = {
  id: string;
  label: string;
  writeKey: string;
  clearKeys?: string[];
};

type ShapeAdaptiveNumberControl = ShapeAdaptiveControlBase & {
  kind: "number";
  value: number;
  step: number;
  min?: number;
  max?: number;
  unit?: string;
};

type ShapeAdaptiveLengthControl = ShapeAdaptiveControlBase & {
  kind: "length";
  value: number;
  step: number;
};

type ShapeAdaptiveEnumControl = ShapeAdaptiveControlBase & {
  kind: "enum";
  value: string;
  options: Array<{ value: string; label: string }>;
};

type ShapeAdaptiveBooleanControl = ShapeAdaptiveControlBase & {
  kind: "boolean";
  value: boolean;
  trueValue?: string;
  falseValue?: string;
};

export type ShapeAdaptiveControl =
  | ShapeAdaptiveNumberControl
  | ShapeAdaptiveLengthControl
  | ShapeAdaptiveEnumControl
  | ShapeAdaptiveBooleanControl;

const SIGNAL_DIRECTION_ENUM_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "nowhere", label: "Nowhere" },
  { value: "north", label: "North" },
  { value: "south", label: "South" },
  { value: "east", label: "East" },
  { value: "west", label: "West" },
  { value: "north and south", label: "North and south" },
  { value: "east and west", label: "East and west" }
];

const TAPE_BEND_ENUM_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "in and out", label: "In and out" },
  { value: "out and in", label: "Out and in" },
  { value: "none", label: "None" }
];

export function resolveNodeShapeAdaptiveControls(
  shape: Exclude<NodeShapePresetId, "custom">,
  options: OptionListAst | undefined
): ShapeAdaptiveControl[] {
  const geometry = resolveNodeShapeGeometryParams(options);
  const controls: ShapeAdaptiveControl[] = [];
  const idPrefix = `node-shape-${shape.replace(/\s+/g, "-")}`;
  const addRotation = shapeSupportsShapeBorderRotate(shape);

  if (shape === "diamond") {
    controls.push({
      kind: "number",
      id: `${idPrefix}-aspect`,
      label: "Aspect",
      writeKey: "aspect",
      value: geometry.diamondAspect,
      step: 0.05,
      min: 0.05
    });
  } else if (shape === "trapezium") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-left-angle`,
        label: "Left angle",
        writeKey: "trapezium left angle",
        value: geometry.trapeziumLeftAngle,
        step: 1,
        unit: "deg"
      },
      {
        kind: "number",
        id: `${idPrefix}-right-angle`,
        label: "Right angle",
        writeKey: "trapezium right angle",
        value: geometry.trapeziumRightAngle,
        step: 1,
        unit: "deg"
      },
      {
        kind: "boolean",
        id: `${idPrefix}-stretches`,
        label: "Stretches",
        writeKey: "trapezium stretches",
        value: geometry.trapeziumStretches
      },
      {
        kind: "boolean",
        id: `${idPrefix}-stretches-body`,
        label: "Stretches body",
        writeKey: "trapezium stretches body",
        value: geometry.trapeziumStretchesBody
      }
    );
  } else if (shape === "regular polygon") {
    controls.push({
      kind: "number",
      id: `${idPrefix}-sides`,
      label: "Sides",
      writeKey: "regular polygon sides",
      value: geometry.regularPolygonSides,
      step: 1,
      min: 3
    });
  } else if (shape === "star") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-points`,
        label: "Points",
        writeKey: "star points",
        value: geometry.starPoints,
        step: 1,
        min: 2
      },
      {
        kind: "number",
        id: `${idPrefix}-point-ratio`,
        label: "Point ratio",
        writeKey: "star point ratio",
        value: geometry.starPointRatio,
        step: 0.05,
        min: 0.05,
        clearKeys: ["star point height"]
      },
      {
        kind: "length",
        id: `${idPrefix}-point-height`,
        label: "Point height",
        writeKey: "star point height",
        value: geometry.starPointHeightPt,
        step: 0.1,
        clearKeys: ["star point ratio"]
      }
    );
  } else if (shape === "isosceles triangle") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-apex-angle`,
        label: "Apex angle",
        writeKey: "isosceles triangle apex angle",
        value: geometry.isoscelesTriangleApexAngle,
        step: 1,
        unit: "deg"
      },
      {
        kind: "boolean",
        id: `${idPrefix}-stretches`,
        label: "Stretches",
        writeKey: "isosceles triangle stretches",
        value: geometry.isoscelesTriangleStretches
      }
    );
  } else if (shape === "kite") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-upper-vertex-angle`,
        label: "Upper vertex angle",
        writeKey: "kite upper vertex angle",
        value: geometry.kiteUpperVertexAngle,
        step: 1,
        unit: "deg"
      },
      {
        kind: "number",
        id: `${idPrefix}-lower-vertex-angle`,
        label: "Lower vertex angle",
        writeKey: "kite lower vertex angle",
        value: geometry.kiteLowerVertexAngle,
        step: 1,
        unit: "deg"
      }
    );
  } else if (shape === "dart") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-tip-angle`,
        label: "Tip angle",
        writeKey: "dart tip angle",
        value: geometry.dartTipAngle,
        step: 1,
        unit: "deg"
      },
      {
        kind: "number",
        id: `${idPrefix}-tail-angle`,
        label: "Tail angle",
        writeKey: "dart tail angle",
        value: geometry.dartTailAngle,
        step: 1,
        unit: "deg"
      }
    );
  } else if (shape === "circular sector") {
    controls.push({
      kind: "number",
      id: `${idPrefix}-angle`,
      label: "Sector angle",
      writeKey: "circular sector angle",
      value: geometry.circularSectorAngle,
      step: 1,
      unit: "deg"
    });
  } else if (shape === "cylinder") {
    controls.push({
      kind: "number",
      id: `${idPrefix}-aspect`,
      label: "Aspect",
      writeKey: "aspect",
      value: geometry.cylinderAspect,
      step: 0.05,
      min: 0.05
    });
  } else if (shape === "cloud") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-aspect`,
        label: "Aspect",
        writeKey: "aspect",
        value: geometry.diamondAspect,
        step: 0.05,
        min: 0.05
      },
      {
        kind: "number",
        id: `${idPrefix}-puffs`,
        label: "Puffs",
        writeKey: "cloud puffs",
        value: geometry.cloudPuffs,
        step: 1,
        min: 2
      },
      {
        kind: "number",
        id: `${idPrefix}-puff-arc`,
        label: "Puff arc",
        writeKey: "cloud puff arc",
        value: geometry.cloudPuffArc,
        step: 1,
        unit: "deg"
      },
      {
        kind: "boolean",
        id: `${idPrefix}-ignores-aspect`,
        label: "Ignore aspect",
        writeKey: "cloud ignores aspect",
        value: geometry.cloudIgnoresAspect
      }
    );
  } else if (shape === "starburst") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-points`,
        label: "Points",
        writeKey: "starburst points",
        value: geometry.starburstPoints,
        step: 1,
        min: 2
      },
      {
        kind: "length",
        id: `${idPrefix}-point-height`,
        label: "Point height",
        writeKey: "starburst point height",
        value: geometry.starburstPointHeightPt,
        step: 0.1
      },
      {
        kind: "number",
        id: `${idPrefix}-random-seed`,
        label: "Random seed",
        writeKey: "random starburst",
        value: geometry.randomStarburstSeed,
        step: 1,
        min: 0
      }
    );
  } else if (shape === "signal") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-pointer-angle`,
        label: "Pointer angle",
        writeKey: "signal pointer angle",
        value: geometry.signalPointerAngle,
        step: 1,
        unit: "deg"
      },
      {
        kind: "enum",
        id: `${idPrefix}-to`,
        label: "Signal to",
        writeKey: "signal to",
        value: signalDirectionsToEnumValue(geometry.signalToSides),
        options: SIGNAL_DIRECTION_ENUM_OPTIONS
      },
      {
        kind: "enum",
        id: `${idPrefix}-from`,
        label: "Signal from",
        writeKey: "signal from",
        value: signalDirectionsToEnumValue(geometry.signalFromSides),
        options: SIGNAL_DIRECTION_ENUM_OPTIONS
      }
    );
  } else if (shape === "tape") {
    controls.push(
      {
        kind: "enum",
        id: `${idPrefix}-bend-top`,
        label: "Bend top",
        writeKey: "tape bend top",
        value: geometry.tapeBendTop,
        options: TAPE_BEND_ENUM_OPTIONS
      },
      {
        kind: "enum",
        id: `${idPrefix}-bend-bottom`,
        label: "Bend bottom",
        writeKey: "tape bend bottom",
        value: geometry.tapeBendBottom,
        options: TAPE_BEND_ENUM_OPTIONS
      },
      {
        kind: "length",
        id: `${idPrefix}-bend-height`,
        label: "Bend height",
        writeKey: "tape bend height",
        value: geometry.tapeBendHeightPt,
        step: 0.1
      }
    );
  } else if (shape === "single arrow") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-tip-angle`,
        label: "Tip angle",
        writeKey: "single arrow tip angle",
        value: geometry.singleArrowTipAngle,
        step: 1,
        unit: "deg"
      },
      {
        kind: "length",
        id: `${idPrefix}-head-extend`,
        label: "Head extend",
        writeKey: "single arrow head extend",
        value: geometry.singleArrowHeadExtendPt,
        step: 0.1
      },
      {
        kind: "length",
        id: `${idPrefix}-head-indent`,
        label: "Head indent",
        writeKey: "single arrow head indent",
        value: geometry.singleArrowHeadIndentPt,
        step: 0.1
      }
    );
  } else if (shape === "double arrow") {
    controls.push(
      {
        kind: "number",
        id: `${idPrefix}-tip-angle`,
        label: "Tip angle",
        writeKey: "double arrow tip angle",
        value: geometry.doubleArrowTipAngle,
        step: 1,
        unit: "deg"
      },
      {
        kind: "length",
        id: `${idPrefix}-head-extend`,
        label: "Head extend",
        writeKey: "double arrow head extend",
        value: geometry.doubleArrowHeadExtendPt,
        step: 0.1
      },
      {
        kind: "length",
        id: `${idPrefix}-head-indent`,
        label: "Head indent",
        writeKey: "double arrow head indent",
        value: geometry.doubleArrowHeadIndentPt,
        step: 0.1
      }
    );
  }

  if (addRotation) {
    controls.push({
      kind: "number",
      id: `${idPrefix}-border-rotate`,
      label: "Border rotate",
      writeKey: "shape border rotate",
      value: geometry.shapeBorderRotate,
      step: 1,
      unit: "deg"
    });
  }

  return controls;
}

function shapeSupportsShapeBorderRotate(shape: Exclude<NodeShapePresetId, "custom">): boolean {
  return (
    shape === "trapezium"
    || shape === "semicircle"
    || shape === "regular polygon"
    || shape === "star"
    || shape === "isosceles triangle"
    || shape === "kite"
    || shape === "dart"
    || shape === "circular sector"
    || shape === "cylinder"
    || shape === "cloud"
    || shape === "starburst"
    || shape === "single arrow"
    || shape === "double arrow"
  );
}

function signalDirectionsToEnumValue(sides: SignalDirection[]): string {
  if (sides.length === 0) {
    return "nowhere";
  }
  const unique = Array.from(new Set(sides));
  if (unique.length === 1) {
    return requireArrayValue(unique, 0);
  }
  const sorted = [...unique].sort();
  if (sorted.length === 2 && sorted[0] === "east" && sorted[1] === "west") {
    return "east and west";
  }
  if (sorted.length === 2 && sorted[0] === "north" && sorted[1] === "south") {
    return "north and south";
  }
  return requireArrayValue(unique, 0);
}
