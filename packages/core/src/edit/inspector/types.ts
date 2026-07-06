import type { StyleLevel } from "../actions.js";
import type { EditParseOptions } from "../parse-options.js";
import type { SemanticPropertyId } from "../property-registry.js";
import type {
  ArrowTipWriteContext,
  FillModeMutationContext,
  FillPatternOptionMutationContext,
  NodeFontMutationContext,
  NodeMinimumDimensionsMutationContext,
  ShadowMutationContext,
  TransformInspectorKey,
  TransformInspectorPresence,
  TransformInspectorValues
} from "../property-write-builders.js";
import type { EditHandle } from "../../semantic/types.js";
import type {
  ArrowTipPresetId,
  ArrowTipPresetOption,
  ArrowTipSide,
  DashStylePresetId,
  DashStylePresetOption,
  FillModePresetId,
  FillModePresetOption,
  FillPatternMetaOptionKey,
  FillPatternPresetId,
  FillPatternPresetOption,
  FillShadingPresetId,
  FillShadingPresetOption,
  LineCapPresetId,
  LineCapPresetOption,
  LineJoinPresetId,
  LineJoinPresetOption,
  NodeFontFamilyId,
  NodeFontSizePresetId,
  NodeFontSizePresetOption,
  NodeShapePresetId,
  NodeShapePresetOption,
  PathMorphingDecorationPresetId,
  PathMorphingDecorationPresetOption,
  ShadowPresetId,
  ShadowPresetOption
} from "./presets.js";

export type InspectorSnapshot = {
  source: string;
  editHandles?: EditHandle[];
  parseOptions?: EditParseOptions;
};

export type NodeTextAlignInspectorValue = "unset" | "left" | "center" | "right" | "justify";

export type SetPropertyWriteTarget = {
  mode: "setProperty";
  elementId: string;
  level: StyleLevel;
  key: string;
  propertyId?: SemanticPropertyId;
  clearOnNoneKeys?: string[];
  transformContext?: {
    key: TransformInspectorKey;
    values: TransformInspectorValues;
    presence?: TransformInspectorPresence;
  };
  shadowContext?: ShadowMutationContext;
  writable: boolean;
  reason?: string;
};

export type ArrowTipWriteTarget = SetPropertyWriteTarget & {
  arrowContext: ArrowTipWriteContext;
};

