import { describe, expect, it } from "vitest";
import {
  checkTexFuzzHardInvariants,
  generateTexFuzzCase,
} from "@tikz-editor/tex-fuzz";

describe("adversarial TeX generator breadth", () => {
  it("covers every expanded inline family without violating range invariants", () => {
    const features = new Set<string>();
    for (let seed = 0; seed < 25; seed += 1) {
      const caseData = generateTexFuzzCase(seed, { profile: "aggressive", depth: 5, size: 8 });
      expect(checkTexFuzzHardInvariants(caseData)).toEqual([]);
      caseData.features.forEach((feature) => features.add(feature));
    }
    expect([...features]).toEqual(expect.arrayContaining([
      "text.font-command.textnormal",
      "text.font-command.textsc",
      "text.font-declaration.bfseries",
      "text.style-declaration.fontsize",
      "box.text.fcolorbox",
      "box.text.framebox",
      "box.dimension.phantom",
      "box.raisebox",
      "box.rule",
      "text.line-break",
      "math.inline",
    ]));
  }, 15_000);

  it("covers document controls and display delimiters", () => {
    const features = new Set<string>();
    for (let seed = 0; seed < 25; seed += 1) {
      const caseData = generateTexFuzzCase(seed, { profile: "document", depth: 4, size: 10 });
      expect(checkTexFuzzHardInvariants(caseData)).toEqual([]);
      caseData.features.forEach((feature) => features.add(feature));
    }
    expect([...features]).toEqual(expect.arrayContaining([
      "document.paragraph-break",
      "document.noindent",
      "document.alignment.centering",
      "document.environment.itemize",
      "document.environment.description",
      "document.item",
      "document.vertical-glue.vspace",
      "document.penalty",
      "document.vertical-rule",
      "document.box.parbox",
      "document.box.minipage",
      "math.display.bracket",
      "math.display.align",
      "math.display.multline-star",
    ]));
  }, 15_000);
});
