import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderTikzToSvgAsync } from "../../../packages/core/src/render/index.ts";

type Point = { x: number; y: number };
type RectBounds = { x: number; y: number; width: number; height: number };

type RenderedCircleNode = {
  sourceId: string;
  center: Point;
  radius: number;
  labelPos: Point;
};

type RenderedRectNode = {
  sourceId: string;
  bounds: RectBounds;
  center: Point;
  labelPos: Point;
};

type RenderedEdge = {
  lineD: string;
  tipD: string;
};

type NodeMoveState = {
  viewBox: string;
  innerSvg: string;
  sCenter: Point;
  sRadius: number;
  sLabelPos: Point;
  edge: RenderedEdge;
};

type AddArrowState = {
  viewBox: string;
  innerSvg: string;
  s: RenderedRectNode;
  t: RenderedRectNode;
  edge?: RenderedEdge;
};

type NodeMoveStates = {
  initial: NodeMoveState;
  moved: NodeMoveState;
  commonViewBox: string;
};

type AddArrowStates = {
  initial: AddArrowState;
  final: AddArrowState;
  commonViewBox: string;
};

type AddRectState = {
  viewBox: string;
  innerSvg: string;
  bounds: RectBounds;
};

type AddRectStates = {
  initial: AddRectState;
  resized: AddRectState;
  commonViewBox: string;
};

type SnapGuideState = {
  viewBox: string;
  innerSvg: string;
  movingNode: RenderedRectNode;
  targetNode: RenderedRectNode;
  peerX: RenderedRectNode;
  peerY: RenderedRectNode;
};

type SnapGuideStates = {
  initial: SnapGuideState;
  final: SnapGuideState;
  commonViewBox: string;
};

