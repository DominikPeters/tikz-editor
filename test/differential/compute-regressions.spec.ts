import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { ComputeRequest } from "../../packages/app/src/compute.js";
import { applyEditAction } from "../../packages/core/src/edit/actions.js";
import { coldCompute, compareResponses, longDeck, longFigure } from "./compute-fuzz.js";
import { freshComputeModule } from "./compute-instances.js";
import { fragment } from "../fragment-helpers.js";

// Minimal request sequences the compute differential fuzzer found: in each, a
// render that took a shortcut differed from a cold render of the same request.

async function expectLastMatchesCold(requests: readonly ComputeRequest[]): Promise<void> {
  const warm = await freshComputeModule();
  let response = await warm.computeSnapshot(requests[0]);
  for (const request of requests.slice(1)) response = await warm.computeSnapshot(request);
  expect(compareResponses(await coldCompute(requests.at(-1)!), response)).toEqual([]);
}

function insertAt(source: string, at: number, text: string): string {
  return source.slice(0, at) + text + source.slice(at);
}

const picture = String.raw`\documentclass{article}
\usepackage{tikz}
\begin{document}
\begin{tikzpicture}
  \draw[thick] (0,0) -- (3,0.4) -- (3.6,2);
  \node[draw,circle] (p) at (1.2,1.1) {P};
  \draw (2,0) ellipse (0.5 and 0.3);
  \draw[->] (p) -- (2.7,1.9);
\end{tikzpicture}
\end{document}
`;

