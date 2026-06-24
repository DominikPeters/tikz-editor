import type { LinkedTextReadResult, LinkedTextWriteResult } from "../linked-file-sync.js";
import type { DocumentFileRef, FileRevision } from "../store/types.js";
import type { AppMenuCommandId, AppMenuDefinition, AppMenuItem } from "../app-menu/index.js";

export type MenuCommandOrigin = "menu" | "shortcut" | "context-menu" | "platform";

export type MenuCommandHandler = (commandId: AppMenuCommandId, origin: MenuCommandOrigin) => void;

export type PlatformPersistence = {
  load: (key: string) => string | null;
  save: (key: string, value: string) => void;
};

export type PlatformClipboard = {
  readText?: () => Promise<string>;
  writeText?: (text: string) => Promise<void>;
  readCustomText?: (
    formats: readonly string[]
  ) => Promise<{ format: string; text: string } | null>;
  readCustomBytes?: (
    formats: readonly string[]
  ) => Promise<{ format: string; bytesBase64: string } | null>;
  writeBundle?: (payload: {
    plainText: string;
    tikzJson?: string | null;
    svgText?: string | null;
    pngBase64?: string | null;
  }) => Promise<void>;
};

export type PlatformFileApi = {
  openText?: (options?: { addToRecent?: boolean }) => Promise<{ source: string; fileRef: DocumentFileRef | null } | null>;
  openBinary?: (options?: { addToRecent?: boolean }) => Promise<{ bytes: ArrayBuffer; fileRef: DocumentFileRef | null } | null>;
  fetchArxivSource?: (idOrUrl: string) => Promise<ArxivSourcePayload>;
  bindOpenRequest?: (
    handler: (opened: { source: string; fileRef: DocumentFileRef | null }) => void
  ) => (() => void) | void;
  saveText?: (
    text: string,
    options?: { suggestedName?: string; fileRef?: DocumentFileRef | null; mode?: "save" | "save-as" }
  ) => Promise<
    | { status: "saved"; fileRef: DocumentFileRef | null }
    | { status: "cancelled"; fileRef: DocumentFileRef | null }
    | { status: "failed"; fileRef: DocumentFileRef | null; reason?: string }
  >;
  readLinkedText?: (fileRef: DocumentFileRef) => Promise<LinkedTextReadResult>;
  writeLinkedText?: (
    fileRef: DocumentFileRef,
    text: string,
    expectedRevision: FileRevision | null
  ) => Promise<LinkedTextWriteResult>;
  syncLinkedFileWatches?: (fileRefs: readonly DocumentFileRef[]) => Promise<void> | void;
  bindLinkedFileChange?: (handler: (fileRef: DocumentFileRef) => void) => (() => void) | void;
  exportFile?: (content: BlobPart[], options: { fileName: string; mimeType: string }) => Promise<boolean>;
  clearRecentFiles?: () => Promise<void>;
};

export type ArxivSourceFile = {
  path: string;
  source: string;
  size: number;
};

export type ArxivSourcePayload = {
  id: string;
  files: ArxivSourceFile[];
};

export type PlatformMenu = {
  usesNativeMenuBar?: boolean;
  usesNativeContextMenus?: boolean;
  bindCommandHandler?: (handler: MenuCommandHandler) => (() => void) | void;
  dispatchCommand?: (commandId: AppMenuCommandId, origin?: MenuCommandOrigin) => void;
  syncNativeMenu?: (payload: {
    definition: AppMenuDefinition;
    commandStates: Record<AppMenuCommandId, { enabled: boolean; checked?: boolean }>;
    workspaceSignature?: string;
  }) => Promise<void> | void;
  showNativeContextMenu?: (payload: {
    items: readonly AppMenuItem[];
    commandStates: Record<AppMenuCommandId, { enabled: boolean; checked?: boolean }>;
    onCommandRun?: MenuCommandHandler;
  }) => Promise<void> | void;
};

export type DesktopContextMenuItem =
  | { kind: "separator" }
  | {
      kind: "command";
      commandId: AppMenuCommandId;
      label: string;
      enabled: boolean;
      checked?: boolean;
      accelerator?: string;
    }
  | {
      kind: "submenu";
      label: string;
      items: DesktopContextMenuItem[];
    };