type SelectionAlignState = {
  viewBox: string;
  innerSvg: string;
  leftNodes: RenderedRectNode[];
  rightNodes: RenderedRectNode[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.resolve(__dirname, "../src/feature-demos/generated/feature-svgs.ts");
const DEMO_SVG_OPTIONS = { svg: { padding: 0 } } as const;

async function renderNodeMoveStates(): Promise<NodeMoveStates> {
  const initialSource = String.raw`\begin{tikzpicture}
\path[use as bounding box] (-1.8,-1.2) rectangle (2.8,1.4);
\node[draw=black,fill=white,circle] (s) at (0,0) {$s$};
\node[draw=black,fill=white,circle] (t) at (2,0) {$t$};
\draw[->] (s) -- (t);
\end{tikzpicture}`;

  const movedSource = String.raw`\begin{tikzpicture}
\path[use as bounding box] (-1.8,-1.2) rectangle (2.8,1.4);
\node[draw=black,fill=white,circle] (s) at (-0.9,0.7) {$s$};
\node[draw=black,fill=white,circle] (t) at (2,0) {$t$};
\draw[->] (s) -- (t);
\end{tikzpicture}`;

  const initial = await renderCircleNodeMoveState(initialSource);
  const moved = await renderCircleNodeMoveState(movedSource);

  return {
    initial,
    moved,
    commonViewBox: initial.viewBox
  };
}

async function renderAddArrowStates(): Promise<AddArrowStates> {
  const initialSource = String.raw`\begin{tikzpicture}
\path[use as bounding box] (-2.4,-1.2) rectangle (3.1,1.4);
\node[draw=black,fill=blue!20,rectangle] (A) at (-1,0) {Start};
\node[draw=black,fill=green!20,rectangle] (B) at (1,0) {End};
\end{tikzpicture}`;

  const finalSource = String.raw`\begin{tikzpicture}
\path[use as bounding box] (-2.4,-1.2) rectangle (3.1,1.4);
\node[draw=black,fill=blue!20,rectangle] (A) at (-1,0) {Start};
\node[draw=black,fill=green!20,rectangle] (B) at (1,0) {End};
\draw[->] (A.east) -- (B.west);
\end{tikzpicture}`;

  const initial = await renderRectPairState(initialSource);
  const final = await renderRectPairState(finalSource);

  return {
    initial,
    final,
    commonViewBox: initial.viewBox
  };
}

async function renderAddRectStates(): Promise<AddRectStates> {
  const initialSource = String.raw`\begin{tikzpicture}
\path[use as bounding box] (-2.2,-1.6) rectangle (3.0,2.0);
\draw[draw=black, fill=white] (-0.9,0.2) rectangle (0.4,0.95);
\end{tikzpicture}`;

  const resizedSource = String.raw`\begin{tikzpicture}
\path[use as bounding box] (-2.2,-1.6) rectangle (3.0,2.0);
\draw[draw=black, fill=white] (-0.9,0.2) rectangle (2.15,0.95);
\end{tikzpicture}`;

  const initial = await renderRectState(initialSource);
  const resized = await renderRectState(resizedSource);

  return {
    initial,
    resized,
    commonViewBox: initial.viewBox
  };
}

async function renderSnapGuideStates(): Promise<SnapGuideStates> {
  // Layout: 2x2 matrix. A top-left, B top-right, C bottom-left, D bottom-right.
  // D (moving) starts out of place; final position completes the matrix.
  const initialSource = String.raw`\begin{tikzpicture}
\path[use as bounding box] (-2.2,-1.8) rectangle (2.2,1.8);
\node[draw=black,fill=white,rectangle] (A) at (-1.1,0.8) {A};
\node[draw=black,fill=white,rectangle] (B) at (1.1,0.8) {B};
\node[draw=black,fill=white,rectangle] (C) at (-1.1,-0.8) {C};
\node[draw=black,fill=white,rectangle] (D) at (0.2,-0.1) {D};
\end{tikzpicture}`;

  const finalSource = String.raw`\begin{tikzpicture}
\path[use as bounding box] (-2.2,-1.8) rectangle (2.2,1.8);
\node[draw=black,fill=white,rectangle] (A) at (-1.1,0.8) {A};
\node[draw=black,fill=white,rectangle] (B) at (1.1,0.8) {B};
\node[draw=black,fill=white,rectangle] (C) at (-1.1,-0.8) {C};
\node[draw=black,fill=white,rectangle] (D) at (1.1,-0.8) {D};
\end{tikzpicture}`;

  // indices: A=0, B=1, C=2, D=3. D is moving; peer on x-axis (same column) is B; peer on y-axis (same row) is C.
  const initial = await renderSnapGuideState(initialSource, 3, 3, 1, 2);
  const final = await renderSnapGuideState(finalSource, 3, 3, 1, 2);

  return {
    initial,
    final,
    commonViewBox: initial.viewBox
  };
}

async function renderSelectionAlignState(): Promise<SelectionAlignState> {
  const initialSource = String.raw`\begin{tikzpicture}
\node[draw=black,fill=blue!20,rectangle] (L1) at (-1.5,0.9) {Start};
\node[draw=black,fill=blue!20,rectangle] (L2) at (-1.8,0.0) {Mid};
\node[draw=black,fill=blue!20,rectangle] (L3) at (-1.1,-0.95) {Bottom};
\node[draw=black,fill=green!20,rectangle] (R1) at (1.7,0.9) {End};
\node[draw=black,fill=green!20,rectangle] (R2) at (1.9,0.0) {End};
\node[draw=black,fill=green!20,rectangle] (R3) at (1.6,-0.95) {End};
\draw (L1.east) -- (R1.west);
\draw (L1.east) -- (R2.west);
\draw (L1.east) -- (R3.west);
\draw (L2.east) -- (R1.west);
\draw (L2.east) -- (R2.west);
\draw (L2.east) -- (R3.west);
\draw (L3.east) -- (R1.west);
\draw (L3.east) -- (R2.west);
\draw (L3.east) -- (R3.west);
\end{tikzpicture}`;

  return renderRectNetworkState(initialSource);
}

async function renderCircleNodeMoveState(source: string): Promise<NodeMoveState> {
  const rendered = await renderTikzToSvgAsync(source, DEMO_SVG_OPTIONS);
  const svg = rendered.svg.svg;
  const viewBox = capture(svg, /viewBox="([^"]+)"/, "viewBox");
  const innerSvg = extractInnerSvg(svg);
  const circleNodes = extractCircleNodes(svg);
  if (circleNodes.length < 2) {
    throw new Error("Expected at least two circles for s/t nodes");
  }
  const s = circleNodes[0]!;
  const edge = extractEdge(svg);

  return {
    viewBox,
    innerSvg,
    sCenter: s.center,
    sRadius: s.radius,
    sLabelPos: s.labelPos,
    edge
  };
}

async function renderRectPairState(source: string): Promise<AddArrowState> {
  const rendered = await renderTikzToSvgAsync(source, DEMO_SVG_OPTIONS);
  const svg = rendered.svg.svg;
  const viewBox = capture(svg, /viewBox="([^"]+)"/, "viewBox");
  const innerSvg = extractInnerSvg(svg);
  const rectNodes = extractRectNodes(svg);
  if (rectNodes.length < 2) {
    throw new Error("Expected at least two rectangle nodes");
  }

  const [s, t] = rectNodes;
  const edge = extractEdge(svg, false);

  return {
    viewBox,
    innerSvg,
    s,
    t,
    ...(edge ? { edge } : {})
  };
}

