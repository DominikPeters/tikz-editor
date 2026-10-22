import { describe, expect, it } from "vitest";
import { applyEditAction, type EditAction } from "../../packages/core/src/edit/actions.js";
import { parseTikz } from "../../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../../packages/core/src/semantic/evaluate.js";
import type { EditHandle, EvaluateOptions } from "../../packages/core/src/semantic/types.js";
import { PT_PER_CM } from "../../packages/core/src/edit/format.js";
import { wp } from "../coords-helpers.js";

const picture = (...statements: string[]) => String.raw`\begin{tikzpicture}[x=1.5cm,rotate=20]
${statements.join("\n")}
\end{tikzpicture}`;

function handlesOf(source: string, options?: EvaluateOptions): EditHandle[] {
  const parsed = parseTikz(source, { recover: true, includeContextDefinitions: true });
  return evaluateTikzFigure(parsed.figure, source, options).editHandles;
}

/** Every anchor and control the picture draws, rounded to 0.01pt, in a stable order. */
function drawnPoints(source: string, kinds: readonly string[] = ["path-point", "path-control"]): string[] {
  return handlesOf(source)
    .filter(handle => kinds.includes(handle.kind))
    .map(handle => `${handle.world.x.toFixed(2)},${handle.world.y.toFixed(2)}`)
    .sort();
}

function anchorsInOrder(source: string, sourceId: string): string[] {
  return handlesOf(source)
    .filter(handle => handle.kind === "path-point" && handle.sourceRef.sourceId === sourceId)
    .map(handle => `${handle.world.x.toFixed(2)},${handle.world.y.toFixed(2)}`);
}

function apply(source: string, action: EditAction | ((handles: EditHandle[]) => EditAction)) {
  const handles = handlesOf(source);
  return applyEditAction(source, handles, typeof action === "function" ? action(handles) : action);
}

function pointHandle(handles: readonly EditHandle[], source: string, raw: string): EditHandle {
  const handle = handles.find(candidate => candidate.kind === "path-point" && source.slice(candidate.sourceRef.sourceSpan.from, candidate.sourceRef.sourceSpan.to) === raw);
  if (!handle) throw new Error(`no point ${raw}`);
  return handle;
}

