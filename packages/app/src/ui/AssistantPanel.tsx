import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { RiAddLine, RiSendPlane2Line, RiStopMiniLine } from "@remixicon/react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getActiveEditorPlatform } from "../platform/current";
import { useEditorStore } from "../store/store";
import { CustomDropdown, type CustomDropdownOption } from "./CustomDropdown";
import { SidePanel } from "./SidePanel";
import {
  normalizePastedImageForAssistant,
  type AssistantComposerImageAttachment
} from "./assistant-image-attachments";
import type {
  AssistantAccountSnapshot,
  AssistantItem,
  AssistantModelOption,
  AssistantPendingApproval,
  CodexStatus
} from "../platform/types";
import css from "./AssistantPanel.module.css";

type AssistantPanelProps = {
  onSubmitPrompt: (
    prompt: string,
    model: string | null,
    attachments: AssistantComposerImageAttachment[]
  ) => Promise<void>;
  onInterruptTurn: () => Promise<void>;
  onNewChat: () => void;
};

const AUTO_MODEL_VALUE = "__auto__";
const EMPTY_ASSISTANT_ITEMS: AssistantItem[] = [];
const EMPTY_ASSISTANT_PENDING_APPROVALS: AssistantPendingApproval[] = [];

function logAssistantDebug(message: string, error?: unknown): void {
  if (typeof console === "undefined" || typeof console.info !== "function") {
    return;
  }
  if (error != null) {
    console.info(`[tikz-editor] ${message}`, error);
    return;
  }
  console.info(`[tikz-editor] ${message}`);
}

