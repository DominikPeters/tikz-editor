import { describe, expect, it } from "vitest";
import { applyDeckDocumentEditAction, buildDeckDocumentInspector, prepareBeamerDocument, scanBeamerDocument, type DeckDocumentEditAction } from "../packages/core/src/beamer/index.js";
import { applySourcePatches } from "../packages/core/src/edit/source-patches.js";
import { resolveBeamerTheme, resolveBeamerThemeColor, resolveBeamerThemeColorOrigin } from "../packages/core/src/beamer/theme/resolve.js";

const deck = (...preamble: string[]): string => [String.raw`\documentclass{beamer}`, ...preamble,
  String.raw`\begin{document}\begin{frame}{Content}Hello\end{frame}\end{document}`].join("\n");
const action = (value: string | null, role = "structure", side: "fg" | "bg" = "fg"): DeckDocumentEditAction => ({ kind: "deckSetColor", role, side, value });
function edited(source: string, action: DeckDocumentEditAction): string {
  const result = applyDeckDocumentEditAction(source, action);
  if (result.kind !== "success") throw new Error(JSON.stringify(result));
  expect(applySourcePatches(source, result.patches)).toMatchObject({ kind: "success", source: result.newSource });
  expect(applyDeckDocumentEditAction(result.newSource, action)).toMatchObject({ kind: "success", newSource: result.newSource });
  return result.newSource;
}
const theme = (source: string) => resolveBeamerTheme(scanBeamerDocument(source));
const color = (source: string, role = "structure") => resolveBeamerThemeColor(theme(source), role);

