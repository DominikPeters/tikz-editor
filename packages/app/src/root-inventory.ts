/**
 * Named policies over a document's root inventory (tikz figures today,
 * beamer frames in deck mode). Call sites must use these instead of raw
 * `figures.length` comparisons so the policies stay explicit, uniform, and
 * generalize with the inventory.
 */

/**
 * The root id core parsing should target when the app has no explicit
 * selection: a single-root document parses its only root (undefined lets
 * the parser default to the first), while a multi-root document parses
 * nothing rather than guessing (null).
 */
export function parseWindowRootId(
  activeRootId: string | null | undefined,
  rootCount: number
): string | null | undefined {
  if (activeRootId != null) {
    return activeRootId;
  }
  return rootCount > 1 ? null : undefined;
}

/**
 * Multi-root documents show root-navigation chrome: the navigator panel,
 * inactive-span dimming in the source panel, and the status-bar root
 * context.
 */
export function hasMultipleRoots(rootCount: number): boolean {
  return rootCount > 1;
}

/**
 * Reconcile the persisted active-root selection with a fresh inventory:
 * drop ids that no longer exist, and auto-select the first root when the
 * selection was never initialized, when roots first appear, or when a
 * document grows into multi-root without a selection.
 */
export function reconcileActiveRootSelection(params: {
  activeRootId: string | null;
  hasInitializedRootSelection: boolean;
  previousRootCount: number;
  roots: readonly { id: string }[];
}): { activeRootId: string | null; hasInitializedRootSelection: boolean } {
  const validIds = new Set(params.roots.map((root) => root.id));
  let activeRootId = params.activeRootId;
  let hasInitializedRootSelection = params.hasInitializedRootSelection;
  if (activeRootId && !validIds.has(activeRootId)) {
    activeRootId = null;
    hasInitializedRootSelection = true;
  }
  const rootCount = params.roots.length;
  const shouldAutoSelectFirst =
    (!hasInitializedRootSelection && !activeRootId && rootCount > 0) ||
    (!activeRootId && params.previousRootCount === 0 && rootCount > 0) ||
    (!activeRootId &&
      rootCount >= 2 &&
      rootCount > params.previousRootCount);
  if (shouldAutoSelectFirst) {
    activeRootId = params.roots[0].id;
    hasInitializedRootSelection = true;
  }
  return { activeRootId, hasInitializedRootSelection };
}
