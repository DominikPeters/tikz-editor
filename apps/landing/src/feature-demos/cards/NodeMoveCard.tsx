import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { applyCursorOverlayFrame, CursorOverlay } from "../cursor-overlay";
import { createCursorScript, type CursorFrame } from "../cursor-script";
import { renderEditHandlesForBounds } from "../edit-handles";
import { nodeMoveCommonViewBox, nodeMoveInitial, nodeMoveMoved } from "../generated/feature-svgs";
import { createCursorPathScript } from "../animation/cursor-path";
import { offsetPoint, point } from "../animation/points";
import {
  applyLinePathEndpoints,
  prepareTransformDrivenLinePath,
  setSvgAttrs,
  toSvgAttrs,
  toTranslate
} from "../animation/svg-actors";
import { wrapRenderedElements } from "../animation/rendered-scene";
import {
  formatTikzNumber,
  sourceKeyword,
  sourceLine,
  sourcePunctuation,
  SourcePreview,
  renderSourcePreview,
  sourceString,
  sourceNumber,
  sourceText,
  type SourceLine
} from "../source-preview";
import { useDemoTimelinePlayback } from "../use-demo-playback";

type SceneRefs = {
  contentGroup: SVGGElement | null;
  handlesGroup: SVGGElement | null;
};

type NodeSceneElements = {
  sNodeGroup: SVGGElement;
  edgeLine: SVGPathElement;
  edgeTip: SVGPathElement;
};

type NodeMoveSourceState = {
  s: { x: number; y: number };
  t: { x: number; y: number };
};

const SOURCE_S_START = { x: 0, y: 0 };
const SOURCE_S_END = { x: -0.9, y: 0.7 };
const SOURCE_T = { x: 2, y: 0 };

function queryNodeSceneElements(contentGroup: SVGGElement): NodeSceneElements | null {
  const sCircle = contentGroup.querySelector('circle[data-source-id="path:1"]');
  const sLabel = contentGroup.querySelector('[data-source-id="path:1"][data-text-renderer="tex"]');
  const edgeLine = contentGroup.querySelector<SVGPathElement>('path[data-source-id="path:3"]:not([data-arrow-tip-kind])');
  const edgeTip = contentGroup.querySelector<SVGPathElement>('path[data-source-id="path:3"][data-arrow-tip-kind]');

  if (!sCircle || !sLabel || !edgeLine || !edgeTip) {
    return null;
  }

  const sNodeGroup = wrapRenderedElements([sCircle, sLabel], "animatedNodeGroup");
  if (!sNodeGroup) {
    return null;
  }

  return { sNodeGroup, edgeLine, edgeTip };
}

function setNodeFrame(elements: NodeSceneElements, frame: typeof nodeMoveInitial): void {
  gsap.set(elements.sNodeGroup, {
    x: frame.sCenter.x - nodeMoveInitial.sCenter.x,
    y: frame.sCenter.y - nodeMoveInitial.sCenter.y
  });
  applyNodeMoveLineFrame(elements.edgeLine, frame);
  setSvgAttrs(elements.edgeTip, { d: frame.edge.tipD });
}

function tweenNodeFrame(
  tl: gsap.core.Timeline,
  elements: NodeSceneElements,
  frame: typeof nodeMoveInitial,
  duration: number,
  position: gsap.Position,
  ease = "power1.inOut",
  onUpdate?: () => void
): void {
  toTranslate(
    tl,
    elements.sNodeGroup,
    frame.sCenter.x - nodeMoveInitial.sCenter.x,
    frame.sCenter.y - nodeMoveInitial.sCenter.y,
    duration,
    position,
    ease
  );
  const lineFrame = { progress: 0 };
  tl.to(lineFrame, {
    progress: 1,
    duration,
    ease,
    onUpdate: () => {
      const progress = frame === nodeMoveMoved ? lineFrame.progress : 1 - lineFrame.progress;
      applyLinePathEndpoints(
        elements.edgeLine,
        interpolatePoint(nodeMoveInitialEdgeEndpoints.from, nodeMoveMovedEdgeEndpoints.from, progress),
        interpolatePoint(nodeMoveInitialEdgeEndpoints.to, nodeMoveMovedEdgeEndpoints.to, progress)
      );
    }
  }, position);
  toSvgAttrs(tl, elements.edgeTip, { d: frame.edge.tipD }, duration, position, ease);
  if (onUpdate) {
    tl.to({}, { duration, ease, onUpdate }, position);
  }
}

