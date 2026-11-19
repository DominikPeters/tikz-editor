import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { coldCompute, compareResponses, describeFailure, generateOps, longDeck, longFigure, runOps, shrinkOps, type FuzzDocument, type FuzzOp, type FuzzReach } from "./compute-fuzz.js";
import type { EditHandle } from "../../packages/core/src/semantic/types.js";
import { worldPoint } from "../../packages/core/src/coords/points.js";
import { pt } from "../../packages/core/src/coords/scalars.js";
import { freshComputeModule } from "./compute-instances.js";

// Scale with COMPUTE_FUZZ_CASES / COMPUTE_FUZZ_STEPS / COMPUTE_FUZZ_SEED;
// COMPUTE_FUZZ_SET=n runs only the nth document set.
const CASES = Number(process.env.COMPUTE_FUZZ_CASES ?? 14);
const STEPS = Number(process.env.COMPUTE_FUZZ_STEPS ?? 24);
const SEED = Number(process.env.COMPUTE_FUZZ_SEED ?? 1);

const fixture = (path: string): FuzzDocument => ({ label: path, source: readFileSync(`test/fixtures/${path}`, "utf8") });

const DOCUMENT_SETS: FuzzDocument[][] = [
  [fixture("differential/node-graph.tex")],
  [fixture("multi-figure-basic.tex")],
  // Drawing layers: the editor's tikzlayer, and authored overlay pictures in a
  // deck without its definition (a new layer there brings it).
  [fixture("beamer/overlay-pictures-fidelity/drawing-layer-tikzlayer.tex"), fixture("beamer/overlay-pictures-fidelity/pictures.tex")],
  [fixture("differential/mixed-deck.tex")],
  [fixture("multi-figure-paper.tex")],
  [fixture("shapes-new.tex"), fixture("differential/mixed-deck.tex")],
  [fixture("differential/mixed-deck.tex"), fixture("beamer/hello_world_beamer.tex"), fixture("beamer/overlay-pictures-fidelity/drawing-layer-tikzlayer.tex")],
  [fixture("beamer/overlay_conformance_beamer.tex")],
  [longDeck(fixture("differential/mixed-deck.tex"), 25)],
  [longDeck(fixture("beamer/overlay-pictures-fidelity/drawing-layer-tikzlayer.tex"), 12)],
  [longFigure(fixture("differential/node-graph.tex"), 12)]
];

// Shortcuts the default budget must reach; without them a clean run means little.
const REQUIRED_REACH: [string, (reach: FuzzReach) => number][] = [
  ["incremental parses", (reach) => reach["parse:incremental"] ?? 0],
  ["incremental evaluations", (reach) => Object.entries(reach).filter(([key]) => key.startsWith("semantic:incremental")).reduce((sum, [, count]) => sum + count, 0)],
  ["patches applied directly", (reach) => reach["patches:direct"] ?? 0],
  ["patches rebased over skipped revisions", (reach) => reach["patches:rebased"] ?? 0],
  ["deck pages kept or claimed from the cache", (reach) => (reach["deck:current"] ?? 0) + (reach["deck:claimed"] ?? 0)],
  ["racing renders", (reach) => reach.race ?? 0],
  ["drawing layers shown on a slide", (reach) => reach["layer:shown"] ?? 0],
  ["drawing layers still to come", (reach) => reach["layer:to-come"] ?? 0],
  ["slide layouts reused under a layer edit", (reach) => reach["layer:slide-layout-reused"] ?? 0],
  ["selective replays that took the previous state after the corridor", (reach) => reach["suffix:skipped"] ?? 0]
];

