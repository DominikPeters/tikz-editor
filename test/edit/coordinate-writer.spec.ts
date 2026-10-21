import { describe, expect, it } from "vitest";
import { frameTransform } from "../../packages/core/src/coords/transforms.js";
import { createCoordinateWriter, legacyCtmSiteContext } from "../../packages/core/src/edit/writer/index.js";
import { isCoordinateEditHandle, type CoordinateEditHandle } from "../../packages/core/src/semantic/types.js";
import { FRAMES, evaluate, frameTolerance, pictureSource } from "../pointer-invariant/pointer-fuzz.js";
import { wp } from "../coords-helpers.js";

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
    expect(plain && writer.point({ kind: "coordinate", handle: plain, context: legacyCtmSiteContext(frameTransform(0, 0, 0, 0, 0, 0)) }, wp(0, 0)))
      .toEqual({ kind: "unsupported", reason: "the coordinate's frame is not invertible" });
  });
});
