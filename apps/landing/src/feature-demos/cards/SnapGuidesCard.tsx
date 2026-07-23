import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { applyCursorOverlayFrame, CursorOverlay } from "../cursor-overlay";
import { CURSOR_FOR_DRAG } from "../cursor-conventions";
import { createCursorScript, type CursorFrame } from "../cursor-script";
import { createCursorPathScript } from "../animation/cursor-path";
import { SnapGuidesOverlay, type SnapGuideLine } from "../animation/snap-guides";
import { mountRenderedScene, wrapRenderedElements } from "../animation/rendered-scene";
import { snapGuidesCommonViewBox, snapGuidesFinal, snapGuidesInitial } from "../generated/feature-svgs";
import {
  formatTikzNumber,
  sourceKeyword,
  sourceLine,
  sourcePunctuation,
  SourcePreview,
  renderSourcePreview,
  sourceNumber,
  sourceString,
  sourceText,
  type SourceLine
} from "../source-preview";
import { useDemoTimelinePlayback } from "../use-demo-playback";

type RectNode = {
  sourceId: string;
  bounds: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  labelPos: { x: number; y: number };
};

type SnapGuidesSourceState = {
  d: { x: number; y: number };
};

const SNAP_STROKE_WIDTH = 0.9;
const SNAP_CROSS_SIZE = 1.6;
const SNAP_APPROACH_DISTANCE = 2.8;
const SOURCE_D_START = { x: 0.2, y: -0.1 };
const SOURCE_D_END = { x: 1.1, y: -0.8 };

const SNAP_IDLE_START = {
  x: snapGuidesInitial.movingNode.center.x + 15.5,
  y: snapGuidesInitial.movingNode.center.y - 0.2
};

type SnapGuidesCardProps = {
  sceneViewBox?: string;
};