async function renderRectState(source: string): Promise<AddRectState> {
  const rendered = await renderTikzToSvgAsync(source, DEMO_SVG_OPTIONS);
  const svg = rendered.svg.svg;
  const viewBox = capture(svg, /viewBox="([^"]+)"/, "viewBox");
  const innerSvg = extractInnerSvg(svg);
  const rectTag = capture(svg, /(<path[^>]*data-source-id="path:1"[^>]*>)/, "rectangle body");
  const rectD = capture(rectTag, /\sd="([^"]+)"/, "rectangle body d");

  return {
    viewBox,
    innerSvg,
    bounds: boundsFromPathD(rectD)
  };
}

async function renderSnapGuideState(
  source: string,
  movingIndex: number,
  targetIndex: number,
  peerXIndex: number,
  peerYIndex: number
): Promise<SnapGuideState> {
  const rendered = await renderTikzToSvgAsync(source, DEMO_SVG_OPTIONS);
  const svg = rendered.svg.svg;
  const viewBox = capture(svg, /viewBox="([^"]+)"/, "viewBox");
  const innerSvg = extractInnerSvg(svg);
  const rectNodes = extractRectNodes(svg);
  const maxIndex = Math.max(movingIndex, targetIndex, peerXIndex, peerYIndex);
  if (rectNodes.length <= maxIndex) {
    throw new Error("Expected enough rectangle nodes for snap guide scene");
  }

  return {
    viewBox,
    innerSvg,
    movingNode: rectNodes[movingIndex]!,
    targetNode: rectNodes[targetIndex]!,
    peerX: rectNodes[peerXIndex]!,
    peerY: rectNodes[peerYIndex]!
  };
}

async function renderRectNetworkState(source: string): Promise<SelectionAlignState> {
  const rendered = await renderTikzToSvgAsync(source, DEMO_SVG_OPTIONS);
  const svg = rendered.svg.svg;
  const viewBox = capture(svg, /viewBox="([^"]+)"/, "viewBox");
  const innerSvg = extractInnerSvg(svg);
  const rectNodes = extractRectNodes(svg);
  if (rectNodes.length < 6) {
    throw new Error("Expected at least six rectangle nodes for the align scene");
  }

  return {
    viewBox,
    innerSvg,
    leftNodes: rectNodes.slice(0, 3),
    rightNodes: rectNodes.slice(3, 6)
  };
}

function extractRectNodes(svg: string): RenderedRectNode[] {
  const rectTags = [...svg.matchAll(/(<path[^>]*data-source-id="path:\d+"[^>]*>)/g)].map((match) => match[1]!);
  return rectTags
    .filter((tag) => !tag.includes("data-arrow-tip-kind") && !tag.includes('fill="none"'))
    .map((rectTag) => {
      const sourceId = capture(rectTag, /data-source-id="([^"]+)"/, "rect source id");
      const labelTag = capture(
        svg,
        new RegExp(`(<svg[^>]*data-source-id="${escapeRegExp(sourceId)}"[^>]*data-text-renderer="tex"[^>]*>)`),
        `label for ${sourceId}`
      );

      const bounds = boundsFromPathD(capture(rectTag, /\sd="([^"]+)"/, `${sourceId} path d`));
      return {
        sourceId,
        bounds,
        center: centerFromBounds(bounds),
        labelPos: {
          x: Number(capture(labelTag, /\sx="([^"]+)"/, `${sourceId} label x`)),
          y: Number(capture(labelTag, /\sy="([^"]+)"/, `${sourceId} label y`))
        }
      };
    });
}

