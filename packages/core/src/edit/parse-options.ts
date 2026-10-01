import { parseTikz, type ParseTikzResult } from "../parser/index.js";
import type { EditAnalysisSession, EditAnalysisView } from "./analysis.js";
import { incrementProfilingCounter } from "../profiling.js";
import { computeSourceFingerprint } from "../utils/source-fingerprint.js";

export type EditParseOptions = {
  activeFigureId?: string | null;
  preparedParse?: { source: string; activeFigureId?: string | null; result: ParseTikzResult };
  analysisSession?: EditAnalysisSession | null;
  analysisView?: EditAnalysisView | null;
  colorAliases?: ReadonlyMap<string, string> | null;
  indentSize?: 2 | 4;
  propertyWriteMode?: PropertyWriteInteractionMode;
  bypassSnapping?: boolean;
  sourceFingerprint?: string;
};

export type PropertyWriteInteractionMode = "commit" | "preview" | "drag-frame" | "drag-end";

export function parseTikzForEdit(source: string, options: EditParseOptions = {}): ParseTikzResult {
  incrementProfilingCounter("parseTikzForEditCalls");
  if (options.preparedParse?.source === source && options.preparedParse.activeFigureId === options.activeFigureId) {
    return options.preparedParse.result;
  }
  if (
    options.analysisView?.source === source &&
    options.analysisView.activeFigureId === options.activeFigureId
  ) {
    return options.analysisView.parseResult;
  }
  if (options.analysisSession) {
    return options.analysisSession.ensure(source, {
      activeFigureId: options.activeFigureId
    }).parseResult;
  }
  return parseTikz(source, {
    recover: true,
    activeFigureId: options.activeFigureId,
    // Edit queries resolve scene/source ids produced by the main compute path,
    // so they must preserve the same statement numbering.
    includeContextDefinitions: true
  });
}

export function sourceFingerprintForEdit(source: string, options: EditParseOptions = {}): string {
  return options.sourceFingerprint ?? computeSourceFingerprint(source);
}
