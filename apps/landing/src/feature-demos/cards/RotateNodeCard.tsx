import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { applyCursorOverlayFrame, CursorOverlay } from "../cursor-overlay";
import { CURSOR_FOR_ROTATE_HANDLE } from "../cursor-conventions";
import { createCursorScript, type CursorFrame } from "../cursor-script";
import { renderEditHandlesForBounds } from "../edit-handles";
import { rotateNodeInitial } from "../generated/feature-svgs";
import { createCursorPathScript } from "../animation/cursor-path";
import { offsetPoint, point, rotatePointAround } from "../animation/points";
import { mountRenderedScene } from "../animation/rendered-scene";
import { toSvgRotation } from "../animation/svg-actors";
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

type SceneRefs = {
  contentGroup: SVGGElement | null;
  handlesGroup: SVGGElement | null;
};

export function RotateNodeCard() {
  const rootRef = useRef<HTMLElement | null>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  useDemoTimelinePlayback(rootRef, timelineRef);
  const cursorOverlayRef = useRef<SVGGElement | null>(null);
  const sourcePreviewRef = useRef<HTMLElement | null>(null);
  const sceneRef = useRef<SceneRefs>({
    contentGroup: null,
    handlesGroup: null
  });
  const sourceStateRef = useRef({ rotation: 0 });
  const lastSourceKeyRef = useRef<string | null>(null);
  const cursorStateRef = useRef<CursorFrame>({
    x: rotateNodeInitial.center.x - rotateNodeInitial.bounds.width / 2 - 28,
    y: rotateNodeInitial.center.y + rotateNodeInitial.bounds.height / 2 + 2,
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
    const sourceKey = formatTikzNumber(sourceStateRef.current.rotation);
    if (lastSourceKeyRef.current === sourceKey) {
      return;
    }
    lastSourceKeyRef.current = sourceKey;
    if (sourcePreviewRef.current) {
      renderSourcePreview(sourcePreviewRef.current, buildRotateNodeSourceLines(sourceStateRef.current.rotation));
    }
  };

  useLayoutEffect(() => {
    if (!rootRef.current) {
      return;
    }

    const { contentGroup, handlesGroup } = sceneRef.current;
    if (!contentGroup || !handlesGroup) {
      return;
    }

    mountRenderedScene(contentGroup, rotateNodeInitial.innerSvg);

    const bodyPath = contentGroup.querySelector<SVGPathElement>('path[data-source-id="path:1"]:not([data-arrow-tip-kind])');
    const labelSvg = contentGroup.querySelector<SVGImageElement>('[data-source-id="path:1"][data-text-renderer="tex"]');
    if (!bodyPath || !labelSvg) {
      return;
    }

    const center = point(rotateNodeInitial.center.x, rotateNodeInitial.center.y);
    const bounds = rotateNodeInitial.bounds;
    const handleGap = 6.6;
    const handleStart = point(center.x, bounds.y - handleGap);
    const handleDragEnd = rotatePointAround(handleStart, center, 28);
    const initialBeside = offsetPoint(handleStart, -30, 2);

    const svgOrigin = `${center.x} ${center.y}`;

    Object.assign(cursorStateRef.current, {
      x: initialBeside.x,
      y: initialBeside.y,
      visible: true,
      pressed: false,
      cursor: "pointer"
    });
    commitCursorFrame();
    sourceStateRef.current.rotation = 0;
    commitSource();

    const ctx = gsap.context(() => {
      gsap.set([bodyPath, labelSvg, handlesGroup], {
        rotation: 0,
        svgOrigin
      });
      sourceStateRef.current.rotation = 0;
      commitSource();

      Object.assign(cursorStateRef.current, {
        x: initialBeside.x,
        y: initialBeside.y,
        visible: true,
        pressed: false,
        cursor: "pointer"
      });
      commitCursorFrame();

      const tl = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 0.85 });
      timelineRef.current = tl;
      const cursor = createCursorScript(tl, cursorStateRef.current, {
        onPositionChange: commitCursorPosition,
        onFrameChange: commitCursorFrame
      });
      const cursorPath = createCursorPathScript(cursor, {
        initialBeside,
        handleStart,
        handleDragEnd
      });

      tl.add("approachHandle");
      cursorPath.glideTo("handleStart", 0.58, "approachHandle");
      cursor.setStyle(CURSOR_FOR_ROTATE_HANDLE, "approachHandle+=0.58");

      tl.add("grabHandle", "approachHandle+=0.58");
      cursor.setPressed(true, "grabHandle");
      cursor.setPressed(false, "grabHandle+=0.12");

      tl.add("rotateForward", "grabHandle+=0.16");
      tl.to(sourceStateRef.current, {
        rotation: 28,
        duration: 0.84,
        ease: "power2.inOut",
        onUpdate: commitSource
      }, "rotateForward");
      cursorPath.moveTo("handleDragEnd", 0.84, "rotateForward", "power2.inOut");
      toSvgRotation(tl, bodyPath, 28, svgOrigin, 0.84, "rotateForward", "power2.inOut");
      toSvgRotation(tl, labelSvg, 28, svgOrigin, 0.84, "rotateForward", "power2.inOut");
      toSvgRotation(tl, handlesGroup, 28, svgOrigin, 0.84, "rotateForward", "power2.inOut");

      tl.add("release", "rotateForward+=0.84");
      cursor.setPressed(false, "release");

      tl.add("rotateBack", "release+=0.34");
      tl.to(sourceStateRef.current, {
        rotation: 0,
        duration: 0.72,
        ease: "power2.inOut",
        onUpdate: commitSource
      }, "rotateBack");
      cursorPath.moveTo("handleStart", 0.72, "rotateBack", "power2.inOut");
      toSvgRotation(tl, bodyPath, 0, svgOrigin, 0.72, "rotateBack", "power2.inOut");
      toSvgRotation(tl, labelSvg, 0, svgOrigin, 0.72, "rotateBack", "power2.inOut");
      toSvgRotation(tl, handlesGroup, 0, svgOrigin, 0.72, "rotateBack", "power2.inOut");

      tl.add("returnStart", "rotateBack+=0.72");
      cursorPath.moveTo("initialBeside", 0.42, "returnStart", "power1.inOut");
      cursor.setStyle("pointer", "returnStart");
      cursor.setPressed(false, "returnStart");
    }, rootRef);

    return () => {
      timelineRef.current = null;
      ctx.revert();
    };
  // GSAP owns this mount-time script; callback identities are intentionally excluded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initialBounds = {
    x: rotateNodeInitial.bounds.x,
    y: rotateNodeInitial.bounds.y,
    width: rotateNodeInitial.bounds.width,
    height: rotateNodeInitial.bounds.height
  };

  return (
    <figure className="featureDemo" ref={rootRef}>
      <svg className="featureScene" viewBox={rotateNodeInitial.viewBox} role="img" aria-labelledby="rotate-node-demo-title" data-layout-item="canvas.rotate.demo">
        <title id="rotate-node-demo-title">Rotate handle spins the node</title>
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
            handleHalfSize: 1.15,
            handleStrokeWidth: 0.26,
            selectionStrokeWidth: 0.24,
            rotateHandleGap: 6.6
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
        lines={buildRotateNodeSourceLines(sourceStateRef.current.rotation)}
        managedImperatively
        layoutItemId="canvas.rotate.source"
      />
    </figure>
  );
}

function buildRotateNodeSourceLines(rotation: number): SourceLine[] {
  return [
    sourceLine(
      sourceKeyword("\\node"),
      sourceText("[draw, rotate="),
      sourceNumber(formatTikzNumber(rotation)),
      sourceText("] "),
      sourcePunctuation("(n)"),
      sourceText(" at ("),
      sourceNumber("0"),
      sourceText(", "),
      sourceNumber("0"),
      sourceText(") "),
      sourceString("{$e = mc^2$};")
    )
  ];
}
