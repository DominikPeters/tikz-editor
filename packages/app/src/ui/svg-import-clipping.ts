import { parseTikz } from "@tikz-editor/core/parser";
import { evaluateTikzFigure } from "@tikz-editor/core/semantic";
import type { ScenePathCommand } from "@tikz-editor/core/semantic";

type Converter = (element: Element, options: { standalone: false; precision?: number }) => string;
type Matrix = [number, number, number, number, number, number];
const SVG_NS = "http://www.w3.org/2000/svg";
const NUMBER = "[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?";
const UNUSED = new Set(["defs", "clipPath", "mask", "marker", "symbol", "style", "metadata", "title", "desc"]);
const EMPTY_CLIP = "\\clip[draw=none,fill=none] (0,0) rectangle (0,0);";

function unsupported(reason: string): never {
  throw new Error(`Unsupported SVG clipping: ${reason}. The SVG was not imported.`);
}

function property(element: Element, key: string): string | null {
  let value = element.getAttribute(key);
  for (const declaration of (element.getAttribute("style") ?? "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon >= 0 && declaration.slice(0, colon).trim().toLowerCase() === key) {
      value = declaration.slice(colon + 1).trim().replace(/\s*!important\s*$/iu, "");
    }
  }
  return value?.trim() ?? null;
}

function tag(element: Element): string {
  return element.localName;
}

function inherited(element: Element, key: string, fallback: string): string {
  for (let current: Element | null = element; current; current = current.parentElement) {
    const value = property(current, key);
    if (value && value !== "inherit") return value;
  }
  return fallback;
}

function activeClip(element: Element): string | null {
  const value = property(element, "clip-path");
  return value && value !== "none" ? value : null;
}

function multiply(left: Matrix, right: Matrix): Matrix {
  const [a, b, c, d, e, f] = left, [g, h, i, j, k, l] = right;
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}

function prepareTransform(element: Element): void {
  if (/\btransform\s*:/iu.test(element.getAttribute("style") ?? "")) unsupported("CSS transforms on clipped content are not supported");
  const transform = (element.getAttribute("transform") ?? "").trim();
  let cursor = 0;
  let matrix: Matrix = [1, 0, 0, 1, 0, 0];
  const operation = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)\s*,?\s*/gy;
  while (cursor < transform.length) {
    operation.lastIndex = cursor;
    const match = operation.exec(transform);
    if (!match) unsupported("the clipping transform cannot be converted faithfully");
    const values = match[2].trim().split(/[\s,]+/u);
    if (!values.every(value => new RegExp(`^${NUMBER}$`, "u").test(value) && Number.isFinite(Number(value)))) {
      unsupported("the clipping transform contains unsupported values");
    }
    const counts = match[1] === "matrix" ? [6] : match[1] === "rotate" ? [1, 3]
      : match[1] === "translate" || match[1] === "scale" ? [1, 2] : [1];
    if (!counts.includes(values.length)) unsupported("the clipping transform has unsupported arguments");
    const numbers = values.map(Number);
    let next: Matrix;
    if (match[1] === "matrix") next = numbers as Matrix;
    else if (match[1] === "translate") next = [1, 0, 0, 1, numbers[0], numbers[1] ?? 0];
    else if (match[1] === "scale") next = [numbers[0], 0, 0, numbers[1] ?? numbers[0], 0, 0];
    else {
      const angle = numbers[0] * Math.PI / 180;
      if (match[1] === "skewX") next = [1, 0, Math.tan(angle), 1, 0, 0];
      else if (match[1] === "skewY") next = [1, Math.tan(angle), 0, 1, 0, 0];
      else {
        const cosine = Math.cos(angle), sine = Math.sin(angle);
        const x = numbers[1] ?? 0, y = numbers[2] ?? 0;
        next = [cosine, sine, -sine, cosine, x - cosine * x + sine * y, y - sine * x - cosine * y];
      }
    }
    matrix = multiply(matrix, next);
    if (!matrix.every(Number.isFinite)) unsupported("the clipping transform exceeds finite coordinates");
    cursor = operation.lastIndex;
  }
  // The dependency's skew shorthand emits unsupported TikZ xslant/yslant.
  // Its matrix route preserves the same ordered SVG affine frame via cm.
  if (transform) element.setAttribute("transform", `matrix(${matrix.join(" ")})`);
}