describe("compute shortcuts match cold renders", () => {
  it("keeps circle and ellipse ids when text above them changes", async () => {
    const edited = picture.replace("(0,0) --", "(0.19,0) --");
    await expectLastMatchesCold([
      { id: "a", documentId: "d", source: picture, sourceRevision: 0, activeRootId: "figure:0" },
      { id: "b", documentId: "d", source: edited, sourceRevision: 1, activeRootId: "figure:0", inferSourceChanges: true }
    ]);
  });

  it("redraws what referred to a node that is renamed away, now resolving to an earlier node of that name", async () => {
    // Twelve copies of a picture redefine its node names; typing into the
    // ninth copy's (src) leaves its references on the eighth copy's node.
    const source = longFigure({ label: "node-graph", source: readFileSync("test/fixtures/differential/node-graph.tex", "utf8") }, 12).source;
    const at = source.indexOf("(src)", source.indexOf("xshift=48cm")) + 3;
    await expectLastMatchesCold([
      { id: "a", documentId: "d", source, sourceRevision: 0, activeRootId: "figure:0" },
      { id: "b", documentId: "d", source: insertAt(source, at, "$"), sourceRevision: 1, activeRootId: "figure:0", inferSourceChanges: true }
    ]);
  });

  it("resolves a requested root the source no longer has, as a full parse does", async () => {
    const edited = picture.replace("(0,0) --", "(0.19,0) --");
    await expectLastMatchesCold([
      { id: "a", documentId: "d", source: picture, sourceRevision: 0, activeRootId: "frame:0" },
      { id: "b", documentId: "d", source: edited, sourceRevision: 1, activeRootId: "frame:0", inferSourceChanges: true }
    ]);
  });

  it("renders no figure for a null root even when the parse is cached", async () => {
    const edited = picture.replace("(0,0) --", "(0.19,0) --");
    const patch = { oldSpan: { from: picture.indexOf("(0,0) --") + 1, to: picture.indexOf("(0,0) --") + 2 },
      newSpan: { from: picture.indexOf("(0,0) --") + 1, to: picture.indexOf("(0,0) --") + 5 }, replacement: fragment("0.19") };
    await expectLastMatchesCold([
      { id: "a", documentId: "d", source: picture, sourceRevision: 0, activeRootId: "figure:0" },
      { id: "b", documentId: "d", source: edited, sourceRevision: 1, activeRootId: "figure:0", patches: [patch], patchBaseRevision: 0, changedSourceIds: ["path:0"] },
      { id: "c", documentId: "d", source: edited, sourceRevision: 1, activeRootId: null, patches: [patch], patchBaseRevision: 0, changedSourceIds: ["path:0"] }
    ]);
  });

  it("parses in full when typing ends the picture early", async () => {
    // Right after a statement: the statement still reparses on its own, and only
    // the figure scan sees that the picture now ends there.
    const at = picture.indexOf("{P};") + 4;
    await expectLastMatchesCold([
      { id: "a", documentId: "d", source: picture, sourceRevision: 0, activeRootId: "figure:0" },
      { id: "b", documentId: "d", source: insertAt(picture, at, "\\end{tikzpicture}"), sourceRevision: 1, activeRootId: "figure:0", inferSourceChanges: true }
    ]);
  });

  it("numbers a path's items afresh when a property edit adds its option list", async () => {
    const warm = await freshComputeModule();
    const first = await warm.computeSnapshot({ id: "a", documentId: "d", source: picture, sourceRevision: 0, activeRootId: "figure:0" });
    const result = applyEditAction(picture, first.snapshot.editHandles, { kind: "setProperty", elementId: "path:2", level: "command", key: "line width", value: "1.04pt" });
    if (result.kind !== "success") throw new Error(result.kind);
    const request: ComputeRequest = { id: "b", documentId: "d", source: result.newSource, sourceRevision: 1, activeRootId: "figure:0",
      patches: result.patches, patchBaseRevision: 0, changedSourceIds: result.changedSourceIds ?? null, trigger: "other" };
    expect(compareResponses(await coldCompute(request), await warm.computeSnapshot(request))).toEqual([]);
  });

  it("lists parse problems in source order whichever parse found them", async () => {
    const source = readFileSync("test/fixtures/multi-figure-paper.tex", "utf8");
    const insert = "draw[helperGrid] (0.2,-0.5) grid (4.6,1.9);\n  \\";
    const request: ComputeRequest = { id: "b", documentId: "d", source: insertAt(source, 742, insert), sourceRevision: 1, activeRootId: "figure:0",
      changedSourceIds: ["path:4"], patches: [{ oldSpan: { from: 742, to: 742 }, newSpan: { from: 742, to: 742 + insert.length }, replacement: fragment(insert) }],
      patchBaseRevision: 0, trigger: "other" };
    await expectLastMatchesCold([
      { id: "a", documentId: "d", source, sourceRevision: 0, activeRootId: "figure:0" },
      request,
      // Sent again, as the app does on any other change: the parse is reused.
      { ...request, id: "c" }
    ]);
  });

  it("keeps macro-made statements opaque through a selective replay", async () => {
    const source = readFileSync("test/fixtures/multi-figure-paper.tex", "utf8");
    const insert = "  \\draw[->] (0.2,-0.4) -- (2.3,0.9);\n";
    const request: ComputeRequest = { id: "b", documentId: "d", source: insertAt(source, 975, insert), sourceRevision: 1, activeRootId: "figure:0",
      changedSourceIds: ["path:10"], patches: [{ oldSpan: { from: 975, to: 975 }, newSpan: { from: 975, to: 975 + insert.length }, replacement: fragment(insert) }],
      patchBaseRevision: 0, trigger: "other" };
    await expectLastMatchesCold([
      { id: "a", documentId: "d", source, sourceRevision: 0, activeRootId: "figure:0" },
      request,
      { ...request, id: "c" }
    ]);
  });

  it("names the picture's option styles independently of where the picture ends", async () => {
    // Reused statements keep their style chains; the picture's own entry must not name its old extent.
    const source = picture.replace("\\begin{tikzpicture}", "\\begin{tikzpicture}[x=1cm,y=1cm]");
    await expectLastMatchesCold([
      { id: "a", documentId: "d", source, sourceRevision: 0, activeRootId: "figure:0" },
      { id: "b", documentId: "d", source: source.replace("(0,0) --", "(0.19,0) --"), sourceRevision: 1, activeRootId: "figure:0", inferSourceChanges: true }
    ]);
  });

  it("keeps the macro uses of statements a selective replay reuses", async () => {
    // Exports read these edges to decide which preamble macros to include. An
    // unclosed brace makes the rest of the picture one statement that uses
    // \NodeStyle; moving the grid then replays only the grid.
    const source = readFileSync("test/fixtures/multi-figure-paper.tex", "utf8");
    const node = "\\NodeStyle{accentA}";
    const typed = insertAt(source, source.indexOf(node) + node.length, "\\only<2>{");
    const grid = "(-0.2,-0.2) grid (4.2,2.2)";
    const at = typed.indexOf(grid);
    const moved = "(-0.32,-0.32) grid (4.08,2.08)";
    await expectLastMatchesCold([
      { id: "a", documentId: "d", source, sourceRevision: 0, activeRootId: "figure:0" },
      { id: "b", documentId: "d", source: typed, sourceRevision: 1, activeRootId: "figure:0", inferSourceChanges: true },
      { id: "c", documentId: "d", source: typed.replace(grid, moved), sourceRevision: 2, activeRootId: "figure:0", changedSourceIds: ["path:4"],
        patches: [{ oldSpan: { from: at, to: at + grid.length }, newSpan: { from: at, to: at + moved.length }, replacement: fragment(moved) }], patchBaseRevision: 1, trigger: "other" }
    ]);
  });

  it("starts each path at the origin, not where the previous path ended", async () => {
    // TikZ resets the last point for every path (\tikz@@command@path); a node at an
    // unusable coordinate must not follow the previous path's end.
    const source = "\\begin{tikzpicture}\n  \\draw (0,0) -- (3,1.5);\n  \\node at (0.93,foo 0.75) {X};\n\\end{tikzpicture}";
    await expectLastMatchesCold([
      { id: "a", documentId: "d", source, sourceRevision: 0, activeRootId: "figure:0" },
      { id: "b", documentId: "d", source: source.replace("(3,1.5)", "(4.51,1.5)"), sourceRevision: 1, activeRootId: "figure:0", inferSourceChanges: true }
    ]);
  });

  it("moves the enclosing scope's options of foreach elements kept from the last render", async () => {
    // Style layers from outside an expansion are document spans, not expansion ones.
    const source = String.raw`\begin{tikzpicture}[thick]
  \draw (0,0) -- (1,0);
  \draw (0,1) -- (1,1);
  \begin{scope}[xshift=1cm]
    \foreach \x in {0,1} \fill (\x,0) circle (2pt);
  \end{scope}
\end{tikzpicture}`;
    await expectLastMatchesCold([
      { id: "a", documentId: "d", source, sourceRevision: 0, activeRootId: "figure:0" },
      { id: "b", documentId: "d", source: source.replace("(1,0)", "(1.25,0)"), sourceRevision: 1, activeRootId: "figure:0", inferSourceChanges: true }
    ]);
  });

  it("moves the scopes open at a checkpoint when an edit inside them replays from it", async () => {
    // Twelve copies of the figure in scopes put a checkpoint inside the scope
    // around the edited node; the statement replayed from it inherits the scope.
    const source = longFigure({ label: "graph", source: readFileSync("test/fixtures/differential/node-graph.tex", "utf8") }, 12).source;
    const at = source.indexOf("{box}", source.length / 2) + 3;
    await expectLastMatchesCold([
      { id: "a", documentId: "d", source, sourceRevision: 0, activeRootId: "figure:0" },
      { id: "b", documentId: "d", source: insertAt(source, at, "W"), sourceRevision: 1, activeRootId: "figure:0", inferSourceChanges: true }
    ]);
  });

  it("evaluates a node as unmasked once a mask over its options ends", async () => {
    // The render after the mask reuses the parse from before it, so it must
    // also reuse the evaluation from before it, not the masked one.
    const edited = picture.replace("(3,0.4)", "(3,0.9)");
    const at = picture.indexOf("(3,0.4)") + 3;
    const request = { documentId: "d", source: edited, sourceRevision: 1, activeRootId: "figure:0", changedSourceIds: ["path:0"], trigger: "other" as const,
      patches: [{ oldSpan: { from: at, to: at + 1 }, newSpan: { from: at, to: at + 1 }, replacement: fragment("9") }], patchBaseRevision: 0 };
    const options = edited.indexOf("[draw,circle]");
    await expectLastMatchesCold([
      { id: "a", documentId: "d", source: picture, sourceRevision: 0, activeRootId: "figure:0" },
      { id: "b", ...request },
      { id: "c", ...request, textEditMaskSpan: { from: options, to: options + "[draw,circle]".length } },
      { id: "d", ...request }
    ]);
  });

  it("reparses a long deck when a text-edit mask appears away from the edit", async () => {
    // Lezer reuses subtrees only of long documents. The new mask blanks an item
    // the edit did not touch, so it must count as a change to the parsed text.
    const deck = longDeck({ label: "deck", source: readFileSync("test/fixtures/differential/mixed-deck.tex", "utf8") }, 25).source;
    const item = "\\item<3-> A tunnel is planned for 2031.";
    const masked = deck.indexOf(item, deck.length / 2);
    const at = deck.indexOf("Left bank");
    const edited = insertAt(deck, at, "k");
    await expectLastMatchesCold([
      { id: "a", documentId: "d", source: deck, sourceRevision: 0, activeRootId: "frame:0" },
      { id: "b", documentId: "d", source: edited, sourceRevision: 1, activeRootId: "frame:0", changedSourceIds: [], trigger: "other",
        patches: [{ oldSpan: { from: at, to: at }, newSpan: { from: at, to: at + 1 }, replacement: fragment("k") }], patchBaseRevision: 0,
        textEditMaskSpan: { from: masked + 1, to: masked + 1 + item.length } }
    ]);
  });

});

