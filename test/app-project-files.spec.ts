import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { documentGraphicsWatchPaths, invalidateImageAssetPath, prepareDocumentGraphicsContext } from "../packages/app/src/image-asset-cache";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../packages/app/src/platform/current";
import type { LocalAssetReadResult } from "../packages/app/src/platform/types";
import { beamerProjectFilesFromBundle } from "../packages/app/src/project-files";
import { createActiveDocumentAssetWatchOwner } from "../packages/app/src/ui/useActiveDocumentAssetWatches";
import { prepareBeamerDocument } from "../packages/core/src/beamer/index.js";
import { runtimeTexFont } from "../packages/core/src/text/tex/fonts/runtime-registry.js";

const previous = getActiveEditorPlatform();
afterEach(() => setActiveEditorPlatform(previous));

const ref = (directory: string) => ({ kind: "file" as const, name: "poster.tex", provider: "desktop-fs" as const, path: `${directory}/poster.tex` });
const source = String.raw`\documentclass{beamer}
\usetheme{mine}
\begin{document}\begin{frame}x\end{frame}\end{document}`;

function platformWith(directory: string, files: Map<string, string>, reads: string[]) {
  setActiveEditorPlatform({ id: directory, persistence: { load: () => null, save() {} }, files: {
    readLocalAsset: async (path) => {
      reads.push(path);
      const text = files.get(path);
      return text === undefined ? { status: "missing", path }
        : { status: "ok", path, revision: text, size: text.length, bytesBase64: Buffer.from(text, "utf8").toString("base64") };
    },
  } });
}