function assertClipPathData(data: string): void {
  const tokens: string[] = [];
  const token = new RegExp(`[a-zA-Z]|${NUMBER}`, "gy");
  let cursor = 0;
  while (cursor < data.length) {
    const separator = /^[\s,]+/u.exec(data.slice(cursor));
    if (separator) { cursor += separator[0].length; continue; }
    token.lastIndex = cursor;
    const match = token.exec(data);
    if (!match) unsupported("the clip path contains malformed path data");
    tokens.push(match[0]); cursor = token.lastIndex;
  }
  if (tokens.length === 0) return;
  if (tokens[0].toUpperCase() !== "M") unsupported("the clip path must start with a moveto command");
  const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0 };
  for (let i = 0; i < tokens.length;) {
    const command = tokens[i++].toUpperCase();
    if (command === "A") unsupported("elliptical arc clip paths are not supported");
    const count = arity[command];
    if (count == null) unsupported("the clip path contains an unsupported command");
    const start = i;
    while (i < tokens.length && !/^[a-zA-Z]$/u.test(tokens[i])) i++;
    const length = i - start;
    if (count === 0 ? length !== 0 : length === 0 || length % count !== 0) unsupported("the clip path contains incomplete coordinates");
  }
}

function numberAttribute(element: Element, name: string, fallback = 0): number {
  const raw = element.getAttribute(name);
  if (raw == null) return fallback;
  if (!new RegExp(`^${NUMBER}$`, "u").test(raw.trim()) || !Number.isFinite(Number(raw))) {
    unsupported(`clip rectangle ${name} must be a finite user-space number`);
  }
  return Number(raw);
}

function point(point: { x: number; y: number }): string {
  return `(${Number(point.x.toFixed(8))}pt,${Number(point.y.toFixed(8))}pt)`;
}

function pathSource(commands: readonly ScenePathCommand[]): string {
  return commands.map(command => {
    if (command.kind === "M") return point(command.to);
    if (command.kind === "L") return `-- ${point(command.to)}`;
    if (command.kind === "C") return `.. controls ${point(command.c1)} and ${point(command.c2)} .. ${point(command.to)}`;
    if (command.kind === "Z") return "-- cycle";
    return unsupported("the clip geometry could not be converted to an exact path");
  }).join(" ");
}

