import { describe, expect, it } from "vitest";
import { applyEditAction } from "../packages/core/src/edit/actions.js";
import { getInspectorDescriptor, type InspectorPaintToggle } from "../packages/core/src/edit/inspector.js";
import type { PropertyWriteMutation } from "../packages/core/src/edit/property-registry.js";
import { renderTikzToSvg } from "../packages/core/src/render/index.js";
import { normalizeColor } from "../packages/core/src/semantic/style/colors.js";
import type { SceneElement } from "../packages/core/src/semantic/types.js";

// Random paths and nodes; each case switches one paint off, then back on with
// the remembered paint and with the plain `draw` / `fill`.
const SEED = Number(process.env.PAINT_TOGGLE_FUZZ_SEED ?? 0x5eed);
const CASES = Number(process.env.PAINT_TOGGLE_FUZZ_CASES ?? 300);

const PATH_COMMANDS = ["\\path", "\\draw", "\\fill", "\\filldraw", "\\shade", "\\shadedraw"] as const;
// Each list sets one paint. A case takes at most one option from each, since
// an option a later one overrides is dead and cannot be restored in place.
const COLORS = ["red", "blue!50", "color=orange"] as const;
const STROKES = ["draw", "draw=blue", "draw=none", "t"] as const;
const FILLS = ["fill", "fill=green", "fill=none", "pattern=dots", "s"] as const;
const SHADINGS = ["left color=red", "ball color=red", "shade"] as const;
const EXTRAS = ["thick", "dashed", "fill opacity=0.5", "pattern color=red", "right color=blue", "circle"] as const;
const PREAMBLE = "[s/.style={fill=yellow}, t/.style={draw=purple}]";

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(items: readonly T[], rng: () => number): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error("Empty pick");
  return item;
}

function randomStatement(rng: () => number): string {
  const node = rng() < 0.25;
  const command = node ? "\\node" : pick(PATH_COMMANDS, rng);
  const shades = command.includes("shade");
  // The editor lets a pattern switch shading off, which PGF does not, so a
  // shading command never gets a pattern or a solid fill.
  const groups: ReadonlyArray<readonly string[]> = [COLORS, STROKES, shades ? SHADINGS : rng() < 0.5 ? FILLS : SHADINGS, EXTRAS];
  // A colour comes first: after `draw=blue` it would override it.
  const [colors = [], ...rest] = groups.map((group) => rng() < 0.5 ? [pick(group, rng)] : []);
  const options = [...colors, ...rest.flat().sort(() => rng() - 0.5)];
  const list = options.length > 0 ? `[${options.join(", ")}]` : "";
  return node ? `\\node${list} (a) at (0,0) {x};` : `${command}${list} (0,0) rectangle (1,1);`;
}

function picture(statement: string): string {
  // A second element must come through every toggle unchanged.
  return `\\begin{tikzpicture}${PREAMBLE}\n  ${statement}\n  \\draw[red, fill=blue] (2,0) rectangle (3,1);\n\\end{tikzpicture}`;
}

type Snapshot = {
  source: string;
  element: SceneElement;
  bystander: string;
  diagnostics: number;
  toggles: Partial<Record<InspectorPaintToggle["paint"], InspectorPaintToggle>>;
  editHandles: ReturnType<typeof renderTikzToSvg>["semantic"]["editHandles"];
};

function snapshot(source: string): Snapshot {
  const rendered = renderTikzToSvg(source);
  const [element, ...rest] = rendered.semantic.scene.elements;
  if (!element) throw new Error(`No element in\n${source}`);
  const descriptor = getInspectorDescriptor(element, { source, editHandles: rendered.semantic.editHandles });
  const toggles: Snapshot["toggles"] = {};
  for (const section of descriptor.sections) {
    if (section.toggle) toggles[section.toggle.paint] = section.toggle;
  }
  return {
    source,
    element,
    bystander: JSON.stringify(rest.at(-1)?.style ?? null),
    diagnostics: rendered.semantic.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length,
    toggles,
    editHandles: rendered.semantic.editHandles
  };
}

