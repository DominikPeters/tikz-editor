import { describe, expect, it } from "vitest";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { getInspectorDescriptor } from "../packages/core/src/edit/inspector.js";
import type { InspectorPaintToggle } from "../packages/core/src/edit/inspector.js";
import type { PropertyWriteMutation } from "../packages/core/src/edit/property-registry.js";

function picture(body: string, options = ""): string {
  return `\\begin{tikzpicture}${options}\n  ${body}\n\\end{tikzpicture}`;
}

function statement(source: string): string {
  return source.split("\n").slice(1, -1).join("\n").trim();
}

function toggleFor(source: string, paint: InspectorPaintToggle["paint"]) {
  const rendered = renderTikzToSvg(source);
  const element = rendered.semantic.scene.elements[0];
  if (!element) throw new Error("Expected a scene element");
  const descriptor = getInspectorDescriptor(element, { source, editHandles: rendered.semantic.editHandles });
  const toggle = descriptor.sections.find((section) => section.id === paint)?.toggle;
  if (!toggle) throw new Error(`Expected a ${paint} toggle`);
  return { toggle, editHandles: rendered.semantic.editHandles };
}

function applyMutations(source: string, paint: InspectorPaintToggle["paint"], pick: (toggle: InspectorPaintToggle) => PropertyWriteMutation[]): string {
  const { toggle, editHandles } = toggleFor(source, paint);
  const result = applyEditAction(source, editHandles, {
    kind: "setProperties",
    actions: pick(toggle).map((mutation) => ({
      kind: "setProperty",
      elementId: toggle.write.elementId,
      level: toggle.write.level,
      key: mutation.key,
      value: mutation.value,
      ...(mutation.propertyId === undefined ? {} : { propertyId: mutation.propertyId }),
      ...(mutation.clearKeys === undefined ? {} : { clearKeys: mutation.clearKeys })
    }))
  });
  if (result.kind !== "success" && result.kind !== "partial") {
    throw new Error(`Expected the toggle to apply: ${result.kind}`);
  }
  return result.newSource;
}

// Switch off, then back on with the remembered paint and with the plain flag.
function roundTrip(paint: InspectorPaintToggle["paint"], body: string, options = "") {
  const source = picture(body, options);
  const { toggle } = toggleFor(source, paint);
  const off = applyMutations(source, paint, (current) => current.disable);
  const restored = applyMutations(off, paint, () => toggle.restore.length > 0 ? toggle.restore : toggle.enable);
  const enabled = applyMutations(off, paint, (current) => current.enable);
  return {
    wasEnabled: toggle.enabled,
    offEnabled: toggleFor(off, paint).toggle.enabled,
    off: statement(off),
    restored: statement(restored),
    enabled: statement(enabled)
  };
}

