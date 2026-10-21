import {
  parseSimpleTexParagraphIr,
  type SimpleTexInlineNode,
  type SimpleTexNode,
} from "../../text/tex/ir.js";

export type NormalizedNodeText = {
  text: string;
  fontSizePt: number;
};

/**
 * Resolve a leading TeX size declaration for node-box geometry without
 * rewriting the source consumed by the shared TeX frontend.
 */
export function normalizeNodeTextFontSize(
  text: string,
  baseFontSizePt: number
): NormalizedNodeText {
  if (text.length === 0) {
    return { text, fontSizePt: baseFontSizePt };
  }
  const ir = parseSimpleTexParagraphIr(text);
  return {
    text,
    fontSizePt: leadingSimpleTexFontSize(ir.nodes) ?? baseFontSizePt,
  };
}

function leadingSimpleTexFontSize(
  nodes: readonly SimpleTexNode[]
): number | null {
  const meaningful = nodes.filter(
    (node): node is SimpleTexInlineNode =>
      node.kind !== "space" &&
      node.kind !== "comment" &&
      node.kind !== "paragraph-break" &&
      node.kind !== "display-math" &&
      node.kind !== "noindent" &&
      node.kind !== "alignment" &&
      node.kind !== "environment-boundary" &&
      node.kind !== "item" &&
      node.kind !== "vertical-glue" &&
      node.kind !== "vertical-rule" &&
      node.kind !== "penalty" &&
      node.kind !== "box" &&
      node.kind !== "unsupported-command"
  );
  if (meaningful.length === 1 && meaningful[0]?.kind === "group") {
    return leadingSimpleTexFontSize(meaningful[0].children);
  }
  const first = meaningful[0];
  return first?.kind === "style-declaration" && first.sizePt !== undefined
    ? first.sizePt
    : null;
}
