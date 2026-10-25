import { describe, expect, it } from "vitest";
import { applyDeckDocumentEditAction, buildDeckDocumentInspector, prepareBeamerDocument, resolveBeamerPageGeometry, scanBeamerDocument, type DeckDocumentEditAction, type DeckInspectorField } from "../packages/core/src/beamer/index.js";
import { applySourcePatches } from "../packages/core/src/edit/source-patches.js";
import { resolveBeamerTheme } from "../packages/core/src/beamer/theme/resolve.js";

const BODY = String.raw`\begin{document}
\begin{frame}{Content}Hello\end{frame}
\end{document}`;
const deck = (...preamble: string[]): string => [String.raw`\documentclass{beamer}`, ...preamble, BODY].join("\n");
function edited(source: string, action: DeckDocumentEditAction): string {
  const result = applyDeckDocumentEditAction(source, action);
  if (result.kind !== "success") throw new Error(JSON.stringify(result));
  expect(applySourcePatches(source, result.patches)).toMatchObject({ kind: "success", source: result.newSource });
  expect(applyDeckDocumentEditAction(result.newSource, action)).toMatchObject({ kind: "success", newSource: result.newSource });
  return result.newSource;
}
function field(fields: readonly DeckInspectorField[], id: string): DeckInspectorField {
  const result = fields.find(field => field.id === id);
  if (!result) throw new Error(`Missing field ${id}`);
  return result;
}
const navigation = (source: string): string => resolveBeamerTheme(scanBeamerDocument(source)).templates.navigationSymbols.id;

