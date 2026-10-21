import { isRecord } from "../validation";

export const SOURCE_FORMAT_REQUEST_EVENT = "tikz-editor:source-format-request";
export const SOURCE_ACCESSORY_COMMAND_EVENT = "tikz-editor:source-accessory-command";

export type SourceFormatRequestDetail = {
  reason?: "menu" | "shortcut" | "other";
};

export type SourceAccessoryCommandDetail =
  | { command: "indent" | "outdent" | "comment" | "undo" | "redo" }
  | { command: "insert"; text: string; cursorOffset?: number };

const SIMPLE_ACCESSORY_COMMANDS = new Set(["indent", "outdent", "comment", "undo", "redo"]);

export function isSourceAccessoryCommandDetail(value: unknown): value is SourceAccessoryCommandDetail {
  if (!isRecord(value) || typeof value.command !== "string") {
    return false;
  }
  if (value.command === "insert") {
    return typeof value.text === "string" && (value.cursorOffset === undefined || typeof value.cursorOffset === "number");
  }
  return SIMPLE_ACCESSORY_COMMANDS.has(value.command);
}

export type SourceEditorHistoryState = { canUndo: boolean; canRedo: boolean };

const EMPTY_SOURCE_EDITOR_HISTORY: SourceEditorHistoryState = { canUndo: false, canRedo: false };
let sourceEditorHistory = EMPTY_SOURCE_EDITOR_HISTORY;
const sourceEditorHistoryListeners = new Set<() => void>();

/** The source editor keeps its own undo history for typing, separate from the document's. */
export function publishSourceEditorHistory(next: SourceEditorHistoryState | null): void {
  const state = next ?? EMPTY_SOURCE_EDITOR_HISTORY;
  if (state.canUndo === sourceEditorHistory.canUndo && state.canRedo === sourceEditorHistory.canRedo) {
    return;
  }
  sourceEditorHistory = state;
  for (const listener of sourceEditorHistoryListeners) {
    listener();
  }
}

export function subscribeSourceEditorHistory(listener: () => void): () => void {
  sourceEditorHistoryListeners.add(listener);
  return () => { sourceEditorHistoryListeners.delete(listener); };
}

export function getSourceEditorHistorySnapshot(): SourceEditorHistoryState {
  return sourceEditorHistory;
}

export function requestSourceFormat(detail: SourceFormatRequestDetail = {}): void {
  window.dispatchEvent(
    new CustomEvent<SourceFormatRequestDetail>(SOURCE_FORMAT_REQUEST_EVENT, { detail })
  );
}

export function requestSourceAccessoryCommand(detail: SourceAccessoryCommandDetail): void {
  window.dispatchEvent(
    new CustomEvent<SourceAccessoryCommandDetail>(SOURCE_ACCESSORY_COMMAND_EVENT, { detail })
  );
}
