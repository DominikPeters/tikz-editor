import { describe, expect, it } from "vitest";
import {
  BEAMER_PRESENTATION_THEMES,
  buildDeckDocumentInspector,
  prepareBeamerDocument,
  buildDeckFrameInspector,
  buildDeckSlideContext,
  scanBeamerDocument,
  type DeckInspectorField,
} from "../packages/core/src/beamer/index.js";
import {
  BEAMER_COLOR_THEMES,
  BEAMER_FONT_THEMES,
  BEAMER_INNER_THEMES,
  BEAMER_OUTER_THEMES,
} from "../packages/core/src/beamer/theme/catalog.js";
import { beamerChromeMetadataFields } from "../packages/core/src/beamer/theme/chrome-metadata.js";
import { registeredBeamerThemeComponents, resolveBeamerTheme } from "../packages/core/src/beamer/theme/resolve.js";

function deck(preamble: string[], body: string[] = ["\\begin{frame}{One}", "Text", "\\end{frame}"]): string {
  return [...preamble, "\\begin{document}", ...body, "\\end{document}"].join("\n");
}

function field(fields: readonly DeckInspectorField[], id: string): DeckInspectorField {
  const found = fields.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing field ${id}`);
  return found;
}

describe("Beamer theme catalog", () => {
  it("lists exactly the components the resolver applies", () => {
    const sorted = (names: readonly string[]) => [...names].sort();
    expect(sorted(BEAMER_PRESENTATION_THEMES.map((entry) => entry.id))).toEqual(sorted(registeredBeamerThemeComponents("theme")));
    expect(sorted(BEAMER_COLOR_THEMES.map((entry) => entry.id))).toEqual(sorted(registeredBeamerThemeComponents("color-theme")));
    expect(sorted(BEAMER_FONT_THEMES)).toEqual(sorted(registeredBeamerThemeComponents("font-theme")));
    expect(sorted(BEAMER_INNER_THEMES)).toEqual(sorted(registeredBeamerThemeComponents("inner-theme")));
    expect(sorted(BEAMER_OUTER_THEMES)).toEqual(sorted(registeredBeamerThemeComponents("outer-theme")));
  });
});

describe("chrome metadata fields", () => {
  // Every field gets a distinct short form, so a rendered item whose span lies
  // inside one shows that the chrome printed it.
  for (const theme of BEAMER_PRESENTATION_THEMES) {
    it(`matches what ${theme.name} renders`, async () => {
      const source = deck([
        "\\documentclass{beamer}",
        `\\usetheme{${theme.name}}`,
        "\\title[ST]{Long Title}",
        "\\author[SA]{Long Author}",
        "\\institute[SI]{Long Institute}",
        "\\date[SD]{Long Date}",
      ], ["\\section{S}", "\\begin{frame}{F}", "x", "\\end{frame}"]);
      const document = scanBeamerDocument(source);
      const page = await prepareBeamerDocument(source).renderFrame({ frameIndex: 0, step: 1 });
      const printed = (["title", "author", "institute", "date"] as const).filter((name) => {
        const span = document.preamble.metadata[name]!.shortValue!.contentSpan;
        return page.layout.items.some((item) => item.sourceSpan.from >= span.from && item.sourceSpan.to <= span.to);
      });
      const resolved = resolveBeamerTheme(document);
      const expected = beamerChromeMetadataFields(resolved);
      // Infolines prints "author (institute)" as one derived string mapped to
      // the author, so its institute has no span of its own.
      const unmapped = resolved.templates.footline.id === "beamer/footline/infolines" ? ["institute"] : [];
      expect(printed).toEqual(expected.filter((name) => !unmapped.includes(name)));
    });
  }
});

describe("buildDeckDocumentInspector", () => {
  it("reads a moloch deck: options, color override, page and title info", () => {
    const document = scanBeamerDocument(deck([
      "\\documentclass[aspectratio=169,10pt]{beamer}",
      "\\usetheme[progressbar=frametitle,numbering=fraction]{moloch}",
      "\\setbeamercolor{alerted text}{fg=red!70!black}",
      "\\title[Short]{A Long Title}",
      "\\author{Ada Lovelace}",
    ]));
    const model = buildDeckDocumentInspector(document);

    expect(model.theme).toMatchObject({ name: "moloch", group: "modern", supported: true });
    expect(model.theme.palette.length).toBeGreaterThan(1);
    expect(field(model.themeOptions, "theme-option:progressbar")).toMatchObject({ value: "frametitle", write: null });
    expect(field(model.themeOptions, "theme-option:numbering")).toMatchObject({ value: "fraction" });
    expect(field(model.themeOptions, "theme-option:background")).toMatchObject({ value: "light" });

    expect(field(model.colors, "color:alerted text")).toMatchObject({
      origin: "preamble",
      fg: { expression: "red!70!black" },
    });
    expect(field(model.colors, "color:structure")).toMatchObject({ origin: "theme", fg: { expression: null } });
    expect(field(model.colors, "color:palette primary")).toHaveProperty("bg");

    expect(field(model.page, "aspectratio")).toMatchObject({ value: "169" });
    expect(field(model.page, "class-font-size")).toMatchObject({ value: "10" });
    // Both modern themes clear the navigation symbols.
    expect(field(model.page, "navigation-symbols")).toMatchObject({ value: false });

    // Moloch's footline prints only the frame number.
    expect(model.headerFooter).toEqual([]);
  });

  it("defaults to the default theme and Beamer's class defaults", () => {
    const model = buildDeckDocumentInspector(scanBeamerDocument(deck(["\\documentclass{beamer}"])));
    expect(model.theme).toMatchObject({ name: "Default", supported: true, components: [] });
    expect(model.themeOptions).toEqual([]);
    expect(field(model.page, "aspectratio")).toMatchObject({ value: "43" });
    expect(field(model.page, "class-font-size")).toMatchObject({ value: "11" });
    expect(field(model.page, "navigation-symbols")).toMatchObject({ value: true });
    expect(model.components.every((component) => component.kind === "enum" && component.value === "")).toBe(true);
  });

  it("reads the last theme command of each kind and names its components", () => {
    const model = buildDeckDocumentInspector(scanBeamerDocument(deck([
      "\\documentclass{beamer}",
      "\\usetheme{Warsaw}",
      "\\usetheme[secheader]{Madrid}",
      "\\usecolortheme{beaver}",
      "\\setbeamertemplate{navigation symbols}{}",
    ])));
    expect(model.theme).toMatchObject({ name: "Madrid", group: "no-navigation" });
    expect(model.theme.components).toEqual(expect.arrayContaining([
      { kind: "outer-theme", name: "infolines" },
      { kind: "color-theme", name: "beaver" },
    ]));
    expect(field(model.themeOptions, "theme-option:secheader")).toMatchObject({ value: true });
    expect(field(model.components, "component:color-theme")).toMatchObject({ value: "beaver" });
    expect(field(model.components, "component:outer-theme")).toMatchObject({ value: "" });
    expect(field(model.page, "navigation-symbols")).toMatchObject({ value: false });
  });

  it("offers the short forms the theme's chrome prints, falling back to the long form", () => {
    const model = buildDeckDocumentInspector(scanBeamerDocument(deck([
      "\\documentclass{beamer}",
      "\\usetheme{Madrid}",
      "\\title[Committees]{\\LARGE Proportional Representation}",
      "\\subtitle{Not printed by infolines}",
      "\\author{Dominik Peters}",
    ])));
    expect(model.headerFooter.map((entry) => entry.id)).toEqual([
      "metadata:title:short", "metadata:author:short", "metadata:institute:short", "metadata:date:short",
    ]);
    expect(field(model.headerFooter, "metadata:title:short")).toMatchObject({ value: "Committees" });
    expect(field(model.headerFooter, "metadata:author:short")).toMatchObject({ value: "", placeholder: "Dominik Peters" });
    expect(field(model.headerFooter, "metadata:date:short")).toMatchObject({ value: "", placeholder: "Not set" });
  });

  it("reads the sidebar side from its flag options", () => {
    const model = buildDeckDocumentInspector(scanBeamerDocument(deck([
      "\\documentclass{beamer}",
      "\\usetheme[right,width=2cm]{Berkeley}",
    ])));
    expect(field(model.themeOptions, "theme-option:side")).toMatchObject({ value: "right" });
    expect(field(model.themeOptions, "theme-option:width")).toMatchObject({ value: "2cm" });
    expect(field(model.themeOptions, "theme-option:hideothersubsections")).toMatchObject({ value: false });
  });

  it("marks a theme the renderer does not know", () => {
    const model = buildDeckDocumentInspector(scanBeamerDocument(deck([
      "\\documentclass{beamer}",
      "\\usetheme{Sherbrooke}",
      "\\usecolortheme{albatross}",
    ])));
    expect(model.theme).toMatchObject({ name: "Sherbrooke", supported: false, group: null });
    expect(model.theme.issues.length).toBeGreaterThan(0);
    expect(model.themeOptions).toEqual([]);
    expect(field(model.components, "component:color-theme")).toMatchObject({
      value: "albatross",
      options: expect.arrayContaining([{ value: "albatross", label: "albatross (not previewed)" }]),
    });
  });
});

describe("slide fields and context", () => {
  const source = deck(["\\documentclass{beamer}"], [
    "\\section{Intro}",
    "\\subsection{Why}",
    "\\begin{frame}[shrink=15,allowframebreaks,noframenumbering]{One}",
    "Text \\note{Remember this} \\note<2>{And this}",
    "\\end{frame}",
    "\\begin{frame}[shrink]{Two}",
    "\\end{frame}",
  ]);
  const document = scanBeamerDocument(source);
  const [first, second] = document.frames;

  it("reads shrink, frame breaks and numbering", () => {
    const fields = buildDeckFrameInspector(source, first!.id, document)!.fields;
    expect(field(fields, "shrink")).toMatchObject({ value: 15, write: { kind: "setFrameOption", key: "shrink" } });
    expect(field(fields, "allowframebreaks")).toMatchObject({ value: true });
    expect(field(fields, "noframenumbering")).toMatchObject({ value: true });
    // A bare shrink flag is Beamer's 0%.
    expect(field(buildDeckFrameInspector(source, second!.id, document)!.fields, "shrink")).toMatchObject({ value: 0 });
  });

  it("names the section, subsection and counts notes", () => {
    expect(buildDeckSlideContext(document, first!.id)).toEqual({
      section: "Intro",
      subsection: "Why",
      noteCount: 2,
      issues: [],
    });
    expect(buildDeckSlideContext(document, second!.id)).toMatchObject({ noteCount: 0 });
  });
});
