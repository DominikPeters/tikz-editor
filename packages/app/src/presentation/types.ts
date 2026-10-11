export type PresentationRole = "audience" | "presenter";
export type PresentationMode = "display" | "window" | "rehearse";
export type PresentationCursor = { frame: number; step: number; continuation: number };
export type PresentationFrame = { index: number; title: string; steps: number };
export type PresentationPage = { cursor: PresentationCursor; svg: string; notesSvg: string | null };
export type PresentationTimer = { elapsedMs: number; runningSince: number | null; started: boolean; budgetMs: number | null };
export type PresentationSnapshot = {
  sessionId: string;
  documentId: string;
  title: string;
  revision: number;
  sequence: number;
  ended: boolean;
  frames: readonly PresentationFrame[];
  current: PresentationPage | null;
  next: PresentationPage | null;
  thumbnails: Record<number, string>;
  blank: "none" | "black" | "white";
  timer: PresentationTimer;
  outputAvailable: boolean;
  presenterVisible: boolean;
  error: string | null;
};
export type PresentationCommand =
  | { type: "next" | "previous" | "next-frame" | "previous-frame" | "stop" | "show-presenter" | "recover-output" | "swap-displays" }
  | { type: "jump" | "thumbnail"; frame: number }
  | { type: "blank"; value: PresentationSnapshot["blank"] }
  | { type: "timer"; action: "start" | "pause" | "reset" }
  | { type: "close-view"; role: PresentationRole };
export type PresentationMessage =
  | { type: "hello"; sessionId: string; role: PresentationRole; sequence?: number }
  | { type: "alive"; sessionId: string; sequence: number }
  | { type: "snapshot"; sessionId: string; snapshot: PresentationSnapshot }
  | { type: "command"; sessionId: string; command: PresentationCommand }
  | { type: "closed"; sessionId: string; role: PresentationRole }
  | { type: "focus"; sessionId: string; role: PresentationRole | "editor" };
export type PresentationTransport = { send(message: PresentationMessage): void | Promise<void>; close(): void };
export type PresentationDisplay = {
  id: string; name: string; primary: boolean;
  x: number; y: number; width: number; height: number; scaleFactor: number;
};
export type PresentationOptions = {
  mode: PresentationMode;
  audienceDisplay: string | null;
  presenterDisplay: string | null;
  showPresenter: boolean | null;
  countdownMinutes: number | null;
};
export type PresentationWindows = {
  close(): Promise<void> | void;
  showPresenter(): Promise<void> | void;
  closeView(role: PresentationRole): Promise<void> | void;
  recoverOutput(displayId?: string | null): Promise<void> | void;
  swapDisplays(): Promise<{ audienceDisplay: string; presenterDisplay: string } | void> | void;
};
export type PlatformPresentationApi = {
  displays(): Promise<PresentationDisplay[]>;
  identifyDisplays?(): Promise<void>;
  connect(sessionId: string, receive: (message: PresentationMessage) => void): Promise<PresentationTransport>;
  /** Browser implementations reserve popups synchronously before their first await. */
  open(sessionId: string, options: PresentationOptions, onOutputLost: () => void): Promise<PresentationWindows>;
  keepAwake?(active: boolean): Promise<void>;
  enterFullscreen?(): Promise<void>;
  onFocus?(receive: () => void): Promise<() => void>;
};

/** Inputs cross window boundaries; malformed commands must never reach navigation. */
export function isPresentationMessage(value: unknown, sessionId: string): value is PresentationMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<PresentationMessage>;
  if (message.sessionId !== sessionId) return false;
  if (message.type === "hello" || message.type === "closed") return (message.role === "audience" || message.role === "presenter") && (message.type !== "hello" || message.sequence === undefined || Number.isSafeInteger(message.sequence));
  if (message.type === "alive") return Number.isSafeInteger(message.sequence);
  if (message.type === "focus") return ["editor", "audience", "presenter"].includes(message.role ?? "");
  if (message.type === "snapshot") return !!message.snapshot && message.snapshot.sessionId === sessionId && Number.isSafeInteger(message.snapshot.sequence);
  if (message.type !== "command" || !message.command || typeof message.command !== "object") return false;
  const command = message.command;
  if (command.type === "jump" || command.type === "thumbnail") return Number.isSafeInteger(command.frame) && command.frame >= 0;
  if (command.type === "blank") return ["none", "black", "white"].includes(command.value);
  if (command.type === "timer") return ["start", "pause", "reset"].includes(command.action);
  if (command.type === "close-view") return command.role === "audience" || command.role === "presenter";
  return ["next", "previous", "next-frame", "previous-frame", "stop", "show-presenter", "recover-output", "swap-displays"].includes(command.type);
}