export type InspectorProperty =
  | {
      kind: "text";
      id: string;
      label: string;
      value: string;
      write: SetPropertyWriteTarget;
      readOnlyReason?: string;
    }
  | {
      kind: "enum";
      id: string;
      label: string;
      value: string;
      options: Array<{ value: string; label: string }>;
      write: SetPropertyWriteTarget;
      readOnlyReason?: string;
    }
  | {
      kind: "boolean";
      id: string;
      label: string;
      value: boolean;
      trueValue?: string;
      falseValue?: string;
      clearKeys?: string[];
      write: SetPropertyWriteTarget;
      readOnlyReason?: string;
    }
  | {
      kind: "number";
      id: string;
      label: string;
      value: number;
      step: number;
      min?: number;
      minExclusive?: number;
      max?: number;
      unit?: string;
      defaultValue?: number;
      clearKeys?: string[];
      write?: SetPropertyWriteTarget;
      readOnlyReason?: string;
    }
  | {
      kind: "length";
      id: string;
      label: string;
      value: number;
      step: number;
      unit: "pt";
      defaultValue?: number;
      clearKeys?: string[];
      write: SetPropertyWriteTarget;
      note?: string;
      minimumDimensionsContext?: NodeMinimumDimensionsMutationContext;
      readOnlyReason?: string;
    }
  | {
      kind: "slider";
      id: string;
      label: string;
      value: number;
      min: number;
      max: number;
      step: number;
      ticks?: ReadonlyArray<{ value: number; label?: string }>;
      displayLabel?: string;
      write: SetPropertyWriteTarget;
      readOnlyReason?: string;
    }
  | {
      kind: "optionalLength";
      id: string;
      label: string;
      value: number | null;
      step: number;
      unit: "pt";
      clearKeys?: string[];
      write: SetPropertyWriteTarget;
      note?: string;
      readOnlyReason?: string;
    }
  | {
      kind: "color";
      id: string;
      label: string;
      value: string | null;
      syntaxValue: string | null;
      options: string[];
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "lineWidth";
      id: string;
      label: string;
      value: number;
      min: number;
      max: number;
      step: number;
      presetLabel: string | null;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "dashStyle";
      id: string;
      label: string;
      value: DashStylePresetId;
      options: DashStylePresetOption[];
      previewLineWidth: number;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "lineCap";
      id: string;
      label: string;
      value: LineCapPresetId;
      options: LineCapPresetOption[];
      previewLineWidth: number;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "lineJoin";
      id: string;
      label: string;
      value: LineJoinPresetId;
      options: LineJoinPresetOption[];
      previewLineWidth: number;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "pathMorphingDecoration";
      id: string;
      label: string;
      value: PathMorphingDecorationPresetId;
      options: PathMorphingDecorationPresetOption[];
      previewLineWidth: number;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "fillMode";
      id: string;
      label: string;
      value: FillModePresetId;
      options: FillModePresetOption[];
      context: FillModeMutationContext;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "fillShading";
      id: string;
      label: string;
      value: FillShadingPresetId;
      options: FillShadingPresetOption[];
      write: SetPropertyWriteTarget;
      note?: string;
    }
  | {
      kind: "fillPattern";
      id: string;
      label: string;
      value: FillPatternPresetId;
      options: FillPatternPresetOption[];
      write: SetPropertyWriteTarget;
      note?: string;
    }
  | {
      kind: "nodeTextAlign";
      id: string;
      label: string;
      value: NodeTextAlignInspectorValue;
      write: SetPropertyWriteTarget;
      clearKeys?: string[];
      readOnlyReason?: string;
    }
  | {
      kind: "nodeShape";
      id: string;
      label: string;
      value: NodeShapePresetId;
      options: NodeShapePresetOption[];
      write: SetPropertyWriteTarget;
      note?: string;
    }
  | {
      kind: "nodeFont";
      id: string;
      label: string;
      family: NodeFontFamilyId;
      weight: "normal" | "bold";
      style: "normal" | "italic";
      sizePreset: NodeFontSizePresetId;
      customSizePt: number | null;
      sizeOptions: NodeFontSizePresetOption[];
      context: NodeFontMutationContext;
      write: SetPropertyWriteTarget;
      note?: string;
    }
  | {
      kind: "fillPatternOption";
      id: string;
      label: string;
      option: FillPatternMetaOptionKey;
      value: number;
      step: number;
      unit?: string;
      context: FillPatternOptionMutationContext;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "roundedCorners";
      id: string;
      label: string;
      enabled: boolean;
      disableRequiresSharpCorners: boolean;
      radius: number;
      defaultRadius: number;
      min: number;
      max: number;
      step: number;
      write: SetPropertyWriteTarget;
    }
  | {
      kind: "arrowTip";
      id: string;
      label: string;
      side: ArrowTipSide;
      value: ArrowTipPresetId;
      options: ArrowTipPresetOption[];
      previewLineWidth: number;
      write: ArrowTipWriteTarget;
    }
  | {
      kind: "shadowPreset";
      id: string;
      label: string;
      value: ShadowPresetId;
      options: ShadowPresetOption[];
      context: ShadowMutationContext;
      write: SetPropertyWriteTarget;
    };

export type InspectorSection = {
  id: string;
  title: string;
  sourceLevel: StyleLevel;
  properties: InspectorProperty[];
};

export type InspectorDescriptor = {
  elementKind: "path" | "circle" | "ellipse" | "text" | "scope";
  elementId: string;
  writeTargetId: string | null;
  readOnlyReason?: string;
  infoNote?: string;
  sections: InspectorSection[];
};
