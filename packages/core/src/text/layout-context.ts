/**
 * Opaque identity used to associate paragraph and vertical-list layout reports
 * with the text engine that produced them.
 *
 * The editor passes this context to hit-testing helpers; the context contains
 * no renderer-specific state.
 */
export type TextLayoutContext = object;

let activeTextLayoutContext: TextLayoutContext | null = null;

export function createTextLayoutContext(): TextLayoutContext {
  const context = {};
  activeTextLayoutContext = context;
  return context;
}

export function getActiveTextLayoutContext(): TextLayoutContext | null {
  return activeTextLayoutContext;
}

/** Reusing an engine must also select the reports that engine owns. */
export function setActiveTextLayoutContext(context: TextLayoutContext): void {
  activeTextLayoutContext = context;
}