function extractCircleNodes(svg: string): RenderedCircleNode[] {
  const circleTags = [...svg.matchAll(/(<circle[^>]*>)/g)].map((match) => match[1]!).filter((tag) => /data-source-id="path:\d+"/.test(tag));
  return circleTags.map((circleTag) => {
    const sourceId = capture(circleTag, /data-source-id="([^"]+)"/, "circle source id");
    const labelTag = capture(
      svg,
      new RegExp(`(<svg[^>]*data-source-id="${escapeRegExp(sourceId)}"[^>]*data-text-renderer="tex"[^>]*>)`),
      `label for ${sourceId}`
    );

    return {
      sourceId,
      center: {
        x: Number(capture(circleTag, /cx="([^"]+)"/, `${sourceId} cx`)),
        y: Number(capture(circleTag, /cy="([^"]+)"/, `${sourceId} cy`))
      },
      radius: Number(capture(circleTag, /r="([^"]+)"/, `${sourceId} radius`)),
      labelPos: {
        x: Number(capture(labelTag, /\sx="([^"]+)"/, `${sourceId} label x`)),
        y: Number(capture(labelTag, /\sy="([^"]+)"/, `${sourceId} label y`))
      }
    };
  });
}

function extractEdge(svg: string, requireEdge = true): RenderedEdge | null {
  const edgeTipTag = svg.match(/(<path[^>]*data-arrow-tip-kind="[^"]+"[^>]*>)/)?.[1] ?? null;
  const edgeLineTag = svg.match(/(<path[^>]*data-source-id="path:3"[^>]*\sd="[^"]+"[^>]*>)/)?.[1] ?? null;
  if (!edgeTipTag || !edgeLineTag) {
    if (requireEdge) {
      throw new Error("Unable to find edge line or tip path");
    }
    return null;
  }

  return {
    lineD: capture(edgeLineTag, /\sd="([^"]+)"/, "edge line d"),
    tipD: capture(edgeTipTag, /\sd="([^"]+)"/, "edge tip d")
  };
}

