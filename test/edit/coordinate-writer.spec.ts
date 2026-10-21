import { describe, expect, it } from "vitest";
import { PT_PER_CM } from "../../packages/core/src/coords/source.js";
import { frameTransform } from "../../packages/core/src/coords/transforms.js";
import { createCoordinateWriter } from "../../packages/core/src/edit/writer/index.js";
import { isCoordinateEditHandle, type CoordinateEditHandle } from "../../packages/core/src/semantic/types.js";
import { FRAMES, evaluate, frameTolerance, pictureSource } from "../pointer-invariant/pointer-fuzz.js";
import { testSiteContext, wp, wv } from "../coords-helpers.js";

/** Every spelling the writer preserves, in one path. */
const SPELLINGS = String.raw`\draw[P] (0,0) -- (1cm,.5) -- (60:1.5) -- (30:8mm) -- ++(1,.5) -- +(10pt,1) -- ([turn]45:1) -- ([turn]-20:6mm) -- (canvas cs:x=1cm,y=2mm) -- (A.north) -- (2,3mm);`;

function bodyHandles(source: string, from: number, to: number): CoordinateEditHandle[] {
  return evaluate(source).handles.filter((handle): handle is CoordinateEditHandle =>
    isCoordinateEditHandle(handle) && handle.sourceRef.sourceSpan.from >= from && handle.sourceRef.sourceSpan.to <= to);
}