function clipSource(svg: Element, definition: Element, convert: Converter): string {
  const units = definition.getAttribute("clipPathUnits") ?? "userSpaceOnUse";
  if (units !== "userSpaceOnUse") unsupported(`clipPathUnits=${units} is not supported`);
  if (activeClip(definition)) unsupported("a clipPath that references another clip is not supported");
  prepareTransform(definition);
  const children = Array.from(definition.children).filter(child => !["title", "desc", "metadata"].includes(tag(child)));
  if (children.length > 1) unsupported("clip paths with multiple shapes require a union that is not supported");
  const shape = children[0];
  if (!shape) return EMPTY_CLIP;
  if (activeClip(shape) || shape.children.length > 0) unsupported("nested clip geometry is not supported");
  if (tag(shape) !== "rect" && tag(shape) !== "path") unsupported(`clip geometry <${tag(shape)}> is not supported`);
  prepareTransform(shape);
  const rule = inherited(shape, "clip-rule", "nonzero");
  if (rule !== "nonzero" && rule !== "evenodd") unsupported(`clip-rule=${rule} is not supported`);
  if (tag(shape) === "rect") {
    numberAttribute(shape, "x"); numberAttribute(shape, "y");
    if (numberAttribute(shape, "width") < 0 || numberAttribute(shape, "height") < 0) unsupported("negative clip rectangle dimensions are not supported");
    if (numberAttribute(shape, "rx") !== 0 || numberAttribute(shape, "ry") !== 0) unsupported("rounded rectangle clips are not supported");
  } else assertClipPathData(shape.getAttribute("d") ?? "");

  // Resolve only the clip definition's transforms. Ancestor/reference transforms
  // are applied once by the scope in which the resulting clip is inserted.
  const isolated = svg.cloneNode(false) as Element;
  isolated.removeAttribute("style"); isolated.removeAttribute("class");
  const group = svg.ownerDocument.createElementNS(SVG_NS, "g");
  group.setAttribute("transform", definition.getAttribute("transform") ?? "");
  const copy = shape.cloneNode(false) as Element;
  copy.removeAttribute("class"); copy.removeAttribute("style");
  copy.setAttribute("fill", "black"); copy.setAttribute("stroke", "none");
  copy.setAttribute("fill-rule", rule);
  copy.setAttribute("visibility", inherited(shape, "visibility", "visible"));
  copy.setAttribute("display", property(shape, "display") ?? "inline");
  group.appendChild(copy); isolated.appendChild(group);
  const source = convert(isolated, { standalone: false, precision: 8 });
  const parsed = parseTikz(source);
  const semantic = evaluateTikzFigure(parsed.figure, source);
  if ([...parsed.diagnostics, ...semantic.diagnostics].some(diagnostic => diagnostic.severity === "error")) {
    unsupported("the clip geometry could not be evaluated faithfully");
  }
  if (semantic.scene.elements.some(element => element.kind !== "Path" || element.transform)) unsupported("the clip geometry could not be flattened faithfully");
  const commands = semantic.scene.elements.flatMap(element => element.kind === "Path" ? element.commands : []);
  if (!commands.some(command => command.kind === "L" || command.kind === "C")) return EMPTY_CLIP;
  return `\\clip[draw=none,fill=none,${rule === "evenodd" ? "even odd rule" : "nonzero rule"}] ${pathSource(commands)};`;
}

function referencedUseTarget(element: Element): Element | null {
  const href = element.getAttribute("href") ?? element.getAttributeNS("http://www.w3.org/1999/xlink", "href");
  return href?.startsWith("#") ? element.ownerDocument.getElementById(href.slice(1)) : null;
}

function referencesClippedContent(element: Element, visited = new Set<Element>()): boolean {
  if (visited.has(element)) return false;
  visited.add(element);
  return [element, ...Array.from(element.querySelectorAll("*"))].some(child => {
    if (activeClip(child)) return true;
    const target = tag(child) === "use" ? referencedUseTarget(child) : null;
    return target ? referencesClippedContent(target, visited) : false;
  });
}

