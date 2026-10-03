const SVG_NS = "http://www.w3.org/2000/svg";
const RASTER_SCALE = 4; // 288 dpi for SVG coordinates measured in points.
const MAX_RASTER_SIDE = 4096;
const MAX_RASTER_PIXELS = 16_000_000;

/** Adapt the export copy for svg2pdf, retaining vector paint outside effects. */
export async function prepareSvgForPdf(svg: SVGSVGElement): Promise<void> {
  const hasEffects = svg.querySelector("[mask], [filter], style, [style*='mask'], [style*='filter']") !== null
    || svg.matches("[mask], [filter], [style*='mask'], [style*='filter']");
  if (hasEffects) {
    await rasterizeEffects(svg);
  }
  normalizePdfPatterns(svg);
}

/** svg2pdf clips nonzero tile BBoxes without relocating their contents. */
export function normalizePdfPatterns(svg: SVGSVGElement): void {
  for (const pattern of Array.from(svg.querySelectorAll("pattern"))) {
    if (pattern.getAttribute("patternUnits") !== "userSpaceOnUse"
      || pattern.hasAttribute("viewBox")
      || (pattern.getAttribute("patternContentUnits") ?? "userSpaceOnUse") !== "userSpaceOnUse") {
      continue;
    }
    const x = numericCoordinate(pattern.getAttribute("x"));
    const y = numericCoordinate(pattern.getAttribute("y"));
    if (x === null || y === null || (x === 0 && y === 0)) {
      continue;
    }
    pattern.setAttribute("x", "0");
    pattern.setAttribute("y", "0");
    const transform = pattern.getAttribute("patternTransform") ?? "";
    pattern.setAttribute("patternTransform", `${transform} translate(${x} ${y})`.trim());
  }
}

function numericCoordinate(value: string | null): number | null {
  if (value === null) return 0;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function rasterizeEffects(svg: SVGSVGElement): Promise<void> {
  if (!document.body) throw new Error("PDF effects require an active document.");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;pointer-events:none;";
  document.body.appendChild(host);
  host.appendChild(svg);
  try {
    const affected: SVGGraphicsElement[] = [];
    for (const element of [svg, ...Array.from(svg.querySelectorAll<SVGGraphicsElement>("*"))]) {
      if (element.closest("defs, mask, filter, clipPath, pattern, marker, symbol")) continue;
      const style = getComputedStyle(element);
      if ((style.maskImage && style.maskImage !== "none") || (style.filter && style.filter !== "none")) {
        if (element === svg) throw new Error("PDF export cannot preserve a mask or filter on the root SVG.");
        if (!affected.some((ancestor) => ancestor.contains(element))) affected.push(element);
      }
    }
    for (const element of affected) {
      const rootMatrix = svg.getCTM();
      const parentMatrix = (element.parentElement as unknown as SVGGraphicsElement).getCTM();
      if (!rootMatrix || !parentMatrix) throw new Error("Cannot resolve the PDF effect coordinate frame.");
      const inverse = rootMatrix.inverse().multiply(parentMatrix).inverse();
      if (![inverse.a, inverse.b, inverse.c, inverse.d, inverse.e, inverse.f].every(Number.isFinite)) {
        throw new Error("Cannot export an effect in a singular coordinate frame.");
      }
      const isolated = isolateEffect(svg, element);
      const raster = await rasterizeSvg(isolated);
      if (!raster) {
        element.remove();
        continue;
      }
      const image = svg.ownerDocument.createElementNS(SVG_NS, "image");
      image.setAttribute("x", String(raster.x));
      image.setAttribute("y", String(raster.y));
      image.setAttribute("width", String(raster.width));
      image.setAttribute("height", String(raster.height));
      image.setAttribute("preserveAspectRatio", "none");
      image.setAttribute("href", raster.dataUrl);
      image.setAttribute("transform", `matrix(${inverse.a} ${inverse.b} ${inverse.c} ${inverse.d} ${inverse.e} ${inverse.f})`);
      element.replaceWith(image);
    }
  } finally {
    svg.remove();
    host.remove();
  }
}

function isolateEffect(svg: SVGSVGElement, effect: Element): SVGSVGElement {
  const indices: number[] = [];
  let cursor: Element = effect;
  while (cursor !== svg) {
    const parent = cursor.parentElement!;
    indices.unshift(Array.from(parent.children).indexOf(cursor));
    cursor = parent;
  }
  const clone = svg.cloneNode(true) as SVGSVGElement;
  cursor = clone;
  for (const index of indices) {
    const child = cursor.children[index];
    for (const sibling of Array.from(cursor.children)) {
      if (sibling !== child && !["defs", "style"].includes(sibling.localName)) sibling.remove();
    }
    // Ancestor opacity remains vector paint around the replacement image.
    cursor.setAttribute("opacity", "1");
    (cursor as SVGElement).style.setProperty("opacity", "1", "important");
    cursor = child;
  }
  return clone;
}

async function rasterizeSvg(svg: SVGSVGElement): Promise<{
  x: number; y: number; width: number; height: number; dataUrl: string;
} | null> {
  const bounds = svg.viewBox.baseVal;
  if (!(bounds.width > 0 && bounds.height > 0)) throw new Error("PDF effects require a positive viewBox.");
  const scale = Math.min(RASTER_SCALE, MAX_RASTER_SIDE / bounds.width,
    MAX_RASTER_SIDE / bounds.height, Math.sqrt(MAX_RASTER_PIXELS / (bounds.width * bounds.height)));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(bounds.width * scale));
  canvas.height = Math.max(1, Math.ceil(bounds.height * scale));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => { resolve(); };
      image.onerror = () => { reject(new Error("Failed to render PDF mask or filter.")); };
      image.src = url;
    });
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("PDF effects require a 2D canvas context.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3]) {
          left = Math.min(left, x); top = Math.min(top, y);
          right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
      }
    }
    if (right < left) return null;
    const cropped = document.createElement("canvas");
    cropped.width = right - left + 1;
    cropped.height = bottom - top + 1;
    const cropContext = cropped.getContext("2d");
    if (!cropContext) throw new Error("PDF effects require a 2D canvas context.");
    cropContext.drawImage(canvas, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
    return { x: bounds.x + left * bounds.width / canvas.width,
      y: bounds.y + top * bounds.height / canvas.height,
      width: cropped.width * bounds.width / canvas.width,
      height: cropped.height * bounds.height / canvas.height,
      dataUrl: cropped.toDataURL("image/png") };
  } finally {
    URL.revokeObjectURL(url);
  }
}