describe("coordinate writer", () => {
  it.each(FRAMES.map(frame => [frame.label, frame] as const))("puts every spelling where it was asked, in %s", (_label, frame) => {
    const { source, bodyFrom, bodyTo } = pictureSource(frame, SPELLINGS);
    const handles = bodyHandles(source, bodyFrom, bodyTo);
    expect(handles.map(handle => handle.sourceText)).toEqual([
      "(0,0)", "(1cm,.5)", "(60:1.5)", "(30:8mm)", "(1,.5)", "(10pt,1)", "([turn]45:1)", "([turn]-20:6mm)",
      "(canvas cs:x=1cm,y=2mm)", "(A.north)", "(2,3mm)"
    ]);
    const writer = createCoordinateWriter(source);
    const problems: string[] = [];
    for (const [index, handle] of handles.entries()) {
      const target = wp(handle.world.x + 10.3, handle.world.y - 6.1);
      const written = writer.point({ kind: "coordinate", handle }, target, { precision: "reparameterize" });
      if (written.kind !== "ok") {
        problems.push(`${handle.sourceText}: ${written.reason}`);
        continue;
      }
      const span = handle.sourceRef.sourceSpan;
      const edited = source.slice(0, span.from) + written.fragment + source.slice(span.to);
      const reread = bodyHandles(edited, bodyFrom, bodyTo - (span.to - span.from) + written.fragment.length)[index];
      const error = reread ? Math.hypot(reread.world.x - target.x, reread.world.y - target.y) : Infinity;
      if (error > 1e-3 * frameTolerance(frame)) problems.push(`${handle.sourceText} → ${written.fragment}: off by ${error.toFixed(4)}pt`);
    }
    expect(problems).toEqual([]);
  });

  it("keeps the authored spelling: units per component, polar, canvas, turn options, detached names", () => {
    const { source, bodyFrom, bodyTo } = pictureSource(FRAMES[0]!, SPELLINGS);
    const writer = createCoordinateWriter(source);
    const written = bodyHandles(source, bodyFrom, bodyTo).map(handle => {
      const result = writer.point({ kind: "coordinate", handle }, wp(handle.world.x + 28.45274, handle.world.y));
      return result.kind === "ok" ? result.fragment : result.reason;
    });
    // Drag precision rounds in cm before converting to a component's unit:
    // `10pt` plus 1cm is 1.35cm, written as 38.41122pt.
    expect(written).toEqual([
      "(1,0)", "(2cm,0.5)", "(36.59:2.18)", "(13.29:17.4mm)", "(2,0.5)", "(38.41122pt,1)", "([turn]347.18:1.07)",
      "([turn]276.76:11.1mm)", "(canvas cs:x=2cm,y=2mm)", "(1,1.31)", "(3,3mm)"
    ]);
  });

  it("refuses with a reason", () => {
    const source = String.raw`\begin{tikzpicture}\draw (0,0) -- (1,2,0) -- (2,1);\end{tikzpicture}`;
    const handles = bodyHandles(source, 0, source.length);
    const writer = createCoordinateWriter(source);
    const xyz = handles.find(handle => handle.sourceText === "(1,2,0)");
    const plain = handles.find(handle => handle.sourceText === "(2,1)");
    expect(xyz && writer.point({ kind: "coordinate", handle: xyz }, wp(0, 0))).toEqual({ kind: "unsupported", reason: "xyz coordinates are not rewritten" });
    expect(plain && writer.point({ kind: "coordinate", handle: plain, context: testSiteContext(frameTransform(0, 0, 0, 0, 0, 0)) }, wp(0, 0)))
      .toEqual({ kind: "unsupported", reason: "the coordinate's frame is not invertible" });
  });

  it.each(FRAMES.map(frame => [frame.label, frame] as const))("moves a coordinate by loop steps in its own spelling, in %s", (_label, frame) => {
    const { source, bodyFrom, bodyTo } = pictureSource(frame, String.raw`\draw[P] (0,0) -- (1cm,.5) -- (2,3mm) -- (0.5cm,1.5cm) -- (1,2,0) -- (-1,0);`);
    const handles = bodyHandles(source, bodyFrom, bodyTo);
    const writer = createCoordinateWriter(source);
    // Copy (i, j) = (2, 3): two steps right by 20pt, three down by 14pt.
    const steps = [{ variable: String.raw`\i`, world: wv(20, 0) }, { variable: String.raw`\j`, world: wv(0, -14) }];
    const problems: string[] = [];
    for (const [index, handle] of handles.entries()) {
      const written = writer.translated({ kind: "coordinate", handle }, steps);
      if (written.kind !== "ok") {
        problems.push(`${handle.sourceText}: ${written.reason}`);
        continue;
      }
      const text = written.fragment.replaceAll(String.raw`\i`, "2").replaceAll(String.raw`\j`, "3");
      const span = handle.sourceRef.sourceSpan;
      const edited = source.slice(0, span.from) + text + source.slice(span.to);
      const reread = bodyHandles(edited, bodyFrom, bodyTo - (span.to - span.from) + text.length)[index];
      const error = reread ? Math.hypot(reread.world.x - (handle.world.x + 40), reread.world.y - (handle.world.y - 42)) : Infinity;
      if (error > 1e-3 * frameTolerance(frame)) problems.push(`${handle.sourceText} → ${written.fragment}: off by ${error.toFixed(4)}pt`);
    }
    expect(problems).toEqual([]);
  });

  it("writes the loop terms in each component's unit and keeps the rest of the coordinate", () => {
    const { source, bodyFrom, bodyTo } = pictureSource(FRAMES[0]!, String.raw`\draw[P] (0,0) -- (1cm,.5) -- (2,3mm) -- ( 0.5 , 1.5 ) -- (1,2,0);`);
    const writer = createCoordinateWriter(source);
    const steps = [{ variable: String.raw`\i`, world: wv(PT_PER_CM, 0) }, { variable: String.raw`\j`, world: wv(0, -PT_PER_CM / 2) }];
    const written = bodyHandles(source, bodyFrom, bodyTo).map(handle => {
      const result = writer.translated({ kind: "coordinate", handle }, steps);
      return result.kind === "ok" ? result.fragment : result.reason;
    });
    expect(written).toEqual([String.raw`(\i*1,-\j*0.5)`, String.raw`(1cm+\i*1cm,.5-\j*0.5)`, String.raw`(2+\i*1,3mm-\j*5mm)`,
      String.raw`( 0.5+\i*1 , 1.5-\j*0.5 )`, String.raw`(1+\i*1,2-\j*0.5,0)`]);
  });

  it("refuses to loop a coordinate it cannot read in one frame", () => {
    const source = String.raw`\begin{tikzpicture}\draw (0,0) -- ++(1,2) -- (30:1) -- (A) -- (\x,1);\end{tikzpicture}`;
    const writer = createCoordinateWriter(source);
    const steps = [{ variable: String.raw`\i`, world: wv(10, 0) }];
    const results = bodyHandles(source, 0, source.length).map(handle => writer.translated({ kind: "coordinate", handle }, steps).kind);
    // Names and macros have no handle to read a frame from, and are not looped at all.
    expect(results).toEqual(["ok", "unsupported", "unsupported"]);
  });
});
