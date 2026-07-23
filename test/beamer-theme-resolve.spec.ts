import { describe, expect, it } from "vitest";

import {
  resolveBeamerItemizeMarkers,
  resolveBeamerTheme,
  resolveBeamerThemeColor,
  scanBeamerDocument,
} from "../packages/core/src/beamer/index.js";

describe("Beamer theme resolution", () => {
  it("composes Madrid structure with a later seahorse color patch", () => {
    const theme = resolveBeamerTheme(scanBeamerDocument(String.raw`
\documentclass{beamer}
\usetheme{Madrid}
\usecolortheme{seahorse}
\begin{document}\begin{frame}A\end{frame}\end{document}`));

    expect(theme.id).toBe("Madrid");
    expect(theme.templates.footline.id).toBe("beamer/footline/infolines");
    expect(theme.templates.frameTitle.id).toBe("beamer/frame-title/default");
    expect(theme.dimensions.textMarginLeftPt).toBe(10.95);
    expect(theme.colors.frametitle).toEqual({
      fg: "#000000",
      bg: "#d6d6f0",
    });
    expect(resolveBeamerThemeColor(theme, "title in head/foot")).toEqual({
      fg: "#000000",
      bg: "#cccced",
    });
    const markers = resolveBeamerItemizeMarkers(theme);
    expect(markers[0]).toEqual(expect.objectContaining({
      widthEm: expect.closeTo(0.47064, 6),
      depthEm: expect.closeTo(-0.2 / 10.95, 6),
    }));
    expect(markers[0]?.svgBody).toContain('data-beamer-list-marker="ball"');
    expect(theme.appliedComponents.map(({ kind, name }) => [kind, name])).toEqual([
      ["class-defaults", "beamer"],
      ["theme", "Madrid"],
      ["color-theme", "whale"],
      ["color-theme", "orchid"],
      ["inner-theme", "rounded"],
      ["outer-theme", "infolines"],
      ["color-theme", "seahorse"],
    ]);
  });

  it.each(["metropolis", "moloch"])(
    "resolves %s through the same component/template contract",
    (name) => {
      const theme = resolveBeamerTheme(scanBeamerDocument(String.raw`
\documentclass{beamer}
\usetheme[progressbar=frametitle,block=fill]{${name}}
\begin{document}\begin{frame}A\end{frame}\end{document}`));

      expect(theme.id).toBe(name);
      expect(theme.templates.frameTitle).toEqual({
        id: `beamer/frame-title/${name}`,
        options: { progressbar: true },
      });
      expect(theme.templates.block).toEqual({
        id: `beamer/block/${name}`,
        options: { style: "fill" },
      });
      expect(theme.fonts["frame-title"]).toEqual(
        expect.objectContaining({
          family: "sans",
          series: "bold",
          sizePt: 12,
          ...(name === "metropolis"
            ? { substitutedFor: "Fira Sans" }
            : {}),
        })
      );
      const markers = resolveBeamerItemizeMarkers(theme);
      expect(markers[0]?.svgBody).toContain(
        'data-beamer-list-marker="bullet"'
      );
      expect(markers[1]?.svgBody).toContain(
        `data-beamer-list-marker="${name === "moloch" ? "circle" : "bullet"}"`
      );
      expect(theme.diagnostics).toEqual(
        name === "metropolis"
          ? [expect.objectContaining({ code: "beamer-font-substitution" })]
          : []
      );
    }
  );

  it("reports unknown components without replacing the resolved defaults", () => {
    const theme = resolveBeamerTheme(scanBeamerDocument(String.raw`
\documentclass{beamer}
\usetheme{UnknownHouseStyle}
\begin{document}\begin{frame}A\end{frame}\end{document}`));

    expect(theme.id).toBe("default");
    expect(theme.templates.frameTitle.id).toBe("beamer/frame-title/default");
    expect(theme.diagnostics).toEqual([
      expect.objectContaining({ code: "beamer-unknown-theme-component" }),
    ]);
  });
});
