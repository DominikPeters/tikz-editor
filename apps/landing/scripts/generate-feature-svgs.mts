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

type RotateNodeState = {
  viewBox: string;
  innerSvg: string;
  bounds: RectBounds;
  center: Point;
  labelPos: Point;
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

type SelectionAlignStates = {
  initial: SelectionAlignState;
  final: SelectionAlignState;
  commonViewBox: string;
};

type SourceEditState = {
  viewBox: string;
  innerSvg: string;
  aCenter: Point;
  aRadius: number;
  edge: RenderedEdge;
  sourceX: number;
  label: string;
};

type SourceEditStates = {
  initial: SourceEditState;
  moved: SourceEditState;
  typed: SourceEditState[];
  commonViewBox: string;
};

type ShowcaseSvg = {
  title: string;
  source: string;
  svg: string;
};

type ForeachRepeatCell = {
  x: number;
  y: number;
  circleSvg: string;
  labelSvg: string;
};

type ForeachRepeatShowcaseSvg = ShowcaseSvg & {
  maxColumns: number;
  maxRows: number;
  viewBox: string;
  cells: ForeachRepeatCell[];
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

async function renderSourceEditStates(): Promise<SourceEditStates> {
  const initial = await renderSourceEditState(0.8, "A");
  const moved = await renderSourceEditState(2.2, "A");
  const typed = await Promise.all(["A", "Al", "Alp", "Alph", "Alpha"].map((label) => renderSourceEditState(2.2, label)));

  return {
    initial,
    moved,
    typed,
    commonViewBox: initial.viewBox
  };
}

async function renderSourceEditState(sourceX: number, label: string): Promise<SourceEditState> {
  const source = String.raw`\begin{tikzpicture}[>=Stealth]
\path[use as bounding box] (-0.2,-0.5) rectangle (4.2,1.6);
\node[draw=blue,fill=blue!10,circle] (a) at (${sourceX},0.8) {${label}};
\node[draw=green!50!black,fill=green!12,circle] (b) at (3.2,0.0) {B};
\draw[->] (a) -- (b);
\end{tikzpicture}`;

  const rendered = await renderTikzToSvgAsync(source);
  const svg = rendered.svg.svg;
  const circleNodes = extractCircleNodes(svg);
  if (circleNodes.length < 2) {
    throw new Error("Expected two circle nodes for source edit scene");
  }
  const a = circleNodes[0]!;

  return {
    viewBox: capture(svg, /viewBox="([^"]+)"/, "source edit viewBox"),
    innerSvg: extractInnerSvg(svg),
    aCenter: a.center,
    aRadius: a.radius,
    edge: extractEdge(svg),
    sourceX,
    label
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

async function renderSelectionAlignStates(): Promise<SelectionAlignStates> {
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

  const finalSource = String.raw`\begin{tikzpicture}
\node[draw=black,fill=blue!20,rectangle] (L1) at (-0.7,0.9) {Start};
\node[draw=black,fill=blue!20,rectangle] (L2) at (-0.7,0.0) {Mid};
\node[draw=black,fill=blue!20,rectangle] (L3) at (-0.7,-0.95) {Bottom};
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

  const initial = await renderRectNetworkState(initialSource);
  const final = await renderRectNetworkState(finalSource);

  return {
    initial,
    final,
    commonViewBox: initial.viewBox
  };
}

async function renderRotateNodeState(): Promise<RotateNodeState> {
  const source = String.raw`\begin{tikzpicture}
\path[use as bounding box] (-2.2,-1.7) rectangle (2.2,1.7);
\node[draw=black,fill=white,rectangle] (e) at (0,0) {$e = mc^2$};
\end{tikzpicture}`;

  const rendered = await renderTikzToSvgAsync(source, DEMO_SVG_OPTIONS);
  const svg = rendered.svg.svg;
  const viewBox = capture(svg, /viewBox="([^"]+)"/, "viewBox");
  const innerSvg = extractInnerSvg(svg);

  const bodyTag = capture(svg, /(<path[^>]*data-source-id="path:1"[^>]*>)/, "rectangle body");
  const bodyD = capture(bodyTag, /\sd="([^"]+)"/, "rectangle body d");
  const labelTag = capture(
    svg,
    /(<svg[^>]*data-source-id="path:1"[^>]*data-text-renderer="tex"[^>]*>)/,
    "rectangle label"
  );
  const labelX = Number(capture(labelTag, /\sx="([^"]+)"/, "rectangle label x"));
  const labelY = Number(capture(labelTag, /\sy="([^"]+)"/, "rectangle label y"));

  return {
    viewBox,
    innerSvg,
    bounds: boundsFromPathD(bodyD),
    center: centerFromBounds(boundsFromPathD(bodyD)),
    labelPos: { x: labelX, y: labelY }
  };
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

async function renderShowcaseSvgs(): Promise<Record<string, ShowcaseSvg | ForeachRepeatShowcaseSvg>> {
  const foreachMaxColumns = 6;
  const foreachMaxRows = 4;
  const sources: Record<string, { title: string; source: string }> = {
    shapes: {
      title: "Node shapes",
      source: String.raw`\begin{tikzpicture}
\node[draw, fill=blue!15, rectangle] at (0,1.4) {rect};
\node[draw, fill=green!15, rounded corners=3pt] at (2.2,1.4) {round};
\node[draw, fill=red!12, circle] at (4.4,1.4) {circle};
\node[draw, fill=yellow!18, ellipse] at (0,0) {ellipse};
\node[draw, fill=cyan!12, minimum width=16mm, minimum height=9mm] at (2.2,0) {$x_i$};
\node[draw, fill=magenta!12, rounded corners=8pt] at (4.4,0) {label};
\end{tikzpicture}`
    },
    paths: {
      title: "Paths",
      source: String.raw`\begin{tikzpicture}[>=Stealth]
\draw[->] (0,1.4) -- (2.2,1.4);
\draw[blue, thick] (3,1.4) .. controls (3.6,2.2) and (4.4,0.6) .. (5.2,1.4);
\draw[step=0.35, gray!55] (0,0) grid (1.4,0.9);
\draw (2.2,0) rectangle (3.2,0.9);
\draw[green!50!black, thick] (4.4,0.45) ellipse (0.65 and 0.38);
\end{tikzpicture}`
    },
    styles: {
      title: "Styles",
      source: String.raw`\begin{tikzpicture}
\node[draw=blue, fill=blue!30, minimum width=18mm] at (0,1.2) {blue!30};
\node[draw=green!50!black, fill=green!15, dashed, minimum width=18mm] at (2.4,1.2) {dashed};
\draw[thick, red] (0,0.25) -- (1.4,0.25);
\draw[densely dotted, very thick] (1.8,0.25) -- (3.2,0.25);
\draw[fill=red!20, fill opacity=0.6] (4.2,0.6) circle (0.55);
\draw[fill=yellow!40, fill opacity=0.6] (4.8,0.6) circle (0.55);
\end{tikzpicture}`
    },
    matrix: {
      title: "Matrices",
      source: String.raw`\begin{tikzpicture}[>=Stealth]
\matrix (m) [matrix of math nodes, row sep=10mm, column sep=16mm] {
  A & B \\
  C & D \\
};
\draw[->] (m-1-1) -- node[above] {$f$} (m-1-2);
\draw[->] (m-1-1) -- node[left] {$g$} (m-2-1);
\draw[->] (m-1-2) -- node[right] {$h$} (m-2-2);
\draw[->] (m-2-1) -- node[below] {$k$} (m-2-2);
\end{tikzpicture}`
    },
    foreachRepeat: {
      title: "Foreach output",
      source: String.raw`\begin{tikzpicture}
\foreach \x in {1,...,${foreachMaxColumns}} {
  \foreach \y in {1,...,${foreachMaxRows}} {
    \node[circle,draw,minimum size=8mm] at (\x,-\y) {\x,\y};
  }
}
\end{tikzpicture}`
    }
  };

  const entries = await Promise.all(
    Object.entries(sources).map(async ([key, item]) => {
      const rendered = await renderTikzToSvgAsync(item.source, { svg: { padding: 8 } });
      if (key === "foreachRepeat") {
        return [
          key,
          {
            title: item.title,
            source: item.source,
            svg: rendered.svg.svg,
            maxColumns: foreachMaxColumns,
            maxRows: foreachMaxRows,
            viewBox: capture(rendered.svg.svg, /viewBox="([^"]+)"/, "foreach repeat viewBox"),
            cells: extractForeachRepeatCells(rendered.svg.svg, foreachMaxColumns, foreachMaxRows)
          }
        ] as const;
      }
      return [key, { title: item.title, source: item.source, svg: rendered.svg.svg }] as const;
    })
  );
  return Object.fromEntries(entries);
}

function extractForeachRepeatCells(svg: string, maxColumns: number, maxRows: number): ForeachRepeatCell[] {
  const circleLabelPairs = [...svg.matchAll(/(<circle[^>]*data-source-id="foreach:[^"]+"[^>]*\/>)\s*(<svg[^>]*data-source-id="foreach:[^"]+"[^>]*data-text-renderer="tex"[\s\S]*?<\/svg>)/g)];
  const expected = maxColumns * maxRows;
  if (circleLabelPairs.length !== expected) {
    throw new Error(`Expected ${expected} foreach repeat cells, found ${circleLabelPairs.length}`);
  }

  return circleLabelPairs.map((match, index) => ({
    x: Math.floor(index / maxRows) + 1,
    y: (index % maxRows) + 1,
    circleSvg: match[1]!,
    labelSvg: match[2]!
  }));
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
  const sourceEdit = await renderSourceEditStates();
  const addArrow = await renderAddArrowStates();
  const addRect = await renderAddRectStates();
  const snapGuides = await renderSnapGuideStates();
  const selectionAlign = await renderSelectionAlignStates();
  const rotateNode = await renderRotateNodeState();
  const showcaseSvgs = await renderShowcaseSvgs();

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
    "export type RotateNodeCardState = {",
    "  viewBox: string;",
    "  innerSvg: string;",
    "  bounds: { x: number; y: number; width: number; height: number };",
    "  center: { x: number; y: number };",
    "  labelPos: { x: number; y: number };",
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
    "export type SourceEditState = {",
    "  viewBox: string;",
    "  innerSvg: string;",
    "  aCenter: { x: number; y: number };",
    "  aRadius: number;",
    "  edge: { lineD: string; tipD: string };",
    "  sourceX: number;",
    "  label: string;",
    "};",
    "",
    "export type SourceEditStates = {",
    "  initial: SourceEditState;",
    "  moved: SourceEditState;",
    "  typed: SourceEditState[];",
    "  commonViewBox: string;",
    "};",
    "",
    "export type ShowcaseSvg = {",
    "  title: string;",
    "  source: string;",
    "  svg: string;",
    "};",
    "",
    "export type ForeachRepeatCell = {",
    "  x: number;",
    "  y: number;",
    "  circleSvg: string;",
    "  labelSvg: string;",
    "};",
    "",
    "export type ForeachRepeatShowcaseSvg = ShowcaseSvg & {",
    "  maxColumns: number;",
    "  maxRows: number;",
    "  viewBox: string;",
    "  cells: ForeachRepeatCell[];",
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
    `export const sourceEditStates: SourceEditStates = ${JSON.stringify(sourceEdit, null, 2)} as const;`,
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
    `export const rotateNodeInitial: RotateNodeCardState = ${JSON.stringify(
      {
        viewBox: rotateNode.viewBox,
        innerSvg: rotateNode.innerSvg,
        bounds: rotateNode.bounds,
        center: rotateNode.center,
        labelPos: rotateNode.labelPos
      },
      null,
      2
    )} as const;`,
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
        viewBox: selectionAlign.initial.viewBox,
        innerSvg: selectionAlign.initial.innerSvg,
        leftNodes: selectionAlign.initial.leftNodes,
        rightNodes: selectionAlign.initial.rightNodes
      },
      null,
      2
    )} as const;`,
    "",
    `export const selectionAlignFinal: SelectionAlignCardState = ${JSON.stringify(
      {
        viewBox: selectionAlign.final.viewBox,
        innerSvg: selectionAlign.final.innerSvg,
        leftNodes: selectionAlign.final.leftNodes,
        rightNodes: selectionAlign.final.rightNodes
      },
      null,
      2
    )} as const;`,
    "",
    `export const selectionAlignCommonViewBox = ${JSON.stringify(selectionAlign.commonViewBox)};`,
    "",
    `export const landingShowcaseSvgs: Record<string, ShowcaseSvg | ForeachRepeatShowcaseSvg> = ${JSON.stringify(showcaseSvgs, null, 2)} as const;`
  ].join("\n");

  await writeFile(OUT_FILE, content, "utf8");
  console.log(`Generated ${OUT_FILE}`);
}

void main();
