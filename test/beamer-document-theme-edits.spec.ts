import { describe, expect, it } from "vitest";
import { applyDeckDocumentEditAction, buildDeckDocumentInspector, prepareBeamerDocument, scanBeamerDocument, type DeckDocumentEditAction } from "../packages/core/src/beamer/index.js";
import { applySourcePatches } from "../packages/core/src/edit/source-patches.js";
import { parseThemeOptions, resolveBeamerTheme, resolveBeamerThemeColor } from "../packages/core/src/beamer/theme/resolve.js";

const BODY = String.raw`\begin{document}
\begin{frame}{Frame}Text\end{frame}
\end{document}`;
const deck = (...preamble: string[]) => [String.raw`\documentclass{beamer}`, ...preamble, BODY].join("\n");
function edit(source: string, action: DeckDocumentEditAction): string {
  const result = applyDeckDocumentEditAction(source, action);
  if (result.kind !== "success") throw new Error(JSON.stringify(result));
  expect(applySourcePatches(source, result.patches)).toMatchObject({ kind: "success", source: result.newSource });
  expect(applyDeckDocumentEditAction(result.newSource, action)).toMatchObject({ kind: "success", newSource: result.newSource });
  return result.newSource;
}
const switchTo: DeckDocumentEditAction = { kind: "deckSetPresentationTheme", name: "metropolis" };

describe("safe presentation edits", () => {
  it.each([
    String.raw`{\usetheme{Berlin}}`,
    String.raw`\AtBeginDocument{\usetheme{Berlin}}`,
    String.raw`\iftrue\usetheme{Berlin}\fi`,
    String.raw`\begingroup\usetheme{Berlin}\endgroup`,
    String.raw`\usetheme{\mytheme}`,
    String.raw`\usetheme[width=2cm]{Berkeley,PaloAlto}`,
    String.raw`\begin{scope}\usetheme{Berlin}\end{scope}`,
  ])("refuses an unsafe theme target: %s", authored => {
    const source = deck(String.raw`\usetheme{Madrid}`, authored);
    expect(applyDeckDocumentEditAction(source, switchTo)).toMatchObject({ kind: "unsupported" });
    const model = buildDeckDocumentInspector(scanBeamerDocument(source));
    expect(model.theme.readOnly?.reason).toBeTruthy();
    expect(model.components.every(field => field.write === null && field.readOnly != null)).toBe(true);
  });

  it("ignores stored macro bodies and newif declarations", () => {
    const source = deck(String.raw`\newif\ifdraft`, String.raw`\ifthenelse{true}{\relax}{\relax}`, String.raw`\newcommand{\later}{\usetheme{Berlin}}`, String.raw`\usetheme{moloch}`);
    const next = edit(source, switchTo);
    expect(next).toContain(String.raw`\newcommand{\later}{\usetheme{Berlin}}`);
    expect(next).toContain(String.raw`\usetheme{metropolis}`);
  });

  it("does not erase unexposed options when setting the current theme", () => {
    const source = deck(String.raw`\usetheme[colortheme=owl,block=fill]{moloch}`);
    expect(edit(source, { kind: "deckSetPresentationTheme", name: "moloch" })).toBe(source);
  });

  it("keeps comments, compatible native options, and braced values", () => {
    const source = deck(String.raw`\usetheme[progressbar=frametitle, % numbering matters
numbering={fraction},block=fill,unknown,sectionpage=none]{moloch}`);
    const next = edit(source, switchTo);
    expect(next).toContain("% numbering matters\nnumbering={fraction},block=fill,");
    expect(next).not.toContain("unknown");
    expect(parseThemeOptions(scanBeamerDocument(next).preamble.themes[0]?.options?.value)).toMatchObject({ numbering: "fraction", block: "fill", sectionpage: "none" });
  });

  it("retains comments even when no options survive", () => {
    const source = deck(String.raw`\usetheme[progressbar=foot, % explanation
numbering=fraction]{moloch}`);
    const next = edit(source, { kind: "deckSetPresentationTheme", name: "Madrid" });
    expect(next).toContain("% explanation\n");
    expect(scanBeamerDocument(next).preamble.themes[0]?.name.value).toBe("Madrid");
    expect(parseThemeOptions(scanBeamerDocument(next).preamble.themes[0]?.options?.value)).toEqual({});
  });

  it.each(["\n", "\r\n"])("inserts before a same-line document boundary with %j line endings", newline => {
    const source = String.raw`\documentclass{beamer}\begin{document}` + newline + String.raw`\begin{frame}x\end{frame}\end{document}`;
    const next = edit(source, { kind: "deckSetPresentationTheme", name: "Madrid" });
    expect(scanBeamerDocument(next).preamble.themes[0]?.name.value).toBe("Madrid");
    expect(next).toContain(`${newline}\\usetheme{Madrid}${newline}\\begin{document}`);
  });

  it("preserves trailing comments and preceding comma-separated theme names", () => {
    const source = deck(String.raw`\usetheme{Berlin, moloch}% keep this`);
    expect(edit(source, switchTo)).toContain(String.raw`\usetheme{Berlin,metropolis}% keep this`);
    const absent = deck("% no theme yet").replace("{beamer}\n", "{beamer}% class comment\n");
    expect(edit(absent, switchTo)).toContain("{beamer}% class comment\n\\usetheme{metropolis}\n");
  });
});

