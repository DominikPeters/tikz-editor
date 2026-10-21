import type { ArrowLocalPoint } from "../../coords/points.js";
import type { ArrowTip, ScenePath, ScenePathCommand } from "../../semantic/types.js";

export type { Frame } from "../../geometry/path-sampler.js";

export type ArrowSide = "start" | "end";

export type ArrowLocalPathCommand =
  | { kind: "M"; to: ArrowLocalPoint }
  | { kind: "L"; to: ArrowLocalPoint }
  | { kind: "C"; c1: ArrowLocalPoint; c2: ArrowLocalPoint; to: ArrowLocalPoint }
  | { kind: "A"; rx: number; ry: number; xAxisRotation: number; largeArc: boolean; sweep: boolean; to: ArrowLocalPoint }
  | { kind: "Z" };

export type NormalizedArrowTip = ArrowTip & {
  contextLineWidth: number;
  length: number;
  width: number;
  sep: number;
  lineWidth: number;
  afterLineEnd: boolean;
};

export type ArrowTipMetrics = {
  tipEnd: number;
  backEnd: number;
  lineEnd: number;
  visualTipEnd: number;
  visualBackEnd: number;
  sep: number;
};

export type ArrowTipPlan = {
  side: ArrowSide;
  index: number;
  tip: NormalizedArrowTip;
  metrics: ArrowTipMetrics;
  offset: number;
  bend: boolean;
};

export type ArrowShorteningResult = {
  lineEndShortening: number;
  totalLength: number;
  plans: ArrowTipPlan[];
};

export type RenderedArrowTipPath = {
  commands: ScenePathCommand[];
  side: ArrowSide;
  index: number;
  bend: boolean;
  tipKind: ArrowTip["kind"];
  stroke: string;
  fill: string;
  strokeWidth: number;
  lineCap: "butt" | "round" | "square";
  lineJoin: "miter" | "round" | "bevel";
  miterLimit: number;
};

export type RenderedArrowPath = {
  shaftCommands: ScenePathCommand[];
  tipPaths: RenderedArrowTipPath[];
};

export type ArrowRenderInput = {
  path: ScenePath;
};
