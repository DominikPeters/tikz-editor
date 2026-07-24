import { describe, expect, it } from "vitest";

import {
  planBeamerBlockTemplate,
  planBeamerTitlePageTemplate,
  resolveBeamerEnumerateMarker,
  resolveBeamerItemizeMarkers,
  resolveBeamerTheme,
  resolveBeamerThemeColor,
  scanBeamerDocument,
} from "../packages/core/src/beamer/index.js";

describe("Beamer theme resolution", () => {
  it("plans the class-default title, block, and triangle templates", () => {
    const theme = resolveBeamerTheme(scanBeamerDocument(String.raw`
\documentclass[11pt,aspectratio=169]{beamer}
\begin{document}\begin{frame}A\end{frame}\end{document}`));

    expect(planBeamerTitlePageTemplate(theme, true)).toEqual({
      templateId: "beamer/title-page/default",
      style: "colorbox",
      shadow: false,
      outerBleedPt: 0,
      titleBoxTopPt: 14.6,
      titleBoxHeightPt: 45.438339,
      titleBaselineFromBoxTopPt: 17.993591,
      subtitleBaselineFromBoxTopPt: 35.193588,
    });
    expect(
      planBeamerBlockTemplate({ environment: "block", theme })
    ).toEqual(
      expect.objectContaining({
        templateId: "beamer/block/default",
        style: "default",
        shadow: false,
        geometry: expect.objectContaining({
          titleBodyGapPt: 1,
          bodyFirstBaselineSkipPt: 13.6,
          bodyInitialVSkipEx: -0.25,
          flowBoxHeight: "title-ascent",
          flowEndingDepth: "body-last-line",
        }),
      })
    );
    expect(resolveBeamerItemizeMarkers(theme)[0]?.glyph).toEqual(
      expect.objectContaining({
        code: 73,
        fontId: "msam10",
        fontSizePt: 10.95,
      })
    );
    expect(resolveBeamerThemeColor(theme, "block title")).toEqual({
      fg: "#3333b3",
    });
    expect(resolveBeamerThemeColor(theme, "block title alerted")).toEqual({
      fg: "#ff0000",
    });
    expect(resolveBeamerThemeColor(theme, "block title example")).toEqual({
      fg: "#008000",
    });
  });

  it("composes Madrid structure with a later seahorse color patch", () => {
    const theme = resolveBeamerTheme(scanBeamerDocument(String.raw`
\documentclass{beamer}
\usetheme{Madrid}
\usecolortheme{seahorse}
\begin{document}\begin{frame}A\end{frame}\end{document}`));

    expect(theme.id).toBe("Madrid");
    expect(theme.templates.footline.id).toBe("beamer/footline/infolines");
    expect(theme.templates.navigationSymbols.id).toBe(
      "beamer/navigation-symbols/default"
    );
    expect(theme.templates.frameTitle.id).toBe("beamer/frame-title/default");
    expect(
      planBeamerBlockTemplate({ environment: "block", theme })
    ).toEqual(
      expect.objectContaining({
        templateId: "beamer/block/rounded-shadow",
        style: "rounded",
        shadow: true,
        titleColorRole: "block title",
        bodyColorRole: "block body",
        geometry: expect.objectContaining({
          beforeSkipPt: 6,
          outerBleedPt: expect.closeTo(4.015, 6),
          roundedTopInsetPt: expect.closeTo(3.01125, 6),
          titleDepthFloorPt: 1.5,
          bodyTopPaddingPt: 2,
        }),
      })
    );
    expect(theme.dimensions.textMarginLeftPt).toBe(10.95);
    expect(theme.colors.frametitle).toEqual({
      fg: "#000000",
      bg: "#d6d6f0",
    });
    expect(resolveBeamerThemeColor(theme, "title in head/foot")).toEqual({
      fg: "#000000",
      bg: "#cccced",
    });
    expect(resolveBeamerThemeColor(theme, "navigation symbols")).toEqual({
      fg: "#adade0",
    });
    expect(
      resolveBeamerThemeColor(theme, "navigation symbols dimmed")
    ).toEqual({
      fg: "#d6d6f0",
    });
    const markers = resolveBeamerItemizeMarkers(theme);
    expect(markers[0]).toEqual(expect.objectContaining({
      widthEm: expect.closeTo(0.47064, 6),
      depthEm: expect.closeTo(-0.2 / 10.95, 6),
    }));
    expect(markers[0]?.svgBody).toContain('data-beamer-list-marker="ball"');
    const enumerateMarker = resolveBeamerEnumerateMarker(theme, 3, 1);
    expect(enumerateMarker).toEqual(expect.objectContaining({
      widthEm: expect.closeTo(0.888, 6),
      heightEm: expect.closeTo(0.444, 6),
      depthEm: expect.closeTo(0.2886, 6),
      paintBoundsEm: expect.objectContaining({
        width: expect.closeTo(0.47064, 6),
        height: expect.closeTo(0.47064, 6),
      }),
      projectedText: expect.objectContaining({
        text: "3",
        fontId: "lmsans8-regular",
        fontSizePt: 6,
      }),
    }));
    expect(enumerateMarker?.svgBody).toContain(
      'data-beamer-list-marker="enumerate-ball"'
    );
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
      expect(theme.templates.navigationSymbols.id).toBe(
        "beamer/navigation-symbols/none"
      );
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