export function AssistantPanel({ onSubmitPrompt, onInterruptTurn, onNewChat }: AssistantPanelProps) {
  const activeDocumentId = useEditorStore((s) => s.activeDocumentId);
  const assistantApi = getActiveEditorPlatform().assistant;
  const assistantAvailable = typeof assistantApi?.startTurn === "function";
  const assistantState = useEditorStore(useShallow((s) => {
    const doc = s.documents[s.activeDocumentId];
    return {
      hasDocument: doc != null,
      assistantItems: doc?.assistantItems ?? EMPTY_ASSISTANT_ITEMS,
      assistantPendingApprovals: doc?.assistantPendingApprovals ?? EMPTY_ASSISTANT_PENDING_APPROVALS,
      assistantTurnStatus: doc?.assistantTurnStatus ?? "idle",
      assistantError: doc?.assistantError ?? null
    };
  }));
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [modelOptions, setModelOptions] = useState<AssistantModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(AUTO_MODEL_VALUE);
  const [accountSnapshot, setAccountSnapshot] = useState<AssistantAccountSnapshot | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaRequested, setMetaRequested] = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
  const [pendingImageAttachments, setPendingImageAttachments] = useState<AssistantComposerImageAttachment[]>([]);
  const [expandedAttachmentId, setExpandedAttachmentId] = useState<string | null>(null);
  const [codexStatus, setCodexStatus] = useState<CodexStatus | null>(null);
  const [codexStatusChecked, setCodexStatusChecked] = useState(false);
  const [installingMethod, setInstallingMethod] = useState<"npm" | "brew" | "wsl" | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installOutput, setInstallOutput] = useState<string | null>(null);
  const [codexStatusError, setCodexStatusError] = useState<string | null>(null);
  const [pendingLoginId, setPendingLoginId] = useState<string | null>(null);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const nextAttachmentIdRef = useRef(0);
  const pendingImageAttachmentsRef = useRef<AssistantComposerImageAttachment[]>([]);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);

  const groupedItems = useMemo(() => {
    return assistantState.assistantItems.map((item) => ({
      key: item.id,
      item
    }));
  }, [assistantState.assistantItems]);
  const dropdownOptions = useMemo<Array<CustomDropdownOption<string>>>(() => (
    [
      { value: AUTO_MODEL_VALUE, label: "Auto model" },
      ...modelOptions.map((option) => ({ value: option.id, label: option.label }))
    ]
  ), [modelOptions]);
  const accountMeta = useMemo(() => summarizeAccountMeta(accountSnapshot), [accountSnapshot]);
  const rateMeta = useMemo(() => summarizeRateMeta(accountSnapshot), [accountSnapshot]);
  const authState = useMemo(() => {
    const accountResult = asRecord(accountSnapshot?.account);
    const account = asRecord(accountResult?.account);
    const requiresAuth = accountResult?.requiresOpenaiAuth;
    const hasAccount =
      (typeof account?.email === "string" && account.email.trim().length > 0) ||
      (typeof account?.name === "string" && account.name.trim().length > 0) ||
      (typeof account?.type === "string" && account.type.trim().length > 0);
    return {
      requiresAuth: requiresAuth === true,
      isLoggedIn: Boolean(hasAccount),
      accountType: typeof account?.type === "string" ? account.type : null
    };
  }, [accountSnapshot]);
  const dropdownMetaLines = useMemo(() => {
    return [accountMeta, rateMeta, metaError, loginError].filter((line): line is string => line !== null && line.trim().length > 0);
  }, [accountMeta, metaError, rateMeta, loginError]);

  useEffect(() => {
    if (!metaRequested) {
      return;
    }
    let disposed = false;
    async function loadAssistantMeta(): Promise<void> {
      setMetaLoading(true);
      try {
        // First, fetch models and account info (fast)
        const [models, account] = await Promise.all([
          assistantApi?.listModels?.() ?? Promise.resolve([]),
          assistantApi?.readAccount?.() ?? Promise.resolve(null)
        ]);
        if (disposed) {
          return;
        }
        setModelOptions(models);
        setAccountSnapshot({ account, rateLimits: null });
        setMetaError(null);
        setMetaLoading(false);

        // Then, fetch rate limits in the background (slow)
        const rateLimits = await (assistantApi?.readRateLimits?.() ?? Promise.resolve(null));
        if (disposed) {
          return;
        }
        setAccountSnapshot((prev) => ({ ...prev, account: prev?.account ?? null, rateLimits }));
      } catch (error) {
        if (disposed) {
          return;
        }
        setMetaError(error instanceof Error ? error.message : String(error));
        setMetaLoading(false);
      }
    }
    void loadAssistantMeta();
    return () => {
      disposed = true;
    };
  }, [assistantApi, metaRequested]);

  useEffect(() => {
    pendingImageAttachmentsRef.current = pendingImageAttachments;
  }, [pendingImageAttachments]);

  useEffect(() => {
    return () => {
      for (const attachment of pendingImageAttachmentsRef.current) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
    };
  }, []);

  useEffect(() => {
    if (!shouldStickToBottomRef.current) {
      return;
    }
    const timeline = timelineRef.current;
    if (!timeline) {
      return;
    }
    timeline.scrollTop = timeline.scrollHeight;
  }, [groupedItems.length, assistantState.assistantPendingApprovals.length]);

  useEffect(() => {
    if (!assistantAvailable || !assistantApi?.checkCodexStatus) {
      setCodexStatusChecked(true);
      return;
    }
    let disposed = false;
    void assistantApi.checkCodexStatus().then((status) => {
      if (!disposed) {
        setCodexStatus(status);
        setCodexStatusError(null);
        setCodexStatusChecked(true);
      }
    }).catch((error) => {
      if (!disposed) {
        setCodexStatusError(error instanceof Error ? error.message : String(error));
        setCodexStatusChecked(true);
      }
    });
    return () => { disposed = true; };
  }, [assistantAvailable, assistantApi]);

  // Pre-warm the codex process and fetch account info once we know it's installed
  useEffect(() => {
    if (!codexStatusChecked || !codexStatus?.installed || !assistantApi?.warmUp) {
      return;
    }
    let disposed = false;
    void (async () => {
      try {
        await assistantApi.warmUp?.();
        if (disposed) return;
        const account = await assistantApi.readAccount?.();
        if (disposed) return;
        setAccountSnapshot((prev) => ({ ...prev, account, rateLimits: prev?.rateLimits ?? null }));
      } catch (error) {
        // Ignore warmup/account errors - will be handled when user interacts
        logAssistantDebug("Assistant warmup/account preload failed.", error);
      }
    })();
    return () => { disposed = true; };
  }, [codexStatusChecked, codexStatus?.installed, assistantApi]);

  // Listen for account and rate limit updates
  useEffect(() => {
    if (!assistantApi?.bindEvents) {
      return;
    }
    return assistantApi.bindEvents((event) => {
      if (event.type === "account-updated") {
        // Re-fetch account info when auth state changes
        void assistantApi.readAccount?.().then((account) => {
          setAccountSnapshot((prev) => ({ ...prev, account, rateLimits: prev?.rateLimits ?? null }));
        });
      } else if (event.type === "login-completed") {
        setPendingLoginId(null);
        if (!event.success && event.error) {
          setLoginError(event.error);
        }
      } else if (event.type === "rate-limits-updated") {
        setAccountSnapshot((prev) => ({
          ...prev,
          account: prev?.account ?? null,
          rateLimits: event.rateLimits
        }));
      }
    });
  }, [assistantApi]);

  if (!assistantAvailable) {
    return <div className={css.empty} data-select="text">Codex assistant is only available in the desktop app.</div>;
  }

  if (!codexStatusChecked) {
    return (
      <div className={css.empty} data-select="text">
        <div className={css.checkingStatus}>
          <div className={css.spinner} />
          <span>Checking Codex CLI availability...</span>
        </div>
      </div>
    );
  }

  if (!codexStatus?.installed) {
    const detected = codexStatus ?? { installed: false, hasNpm: false, hasBrew: false, hasWsl: false };
    const methods: Array<{ method: "npm" | "brew" | "wsl"; label: string; command: string }> = [];
    if (detected.hasNpm) methods.push({ method: "npm", label: "npm", command: "npm install -g @openai/codex" });
    if (detected.hasBrew) methods.push({ method: "brew", label: "Homebrew", command: "brew install codex" });
    if (detected.hasWsl) methods.push({ method: "wsl", label: "WSL", command: "wsl npm install -g @openai/codex" });

    const handleInstall = async (method: "npm" | "brew" | "wsl") => {
      setInstallingMethod(method);
      setInstallError(null);
      setInstallOutput(null);
      try {
        const output = await assistantApi?.installCodex?.(method);
        const status = await assistantApi?.checkCodexStatus?.();
        if (status?.installed) {
          setCodexStatus(status);
          setInstallOutput("Codex CLI installed successfully.");
        } else {
          const trimmedOutput = output?.trim();
          setInstallOutput(
            trimmedOutput === undefined || trimmedOutput.length === 0
              ? "Install finished, but Codex was not detected. You may need to restart your terminal."
              : trimmedOutput
          );
        }
      } catch (error) {
        setInstallError(error instanceof Error ? error.message : String(error));
      } finally {
        setInstallingMethod(null);
      }
    };

    return (
      <div className={css.empty}>
        <p data-select="text">Codex CLI is not installed.</p>
        {methods.length > 0 ? (
          <div className={css.installButtons}>
            {methods.length === 1 ? (
              <button
                type="button"
                className={css.installButton}
                disabled={installingMethod !== null}
                onClick={() => void handleInstall(methods[0].method)}
              >
                {installingMethod === methods[0].method ? (
                  <><div className={css.spinnerInline} /> Installing...</>
                ) : (
                  `Install via ${methods[0].label}`
                )}
              </button>
            ) : (
              methods.map(({ method, label }) => (
                <button
                  key={method}
                  type="button"
                  className={css.installButton}
                  disabled={installingMethod !== null}
                  onClick={() => void handleInstall(method)}
                >
                  {installingMethod === method ? (
                    <><div className={css.spinnerInline} /> Installing...</>
                  ) : (
                    label
                  )}
                </button>
              ))
            )}
          </div>
        ) : (
          <p data-select="text">Install manually: <code>npm install -g @openai/codex</code></p>
        )}
        {methods.length > 1 ? (
          <details className={css.installDetails}>
            <summary>Show install commands</summary>
            <ul className={css.installCommandList} data-select="text">
              {methods.map(({ method, label, command }) => (
                <li key={method}><strong>{label}:</strong> <code>{command}</code></li>
              ))}
            </ul>
          </details>
        ) : null}
        {detected.hasWsl && methods.length > 1 ? (
          <p className={css.installHint} data-select="text">WSL uses your default distro.</p>
        ) : null}
        {codexStatusError && <p className={css.installError} data-select="text">Could not detect Codex: {codexStatusError}</p>}
        {installError && <p className={css.installError} data-select="text">{installError}</p>}
        {installOutput && <p className={css.installSuccess} data-select="text">{installOutput}</p>}
      </div>
    );
  }

  if (!assistantState.hasDocument) {
    return <div className={css.empty} data-select="text">No active document.</div>;
  }

  const running = assistantState.assistantTurnStatus === "starting" || assistantState.assistantTurnStatus === "inProgress";
  const hasPromptText = prompt.trim().length > 0;
  const composerAction = running && !hasPromptText ? "stop" : "send";
  const workingIndicatorLabel = assistantState.assistantTurnStatus === "starting"
    ? "Setting up conversation..."
    : "Assistant is working...";

  async function handleLogin(): Promise<void> {
    if (pendingLoginId) {
      return;
    }
    setLoginError(null);
    try {
      const result = await assistantApi?.loginStart?.({ loginType: "chatgpt" });
      const resultRecord = asRecord(result);
      if (resultRecord?.type === "chatgpt" && typeof resultRecord.authUrl === "string") {
        setPendingLoginId(typeof resultRecord.loginId === "string" ? resultRecord.loginId : "pending");
        // Open the auth URL in system browser
        const openExternalUrl = getActiveEditorPlatform().window?.openExternalUrl;
        if (typeof openExternalUrl === "function") {
          void openExternalUrl(resultRecord.authUrl);
        }
      }
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleLogout(): Promise<void> {
    if (loggingOut) {
      return;
    }
    setLoggingOut(true);
    try {
      await assistantApi?.logout?.();
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoggingOut(false);
    }
  }

  async function submitPrompt(): Promise<void> {
    const nextPrompt = prompt.trim();
    if (!nextPrompt || submitting) {
      return;
    }
    const attachmentsForTurn = [...pendingImageAttachments];
    setSubmitting(true);
    try {
      await onSubmitPrompt(nextPrompt, selectedModel === AUTO_MODEL_VALUE ? null : selectedModel, attachmentsForTurn);
      for (const attachment of attachmentsForTurn) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
      setPrompt("");
      setPendingImageAttachments([]);
      setExpandedAttachmentId(null);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (composerAction === "stop") {
      void onInterruptTurn();
      return;
    }
    void submitPrompt();
  }

  async function respondToApproval(
    requestId: string,
    decision: string
  ): Promise<void> {
    await getActiveEditorPlatform().assistant?.respondToApproval?.({
      documentId: activeDocumentId,
      requestId,
      decision
    });
  }

  // Show login prompt if auth is required but user is not logged in
  if (authState.requiresAuth && !authState.isLoggedIn) {
    return (
      <SidePanel className={css.panel} data-testid="assistant-panel">
        <SidePanel.Header className={css.header}>
          <div className={css.title}>Assistant</div>
        </SidePanel.Header>
        <SidePanel.Content className={css.authRequired}>
          <div className={css.authRequiredContent}>
            <p data-select="text">Sign in to use the assistant.</p>
            <button
              type="button"
              className={css.authButtonLarge}
              onClick={() => void handleLogin()}
              disabled={pendingLoginId !== null}
            >
              {pendingLoginId ? "Waiting for browser..." : "Sign in with ChatGPT"}
            </button>
            {pendingLoginId ? (
              <p className={css.authHint} data-select="text">Complete sign-in in your browser, then return here.</p>
            ) : null}
            {loginError ? <p className={css.installError} data-select="text">{loginError}</p> : null}
          </div>
        </SidePanel.Content>
      </SidePanel>
    );
  }

  return (
    <SidePanel className={css.panel} data-testid="assistant-panel">
      <SidePanel.Header className={css.header}>
        <div>
          <div className={css.title}>Assistant</div>
        </div>
        <button
          type="button"
          className={css.headerButton}
          onClick={onNewChat}
          disabled={running}
          data-testid="assistant-new-chat"
        >
          <RiAddLine size={14} aria-hidden="true" />
          <span>New chat</span>
        </button>
      </SidePanel.Header>

      {assistantState.assistantError ? <div className={css.error} data-select="text">{assistantState.assistantError}</div> : null}

      <SidePanel.Content
        className={css.timeline}
        data-testid="assistant-timeline"
        ref={timelineRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
          shouldStickToBottomRef.current = distanceFromBottom <= 48;
        }}
      >
        {groupedItems.length === 0 ? <div className={css.empty} data-select="text">Ask for help editing the current figure.</div> : null}
        {groupedItems.map(({ key, item }) => (
          <AssistantTimelineItem key={key} item={item} />
        ))}
        {assistantState.assistantPendingApprovals.map((approval) => (
          <div key={approval.requestId} className={css.card}>
            <div className={css.cardTitle}>Approval Required</div>
            <ApprovalPreview approval={approval} />
            <div className={css.actions}>
              {approvalActions(approval).map((action) => (
                <button key={action.value} type="button" onClick={() => void respondToApproval(approval.requestId, action.value)}>
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </SidePanel.Content>

      <SidePanel.Footer>
        <form className={css.composer} onSubmit={handleSubmit}>
          {running ? (
            <div className={css.workingIndicator} data-select="text">
              <div className={css.spinnerInline} />
              <span>{workingIndicatorLabel}</span>
            </div>
          ) : null}
          {pendingImageAttachments.length > 0 ? (
            <div className={css.attachments} data-testid="assistant-attachments">
              {pendingImageAttachments.map((attachment) => (
                <div key={attachment.id} className={css.attachmentChip}>
                  <button
                    type="button"
                    className={css.attachmentPreviewButton}
                    onClick={() =>
                      { setExpandedAttachmentId((current) => (current === attachment.id ? null : attachment.id)); }
                    }
                    aria-label={`Preview ${attachment.fileName}`}
                  >
                    <img
                      alt={attachment.fileName}
                      src={attachment.previewUrl}
                      className={`${css.attachmentThumb} ${expandedAttachmentId === attachment.id ? css.attachmentThumbExpanded : ""}`}
                    />
                  </button>
                  <button
                    type="button"
                    className={css.attachmentRemove}
                    onClick={() => {
                      URL.revokeObjectURL(attachment.previewUrl);
                      setPendingImageAttachments((current) => current.filter((item) => item.id !== attachment.id));
                      setExpandedAttachmentId((current) => (current === attachment.id ? null : current));
                    }}
                    aria-label={`Remove ${attachment.fileName}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <textarea
            value={prompt}
            onChange={(event) => { setPrompt(event.target.value); }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submitPrompt();
              }
            }}
            onPaste={(event) => {
              const images = extractImageFilesFromClipboard(event.clipboardData);
              if (images.length === 0) {
                return;
              }
              event.preventDefault();
              void (async () => {
                try {
                  const normalized = await Promise.all(
                    images.map((file, index) => normalizePastedImageForAssistant(file, index))
                  );
                  const prepared: AssistantComposerImageAttachment[] = normalized.map((item) => ({
                    id: `attachment-${Date.now()}-${nextAttachmentIdRef.current++}`,
                    blob: item.blob,
                    mimeType: item.mimeType,
                    fileName: item.fileName,
                    previewUrl: URL.createObjectURL(item.blob)
                  }));
                  setPendingImageAttachments((current) => [...current, ...prepared]);
                } catch {
                  // Ignore failed clipboard images and keep composer editable.
                }
              })();
            }}
            placeholder="Ask Codex to edit the current figure..."
            disabled={submitting}
            rows={4}
            data-testid="assistant-prompt"
          />
          <div className={css.composerRow}>
            <div className={css.modelPicker}>
              <CustomDropdown
                ariaLabel="Model"
                options={dropdownOptions}
                value={selectedModel}
                onChange={(value) => { setSelectedModel(value); }}
                onOpen={() => {
                  if (!metaRequested) {
                    setMetaLoading(true);
                    // Defer metaRequested to ensure the dropdown has a chance to paint 
                    // the spinner before the potentially blocking listModels call.
                    setTimeout(() => {
                      setMetaRequested(true);
                    }, 100);
                  }
                }}
                disabled={submitting || running}
                menuHeader={metaLoading ? (
                  <div className={css.dropdownLoading}>
                    <div className={css.spinner} />
                    <span>Loading models...</span>
                  </div>
                ) : (
                  <div className={css.dropdownMeta} data-select="text">
                    {dropdownMetaLines.map((line, index) => (
                      <div key={`${index}:${line}`}>{line}</div>
                    ))}
                    {authState.requiresAuth && !authState.isLoggedIn ? (
                      <button
                        type="button"
                        className={css.authButton}
                        onClick={(e) => { e.stopPropagation(); void handleLogin(); }}
                        disabled={pendingLoginId !== null}
                      >
                        {pendingLoginId ? "Waiting for browser..." : "Sign in with ChatGPT"}
                      </button>
                    ) : authState.isLoggedIn ? (
                      <button
                        type="button"
                        className={css.authButton}
                        onClick={(e) => { e.stopPropagation(); void handleLogout(); }}
                        disabled={loggingOut}
                      >
                        {loggingOut ? "Signing out..." : "Sign out"}
                      </button>
                    ) : null}
                  </div>
                )}
                triggerClassName={css.modelTrigger}
                menuClassName={css.modelMenu}
                optionClassName={css.modelOption}
                optionSelectedClassName={css.modelOptionSelected}
              />
            </div>
            <button
              className={css.composerAction}
              type="submit"
              disabled={submitting || (composerAction === "send" && !hasPromptText)}
              aria-label={composerAction === "stop" ? "Stop assistant" : "Send message"}
              title={composerAction === "stop" ? "Stop" : "Send"}
              data-testid="assistant-send"
            >
              {composerAction === "stop" ? (
                <RiStopMiniLine size={15} aria-hidden="true" />
              ) : (
                <RiSendPlane2Line size={15} aria-hidden="true" />
              )}
            </button>
          </div>
        </form>
      </SidePanel.Footer>
    </SidePanel>
  );
}

function extractImageFilesFromClipboard(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData?.items) {
    return [];
  }
  const files: File[] = [];
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== "file") {
      continue;
    }
    if (!item.type.startsWith("image/")) {
      continue;
    }
    const file = item.getAsFile();
    if (file) {
      files.push(file);
    }
  }
  return files;
}

function AssistantTimelineItem({ item }: { item: AssistantItem }) {
  const [imageExpanded, setImageExpanded] = useState(false);
  if (item.type === "userMessage") {
    const contentList = Array.isArray(item.content) ? item.content : [];
    const normalized = normalizeUserMessage(contentList);
    return (
      <div className={`${css.card} ${css.userCard} ${css.userMessageBubble}`}>
        <div className={css.messageBody} data-select="text">
          <div>{renderTextWithBreaks(normalized.visibleText)}</div>
          {normalized.attachmentUrls.length > 0 ? (
            <div className={css.historyAttachments}>
              {normalized.attachmentUrls.map((url, index) => (
                <img key={`${index}:${url}`} src={url} alt={`Attachment ${index + 1}`} className={css.historyAttachmentThumb} />
              ))}
            </div>
          ) : null}
          {normalized.hasAttachment ? <div className={css.attachmentHint}>PNG snapshot attached</div> : null}
          {normalized.rawPrompt && normalized.rawPrompt !== normalized.visibleText ? (
            <details className={css.rawPrompt}>
              <summary className={css.rawPromptSummary}>Expand to see packaging</summary>
              <pre className={css.detail} data-select="text">{normalized.rawPrompt}</pre>
            </details>
          ) : null}
        </div>
      </div>
    );
  }

  if (item.type === "agentMessage") {
    return (
      <div className={css.agentMessageBare} data-select="text">
        <Markdown remarkPlugins={[remarkGfm]}>{asString(item.text)}</Markdown>
      </div>
    );
  }

  if (item.type === "plan") {
    return (
      <div className={css.card}>
        <div className={css.cardTitle}>Plan</div>
        <div className={css.messageBody} data-select="text">
          <Markdown remarkPlugins={[remarkGfm]}>{asString(item.text)}</Markdown>
        </div>
      </div>
    );
  }

  if (item.type === "reasoning") {
    return (
      <div className={css.reasoningInline}>
        <div className={css.reasoningBody} data-select="text">
          {item.summary ? <Markdown remarkPlugins={[remarkGfm]}>{asString(item.summary)}</Markdown> : null}
          {item.content ? <Markdown remarkPlugins={[remarkGfm]}>{asString(item.content)}</Markdown> : null}
        </div>
      </div>
    );
  }

  if (item.type === "commandExecution") {
    const command = displayCommand(item.command);
    const status = asString(item.status) || "completed";
    return (
      <details className={css.details}>
        <summary>{summarizeCommandExecution(command)}</summary>
        <div className={css.messageBody} data-select="text">
          <div className={css.attachmentHint}>
            Status: {status}
            {typeof item.exitCode === "number" ? ` · exit ${item.exitCode}` : ""}
            {typeof item.durationMs === "number" ? ` · ${item.durationMs}ms` : ""}
          </div>
          {item.aggregatedOutput ? <pre className={css.detail} data-select="text">{asString(item.aggregatedOutput)}</pre> : null}
        </div>
      </details>
    );
  }

  if (item.type === "fileChange") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const summaries = changes
      .map((change) => {
        const record = asRecord(change);
        const path = typeof record?.path === "string" ? record.path : null;
        const diff = typeof record?.diff === "string" ? record.diff : "";
        return { path, diff, stats: countDiffStats(diff) };
      })
      .filter((change) => change.diff.trim().length > 0);
    const totals = summaries.reduce(
      (acc, change) => ({ added: acc.added + change.stats.added, removed: acc.removed + change.stats.removed }),
      { added: 0, removed: 0 }
    );
    return (
      <details className={css.details}>
        <summary>
          Edited code
          {totals.added > 0 || totals.removed > 0 ? ` +${totals.added} -${totals.removed}` : ""}
        </summary>
        <div className={css.messageBody} data-select="text">
          {summaries.length === 0 ? (
            <div className={css.attachmentHint}>No diff available.</div>
          ) : (
            summaries.map((change, index) => (
              <div key={`${index}:${change.path ?? "unknown"}`} className={css.diffBlock}>
                {change.path ? <div className={css.attachmentHint}>{change.path}</div> : null}
                <div className={css.diffScroll}>
                  <pre className={css.diffPre} data-select="text">
                    {change.diff.split("\n").map((line, lineIndex) => (
                      <span
                        key={`${lineIndex}:${line}`}
                        className={
                          line.startsWith("+") && !line.startsWith("+++")
                            ? css.diffLineAdded
                            : line.startsWith("-") && !line.startsWith("---")
                            ? css.diffLineRemoved
                            : css.diffLineContext
                        }
                      >
                        {line}
                        {"\n"}
                      </span>
                    ))}
                  </pre>
                </div>
              </div>
            ))
          )}
        </div>
      </details>
    );
  }

  if (item.type === "dynamicToolCall") {
    const contentItems = Array.isArray(item.contentItems) ? item.contentItems : [];
    const previewImage = extractContentImageUrl(contentItems);
    const previewText = extractContentText(contentItems);
    const isPngPreview = item.tool === "get_latest_preview_png" || Boolean(previewImage);
    return (
      <details className={css.details}>
        <summary>{isPngPreview ? "Requested PNG snapshot" : "Requested tool call"}</summary>
        <div className={css.messageBody} data-select="text">
          {previewText ? <div className={css.attachmentHint}>{previewText}</div> : null}
          {previewImage ? (
            <img
              alt="Tool preview"
              src={previewImage}
              className={imageExpanded ? css.toolPreviewImageExpanded : css.toolPreviewImage}
              onClick={() => { setImageExpanded(!imageExpanded); }}
            />
          ) : null}
        </div>
      </details>
    );
  }

  return (
    <details className={css.details}>
      <summary>{item.type}</summary>
      <pre className={css.detail} data-select="text">{JSON.stringify(item, null, 2)}</pre>
    </details>
  );
}

function normalizeUserMessage(contentList: unknown[]): {
  visibleText: string;
  rawPrompt: string | null;
  hasAttachment: boolean;
  attachmentUrls: string[];
} {
  let rawPrompt = "";
  let hasAttachment = false;
  const attachmentUrls: string[] = [];
  for (const content of contentList) {
    if (!content || typeof content !== "object") {
      continue;
    }
    const candidate = content as { type?: unknown; text?: unknown; url?: unknown; path?: unknown };
    if (candidate.type === "text") {
      const next = asString(candidate.text);
      rawPrompt = rawPrompt ? `${rawPrompt}\n\n${next}` : next;
    } else {
      hasAttachment = true;
      if (candidate.type === "image" && typeof candidate.url === "string" && candidate.url.trim()) {
        attachmentUrls.push(candidate.url);
      }
      if (candidate.type === "localImage" && typeof candidate.path === "string" && candidate.path.trim()) {
        const value = candidate.path.trim();
        if (value.startsWith("data:") || value.startsWith("blob:") || value.startsWith("http://") || value.startsWith("https://")) {
          attachmentUrls.push(value);
        }
      }
    }
  }
  const extracted = extractUserRequest(rawPrompt);
  return {
    visibleText: extracted ?? rawPrompt,
    rawPrompt: rawPrompt || null,
    hasAttachment,
    attachmentUrls
  };
}

function extractUserRequest(text: string): string | null {
  const marker = "User request:";
  const index = text.lastIndexOf(marker);
  if (index < 0) {
    return null;
  }
  const extracted = text.slice(index + marker.length).trim();
  return extracted || null;
}

function renderTextWithBreaks(text: string): ReactNode {
  const lines = text.split("\n");
  return lines.map((line, index) => (
    <Fragment key={`${index}:${line}`}>
      {index > 0 ? <br /> : null}
      {line}
    </Fragment>
  ));
}

function summarizeAccountMeta(snapshot: AssistantAccountSnapshot | null): string | null {
  const accountResult = asRecord(snapshot?.account);
  const account = asRecord(accountResult?.account);
  const name = typeof account?.name === "string" && account.name.trim() ? account.name : null;
  const email = typeof account?.email === "string" && account.email.trim() ? account.email : null;
  if (name && email) {
    return `Account: ${name} (${email})`;
  }
  if (email) {
    return `Account: ${email}`;
  }
  if (name) {
    return `Account: ${name}`;
  }
  const requiresAuth = accountResult?.requiresOpenaiAuth;
  if (typeof requiresAuth === "boolean") {
    return requiresAuth ? "Account: Sign-in required" : "Account: Ready";
  }
  return null;
}

function summarizeRateMeta(snapshot: AssistantAccountSnapshot | null): string | null {
  const rateResult = asRecord(snapshot?.rateLimits);
  const primary = extractRateWindow(asRecord(rateResult?.rateLimits));
  if (primary) {
    return `Quota: ${primary}`;
  }

  const limitsById = asRecord(rateResult?.rateLimitsByLimitId);
  if (limitsById) {
    const firstSnapshot = Object.values(limitsById)
      .map((value) => asRecord(value))
      .find((value) => value != null);
    const fallback = extractRateWindow(firstSnapshot);
    if (fallback) {
      return `Quota: ${fallback}`;
    }
  }
  return null;
}

function extractRateWindow(snapshot: Record<string, unknown> | null | undefined): string | null {
  if (!snapshot) {
    return null;
  }
  const primary = asRecord(snapshot.primary);
  const secondary = asRecord(snapshot.secondary);
  const primaryText = formatRateWindow(primary, "short");
  const secondaryText = formatRateWindow(secondary, "day");

  if (primaryText && secondaryText) {
    return `${primaryText} · ${secondaryText}`;
  }
  return primaryText ?? secondaryText;
}

function formatRateWindow(
  window: Record<string, unknown> | null | undefined,
  fallbackLabel: "short" | "day"
): string | null {
  if (!window) {
    return null;
  }
  const usedPercent = asNumber(window.usedPercent);
  if (usedPercent == null) {
    return null;
  }
  const durationMins = asNumber(window.windowDurationMins);
  const durationLabel = durationMins != null
    ? durationMins === 60 * 24 * 7
      ? "week"
      : durationMins >= 60
      ? `${Math.round(durationMins / 60)}h`
      : `${Math.round(durationMins)}m`
    : fallbackLabel;
  return `${usedPercent}% used (${durationLabel})`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value.toString();
  }
  return "";
}

function ApprovalPreview({ approval }: { approval: AssistantPendingApproval }) {
  if (approval.kind === "command") {
    const command = displayCommand(approval.command);
    const reason = asString(approval.reason);
    const availableDecisions = formatAvailableDecisions(approval.availableDecisions);
    return (
      <div className={css.messageBody} data-select="text">
        {reason ? <div>{reason}</div> : null}
        {command ? <div className={css.attachmentHint}>Command: <code>{command}</code></div> : null}
        {approval.cwd ? <div className={css.attachmentHint}>CWD: {approval.cwd}</div> : null}
        {availableDecisions ? <div className={css.attachmentHint}>Choices: {availableDecisions}</div> : null}
      </div>
    );
  }

  if (approval.kind === "fileChange") {
    return (
      <div className={css.messageBody} data-select="text">
        {approval.reason ? <div>{approval.reason}</div> : null}
        {approval.grantRoot ? <div className={css.attachmentHint}>Requested root: {approval.grantRoot}</div> : null}
      </div>
    );
  }

  return <pre className={css.detail} data-select="text">{JSON.stringify(approval.payload, null, 2)}</pre>;
}

function displayCommand(command: unknown): string | null {
  if (Array.isArray(command)) {
    const parts = command.map((part) => asString(part)).filter((part) => part.length > 0);
    return parts.length > 0 ? parts.join(" ") : null;
  }
  const text = asString(command).trim();
  if (!text) {
    return null;
  }
  const shellWrapped = text.match(/^\/bin\/zsh -lc ['"](.*)['"]$/);
  if (shellWrapped?.[1]) {
    return shellWrapped[1];
  }
  return text;
}

function formatAvailableDecisions(choices: unknown[] | undefined): string | null {
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const labels = choices
    .map((choice) => {
      if (typeof choice === "string") {
        return choice;
      }
      const record = asRecord(choice);
      if (!record) {
        return null;
      }
      const keys = Object.keys(record);
      return keys.length > 0 ? keys[0] : null;
    })
    .filter((value): value is string => value !== null && value.trim().length > 0);
  return labels.length > 0 ? labels.join(", ") : null;
}

function extractContentText(contentItems: unknown[]): string | null {
  for (const item of contentItems) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    if (record.type === "inputText" && typeof record.text === "string" && record.text.trim()) {
      return record.text;
    }
  }
  return null;
}

function extractContentImageUrl(contentItems: unknown[]): string | null {
  for (const item of contentItems) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    if (record.type === "inputImage" && typeof record.imageUrl === "string" && record.imageUrl.trim()) {
      return record.imageUrl;
    }
  }
  return null;
}

function summarizeCommandExecution(command: string | null): ReactNode {
  if (!command) {
    return "Ran command";
  }
  if (isFigureTexReadCommand(command)) {
    return "Read the code";
  }
  return <>Ran <code>{command}</code></>;
}

function isFigureTexReadCommand(command: string): boolean {
  const normalized = command.trim();
  if (!/\bfigure\.tex\b/.test(normalized)) {
    return false;
  }
  const readPrefix = /^(cat|sed|head|tail|less|more|nl|awk|grep|rg|wc)\b/;
  return readPrefix.test(normalized);
}

function countDiffStats(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ") || line.startsWith("@@")) {
      continue;
    }
    if (line.startsWith("+")) {
      added += 1;
      continue;
    }
    if (line.startsWith("-")) {
      removed += 1;
      continue;
    }
  }
  return { added, removed };
}

function approvalActions(approval: AssistantPendingApproval): Array<{ value: string; label: string }> {
  if (approval.kind !== "command") {
    return [
      { value: "accept", label: "Allow" },
      { value: "decline", label: "Deny" },
      { value: "cancel", label: "Cancel" }
    ];
  }
  const offered = Array.isArray(approval.availableDecisions)
    ? approval.availableDecisions
      .map((choice) => {
        if (typeof choice === "string") {
          return choice;
        }
        const record = asRecord(choice);
        if (!record) {
          return null;
        }
        const keys = Object.keys(record);
        return keys.length > 0 ? keys[0] : null;
      })
      .filter((value): value is string => value !== null && value.trim().length > 0)
    : [];
  if (offered.length === 0) {
    return [
      { value: "accept", label: "Allow" },
      { value: "decline", label: "Deny" },
      { value: "cancel", label: "Cancel" }
    ];
  }
  return offered.map((value) => ({
    value,
    label: humanizeDecision(value)
  }));
}

function humanizeDecision(value: string): string {
  switch (value) {
    case "accept":
      return "Allow";
    case "acceptForSession":
      return "Allow this session";
    case "decline":
      return "Deny";
    case "cancel":
      return "Cancel";
    case "acceptWithExecpolicyAmendment":
      return "Allow with changes";
    default:
      return value;
  }
}
