export const SOURCE_FORMAT_REQUEST_EVENT = "tikz-editor:source-format-request";
export const SOURCE_ACCESSORY_COMMAND_EVENT = "tikz-editor:source-accessory-command";

export type SourceFormatRequestDetail = {
  reason?: "menu" | "shortcut" | "other";
};

export type SourceAccessoryCommandDetail =
  | { command: "indent" | "outdent" | "comment" | "undo" | "redo" }
  | { command: "insert"; text: string; cursorOffset?: number };

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