describe("inspector paint toggles", () => {
  it.each([
    [String.raw`\draw[fill=red] (0,0) rectangle (1,1);`, String.raw`\draw (0,0) rectangle (1,1);`, String.raw`\draw[fill=red] (0,0) rectangle (1,1);`, String.raw`\draw[fill] (0,0) rectangle (1,1);`],
    [String.raw`\filldraw[fill=red] (0,0) rectangle (1,1);`, String.raw`\draw (0,0) rectangle (1,1);`, String.raw`\draw[fill=red] (0,0) rectangle (1,1);`, String.raw`\draw[fill] (0,0) rectangle (1,1);`],
    [String.raw`\filldraw[red] (0,0) rectangle (1,1);`, String.raw`\draw[red] (0,0) rectangle (1,1);`, String.raw`\draw[red, fill] (0,0) rectangle (1,1);`, String.raw`\draw[red, fill] (0,0) rectangle (1,1);`],
    [String.raw`\fill[red] (0,0) rectangle (1,1);`, String.raw`\path (0,0) rectangle (1,1);`, String.raw`\fill[red] (0,0) rectangle (1,1);`, String.raw`\fill (0,0) rectangle (1,1);`],
    [String.raw`\fill[red, draw] (0,0) rectangle (1,1);`, String.raw`\draw[red] (0,0) rectangle (1,1);`, String.raw`\draw[red, fill=red] (0,0) rectangle (1,1);`, String.raw`\draw[red, fill] (0,0) rectangle (1,1);`],
    [String.raw`\draw[pattern=dots, pattern color=red] (0,0) rectangle (1,1);`, String.raw`\draw (0,0) rectangle (1,1);`, String.raw`\draw[pattern=dots, pattern color=red] (0,0) rectangle (1,1);`, String.raw`\draw[fill] (0,0) rectangle (1,1);`],
    [String.raw`\draw[left color=red, right color=blue] (0,0) rectangle (1,1);`, String.raw`\draw (0,0) rectangle (1,1);`, String.raw`\draw[left color=red, right color=blue] (0,0) rectangle (1,1);`, String.raw`\draw[fill] (0,0) rectangle (1,1);`],
    [String.raw`\shadedraw[left color=red] (0,0) rectangle (1,1);`, String.raw`\draw (0,0) rectangle (1,1);`, String.raw`\shadedraw[left color=red] (0,0) rectangle (1,1);`, String.raw`\draw[fill] (0,0) rectangle (1,1);`],
    [String.raw`\node[fill=red] (a) {x};`, String.raw`\node (a) {x};`, String.raw`\node[fill=red] (a) {x};`, String.raw`\node[fill] (a) {x};`]
  ])("fill: %s", (body, off, restored, enabled) => {
    expect(roundTrip("fill", body)).toEqual({ wasEnabled: true, offEnabled: false, off, restored, enabled });
  });

  it.each([
    // `\fill[red, draw]` would stroke red (bare `red` is the current colour), so the black stroke is spelled out.
    [String.raw`\draw[fill=red] (0,0) rectangle (1,1);`, String.raw`\fill[red] (0,0) rectangle (1,1);`, String.raw`\fill[red, draw=black] (0,0) rectangle (1,1);`, String.raw`\fill[red, draw] (0,0) rectangle (1,1);`],
    [String.raw`\filldraw[fill=red] (0,0) rectangle (1,1);`, String.raw`\fill[red] (0,0) rectangle (1,1);`, String.raw`\fill[red, draw=black] (0,0) rectangle (1,1);`, String.raw`\fill[red, draw] (0,0) rectangle (1,1);`],
    [String.raw`\draw (0,0) -- (1,1);`, String.raw`\path (0,0) -- (1,1);`, String.raw`\draw (0,0) -- (1,1);`, String.raw`\draw (0,0) -- (1,1);`],
    [String.raw`\draw[red] (0,0) -- (1,1);`, String.raw`\path (0,0) -- (1,1);`, String.raw`\draw[red] (0,0) -- (1,1);`, String.raw`\draw (0,0) -- (1,1);`],
    [String.raw`\draw[draw=blue] (0,0) -- (1,1);`, String.raw`\path (0,0) -- (1,1);`, String.raw`\draw[blue] (0,0) -- (1,1);`, String.raw`\draw (0,0) -- (1,1);`],
    [String.raw`\draw[red, fill] (0,0) rectangle (1,1);`, String.raw`\fill[red] (0,0) rectangle (1,1);`, String.raw`\fill[red, draw=red] (0,0) rectangle (1,1);`, String.raw`\fill[red, draw] (0,0) rectangle (1,1);`],
    [String.raw`\draw[red, fill=blue] (0,0) rectangle (1,1);`, String.raw`\fill[blue] (0,0) rectangle (1,1);`, String.raw`\fill[blue, draw=red] (0,0) rectangle (1,1);`, String.raw`\fill[blue, draw] (0,0) rectangle (1,1);`],
    [String.raw`\shadedraw[left color=red] (0,0) rectangle (1,1);`, String.raw`\shade[left color=red] (0,0) rectangle (1,1);`, String.raw`\shade[left color=red, draw] (0,0) rectangle (1,1);`, String.raw`\shade[left color=red, draw] (0,0) rectangle (1,1);`],
    [String.raw`\node[draw] (a) {x};`, String.raw`\node (a) {x};`, String.raw`\node[draw] (a) {x};`, String.raw`\node[draw] (a) {x};`],
    [String.raw`\node[draw=red, fill=blue] (a) {x};`, String.raw`\node[fill=blue] (a) {x};`, String.raw`\node[fill=blue, draw=red] (a) {x};`, String.raw`\node[fill=blue, draw] (a) {x};`],
    [String.raw`\node[red, draw] (a) {x};`, String.raw`\node[red] (a) {x};`, String.raw`\node[red, draw] (a) {x};`, String.raw`\node[red, draw] (a) {x};`]
  ])("stroke: %s", (body, off, restored, enabled) => {
    expect(roundTrip("stroke", body)).toEqual({ wasEnabled: true, offEnabled: false, off, restored, enabled });
  });

  it("keeps `none` where a style would paint again, and restores the style", () => {
    expect(roundTrip("fill", String.raw`\draw[s] (0,0) rectangle (1,1);`, "[s/.style={fill=red}]")).toEqual({
      wasEnabled: true,
      offEnabled: false,
      off: String.raw`\draw[s, fill=none] (0,0) rectangle (1,1);`,
      restored: String.raw`\draw[s] (0,0) rectangle (1,1);`,
      // A bare `fill` keeps the style's colour, so it folds away too.
      enabled: String.raw`\draw[s] (0,0) rectangle (1,1);`
    });
    expect(roundTrip("stroke", String.raw`\draw[s] (0,0) -- (1,1);`, "[s/.style={draw=red}]")).toMatchObject({
      off: String.raw`\draw[s, draw=none] (0,0) -- (1,1);`,
      restored: String.raw`\draw[s] (0,0) -- (1,1);`
    });
  });

  it("switches inherited shading off with shade=none", () => {
    const source = picture(String.raw`\draw[s] (0,0) rectangle (1,1);`, "[s/.style={left color=red, right color=blue}]");
    // The evaluator gives shading keys a black fill, so `fill=none` stays too.
    expect(statement(applyMutations(source, "fill", (toggle) => toggle.disable))).toBe(String.raw`\draw[s, fill=none, shade=none] (0,0) rectangle (1,1);`);
  });

  it("switches a plain \\shade off", () => {
    expect(roundTrip("fill", String.raw`\shade[ball color=red] (0,0) circle (1);`)).toMatchObject({
      offEnabled: false,
      off: String.raw`\path (0,0) circle (1);`
    });
  });

  it("reports paint that is off", () => {
    expect(toggleFor(picture(String.raw`\draw (0,0) rectangle (1,1);`), "fill").toggle).toMatchObject({ enabled: false, restore: [] });
    expect(toggleFor(picture(String.raw`\fill (0,0) rectangle (1,1);`), "stroke").toggle.enabled).toBe(false);
    expect(toggleFor(picture(String.raw`\node (a) {x};`), "stroke").toggle.enabled).toBe(false);
    expect(toggleFor(picture(String.raw`\draw[fill=none] (0,0) rectangle (1,1);`), "fill").toggle.enabled).toBe(false);
  });

  it("is read-only when the colour depends on a foreach variable", () => {
    const source = picture(String.raw`\foreach \c in {red,blue} {
    \draw[draw=\c, fill=green] (0,0) rectangle (1,1);
  }`);
    expect(toggleFor(source, "stroke").toggle.write.writable).toBe(false);
    expect(toggleFor(source, "fill").toggle.write.writable).toBe(true);
  });

  it("fills a bare `fill` with the current colour, as PGF does", () => {
    const style = (body: string) => renderTikzToSvg(picture(body)).semantic.scene.elements.find((entry) => entry.kind === "Path")?.style;
    expect(style(String.raw`\path[red, fill] (0,0) rectangle (1,1);`)?.fill).toBe(style(String.raw`\fill[red] (0,0) rectangle (1,1);`)?.fill);
  });
});
