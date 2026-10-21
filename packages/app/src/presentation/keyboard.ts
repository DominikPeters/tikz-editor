import type { PresentationCommand, PresentationSnapshot } from "./types";

export function presentationKeyCommand(event: Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey">, state: PresentationSnapshot): PresentationCommand | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case "ArrowRight": case "ArrowDown": case "PageDown": case " ": case "Enter": return { type: event.shiftKey ? "next-frame" : "next" };
    case "ArrowLeft": case "ArrowUp": case "PageUp": case "Backspace": return { type: event.shiftKey ? "previous-frame" : "previous" };
    case "Home": return { type: "jump", frame: 0 };
    case "End": return { type: "jump", frame: Math.max(0, state.frames.length - 1) };
    case "b": case "B": case ".": return { type: "blank", value: state.blank === "black" ? "none" : "black" };
    case "w": case "W": case ",": return { type: "blank", value: state.blank === "white" ? "none" : "white" };
    case "Escape": return { type: "stop" };
    default: return null;
  }
}
