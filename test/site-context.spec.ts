import { describe, expect, it } from "vitest";
import type { Statement } from "../packages/core/src/ast/types.js";
import { applyFrameToWorldPoint } from "../packages/core/src/coords/frame.js";
import { frameLocalPoint } from "../packages/core/src/coords/points.js";
import { pt } from "../packages/core/src/coords/scalars.js";
import { PT_PER_CM } from "../packages/core/src/coords/source.js";
import type { FrameToWorldTransform } from "../packages/core/src/coords/transforms.js";
import { gapPathContext, prepareInsertion, type InsertionDescription } from "../packages/core/src/edit/insertion-context.js";
import { sameSiteContext, siteCoordinateFrame, type SiteContext } from "../packages/core/src/semantic/site-context.js";
import { isCoordinateEditHandle, type EditHandle } from "../packages/core/src/semantic/types.js";
import { FRAMES, evaluate, pictureSource } from "./pointer-invariant/pointer-fuzz.js";

/**
 * Capture oracle: the contexts the evaluator records must be the frames a
 * statement written there is actually read in. Probes inserted at each site
 * and evaluated cold are the reference.
 */

const PROBE = String.raw`\path (0,0) -- (1,0) -- (0,1) -- (0pt,0pt) -- (1pt,0pt) -- (0pt,1pt);`;

const SPECIAL_PICTURES: Record<string, string> = {
  "mid-picture tikzset": String.raw`\begin{tikzpicture}[x=2cm]
\draw (0,0) -- (1,0);
\tikzset{x=1cm,y=3cm}
\draw (0,0) -- (0,1);
\end{tikzpicture}`,
  "nested scopes": String.raw`\begin{tikzpicture}[scale=1.5]
\begin{scope}[rotate=20]
\begin{scope}[xscale=2,x=1.5cm]
\draw (0,0) -- (1,1);
\end{scope}
\draw (0,0) -- (1,0);
\end{scope}
\draw (0,0) -- (0,1);
\end{tikzpicture}`,
  "every path style": String.raw`\begin{tikzpicture}[every path/.style={xshift=5mm}]
\draw (0,0) -- (1,0);
\end{tikzpicture}`,
  "transforming style": String.raw`\begin{tikzpicture}
\tikzset{tilted/.style={rotate=45,x=2cm}}
\draw (0,0) -- (1,0);
\end{tikzpicture}`
};

function pictures(): [string, string][] {
  const body = String.raw`\draw[P] (0,0) -- (1,.5);` + "\n" + String.raw`\node[draw,P] at (1,1) {N};`;
  return [...FRAMES.map(frame => [frame.label, pictureSource(frame, body).source] as [string, string]), ...Object.entries(SPECIAL_PICTURES)];
}

const close = (a: number, b: number, tolerance = 1e-6) => Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b));
const sameFrame = (l: FrameToWorldTransform, r: FrameToWorldTransform) =>
  close(l.a, r.a) && close(l.b, r.b) && close(l.c, r.c) && close(l.d, r.d) && close(l.e, r.e) && close(l.f, r.f);

/** Where the probe's six points should land if it is read in `context`. */
function predictedProbe(context: SiteContext) {
  const unitless = siteCoordinateFrame(context);
  const dimensioned = siteCoordinateFrame(context, false, false);
  const at = (frame: FrameToWorldTransform, x: number, y: number) => applyFrameToWorldPoint(frame, frameLocalPoint(pt(x), pt(y)));
  return [at(unitless, 0, 0), at(unitless, PT_PER_CM, 0), at(unitless, 0, PT_PER_CM), at(dimensioned, 0, 0), at(dimensioned, 1, 0), at(dimensioned, 0, 1)];
}

function probeWorlds(source: string, offset: number, probe = PROBE) {
  const probed = `${source.slice(0, offset)}${probe}\n${source.slice(offset)}`;
  const handles = evaluate(probed).handles.filter(h => h.sourceRef.sourceSpan.from >= offset && h.sourceRef.sourceSpan.to <= offset + probe.length);
  return handles.map(h => h.world);
}

function mismatch(label: string, expected: { x: number; y: number }[], actual: { x: number; y: number }[]): string | null {
  if (expected.length !== actual.length) return `${label}: ${actual.length} probe points, expected ${expected.length}`;
  const off = expected.findIndex((p, i) => Math.hypot(p.x - actual[i].x, p.y - actual[i].y) > 1e-6);
  return off < 0 ? null : `${label}: point ${off} predicted (${expected[off].x.toFixed(3)},${expected[off].y.toFixed(3)}), probe at (${actual[off].x.toFixed(3)},${actual[off].y.toFixed(3)})`;
}

