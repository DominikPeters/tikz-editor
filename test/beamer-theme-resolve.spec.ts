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
      parent: "titlelike",
    });
    expect(resolveBeamerThemeColor(theme, "frametitle")).toEqual({
      fg: "#000000",
      bg: "#d6d6f0",
    });
    expect(resolveBeamerThemeColor(theme, "block title example")).toEqual({ fg: "#ffffff", bg: "#006000" });
    expect(resolveBeamerThemeColor(theme, "block body example")).toEqual({ fg: "#000000", bg: "#e6efe6" });
    expect(resolveBeamerThemeColor(theme, "block title alerted")).toEqual({ fg: "#ffffff", bg: "#bf0000" });
    expect(resolveBeamerThemeColor(theme, "block body alerted")).toEqual({ fg: "#000000", bg: "#f9e6e6" });
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

  it("applies aggregate components in source order and honors theme options", () => {
    const theme = resolveBeamerTheme(scanBeamerDocument(String.raw`
\documentclass{beamer}
\usetheme[secheader]{Madrid}
\begin{document}\begin{frame}A\end{frame}\end{document}`));

    expect(theme.templates.headline.id).toBe(
      "beamer/headline/infolines"
    );
    expect(theme.appliedComponents.map(({ kind, name }) => [kind, name]))
      .toEqual([
        ["class-defaults", "beamer"],
        ["theme", "Madrid"],
        ["color-theme", "whale"],
        ["color-theme", "orchid"],
        ["inner-theme", "rounded"],
        ["outer-theme", "infolines"],
      ]);
  });

  it.each([
    {
      name: "AnnArbor",
      components: ["rounded", "infolines", "wolverine"],
      headline: "beamer/headline/infolines",
      titlePage: "beamer/title-page/rounded-shadow",
      block: "beamer/block/rounded-shadow",
      primary: { fg: "#00007a", bg: "#ffec00" },
      frameTitle: { fg: "#3333b3", bg: "#fff200" },
      blockTitleSizePt: 10.95,
    },
    {
      name: "Boadilla",
      components: ["rose", "rounded", "dolphin", "infolines"],
      headline: "beamer/headline/none",
      titlePage: "beamer/title-page/rounded-shadow",
      block: "beamer/block/rounded-shadow",
      primary: { fg: "#000000", bg: "#adade0" },
      frameTitle: { fg: "#3333b3" },
      blockTitleSizePt: 12,
    },
    {
      name: "CambridgeUS",
      components: ["rounded", "infolines", "beaver"],
      headline: "beamer/headline/infolines",
      titlePage: "beamer/title-page/rounded-shadow",
      block: "beamer/block/rounded-shadow",
      primary: { fg: "#7a0000", bg: "#d9d9d9" },
      frameTitle: { fg: "#3333b3", bg: "#f2f2f2" },
      blockTitleSizePt: 10.95,
    },
    {
      name: "EastLansing",
      components: ["rounded", "infolines", "spruce"],
      headline: "beamer/headline/infolines",
      titlePage: "beamer/title-page/rounded",
      block: "beamer/block/rounded",
      primary: { fg: "#003d1f", bg: "#d9e8e0" },
      frameTitle: { fg: "#3333b3", bg: "#e6f0eb" },
      blockTitleSizePt: 12,
    },
  ])(
    "resolves the shipped $name aggregate through reusable components",
    ({
      name,
      components,
      headline,
      titlePage,
      block,
      primary,
      frameTitle,
      blockTitleSizePt,
    }) => {
      const theme = resolveBeamerTheme(scanBeamerDocument(String.raw`
\documentclass{beamer}
\usetheme{${name}}
\begin{document}\begin{frame}A\end{frame}\end{document}`));

      expect(theme.id).toBe(name);
      expect(theme.templates.headline.id).toBe(headline);
      expect(theme.templates.titlePage.id).toBe(titlePage);
      expect(theme.templates.block.id).toBe(block);
      expect(resolveBeamerThemeColor(theme, "palette primary")).toEqual(
        primary
      );
      expect(resolveBeamerThemeColor(theme, "frametitle")).toEqual(
        frameTitle
      );
      expect(theme.fonts["block-title"].sizePt).toBe(blockTitleSizePt);
      expect(
        theme.appliedComponents.slice(2).map(({ name: component }) => component)
      ).toEqual(components);
      expect(theme.diagnostics).toEqual([]);
    }
  );

  it("retains Boadilla's local marker and optional headline overrides", () => {
    const theme = resolveBeamerTheme(scanBeamerDocument(String.raw`
\documentclass{beamer}
\usetheme[secheader]{Boadilla}
\begin{document}\begin{frame}A\end{frame}\end{document}`));
    const markers = resolveBeamerItemizeMarkers(theme);

    expect(theme.templates.headline.id).toBe("beamer/headline/infolines");
    expect(resolveBeamerThemeColor(theme, "block title")).toEqual({
      fg: "#3333b3",
      bg: "#d6d6f0",
    });
    expect(resolveBeamerThemeColor(theme, "block body")).toEqual({
      fg: "#000000",
      bg: "#ebebf7",
    });
    expect(planBeamerTitlePageTemplate(theme, true)).toEqual(
      expect.objectContaining({
        templateId: "beamer/title-page/rounded-shadow",
        style: "colorbox",
        shadow: false,
        titleBoxHeightPt: 45.438339,
      })
    );
    expect(markers[1]?.glyph).toEqual(
      expect.objectContaining({
        code: 0x49,
        fontId: "msam7",
        fontSizePt: 6,
      })
    );
    expect(markers[2]?.glyph).toEqual(
      expect.objectContaining({
        code: 0x46,
        fontId: "msam7",
        fontSizePt: 6,
      })
    );
  });

  it.each([
    {
      name: "Antibes",
      components: ["tree", "whale", "orchid", "rectangles"],
      headline: ["beamer/headline/tree", { hooks: true }],
      footline: ["beamer/footline/none", {}],
    },
    {
      name: "Montpellier",
      components: ["tree"],
      headline: ["beamer/headline/tree", { hooks: true }],
      footline: ["beamer/footline/none", {}],
    },
    {
      name: "Luebeck",
      components: ["split", "rectangles", "whale", "orchid"],
      headline: ["beamer/headline/split", { compress: false }],
      footline: ["beamer/footline/split", {}],
    },
    {
      name: "Malmoe",
      components: ["split", "whale"],
      headline: ["beamer/headline/split", { compress: false }],
      footline: ["beamer/footline/split", {}],
    },
    {
      name: "Copenhagen",
      components: ["split", "rounded", "whale", "orchid"],
      headline: ["beamer/headline/split", { compress: false }],
      footline: ["beamer/footline/split", {}],
    },
    {
      name: "Berlin",
      components: ["miniframes", "whale", "orchid", "rectangles"],
      headline: [
        "beamer/headline/miniframes",
        { subsection: true, compress: false, fade: false },
      ],
      footline: [
        "beamer/footline/miniframes",
        { style: "authorinstitutetitle" },
      ],
    },
    {
      name: "Dresden",
      components: ["miniframes", "whale"],
      headline: [
        "beamer/headline/miniframes",
        { subsection: true, compress: false, fade: false },
      ],
      footline: [
        "beamer/footline/miniframes",
        { style: "authorinstitutetitle" },
      ],
    },
    {
      name: "Ilmenau",
      components: ["miniframes", "whale", "orchid", "rounded"],
      headline: [
        "beamer/headline/miniframes",
        { subsection: true, compress: false, fade: false },
      ],
      footline: [
        "beamer/footline/miniframes",
        { style: "authorinstitutetitle" },
      ],
    },
    {
      name: "Szeged",
      components: ["miniframes"],
      headline: [
        "beamer/headline/miniframes",
        { subsection: true, compress: false, fade: false },
      ],
      footline: [
        "beamer/footline/miniframes",
        { style: "institutetitle" },
      ],
    },
    {
      name: "Singapore",
      components: ["miniframes"],
      headline: [
        "beamer/headline/miniframes",
        { subsection: false, compress: false, fade: true },
      ],
      footline: ["beamer/footline/miniframes", { style: "empty" }],
    },
  ])(
    "composes the source-defined $name navigation aggregate",
    ({ name, components, headline, footline }) => {
      const theme = resolveBeamerTheme(scanBeamerDocument(String.raw`
\documentclass{beamer}
\usetheme{${name}}
\begin{document}\begin{frame}A\end{frame}\end{document}`));

      expect(theme.templates.headline).toEqual({
        id: headline[0],
        options: headline[1],
      });
      expect(theme.templates.footline).toEqual({
        id: footline[0],
        options: footline[1],
      });
      expect(
        theme.appliedComponents.slice(2).map(({ name: component }) => component)
      ).toEqual(components);
      expect(theme.diagnostics).toEqual([]);
    }
  );

  it("preserves aggregate options and Singapore's local source overrides", () => {
    const berlin = resolveBeamerTheme(scanBeamerDocument(String.raw`
\documentclass{beamer}
\usetheme[compress]{Berlin}
\begin{document}\begin{frame}A\end{frame}\end{document}`));
    const singapore = resolveBeamerTheme(scanBeamerDocument(String.raw`
\documentclass{beamer}
\usetheme{Singapore}
\begin{document}\begin{frame}A\end{frame}\end{document}`));

    expect(berlin.templates.headline.options.compress).toBe(true);
    expect(singapore.templates.frameTitle).toEqual({
      id: "beamer/frame-title/default",
      options: { alignment: "center" },
    });
    expect(singapore.templates.bullets.map(({ id }) => id)).toEqual([
      "beamer/bullet/circle",
      "beamer/bullet/circle",
      "beamer/bullet/circle",
    ]);
    expect(resolveBeamerItemizeMarkers(singapore)[0]?.glyph).toEqual(
      expect.objectContaining({
        code: 15,
        fontId: "cmsy10",
        fontSizePt: 10.95,
      })
    );
    expect(
      resolveBeamerThemeColor(singapore, "section in head/foot fade")
    ).toEqual({ fg: "#ccccec" });
  });

  it.each([
    {
      name: "Darmstadt",
      components: ["smoothbars", "rounded", "orchid", "whale"],
      headline: ["beamer/headline/smoothbars", { subsection: true }],
      footline: ["beamer/footline/none", {}],
      frameTitle: ["beamer/frame-title/smoothbars", { subsection: true }],
    },
    {
      name: "Frankfurt",
      components: ["smoothbars", "rounded", "orchid", "whale"],
      headline: ["beamer/headline/smoothbars", { subsection: false }],
      footline: ["beamer/footline/none", {}],
      frameTitle: ["beamer/frame-title/smoothbars", { subsection: false }],
    },
    {
      name: "JuanLesPins",
      components: ["smoothtree", "whale", "orchid", "rounded"],
      headline: ["beamer/headline/smoothtree", {}],
      footline: ["beamer/footline/none", {}],
      frameTitle: ["beamer/frame-title/smoothtree", {}],
    },
    {
      name: "Warsaw",
      components: ["rounded", "split", "shadow", "orchid", "whale"],
      headline: ["beamer/headline/shadow", { compress: false }],
      footline: ["beamer/footline/split", {}],
      frameTitle: ["beamer/frame-title/shadow", {}],
    },
  ])(
    "composes the source-defined $name smooth navigation aggregate",
    ({ name, components, headline, footline, frameTitle }) => {
      const theme = resolveBeamerTheme(scanBeamerDocument(String.raw`
\documentclass{beamer}
\usetheme{${name}}
\begin{document}\begin{frame}A\end{frame}\end{document}`));

      expect(theme.templates.headline).toEqual({
        id: headline[0],
        options: headline[1],
      });
      expect(theme.templates.footline).toEqual({
        id: footline[0],
        options: footline[1],
      });
      expect(theme.templates.frameTitle).toEqual({
        id: frameTitle[0],
        options: frameTitle[1],
      });
      expect(theme.templates.block.id).toBe(
        "beamer/block/rounded-shadow"
      );
      expect(theme.fonts["block-title"].sizePt).toBe(10.95);
      expect(
        theme.appliedComponents.slice(2).map(({ name: component }) => component)
      ).toEqual(components);
      expect(theme.diagnostics).toEqual([]);
    }
  );

  it("resolves shadow through split before applying its frame-title colors", () => {
    const theme = resolveBeamerTheme(scanBeamerDocument(String.raw`
\documentclass{beamer}
\usetheme{Warsaw}
\begin{document}\begin{frame}A\end{frame}\end{document}`));

    expect(resolveBeamerThemeColor(theme, "section in head/foot")).toEqual({
      fg: "#ffffff",
      bg: "#000000",
    });
    expect(resolveBeamerThemeColor(theme, "subsection in head/foot")).toEqual({
      fg: "#ffffff",
      bg: "#3333b3",
    });
    expect(resolveBeamerThemeColor(theme, "frametitle")).toEqual({
      fg: "#ffffff",
      bg: "#3333b3",
    });
    expect(resolveBeamerThemeColor(theme, "frametitle right")).toEqual({
      fg: "#ffffff",
      bg: "#000000",
    });
  });

  it("uses the rectangles inner theme for both itemize and enumerate markers", () => {
    const theme = resolveBeamerTheme(scanBeamerDocument(String.raw`
\documentclass{beamer}
\useinnertheme{rectangles}
\begin{document}\begin{frame}A\end{frame}\end{document}`));

    expect(resolveBeamerItemizeMarkers(theme)[0]?.svgBody).toContain(
      'data-beamer-list-marker="square"'
    );
    const marker = resolveBeamerEnumerateMarker(theme, 12, 1);
    expect(marker?.svgBody).toContain(
      'data-beamer-list-marker="enumerate-square"'
    );
    expect(marker?.projectedText).toEqual(expect.objectContaining({
      text: "12",
      fontId: "lmsans8-regular",
      fontSizePt: 8,
    }));
  });

  it("models the colored default block as joined source colorboxes", () => {
    const theme = resolveBeamerTheme(scanBeamerDocument(String.raw`
\documentclass{beamer}
\usetheme{Antibes}
\begin{document}\begin{frame}A\end{frame}\end{document}`));
    const block = planBeamerBlockTemplate({ environment: "block", theme });

    expect(block).toEqual(expect.objectContaining({
      templateId: "beamer/block/default",
      style: "default",
      geometry: expect.objectContaining({
        outerBleedPt: expect.closeTo(3.64635, 4),
        roundedTopInsetPt: expect.closeTo(3.64635, 4),
        transitionHeightPt: -0.5,
        bodyInitialVSkipEx: 0,
        flowBoxHeight: "natural",
        flowEndingDepth: "zero",
      }),
    }));
  });

  it("composes Bergen as the source-defined responsive in-margin theme", () => {
    const theme = resolveBeamerTheme(scanBeamerDocument(String.raw`
\documentclass{beamer}
\usetheme{Bergen}
\begin{document}\begin{frame}A\end{frame}\end{document}`));

    expect(
      theme.appliedComponents.slice(2).map(({ name }) => name)
    ).toEqual(["orchid", "rectangles", "inmargin"]);
    expect(theme.dimensions.sidebarWidthLeft).toEqual({
      kind: "page-width",
      ratio: 0.25,
    });
    expect(theme.dimensions.listLeftMarginEmByDepth).toEqual([
      0,
      expect.closeTo(0.666, 3),
      expect.closeTo(0.666, 3),
    ]);
    expect(theme.templates.sidebar.id).toBe("beamer/sidebar/canvas");
    expect(theme.templates.titlePage.id).toBe(
      "beamer/title-page/inmargin"
    );
    expect(theme.templates.block.id).toBe("beamer/block/inmargin");
    expect(
      planBeamerBlockTemplate({ environment: "block", theme })
    ).toEqual(expect.objectContaining({
      style: "inmargin",
      geometry: expect.objectContaining({
        beforeSkipPt: 6,
        afterSkipPt: 0,
        boxBottomSkipPt: 3,
      }),
    }));
    expect(resolveBeamerItemizeMarkers(theme)[0]?.rightEdgeOffsetEm)
      .toBeCloseTo(-0.666, 3);
    expect(
      resolveBeamerEnumerateMarker(theme, 1, 1)?.rightEdgeOffsetEm
    ).toBeCloseTo(-0.666, 3);
  });

  it.each([
    ["Berkeley", ["sidebar", "rectangles", "whale", "orchid"]],
    ["Goettingen", ["sidebar"]],
    ["Hannover", ["sidebar", "seahorse", "circles"]],
    ["Marburg", ["whale", "sidebar"]],
    ["PaloAlto", ["sidebar", "rounded", "orchid", "whale"]],
    ["Pittsburgh", ["circles"]],
    ["Rochester", ["sidebar", "rectangles", "whale", "orchid"]],
  ])(
    "composes the source-defined %s sidebar-family aggregate",
    (name, components) => {
      const theme = resolveBeamerTheme(scanBeamerDocument(String.raw`
\documentclass{beamer}
\usetheme{${name}}
\begin{document}\begin{frame}A\end{frame}\end{document}`));

      expect(
        theme.appliedComponents.slice(2).map(({ name: component }) => component)
      ).toEqual(components);
      expect(theme.diagnostics).toEqual([]);
    }
  );

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