describe("document color edits", () => {
  it("keeps theme-provided deferred mixes distinct from authored expressions", () => {
    const source = deck(String.raw`\usetheme{Madrid}`, String.raw`\setbeamercolor{structure}{fg=red}`);
    const model = buildDeckDocumentInspector(scanBeamerDocument(source));
    expect(model.colors.find(field => field.id === "color:palette secondary")).toMatchObject({
      origin: "theme", bg: { css: "#bf0000", expression: null, origin: "theme" }, resetSides: [],
    });
  });
  it.each(["\n", "\r\n"])("inserts after themes and resets without a leftover command (%j)", newline => {
    const source = deck(String.raw`\usetheme{Madrid}% theme note`).replaceAll("\n", newline);
    const next = edited(source, action("red!50!black"));
    expect(next).toContain(`${newline}\\setbeamercolor{structure}{fg=red!50!black}${newline}\\begin{document}`);
    expect(next).toContain("% theme note");
    expect(color(next).fg).toBe("#800000");
    expect(edited(next, action(null))).toBe(source);
  });

  it("works without frames or a preamble newline", () => {
    const source = String.raw`\documentclass{beamer}\begin{document}\end{document}`;
    const next = edited(source, action("green"));
    expect(next).toContain("\n\\setbeamercolor{structure}{fg=green}\n\\begin{document}");
    expect(color(next).fg).toBe("#00ff00");
  });

  it("removes duplicate side keys while preserving the other side, parent, use and comments", () => {
    const source = deck(String.raw`\setbeamercolor{palette primary}{parent=normal text,fg=red,% keep this
bg={blue!20},use=structure,fg={green}}`, String.raw`\setbeamercolor{alerted text}{fg=orange}`);
    const next = edited(source, action("white", "palette primary"));
    expect(next).toContain("parent=normal text,% keep this\nbg={blue!20},use=structure,fg=white");
    expect(next).toContain(String.raw`\setbeamercolor{alerted text}{fg=orange}`);
    expect(color(next, "palette primary")).toEqual({ fg: "#ffffff", bg: "#ccccff" });
    const reset = edited(next, action(null, "palette primary"));
    expect(reset).toContain("parent=normal text,% keep this\nbg={blue!20},use=structure");
    expect(color(reset, "palette primary")).toEqual({ fg: "#3333b3", bg: "#ccccff" });
  });

  it("keeps a comment inside a replaced or removed expression", () => {
    const source = deck(String.raw`\setbeamercolor{structure}{fg=red% expression note
!20!white}`);
    const next = edited(source, action("blue"));
    expect(next).toContain("% expression note\n");
    expect(color(next).fg).toBe("#0000ff");
    const reset = edited(next, action(null));
    expect(reset).toContain("% expression note\n");
    expect(color(reset).fg).toBe("#3333b3");
  });

  it("resets all repeated overrides rather than exposing an earlier authored value", () => {
    const source = deck(String.raw`\setbeamercolor{structure}{fg=green}`, String.raw`\usetheme{Madrid}`,
      String.raw`\setbeamercolor{structure}{fg=red}`, String.raw`\setbeamercolor{structure}{fg=blue}`);
    const reset = edited(source, action(null));
    expect(reset).not.toContain("setbeamercolor");
    expect(color(reset).fg).toBe(color(deck(String.raw`\usetheme{Madrid}`)).fg);
    expect(resolveBeamerThemeColorOrigin(theme(reset), "structure", "fg")).toBeNull();
  });

  it("reads role/name comments as TeX tokens and retains comments outside the option body", () => {
    const source = deck(String.raw`\definecolor{Brand% name note
Ink}{HTML}{123456}`, String.raw`\setbeamercolor{struc% role note
ture}{fg=red}`);
    const next = edited(source, action("BrandInk"));
    expect(color(next).fg).toBe("#123456");
    const reset = edited(next, action(null));
    expect(reset).toContain("% role note\nture}{}");
    expect(reset).toContain("% name note\nInk}");
    expect(color(reset).fg).toBe("#3333b3");
  });

  it("preserves a star's clearing semantics and keeps inherited preamble provenance", () => {
    const source = deck(String.raw`\setbeamercolor{normal text}{fg=green}`,
      String.raw`\setbeamercolor{palette primary}{fg=red}`,
      String.raw`\setbeamercolor*{palette primary}{parent=normal text,bg=blue,fg=white}`);
    const reset = edited(source, action(null, "palette primary"));
    expect(reset).toContain(String.raw`\setbeamercolor*{palette primary}{parent=normal text,bg=blue}`);
    expect(reset).not.toContain("fg=red");
    expect(color(reset, "palette primary")).toEqual({ fg: "#00ff00", bg: "#0000ff" });
    expect(resolveBeamerThemeColorOrigin(theme(reset), "palette primary", "fg")).toMatchObject({ expression: "green", role: "normal text" });
    const empty = edited(deck(String.raw`\setbeamercolor*{structure}{fg=red}`), action(null));
    expect(empty).toContain(String.raw`\setbeamercolor*{structure}{}`);
    expect(color(empty)).toEqual({});
  });

  it("distinguishes an explicitly empty side from a side reset", () => {
    const source = deck(String.raw`\setbeamercolor{structure}{parent=normal text}`);
    const hidden = edited(source, action(""));
    expect(color(hidden)).toEqual({ bg: "#ffffff" });
    expect(resolveBeamerThemeColorOrigin(theme(hidden), "structure", "fg")).toMatchObject({ expression: "" });
    expect(color(edited(hidden, action(null))).fg).toBe("#3333b3");
  });

  it("puts an effective override after a later theme and leaves the earlier declaration intact", () => {
    const original = String.raw`\setbeamercolor{structure}{fg=green,bg=white}`;
    const source = deck(original, String.raw`\usetheme{Madrid}`);
    const next = edited(source, action("red"));
    expect(next).toContain(original);
    expect(next.indexOf("fg=red")).toBeGreaterThan(next.indexOf("{Madrid}"));
    expect(color(next).fg).toBe("#ff0000");
    const switched = edited(next, { kind: "deckSetPresentationTheme", name: "Berlin" });
    expect(color(switched).fg).toBe("#ff0000");
    expect(resolveBeamerThemeColorOrigin(theme(switched), "structure", "fg")).toMatchObject({ role: "structure", expression: "red" });
  });

  it("retains native named-color spelling, definitions and aliases", () => {
    const definitions = String.raw`\definecolor{BrandInk}{HTML}{123456}
\colorlet{SoftInk}{BrandInk!20!white}`;
    const source = deck(String.raw`\setbeamercolor{structure}{fg=red}`, definitions);
    const next = edited(source, action("BrandInk!50!white"));
    expect(next).toContain(definitions);
    expect(next.indexOf("fg=BrandInk!50!white")).toBeGreaterThan(next.indexOf("\\colorlet"));
    expect(color(next).fg).toBe("#8999aa");
    const field = buildDeckDocumentInspector(scanBeamerDocument(next)).colors[0];
    expect(field).toMatchObject({ namedColorSwatches: [{ token: "BrandInk", cssColor: "#123456" }, { token: "SoftInk", cssColor: "#d0d6dd" }] });
    expect(applyDeckDocumentEditAction(source, action("brandink")).kind).toBe("unsupported");
  });

  it("keeps deferred dependent mixes and their use declarations", async () => {
    const source = deck(String.raw`\usetheme{Madrid}`, String.raw`\setbeamercolor{palette primary}{use=structure,fg=white,bg=structure.fg!50!black}`);
    const next = edited(source, action("red"));
    expect(next).toContain(String.raw`use=structure,fg=white,bg=structure.fg!50!black`);
    expect(color(next, "palette primary").bg).toBe("#800000");
    const dependent = edited(next, action("structure.fg!20!white", "palette primary", "bg"));
    expect(color(dependent, "palette primary").bg).toBe("#ffcccc");
    const rendered = await prepareBeamerDocument(next).renderFrame();
    expect(rendered.svg.svg).toContain("#800000");
    expect(rendered.svg.svg).toContain("#ff9999");
  });

  it.each([
    String.raw`{\setbeamercolor{structure}{fg=red}}`,
    String.raw`\AtBeginDocument{\setbeamercolor{structure}{fg=red}}`,
    String.raw`\iftrue\setbeamercolor{structure}{fg=red}\fi`,
    String.raw`\begingroup\setbeamercolor{structure}{fg=red}\endgroup`,
    String.raw`\setbeamercolor{\myrole}{fg=red}`,
    String.raw`\setbeamercolor{structure}{custom=red}`,
    String.raw`\setbeamercolor{structure}`,
    String.raw`\renewcommand{\setbeamercolor}[2]{}`,
  ])("refuses unsafe source for both setting and reset: %s", preamble => {
    const source = deck(preamble);
    for (const value of ["blue", null]) expect(applyDeckDocumentEditAction(source, action(value)).kind).toBe("unsupported");
    expect(buildDeckDocumentInspector(scanBeamerDocument(source)).colors[0]).toMatchObject({ write: null, readOnly: { reason: expect.any(String) } });
  });

  it("ignores stored declarations and leaves unrelated scoped roles intact", () => {
    const stored = String.raw`\newcommand{\later}{\setbeamercolor{structure}{fg=green}}`;
    const scoped = String.raw`{\setbeamercolor{alerted text}{fg=orange}}`;
    const next = edited(deck(stored, scoped), action("blue"));
    expect(next).toContain(stored);
    expect(next).toContain(scoped);
    expect(color(next).fg).toBe("#0000ff");
  });

  it.each(["unknown", "red, bg=blue", "red%comment", "red\n", "#123456", "red!101", "red!-1", "red!!blue", "{red}", String.raw`\somecolor`, "structure.fg"])("refuses unsafe or unresolved expressions: %s", value => {
    expect(applyDeckDocumentEditAction(deck(), action(value)).kind).toBe("unsupported");
  });

  it("updates the native canvas background and ordinary text", async () => {
    let source = edited(deck(), action("blue!10!white", "background canvas", "bg"));
    source = edited(source, action("red", "normal text"));
    const rendered = await prepareBeamerDocument(source).renderFrame();
    expect(rendered.svg.svg).toContain('fill="#e6e6ff"');
    expect(rendered.svg.svg).toContain('color="#ff0000"');
  });

  it("replays a deterministic mixed set/reset/theme sequence", async () => {
    let source = deck(String.raw`\usetheme{Madrid}`, String.raw`\definecolor{BrandInk}{RGB}{20,40,60}`);
    for (let index = 0; index < 40; index++) {
      const value = ["red", "BrandInk!20!white", "", null][index % 4];
      const role = index % 3 === 0 ? "structure" : "palette primary";
      source = edited(source, action(role === "structure" && value === "" ? null : value, role, role === "structure" || index % 2 === 0 ? "fg" : "bg"));
      if (index % 7 === 0) source = edited(source, { kind: "deckSetPresentationTheme", name: index % 2 === 0 ? "Berlin" : "Madrid" });
      expect(theme(source).diagnostics).toEqual([]);
    }
    expect((await prepareBeamerDocument(source).renderFrame()).diagnostics).toEqual([]);
  });
});