describe("class option edits", () => {
  it("adds missing brackets, changes page geometry and resets defaults", async () => {
    const source = deck();
    const wide = edited(source, { kind: "deckSetClassOption", key: "aspectratio", value: "169" });
    expect(wide).toContain(String.raw`\documentclass[aspectratio=169]{beamer}`);
    const geometry = resolveBeamerPageGeometry(scanBeamerDocument(wide));
    expect(geometry.page.width / geometry.page.height).toBeCloseTo(16 / 9);
    expect((await prepareBeamerDocument(wide).renderFrame()).layout.page.page).toEqual(geometry.page);
    expect(edited(wide, { kind: "deckSetClassOption", key: "aspectratio", value: null })).toBe(source);
  });

  it("uses the last duplicate aspect ratio and preserves comments and unrelated options", () => {
    const source = deck().replace("{beamer}", "[aspectratio=43,handout,% page note\naspectratio={169},12pt]{beamer}");
    expect(resolveBeamerPageGeometry(scanBeamerDocument(source)).aspectRatio).toBe("169");
    const next = edited(source, { kind: "deckSetClassOption", key: "aspectratio", value: "1610" });
    expect(next).toContain("handout,% page note\naspectratio=1610,12pt");
    expect(field(buildDeckDocumentInspector(scanBeamerDocument(next)).page, "aspectratio")).toMatchObject({ value: "1610" });
  });

  it("replaces exclusive numeric font flags and shares the renderer's comment-aware read", () => {
    const source = deck().replace("{beamer}", "[8pt,% font note\nhandout,12pt,aspectratio=169]{beamer}");
    const before = buildDeckDocumentInspector(scanBeamerDocument(source));
    expect(field(before.page, "class-font-size")).toMatchObject({ value: "12" });
    const next = edited(source, { kind: "deckSetClassOption", key: "font-size", value: "14" });
    expect(next).not.toContain("8pt");
    expect(next).not.toContain("12pt");
    expect(next).toContain("14pt");
    expect(next).toContain("% font note\nhandout");
    expect(resolveBeamerTheme(scanBeamerDocument(next)).fonts["normal-text"].sizePt).toBe(14.4);
    const reset = edited(next, { kind: "deckSetClassOption", key: "font-size", value: null });
    expect(field(buildDeckDocumentInspector(scanBeamerDocument(reset)).page, "class-font-size")).toMatchObject({ value: "" });
    expect(reset).toContain("aspectratio=169");
  });

  it.each(["\n", "\r\n"])("preserves %j newlines and stored class commands", newline => {
    const source = deck(String.raw`\newcommand{\example}{\documentclass[8pt]{article}}`).replaceAll("\n", newline);
    const next = edited(source, { kind: "deckSetClassOption", key: "font-size", value: "10" });
    expect(next).toContain(String.raw`\documentclass[10pt]{beamer}`);
    expect(next).toContain(String.raw`\newcommand{\example}{\documentclass[8pt]{article}}`);
    expect(next.split(newline)).toHaveLength(source.split(newline).length);
  });

  it("finds the real class after a stored example", () => {
    const source = String.raw`\newcommand{\example}{\documentclass[8pt]{article}}` + "\n" + deck();
    const next = edited(source, { kind: "deckSetClassOption", key: "font-size", value: "12" });
    expect(scanBeamerDocument(next).preamble.documentClass?.className.value).toBe("beamer");
    expect(next).toContain(String.raw`\documentclass[12pt]{beamer}`);
  });

  it.each([
    String.raw`{\documentclass{beamer}}`,
    String.raw`\documentclass{beamer}\documentclass{beamer}`,
    String.raw`\documentclass{\myclass}`,
  ])("refuses an unsafe class declaration: %s", preamble => {
    const source = preamble + "\n" + BODY;
    expect(applyDeckDocumentEditAction(source, { kind: "deckSetClassOption", key: "aspectratio", value: "169" })).toMatchObject({ kind: "unsupported" });
    expect(field(buildDeckDocumentInspector(scanBeamerDocument(source)).page, "aspectratio")).toMatchObject({ write: null, readOnly: { reason: expect.any(String) } });
  });

  it("rejects unsupported values without changing source", () => {
    expect(applyDeckDocumentEditAction(deck(), { kind: "deckSetClassOption", key: "font-size", value: "13" }).kind).toBe("unsupported");
    expect(applyDeckDocumentEditAction(deck(), { kind: "deckSetClassOption", key: "aspectratio", value: "169,handout" }).kind).toBe("unsupported");
  });

  it("keeps separately passed class options read-only rather than claiming an incorrect default", () => {
    const source = String.raw`\PassOptionsToClass{12pt}{beamer}` + "\n" + deck();
    expect(applyDeckDocumentEditAction(source, { kind: "deckSetClassOption", key: "font-size", value: null }).kind).toBe("unsupported");
    expect(field(buildDeckDocumentInspector(scanBeamerDocument(source)).page, "class-font-size")).toMatchObject({ write: null, readOnly: { reason: expect.stringContaining("passed separately") } });
  });
});

