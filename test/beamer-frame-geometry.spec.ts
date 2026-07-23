import { describe, expect, it } from "vitest";

import {
  resolveBeamerPageGeometry,
  scanBeamerDocument,
} from "../packages/core/src/beamer/index.js";

describe("Beamer frame geometry contract", () => {
  it("resolves Madrid 16:9 geometry in TeX points", () => {
    const document = scanBeamerDocument(String.raw`
\documentclass[aspectratio=169]{beamer}
\usetheme{Madrid}
\begin{document}
\begin{frame}{A}B\end{frame}
\end{document}`);
    const geometry = resolveBeamerPageGeometry(document);

    expect(geometry.aspectRatio).toBe("169");
    expect(geometry.profile).toBe("madrid");
    expect(geometry.page.width).toBeCloseTo(455.24408, 4);
    expect(geometry.page.height).toBeCloseTo(256.0748, 4);
    expect(geometry.textArea.x).toBe(10.95);
    expect(geometry.textArea.width).toBeCloseTo(433.34408, 4);
    expect(geometry.footlineHeight).toBeCloseTo(12.658, 4);
  });

  it("uses Beamer's default page and margin profile", () => {
    const geometry = resolveBeamerPageGeometry(
      scanBeamerDocument(String.raw`
\documentclass{beamer}
\begin{document}\begin{frame}A\end{frame}\end{document}`)
    );

    expect(geometry.aspectRatio).toBe("43");
    expect(geometry.profile).toBe("beamer-default");
    expect(geometry.page.width).toBeCloseTo(364.19528, 4);
    expect(geometry.page.height).toBeCloseTo(273.14646, 4);
    expect(geometry.textArea.x).toBeCloseTo(28.45276, 4);
    expect(geometry.footlineHeight).toBe(0);
  });

  it("implements Beamer's custom aspect-ratio convention", () => {
    const geometry = resolveBeamerPageGeometry(
      scanBeamerDocument(String.raw`
\documentclass[aspectratio=1910]{beamer}
\begin{document}\begin{frame}A\end{frame}\end{document}`)
    );

    expect(geometry.page.width / geometry.page.height).toBeCloseTo(1.9, 10);
  });
});