export type DesktopContextMenuPayload = {
  requestId: string;
  items: DesktopContextMenuItem[];
};

export type PlatformWindowApi = {
  setDocumentState?: (state: { title?: string; dirty?: boolean }) => void;
  bindCloseRequest?: (handler: () => void) => (() => void) | void;
  close?: () => Promise<void> | void;
  confirmUnsavedChanges?: (message: string) => Promise<"save" | "discard" | "cancel">;
  showMessage?: (options: { title: string; message: string; kind?: "info" | "warning" | "error" }) => Promise<void> | void;
  openExternalUrl?: (url: string) => Promise<boolean> | boolean;
  setTheme?: (theme: "light" | "dark" | null) => Promise<void>;
};

export type PlatformHaptics = {
  performSnapFeedback?: () => Promise<void>;
};

export type PlatformAccessibility = {
  prefersNonBlinkingTextInsertionIndicator?: () => Promise<boolean>;
  bindPrefersNonBlinkingTextInsertionIndicatorChange?: (
    handler: (prefersNonBlinkingTextInsertionIndicator: boolean) => void
  ) => Promise<(() => void) | void> | (() => void) | void;
};

export type AssistantChatContent =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string };

export type AssistantPastedImage = {
  base64: string;
  mimeType: string;
  fileName: string;
};

export type AssistantItem =
  | { type: "userMessage"; id: string; content: AssistantChatContent[] }
  | { type: "agentMessage"; id: string; text: string; phase?: string }
  | { type: "plan"; id: string; text: string }
  | { type: "reasoning"; id: string; summary?: string; content?: string }
  | {
      type: "commandExecution";
      id: string;
      command?: string | string[];
      cwd?: string;
      status?: string;
      aggregatedOutput?: string;
      exitCode?: number;
      durationMs?: number;
    }
  | { type: "fileChange"; id: string; status?: string; changes?: Array<{ path: string; kind?: string; diff?: string }> }
  | { type: "mcpToolCall"; id: string; server?: string; tool?: string; status?: string; arguments?: unknown; result?: unknown; error?: unknown }
  | { type: "dynamicToolCall"; id: string; tool?: string; arguments?: unknown; status?: string; contentItems?: unknown[]; success?: boolean; durationMs?: number }
  | { type: "webSearch"; id: string; query?: string; action?: unknown }
  | { type: "imageView"; id: string; path: string }
  | { type: "enteredReviewMode"; id: string; review?: string }
  | { type: "exitedReviewMode"; id: string; review?: string }
  | { type: "contextCompaction"; id: string }
  | { type: string; id: string; [key: string]: unknown };

export type AssistantPendingApproval =
  | {
      kind: "command";
      requestId: string;
      itemId: string;
      threadId: string;
      turnId: string;
      reason?: string;
      command?: string | string[];
      cwd?: string;
      availableDecisions?: unknown[];
    }
  | {
      kind: "fileChange";
      requestId: string;
      itemId: string;
      threadId: string;
      turnId: string;
      reason?: string;
      grantRoot?: string;
    }
  | {
      kind: "toolInput";
      requestId: string;
      threadId: string;
      turnId?: string;
      payload: unknown;
    };

export type AssistantTurnStatus = "idle" | "starting" | "inProgress" | "completed" | "failed" | "interrupted";

export type AssistantThreadSummary = {
  threadId: string;
  workspacePath: string;
  figurePath: string;
  previewPath: string;
};

export type AssistantThreadState = AssistantThreadSummary & {
  items: AssistantItem[];
};

export type AssistantModelOption = {
  id: string;
  label: string;
};

export type AssistantAccountSnapshot = {
  account: unknown;
  rateLimits: unknown;
};

export type AssistantDynamicToolResult = {
  success?: boolean;
  contentItems?: unknown[];
};

