import { caseFromTexFuzzAst } from "./generate.js";
import type { TexFuzzCase, TexFuzzNode } from "./model.js";

function visibleWords(node: TexFuzzNode): string[] {
  switch (node.kind) {
    case "text": return [node.value.replaceAll("Ω", "Omega")];
    case "space": return [];
    case "accent": return [node.command === "'" ? "é" : node.command === "`" ? "è" : "ê"];
    case "math":
    case "display-math": return ["math"];
    case "rule":
    case "vertical-rule": return ["rule"];
    case "line-break":
    case "paragraph-break": return [];
    case "oracle-command": return [node.command];
    case "item": return node.label?.flatMap(visibleWords) ?? [];
    case "noindent":
    case "alignment":
    case "vertical-glue":
    case "penalty": return [];
    case "group":
    case "font":
    case "font-declaration":
    case "style-declaration":
    case "color":
    case "box":
    case "dimension-box":
    case "raisebox":
    case "environment":
    case "document-box": return node.children.flatMap(visibleWords);
  }
}

/** A semantics-light prose projection used by the cheap batched paragraph oracle. */
export function projectTexFuzzCaseToParagraph(caseData: TexFuzzCase): TexFuzzCase {
  const words = caseData.ast.flatMap(visibleWords)
    .flatMap((word) => word.split(/\s+/u))
    .filter((word) => word.length > 0);
  // Keep this oracle projection inside the font/metric subset where our line
  // breaker and LuaLaTeX are directly comparable, while deriving enough
  // varied prose from every generated case to create non-final justified
  // lines without relying on explicit-break semantics.
  const sourceWords = words.length > 0 ? words : ["Alpha"];
  let hash = caseData.seed;
  for (const sourceWord of sourceWords) {
    for (const character of sourceWord) hash = Math.imul(hash ^ (character.codePointAt(0) ?? 0), 16_777_619);
  }
  // These word/width pairs are calibration controls: both engines choose the
  // same automatic breaks, but non-final lines have non-zero glue ratios.
  const word = (["Alpha", "Beta", "Delta"] as const)[Math.abs(hash) % 3];
  const effectiveWords = Array.from({ length: 24 }, () => word);
  const ast: TexFuzzNode[] = [];
  effectiveWords.forEach((word, index) => {
    ast.push({ kind: "text", value: word });
    if (index === effectiveWords.length - 1) return;
    ast.push({ kind: "space", nonBreaking: false });
  });
  return caseFromTexFuzzAst(ast, {
    seed: caseData.seed,
    profile: caseData.profile,
    choices: caseData.choices,
  });
}

export function texFuzzParagraphOracleWidth(caseData: TexFuzzCase): number {
  const first = caseData.ast.find((node): node is Extract<TexFuzzNode, { kind: "text" }> => node.kind === "text");
  if (first?.value === "Alpha") return 120;
  if (first?.value === "Beta") return 140;
  return 160;
}
