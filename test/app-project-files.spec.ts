import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { documentGraphicsWatchPaths, invalidateImageAssetPath, prepareDocumentGraphicsContext } from "../packages/app/src/image-asset-cache";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../packages/app/src/platform/current";
import { beamerProjectFilesFromBundle } from "../packages/app/src/project-files";
import { prepareBeamerDocument } from "../packages/core/src/beamer/index.js";

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
    expect(context.projectFiles?.fontId?.("Lato-Light.ttf")).toBe("otf:Lato-Light.ttf");
    expect(context.previewBundle.runtimeFonts?.map(([id]) => id)).toEqual(["otf:Lato-Light.ttf"]);
    const prepared = prepareBeamerDocument(fontSource, { projectFiles: context.projectFiles! });
    expect(prepared.theme.fonts["normal-text"].typeface).toMatchObject({ upright: "otf:Lato-Light.ttf" });
    // A worker rebuilds the files from the bundle and registers the fonts.
    expect(beamerProjectFilesFromBundle(context.previewBundle)?.fontId?.("Lato-Light.ttf")).toBe("otf:Lato-Light.ttf");
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
    expect(context.projectFiles?.fontId?.("Lato-Light.ttf")).toBe("otf:Lato-Light.ttf");
    expect(documentGraphicsWatchPaths({ source: fontSource, documentFileRef: ref("/tmp/local-fonts") })).toContain("/tmp/local-fonts/Lato-Light.ttf");
  });
});