describe("rewritten paths keep their relative coordinates", () => {
  it.each([false, true])("refreshes unchanged path text when a named node moves (opaque identity: %s)", opaque => {
    const original = picture(String.raw`\node (A) at (0,0) {A};`, String.raw`\draw (A) -- ++(1,0) -- ++(0,1);`);
    const changed = original.replace("at (0,0)", "at (3,0)");
    const stale = handlesOf(original, opaque ? { sourceFingerprint: "revision:before" } : undefined);
    const parseOptions = opaque ? { sourceFingerprint: "revision:after" } : {};
    const result = applyEditAction(changed, stale, { kind: "reversePath", elementId: "path:1" }, { parseOptions });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.newSource).toContain(String.raw`\draw (4,1) -- ++(0,-1) -- (A);`);
    expect(anchorsInOrder(result.newSource, "path:1")).toEqual(anchorsInOrder(changed, "path:1").reverse());
  });

  it.each(["reversePath", "setPathPointKind", "insertPathPoint", "splitPath", "deletePathPoint", "toggleClosedPath", "appendToPath", "joinPaths"] as const)("refreshes the frame before %s when coordinate slices have not changed", kind => {
    const original = picture(String.raw`\draw (0,0) -- ++(1,.5) -- ++(0,1);`, String.raw`\draw (3,1) -- ++(1,0);`);
    const changed = original.replace("x=1.5cm,rotate=20", "x=2.5cm,rotate=50");
    const stale = handlesOf(original);
    const fresh = handlesOf(changed);
    const middle = pointHandle(fresh, changed, "(1,.5)");
    const action: EditAction = kind === "setPathPointKind"
      ? { kind, elementId: "path:0", handleId: middle.id, pointKind: "smooth" }
      : kind === "insertPathPoint"
        ? { kind, elementId: "path:0", segmentIndex: 0, point: middle.world }
        : kind === "splitPath" || kind === "deletePathPoint"
          ? { kind, elementId: "path:0", handleId: middle.id }
          : kind === "toggleClosedPath"
            ? { kind, elementId: "path:0", closed: true }
            : kind === "appendToPath"
              ? { kind, elementId: "path:0", end: "end", start: middle.world, segments: [{ kind: "line", to: wp(300, 100) }] }
              : kind === "joinPaths"
                ? { kind, elementIds: ["path:0", "path:1"] }
                : { kind, elementId: "path:0" };
    const result = applyEditAction(changed, stale, action);
    const expected = applyEditAction(changed, fresh, action);
    expect(expected.kind).toBe("success");
    expect(result).toEqual(expected);
  });

  it("reverses a path, writing each relative coordinate from the point now before it", () => {
    const source = picture(String.raw`\draw (0,0) -- ++(1,.5) -- +(0,1);`);
    const result = apply(source, { kind: "reversePath", elementId: "path:0" });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(anchorsInOrder(result.newSource, "path:0")).toEqual(anchorsInOrder(source, "path:0").reverse());
    // The start has nothing before it and becomes absolute; the rest stay relative.
    expect(result.newSource).toContain(String.raw`\draw (1,1.5) -- ++(0,-1) -- (0,0);`);
  });

  it("reverses curves with relative controls and a closed path", () => {
    for (const statement of [
      String.raw`\draw (0,0) .. controls +(1,0) and +(0,1) .. ++(2,0) -- +(0,1);`,
      String.raw`\draw (0,0) .. controls +(30:1cm) .. ++(2,1) .. controls ++(1,0) and +(-1,0) .. ++(1,-1);`,
      String.raw`\draw (0,0) -- ++(1,0) -- ++(0,1) -- cycle;`,
      String.raw`\draw (0,0) -- ++(1,0) .. controls +(0,1) and +(1,1) .. cycle;`
    ]) {
      const source = picture(statement);
      const result = apply(source, { kind: "reversePath", elementId: "path:0" });
      expect([statement, result.kind]).toEqual([statement, "success"]);
      if (result.kind !== "success") continue;
      expect([statement, drawnPoints(result.newSource)]).toEqual([statement, drawnPoints(source)]);
    }
  });

  it("splits, joins, deletes and closes without moving a point", () => {
    const line = String.raw`\draw (0,0) -- ++(1,0) -- +(0,1) -- ++(1,1) -- ++(1,0);`;
    const cases: Array<[string, string[], EditAction | ((handles: EditHandle[]) => EditAction)]> = [
      ["split", [line], handles => ({ kind: "splitPath", elementId: "path:0", handleId: pointHandle(handles, picture(line), "(1,1)").id })],
      ["split at a + point", [line], handles => ({ kind: "splitPath", elementId: "path:0", handleId: pointHandle(handles, picture(line), "(0,1)").id })],
      ["delete", [line], handles => ({ kind: "deletePathPoint", elementId: "path:0", handleId: pointHandle(handles, picture(line), "(1,0)").id })],
      ["close", [line], { kind: "toggleClosedPath", elementId: "path:0", closed: true }],
      ["join", [String.raw`\draw (0,0) -- ++(1,0);`, String.raw`\draw (3,1) -- ++(1,0) -- +(0,1);`], { kind: "joinPaths", elementIds: ["path:0", "path:1"] }]
    ];
    for (const [label, statements, action] of cases) {
      const source = picture(...statements);
      const result = apply(source, action);
      expect([label, result.kind]).toEqual([label, "success"]);
      if (result.kind !== "success") continue;
      const before = drawnPoints(source);
      const after = drawnPoints(result.newSource);
      // A delete drops its point, and a split repeats one; every other point stays.
      const missing = before.filter(point => !after.includes(point));
      expect([label, missing.length]).toEqual([label, label === "delete" ? 1 : 0]);
      expect([label, after.every(point => before.includes(point))]).toEqual([label, true]);
    }
  });

  it("opens a closed path at a relative point, ending at it again", () => {
    const source = picture(String.raw`\draw (0,0) -- ++(1,0) -- ++(0,1) -- +(-1,0) -- cycle;`);
    const result = apply(source, handles => ({ kind: "splitPath", elementId: "path:0", handleId: pointHandle(handles, source, "(0,1)").id }));
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const before = anchorsInOrder(source, "path:0");
    expect(anchorsInOrder(result.newSource, "path:0")).toEqual([...before.slice(2), ...before.slice(0, 3)]);
    expect(result.newSource).not.toContain("cycle");
  });

  it("keeps the points around a corner made smooth, and a point inserted before a relative one", () => {
    const source = picture(String.raw`\draw (0,0) -- ++(1,.5) -- +(0,1);`);
    const smooth = apply(source, handles => ({ kind: "setPathPointKind", elementId: "path:0", handleId: pointHandle(handles, source, "(1,.5)").id, pointKind: "smooth" }));
    expect(smooth.kind).toBe("success");
    if (smooth.kind === "success") expect(anchorsInOrder(smooth.newSource, "path:0")).toEqual(anchorsInOrder(source, "path:0"));

    const straight = picture(String.raw`\draw (0,0) -- ++(2,0) -- +(0,1);`);
    const [start, end] = handlesOf(straight).filter(handle => handle.kind === "path-point");
    const middle = wp((start!.world.x + end!.world.x) / 2, (start!.world.y + end!.world.y) / 2);
    const inserted = apply(straight, { kind: "insertPathPoint", elementId: "path:0", segmentIndex: 0, point: middle });
    expect(inserted.kind).toBe("success");
    if (inserted.kind !== "success") return;
    const anchors = anchorsInOrder(inserted.newSource, "path:0");
    expect([anchors[0], anchors[2], anchors[3]]).toEqual(anchorsInOrder(straight, "path:0"));
  });

  it("prepends segments to a path with relative coordinates", () => {
    const source = picture(String.raw`\draw (1,0) -- ++(1,0) -- +(0,1);`);
    const handles = handlesOf(source);
    const first = handles.filter(handle => handle.kind === "path-point")[0]!;
    const result = applyEditAction(source, handles, {
      kind: "appendToPath",
      elementId: "path:0",
      end: "start",
      start: first.world,
      segments: [{ kind: "line", to: wp(first.world.x - PT_PER_CM, first.world.y) }]
    });
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    const anchors = anchorsInOrder(result.newSource, "path:0");
    expect(anchors.slice(1)).toEqual(anchorsInOrder(source, "path:0"));
  });

  it("refuses a path that starts at a relative coordinate, which has no position to read it from", () => {
    const source = picture(String.raw`\draw (0,0) -- (1,0);`, String.raw`\draw ++(3,1) -- ++(1,0);`);
    expect(apply(source, { kind: "joinPaths", elementIds: ["path:0", "path:1"] }).kind).toBe("unsupported");
  });

  it("refuses to move a turn coordinate, whose tangent the rewrite changes", () => {
    const source = picture(String.raw`\draw (0,0) -- (1,1) -- ([turn]-45:1cm);`);
    const result = apply(source, { kind: "reversePath", elementId: "path:0" });
    expect(result.kind).toBe("unsupported");
  });

  it("leaves paths without relative coordinates as they were written", () => {
    const source = picture(String.raw`\draw (0,0)--(1,0) .. controls(2,0)and(2,1) .. (1,1);`);
    const result = apply(source, { kind: "reversePath", elementId: "path:0" });
    expect(result.kind === "success" && result.newSource).toContain(String.raw`\draw (1,1) .. controls (2,1) and (2,0) .. (1,0) -- (0,0);`);
  });
});
