import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { corpusEntries, corpusGallery, corpusGraphicsResolver, loadCorpusSource, sampleIndices, summarizeCorpus, type CorpusDeck } from "../scripts/lib/beamer-corpus.mjs";

const temporaryDirectories: string[] = [];
function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "beamer-corpus-test-"));
  temporaryDirectories.push(directory);
  return directory;
}
afterEach(() => { for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

describe("Beamer corpus renderer runner", () => {
  it("samples across the deck deterministically, including endpoints", () => {
    expect(sampleIndices(11, 3)).toEqual([0, 5, 10]);
    expect(sampleIndices(2, 8)).toEqual([0, 1]);
    expect(sampleIndices(0, 3)).toEqual([]);
    expect(sampleIndices(4, "all")).toEqual([0, 1, 2, 3]);
    expect(sampleIndices(11, 1)).toEqual([0]);
  });

  it("resolves a moved index beside its snapshots, ignoring the old absolute base", () => {
    const directory = temporaryDirectory();
    const index = join(directory, "deck-index.json");
    writeFileSync(index, JSON.stringify({ path_base: "/another/machine", repositories: [{ repository: "owner/repo", directory: "snapshot", commit: "pin", entry_points: ["talk/main.tex"] }] }));
    expect(corpusEntries(index)[0].inputPath).toBe(join(directory, "snapshot/talk/main.tex"));
  });

  it("expands nested literal inputs from the entry-point working directory without executing examples or macros", () => {
    const directory = temporaryDirectory();
    mkdirSync(join(directory, "parts"));
    writeFileSync(join(directory, "parts/first.tex"), "FIRST\\input{second}");
    writeFileSync(join(directory, "second.tex"), "SECOND% trailing comment");
    const source = String.raw`% \input{missing-comment}
\newcommand{\example}{\input{missing-macro}}
\verb|\input{missing-verb}|
\begin{verbatim}\input{missing-environment}\end{verbatim}
\input parts/first
TAIL
\input{\dynamic}
\input{missing-real}
`;
    const input = join(directory, "main.tex");
    writeFileSync(input, source);
    expect(loadCorpusSource(input).source).toBe(source);
    const loaded = loadCorpusSource(input, true);
    expect(loaded.source).toContain("FIRSTSECOND% trailing comment\n\n");
    expect(loaded.source).toContain("TAIL");
    expect(loaded.inputs.map((item) => item.status)).toEqual(["expanded", "expanded", "dynamic-input", "missing-input"]);
    expect(loaded.dependencies).toHaveLength(3);
  });

  it("retains cyclic inputs as explicit adaptation failures", () => {
    const directory = temporaryDirectory();
    const input = join(directory, "main.tex");
    writeFileSync(input, "\\input{loop}");
    writeFileSync(join(directory, "loop.tex"), "\\input{main}");
    const loaded = loadCorpusSource(input, true);
    expect(loaded.inputs.some((item) => item.status === "input-cycle")).toBe(true);
    expect(loaded.source).toContain("\\input{main}");
  });

  it("embeds a local PNG from graphicspath and distinguishes missing and dynamic assets", () => {
    const directory = temporaryDirectory();
    mkdirSync(join(directory, "images"));
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1kAAAAASUVORK5CYII=", "base64");
    writeFileSync(join(directory, "images/pixel.png"), png);
    writeFileSync(join(directory, "images/vector.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="72pt" height="2in"/>');
    const graphics = corpusGraphicsResolver("\\graphicspath{{images/}}", join(directory, "main.tex"), directory);
    const request = { filename: "pixel", options: { raw: "" }, source: "", sourceStart: 0, sourceEnd: 0 };
    const resolved = graphics.resolver.resolve(request);
    expect(resolved.status).toBe("resolved");
    if (resolved.status === "resolved") {
      expect(resolved.dataBase64).toBe(png.toString("base64"));
      expect(resolved.naturalWidthPt).toBeCloseTo(72.27 / 72);
    }
    expect(graphics.resolver.resolve({ ...request, filename: "absent" }).status).toBe("missing");
    expect(graphics.resolver.resolve({ ...request, filename: "\\generated" }).status).toBe("unsupported");
    const vector = graphics.resolver.resolve({ ...request, filename: "vector.svg" });
    expect(vector.status).toBe("resolved");
    if (vector.status === "resolved") {
      expect(vector.naturalWidthPt).toBeCloseTo(72);
      expect(vector.naturalHeightPt).toBeCloseTo(144.54);
    }
    expect(graphics.report()).toHaveLength(4);
  });

  it("keeps oracle failures and undiscovered frames outside the fidelity denominator", () => {
    const diagnostic = { code: "unsupported", severity: "warning" as const, message: "Unsupported flow", span: { from: 0, to: 1 } };
    const deck: CorpusDeck = {
      entry: { repository: "test/repo", path: "main.tex", root: "/test", inputPath: "/test/main.tex" }, status: "complete", frameCount: 8,
      pages: [
        { status: "compared", renderer: { diagnostics: [diagnostic, diagnostic] }, structuralFailures: ["fontMatch=false"] },
        { status: "oracle-error", renderer: { diagnostics: [] } },
        { status: "renderer-error" },
      ],
    };
    const summary = summarizeCorpus([deck, { ...deck, status: "no-frames", frameCount: 0, pages: [] }]);
    expect(summary.pagesAttempted).toBe(3);
    expect(summary.pagesRendered).toBe(2);
    expect(summary.pagesCompared).toBe(1);
    expect(summary.structuralMatches).toBe(0);
    expect(summary.pagesWithoutDiagnostics).toBe(1);
    expect(summary.diagnostics[0]).toMatchObject({ pages: 1, occurrences: 2 });
    const gallery = corpusGallery({ summary, options: { mode: "compare", expandInputs: false }, decks: [{ ...deck, entry: { ...deck.entry, path: '<script>alert("x")</script>' } }] });
    expect(gallery).toContain("&lt;script&gt;");
    expect(gallery).not.toContain('<script>alert("x")</script>');
  });

  it("renders all overlay steps, continues past unscannable entries, and exposes strict failures", () => {
    const directory = temporaryDirectory();
    const sourceDir = join(directory, "sources");
    mkdirSync(sourceDir);
    const input = join(sourceDir, "main.tex");
    const empty = join(sourceDir, "empty.tex");
    writeFileSync(input, String.raw`\documentclass{beamer}
\begin{document}
\begin{frame}{First}Before\pause After\end{frame}
\begin{frame}{Second}Hello\end{frame}
\end{document}`);
    writeFileSync(empty, "\\documentclass{beamer}\\begin{document}\\end{document}");
    const output = join(directory, "results");
    const args = [join(process.cwd(), "scripts/compare-beamer-corpus.mjs"), "--input", input, "--input", empty, "--frames", "all", "--steps", "all", "--jobs", "1", "--strict", "--out-dir", output];
    const run = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 30_000 });
    expect(run.error).toBeUndefined();
    expect(run.status, run.stderr).toBe(1);
    const report = JSON.parse(readFileSync(join(output, "report.json"), "utf8")) as { decks: CorpusDeck[]; summary: { pagesRendered: number } };
    expect(report.summary.pagesRendered).toBe(3);
    expect(report.decks.map((deck) => deck.status)).toEqual(["complete", "no-frames"]);
    expect(report.decks[0].pages.map((page) => [page.frame, page.step])).toEqual([[1, 1], [1, 2], [2, 1]]);
    const resumed = spawnSync(process.execPath, [...args, "--resume"], { encoding: "utf8", timeout: 30_000 });
    expect(resumed.stdout).toContain("[resume]");
    expect(resumed.status).toBe(1);
    const svg = report.decks[0].pages[0].svg;
    if (!svg) throw new Error("Missing SVG artifact in successful page result.");
    rmSync(join(output, svg));
    const repaired = spawnSync(process.execPath, [...args, "--resume"], { encoding: "utf8", timeout: 30_000 });
    expect(repaired.status).toBe(1);
    expect(repaired.stdout).not.toMatch(/\[resume\].*main\.tex/u);
    expect(existsSync(join(output, svg))).toBe(true);
  }, 40_000);
});