describe("exact deck parses", () => {
  // A deck with an unclosed group, reparsed from its previous tree.
  const deck = longDeck({ label: "deck", source: readFileSync("test/fixtures/differential/mixed-deck.tex", "utf8") }, 25).source;
  const broken = insertAt(deck, deck.indexOf("Left bank", deck.length / 2), "\\textbf{");
  const request = (id: string, source: string, revision: number, exactParse?: boolean) =>
    ({ id, documentId: "d", source, sourceRevision: revision, activeRootId: "frame:3", inferSourceChanges: true, exactParse });

  it("reports a reparse with errors as not exact, and parses it afresh when asked", async () => {
    const warm = await freshComputeModule();
    await warm.computeSnapshot(request("a", deck, 0));
    const typed = await warm.computeSnapshot(request("b", broken, 1));
    expect(typed.snapshot.deck?.exactParse).toBe(false);
    // The app keeps a current page, except for a parse from scratch.
    expect(warm.isDeckSnapshotCurrent(typed.snapshot, request("c", broken, 1))).toBe(true);
    expect(warm.isDeckSnapshotCurrent(typed.snapshot, request("c", broken, 1, true))).toBe(false);
    const paused = await warm.computeSnapshot(request("d", broken, 1, true));
    expect(paused.snapshot.deck?.exactParse).toBe(true);
    expect(compareResponses(await coldCompute(request("d", broken, 1)), paused)).toEqual([]);
  });

  it("keeps the rendered pages when the fresh parse has the same structure", async () => {
    const warm = await freshComputeModule();
    await warm.computeSnapshot(request("a", deck, 0));
    const typed = await warm.computeSnapshot(request("b", broken, 1));
    const paused = await warm.computeSnapshot(request("c", broken, 1, true));
    // This unclosed group recovers the same way either way.
    expect(paused.snapshot.deck?.cacheEpoch).toBe(typed.snapshot.deck?.cacheEpoch);
    expect(paused.snapshot.deck?.exactParse).toBe(true);
    expect(warm.isDeckSnapshotCurrent(paused.snapshot, request("d", broken, 1, true))).toBe(true);
  });
});

// Request sequences the fuzzer found and shrank, kept as they were: each line
// is a request, and the last one's render must match a cold render.
const REPLAYS = "test/fixtures/differential/replays";

describe("recorded fuzzer findings match cold renders", () => {
  for (const file of readdirSync(REPLAYS).filter((name) => name.endsWith(".jsonl"))) {
    it(file.replace(/\.jsonl$/u, "").replaceAll("-", " "), async () => {
      const requests = readFileSync(`${REPLAYS}/${file}`, "utf8").trim().split("\n").map((line) => JSON.parse(line) as ComputeRequest);
      await expectLastMatchesCold(requests);
    });
  }
});