export function SnapGuidesCard({ sceneViewBox = snapGuidesCommonViewBox }: SnapGuidesCardProps = {}) {
  const rootRef = useRef<HTMLElement | null>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  useDemoTimelinePlayback(rootRef, timelineRef);
  const cursorOverlayRef = useRef<SVGGElement | null>(null);
  const sourcePreviewRef = useRef<HTMLElement | null>(null);
  const sceneRef = useRef<SVGGElement | null>(null);
  const cursorStateRef = useRef<CursorFrame>({
    x: SNAP_IDLE_START.x,
    y: SNAP_IDLE_START.y,
    visible: true,
    pressed: false,
    cursor: CURSOR_FOR_DRAG.element
  });
  const [cursorFrame, setCursorFrame] = useState<CursorFrame>({ ...cursorStateRef.current });
  const [snapLines, setSnapLines] = useState<SnapGuideLine[]>([]);
  const snapLinesKeyRef = useRef("hidden");
  const sourceStateRef = useRef<SnapGuidesSourceState>({
    d: { ...SOURCE_D_START }
  });
  const lastSourceKeyRef = useRef<string | null>(null);
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
    const sourceKey = `${formatTikzNumber(sourceStateRef.current.d.x)}|${formatTikzNumber(sourceStateRef.current.d.y)}`;
    if (lastSourceKeyRef.current === sourceKey) {
      return;
    }
    lastSourceKeyRef.current = sourceKey;
    if (sourcePreviewRef.current) {
      renderSourcePreview(sourcePreviewRef.current, buildSnapGuidesSourceLines(sourceStateRef.current));
    }
  };
  const commitSnapLines = (nextLines: SnapGuideLine[]): void => {
    const nextKey = nextLines.map(snapLineKey).join("|") || "hidden";
    if (snapLinesKeyRef.current === nextKey) {
      return;
    }
    snapLinesKeyRef.current = nextKey;
    setSnapLines(nextLines);
  };

  useLayoutEffect(() => {
    if (!rootRef.current || !sceneRef.current) {
      return;
    }

    mountRenderedScene(sceneRef.current, snapGuidesInitial.innerSvg);

    const movingNode = queryNode(sceneRef.current, snapGuidesInitial.movingNode);
    const movingLabel = queryLabel(sceneRef.current, snapGuidesInitial.movingNode);
    if (!movingNode || !movingLabel) {
      return;
    }
    const movingGroup = wrapRenderedElements([movingNode, movingLabel], "animatedNodeGroup");
    if (!movingGroup) {
      return;
    }

    const moveState: RectNode = cloneNode(snapGuidesInitial.movingNode);
    const finalCenter = { ...snapGuidesFinal.movingNode.center };
    const initialCenter = { ...snapGuidesInitial.movingNode.center };
    const peerX = snapGuidesFinal.peerX;
    const peerY = snapGuidesFinal.peerY;
    const travelVector = {
      x: finalCenter.x - initialCenter.x,
      y: finalCenter.y - initialCenter.y
    };
    const travelLength = Math.hypot(travelVector.x, travelVector.y) || 1;
    const preSnapCenter = {
      x: finalCenter.x - (travelVector.x / travelLength) * SNAP_APPROACH_DISTANCE,
      y: finalCenter.y - (travelVector.y / travelLength) * SNAP_APPROACH_DISTANCE
    };
    const preSnapBounds = {
      x: preSnapCenter.x - moveState.bounds.width / 2,
      y: preSnapCenter.y - moveState.bounds.height / 2,
      width: moveState.bounds.width,
      height: moveState.bounds.height
    };
    const cursorGrabOffsetX = snapGuidesInitial.movingNode.bounds.width * 0.22;
    const cursorGrabOffsetY = snapGuidesInitial.movingNode.bounds.height * 0.22;
    const finalGrab = {
      x: finalCenter.x + cursorGrabOffsetX,
      y: finalCenter.y + cursorGrabOffsetY
    };

    const updateSourceD = (): void => {
      const travelDx = finalCenter.x - initialCenter.x;
      const travelDy = finalCenter.y - initialCenter.y;
      const currentDx = moveState.center.x - initialCenter.x;
      const currentDy = moveState.center.y - initialCenter.y;
      const denom = travelDx * travelDx + travelDy * travelDy || 1;
      const progress = Math.max(0, Math.min(1, (currentDx * travelDx + currentDy * travelDy) / denom));
      sourceStateRef.current.d.x = SOURCE_D_START.x + progress * (SOURCE_D_END.x - SOURCE_D_START.x);
      sourceStateRef.current.d.y = SOURCE_D_START.y + progress * (SOURCE_D_END.y - SOURCE_D_START.y);
      commitSource();
    };

    const updateMoving = (showSnapLines: boolean): void => {
      updateSourceD();
      gsap.set(movingGroup, {
        x: moveState.bounds.x - snapGuidesInitial.movingNode.bounds.x,
        y: moveState.bounds.y - snapGuidesInitial.movingNode.bounds.y
      });

      const nextLines: SnapGuideLine[] = [];
      if (showSnapLines) {
        nextLines.push({
          type: "points",
          axis: "x",
          points: [
            { x: peerX.center.x, y: peerX.center.y },
            { x: finalCenter.x, y: finalCenter.y }
          ]
        });
      }
      if (showSnapLines) {
        nextLines.push({
          type: "points",
          axis: "y",
          points: [
            { x: peerY.center.x, y: peerY.center.y },
            { x: finalCenter.x, y: finalCenter.y }
          ]
        });
      }
      commitSnapLines(nextLines);
    };

    updateMoving(false);
    Object.assign(cursorStateRef.current, {
      x: SNAP_IDLE_START.x,
      y: SNAP_IDLE_START.y,
      visible: true,
      pressed: false,
      cursor: "pointer"
    });
    commitCursorFrame();

    const ctx = gsap.context(() => {
      Object.assign(cursorStateRef.current, {
        x: SNAP_IDLE_START.x,
        y: SNAP_IDLE_START.y,
        visible: true,
        pressed: false,
        cursor: "pointer"
      });
      commitCursorFrame();
      commitSnapLines([]);

      const tl = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 0.8 });
      timelineRef.current = tl;
      tl.eventCallback("onRepeat", () => {
        sourceStateRef.current.d = { ...SOURCE_D_START };
        commitSource();
      });
      const cursor = createCursorScript(tl, cursorStateRef.current, {
        onPositionChange: commitCursorPosition,
        onFrameChange: commitCursorFrame
      });
      const hoverHold = 0.18;
      const cursorPath = createCursorPathScript(cursor, {
        idleAbove: SNAP_IDLE_START,
        hoverOnNode: { x: snapGuidesInitial.movingNode.center.x + cursorGrabOffsetX, y: snapGuidesInitial.movingNode.center.y + cursorGrabOffsetY },
        dragToTarget: finalGrab,
        releaseAbove: { x: finalGrab.x + 0.3, y: finalGrab.y - 1.2 }
      });

      cursor.setStyle("pointer", 0);
      tl.to({}, { duration: 0.28, ease: "none" }, 0);

      tl.add("hoverMove");
      cursorPath.glideTo("hoverOnNode", 0.34, "hoverMove");
      cursor.setStyle(CURSOR_FOR_DRAG.element, "hoverMove+=0.34");
      tl.to({}, { duration: hoverHold, ease: "none" }, "hoverMove+=0.34");

      tl.add("press", `hoverMove+=${0.34 + hoverHold}`);
      cursor.setPressed(true, "press");

      tl.add("drag", "press+=0.12");
      cursorPath.moveTo("dragToTarget", 0.84, "drag", "power1.inOut");
      tl.to(moveState.bounds, {
        x: preSnapBounds.x,
        y: preSnapBounds.y,
        duration: 0.84,
        ease: "power1.inOut",
        onUpdate: () => {
          moveState.center.x = moveState.bounds.x + moveState.bounds.width / 2;
          moveState.center.y = moveState.bounds.y + moveState.bounds.height / 2;
          moveState.labelPos.x = snapGuidesInitial.movingNode.labelPos.x + (moveState.bounds.x - snapGuidesInitial.movingNode.bounds.x);
          moveState.labelPos.y = snapGuidesInitial.movingNode.labelPos.y + (moveState.bounds.y - snapGuidesInitial.movingNode.bounds.y);
          updateMoving(false);
        }
      }, "drag");
      tl.call(() => {
        Object.assign(moveState.bounds, snapGuidesFinal.movingNode.bounds);
        Object.assign(moveState.center, snapGuidesFinal.movingNode.center);
        Object.assign(moveState.labelPos, snapGuidesFinal.movingNode.labelPos);
        updateMoving(true);
      }, undefined, "drag+=0.92");
      cursorPath.jumpTo("dragToTarget", "drag+=0.92");

      // Hold at snapped position so viewer can see the guides.
      tl.to({}, { duration: 0.6, ease: "none" }, "drag+=0.92");

      tl.add("release", "drag+=1.52");
      cursor.setPressed(false, "release");
      cursor.setStyle("pointer", "release");
      tl.call(() => {
        commitSnapLines([]);
      }, undefined, "release+=0.05");

      tl.add("reset", "release+=0.4");
      cursorPath.moveTo("idleAbove", 0.4, "reset", "power1.inOut");
      tl.call(() => {
        Object.assign(moveState.bounds, snapGuidesInitial.movingNode.bounds);
        Object.assign(moveState.center, snapGuidesInitial.movingNode.center);
        Object.assign(moveState.labelPos, snapGuidesInitial.movingNode.labelPos);
        updateMoving(false);
      }, undefined, "reset");
      cursor.setStyle("pointer", "reset+=0.3");
    }, rootRef);

    return () => {
      timelineRef.current = null;
      ctx.revert();
    };
  // GSAP owns this mount-time script; callback identities are intentionally excluded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <figure className="featureDemo" ref={rootRef}>
      <svg className="featureScene" viewBox={sceneViewBox} role="img" aria-labelledby="snap-guides-demo-title" data-layout-item="layout.snap.demo">
        <title id="snap-guides-demo-title">Snap guides appear while moving a node</title>
        <g ref={sceneRef} />
        <SnapGuidesOverlay lines={snapLines} strokeWidth={SNAP_STROKE_WIDTH} crossSize={SNAP_CROSS_SIZE} />
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
        lines={buildSnapGuidesSourceLines(sourceStateRef.current)}
        managedImperatively
        layoutItemId="layout.snap.source"
      />
    </figure>
  );
}