function boundsFromPathD(d: string): RectBounds {
  const numbers = [...d.matchAll(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)].map((match) => Number(match[0]));
  if (numbers.length < 4 || numbers.length % 2 !== 0) {
    throw new Error(`Unable to derive bounds from path data: ${d}`);
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < numbers.length; index += 2) {
    const x = numbers[index]!;
    const y = numbers[index + 1]!;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function centerFromBounds(bounds: RectBounds): Point {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  };
}

function extractInnerSvg(svg: string): string {
  const openTagEnd = svg.indexOf(">");
  const closeTagStart = svg.lastIndexOf("</svg>");
  if (openTagEnd < 0 || closeTagStart < 0 || closeTagStart <= openTagEnd) {
    throw new Error("Unable to capture svg inner");
  }
  return svg.slice(openTagEnd + 1, closeTagStart);
}

function capture(input: string, re: RegExp, label: string): string {
  const match = input.match(re);
  if (!match || !match[1]) {
    throw new Error(`Unable to capture ${label}`);
  }
  return match[1];
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main(): Promise<void> {
  const nodeMove = await renderNodeMoveStates();
  const addArrow = await renderAddArrowStates();
  const addRect = await renderAddRectStates();
  const snapGuides = await renderSnapGuideStates();
  const selectionAlign = await renderSelectionAlignState();

  const content = [
    "/* auto-generated by apps/landing/scripts/generate-feature-svgs.mts */",
    "",
    "export type RenderedCardState = {",
    "  viewBox: string;",
    "  innerSvg: string;",
    "  sCenter: { x: number; y: number };",
    "  sRadius: number;",
    "  sLabelPos: { x: number; y: number };",
    "  edge: { lineD: string; tipD: string };",
    "};",
    "",
    "export type RenderedCircleNode = {",
    "  sourceId: string;",
    "  center: { x: number; y: number };",
    "  radius: number;",
    "  labelPos: { x: number; y: number };",
    "};",
    "",
    "export type RenderedRectNode = {",
    "  sourceId: string;",
    "  bounds: { x: number; y: number; width: number; height: number };",
    "  center: { x: number; y: number };",
    "  labelPos: { x: number; y: number };",
    "};",
    "",
    "export type AddArrowCardState = {",
    "  viewBox: string;",
    "  innerSvg: string;",
    "  s: RenderedRectNode;",
    "  t: RenderedRectNode;",
    "  edge?: { lineD: string; tipD: string };",
    "};",
    "",
    "export type AddRectCardState = {",
    "  viewBox: string;",
    "  innerSvg: string;",
    "  bounds: { x: number; y: number; width: number; height: number };",
    "};",
    "",
    "export type SnapGuideCardState = {",
    "  viewBox: string;",
    "  innerSvg: string;",
    "  movingNode: RenderedRectNode;",
    "  targetNode: RenderedRectNode;",
    "  peerX: RenderedRectNode;",
    "  peerY: RenderedRectNode;",
    "};",
    "",
    "export type SelectionAlignCardState = {",
    "  viewBox: string;",
    "  innerSvg: string;",
    "  leftNodes: RenderedRectNode[];",
    "  rightNodes: RenderedRectNode[];",
    "};",
    "",
    `export const nodeMoveInitial: RenderedCardState = ${JSON.stringify(
      {
        viewBox: nodeMove.initial.viewBox,
        innerSvg: nodeMove.initial.innerSvg,
        sCenter: nodeMove.initial.sCenter,
        sRadius: nodeMove.initial.sRadius,
        sLabelPos: nodeMove.initial.sLabelPos,
        edge: nodeMove.initial.edge
      },
      null,
      2
    )} as const;`,
    "",
    `export const nodeMoveMoved: RenderedCardState = ${JSON.stringify(
      {
        viewBox: nodeMove.moved.viewBox,
        innerSvg: nodeMove.moved.innerSvg,
        sCenter: nodeMove.moved.sCenter,
        sRadius: nodeMove.moved.sRadius,
        sLabelPos: nodeMove.moved.sLabelPos,
        edge: nodeMove.moved.edge
      },
      null,
      2
    )} as const;`,
    "",
    `export const nodeMoveCommonViewBox = ${JSON.stringify(nodeMove.commonViewBox)};`,
    "",
    `export const addArrowInitial: AddArrowCardState = ${JSON.stringify(
      {
        viewBox: addArrow.initial.viewBox,
        innerSvg: addArrow.initial.innerSvg,
        s: addArrow.initial.s,
        t: addArrow.initial.t
      },
      null,
      2
    )} as const;`,
    "",
    `export const addArrowFinal: AddArrowCardState = ${JSON.stringify(
      {
        viewBox: addArrow.final.viewBox,
        innerSvg: addArrow.final.innerSvg,
        s: addArrow.final.s,
        t: addArrow.final.t,
        edge: addArrow.final.edge
      },
      null,
      2
    )} as const;`,
    "",
    `export const addArrowCommonViewBox = ${JSON.stringify(addArrow.commonViewBox)};`,
    "",
    `export const addRectInitial: AddRectCardState = ${JSON.stringify(
      {
        viewBox: addRect.initial.viewBox,
        innerSvg: addRect.initial.innerSvg,
        bounds: addRect.initial.bounds
      },
      null,
      2
    )} as const;`,
    "",
    `export const addRectResized: AddRectCardState = ${JSON.stringify(
      {
        viewBox: addRect.resized.viewBox,
        innerSvg: addRect.resized.innerSvg,
        bounds: addRect.resized.bounds
      },
      null,
      2
    )} as const;`,
    "",
    `export const addRectCommonViewBox = ${JSON.stringify(addRect.commonViewBox)};`,
    "",
    `export const snapGuidesInitial: SnapGuideCardState = ${JSON.stringify(
      {
        viewBox: snapGuides.initial.viewBox,
        innerSvg: snapGuides.initial.innerSvg,
        movingNode: snapGuides.initial.movingNode,
        targetNode: snapGuides.initial.targetNode,
        peerX: snapGuides.initial.peerX,
        peerY: snapGuides.initial.peerY
      },
      null,
      2
    )} as const;`,
    "",
    `export const snapGuidesFinal: SnapGuideCardState = ${JSON.stringify(
      {
        viewBox: snapGuides.final.viewBox,
        innerSvg: snapGuides.final.innerSvg,
        movingNode: snapGuides.final.movingNode,
        targetNode: snapGuides.final.targetNode,
        peerX: snapGuides.final.peerX,
        peerY: snapGuides.final.peerY
      },
      null,
      2
    )} as const;`,
    "",
    `export const snapGuidesCommonViewBox = ${JSON.stringify(snapGuides.commonViewBox)};`,
    "",
    `export const selectionAlignInitial: SelectionAlignCardState = ${JSON.stringify(
      {
        viewBox: selectionAlign.viewBox,
        innerSvg: selectionAlign.innerSvg,
        leftNodes: selectionAlign.leftNodes,
        rightNodes: selectionAlign.rightNodes
      },
      null,
      2
    )} as const;`,
    "",
    `export const selectionAlignCommonViewBox = ${JSON.stringify(selectionAlign.viewBox)};`,
    "",
  ].join("\n");

  await writeFile(OUT_FILE, content, "utf8");
  console.log(`Generated ${OUT_FILE}`);
}

void main();
