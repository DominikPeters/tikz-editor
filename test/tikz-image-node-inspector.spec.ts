import { describe, expect, it } from "vitest";
import { beamerImageCropDrag, beamerImageCropPatches, imageCropTarget, includegraphicsSections, replaceIncludegraphicsFile, setIncludegraphicsOption } from "../packages/core/src/beamer/index.js";
import { imageNodeCommandSpan, imageNodeCropPlacement } from "../packages/core/src/edit/graphics-node-size.js";
import { evaluateTikzFigure } from "../packages/core/src/semantic/evaluate.js";
import { createTexNodeTextEngine } from "../packages/core/src/text/tex-node-text-engine.js";
import { POINTER_TOLERANCE_PT } from "../packages/core/src/edit/format.js";
import type { DocumentGraphicsResolver } from "../packages/core/src/graphics/types.js";
import { parseTikz } from "../packages/core/src/parser/index.js";

const picture = (body: string) => String.raw`\begin{tikzpicture}
  \draw (0,0) -- (1,1);
  ${body}
\end{tikzpicture}`;

function spanOf(source: string, elementId = "path:1") {
  return imageNodeCommandSpan(source, parseTikz(source).figure.body, elementId);
}

function apply(source: string, result: ReturnType<typeof setIncludegraphicsOption>): string {
  if (result.kind !== "success") throw new Error(result.kind === "unsupported" ? result.reason : "error");
  return result.newSource;
}

describe("image nodes in the TikZ inspector", () => {
  it("finds the command of a node that holds only an image", () => {
    const source = picture(String.raw`\node[inner sep=0pt] at (2,1) { \includegraphics[width=3cm]{photo.png} };`);
    const span = spanOf(source);
    expect(span && source.slice(span.from, span.to)).toBe(String.raw`\includegraphics[width=3cm]{photo.png}`);
    expect(spanOf(picture(String.raw`\node at (2,1) {A \includegraphics{photo.png}};`))).toBeNull();
    expect(spanOf(source, "path:0")).toBeNull();
  });

  it("shows File and Size with centimetre lengths and no crop", () => {
    const source = picture(String.raw`\node[inner sep=0pt] at (2,1) {\includegraphics[width=3cm]{figures/photo.png}};`);
    const sections = includegraphicsSections(source, spanOf(source)!, { lengthSuffix: { width: "cm", height: "cm" }, crop: false });
    expect(sections.map(section => section.id)).toEqual(["image", "size"]);
    const fields = sections.flatMap(section => section.fields);
    expect(fields.find(field => field.id === "file")).toMatchObject({ kind: "file", name: "photo.png" });
    expect(fields.find(field => field.id === "width")).toMatchObject({ kind: "number", value: 3, unit: "cm" });
    expect(fields.find(field => field.id === "height")).toMatchObject({ write: { kind: "setGraphicsOption", key: "height", suffix: "cm" } });
  });

  it("sets, adds and removes options and replaces the file inside the node", () => {
    const source = picture(String.raw`\node[inner sep=0pt] at (2,1) {\includegraphics[width=3cm]{photo.png}};`);
    const width = apply(source, setIncludegraphicsOption(source, spanOf(source)!, "width", "4cm"));
    expect(width).toContain(String.raw`{\includegraphics[width=4cm]{photo.png}};`);
    const flag = apply(width, setIncludegraphicsOption(width, spanOf(width)!, "keepaspectratio", true));
    expect(flag).toContain(String.raw`\includegraphics[width=4cm, keepaspectratio]{photo.png}`);
    const removed = apply(flag, setIncludegraphicsOption(flag, spanOf(flag)!, "width", null));
    expect(removed).toContain(String.raw`\includegraphics[keepaspectratio]{photo.png}`);
    const replaced = apply(removed, replaceIncludegraphicsFile(removed, spanOf(removed)!, "figures/other.jpg"));
    expect(replaced).toContain(String.raw`\includegraphics[keepaspectratio]{figures/other.jpg}`);
    expect(replaced).toContain(String.raw`\draw (0,0) -- (1,1);`);
  });
});

describe("cropping image nodes in TikZ figures", () => {
  const resolver: DocumentGraphicsResolver = { cacheKey: "crop-node", resolve: () => ({ status: "resolved", mimeType: "image/png", dataBase64: "", naturalWidthPt: 120, naturalHeightPt: 60, revision: "1" }) };
  async function target(body: string) {
    const source = picture(body);
    const parsed = parseTikz(source);
    const scene = evaluateTikzFigure(parsed.figure, source, { graphicsResolver: resolver, textEngine: await createTexNodeTextEngine() }).scene;
    const span = imageNodeCommandSpan(source, parsed.figure.body, "path:1")!;
    // World to an SVG-like space with y down, as the canvas draws it.
    const placement = imageNodeCropPlacement(scene.elements, "path:1", span, (x, y) => ({ x, y: -y }));
    return { source, crop: placement ? imageCropTarget(source, placement) : null };
  }

  it("builds the slide crop target from the node's rendered image", async () => {
    const { crop } = await target(String.raw`\node[inner sep=0pt] at (2,1) {\includegraphics[width=6cm, trim=12 0 0 0, clip]{photo.png}};`);
    expect(crop).not.toBeNull();
    expect(crop!.natural).toEqual({ width: 120, height: 60 });
    expect(crop!.crop.left).toBeCloseTo(12 * 72.27 / 72, 6);
    expect(crop!.bounds.width).toBeCloseTo(6 * 72.27 / 2.54, 2);
    // The node is centred at (2,1): its picture's left edge is half a width to the left.
    expect(crop!.bounds.x).toBeCloseTo(2 * 72.27 / 2.54 - 3 * 72.27 / 2.54, 2);
  });

  it("crops by dragging an edge, keeping the drawn scale", async () => {
    const { source, crop } = await target(String.raw`\node[inner sep=0pt] at (2,1) {\includegraphics[width=6cm]{photo.png}};`);
    const patches = beamerImageCropPatches(source, crop!, beamerImageCropDrag(crop!, "e", -crop!.bounds.width / 2, 0), POINTER_TOLERANCE_PT);
    const edited = [...patches].reverse().reduce((text, patch) => text.slice(0, patch.oldSpan.from) + patch.replacement + text.slice(patch.oldSpan.to), source);
    expect(edited).toContain(String.raw`\includegraphics[width=3cm, trim=0 0 60 0, clip]{photo.png}`);
  });

  it("refuses rotated nodes, whose picture is not an axis-aligned rectangle", async () => {
    expect((await target(String.raw`\node[inner sep=0pt, rotate=30] at (2,1) {\includegraphics[width=6cm]{photo.png}};`)).crop).toBeNull();
  });
});
