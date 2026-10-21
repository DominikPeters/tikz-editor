import { describe, expect, it } from "vitest";
import { computeSnapshot } from "../../packages/app/src/compute.js";
import { createTexNodeTextEngine } from "../../packages/core/src/text/tex-node-text-engine.js";
import { defaultTexMathFontProfile } from "../../packages/core/src/text/tex/math/font-profile.js";
import { getTexVListLayout } from "../../packages/core/src/text/tex/vlist/registry.js";

describe("snapshot text layout ownership", () => {
  it("retains the document's explicit report owner across unrelated renders", async () => {
    const source = String.raw`\begin{tikzpicture}\node {Snapshot report owner};\end{tikzpicture}`;
    const { snapshot } = await computeSnapshot({ id: "layout-owner", source });
    const unrelated = await createTexNodeTextEngine({ mathFontProfile: { ...defaultTexMathFontProfile, id: "unrelated-snapshot-owner" } });
    unrelated.measure({ text: "Other engine", textWidthPt: null, fontStyle: "normal", fontWeight: "normal", fontFamily: "serif", fontSizePt: 10 });
    expect(snapshot.textLayoutContext).toBeDefined();
    expect(snapshot.textLayoutContext).not.toBe(unrelated.layoutContext);
    const text = snapshot.scene?.elements.find((element) => element.kind === "Text");
    const paragraphId = text?.kind === "Text" && text.textRenderInfo?.mode === "tex" ? text.textRenderInfo.paragraphId : null;
    expect(paragraphId).not.toBeNull();
    expect(getTexVListLayout(snapshot.textLayoutContext, paragraphId)).not.toBeNull();
  });
});