type NodeMoveCardProps = {
  sceneViewBox?: string;
};

export function NodeMoveCard({ sceneViewBox = nodeMoveCommonViewBox }: NodeMoveCardProps = {}) {
  const rootRef = useRef<HTMLElement | null>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  useDemoTimelinePlayback(rootRef, timelineRef);
  const cursorOverlayRef = useRef<SVGGElement | null>(null);
  const sourcePreviewRef = useRef<HTMLElement | null>(null);
  const sceneRef = useRef<SceneRefs>({ contentGroup: null, handlesGroup: null });
  const sourceStateRef = useRef<NodeMoveSourceState>({
    s: { ...SOURCE_S_START },
    t: { ...SOURCE_T }
  });
  const lastSourceKeyRef = useRef<string | null>(null);
  const cursorStateRef = useRef<CursorFrame>({
    x: nodeMoveInitial.sCenter.x,
    y: nodeMoveInitial.sCenter.y,
    visible: true,
    pressed: false,
    cursor: "pointer"
  });
  const [cursorFrame, setCursorFrame] = useState<CursorFrame>({ ...cursorStateRef.current });

  const commitCursorPosition = (): void => {
    if (cursorOverlayRef.current) {
      applyCursorOverlayFrame(cursorOverlayRef.current, cursorStateRef.current, 0.35);
    }
  };
  const commitCursorFrame = (): void => {
    commitCursorPosition();
    setCursorFrame({ ...cursorStateRef.current });
  };
  const commitSource = (): void => {
    const sourceKey = [
      formatTikzNumber(sourceStateRef.current.s.x),
      formatTikzNumber(sourceStateRef.current.s.y),
      formatTikzNumber(sourceStateRef.current.t.x),
      formatTikzNumber(sourceStateRef.current.t.y)
    ].join("|");
    if (lastSourceKeyRef.current === sourceKey) {
      return;
    }
    lastSourceKeyRef.current = sourceKey;
    if (sourcePreviewRef.current) {
      renderSourcePreview(sourcePreviewRef.current, buildNodeMoveSourceLines(sourceStateRef.current));
    }
  };

  useLayoutEffect(() => {
    if (!rootRef.current) {
      return;
    }

    const contentGroup = sceneRef.current.contentGroup;
    const handlesGroup = sceneRef.current.handlesGroup;
    if (!contentGroup || !handlesGroup) {
      return;
    }

    // Mount once so React re-renders (from cursor state updates) do not
    // overwrite animated SVG attributes.
    contentGroup.innerHTML = nodeMoveInitial.innerSvg;
    sourceStateRef.current.s = { ...SOURCE_S_START };
    sourceStateRef.current.t = { ...SOURCE_T };
    commitSource();

    const elements = queryNodeSceneElements(contentGroup);
    if (!elements) {
      return;
    }

    const dx = nodeMoveMoved.sCenter.x - nodeMoveInitial.sCenter.x;
    const dy = nodeMoveMoved.sCenter.y - nodeMoveInitial.sCenter.y;
    prepareTransformDrivenLinePath(elements.edgeLine);

    const initialCenter = point(nodeMoveInitial.sCenter.x, nodeMoveInitial.sCenter.y);
    const movedCenter = point(nodeMoveMoved.sCenter.x, nodeMoveMoved.sCenter.y);

    const waypoints = {
      initialHover: offsetPoint(initialCenter, -nodeMoveInitial.sRadius * 0.5, 0),
      movedHover: offsetPoint(movedCenter, -nodeMoveMoved.sRadius * 0.5, 0),
      initialBeside: offsetPoint(initialCenter, -nodeMoveInitial.sRadius - 12, 4),
      deselectOutside: offsetPoint(initialCenter, -nodeMoveInitial.sRadius - 24, -6)
    };

    setNodeFrame(elements, nodeMoveInitial);
    gsap.set(handlesGroup, { x: 0, y: 0, autoAlpha: 0 });
    Object.assign(cursorStateRef.current, {
      x: waypoints.initialBeside.x,
      y: waypoints.initialBeside.y,
      visible: true,
      pressed: false,
      cursor: "pointer"
    });
    commitCursorFrame();

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 0.9 });
      timelineRef.current = tl;
      tl.eventCallback("onRepeat", () => {
        sourceStateRef.current.s.x = SOURCE_S_START.x;
        sourceStateRef.current.s.y = SOURCE_S_START.y;
        sourceStateRef.current.t.x = SOURCE_T.x;
        sourceStateRef.current.t.y = SOURCE_T.y;
        commitSource();
      });
      const cursor = createCursorScript(tl, cursorStateRef.current, {
        onPositionChange: commitCursorPosition,
        onFrameChange: commitCursorFrame
      });
      const cursorPath = createCursorPathScript(cursor, waypoints);

      tl.add("hoverStart");
      cursorPath.glideTo("initialHover", 0.55, "hoverStart");
      cursor.setStyle("move", "hoverStart+=0.35");

      tl.add("selectClick", "hoverStart+=0.57");
      cursor.setPressed(true, "selectClick");
      cursor.setPressed(false, "selectClick+=0.12");
      tl.to(handlesGroup, { autoAlpha: 1, duration: 0.08, ease: "none" }, "selectClick+=0.02");

      tl.add("dragForwardStart", "selectClick+=0.28");
      cursor.setPressed(true, "dragForwardStart");
      cursorPath.moveTo("movedHover", 1, "dragForwardStart", "power1.inOut");

      tweenNodeFrame(tl, elements, nodeMoveMoved, 1, "dragForwardStart", "power1.inOut");
      toTranslate(tl, handlesGroup, dx, dy, 1, "dragForwardStart", "power1.inOut");
      tl.to(sourceStateRef.current.s, {
        x: SOURCE_S_END.x,
        y: SOURCE_S_END.y,
        duration: 1,
        ease: "power1.inOut",
        onUpdate: commitSource
      }, "dragForwardStart");

      tl.add("dragForwardEnd", "dragForwardStart+=1");
      cursor.setPressed(false, "dragForwardEnd-=0.14");

      tl.add("prepBack", "dragForwardEnd+=0.45");
      cursorPath.moveTo("movedHover", 0.16, "prepBack");
      cursor.setStyle("move", "prepBack");
      cursor.setPressed(true, "prepBack");

      tl.add("dragBackStart", "prepBack+=0.16");
      cursorPath.moveTo("initialHover", 0.75, "dragBackStart", "power1.inOut");
      tweenNodeFrame(tl, elements, nodeMoveInitial, 0.75, "dragBackStart", "power1.inOut");
      toTranslate(tl, handlesGroup, 0, 0, 0.75, "dragBackStart", "power1.inOut");
      tl.to(sourceStateRef.current.s, {
        x: SOURCE_S_START.x,
        y: SOURCE_S_START.y,
        duration: 0.75,
        ease: "power1.inOut",
        onUpdate: commitSource
      }, "dragBackStart");

      tl.add("dragBackEnd", "dragBackStart+=0.75");
      cursor.setPressed(false, "dragBackEnd-=0.14");
      tl.to({}, { duration: 0.26, ease: "none" }, "dragBackEnd");
      cursorPath.glideTo("deselectOutside", 0.4, "dragBackEnd");
      cursor.setStyle("pointer", "dragBackEnd+=0.18");

      // Rest briefly at the outside point before clicking to deselect.
      tl.add("deselectClick", "dragBackEnd+=0.84");
      cursor.setPressed(true, "deselectClick");
      cursor.setPressed(false, "deselectClick+=0.1");
      tl.to(handlesGroup, { autoAlpha: 0, duration: 0.08, ease: "none" }, "deselectClick+=0.03");

      // Return to the exact initial position to keep a seamless loop.
      tl.call(() => {
        sourceStateRef.current.s.x = SOURCE_S_START.x;
        sourceStateRef.current.s.y = SOURCE_S_START.y;
        commitSource();
      }, undefined, "deselectClick");
      cursorPath.moveTo("initialBeside", 0.4, "deselectClick+=0.32");
      cursor.setStyle("pointer", "deselectClick+=0.3");
      cursor.setFrame({ pressed: false }, "deselectClick+=0.3");
    }, rootRef);

    return () => {
      timelineRef.current = null;
      ctx.revert();
    };
  // GSAP owns this mount-time script; callback identities are intentionally excluded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialBounds = {
    x: nodeMoveInitial.sCenter.x - nodeMoveInitial.sRadius,
    y: nodeMoveInitial.sCenter.y - nodeMoveInitial.sRadius,
    width: nodeMoveInitial.sRadius * 2,
    height: nodeMoveInitial.sRadius * 2
  };

  return (
    <figure className="featureDemo" ref={rootRef}>
      <svg className="featureScene" viewBox={sceneViewBox} role="img" aria-labelledby="node-move-demo-title" data-layout-item="canvas.move.demo">
        <title id="node-move-demo-title">Node drag keeps edge attached</title>
        <g
          ref={(el) => {
            sceneRef.current.contentGroup = el;
          }}
        />

        <g
          ref={(el) => {
            sceneRef.current.handlesGroup = el;
          }}
        >
          {renderEditHandlesForBounds({
            bounds: initialBounds,
            handleHalfSize: 1.1,
            handleStrokeWidth: 0.26,
            selectionStrokeWidth: 0.24,
            rotateHandleGap: 5.2
          })}
        </g>

        <CursorOverlay
          ref={cursorOverlayRef}
          x={cursorFrame.x}
          y={cursorFrame.y}
          visible={cursorFrame.visible}
          pressed={cursorFrame.pressed}
          cursor={cursorFrame.cursor}
          scale={0.35}
        />
      </svg>
      <SourcePreview
        ref={sourcePreviewRef}
        lines={buildNodeMoveSourceLines(sourceStateRef.current)}
        managedImperatively
        layoutItemId="canvas.move.source"
      />
    </figure>
  );
}