function buildSnapGuidesSourceLines(state: SnapGuidesSourceState): SourceLine[] {
  return [
    sourceLine(
      sourceKeyword("\\node"),
      sourceText("[draw] "),
      sourcePunctuation("(A)"),
      sourceText(" at ("),
      sourceNumber("-1.1"),
      sourcePunctuation(", "),
      sourceNumber("0.8"),
      sourcePunctuation(") "),
      sourceString("{A};")
    ),
    sourceLine(
      sourceKeyword("\\node"),
      sourceText("[draw] "),
      sourcePunctuation("(B)"),
      sourceText(" at ("),
      sourceNumber("1.1"),
      sourcePunctuation(", "),
      sourceNumber("0.8"),
      sourcePunctuation(") "),
      sourceString("{B};")
    ),
    sourceLine(
      sourceKeyword("\\node"),
      sourceText("[draw] "),
      sourcePunctuation("(C)"),
      sourceText(" at ("),
      sourceNumber("-1.1"),
      sourcePunctuation(", "),
      sourceNumber("-0.8"),
      sourcePunctuation(") "),
      sourceString("{C};")
    ),
    sourceLine(
      sourceKeyword("\\node"),
      sourceText("[draw] "),
      sourcePunctuation("(D)"),
      sourceText(" at ("),
      sourceNumber(formatTikzNumber(state.d.x)),
      sourcePunctuation(", "),
      sourceNumber(formatTikzNumber(state.d.y)),
      sourcePunctuation(") "),
      sourceString("{D};")
    )
  ];
}

function queryNode(root: ParentNode, node: RectNode): SVGPathElement | null {
  return root.querySelector<SVGPathElement>(`path[data-source-id="${node.sourceId}"]:not([fill="none"])`);
}

function queryLabel(root: ParentNode, node: RectNode): SVGImageElement | null {
  return root.querySelector<SVGImageElement>(`[data-source-id="${node.sourceId}"][data-text-renderer="tex"]`);
}

function snapLineKey(line: SnapGuideLine): string {
  if (line.type === "points") {
    return `points:${line.axis}:${line.points.map(pointKey).join(";")}`;
  }
  if (line.type === "pointer") {
    return `pointer:${line.axis}:${pointKey(line.from)}:${pointKey(line.to)}`;
  }
  return `gap:${line.direction}:${line.gapKind}:${line.segments
    .map(([from, to]) => `${pointKey(from)}-${pointKey(to)}`)
    .join(";")}`;
}

function pointKey(point: { x: number; y: number }): string {
  return `${point.x},${point.y}`;
}

function cloneNode(node: RectNode): RectNode {
  return {
    sourceId: node.sourceId,
    bounds: { ...node.bounds },
    center: { ...node.center },
    labelPos: { ...node.labelPos }
  };
}
