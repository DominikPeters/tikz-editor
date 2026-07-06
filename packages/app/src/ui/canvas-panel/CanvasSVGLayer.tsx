import { useEffect, useRef, type RefObject } from "react";
import { diffSvgModels, type SvgDiffHints, type SvgPatchOp, type SvgRenderModel } from "tikz-editor/svg/index";
import { recordProfilingSvgPatchTiming } from "tikz-editor/profiling";

import { SvgDomPatcher } from "./svg-dom-patcher";
import css from "./CanvasPanel.module.css";

export function CanvasSVGLayer(params: {
  model: SvgRenderModel | null;
  diffHints?: SvgDiffHints;
  forceReplaceAll: boolean;
  showTransparencyGrid: boolean;
  showDocumentBounds: boolean;
  onFallback: (reason: "replaceDefs" | "replaceAll" | "patch-failure") => void;
  hostRef?: RefObject<HTMLDivElement | null>;
}) {
  const { model, diffHints, forceReplaceAll, showTransparencyGrid, showDocumentBounds, onFallback, hostRef: externalHostRef } = params;
  const internalHostRef = useRef<HTMLDivElement | null>(null);
  const patcherRef = useRef<SvgDomPatcher | null>(null);
  const previousModelRef = useRef<SvgRenderModel | null>(null);

  useEffect(() => {
    const host = internalHostRef.current;
    if (!host) {
      return;
    }
    const patcher = new SvgDomPatcher(host);
    patcherRef.current = patcher;
    return () => {
      patcher.dispose();
      patcherRef.current = null;
      previousModelRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!model || !patcherRef.current) {
      return;
    }

    const patcher = patcherRef.current;
    const startedAt = performance.now();
    try {
      let operations: SvgPatchOp[];
      if (forceReplaceAll) {
        operations = [{ kind: "replaceAll", model }];
      } else {
        operations = diffSvgModels(previousModelRef.current, model, diffHints);
      }
      if (operations.some((operation) => operation.kind === "replaceDefs")) {
        onFallback("replaceDefs");
      }
      if (operations.some((operation) => operation.kind === "replaceAll") && !forceReplaceAll) {
        onFallback("replaceAll");
      }
      patcher.applyOperations(operations);
      previousModelRef.current = model;
      recordProfilingSvgPatchTiming({
        durationMs: performance.now() - startedAt,
        operationCount: operations.length,
        forceReplaceAll,
        hasReplaceAll: operations.some((operation) => operation.kind === "replaceAll"),
        hasReplaceDefs: operations.some((operation) => operation.kind === "replaceDefs"),
        fallbackReason: null
      });
    } catch (error) {
      if (typeof console !== "undefined" && typeof console.warn === "function") {
        console.warn("[tikz-editor] SVG patch operation failed; falling back to replaceAll for this frame.", error);
      }
      onFallback("patch-failure");
      patcher.applyOperations([{ kind: "replaceAll", model }]);
      previousModelRef.current = model;
      recordProfilingSvgPatchTiming({
        durationMs: performance.now() - startedAt,
        operationCount: 1,
        forceReplaceAll: true,
        hasReplaceAll: true,
        hasReplaceDefs: false,
        fallbackReason: "patch-failure"
      });
    }
  }, [diffHints, forceReplaceAll, model, onFallback]);

  const className = [
    css.svgLayer,
    showDocumentBounds ? "" : css.svgLayerNoDocumentBounds,
    showTransparencyGrid ? css.svgLayerTransparencyGrid : ""
  ].filter(Boolean).join(" ");
  return (
    <div
      className={className}
      data-testid="canvas-svg-layer"
      data-show-transparency-grid={showTransparencyGrid ? "true" : "false"}
      data-show-document-bounds={showDocumentBounds ? "true" : "false"}
      ref={(node) => {
        internalHostRef.current = node;
        if (externalHostRef) {
          externalHostRef.current = node;
        }
      }}
    />
  );
}
