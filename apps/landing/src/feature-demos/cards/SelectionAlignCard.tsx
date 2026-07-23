import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import gsap from "gsap";
import {
  RiAlignItemHorizontalCenterLine,
  RiAlignItemLeftLine,
  RiAlignItemRightLine
} from "@remixicon/react";
import { applyCursorOverlayFrame, CursorOverlay, getCursorOverlayBounds } from "../cursor-overlay";
import { createCursorScript, type CursorFrame, type CursorScript } from "../cursor-script";
import { mountRenderedScene, wrapRenderedElements } from "../animation/rendered-scene";
import { applyLinePathEndpoints, prepareTransformDrivenLinePath, setSvgAttrs } from "../animation/svg-actors";
import { renderEditHandlesForBounds } from "../edit-handles";
import {
  selectionAlignCommonViewBox,
  selectionAlignInitial,
  type SelectionAlignCardState
} from "../generated/feature-svgs";
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

type NodeState = SelectionAlignCardState["leftNodes"][number];
type Rect = { x: number; y: number; width: number; height: number };
type SelectionAlignSourceState = {
  leftNodes: NodeState[];
  rightNodes: NodeState[];
  marquee: Rect | null;
  leftAligned: boolean;
  rightAligned: boolean;
  leftTargetX: number;
};

const BUTTON = {
  width: 14,
  height: 12
};

const TOOLBAR_GAP = 6;
const MARQUEE_PAD = 5.5;
const CURSOR_OVERSHOOT = 2.6;
const CURSOR_SCALE = 0.35;
const HANDLE_HALF_SIZE = 1.05;
const HANDLE_STROKE_WIDTH = 0.26;
const SELECTION_STROKE_WIDTH = 0.24;

function centerAlign(nodes: readonly NodeState[]): NodeState[] {
  const bounds = unionBounds(nodes);
  const targetCenterX = bounds.x + bounds.width / 2;
  return nodes.map((node) => {
    const nodeCenterX = node.bounds.x + node.bounds.width / 2;
    const dx = targetCenterX - nodeCenterX;
    return {
      sourceId: node.sourceId,
      bounds: { ...node.bounds, x: node.bounds.x + dx },
      center: { x: node.center.x + dx, y: node.center.y },
      labelPos: { x: node.labelPos.x + dx, y: node.labelPos.y }
    };
  });
}

function padBounds(bounds: Rect, pad: number): Rect {
  return {
    x: bounds.x - pad,
    y: bounds.y - pad,
    width: bounds.width + pad * 2,
    height: bounds.height + pad * 2
  };
}

function parseViewBox(viewBox: string): Rect {
  const [x, y, width, height] = viewBox.split(/\s+/).map(Number);
  if ([x, y, width, height].some((value) => !Number.isFinite(value))) {
    throw new Error(`Invalid viewBox: ${viewBox}`);
  }
  return { x: x, y: y, width: width, height: height };
}

function formatViewBox(bounds: Rect): string {
  return [bounds.x, bounds.y, bounds.width, bounds.height]
    .map((value) => Number(value.toFixed(4)).toString())
    .join(" ");
}