const nodeMoveInitialEdgeEndpoints = parseMoveLineEndpoints(nodeMoveInitial.edge.lineD);
const nodeMoveMovedEdgeEndpoints = parseMoveLineEndpoints(nodeMoveMoved.edge.lineD);

function applyNodeMoveLineFrame(target: Element, frame: typeof nodeMoveInitial): void {
  const endpoints = frame === nodeMoveMoved ? nodeMoveMovedEdgeEndpoints : nodeMoveInitialEdgeEndpoints;
  applyLinePathEndpoints(target, endpoints.from, endpoints.to);
}

function parseMoveLineEndpoints(d: string): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const numbers = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
  return {
    from: { x: numbers[0] ?? 0, y: numbers[1] ?? 0 },
    to: { x: numbers[2] ?? 0, y: numbers[3] ?? 0 }
  };
}

function interpolatePoint(
  from: { x: number; y: number },
  to: { x: number; y: number },
  progress: number
): { x: number; y: number } {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress
  };
}

function buildNodeMoveSourceLines(state: NodeMoveSourceState): SourceLine[] {
  return [
    sourceLine(
      sourceKeyword("\\node"),
      sourceText("[draw, circle] "),
      sourcePunctuation("(s)"),
      sourceText(" at ("),
      sourceNumber(formatTikzNumber(state.s.x)),
      sourcePunctuation(", "),
      sourceNumber(formatTikzNumber(state.s.y)),
      sourceText(") "),
      sourceString("{$s$};")
    ),
    sourceLine(
      sourceKeyword("\\node"),
      sourceText("[draw, circle] "),
      sourcePunctuation("(t)"),
      sourceText(" at ("),
      sourceNumber(formatTikzNumber(state.t.x)),
      sourcePunctuation(", "),
      sourceNumber(formatTikzNumber(state.t.y)),
      sourceText(") "),
      sourceString("{$t$};")
    ),
    sourceLine(
      sourceKeyword("\\draw"),
      sourceText("[->] "),
      sourcePunctuation("(s)"),
      sourceText(" -- "),
      sourcePunctuation("(t)"),
      sourcePunctuation(";")
    )
  ];
}