describe("project files in the document graphics context", () => {
  it("reads theme files from the document's folder, following nested themes", async () => {
    const directory = "/tmp/project-files-nested";
    const files = new Map([
      [`${directory}/beamerthememine.sty`, String.raw`\usecolortheme{mine}`],
      [`${directory}/beamercolorthememine.sty`, String.raw`\setbeamercolor{structure}{fg=red}`],
    ]);
    const reads: string[] = [];
    platformWith(directory, files, reads);
    const context = await prepareDocumentGraphicsContext({ source, documentFileRef: ref(directory) });
    expect(context.projectFiles?.readText("beamercolorthememine.sty")).toContain("structure");
    expect(context.previewBundle.projectFiles?.map(([name]) => name)).toEqual(["beamercolorthememine.sty", "beamerthememine.sty"]);
    expect(beamerProjectFilesFromBundle(context.previewBundle)?.readText("beamerthememine.sty")).toBe(String.raw`\usecolortheme{mine}`);
    expect(documentGraphicsWatchPaths({ source, documentFileRef: ref(directory) })).toContain(`${directory}/beamerthememine.sty`);
  });

  it("rereads a theme file only after the watcher reports a change", async () => {
    const directory = "/tmp/project-files-refresh";
    const files = new Map([[`${directory}/beamerthememine.sty`, String.raw`\setbeamercolor{structure}{fg=red}`]]);
    const reads: string[] = [];
    platformWith(directory, files, reads);
    const first = await prepareDocumentGraphicsContext({ source, documentFileRef: ref(directory) });
    const again = await prepareDocumentGraphicsContext({ source, documentFileRef: ref(directory) });
    expect(again.resolver.cacheKey).toBe(first.resolver.cacheKey);
    const themeReads = () => reads.filter(path => path.endsWith("beamerthememine.sty")).length;
    expect(themeReads()).toBe(1);
    files.set(`${directory}/beamerthememine.sty`, String.raw`\setbeamercolor{structure}{fg=blue}`);
    invalidateImageAssetPath(`${directory}/beamerthememine.sty`);
    const changed = await prepareDocumentGraphicsContext({ source, documentFileRef: ref(directory) });
    expect(themeReads()).toBe(2);
    expect(changed.resolver.cacheKey).not.toBe(first.resolver.cacheKey);
  });

  it("reads \\input files relative to the document, with TeX's .tex default, and their images", async () => {
    const directory = "/tmp/project-files-input/poster";
    const input = String.raw`\documentclass{beamer}
\input{../shared/sizes}
\begin{document}\begin{frame}\input{blocks/intro}\end{frame}\end{document}`;
    const files = new Map([
      ["/tmp/project-files-input/shared/sizes.tex", String.raw`\newlength{\colwidth}`],
      [`${directory}/blocks/intro.tex`, String.raw`\includegraphics{figures/a.png}`],
    ]);
    const reads: string[] = [];
    platformWith(directory, files, reads);
    const context = await prepareDocumentGraphicsContext({ source: input, documentFileRef: ref(directory) });
    expect(context.previewBundle.projectFiles?.map(([name]) => name)).toEqual(["../shared/sizes.tex", "blocks/intro.tex"]);
    expect(reads).toContain(`${directory}/figures/a.png`);
    expect(documentGraphicsWatchPaths({ source: input, documentFileRef: ref(directory) })).toEqual(expect.arrayContaining([
      "/tmp/project-files-input/shared/sizes.tex", `${directory}/blocks/intro.tex`, `${directory}/figures/a.png`]));
  });

  it("loads images a local theme's templates draw, looked up from the document's folder and \\graphicspath", async () => {
    const directory = "/tmp/project-files-theme-logo";
    const logo = `<svg xmlns="http://www.w3.org/2000/svg" width="40pt" height="20pt"><rect width="40" height="20" fill="#ff0000"/></svg>`;
    const theme = String.raw`\newcommand{\themelogo}[1]{\includegraphics{#1}}
\setbeamertemplate{headline}{\includegraphics[height=1cm]{logo}}`;
    const files = new Map([
      [`${directory}/beamerthememine.sty`, theme],
      [`${directory}/art/logo.svg`, logo],
    ]);
    const reads: string[] = [];
    platformWith(directory, files, reads);
    const themed = String.raw`\documentclass{beamer}
\graphicspath{{art/}}
\usetheme{mine}
\begin{document}\begin{frame}x\end{frame}\end{document}`;
    const context = await prepareDocumentGraphicsContext({ source: themed, documentFileRef: ref(directory) });
    expect(reads).toContain(`${directory}/art/logo.svg`);
    expect(reads.some(path => path.includes("#"))).toBe(false);
    const rendered = await prepareBeamerDocument(themed, { projectFiles: context.projectFiles! }).renderFrame({ frameIndex: 0, graphicsResolver: context.resolver });
    expect(rendered.svg.svg).toContain(Buffer.from(logo, "utf8").toString("base64"));
    expect(documentGraphicsWatchPaths({ source: themed, documentFileRef: ref(directory) })).toContain(`${directory}/art/logo.svg`);
  });

  it("publishes files found while preparing (nested themes, inputs, theme images) to the active watcher, once", async () => {
    const directory = "/tmp/project-files-discovered";
    const files = new Map([
      [`${directory}/beamerthememine.sty`, String.raw`\usecolortheme{mine}\setbeamertemplate{headline}{\includegraphics{logo.svg}}`],
      [`${directory}/beamercolorthememine.sty`, String.raw`\setbeamercolor{structure}{fg=red}`],
      [`${directory}/parts/body.tex`, String.raw`\input{parts/nested}`],
      [`${directory}/parts/nested.tex`, String.raw`Nested.`],
    ]);
    const reads: string[] = [];
    platformWith(directory, files, reads);
    const synced: string[][] = [];
    const watcher = { syncLocalAssetWatches: (paths: readonly string[]) => { synced.push([...paths]); } };
    const deck = String.raw`\documentclass{beamer}
\usetheme{mine}
\begin{document}\begin{frame}\input{parts/body}\end{frame}\end{document}`;
    const settle = () => new Promise(resolve => setTimeout(resolve, 0));
    const owner = createActiveDocumentAssetWatchOwner(watcher);
    try {
      owner.update({ source: deck, documentFileRef: ref(directory) });
      await settle();
      const discovered = [`${directory}/beamercolorthememine.sty`, `${directory}/parts/nested.tex`, `${directory}/logo.svg`];
      for (const path of discovered) expect(synced.at(-1)).not.toContain(path);
      await prepareDocumentGraphicsContext({ source: deck, documentFileRef: ref(directory) });
      await settle();
      expect(synced.at(-1)).toEqual(expect.arrayContaining([`${directory}/beamerthememine.sty`, `${directory}/parts/body.tex`, ...discovered]));
      // A change re-prepares the document; the same files are found, and the watcher is not resynchronized.
      const count = synced.length;
      files.set(`${directory}/beamercolorthememine.sty`, String.raw`\setbeamercolor{structure}{fg=blue}`);
      invalidateImageAssetPath(`${directory}/beamercolorthememine.sty`);
      await prepareDocumentGraphicsContext({ source: deck, documentFileRef: ref(directory) });
      await settle();
      expect(synced.length).toBe(count);
    } finally {
      owner.dispose();
    }
  });

  it("adds nothing for documents without theme files", async () => {
    const reads: string[] = [];
    platformWith("/tmp/project-files-none", new Map(), reads);
    const context = await prepareDocumentGraphicsContext({ source, documentFileRef: ref("/tmp/project-files-none") });
    expect(context.projectFiles).toBeUndefined();
    expect(context.previewBundle.projectFiles).toBeUndefined();
  });
});