function apply(state: Snapshot, toggle: InspectorPaintToggle, mutations: readonly PropertyWriteMutation[]): string {
  const result = applyEditAction(state.source, state.editHandles, {
    kind: "setProperties",
    actions: mutations.map((mutation) => ({
      kind: "setProperty",
      elementId: toggle.write.elementId,
      level: toggle.write.level,
      key: mutation.key,
      value: mutation.value,
      ...(mutation.propertyId === undefined ? {} : { propertyId: mutation.propertyId }),
      ...(mutation.clearKeys === undefined ? {} : { clearKeys: mutation.clearKeys })
    }))
  });
  if (result.kind === "unsupported" && result.reason === "setProperty would not change the source.") return state.source;
  if (result.kind !== "success" && result.kind !== "partial") {
    throw new Error(`Toggle failed (${result.kind}) on\n${state.source}`);
  }
  return result.newSource;
}

// What a paint looks like on the page: colours, pattern and shading.
function paintOf(element: SceneElement, paint: InspectorPaintToggle["paint"]): string {
  const style = element.style;
  const color = (value: string | null | undefined) => value == null || value === "none" ? null : normalizeColor(value);
  if (paint === "stroke") {
    const drawn = element.kind === "Text" ? style.drawExplicit === true : true;
    return JSON.stringify(drawn ? color(style.stroke) : null);
  }
  return JSON.stringify({
    fill: style.fillPattern != null || style.shadeEnabled ? null : color(style.fill),
    pattern: style.fillPattern == null ? null : { ...style.fillPattern, color: color(style.patternColor) },
    shading: style.shadeEnabled
      ? [style.shading, ...[style.axisTopColor, style.axisBottomColor, style.radialInnerColor, style.radialOuterColor, style.ballColor].map(color)]
      : null
  });
}

function isPainted(element: SceneElement, paint: InspectorPaintToggle["paint"]): boolean {
  const value = paintOf(element, paint);
  return paint === "stroke" ? value !== "null" : value !== JSON.stringify({ fill: null, pattern: null, shading: null });
}

describe("paint toggle fuzz", () => {
  it(`keeps its contract on ${CASES} random elements (seed ${SEED})`, () => {
    const rng = makeRng(SEED);
    let checked = 0;
    for (let index = 0; index < CASES; index += 1) {
      const original = snapshot(picture(randomStatement(rng)));
      if (original.diagnostics > 0) continue;
      for (const paint of ["stroke", "fill"] as const) {
        const toggle = original.toggles[paint];
        if (!toggle?.enabled || !toggle.write.writable) continue;
        const other = paint === "stroke" ? "fill" : "stroke";
        const context = `${paint} on\n${original.source}`;
        checked += 1;

        const off = snapshot(apply(original, toggle, toggle.disable));
        expect(off.diagnostics, context).toBe(0);
        expect(off.toggles[paint]?.enabled, `${context}\noff:\n${off.source}`).toBe(false);
        expect(isPainted(off.element, paint), `${context}\noff:\n${off.source}`).toBe(false);
        expect(paintOf(off.element, other), `${context}\noff:\n${off.source}`).toBe(paintOf(original.element, other));
        expect(off.bystander, context).toBe(original.bystander);

        const offToggle = off.toggles[paint];
        if (!offToggle) throw new Error(`No ${paint} toggle after switching off\n${off.source}`);
        const restored = snapshot(apply(off, offToggle, toggle.restore.length > 0 ? toggle.restore : offToggle.enable));
        expect(paintOf(restored.element, paint), `${context}\nrestored:\n${restored.source}`).toBe(paintOf(original.element, paint));
        expect(paintOf(restored.element, other), `${context}\nrestored:\n${restored.source}`).toBe(paintOf(original.element, other));

        const enabled = snapshot(apply(off, offToggle, offToggle.enable));
        expect(enabled.toggles[paint]?.enabled, `${context}\nenabled:\n${enabled.source}`).toBe(true);
        expect(paintOf(enabled.element, other), `${context}\nenabled:\n${enabled.source}`).toBe(paintOf(original.element, other));
      }
    }
    expect(checked).toBeGreaterThan(CASES / 3);
  }, 15_000 + CASES * 20);
});