describe("theme option edits", () => {
  it("changes the effective duplicate option and keeps unrelated source", () => {
    const source = deck(String.raw`\usetheme[numbering=counter, % note
progressbar=foot,numbering=fraction,block=fill]{moloch}`);
    const next = edit(source, { kind: "deckSetThemeOption", key: "numbering", value: "none" });
    const document = scanBeamerDocument(next);
    expect(next).toContain("% note\nprogressbar=foot,numbering=none,block=fill");
    expect(parseThemeOptions(document.preamble.themes[0]?.options?.value)).toMatchObject({ numbering: "none", progressbar: "foot", block: "fill" });
    const reset = edit(next, { kind: "deckSetThemeOption", key: "numbering", value: null });
    const field = buildDeckDocumentInspector(scanBeamerDocument(reset)).themeOptions.find(field => field.id === "theme-option:numbering");
    expect(field).toMatchObject({ value: "counter" });
  });

  it("creates brackets, clears exclusive sides, and writes dimensions", () => {
    let source = edit(deck(String.raw`\usetheme{Berkeley}`), { kind: "deckSetThemeOption", key: "right", value: true });
    expect(source).toContain(String.raw`\usetheme[right]{Berkeley}`);
    source = edit(source, { kind: "deckSetThemeOption", key: "left", value: true });
    expect(source).toContain(String.raw`\usetheme[left]{Berkeley}`);
    source = edit(source, { kind: "deckSetThemeOption", key: "width", value: "2cm" });
    expect(resolveBeamerTheme(scanBeamerDocument(source)).dimensions.sidebarWidthLeft).toMatchObject({ kind: "absolute", valuePt: 72.27 / 2.54 * 2 });
    source = edit(source, { kind: "deckSetThemeOption", key: "left", value: null });
    expect(parseThemeOptions(scanBeamerDocument(source).preamble.themes[0]?.options?.value)).toEqual({ width: "2cm" });
  });

  it.each([
    { key: "unknown", value: "x" }, { key: "numbering", value: "invalid" }, { key: "progressbar", value: "foot,numbering=none" },
  ])("rejects unsupported values: %j", ({ key, value }) => {
    expect(applyDeckDocumentEditAction(deck(String.raw`\usetheme{moloch}`), { kind: "deckSetThemeOption", key, value })).toMatchObject({ kind: "unsupported" });
  });

  it("disables shared and repeated-package options rather than guessing their target", () => {
    for (const preamble of [String.raw`\usetheme{Berlin,moloch}`, String.raw`\usetheme{moloch}\usetheme{moloch}`]) {
      const document = scanBeamerDocument(deck(preamble));
      expect(buildDeckDocumentInspector(document).themeOptions.every(field => field.write === null && field.readOnly != null)).toBe(true);
      expect(applyDeckDocumentEditAction(document.source, { kind: "deckSetThemeOption", key: "numbering", value: "none" }).kind).toBe("unsupported");
    }
  });
});