describe("navigation symbol overrides", () => {
  it("shows symbols under moloch and resets to the theme", async () => {
    const source = deck(String.raw`\usetheme{moloch}`);
    const shown = edited(source, { kind: "deckSetNavigationSymbols", visible: true });
    expect(shown).toContain(String.raw`\setbeamertemplate{navigation symbols}[default]`);
    expect(navigation(shown)).toBe("beamer/navigation-symbols/default");
    expect((await prepareBeamerDocument(shown).renderFrame()).layout.items.some(item => item.kind === "navigation-symbols")).toBe(true);
    const reset = edited(shown, { kind: "deckSetNavigationSymbols", visible: null });
    expect(reset).toBe(source);
    expect(navigation(reset)).toBe("beamer/navigation-symbols/none");
  });

  it("moves an earlier override after a theme and removes all explicit overrides on reset", () => {
    const source = deck(String.raw`\setbeamertemplate{navigation symbols}[default]`, String.raw`\usetheme{moloch}`, String.raw`\setbeamertemplate{navigation symbols}{% retain note
}`);
    const next = edited(source, { kind: "deckSetNavigationSymbols", visible: true });
    expect(navigation(next)).toBe("beamer/navigation-symbols/default");
    expect(next).toContain("% retain note\n");
    const reset = edited(next, { kind: "deckSetNavigationSymbols", visible: null });
    expect(reset).not.toContain("\\setbeamertemplate");
    expect(reset).toContain("% retain note\n");
    const beforeTheme = edited(deck(String.raw`\setbeamertemplate{navigation symbols}[default]`, String.raw`\usetheme{moloch}`), { kind: "deckSetNavigationSymbols", visible: true });
    expect(beforeTheme.indexOf("\\setbeamertemplate")).toBeGreaterThan(beforeTheme.indexOf("\\usetheme"));
  });

  it("hides symbols without changing stored definitions or other template roles", () => {
    const source = deck(String.raw`\newcommand{\later}{\setbeamertemplate{navigation symbols}[vertical]}`, String.raw`\setbeamertemplate{footline}{Hello}`);
    const next = edited(source, { kind: "deckSetNavigationSymbols", visible: false });
    expect(navigation(next)).toBe("beamer/navigation-symbols/none");
    expect(next).toContain(String.raw`\newcommand{\later}{\setbeamertemplate{navigation symbols}[vertical]}`);
    expect(next).toContain(String.raw`\setbeamertemplate{footline}{Hello}`);
  });

  it.each([
    String.raw`\setbeamertemplate{navigation symbols}{custom code}`,
    String.raw`\setbeamertemplate{navigation symbols}[vertical]`,
    String.raw`\AtBeginDocument{\setbeamertemplate{navigation symbols}{}}`,
    String.raw`\addtobeamertemplate{navigation symbols}{}{Hello}`,
    String.raw`\addtobeamertemplate{navigation symbols% comment
}{}{Hello}`,
    String.raw`\beamertemplatenavigationsymbolsempty`,
  ])("preserves opaque navigation code: %s", preamble => {
    const source = deck(preamble);
    for (const visible of [true, false, null]) expect(applyDeckDocumentEditAction(source, { kind: "deckSetNavigationSymbols", visible }).kind).toBe("unsupported");
    expect(field(buildDeckDocumentInspector(scanBeamerDocument(source)).page, "navigation-symbols")).toMatchObject({ write: null, readOnly: { reason: expect.any(String) } });
  });
});