function unionRects(rects: readonly Rect[]): Rect {
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function handleOverlayBounds(bounds: Rect): Rect {
  return padBounds(bounds, HANDLE_HALF_SIZE + Math.max(HANDLE_STROKE_WIDTH, SELECTION_STROKE_WIDTH) / 2);
}

export function SelectionAlignCard() {
  const rootRef = useRef<HTMLElement | null>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  useDemoTimelinePlayback(rootRef, timelineRef);
  const cursorOverlayRef = useRef<SVGGElement | null>(null);
  const sourcePreviewRef = useRef<HTMLElement | null>(null);
  const sceneRef = useRef<SVGGElement | null>(null);
  const marqueeRef = useRef<SVGRectElement | null>(null);
  const leftOverlayRefs = useRef<Array<SVGGElement | null>>([]);
  const rightOverlayRefs = useRef<Array<SVGGElement | null>>([]);
  const leftSelectedRef = useRef(false);
  const rightSelectedRef = useRef(false);
  const marqueeVisibleRef = useRef(false);
  const toolbarVisibleRef = useRef(false);
  const alignPressedRef = useRef(false);
  const cursorStateRef = useRef<CursorFrame>({
    x: 0,
    y: 0,
    visible: true,
    pressed: false,
    cursor: "pointer"
  });
  const [cursorFrame, setCursorFrame] = useState<CursorFrame>({ ...cursorStateRef.current });
  const [leftSelected, setLeftSelected] = useState(false);
  const [rightSelected, setRightSelected] = useState(false);
  const [marqueeVisible, setMarqueeVisible] = useState(false);
  const [alignPressed, setAlignPressed] = useState(false);
  const [toolbarVisible, setToolbarVisible] = useState(false);

  const leftInitial = selectionAlignInitial.leftNodes;
  const rightInitial = selectionAlignInitial.rightNodes;
  const sourceStateRef = useRef<SelectionAlignSourceState>({
    leftNodes: leftInitial.map(cloneNode),
    rightNodes: rightInitial.map(cloneNode),
    marquee: null,
    leftAligned: false,
    rightAligned: false,
    leftTargetX: 0,
  });

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
    if (sourcePreviewRef.current) {
      renderSourcePreview(sourcePreviewRef.current, buildSelectionAlignSourceLines(sourceStateRef.current));
    }
  };

  const leftFinal = useMemo(() => centerAlign(leftInitial), [leftInitial]);
  const rightFinal = useMemo(() => centerAlign(rightInitial), [rightInitial]);

  const leftBounds = useMemo(() => unionBounds(leftInitial), [leftInitial]);
  const rightBounds = useMemo(() => unionBounds(rightInitial), [rightInitial]);
  const leftTargetX = useMemo(
    () => average(leftInitial.map((node) => node.center.x / 25)),
    [leftInitial]
  );

  const allBounds = useMemo(() => unionBounds([...leftInitial, ...rightInitial]), [leftInitial, rightInitial]);

  const toolbar = useMemo(() => {
    const [vbX, , vbW] = selectionAlignCommonViewBox.split(/\s+/).map(Number);
    const imageCenterX = vbX + vbW / 2;
    const totalWidth = BUTTON.width * 3;
    return {
      x: imageCenterX - totalWidth / 2,
      y: allBounds.y - MARQUEE_PAD - TOOLBAR_GAP - BUTTON.height
    };
  }, [allBounds]);

  const animationViewBox = useMemo(() => {
    const leftMarquee = padBounds(leftBounds, MARQUEE_PAD);
    const rightMarquee = padBounds(rightBounds, MARQUEE_PAD);
    const cursorPoints = [
      {
        cursor: "pointer" as const,
        x: leftMarquee.x - CURSOR_OVERSHOOT - 4,
        y: leftMarquee.y - CURSOR_OVERSHOOT - 3
      },
      {
        cursor: "pointer" as const,
        x: leftMarquee.x - CURSOR_OVERSHOOT,
        y: leftMarquee.y - CURSOR_OVERSHOOT
      },
      {
        cursor: "crosshair" as const,
        x: leftMarquee.x + leftMarquee.width + CURSOR_OVERSHOOT,
        y: leftMarquee.y + leftMarquee.height + CURSOR_OVERSHOOT
      },
      {
        cursor: "pointer" as const,
        x: rightMarquee.x - CURSOR_OVERSHOOT,
        y: rightMarquee.y - CURSOR_OVERSHOOT
      },
      {
        cursor: "crosshair" as const,
        x: rightMarquee.x + rightMarquee.width + CURSOR_OVERSHOOT,
        y: rightMarquee.y + rightMarquee.height + CURSOR_OVERSHOOT
      },
      {
        cursor: "pointer" as const,
        x: toolbar.x + BUTTON.width + BUTTON.width / 2,
        y: toolbar.y + BUTTON.height / 2
      }
    ];

    const rects: Rect[] = [
      parseViewBox(selectionAlignCommonViewBox),
      leftMarquee,
      rightMarquee,
      { x: toolbar.x, y: toolbar.y, width: BUTTON.width * 3, height: BUTTON.height },
      ...leftInitial.map((node) => handleOverlayBounds(node.bounds)),
      ...rightInitial.map((node) => handleOverlayBounds(node.bounds)),
      ...leftFinal.map((node) => handleOverlayBounds(node.bounds)),
      ...rightFinal.map((node) => handleOverlayBounds(node.bounds)),
      ...cursorPoints.map((point) => getCursorOverlayBounds(point.cursor, point.x, point.y, CURSOR_SCALE))
    ];

    return formatViewBox(unionRects(rects));
  }, [leftBounds, rightBounds, toolbar, leftInitial, rightInitial, leftFinal, rightFinal]);

  useLayoutEffect(() => {
    if (!rootRef.current || !sceneRef.current) {
      return;
    }

    mountRenderedScene(sceneRef.current, selectionAlignInitial.innerSvg);

    const leftNodePaths = leftInitial.map((node) => queryNodePath(sceneRef.current!, node));
    const leftLabels = leftInitial.map((node) => queryNodeLabel(sceneRef.current!, node));
    const rightNodePaths = rightInitial.map((node) => queryNodePath(sceneRef.current!, node));
    const rightLabels = rightInitial.map((node) => queryNodeLabel(sceneRef.current!, node));
    const leftNodeGroups = leftNodePaths.map((path, index) =>
      path && leftLabels[index] ? wrapRenderedElements([path, leftLabels[index]], "animatedNodeGroup") : null
    );
    const rightNodeGroups = rightNodePaths.map((path, index) =>
      path && rightLabels[index] ? wrapRenderedElements([path, rightLabels[index]], "animatedNodeGroup") : null
    );
    const edgePaths = Array.from(
      sceneRef.current.querySelectorAll('path[data-source-id][fill="none"][stroke="black"]:not([data-arrow-tip-kind])')
    );

    if (
      leftNodePaths.some((el) => !el) ||
      leftLabels.some((el) => !el) ||
      leftNodeGroups.some((el) => !el) ||
      rightNodePaths.some((el) => !el) ||
      rightLabels.some((el) => !el) ||
      rightNodeGroups.some((el) => !el) ||
      edgePaths.length < leftInitial.length * rightInitial.length
    ) {
      return;
    }

    const leftStates: NodeState[] = leftInitial.map((node) => cloneNode(node));
    const rightStates: NodeState[] = rightInitial.map((node) => cloneNode(node));
    edgePaths.forEach(prepareTransformDrivenLinePath);

    const updateEdges = (): void => {
      let edgeIndex = 0;
      for (const left of leftStates) {
        for (const right of rightStates) {
          const from = { x: left.bounds.x + left.bounds.width, y: left.center.y };
          const to = { x: right.bounds.x, y: right.center.y };
          applyLinePathEndpoints(edgePaths[edgeIndex], from, to);
          edgeIndex += 1;
        }
      }
    };

    const updateGroup = (
      states: NodeState[],
      initials: readonly NodeState[],
      nodeGroups: (SVGGElement | null)[],
      overlays: Array<SVGGElement | null>,
      visible: boolean
    ): void => {
      states.forEach((state, index) => {
        const nodeGroup = nodeGroups[index];
        const group = overlays[index];
        const initial = initials[index];
        if (nodeGroup && initial) {
          gsap.set(nodeGroup, {
            x: state.bounds.x - initial.bounds.x,
            y: state.bounds.y - initial.bounds.y
          });
        }
        if (group && initial) {
          group.style.display = visible ? "inline" : "none";
          setSvgAttrs(group, {
            transform: `translate(${state.bounds.x - initial.bounds.x} ${state.bounds.y - initial.bounds.y})`
          });
        }
      });
    };

    const updateMarquee = (): void => {
      const rect = marqueeRef.current;
      if (!rect) return;
      setSvgAttrs(rect, {
        x: marqueeState.x,
        y: marqueeState.y,
        width: marqueeState.width,
        height: marqueeState.height
      });
      rect.style.display = marqueeVisibleRef.current ? "inline" : "none";
    };

    const updateAll = (): void => {
      updateGroup(leftStates, leftInitial, leftNodeGroups, leftOverlayRefs.current, leftSelectedRef.current);
      updateGroup(rightStates, rightInitial, rightNodeGroups, rightOverlayRefs.current, rightSelectedRef.current);
      updateEdges();
      updateMarquee();
    sourceStateRef.current.leftNodes = leftStates.map(cloneNode);
    sourceStateRef.current.rightNodes = rightStates.map(cloneNode);
    sourceStateRef.current.marquee = marqueeVisibleRef.current ? { ...marqueeState } : null;
    sourceStateRef.current.leftTargetX = leftTargetX;
    commitSource();
    };

    const marqueeState: Rect = { x: 0, y: 0, width: 0.001, height: 0.001 };

    const resetAll = (): void => {
      leftSelectedRef.current = false;
      rightSelectedRef.current = false;
      marqueeVisibleRef.current = false;
      toolbarVisibleRef.current = false;
      alignPressedRef.current = false;
      setLeftSelected(false);
      setRightSelected(false);
      setToolbarVisible(false);
      setAlignPressed(false);
      setMarqueeVisible(false);
      marqueeState.x = 0;
      marqueeState.y = 0;
      marqueeState.width = 0.001;
      marqueeState.height = 0.001;
      sourceStateRef.current.marquee = null;
      sourceStateRef.current.leftAligned = false;
      sourceStateRef.current.rightAligned = false;
      sourceStateRef.current.leftTargetX = leftTargetX;
      commitSource();
      leftStates.forEach((state, index) => {
        Object.assign(state.bounds, leftInitial[index].bounds);
        Object.assign(state.center, leftInitial[index].center);
        Object.assign(state.labelPos, leftInitial[index].labelPos);
      });
      rightStates.forEach((state, index) => {
        Object.assign(state.bounds, rightInitial[index].bounds);
        Object.assign(state.center, rightInitial[index].center);
        Object.assign(state.labelPos, rightInitial[index].labelPos);
      });
      updateAll();
    };

    const toolbarCenter = {
      x: toolbar.x + BUTTON.width + BUTTON.width / 2,
      y: toolbar.y + BUTTON.height / 2
    };

    const runPhase = (
      tl: gsap.core.Timeline,
      cursor: CursorScript,
      label: string,
      options: {
        selectionBounds: Rect;
        states: NodeState[];
        finals: NodeState[];
        selectedRef: { current: boolean };
        setSelected: (v: boolean) => void;
        showLeftAfter: boolean;
        showRightAfter: boolean;
        sourceAlignSide: "left" | "right";
      }
    ): string => {
      const marqueeTarget = padBounds(options.selectionBounds, MARQUEE_PAD);
      const anchor = {
        x: marqueeTarget.x - CURSOR_OVERSHOOT,
        y: marqueeTarget.y - CURSOR_OVERSHOOT
      };
      const dragTip = {
        x: marqueeTarget.x + marqueeTarget.width + CURSOR_OVERSHOOT,
        y: marqueeTarget.y + marqueeTarget.height + CURSOR_OVERSHOOT
      };

      const move = `${label}-move`;
      const press = `${label}-press`;
      const release = `${label}-release`;
      const btnMove = `${label}-btnMove`;
      const btnHover = `${label}-btnHover`;
      const btnPress = `${label}-btnPress`;
      const end = `${label}-end`;

      tl.add(move);
      cursor.setStyle("pointer", move);
      cursor.glideTo(anchor.x, anchor.y, 0.36, move);
      tl.to({}, { duration: 0.18, ease: "none" }, `${move}+=0.36`);

      tl.add(press, `${move}+=0.54`);
      cursor.setPressed(true, press);
      cursor.setStyle("crosshair", press);

      tl.call(() => {
        marqueeState.x = marqueeTarget.x;
        marqueeState.y = marqueeTarget.y;
        marqueeState.width = 0.001;
        marqueeState.height = 0.001;
        marqueeVisibleRef.current = true;
        setMarqueeVisible(true);
        updateMarquee();
        sourceStateRef.current.marquee = { ...marqueeTarget };
        commitSource();
      }, undefined, press);

      tl.to(
        marqueeState,
        {
          width: marqueeTarget.width,
          height: marqueeTarget.height,
          duration: 0.7,
          ease: "power1.inOut",
          onUpdate: updateMarquee
        },
        `${press}+=0.06`
      );
      cursor.moveTo(dragTip.x, dragTip.y, 0.7, `${press}+=0.06`, "power1.inOut");

      tl.add(release, `${press}+=0.82`);
      cursor.setPressed(false, release);

      tl.call(() => {
        options.selectedRef.current = true;
        options.setSelected(true);
        toolbarVisibleRef.current = true;
        setToolbarVisible(true);
        marqueeVisibleRef.current = false;
        setMarqueeVisible(false);
        updateAll();
        commitCursorFrame();
      }, undefined, `${release}+=0.04`);

      tl.add(btnMove, `${release}+=0.3`);
      cursor.setStyle("pointer", btnMove);
      cursor.glideTo(toolbarCenter.x, toolbarCenter.y, 0.46, btnMove);

      tl.add(btnHover, `${btnMove}+=0.48`);
      tl.to({}, { duration: 0.36, ease: "none" }, btnHover);

      tl.add(btnPress, `${btnHover}+=0.36`);
      cursor.setPressed(true, btnPress);
      tl.call(() => {
        alignPressedRef.current = true;
        setAlignPressed(true);
      }, undefined, btnPress);

      tl.call(() => {
        options.states.forEach((state, index) => {
          const final = options.finals[index];
          Object.assign(state.bounds, final.bounds);
          Object.assign(state.center, final.center);
          Object.assign(state.labelPos, final.labelPos);
        });
        if (options.sourceAlignSide === "left") {
          sourceStateRef.current.leftAligned = true;
        } else {
          sourceStateRef.current.rightAligned = true;
        }
        updateAll();
        commitCursorFrame();
      }, undefined, `${btnPress}+=0.08`);

      tl.to({}, { duration: 0.14, ease: "none" }, `${btnPress}+=0.24`);
      cursor.setPressed(false, `${btnPress}+=0.18`);
      tl.call(() => {
        alignPressedRef.current = false;
        setAlignPressed(false);
      }, undefined, `${btnPress}+=0.24`);

      tl.add(end, `${btnPress}+=0.7`);
      // Optionally clear selection for hand-off to next phase.
      tl.call(() => {
        if (!options.showLeftAfter) {
          leftSelectedRef.current = false;
          setLeftSelected(false);
        }
        if (!options.showRightAfter) {
          rightSelectedRef.current = false;
          setRightSelected(false);
        }
        toolbarVisibleRef.current = false;
        setToolbarVisible(false);
        updateAll();
        commitCursorFrame();
      }, undefined, end);

      return end;
    };

    const ctx = gsap.context(() => {
      const startPos = {
        x: padBounds(leftBounds, MARQUEE_PAD).x - CURSOR_OVERSHOOT - 4,
        y: padBounds(leftBounds, MARQUEE_PAD).y - CURSOR_OVERSHOOT - 3
      };
      Object.assign(cursorStateRef.current, {
        x: startPos.x,
        y: startPos.y,
        visible: true,
        pressed: false,
        cursor: "pointer"
      });
      commitCursorFrame();
      resetAll();

      const tl = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 0.9 });
      timelineRef.current = tl;
      const cursor = createCursorScript(tl, cursorStateRef.current, {
        onPositionChange: commitCursorPosition,
        onFrameChange: commitCursorFrame
      });

      tl.to({}, { duration: 0.22, ease: "none" }, 0);

      const afterLeft = runPhase(tl, cursor, "left", {
        selectionBounds: leftBounds,
        states: leftStates,
        finals: leftFinal,
        selectedRef: leftSelectedRef,
        setSelected: setLeftSelected,
        showLeftAfter: false,
        showRightAfter: false,
        sourceAlignSide: "left"
      });

      const afterRight = runPhase(tl, cursor, "right", {
        selectionBounds: rightBounds,
        states: rightStates,
        finals: rightFinal,
        selectedRef: rightSelectedRef,
        setSelected: setRightSelected,
        showLeftAfter: true,
        showRightAfter: false,
        sourceAlignSide: "right"
      });
      // Position the right phase after the left phase finishes.
      // (runPhase already appends sequentially via bare labels.)
      void afterLeft;
      void afterRight;

      tl.add("reset", `${afterRight}+=0.2`);
      cursor.moveTo(startPos.x, startPos.y, 0.4, "reset", "power1.inOut");
      tl.call(resetAll, undefined, "reset+=0.05");
      cursor.setStyle("pointer", "reset+=0.26");
    }, rootRef);

    return () => {
      timelineRef.current = null;
      ctx.revert();
    };
  // GSAP owns this mount-time script; callback identities are intentionally excluded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftBounds, rightBounds, leftInitial, rightInitial, leftFinal, rightFinal, toolbar]);

  return (
    <figure className="featureDemo" ref={rootRef}>
      <svg className="featureScene" viewBox={animationViewBox} role="img" aria-labelledby="selection-align-demo-title" data-layout-item="layout.align.demo">
        <title id="selection-align-demo-title">Marquee select and align center</title>
        <g ref={(el) => { sceneRef.current = el; }} />

        <rect
          ref={marqueeRef}
          x={0}
          y={0}
          width={0.001}
          height={0.001}
          className="marqueeRect"
          style={{ display: marqueeVisible ? "inline" : "none" }}
        />

        {leftInitial.map((node, index) => (
          <g
            key={node.sourceId}
            ref={(el) => { leftOverlayRefs.current[index] = el; }}
            style={{ display: leftSelected ? "inline" : "none" }}
          >
            {renderEditHandlesForBounds({
              bounds: node.bounds,
              showRotateHandle: false,
              handleHalfSize: HANDLE_HALF_SIZE,
              handleStrokeWidth: HANDLE_STROKE_WIDTH,
              selectionStrokeWidth: SELECTION_STROKE_WIDTH,
              rotateHandleGap: 5.2
            })}
          </g>
        ))}

        {rightInitial.map((node, index) => (
          <g
            key={node.sourceId}
            ref={(el) => { rightOverlayRefs.current[index] = el; }}
            style={{ display: rightSelected ? "inline" : "none" }}
          >
            {renderEditHandlesForBounds({
              bounds: node.bounds,
              showRotateHandle: false,
              handleHalfSize: HANDLE_HALF_SIZE,
              handleStrokeWidth: HANDLE_STROKE_WIDTH,
              selectionStrokeWidth: SELECTION_STROKE_WIDTH,
              rotateHandleGap: 5.2
            })}
          </g>
        ))}

        <g style={{ opacity: toolbarVisible ? 1 : 0, transition: "opacity 120ms linear" }}>
          <ToolbarButton x={toolbar.x} y={toolbar.y} active={false} label="Align left">
            <RiAlignItemLeftLine size={14} />
          </ToolbarButton>
          <ToolbarButton x={toolbar.x + BUTTON.width} y={toolbar.y} active={alignPressed} label="Align center">
            <RiAlignItemHorizontalCenterLine size={14} />
          </ToolbarButton>
          <ToolbarButton x={toolbar.x + BUTTON.width * 2} y={toolbar.y} active={false} label="Align right">
            <RiAlignItemRightLine size={14} />
          </ToolbarButton>
        </g>

        <CursorOverlay
          ref={cursorOverlayRef}
          x={cursorFrame.x}
          y={cursorFrame.y}
          visible={cursorFrame.visible}
          pressed={cursorFrame.pressed}
          cursor={cursorFrame.cursor}
          scale={CURSOR_SCALE}
        />
      </svg>
      <SourcePreview
        ref={sourcePreviewRef}
        lines={buildSelectionAlignSourceLines(sourceStateRef.current)}
        managedImperatively
        layoutItemId="layout.align.source"
      />
    </figure>
  );
}

