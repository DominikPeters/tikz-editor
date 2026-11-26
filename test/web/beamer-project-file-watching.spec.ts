/** @vitest-environment jsdom */
// The web shell has no project folder: its readLocalAsset serves only
// imported graphics, it has no file watcher, and project files resolve only
// for desktop documents. This drives the real App's watch owner and change
// listener over a fake desktop file API instead of a Playwright spec.
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mountFileApp, unmountFileApp } from "./app-file-operations-fixtures";
import { computeSnapshot } from "../../packages/app/src/compute";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../../packages/app/src/platform/current";
import type { LocalAssetReadResult, PlatformFileApi } from "../../packages/app/src/platform/types";
import { BeamerPresentationRenderer } from "../../packages/app/src/presentation/renderer";
import { useEditorStore } from "../../packages/app/src/store/store";
import { requestThumbnail } from "../../packages/app/src/ui/workers/thumbnail-worker-client";

const previousPlatform = getActiveEditorPlatform();
const previousState = useEditorStore.getState();
afterEach(async () => {
  await unmountFileApp();
  setActiveEditorPlatform(previousPlatform);
  useEditorStore.setState(previousState, true);
  vi.restoreAllMocks();
});

function texLiveFontPath(file: string): string | null {
  try {
    return execFileSync("kpsewhich", [file], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}
const light = texLiveFontPath("Lato-Light.ttf");
const bold = texLiveFontPath("Lato-Bold.ttf");

const directory = "/tmp/poster-project-watch";
const documentFileRef = { kind: "file" as const, name: "poster.tex", provider: "desktop-fs" as const, path: `${directory}/poster.tex` };
const source = String.raw`\documentclass{beamer}
\usepackage[orientation=portrait,size=a4,scale=1.2]{beamerposter}
\usetheme{poster}
\begin{document}
\begin{frame}
\input{sections/intro}
\end{frame}
\end{document}`;
const logo = (fill: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="80pt" height="40pt"><rect width="80" height="40" fill="${fill}"/></svg>`;
const base64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

describe("a Beamer poster's project files while the document is open", () => {
  it.skipIf(!light || !bold)("watches nested themes, inputs, theme images and fonts, and renders each change", async () => {
    const disk = new Map<string, { bytes: Buffer; revision: number }>();
    const write = (name: string, content: string | Buffer) => {
      const previous = disk.get(`${directory}/${name}`);
      disk.set(`${directory}/${name}`, { bytes: typeof content === "string" ? Buffer.from(content, "utf8") : content, revision: (previous?.revision ?? 0) + 1 });
    };
    write("beamerthemeposter.sty", String.raw`\usecolortheme{posterpalette}
\setsansfont{PosterSans.ttf}[Path=fonts/]
\setbeamertemplate{headline}{\includegraphics[height=2cm]{logo}}`);
    write("beamercolorthemeposterpalette.sty", String.raw`\definecolor{posterink}{RGB}{200,0,0}
\setbeamercolor{normal text}{fg=posterink}`);
    write("sections/intro.tex", String.raw`\input{sections/detail}`);
    write("sections/detail.tex", "Alpha");
    write("logo.svg", logo("#ff0000"));
    write("fonts/PosterSans.ttf", readFileSync(light!));

    let watched: readonly string[] = [];
    let changed: ((path: string) => void) | undefined;
    const files: PlatformFileApi = {
      readLocalAsset: async (path): Promise<LocalAssetReadResult> => {
        const file = disk.get(path);
        return file ? { status: "ok", path, revision: String(file.revision), size: file.bytes.length, bytesBase64: file.bytes.toString("base64") } : { status: "missing", path };
      },
      syncLocalAssetWatches: (paths) => { watched = [...paths]; },
      bindLocalAssetChange: (handler) => { changed = handler; return () => { changed = undefined; }; },
    };
    const documentId = await mountFileApp({ id: "poster-watch", persistence: { load: () => null, save() {} }, files }, source);
    await act(async () => useEditorStore.getState().dispatch({ type: "MARK_DOCUMENT_SAVED", fileRef: documentFileRef }));

    let renders = 0;
    const render = async () => {
      const { snapshot } = await computeSnapshot({ id: `poster-${++renders}`, documentId, source, documentFileRef, activeRootId: "frame:0" });
      const frame = snapshot.deck?.activeFrame;
      expect(frame).toBeTruthy();
      const thumbnail = await requestThumbnail({ type: "render", requestId: `thumb-${renders}`, groupId: "poster-thumbs", source, figureId: "frame:0",
        figureSignature: String(renders), deckFrameIndex: 0, parseOptions: { activeRootId: "frame:0", includeContextDefinitions: false },
        ...(snapshot.graphicsPreviewBundleKey ? { graphicsPreviewBundleKey: snapshot.graphicsPreviewBundleKey } : {}) });
      const presentation = await (await BeamerPresentationRenderer.create(source, documentFileRef)).page({ frame: 0, step: 1, continuation: 1 }, new AbortController().signal);
      const text = frame!.layout.paragraphs.flatMap(paragraph => paragraph.report.lines.map(line => line.segments.map(segment => segment.text ?? "").join(""))).join(" ");
      return { canvas: frame!.svg, text, thumbnail: thumbnail.ok ? thumbnail.svg : "", presentation: presentation.svg };
    };
    const change = async (name: string, content: string | Buffer) => {
      write(name, content);
      await act(async () => {
        changed?.(`${directory}/${name}`);
        await new Promise(resolve => setTimeout(resolve, 150));
      });
      return await render();
    };
    const all = (views: Awaited<ReturnType<typeof render>>) => [views.canvas, views.thumbnail, views.presentation];
    const fontId = (svg: string) => /data-tex-font="(otf:PosterSans\.ttf#[0-9a-f]+)"/u.exec(svg)?.[1];

    const first = await render();
    // Found while preparing, not named by the source: the watcher follows them without an edit.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(watched).toEqual(expect.arrayContaining(["beamerthemeposter.sty", "beamercolorthemeposterpalette.sty", "sections/intro.tex",
      "sections/detail.tex", "logo.svg", "fonts/PosterSans.ttf"].map(name => `${directory}/${name}`)));
    for (const svg of all(first)) {
      expect(svg).toContain("#c80000");
      expect(svg).toContain(base64(logo("#ff0000")));
      expect(fontId(svg)).toBeDefined();
    }
    expect(first.text).toContain("Alpha");

    const recolored = await change("beamercolorthemeposterpalette.sty", String.raw`\definecolor{posterink}{RGB}{0,0,200}
\setbeamercolor{normal text}{fg=posterink}`);
    for (const svg of all(recolored)) expect(svg).toContain("#0000c8");

    const retext = await change("sections/detail.tex", "Omega");
    expect(retext.text).toContain("Omega");
    expect(retext.text).not.toContain("Alpha");
    for (const [index, svg] of all(retext).entries()) expect(svg).not.toBe(all(recolored)[index]);

    const relogo = await change("logo.svg", logo("#00ff00"));
    for (const svg of all(relogo)) {
      expect(svg).toContain(base64(logo("#00ff00")));
      expect(svg).not.toContain(base64(logo("#ff0000")));
    }

    const refont = await change("fonts/PosterSans.ttf", readFileSync(bold!));
    for (const [index, svg] of all(refont).entries()) {
      expect(fontId(svg)).toBeDefined();
      expect(fontId(svg)).not.toBe(fontId(all(relogo)[index]));
      // Lato Bold's advances move the glyphs.
      expect(svg.replace(/#[0-9a-f]{8}"/gu, "\"")).not.toBe(all(relogo)[index].replace(/#[0-9a-f]{8}"/gu, "\""));
    }
  });
});
