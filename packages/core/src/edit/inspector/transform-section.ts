import {
  cloneTransformInspectorValues,
  DEFAULT_TRANSFORM_INSPECTOR_VALUES,
  resolveTransformInspectorMutationContext,
  transformRotateInspectorLabel,
  type TransformInspectorKey,
  type TransformInspectorMutationContext
} from "../property-write-builders.js";
import type { SetPropertyWriteTarget } from "./types.js";
import type { SectionBuilder } from "./section-builder.js";

export const buildTransformSection: SectionBuilder = (context) => {
  if (context.targetKind === "tree-child" || context.targetKind === "matrix-cell") {
    return null;
  }

  const transformContext = resolveTransformInspectorMutationContext(
    context.source,
    context.targetId,
    context.parseOptions,
    context.resolveTarget
  );
  const values = transformContext.values;
  const write = (key: TransformInspectorKey): SetPropertyWriteTarget => ({
    ...context.writeProperty(key),
    transformContext: {
      key,
      values: cloneTransformInspectorValues(transformContext.values),
      presence: transformContext.presence ? { ...transformContext.presence } : undefined
    }
  });

  return {
    id: "transform",
    title: "Transform",
    sourceLevel: "command",
    properties: [
      {
        kind: "number",
        id: "xshift",
        label: "X shift",
        value: values.xshift,
        step: 0.1,
        unit: "pt",
        defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.xshift,
        write: write("xshift")
      },
      {
        kind: "number",
        id: "yshift",
        label: "Y shift",
        value: values.yshift,
        step: 0.1,
        unit: "pt",
        defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.yshift,
        write: write("yshift")
      },
      {
        kind: "number",
        id: "xscale",
        label: "X scale",
        value: values.xscale,
        step: 0.1,
        defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.xscale,
        write: write("xscale")
      },
      {
        kind: "number",
        id: "yscale",
        label: "Y scale",
        value: values.yscale,
        step: 0.1,
        defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.yscale,
        write: write("yscale")
      },
      {
        kind: "number",
        id: "rotate",
        label: transformRotateInspectorLabel(transformContext),
        value: values.rotate,
        step: 1,
        unit: "deg",
        defaultValue: DEFAULT_TRANSFORM_INSPECTOR_VALUES.rotate,
        write: write("rotate")
      }
    ]
  };
};

export type { TransformInspectorMutationContext };
