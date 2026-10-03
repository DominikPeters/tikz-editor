import { describe, expect, it } from "vitest";
import { computeSnapshot, type ComputeRequest } from "../packages/app/src/compute.js";

const picture = String.raw`\begin{tikzpicture}` + "\n" +
  Array.from({ length: 120 }, (_, i) => `\\draw (${i},0)--(${i},1);`).join("\n") +
  String.raw`\node[draw] (A) {Owned $x^2$};\draw (A)--(2,2);\end{tikzpicture}`;
let sequence = 0;
const sourceFor = (label: string) => String.raw`\documentclass{beamer}\begin{document}\begin{frame}{` + label + "}" + picture +
  String.raw`\end{frame}\begin{frame}Later\end{frame}\end{document}`;
function request(source: string, activeRootId = "frame:0"): ComputeRequest {
  return { id: `cooperative-app-${++sequence}`, documentId: "cooperative-app", source, activeRootId };
}
function comparable(response: Awaited<ReturnType<typeof computeSnapshot>>): unknown {
  const { revision: _revision, textLayoutContext: _context, ...snapshot } = response.snapshot;
  return JSON.parse(JSON.stringify({ snapshot, diagnostics: response.diagnostics }));
}

describe("app Beamer cooperative ownership", () => {
  it.each(["frame:0", "frame:0:tikzpicture:0"])("forwards work through %s and preserves fresh output", async root => {
    const source = sourceFor(`parity-${++sequence}`);
    let yields = 0;
    const actual = await computeSnapshot(request(source, root), {
      budgetMs: 0, yieldControl: async () => { yields++; },
    });
    expect(yields).toBeGreaterThan(100);
    // A distinct deck request retires the app page memo before the plain run.
    await computeSnapshot(request(sourceFor(`retire-${++sequence}`), "frame:1"));
    const normal = await computeSnapshot(request(source, root));
    expect(comparable(actual)).toEqual(comparable(normal));
    expect(actual.snapshot.deck?.activeFrame?.svg ?? actual.snapshot.svg?.svg).toContain("<path");
  });

  it.each(["frame:0", "frame:0:tikzpicture:0"])("aborts inside %s and renders the same source from scratch next", async root => {
    const source = sourceFor(`abort-${++sequence}`);
    const controller = new AbortController();
    let yields = 0;
    await expect(computeSnapshot(request(source, root), {
      budgetMs: 0, signal: controller.signal,
      yieldControl: async () => { if (++yields === 20) controller.abort(); },
    })).rejects.toMatchObject({ name: "AbortError" });
    let retryYields = 0;
    const retry = await computeSnapshot(request(source, root), {
      budgetMs: 0, yieldControl: async () => { retryYields++; },
    });
    expect(retryYields).toBeGreaterThan(100);
    const normal = await computeSnapshot(request(source, root));
    expect(comparable(retry)).toEqual(comparable(normal));
  });

  it("reuses a complete cached frame without artificial yielding", async () => {
    const source = sourceFor(`cached-${++sequence}`);
    const base = await computeSnapshot(request(source));
    const serialized = JSON.stringify(base.snapshot);
    let yields = 0;
    const cached = await computeSnapshot(request(source), { budgetMs: 0, yieldControl: async () => { yields++; } });
    expect(yields).toBe(0);
    expect(cached.snapshot.deck!.activeFrame!.svgModel).toBe(base.snapshot.deck!.activeFrame!.svgModel);
    expect(JSON.stringify(base.snapshot)).toBe(serialized);
    const controller = new AbortController();
    controller.abort();
    await expect(computeSnapshot(request(source), { signal: controller.signal, yieldControl: async () => {} }))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it.each(["same-source", "different-source"])("a suspended older %s deck cannot replace the newest page memo", async relation => {
    const source = sourceFor(`older-${++sequence}`);
    const latestSource = relation === "same-source" ? source : sourceFor(`newest-${++sequence}`);
    let resume!: () => void;
    let notify!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const suspended = new Promise<void>(resolve => { notify = resolve; });
    let yields = 0;
    const pending = computeSnapshot(request(source), { budgetMs: 0, yieldControl: async () => {
      if (++yields === 20) { notify(); await gate; }
    } });
    await suspended;
    const newest = await computeSnapshot(request(latestSource));
    resume();
    const older = await pending;
    expect(older.snapshot.source).toBe(source);
    const next = await computeSnapshot(request(latestSource));
    expect(next.snapshot.deck!.activeFrame!.svgModel).toBe(newest.snapshot.deck!.activeFrame!.svgModel);
  });

  it("an aborted same-source page leaves an earlier complete frame memo intact", async () => {
    const source = sourceFor(`multi-frame-${++sequence}`);
    const base = await computeSnapshot(request(source, "frame:1"));
    const saved = JSON.stringify(base.snapshot);
    const controller = new AbortController();
    let yields = 0;
    await expect(computeSnapshot(request(source), { budgetMs: 0, signal: controller.signal,
      yieldControl: async () => { if (++yields === 20) controller.abort(); },
    })).rejects.toMatchObject({ name: "AbortError" });
    const next = await computeSnapshot(request(source, "frame:1"));
    expect(next.snapshot.deck!.activeFrame!.svgModel).toBe(base.snapshot.deck!.activeFrame!.svgModel);
    expect(JSON.stringify(base.snapshot)).toBe(saved);
  });

  it("preserves prewarm and missing nested-root fallback contracts", async () => {
    const source = sourceFor(`prewarm-${++sequence}`);
    let yields = 0;
    const work = { budgetMs: 0, yieldControl: async () => { yields++; } };
    for (const root of ["frame:0", "frame:0:tikzpicture:0"]) {
      const result = await computeSnapshot({ ...request(source, root), kind: "prewarm" }, work);
      expect(result.snapshot.deck).toBeNull();
      expect(result.snapshot.svg).toBeNull();
    }
    expect(yields).toBe(0);
    const fallback = await computeSnapshot(request(source, "frame:0:tikzpicture:99"), work);
    expect(fallback.snapshot.deck!.activeFrame!.frameId).toBe("frame:0");
    expect(yields).toBeGreaterThan(100);
  });
});
