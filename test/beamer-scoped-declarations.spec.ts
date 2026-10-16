import { describe, expect, it } from "vitest";
import { scanBeamerDocument } from "../packages/core/src/beamer/scan.js";
import { resolveBeamerTheme, resolveBeamerThemeColor } from "../packages/core/src/beamer/theme/resolve.js";
import { createBeamerScopedTheme } from "../packages/core/src/beamer/theme/scoped-declarations.js";
import { createIdentityMappedText, projectInputRange } from "../packages/core/src/text/source-map.js";

const source = String.raw`\documentclass{beamer}
\begin{document}\begin{frame}
\setbeamercolor{block title}{fg=red}
\setbeamerfont{block title}{size=\Large}
Before
{\setbeamercolor{block title}{fg=blue}\setbeamerfont{block title}{series=\bfseries}Inside}
After
\end{frame}\begin{frame}Next\end{frame}\end{document}`;

describe("frame-local Beamer declarations", () => {
  it("executes role changes in order and restores the enclosing group/frame state", () => {
    const document = scanBeamerDocument(source);
    const base = resolveBeamerTheme(document);
    const scope = createBeamerScopedTheme(document, base, document.frames[0]!.bodySpan);
    const before = scope.at(source.indexOf("Before"));
    const inside = scope.at(source.indexOf("Inside"));
    const after = scope.at(source.indexOf("After"));
    expect(resolveBeamerThemeColor(before, "block title").fg).toBe("#ff0000");
    expect(resolveBeamerThemeColor(inside, "block title").fg).toBe("#0000ff");
    expect(resolveBeamerThemeColor(after, "block title").fg).toBe("#ff0000");
    expect(before.fonts["block-title"]).toMatchObject({ sizePt: 14.4, series: "medium" });
    expect(inside.fonts["block-title"]).toMatchObject({ sizePt: 14.4, series: "bold" });
    expect(after.fonts["block-title"].series).toBe("medium");
    expect(createBeamerScopedTheme(document, base, document.frames[1]!.bodySpan).at(source.indexOf("Next"))).toBe(base);
    expect(base.fonts["block-title"].sizePt).toBe(12);
  });

  it("removes declaration paint while preserving authored text source ownership", () => {
    const document = scanBeamerDocument(source);
    const scope = createBeamerScopedTheme(document, resolveBeamerTheme(document), document.frames[0]!.bodySpan);
    const mapped = scope.project(createIdentityMappedText(source));
    expect(mapped.text).not.toContain("setbeamer");
    const offset = mapped.text.indexOf("After");
    expect(projectInputRange(mapped.sourceMap, offset, offset + 5)).toMatchObject({ from: source.indexOf("After"), to: source.indexOf("After") + 5 });
  });
});
