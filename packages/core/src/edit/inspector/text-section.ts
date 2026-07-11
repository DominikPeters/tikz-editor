import { colorOptionsForValue, normalizeInspectorColorValue, resolveColorSyntaxValue } from "./color-syntax.js";
import type { SectionBuilder } from "./section-builder.js";

const NODE_TARGET_KINDS = new Set(["node-item", "matrix-cell", "tree-child"]);

export const buildStandaloneTextSection: SectionBuilder = (context) => {
  if (context.element.kind !== "Text" || (context.targetKind && NODE_TARGET_KINDS.has(context.targetKind))) {
    return null;
  }

  const textColor = normalizeInspectorColorValue(context.element.style.textColor);
  const textColorSyntax = resolveColorSyntaxValue(
    context.resolvedTarget,
    ["text", "color"],
    textColor,
    context.colorAliases,
    context.element.styleChain
  );
  return {
    id: "text",
    title: "Text",
    sourceLevel: "command",
    properties: [
      {
        kind: "color",
        id: "text-color",
        label: "Color",
        value: textColor,
        syntaxValue: textColorSyntax,
        options: colorOptionsForValue(textColor),
        write: context.writeProperty("text")
      }
    ]
  };
};
