import { afterEach, describe, expect, it, vi } from "vitest";
import { parser } from "@tikz-editor/lezer-tikz";
import * as sourceColorDetection from "../packages/app/src/colors/source-color-detection.js";
import {
  collectProjectNamedColorSwatches,
  resolveProjectNamedColorSwatches
} from "../packages/app/src/colors/project-named-colors.js";

const SOURCE = String.raw`\begin{tikzpicture}
\definecolor{myred}{RGB}{255,0,0}
\colorlet{accent}{myred}
\draw[draw=accent] (0,0) -- (1,1);
\end{tikzpicture}`;

const TREE = parser.parse(SOURCE);

describe("project named colors", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reuses the previous swatch computation for identical source", () => {
    const spy = vi.spyOn(sourceColorDetection, "resolveDeclaredColors");

    const first = resolveProjectNamedColorSwatches(SOURCE, TREE);
    const second = resolveProjectNamedColorSwatches(SOURCE, TREE);

    expect(first).toEqual(second);
    // resolveDeclaredColors may be called once (cached internally) or not at all
    // on the second call since resolveProjectNamedColorSwatches caches by source
    expect(spy.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("reuses the previous swatch computation when non-declaration edits do not invalidate colors", () => {
    const updatedSource = String.raw`\begin{tikzpicture}
\definecolor{myred}{RGB}{255,0,0}
\colorlet{accent}{myred}
\draw[draw=accent] (2,3) -- (4,5);
\end{tikzpicture}`;

    const first = resolveProjectNamedColorSwatches(SOURCE, TREE);
    const second = resolveProjectNamedColorSwatches(updatedSource, parser.parse(updatedSource));

    expect(second).toBe(first);
  });

  it("still exposes the uncached collector for direct use", () => {
    const declaredColors = sourceColorDetection.collectDeclaredColors(SOURCE, TREE);
    const swatches = collectProjectNamedColorSwatches(declaredColors);
    expect(Array.isArray(swatches)).toBe(true);
    expect(swatches.every((swatch) => typeof swatch.token === "string" && typeof swatch.cssColor === "string")).toBe(true);
  });
});