describe("component theme composition", () => {
  it("moves an override after later theme commands, preserving unrelated declarations", () => {
    const source = deck(String.raw`\usecolortheme{beaver}% palette note`, String.raw`\usetheme{Madrid}`, String.raw`\setbeamercolor{structure}{fg=green}`);
    const next = edit(source, { kind: "deckSetTheme", themeKind: "color-theme", name: "spruce" });
    expect(next.indexOf(String.raw`\usecolortheme{spruce}`)).toBeGreaterThan(next.indexOf(String.raw`\usetheme{Madrid}`));
    expect(next).toContain("% palette note");
    expect(next).toContain(String.raw`\setbeamercolor{structure}{fg=green}`);
    expect(resolveBeamerThemeColor(resolveBeamerTheme(scanBeamerDocument(next)), "structure").fg).toBe("#00ff00");
  });

  it("changes a component in place unless a later presentation theme overrides it", () => {
    const source = deck(String.raw`\usecolortheme{beaver}`, String.raw`\setbeamercolor{structure}{fg=green}`, String.raw`\usefonttheme{serif}`);
    const next = edit(source, { kind: "deckSetTheme", themeKind: "color-theme", name: "spruce" });
    expect(next).toBe(source.replace(String.raw`{beaver}`, String.raw`{spruce}`));
    expect(resolveBeamerThemeColor(resolveBeamerTheme(scanBeamerDocument(next)), "structure").fg).toBe("#00ff00");
  });

  it("resets all explicit commands of one kind while keeping other scopes intact", () => {
    const source = deck(String.raw`\usecolortheme{rose,beaver}`, String.raw`\usetheme{Madrid}`, String.raw`\usefonttheme{serif}`, String.raw`\usecolortheme{spruce}`, String.raw`\newcommand{\later}{\usecolortheme{dove}}`);
    const next = edit(source, { kind: "deckSetTheme", themeKind: "color-theme", name: null });
    const uses = scanBeamerDocument(next).preamble.themes;
    expect(uses.filter(use => use.kind === "color-theme")).toHaveLength(1); // stored macro only
    expect(next).toContain(String.raw`\usefonttheme{serif}`);
    expect(next).toContain(String.raw`\newcommand{\later}{\usecolortheme{dove}}`);
    expect(buildDeckDocumentInspector(scanBeamerDocument(next)).components.find(field => field.id === "component:color-theme")).toMatchObject({ value: "" });
  });

  it("preserves preceding component names and inserts missing components in empty decks", () => {
    const source = deck(String.raw`\usecolortheme{rose,beaver}`);
    expect(edit(source, { kind: "deckSetTheme", themeKind: "color-theme", name: "spruce" })).toContain(String.raw`\usecolortheme{rose,spruce}`);
    const empty = String.raw`\documentclass{beamer}\begin{document}\end{document}`;
    const next = edit(empty, { kind: "deckSetTheme", themeKind: "font-theme", name: "serif" });
    expect(scanBeamerDocument(next).preamble.themes[0]?.kind).toBe("font-theme");
  });

  it("resets an inserted component without leaving a blank line and preserves comments inside options", () => {
    const source = deck(String.raw`\usetheme{Madrid}`);
    const next = edit(source, { kind: "deckSetTheme", themeKind: "font-theme", name: "serif" });
    expect(edit(next, { kind: "deckSetTheme", themeKind: "font-theme", name: null })).toBe(source);
    const commented = deck(String.raw`\useoutertheme[% keep this explanation
width=2cm]{sidebar}`);
    const reset = edit(commented, { kind: "deckSetTheme", themeKind: "outer-theme", name: null });
    expect(reset).toContain("% keep this explanation\n");
    expect(scanBeamerDocument(reset).preamble.themes).toHaveLength(0);
    const replaced = edit(commented, { kind: "deckSetTheme", themeKind: "outer-theme", name: "infolines" });
    expect(replaced).toContain("% keep this explanation\n");
    expect(replaced).not.toContain("width=2cm");
  });
});

it("replays a deterministic sequence of document actions and renders after each operation", async () => {
  let source = deck(String.raw`\newcommand{\keep}{stored}`, String.raw`\usetheme[block=fill]{moloch}% theme note`);
  let seed = 20261025;
  for (let step = 0; step < 60; step += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const choice = seed % 5;
    const action: DeckDocumentEditAction = choice === 0
      ? { kind: "deckSetPresentationTheme", name: step % 2 === 0 ? "metropolis" : "moloch" }
      : choice === 1 ? { kind: "deckSetThemeOption", key: "numbering", value: step % 3 === 0 ? null : "fraction" }
      : choice === 2 ? { kind: "deckSetThemeOption", key: "progressbar", value: step % 2 === 0 ? "head" : "foot" }
      : choice === 3 ? { kind: "deckSetTheme", themeKind: "color-theme", name: step % 3 === 0 ? null : "beaver" }
      : { kind: "deckSetTheme", themeKind: "font-theme", name: step % 3 === 0 ? null : "serif" };
    source = edit(source, action);
    expect(source).toContain(String.raw`\newcommand{\keep}{stored}`);
    expect(source).toContain("% theme note");
    const page = await prepareBeamerDocument(source).renderFrame({ frameIndex: 0, step: 1 });
    expect(page.svg.svg).toContain("<svg");
  }
});