function texLiveFontPath(file: string): string | null {
  try {
    return execFileSync("kpsewhich", [file], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

describe("fontspec fonts in the document graphics context", () => {
  const lato = texLiveFontPath("Lato-Light.ttf");
  const fontSource = String.raw`\documentclass{beamer}
\usepackage{fontspec}
\setsansfont{Lato}[UprightFont=*-Light]
\begin{document}\begin{frame}x\end{frame}\end{document}`;

  it.skipIf(!lato)("finds a family's face through the platform, builds and registers it", async () => {
    const asked: string[][] = [];
    setActiveEditorPlatform({ id: "fonts", persistence: { load: () => null, save() {} }, files: {
      readLocalAsset: async (path) => path === lato
        ? { status: "ok", path, revision: "r1", size: 1, bytesBase64: readFileSync(path).toString("base64") }
        : { status: "missing", path },
      findFont: async (names, byFileName) => { asked.push([...names, String(byFileName)]); return names.includes("Lato-Light.ttf") ? lato : null; },
    } });
    const context = await prepareDocumentGraphicsContext({ source: fontSource, documentFileRef: ref("/tmp/project-fonts") });
    expect(asked[0]).toContain("Lato-Light.ttf");
    expect(asked[0]?.at(-1)).toBe("false");
    const id = context.projectFiles?.fontId?.("Lato-Light.ttf");
    expect(id).toMatch(/^otf:Lato-Light\.ttf#[0-9a-f]{8}$/u);
    expect(context.previewBundle.runtimeFonts?.map(([id]) => id)).toEqual([id]);
    // The bundle goes to workers as metrics and the font file; they draw outlines on demand.
    expect(Object.keys(context.previewBundle.runtimeFonts?.[0]?.[1] ?? {}).sort()).toEqual(["bytes", "font"]);
    expect(() => structuredClone(context.previewBundle)).not.toThrow();
    const prepared = prepareBeamerDocument(fontSource, { projectFiles: context.projectFiles! });
    expect(prepared.theme.fonts["normal-text"].typeface).toMatchObject({ upright: id });
    // A worker rebuilds the files from the bundle and registers the fonts.
    expect(beamerProjectFilesFromBundle(context.previewBundle)?.fontId?.("Lato-Light.ttf")).toBe(id);
  });

  const latoBold = texLiveFontPath("Lato-Bold.ttf");
  const fileRead = (path: string, file: string, revision = "r1"): LocalAssetReadResult =>
    ({ status: "ok", path, revision, size: 1, bytesBase64: readFileSync(file).toString("base64") });

  it.skipIf(!lato || !latoBold)("keeps same-named font files of two documents, and of two Path= folders, apart", async () => {
    const sameSource = String.raw`\documentclass{beamer}
\usepackage{fontspec}
\setsansfont{Same.ttf}
\begin{document}\begin{frame}x\end{frame}\end{document}`;
    setActiveEditorPlatform({ id: "same-name-fonts", persistence: { load: () => null, save() {} }, files: {
      readLocalAsset: async (path) => path === "/tmp/fonts-a/Same.ttf" ? fileRead(path, lato!)
        : path === "/tmp/fonts-b/Same.ttf" ? fileRead(path, latoBold!) : { status: "missing", path },
    } });
    const first = await prepareDocumentGraphicsContext({ source: sameSource, documentFileRef: ref("/tmp/fonts-a") });
    const firstId = first.projectFiles!.fontId!("Same.ttf")!;
    const advance = () => runtimeTexFont(firstId)?.chars["120"]?.width;
    const before = advance();
    expect(before).toBeGreaterThan(0);
    const second = await prepareDocumentGraphicsContext({ source: sameSource, documentFileRef: ref("/tmp/fonts-b") });
    const secondId = second.projectFiles!.fontId!("Same.ttf")!;
    expect(secondId).not.toBe(firstId);
    expect(advance()).toBe(before);
    expect(runtimeTexFont(secondId)?.chars["120"]?.width).not.toBe(before);

    const twoPaths = String.raw`\documentclass{beamer}
\usepackage{fontspec}
\setsansfont{Same.ttf}[Path=light/]
\newfontfamily\heavy{Same.ttf}[Path=bold/]
\setbeamerfont{title}{family=\heavy}
\begin{document}\begin{frame}x\end{frame}\end{document}`;
    setActiveEditorPlatform({ id: "path-fonts", persistence: { load: () => null, save() {} }, files: {
      readLocalAsset: async (path) => path === "/tmp/fonts-paths/light/Same.ttf" ? fileRead(path, lato!)
        : path === "/tmp/fonts-paths/bold/Same.ttf" ? fileRead(path, latoBold!) : { status: "missing", path },
    } });
    const context = await prepareDocumentGraphicsContext({ source: twoPaths, documentFileRef: ref("/tmp/fonts-paths") });
    const light = context.projectFiles!.fontId!("Same.ttf", "light/");
    const bold = context.projectFiles!.fontId!("Same.ttf", "bold/");
    expect(light).toMatch(/^otf:Same\.ttf#/u);
    expect(bold).toMatch(/^otf:Same\.ttf#/u);
    expect(light).not.toBe(bold);
    // Workers see the same ids through the bundle.
    const worker = beamerProjectFilesFromBundle(context.previewBundle)!;
    expect([worker.fontId!("Same.ttf", "light/"), worker.fontId!("Same.ttf", "bold/")]).toEqual([light, bold]);
    const prepared = prepareBeamerDocument(twoPaths, { projectFiles: context.projectFiles! });
    expect(prepared.theme.fonts["normal-text"].typeface).toMatchObject({ upright: light });
    expect(prepared.theme.fonts.title.typeface).toMatchObject({ upright: bold });
  });

  it.skipIf(!lato || !latoBold)("gives a changed font file a new id", async () => {
    let file = lato!;
    let revision = "r1";
    setActiveEditorPlatform({ id: "font-revisions", persistence: { load: () => null, save() {} }, files: {
      readLocalAsset: async (path) => path === "/tmp/fonts-revision/Lato-Light.ttf" ? fileRead(path, file, revision) : { status: "missing", path },
    } });
    const first = await prepareDocumentGraphicsContext({ source: fontSource, documentFileRef: ref("/tmp/fonts-revision") });
    const firstId = first.projectFiles!.fontId!("Lato-Light.ttf")!;
    const before = runtimeTexFont(firstId)?.chars["120"]?.width;
    file = latoBold!;
    revision = "r2";
    invalidateImageAssetPath("/tmp/fonts-revision/Lato-Light.ttf");
    const changed = await prepareDocumentGraphicsContext({ source: fontSource, documentFileRef: ref("/tmp/fonts-revision") });
    const changedId = changed.projectFiles!.fontId!("Lato-Light.ttf")!;
    expect(changedId).not.toBe(firstId);
    expect(changed.resolver.cacheKey).not.toBe(first.resolver.cacheKey);
    expect(runtimeTexFont(firstId)?.chars["120"]?.width).toBe(before);
    expect(runtimeTexFont(changedId)?.chars["120"]?.width).not.toBe(before);
  });

  it.skipIf(!lato)("prefers a font in the document's folder", async () => {
    const reads: string[] = [];
    setActiveEditorPlatform({ id: "local-fonts", persistence: { load: () => null, save() {} }, files: {
      readLocalAsset: async (path) => { reads.push(path); return path === "/tmp/local-fonts/Lato-Light.ttf"
        ? { status: "ok", path, revision: "local", size: 1, bytesBase64: readFileSync(lato!).toString("base64") }
        : { status: "missing", path }; },
      // Only the upright face is in the folder; the platform is asked for the others.
      findFont: async (names) => { asked.push([...names]); return null; },
    } });
    const asked: string[][] = [];
    const context = await prepareDocumentGraphicsContext({ source: fontSource, documentFileRef: ref("/tmp/local-fonts") });
    expect(asked.some(names => names.includes("Lato-Light.ttf"))).toBe(false);
    expect(context.projectFiles?.fontId?.("Lato-Light.ttf")).toMatch(/^otf:Lato-Light\.ttf#/u);
    expect(documentGraphicsWatchPaths({ source: fontSource, documentFileRef: ref("/tmp/local-fonts") })).toContain("/tmp/local-fonts/Lato-Light.ttf");
  });
});
