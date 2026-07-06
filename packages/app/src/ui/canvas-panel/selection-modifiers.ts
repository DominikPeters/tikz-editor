export type SelectionModifierState = {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
};

export function isAdditiveSelectionModifier(modifiers: SelectionModifierState): boolean {
  return modifiers.shiftKey || modifiers.ctrlKey || modifiers.metaKey;
}

export function isResizeHandleAdditiveSelectionModifier(modifiers: SelectionModifierState): boolean {
  return modifiers.ctrlKey || modifiers.metaKey;
}