export type AssistantEvent =
  | { type: "thread-ready"; documentId: string; thread: AssistantThreadSummary }
  | { type: "thread-state"; documentId: string; state: AssistantThreadState }
  | { type: "turn-status"; documentId: string; turnId?: string; status: AssistantTurnStatus; error?: string | null }
  | { type: "item-started"; documentId: string; item: AssistantItem }
  | { type: "item-updated"; documentId: string; item: AssistantItem }
  | { type: "item-completed"; documentId: string; item: AssistantItem }
  | { type: "item-delta"; documentId: string; itemId: string; deltaType: string; delta: string }
  | { type: "approval-requested"; documentId: string; approval: AssistantPendingApproval }
  | { type: "approval-cleared"; documentId: string; requestId: string }
  | { type: "source-updated"; documentId: string; source: string; revisionToken: string }
  | { type: "account-updated"; authMode: string | null }
  | { type: "login-completed"; loginId: string | null; success: boolean; error?: string | null }
  | { type: "rate-limits-updated"; rateLimits: unknown }
  | { type: "dynamic-tool-call"; documentId: string; requestId: string; itemId?: string; tool: string; arguments?: unknown }
  | { type: "error"; documentId?: string; message: string };

export type CodexStatus = {
  installed: boolean;
  hasNpm: boolean;
  hasBrew: boolean;
  hasWsl: boolean;
};

export type UpdateInfo = {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
};

export type UpdateInstallProgress =
  | { type: "started"; contentLength?: number }
  | { type: "progress"; chunkLength: number }
  | { type: "finished" };

export type PlatformUpdateApi = {
  checkForUpdate: () => Promise<UpdateInfo | null>;
  installUpdate: (onProgress: (progress: UpdateInstallProgress) => void) => Promise<void>;
  relaunch: () => Promise<void>;
};

export type AssistantApi = {
  checkCodexStatus?: () => Promise<CodexStatus>;
  installCodex?: (method: "npm" | "brew" | "wsl") => Promise<string>;
  ensureDocumentThread?: (params: {
    documentId: string;
    source: string;
    threadId?: string | null;
    workspacePath?: string | null;
    figurePath?: string | null;
    previewPath?: string | null;
  }) => Promise<AssistantThreadSummary>;
  startTurn?: (params: {
    documentId: string;
    prompt: string;
    source: string;
    pngBase64?: string | null;
    pastedImages?: AssistantPastedImage[];
    threadId?: string | null;
    workspacePath?: string | null;
    figurePath?: string | null;
    previewPath?: string | null;
    model?: string | null;
    figureContext?: string | null;
    diagnosticsText?: string | null;
  }) => Promise<{ turnId: string | null }>;
  steerTurn?: (params: {
    documentId: string;
    prompt: string;
    pastedImages?: AssistantPastedImage[];
  }) => Promise<{ turnId: string | null }>;
  interruptTurn?: (params: { documentId: string }) => Promise<void>;
  syncSource?: (params: { documentId: string; source: string }) => Promise<void>;
  respondToApproval?: (params: { documentId: string; requestId: string; decision: string }) => Promise<void>;
  respondToDynamicToolCall?: (params: { documentId: string; requestId: string; result: AssistantDynamicToolResult }) => Promise<void>;
  loadThreadState?: (params: { documentId: string }) => Promise<AssistantThreadState | null>;
  warmUp?: () => Promise<void>;
  listModels?: () => Promise<AssistantModelOption[]>;
  readAccountSnapshot?: () => Promise<AssistantAccountSnapshot | null>;
  readAccount?: () => Promise<unknown>;
  readRateLimits?: () => Promise<unknown>;
  loginStart?: (params: { loginType: string; apiKey?: string }) => Promise<unknown>;
  loginCancel?: (params: { loginId: string }) => Promise<void>;
  logout?: () => Promise<void>;
  bindEvents?: (handler: (event: AssistantEvent) => void) => (() => void) | void;
};

export type EditorPlatform = {
  id: string;
  persistence: PlatformPersistence;
  clipboard?: PlatformClipboard;
  files?: PlatformFileApi;
  menu?: PlatformMenu;
  window?: PlatformWindowApi;
  haptics?: PlatformHaptics;
  accessibility?: PlatformAccessibility;
  assistant?: AssistantApi;
  updates?: PlatformUpdateApi;
  latex?: PlatformLatex;
};

export type PlatformLatex = {
  checkAvailable: () => Promise<{ available: boolean; details: string }>;
  compileTikzToSvg: (latexDocument: string) => Promise<string>;
  readLastCompileLog?: () => Promise<string>;
};