function statementsById(statements: readonly Statement[], into = new Map<string, Statement>()): Map<string, Statement> {
  for (const statement of statements) {
    into.set(statement.id, statement);
    if (statement.kind === "Scope") statementsById(statement.body, into);
  }
  return into;
}

/** The frame a handle's own spelling selects from its raw context. */
function spelledFrame(handle: EditHandle, context: SiteContext): FrameToWorldTransform | null {
  if (!isCoordinateEditHandle(handle)) return null;
  if (handle.rewriteMode === "calc") return siteCoordinateFrame(context, false, false);
  if (handle.coordinateSpace === "world-only") return handle.detachFrame ? siteCoordinateFrame(context) : null;
  if (handle.coordinateForm === "explicit") return siteCoordinateFrame(context, false, false);
  const units = handle.sourceUnits;
  return siteCoordinateFrame(context, !(units?.x ?? units?.radius), !(units?.y ?? units?.radius));
}

describe("site context capture", () => {
  it("records on every coordinate handle the raw frame its `frame` is composed from", () => {
    const problems: string[] = [];
    let checked = 0;
    for (const [label, source] of pictures()) {
      for (const handle of evaluate(source).handles) {
        if (!isCoordinateEditHandle(handle)) continue;
        const context = handle.siteContext;
        if (!context) { problems.push(`${label} ${handle.sourceText}: no site context`); continue; }
        const expected = spelledFrame(handle, context);
        const actual = handle.rewriteMode === "calc" ? handle.frame
          : handle.coordinateSpace === "world-only" ? handle.detachFrame : handle.frame;
        if (!expected || !actual) continue;
        checked++;
        if (!sameFrame(expected, actual)) problems.push(`${label} ${handle.sourceText}: frame differs from its context`);
      }
    }
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(40);
  });

  it("resolves at every statement and at the end the frame a new path there is read in", () => {
    const problems: string[] = [];
    let checked = 0;
    for (const [label, source] of pictures()) {
      const snapshot = evaluate(source);
      const statements = statementsById(snapshot.parsed.figure.body);
      // The recorded state is what a path reads in, unless `every path` styles transform it.
      const plainPaths = !source.includes("every path");
      for (const [index, entry] of snapshot.semantic.siteContexts.statementEntries.entries()) {
        const leave = entry.statementId.endsWith(":leave");
        const statement = statements.get(leave ? entry.statementId.slice(0, -":leave".length) : entry.statementId);
        if (!statement) continue;
        const offset = leave ? source.lastIndexOf("\\end{scope}", statement.span.to) : statement.span.from;
        const path = gapPathContext(snapshot, { kind: "before", statementIndex: index });
        checked++;
        const problem = mismatch(`${label} before ${entry.statementId}`, predictedProbe(path), probeWorlds(source, offset));
        if (problem) problems.push(problem);
        if (plainPaths && !sameSiteContext(entry.context, path)) problems.push(`${label} before ${entry.statementId}: recorded context differs from the replayed one`);
      }
      checked++;
      const endPath = gapPathContext(snapshot, { kind: "end" });
      const end = mismatch(`${label} at the end`, predictedProbe(endPath), probeWorlds(source, source.lastIndexOf("\\end{tikzpicture}")));
      if (end) problems.push(end);
      if (plainPaths && !sameSiteContext(snapshot.semantic.siteContexts.figureEnd, endPath)) problems.push(`${label} at the end: recorded context differs from the replayed one`);
    }
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(50);
  });

  it("resolves a new statement's own options against the gap", () => {
    const OPTIONS = ["rotate=30", "x=2cm,y=1.5cm", "shift={(1,1)}", "scale=2,xshift=3mm", "tilted", "x={(1cm,.5cm)}"];
    const problems: string[] = [];
    for (const [label, source] of pictures()) {
      const snapshot = evaluate(source);
      const end = source.lastIndexOf("\\end{tikzpicture}");
      for (const raw of OPTIONS) {
        for (const kind of ["path", "scope"] as const) {
          const description: InsertionDescription = kind === "path" ? { kind, command: "path", options: raw } : { kind, options: raw };
          const prepared = prepareInsertion(snapshot, { kind: "end" }, description);
          const probe = kind === "path"
            ? PROBE.replace("\\path ", `\\path[${raw}] `)
            : `\\begin{scope}[${raw}]${PROBE}\\end{scope}`;
          const problem = mismatch(`${label} ${kind}[${raw}] at the end`, predictedProbe(prepared), probeWorlds(source, end, probe));
          if (problem) problems.push(problem);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