function buildSelectionAlignSourceLines(state: SelectionAlignSourceState): SourceLine[] {
  const leftLabels = ["Start", "Mid", "Bottom"];
  const rightLabels = ["End", "End", "End"];
  const lines: SourceLine[] = [];
  const rowYs = [1, 0, -1.3];
  const leftPositions = state.leftNodes.map((node, index) => ({
    x: state.leftAligned ? state.leftTargetX : node.center.x / 25,
    y: rowYs[index] ?? rowYs[rowYs.length - 1]
  }));
  const rightPositions = state.rightNodes.map((node, index) => ({
    x: state.rightAligned ? 1.9 : node.center.x / 25,
    y: rowYs[index] ?? rowYs[rowYs.length - 1]
  }));

  leftLabels.forEach((labelText, index) => {
    const pos = leftPositions[index] ?? leftPositions[leftPositions.length - 1];
    lines.push(
      sourceLine(
        sourceKeyword("\\node"),
        sourceText("[draw, fill=blue!10] "),
        sourcePunctuation("("),
        sourceText(`l${index + 1}`),
        sourcePunctuation(") at ("),
        sourceNumber(formatTikzNumber(pos.x)),
        sourcePunctuation(", "),
        sourceNumber(formatTikzNumber(pos.y)),
        sourcePunctuation(") "),
        sourceString(`{${labelText}};`)
      )
    );
  });

  rightLabels.forEach((labelText, index) => {
    const pos = rightPositions[index] ?? rightPositions[rightPositions.length - 1];
    lines.push(
      sourceLine(
        sourceKeyword("\\node"),
        sourceText("[draw, fill=green!10] "),
        sourcePunctuation("("),
        sourceText(`r${index + 1}`),
        sourcePunctuation(") at ("),
        sourceNumber(formatTikzNumber(pos.x)),
        sourcePunctuation(", "),
        sourceNumber(formatTikzNumber(pos.y)),
        sourcePunctuation(") "),
        sourceString(`{${labelText}};`)
      )
    );
  });

  return lines;
}