describe("compute differential fuzzing", () => {
  it("renders a request identically in two fresh instances", async () => {
    for (const documents of DOCUMENT_SETS.slice(0, 2)) {
      const request = { id: "determinism", documentId: "doc-0", source: documents[0].source, sourceRevision: 0 };
      const other = await (await freshComputeModule()).computeSnapshot(request);
      expect(compareResponses(await coldCompute(request), other)).toEqual([]);
    }
  });

  it("compares synthetic curve controls by their real targets after recovered long-figure edits", async () => {
    const result = await runOps(DOCUMENT_SETS[10], [
      { kind: "edit", doc: 0, edit: { from: 2167, to: 2167, insert: "\\end{frame}\n" }, origin: "source-editor", changedSourceIds: null, drag: false, render: true, note: "source typing" },
      { kind: "edit", doc: 0, edit: { from: 2720, to: 2723, insert: "1.64" }, origin: "source-editor", changedSourceIds: null, drag: false, render: true, note: "source typing" }
    ]);
    expect(result.failure).toBeNull();
  }, 30_000);

  it("still detects real source, operation and geometry changes on generated curve controls", async () => {
    const expected = await coldCompute({ id: "curve-comparison", source: String.raw`\begin{tikzpicture}
\foreach \x in {0,1} \draw (\x,0) to[bend left=20] ++(1,0);
\end{tikzpicture}` });
    const target = expected.snapshot.editHandles.find(handle => handle.curveEdit && handle.identityRef?.sourceKind === "expanded-handle");
    if (!target) throw new Error("Expected a generated curve control");
    const changed = (mutate: (handle: EditHandle) => EditHandle) => ({ ...expected, snapshot: { ...expected.snapshot,
      editHandles: expected.snapshot.editHandles.map(handle => handle.id === target.id ? mutate(handle) : handle) } });
    expect(compareResponses(expected, changed(handle => ({ ...handle, identityRef: { ...handle.identityRef!,
      sourceSpan: { from: handle.identityRef!.sourceSpan.from + 1, to: handle.identityRef!.sourceSpan.to + 1 } } })))).toEqual([]);
    for (const actual of [
      changed(handle => ({ ...handle, sourceRef: { ...handle.sourceRef,
        sourceSpan: { from: handle.sourceRef.sourceSpan.from + 1, to: handle.sourceRef.sourceSpan.to + 1 } } })),
      changed(handle => ({ ...handle, world: worldPoint(pt(handle.world.x + 1), handle.world.y) })),
      changed(handle => handle.handleType === "curve-control"
        ? { ...handle, curveEdit: { ...handle.curveEdit, operationItemId: "wrong-operation" } } : handle)
    ]) expect(compareResponses(expected, actual).length).toBeGreaterThan(0);
  });

  it("matches a cold render after every request the app would send", async () => {
    const reach: FuzzReach = {};
    for (let index = 0; index < CASES; index += 1) {
      // Each document set runs gentle (even seed) and then wild (odd seed).
      const seed = SEED * 1000 + index;
      const documents = process.env.COMPUTE_FUZZ_SET
        ? DOCUMENT_SETS[Number(process.env.COMPUTE_FUZZ_SET)]
        : DOCUMENT_SETS[Math.floor(index / 2) % DOCUMENT_SETS.length];
      const ops = await generateOps(documents, seed, STEPS);
      const result = await runOps(documents, ops);
      for (const [key, value] of Object.entries(result.reach)) reach[key] = (reach[key] ?? 0) + value;
      if (result.failure) {
        const shrunk = await shrinkOps(documents, ops);
        throw new Error(describeFailure(documents, seed, shrunk.ops, shrunk.failure));
      }
    }
    if (process.env.COMPUTE_FUZZ_VERBOSE) console.log(reach);
    if (!process.env.COMPUTE_FUZZ_SET) for (const [name, measure] of REQUIRED_REACH) expect(measure(reach), `the fuzzer reached no ${name}`).toBeGreaterThan(0);
  }, 600_000);
});

// COMPUTE_FUZZ_REPLAY=file.json replays {"documents": [fixture paths], "ops": [...]}.
describe.runIf(process.env.COMPUTE_FUZZ_REPLAY)("compute differential replay", () => {
  it("replays the recorded operations", async () => {
    const recorded = JSON.parse(readFileSync(process.env.COMPUTE_FUZZ_REPLAY!, "utf8")) as { documents: string[]; ops: FuzzOp[] };
    const documents = recorded.documents.map(fixture);
    const result = await runOps(documents, recorded.ops);
    if (result.failure) throw new Error(describeFailure(documents, 0, recorded.ops, result.failure));
  }, 600_000);
});