describe("header and footer short forms", () => {
  it("reads the last executing metadata declaration and preserves both long forms", () => {
    const source = deck(String.raw`\usetheme{Madrid}`, String.raw`\title[First]{Earlier}`, String.raw`\title{\LARGE Latest $x+y$}`, String.raw`\newcommand{\example}{\title[Stored]{Not executed}}`);
    const before = scanBeamerDocument(source);
    expect(before.preamble.metadata.title?.value.value).toBe(String.raw`\LARGE Latest $x+y$`);
    expect(before.preamble.metadata.title?.shortValue).toBeUndefined();
    const next = edited(source, { kind: "deckSetMetadataShort", field: "title", value: String.raw`\alert{Short $x$}` });
    expect(next).toContain(String.raw`\title[First]{Earlier}`);
    expect(next).toContain(String.raw`\title[\alert{Short $x$}]{\LARGE Latest $x+y$}`);
    expect(next).toContain(String.raw`\newcommand{\example}{\title[Stored]{Not executed}}`);
  });

  it("distinguishes explicit empty short forms from inherited full text", () => {
    const source = deck(String.raw`\usetheme{Madrid}`, String.raw`\title{Full title}`);
    const hidden = edited(source, { kind: "deckSetMetadataShort", field: "title", value: "" });
    expect(hidden).toContain(String.raw`\title[]{Full title}`);
    expect(field(buildDeckDocumentInspector(scanBeamerDocument(hidden)).headerFooter, "metadata:title:short")).toMatchObject({ value: "", placeholder: "Hidden" });
    const reset = edited(hidden, { kind: "deckSetMetadataShort", field: "title", value: null });
    expect(reset).toBe(source);
    expect(field(buildDeckDocumentInspector(scanBeamerDocument(reset)).headerFooter, "metadata:title:short")).toMatchObject({ value: "", placeholder: "Full title" });
  });

  it.each(["title", "author", "institute", "date"] as const)("creates a missing %s command without overwriting its long-form default", name => {
    const source = deck(String.raw`\usetheme{Madrid}`);
    const next = edited(source, { kind: "deckSetMetadataShort", field: name, value: "Short" });
    const metadata = scanBeamerDocument(next).preamble.metadata[name];
    expect(metadata?.shortValue?.value).toBe("Short");
    expect(metadata?.value.value).toBe(name === "date" ? "\\today" : "");
  });

  it("keeps comments and long metadata verbatim when changing or resetting a short form", () => {
    const source = deck(String.raw`\title[% keep note
Old]{\LARGE Long % long note
title}`);
    const next = edited(source, { kind: "deckSetMetadataShort", field: "title", value: "New" });
    expect(next).toContain("% keep note\n");
    expect(scanBeamerDocument(next).preamble.metadata.title?.shortValue?.value).toBe("New");
    expect(scanBeamerDocument(next).preamble.metadata.title?.value.value).toBe(scanBeamerDocument(source).preamble.metadata.title?.value.value);
    const reset = edited(source, { kind: "deckSetMetadataShort", field: "title", value: null });
    expect(reset).toContain("% keep note\n");
    expect(scanBeamerDocument(reset).preamble.metadata.title?.shortValue).toBeUndefined();
  });

  it.each([
    String.raw`\AtBeginDocument{\title{Deferred}}`,
    String.raw`{\title{Grouped}}`,
    String.raw`\iftrue\title{Conditional}\fi`,
    String.raw`\renewcommand{\title}[1]{Custom}`,
    String.raw`\title`,
  ])("refuses unsafe metadata: %s", authored => {
    const source = deck(String.raw`\usetheme{Madrid}`, String.raw`\title{Original}`, authored);
    expect(applyDeckDocumentEditAction(source, { kind: "deckSetMetadataShort", field: "title", value: "Short" }).kind).toBe("unsupported");
    expect(field(buildDeckDocumentInspector(scanBeamerDocument(source)).headerFooter, "metadata:title:short")).toMatchObject({ write: null, readOnly: { reason: expect.any(String) } });
    expect(scanBeamerDocument(source).preamble.metadata.title?.value.value).toBe("Original");
  });

  it.each(["unclosed {", "stray }", "break\nline", "comment%", "text ] tail", "text [ tail", "$x", "x\\)", "\\(x", "\\[x"])("rejects unsafe short text: %j", value => {
    expect(applyDeckDocumentEditAction(deck(String.raw`\title{Long}`), { kind: "deckSetMetadataShort", field: "title", value }).kind).toBe("unsupported");
  });

  it("accepts protected square brackets, escaped percent signs and inline math", () => {
    const value = String.raw`\alert{A [B]} $x+y$ 50\%`;
    expect(scanBeamerDocument(edited(deck(String.raw`\title{Long}`), { kind: "deckSetMetadataShort", field: "title", value })).preamble.metadata.title?.shortValue?.value).toBe(value);
  });
});

it("replays page, navigation and metadata actions with effective readback and rendering", async () => {
  let source = deck(String.raw`\usetheme{Madrid}`, String.raw`\title{Long title}`);
  for (let step = 0; step < 36; step += 1) {
    const action: DeckDocumentEditAction = step % 4 === 0 ? { kind: "deckSetClassOption", key: "aspectratio", value: step % 3 === 0 ? null : "169" }
      : step % 4 === 1 ? { kind: "deckSetClassOption", key: "font-size", value: step % 3 === 0 ? null : "12" }
      : step % 4 === 2 ? { kind: "deckSetNavigationSymbols", visible: step % 3 === 0 ? null : step % 3 === 1 }
      : { kind: "deckSetMetadataShort", field: "title", value: step % 3 === 0 ? null : step % 3 === 1 ? "" : "Short" };
    source = edited(source, action);
    const document = scanBeamerDocument(source);
    expect(document.preamble.metadata.title?.value.value).toBe("Long title");
    if (action.kind === "deckSetMetadataShort") expect(document.preamble.metadata.title?.shortValue?.value ?? null).toBe(action.value);
    const page = await prepareBeamerDocument(source).renderFrame();
    expect(page.svg.svg).toContain("<svg");
  }
});
