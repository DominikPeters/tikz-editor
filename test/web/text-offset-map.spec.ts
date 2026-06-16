import { describe, expect, it } from "vitest";

import { createSourceRenderOffsetMap } from "../../packages/app/src/ui/canvas-panel/text-offset-map.js";

describe("source/render text offset mapping", () => {
  it("maps TeX-derived render offsets back through normalized forced-break spacing", () => {
    const source = String.raw`Alpha \textsf{sans} plus $a^2=b$. \\[4pt] Beta \[\frac{1}{2}=\sqrt{z}\] Gamma`;
    const render = String.raw`Alpha \textsf{sans} plus $a^2=b$.\\[4pt]Beta \[\frac{1}{2}=\sqrt{z}\] Gamma`;
    const map = createSourceRenderOffsetMap(source, render);

    const sourceZ = source.indexOf("z");
    const renderZ = render.indexOf("z");

    expect(sourceZ).toBeGreaterThan(renderZ);
    expect(map.sourceToRender(sourceZ)).toBe(renderZ);
    expect(map.renderToSource(renderZ)).toBe(sourceZ);
  });
});
