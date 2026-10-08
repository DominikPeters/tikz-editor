/**
 * The caret's context path for the status bar (V11 breadcrumb), published
 * by the canvas editing session. Each crumb selects its construct.
 */
export type CanvasTextContext = {
  readonly crumbs: readonly string[];
  readonly select: (index: number) => void;
};

let current: CanvasTextContext | null = null;
const listeners = new Set<() => void>();

export function setCanvasTextContext(next: CanvasTextContext | null): void {
  if (next === current) {
    return;
  }
  current = next;
  for (const listener of listeners) {
    listener();
  }
}

export function getCanvasTextContextSnapshot(): CanvasTextContext | null {
  return current;
}

export function subscribeCanvasTextContext(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
