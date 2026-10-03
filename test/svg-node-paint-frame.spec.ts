import { describe, expect, it, vi } from "vitest";
import { parseTikz } from "../packages/core/src/parser/index.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { emitSvg } from "../packages/core/src/svg/emit.js";
import * as arrowRenderer from "../packages/core/src/svg/arrows/render.js";
import type { SceneElement, SceneFigure } from "../packages/core/src/semantic/types.js";
import type { SvgRenderModel } from "../packages/core/src/svg/types.js";

type Matrix = [number, number, number, number, number, number];
const identity: Matrix = [1, 0, 0, 1, 0, 0];
const viewBox = { x: -120, y: -100, width: 400, height: 300 };
const multiply = (l: Matrix, r: Matrix): Matrix => [
  l[0] * r[0] + l[2] * r[1], l[1] * r[0] + l[3] * r[1],
  l[0] * r[2] + l[2] * r[3], l[1] * r[2] + l[3] * r[3],
  l[0] * r[4] + l[2] * r[5] + l[4], l[1] * r[4] + l[3] * r[5] + l[5],
];
const translation = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
function rotation(angle: number): Matrix {
  const radians = angle * Math.PI / 180;
  return [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0];
}
function attr(markup: string, name: string): string {
  return new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(markup)?.[1] ?? "";
}
function transform(value: string): Matrix {
  let result = identity;
  for (const match of value.matchAll(/(matrix|translate|rotate|scale)\(([^)]+)\)/g)) {
    const v = match[2].split(/[ ,]+/).map(Number);
    let next: Matrix;
    if (match[1] === "matrix") next = v as Matrix;
    else if (match[1] === "translate") next = translation(v[0], v[1] ?? 0);
    else if (match[1] === "scale") next = [v[0], 0, 0, v[1] ?? v[0], 0, 0];
    else next = multiply(multiply(translation(v[1] ?? 0, v[2] ?? 0), rotation(v[0])), translation(-(v[1] ?? 0), -(v[2] ?? 0)));
    result = multiply(result, next);
  }
  return result;
}
function expectMatrix(actual: Matrix, expected: Matrix): void {
  // Emitted matrices round to five decimals; composing at nonzero positions
  // accumulates up to a few thousandths of a point of serialization error.
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 2));
}
function scene(body: string): SceneFigure {
  const source = String.raw`\usetikzlibrary{patterns,patterns.meta,shadows}\begin{tikzpicture}${body}\end{tikzpicture}`;
  const parsed = parseTikz(source);
  const semantic = evaluateTikzFigure(parsed.figure, source);
  expect([...parsed.diagnostics, ...semantic.diagnostics]).toEqual([]);
  return semantic.scene;
}
function paintedShape(model: SvgRenderModel, element: SceneElement): string {
  const markup = model.parts.find(part => part.elementId === element.id && !part.markup.includes("data-shadow-layer"))?.markup;
  if (!markup) throw new Error("Missing shape markup");
  return markup;
}
function paintDefinition(model: SvgRenderModel, markup: string): string {
  const id = /url\(#([^)]*)\)/.exec(attr(markup, "fill"))?.[1];
  const definition = model.defs.find(def => attr(def, "id") === id);
  if (!definition) throw new Error("Missing referenced paint definition");
  return definition;
}
function nodeElements(figure: SceneFigure): SceneElement[] {
  return figure.elements.filter(element => element.kind !== "Text");
}
function rectangleBounds(markup: string, matrix: Matrix): [number, number, number, number] {
  const coords = [...attr(markup, "d").matchAll(/[ML] ([\d.-]+) ([\d.-]+)/g)].map(m => {
    const x = Number(m[1]); const y = Number(m[2]);
    return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
  });
  expect(coords.length).toBe(4);
  return [Math.min(...coords.map(p => p[0])), Math.min(...coords.map(p => p[1])),
    Math.max(...coords.map(p => p[0])), Math.max(...coords.map(p => p[1]))];
}
function pgfFit(bounds: [number, number, number, number], angle: number): Matrix {
  const width = bounds[2] - bounds[0]; const height = bounds[3] - bounds[1];
  const sin = Math.abs(Math.sin(angle * Math.PI / 180));
  const cos = Math.abs(Math.cos(angle * Math.PI / 180));
  const factor = 0.01992528 / (cos + sin);
  return multiply(multiply(translation((bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2), rotation(-angle)),
    [factor * (width * cos + height * sin), 0, 0, factor * (width * sin + height * cos), 0, 0]);
}

describe("node paint frames", () => {
  it.each(["rectangle", "circle", "ellipse"])("shares affine %s geometry with shadow canvas transforms", shape => {
    const figure = scene(String.raw`\node[${shape},draw,fill=white,rotate=30,xscale=.5,yscale=1.3,
      minimum width=80pt,minimum height=30pt,general shadow={fill=red,shadow scale=1.25,shadow xshift=4pt,shadow yshift=6pt}] at (2,1) {};`);
    const element = nodeElements(figure)[0];
    const model = emitSvg(figure, { viewBox }).model;
    const normal = paintedShape(model, element);
    const shadow = model.parts.find(part => part.elementId === element.id && part.markup.includes("data-shadow-layer"))!.markup;
    const duplicate = shadow.slice(shadow.indexOf("><") + 1);
    for (const name of ["transform", "d", "cx", "cy", "r", "rx", "ry"]) {
      expect(attr(duplicate, name)).toBe(attr(normal, name));
    }
    const outer = transform(attr(shadow, "transform"));
    const geometry = transform(attr(normal, "transform"));
    expect(outer[0]).toBe(1.25);
    expect(outer[3]).toBe(1.25);
    const center = element.kind === "Path"
      ? (() => { const b = rectangleBounds(normal, geometry); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; })()
      : [geometry[0] * Number(attr(normal, "cx")) + geometry[2] * Number(attr(normal, "cy")) + geometry[4],
        geometry[1] * Number(attr(normal, "cx")) + geometry[3] * Number(attr(normal, "cy")) + geometry[5]];
    expect(outer[0] * center[0] + outer[4]).toBeCloseTo(center[0] + 4, 2);
    expect(outer[3] * center[1] + outer[5]).toBeCloseTo(center[1] - 6, 2);
    const withoutShadow = { ...figure, elements: figure.elements.map(e => ({ ...e, style: { ...e.style, shadowLayers: [] } })) };
    expect(emitSvg(figure).viewBox).toEqual(emitSvg(withoutShadow).viewBox);
  });

  it("fits a rotated and sheared axis shading once to picture-space bounds", () => {
    const figure = scene(String.raw`\node[shade,left color=red,right color=blue,shading angle=35,
      rotate=30,xscale=-.5,yscale=1.3,xslant=.3,minimum width=80pt,minimum height=30pt] at (2,1) {};`);
    const element = nodeElements(figure)[0];
    const model = emitSvg(figure, { viewBox }).model;
    const shape = paintedShape(model, element);
    const geometry = transform(attr(shape, "transform"));
    const gradient = paintDefinition(model, shape);
    expectMatrix(multiply(geometry, transform(attr(gradient, "gradientTransform"))), pgfFit(rectangleBounds(shape, geometry), element.style.shadingAngle));
  });

  it.each([
    ["circle", "inner color=white,outer color=black", 0],
    ["ellipse", "ball color=red", 17],
  ] as const)("fits %s radial paint to PGF cubic bounds and preserves intrinsic rotation", (shape, paint, intrinsicRotation) => {
    const figure = scene(String.raw`\node[${shape},${paint},rotate=45,xscale=.6,yscale=1.3,
      minimum width=80pt,minimum height=30pt] at (2,1) {};`);
    const element = nodeElements(figure)[0];
    if (element.kind === "Ellipse") element.rotation = intrinsicRotation;
    const model = emitSvg(figure, { viewBox }).model;
    const markup = paintedShape(model, element);
    const geometry = transform(attr(markup, "transform"));
    const radiusX = Number(attr(markup, "rx") || attr(markup, "r"));
    const radiusY = Number(attr(markup, "ry") || attr(markup, "r"));
    const cx = geometry[0] * Number(attr(markup, "cx")) + geometry[2] * Number(attr(markup, "cy")) + geometry[4];
    const cy = geometry[1] * Number(attr(markup, "cx")) + geometry[3] * Number(attr(markup, "cy")) + geometry[5];
    // PGF records these transformed cubic control points in pgf@pathmin/max.
    const points: number[][] = [];
    for (const [u, v] of [[1, 0], [1, .55228475], [.55228475, 1], [0, 1], [-.55228475, 1], [-1, .55228475]]) {
      const dx = geometry[0] * radiusX * u + geometry[2] * radiusY * v;
      const dy = geometry[1] * radiusX * u + geometry[3] * radiusY * v;
      points.push([cx + dx, cy + dy], [cx - dx, cy - dy]);
    }
    const bounds: [number, number, number, number] = [Math.min(...points.map(p => p[0])), Math.min(...points.map(p => p[1])),
      Math.max(...points.map(p => p[0])), Math.max(...points.map(p => p[1]))];
    const gradient = paintDefinition(model, markup);
    expect(gradient).toContain("<radialGradient");
    expectMatrix(multiply(geometry, transform(attr(gradient, "gradientTransform"))), pgfFit(bounds, element.style.shadingAngle));
  });

  it("keeps pattern angle, shifts and tile spacing fixed across distinct node frames", () => {
    const pattern = "pattern={Lines[angle=30,distance=5pt,xshift=3pt,yshift=4pt]}";
    const figure = scene(String.raw`\node[${pattern},rotate=45,minimum width=80pt] at (1,0) {};
      \node[${pattern},xscale=.5,yscale=2,minimum width=80pt] at (2,1) {};
      \node[${pattern},cm={1,.5,.2,1,(4pt,5pt)},minimum width=80pt] at (3,2) {};
      \begin{scope}[rotate=20,xshift=6pt]\node[${pattern},rotate=-10,minimum width=80pt] at (1,2) {};\end{scope}`);
    const model = emitSvg(figure, { viewBox }).model;
    const base = multiply(translation(3, 100 + 2.5 - 4), rotation(-30));
    expect(model.defs.filter(def => def.startsWith("<pattern")).length).toBe(4);
    for (const element of nodeElements(figure)) {
      const markup = paintedShape(model, element);
      const definition = paintDefinition(model, markup);
      expect(attr(definition, "width")).toBe("5");
      expect(attr(definition, "height")).toBe("5");
      expectMatrix(multiply(transform(attr(markup, "transform")), transform(attr(definition, "patternTransform"))), base);
    }
    const reversed = emitSvg({ ...figure, elements: [...figure.elements].reverse() }, { viewBox }).model;
    expect(new Set(reversed.defs)).toEqual(new Set(model.defs));
  });

  it("deduplicates identity frames and registers all defs during fresh/reused emission", () => {
    const figure = scene(String.raw`\node[pattern=horizontal lines,minimum width=80pt] {};
      \node[pattern=horizontal lines,cm={1,0,0,1,(0,0)},minimum width=80pt] {};
      \node[pattern=horizontal lines,rotate=30,minimum width=80pt] at (2,0) {};
      \node[ellipse,ball color=red,rotate=25,xscale=.6,circular drop shadow,minimum width=50pt] at (0,2) {};
      \node[shade,left color=red,right color=blue,xscale=.5,double copy shadow,minimum width=80pt] at (2,2) {};`);
    const previous = emitSvg(figure, { viewBox }).model;
    expect(previous.defs.filter(def => def.startsWith("<pattern")).length).toBe(2);
    expect(emitSvg(figure, { viewBox, reuse: { previousModel: previous, affectedSourceIds: [] } }).model).toEqual(previous);
    const fuzzyElement = nodeElements(figure).find(e => e.kind === "Ellipse")!;
    const fuzzyShadow = previous.parts.find(part => part.elementId === fuzzyElement.id && part.markup.includes("data-shadow-layer"))!.markup;
    expect(fuzzyShadow).toContain('mask="url(#tikz-shadow-mask-circle-fuzzy-15)"');
    expect(attr(fuzzyShadow.slice(fuzzyShadow.indexOf("><") + 1), "transform"))
      .toBe(attr(paintedShape(previous, fuzzyElement), "transform"));
    const duplicate = { ...fuzzyElement, id: `${fuzzyElement.id}:duplicate`, sourceRef: { ...fuzzyElement.sourceRef, sourceId: "duplicate" } };
    expect(emitSvg({ ...figure, elements: [...figure.elements, duplicate] }, { viewBox }).model.defs).toEqual(previous.defs);
    const target = nodeElements(figure)[0];
    const changed = { ...figure, elements: figure.elements.map(e => e.id === target.id ? { ...e, style: { ...e.style, patternColor: "red" } } : e) };
    const fresh = emitSvg(changed, { viewBox }).model;
    const reused = emitSvg(changed, { viewBox, reuse: { previousModel: previous, affectedSourceIds: [target.sourceRef.sourceId] } }).model;
    expect(reused).toEqual(fresh);
    expect(reused.parts.filter(part => part.sourceId !== target.sourceRef.sourceId))
      .toEqual(previous.parts.filter(part => part.sourceId !== target.sourceRef.sourceId));
    const ids = new Set(reused.defs.flatMap(def => [...def.matchAll(/id="([^"]+)"/g)].map(m => m[1])));
    for (const part of reused.parts) {
      for (const ref of part.markup.matchAll(/url\(#([^)]*)\)/g)) expect(ids.has(ref[1])).toBe(true);
    }
    const movedViewBox = { ...viewBox, y: 25 };
    expect(emitSvg(changed, { viewBox: movedViewBox, reuse: { previousModel: previous, affectedSourceIds: [] } }).model)
      .toEqual(emitSvg(changed, { viewBox: movedViewBox }).model);
  });

  it("registers reused pattern frames without preparing an unchanged long path", () => {
    const coordinates = Array.from({ length: 256 }, (_, index) => `(${index / 100},${index % 2})`).join(" -- ");
    const figure = scene(String.raw`\draw[pattern=horizontal lines,->] ${coordinates};
      \node[ellipse,pattern={Lines[angle=30]},rotate=25,xscale=.6,minimum width=50pt] at (0,2) {};`);
    const ellipse = figure.elements.find(element => element.kind === "Ellipse");
    if (ellipse?.kind !== "Ellipse") throw new Error("Expected ellipse");
    ellipse.rotation = 17;
    const prepare = vi.spyOn(arrowRenderer, "renderPathWithArrows");
    try {
      const previous = emitSvg(figure, { viewBox }).model;
      expect(prepare).toHaveBeenCalledTimes(1);
      prepare.mockClear();
      const changed = { ...figure, elements: figure.elements.map(element => element.id === ellipse.id
        ? { ...element, style: { ...element.style, patternColor: "red" } } : element) };
      const fresh = emitSvg(changed, { viewBox }).model;
      expect(prepare).toHaveBeenCalledTimes(1);
      prepare.mockClear();
      const affectedSourceIds = [ellipse.sourceRef.sourceId];
      expect(emitSvg(changed, { viewBox, reuse: { previousModel: previous, affectedSourceIds } }).model).toEqual(fresh);
      expect(prepare).not.toHaveBeenCalled();
      const sourceId = figure.elements.find(element => element.kind === "Path")!.sourceRef.sourceId;
      expect(emitSvg(changed, { viewBox, reuse: { previousModel: previous, affectedSourceIds: [...affectedSourceIds, sourceId] } }).model).toEqual(fresh);
      expect(prepare).toHaveBeenCalledTimes(1);
    } finally {
      prepare.mockRestore();
    }
  });
});