/** Keep the dependency's ordinary conversion; add only bounded clipping support. */
export function convertSvgWithClipping(svg: Element, convert: Converter): string {
  const all = [svg, ...Array.from(svg.querySelectorAll("*"))];
  for (const style of Array.from(svg.querySelectorAll("style"))) {
    if (/\bclip(?:-path|-rule)?\s*:/iu.test(style.textContent ?? "")) unsupported("stylesheet clipping is not supported");
  }
  if (all.some(element => {
    const value = property(element, "clip");
    return value && value !== "auto";
  })) unsupported("legacy CSS clip regions are not supported");
  const referenced = all.filter(element => activeClip(element));
  if (referenced.length === 0) return convert(svg, { standalone: false });
  if (Array.from(svg.querySelectorAll("style")).some(style => /\btransform\s*:/iu.test(style.textContent ?? ""))) {
    unsupported("stylesheet transforms on clipped content are not supported");
  }
  const viewBox = svg.getAttribute("viewBox");
  if (viewBox) {
    const values = viewBox.trim().split(/[\s,]+/u).map(Number);
    if (values.length !== 4 || !values.every(Number.isFinite) || values[2] <= 0 || values[3] <= 0) unsupported("the clipped SVG has an invalid viewBox");
  }
  for (const use of Array.from(svg.querySelectorAll("use"))) {
    const target = referencedUseTarget(use);
    if (activeClip(use) || (target && referencesClippedContent(target))) {
      unsupported("clipping on use elements or their referenced content is not supported");
    }
  }
  let prefix = "TIKZSVGCLIP";
  const original = svg.outerHTML;
  while (original.includes(prefix)) prefix += "X";
  const markers = new Map<string, string>();
  let serial = 0;
  for (const element of referenced) {
    let inert = false;
    for (let parent = element.parentElement; parent && parent !== svg; parent = parent.parentElement) {
      if (UNUSED.has(tag(parent))) inert = true;
      if (tag(parent) === "svg") unsupported("clipping within nested SVG viewports is not supported");
    }
    if (inert || UNUSED.has(tag(element))) continue;
    for (const child of [element, ...Array.from(element.querySelectorAll("*"))]) {
      let unused = UNUSED.has(tag(child));
      for (let parent = child.parentElement; parent && parent !== element; parent = parent.parentElement) {
        if (UNUSED.has(tag(parent))) unused = true;
      }
      if (unused) continue;
      if (tag(child) === "use") unsupported("use elements within clipped content are not supported");
      if (tag(child) === "svg" && child !== svg) unsupported("clipping within nested SVG viewports is not supported");
      prepareTransform(child);
    }
    for (let current: Element | null = element; current; current = current === svg ? null : current.parentElement) prepareTransform(current);
    if (svg.getAttribute("transform")) unsupported("a transformed root SVG clip is not supported");
    const reference = activeClip(element)!;
    const match = /^url\(\s*['"]?#([^\s'"()]+)['"]?\s*\)$/u.exec(reference);
    if (!match) unsupported(`clip-path=${reference} is not a supported local clip reference`);
    const definition = svg.ownerDocument.getElementById(match[1]);
    if (!definition || tag(definition) !== "clipPath") unsupported(`clip reference #${match[1]} does not identify a clipPath`);
    const clip = clipSource(svg, definition, convert);
    let container = element;
    if (element !== svg && tag(element) !== "g") {
      container = svg.ownerDocument.createElementNS(SVG_NS, "g");
      const transform = element.getAttribute("transform");
      if (transform) { container.setAttribute("transform", transform); element.removeAttribute("transform"); }
      element.parentNode!.replaceChild(container, element); container.appendChild(element);
    }
    const start = `${prefix}START${serial}`, end = `${prefix}END${serial++}`;
    const marker = (text: string) => {
      const node = svg.ownerDocument.createElementNS(SVG_NS, "text");
      node.textContent = text;
      node.setAttribute("style", "fill:black;stroke:none;visibility:visible;display:inline");
      return node;
    };
    container.insertBefore(marker(start), container.firstChild); container.appendChild(marker(end));
    markers.set(start, `\\begin{scope}\n${clip}`); markers.set(end, "\\end{scope}");
  }
  const converted = convert(svg, { standalone: false, precision: 8 });
  const emitted = new Set<string>();
  const result = converted.split("\n").map(line => {
    for (const [marker, replacement] of markers) {
      if (line.includes(marker)) {
        if (!/^\s*\\node\b/u.test(line)) unsupported("the clip scope could not be placed safely");
        if (emitted.has(marker)) unsupported("a clip scope was emitted more than once");
        emitted.add(marker);
        return replacement;
      }
    }
    return line;
  }).join("\n");
  for (let index = 0; index < serial; index++) {
    if (emitted.has(`${prefix}START${index}`) !== emitted.has(`${prefix}END${index}`)) unsupported("the clip scope could not be balanced safely");
  }
  return result;
}