function ToolbarButton({
  x,
  y,
  active,
  label,
  children
}: {
  x: number;
  y: number;
  active: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <g aria-label={label} transform={`translate(${x} ${y})`}>
      <rect
        width={BUTTON.width}
        height={BUTTON.height}
        rx={0.4}
        ry={0.4}
        fill={active ? "color-mix(in srgb, var(--text) 18%, transparent)" : "var(--btn-disabled-bg)"}
        stroke="var(--border-light)"
        strokeWidth={0.3}
      />
      <g transform={`translate(${BUTTON.width / 2} ${BUTTON.height / 2}) scale(${BUTTON.height * 0.75 / 14})`} style={{ color: active ? "var(--text)" : "var(--text-faint)" }}>
        <g transform="translate(-7 -7)">{children}</g>
      </g>
    </g>
  );
}

function queryNodePath(root: ParentNode, node: NodeState): SVGPathElement | null {
  return root.querySelector<SVGPathElement>(`path[data-source-id="${node.sourceId}"]:not([fill="none"])`);
}

function queryNodeLabel(root: ParentNode, node: NodeState): SVGImageElement | null {
  return root.querySelector<SVGImageElement>(`[data-source-id="${node.sourceId}"][data-text-renderer="tex"]`);
}

function cloneNode(node: NodeState): NodeState {
  return {
    sourceId: node.sourceId,
    bounds: { ...node.bounds },
    center: { ...node.center },
    labelPos: { ...node.labelPos }
  };
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function unionBounds(nodes: readonly NodeState[]): Rect {
  const xs = nodes.flatMap((node) => [node.bounds.x, node.bounds.x + node.bounds.width]);
  const ys = nodes.flatMap((node) => [node.bounds.y, node.bounds.y + node.bounds.height]);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  };
}
