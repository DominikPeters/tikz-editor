import type { Tree } from "@lezer/common";
import { useEffect, useMemo, useState } from "react";
import { BASIC_PICKER_COLOR_SET } from "./color-palette";
import { resolveDeclaredColorAnalysis } from "./source-color-detection";
import { useEditorStore } from "../store/store";

export type NamedColorSwatch = {
  token: string;
  cssColor: string;
};

let lastDeclaredColorSignature = "__project-named-colors:uninitialized__";
let lastSwatches: NamedColorSwatch[] = [];

export function collectProjectNamedColorSwatches(
  declaredColors: ReadonlyMap<string, string>
): NamedColorSwatch[] {
  const swatches: NamedColorSwatch[] = [];
  const seen = new Set<string>();

  for (const [token, cssColor] of declaredColors.entries()) {
    const normalizedToken = token.trim().toLowerCase();
    if (
      normalizedToken.length === 0 ||
      seen.has(normalizedToken) ||
      BASIC_PICKER_COLOR_SET.has(normalizedToken)
    ) {
      continue;
    }
    seen.add(normalizedToken);
    swatches.push({
      token: normalizedToken,
      cssColor
    });
  }

  return swatches;
}

export function resolveProjectNamedColorSwatches(
  source: string,
  tree: Tree
): NamedColorSwatch[] {
  const analysis = resolveDeclaredColorAnalysis(source, tree);
  if (analysis.signature === lastDeclaredColorSignature) {
    return lastSwatches;
  }
  lastDeclaredColorSignature = analysis.signature;
  lastSwatches = collectProjectNamedColorSwatches(analysis.colors);
  return lastSwatches;
}

export function useProjectNamedColorSwatches(): NamedColorSwatch[] {
  const activeCanvasDragKind = useEditorStore((s) => s.activeCanvasDragKind);
  const activeSourceScrubSourceId = useEditorStore((s) => s.activeSourceScrubSourceId);
  const source = useEditorStore((s) => s.source);
  const parseTree = useEditorStore((s) => s.snapshot?.parseResult?.tree ?? null);
  const shouldFreeze =
    activeSourceScrubSourceId != null ||
    activeCanvasDragKind === "element" ||
    activeCanvasDragKind === "resize" ||
    activeCanvasDragKind === "rotate" ||
    activeCanvasDragKind === "handle";
  const [stable, setStable] = useState({ source, parseTree });

  useEffect(() => {
    if (!shouldFreeze) {
      setStable({ source, parseTree });
    }
  }, [shouldFreeze, source, parseTree]);

  return useMemo(() => {
    if (stable.source.trim().length === 0 || !stable.parseTree) {
      return [];
    }
    return resolveProjectNamedColorSwatches(stable.source, stable.parseTree);
  }, [stable.source, stable.parseTree]);
}
