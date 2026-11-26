import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { prepareBeamerDocument, scanBeamerDocument } from "../packages/core/src/beamer/index.js";
import { beamerFontFileRequests, createBeamerProjectFiles } from "../packages/core/src/beamer/project-files.js";
import { scanBeamerFontspecDeclarations } from "../packages/core/src/beamer/theme/fontspec.js";
import { buildRuntimeTexFont, type RuntimeHarfBuzz } from "../packages/core/src/text/tex/fonts/runtime-opentype.js";
import { registerRuntimeTexFont, runtimeTexFontId } from "../packages/core/src/text/tex/fonts/runtime-registry.js";

const preamble = (lines: string) => String.raw`\documentclass{beamer}
\usepackage{fontspec}
${lines}
\begin{document}\begin{frame}Office -- AV\end{frame}\end{document}`;

describe("fontspec declarations", () => {
  it("names faces from the face options, with * as the font name", () => {
    const [event] = scanBeamerFontspecDeclarations(scanBeamerDocument(preamble(
      String.raw`\setsansfont{Lato}[UprightFont=*-Light, ItalicFont=*-LightItalic, BoldFont=*-Regular, BoldItalicFont=*-Italic]`)));
    expect(event?.target).toBe("sans");
    expect(event?.byFileName).toBe(false);
    expect(event?.faces.upright).toContain("Lato-Light.ttf");
    expect(event?.faces.bold).toContain("Lato-Regular.otf");
    expect(event?.unsupportedOptions).toEqual([]);
  });

  it("reads a family's Regular, Italic, Bold and BoldItalic files by default", () => {
    const [event] = scanBeamerFontspecDeclarations(scanBeamerDocument(preamble(String.raw`\newfontfamily\Raleway[Ligatures=TeX]{Raleway}`)));
    expect(event?.target).toEqual({ command: "\\Raleway" });
    expect(event?.faces.upright.slice(0, 2)).toEqual(["Raleway-Regular.otf", "Raleway-Regular.ttf"]);
    expect(event?.faces.boldItalic).toContain("Raleway-BoldItalic.otf");
  });

  it("treats a name with an extension as a file, and keeps Path", () => {
    const [event] = scanBeamerFontspecDeclarations(scanBeamerDocument(preamble(String.raw`\setmainfont{Figtree-Regular.ttf}[Path=font/, BoldFont=Figtree-Bold.ttf]`)));
    expect(event?.byFileName).toBe(true);
    expect(event?.faces.upright).toEqual(["Figtree-Regular.ttf"]);
    expect(event?.faces.bold).toEqual(["Figtree-Bold.ttf"]);
    expect(event?.path).toBe("font/");
  });

  it("reports options that change the font beyond its files", () => {
    const [event] = scanBeamerFontspecDeclarations(scanBeamerDocument(preamble(String.raw`\setsansfont{Lato}[Scale=MatchLowercase]`)));
    expect(event?.unsupportedOptions).toEqual(["scale"]);
  });

  it("lists the files a document and its theme files request", () => {
    const requests = beamerFontFileRequests(preamble(String.raw`\usetheme{mine}`),
      new Map([["beamerthememine.sty", String.raw`\newfontfamily\Head{Raleway}`]]));
    expect(requests.map(request => request.names[0])).toContain("Raleway-Regular.otf");
  });
});

describe("fontspec families in the theme", () => {
  // Theme resolution accepts only registered fonts; these stand in for loaded files.
  const stub = { font: { family: "stub", codingScheme: "Unicode OpenType", ligKernEncoding: "unicode" as const, checksum: "", designSize: 10,
    source: { kind: "opentype" as const, name: "stub" }, fontdimen: { slant: 0, space: 0.25, stretch: 0.125, shrink: 0.08, xheight: 0.5, quad: 1 },
    chars: Object.fromEntries([...Array.from({ length: 95 }, (_, index) => 32 + index)].map(code => [String(code), { code, width: 0.5, height: 0.7, depth: 0 }])), ligKerns: [] }, outlines: {} };
  registerRuntimeTexFont("otf:Lato-Light.ttf", stub);
  registerRuntimeTexFont("otf:Raleway-Regular.otf", stub);
  const ids = new Map([["Lato-Light.ttf", "otf:Lato-Light.ttf"], ["Raleway-Regular.otf", "otf:Raleway-Regular.otf"]] as const);
  const files = { ...createBeamerProjectFiles(new Map(), "fonts"), fontId: (name: string) => ids.get(name as "Lato-Light.ttf") ?? null };

  it("gives sans roles the \\setsansfont family and \\setbeamerfont roles a \\newfontfamily", () => {
    const prepared = prepareBeamerDocument(preamble(String.raw`\setsansfont{Lato}[UprightFont=*-Light]
\newfontfamily\Raleway{Raleway}
\setbeamerfont{block title}{family=\Raleway}`), { projectFiles: files });
    expect(prepared.theme.fonts["normal-text"].typeface).toMatchObject({ kind: "runtime", upright: "otf:Lato-Light.ttf", bold: "otf:Lato-Light.ttf" });
    expect(prepared.theme.fonts["block-title"].typeface).toMatchObject({ kind: "runtime", upright: "otf:Raleway-Regular.otf" });
  });

  it("keeps the current font and reports a family it cannot load", () => {
    const prepared = prepareBeamerDocument(preamble(String.raw`\setsansfont{Nonexistent}`), { projectFiles: files });
    expect(prepared.theme.fonts["normal-text"].typeface).toBeUndefined();
    expect(prepared.theme.diagnostics.map(d => d.code)).toContain("beamer-font-unavailable");
  });
});

function texLiveFont(file: string): Uint8Array | null {
  try {
    const path = execFileSync("kpsewhich", [file], { encoding: "utf8" }).trim();
    return path ? readFileSync(path) : null;
  } catch {
    return null;
  }
}

describe("runtime fonts in a frame", () => {
  const bytes = texLiveFont("Lato-Light.ttf");

  it.skipIf(!bytes)("sets text in the runtime font, with kerns against spaces added to the glue", async () => {
    const hb = await import("harfbuzzjs") as unknown as RuntimeHarfBuzz;
    const id = runtimeTexFontId("Lato-Light.ttf");
    const data = buildRuntimeTexFont(hb, bytes!, "Lato-Light.ttf");
    registerRuntimeTexFont(id, data);
    const files = { ...createBeamerProjectFiles(new Map(), "lato"), fontId: (name: string) => name === "Lato-Light.ttf" ? id : null };
    const source = preamble(String.raw`\setsansfont{Lato-Light.ttf}`).replace("Office -- AV", "Lay A");
    const result = await prepareBeamerDocument(source, { projectFiles: files }).renderFrame({ frameIndex: 0 });
    const line = result.layout.paragraphs.find(paragraph => paragraph.role === "body")?.report.lines[0];
    const segments = line?.segments.filter(segment => segment.text) ?? [];
    expect(segments[0]?.fontId).toBe(id);
    const size = segments[0]?.fontAtPt ?? 0;
    const kern = (left: number, right: number) => data.font.ligKerns.find(rule => rule[0] === "kern" && rule[1] === left && rule[2] === right)?.[3] ?? 0;
    const spaceKern = kern(0x79, 0x20) + kern(0x20, 0x41);
    expect(spaceKern).not.toBe(0);
    const glue = line?.segments.find(segment => segment.kind === "space");
    expect(Number(glue?.width)).toBeCloseTo((data.font.fontdimen.space + spaceKern) * size, 3);
  });
});
