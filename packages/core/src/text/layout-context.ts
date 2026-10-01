/**
 * Opaque identity used to associate paragraph and vertical-list layout reports
 * with the text engine that produced them.
 *
 * The editor passes this context to hit-testing helpers; the context contains
 * no renderer-specific state.
 */
import type { ParagraphLayoutReport } from "./knuth-plass/paragraph/report.js";
import type { RegisteredTexVListLayout } from "./tex/vlist/registry.js";
import type { TexVListLayout } from "./tex/vlist/types.js";

export type TextLayoutContext = object;

export interface TextLayoutReportProvider {
  getParagraphReports(): readonly ParagraphLayoutReport[];
  getVListLayouts(): readonly RegisteredTexVListLayout[];
  getVListLayout(paragraphId: string): TexVListLayout | null;
}

// Providers are local metadata, never enumerable state in render snapshots.
const providers = new WeakMap<TextLayoutContext, TextLayoutReportProvider>();

let activeTextLayoutContext: TextLayoutContext | null = null;

export function createTextLayoutContext(provider?: TextLayoutReportProvider): TextLayoutContext {
  const context = {};
  if (provider) providers.set(context, provider);
  activeTextLayoutContext = context;
  return context;
}

export function getTextLayoutReportProvider(context: unknown): TextLayoutReportProvider | undefined {
  return context && typeof context === "object" ? providers.get(context) : undefined;
}

/** @deprecated Use the context returned by the text engine/render result. */
export function getActiveTextLayoutContext(): TextLayoutContext | null {
  return activeTextLayoutContext;
}

/** Reusing an engine must also select the reports that engine owns. */
export function setActiveTextLayoutContext(context: TextLayoutContext): void {
  activeTextLayoutContext = context;
}
