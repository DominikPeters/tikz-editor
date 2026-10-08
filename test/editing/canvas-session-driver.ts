import {
  buildBeamerCaretStopDomain,
  prepareBeamerDocument,
  resolveBeamerEditScopeAt,
  type BeamerCaretDomain,
} from "../../packages/core/src/beamer/index.js";
import {
  createIntentScheduler,
  intentFromBeforeInput,
  interpretKeyDown,
  needsFreshLayout,
  resolveIntent,
  type Intent,
  type IntentScheduler,
} from "../../packages/core/src/editing/input/index.js";
import { applyTransaction, TYPING_RUN_PAUSE_MS } from "../../packages/core/src/editing/transaction/index.js";
import { createCommandTable, type CommandTable } from "../../packages/core/src/editing/commands/index.js";
import { createEditViewCache } from "../../packages/core/src/editing/position/index.js";
import type {
  EditorDriver,
  EditorSession,
  EditorState,
  ScenarioKey,
} from "../../packages/core/src/editing/testing/index.js";
import {
  INITIAL_CANVAS_TEXT_EDIT_STATE,
  reduceCanvasTextEdit,
  selectionPositions,
  type CanvasTextEditAction,
  type CanvasTextEditState,
} from "../../packages/app/src/ui/canvas-panel/canvas-text-edit-machine.js";
import type { EditableTextTarget } from "../../packages/app/src/ui/canvas-panel/types.js";

/**
 * A canvas-focused Beamer scope session, headless: the app's edit machine,
 * the input adapter, the intent scheduler and the intent resolver, wired
 * the way useCanvasTextEditSession wires them, with rendering in place of
 * the DOM.
 *
 * Layout modes:
 * - `eager`: the frame re-renders after every edit, before the next key.
 * - `burst`: keys arrive with no rendering in between (typing ahead of
 *   layout); the frame renders only when the scheduler waits for it. The
 *   revision protocol says both modes must end in the same state.
 *
 * Keys the adapter leaves to the browser (other than typed text) are not
 * modelled and throw, so a scenario never tests an approximation.
 */
export function canvasSessionDriver(layout: "eager" | "burst" = "eager"): EditorDriver {
  return {
    name: `canvas-session (${layout} layout)`,
    async open(initial) {
      const session = new CanvasSession(layout, initial.step);
      await session.start(initial);
      return session;
    },
  };
}

/** Milliseconds between scenario keystrokes (inside the typing-run window). */
const KEY_INTERVAL_MS = 50;

type Layout = { readonly source: string; readonly domain: BeamerCaretDomain | null };

class CanvasSession implements EditorSession {
  private machine: CanvasTextEditState = INITIAL_CANVAS_TEXT_EDIT_STATE;
  /** Selection direction: the machine stores a normalized selection. */
  private backward = false;
  private layout: Layout | null = null;
  private time = 0;
  private readonly scheduler: IntentScheduler;
  private readonly views = createEditViewCache();
  private commands: CommandTable = createCommandTable();

  constructor(
    private readonly layoutMode: "eager" | "burst",
    private readonly step: number
  ) {
    this.scheduler = createIntentScheduler({
      needsFreshLayout: (intent) => needsFreshLayout(intent, "canvas", true),
      isLayoutFresh: () => this.layoutFresh(),
      run: (intent) => {
        this.run(intent);
      },
    });
  }

  async start(initial: EditorState): Promise<void> {
    const caret = Math.min(initial.selection.anchor, initial.selection.focus);
    const page = await this.renderPage(initial.source);
    this.commands = createCommandTable(prepareBeamerDocument(initial.source).frameEditingEnvironment(0));
    const scope = resolveBeamerEditScopeAt(page.layout.editScopes ?? [], caret);
    if (!scope) {
      throw new Error(`No edit scope at offset ${caret}`);
    }
    const target = {
      sourceId: "scope",
      sceneTextId: "scope",
      sourceSpan: scope.span,
      text: initial.source.slice(scope.span.from, scope.span.to),
      scopeParagraphs: [],
      renderSourceText: initial.source.slice(scope.span.from, scope.span.to),
      usesTex: true,
      paragraphId: null,
      layoutKind: "single-line",
      region: { key: "scope", shape: "rect" },
    } as unknown as EditableTextTarget;
    this.dispatch({
      type: "start_session",
      target,
      source: initial.source,
      selectionStart: initial.selection.anchor - scope.span.from,
      selectionEnd: initial.selection.focus - scope.span.from,
      historyMergeKey: "scenario",
    });
    this.backward = initial.selection.focus < initial.selection.anchor;
    this.layout = this.layoutFor(initial.source, page);
  }

  state(): EditorState {
    const session = this.session();
    const from = session.sourceSpan.from;
    const start = from + session.selectionStart;
    const end = from + session.selectionEnd;
    return {
      source: session.workingSource,
      selection: this.backward ? { anchor: end, focus: start } : { anchor: start, focus: end },
    };
  }

  async press(key: ScenarioKey): Promise<void> {
    this.time += KEY_INTERVAL_MS;
    if (key.kind === "pause") {
      this.time += TYPING_RUN_PAUSE_MS * 2;
      return;
    }
    if (key.kind === "text") {
      this.scheduler.submit(intentFromBeforeInput("insertText", key.text)!);
    } else {
      const decision = interpretKeyDown({ ...key, composing: false }, "canvas");
      switch (decision.kind) {
        case "intent":
          this.scheduler.submit(decision.intent);
          break;
        case "block":
          break;
        default:
          throw new Error(`canvas-session driver: ${decision.kind} key not modelled: ${JSON.stringify(key)}`);
      }
    }
    if (this.layoutMode === "eager") {
      await this.settle();
    }
  }

  /** Renders until no intent waits for layout (and, eagerly, until layout is current). */
  async settle(): Promise<void> {
    while (this.scheduler.pending > 0 || (this.layoutMode === "eager" && !this.layoutFresh())) {
      const source = this.session().workingSource;
      this.layout = this.layoutFor(source, await this.renderPage(source));
      this.scheduler.layoutChanged();
    }
  }

  private session() {
    const session = this.machine.session;
    if (!session) {
      throw new Error("canvas-session driver: the session closed");
    }
    return session;
  }

  private dispatch(action: CanvasTextEditAction): void {
    this.machine = reduceCanvasTextEdit(this.machine, action).state;
  }

  private layoutFresh(): boolean {
    return this.layout?.source === this.session().workingSource;
  }

  private async renderPage(source: string) {
    return prepareBeamerDocument(source).renderFrame({ frameIndex: 0, step: this.step });
  }

  /** The scope's caret domain, built from the paragraphs the app would pass. */
  private layoutFor(source: string, page: Awaited<ReturnType<CanvasSession["renderPage"]>>): Layout {
    const editScopes = page.layout.editScopes ?? [];
    const session = this.machine.session;
    const caret = session ? session.sourceSpan.from + session.selectionStart : 0;
    const scope = resolveBeamerEditScopeAt(editScopes, caret);
    if (!scope) {
      return { source, domain: null };
    }
    const paragraphs = page.layout.paragraphs.filter((paragraph) =>
      paragraph.role !== "headline" &&
      paragraph.role !== "footline" &&
      resolveBeamerEditScopeAt(editScopes, paragraph.sourceSpan.from)?.id === scope.id &&
      paragraph.sourceSpan.to <= scope.span.to
    );
    return {
      source,
      domain: paragraphs.length ? buildBeamerCaretStopDomain({ paragraphs, source }) : null,
    };
  }

  /** The hook's runIntent, minus the DOM. */
  private run(intent: Intent): void {
    const state = this.machine;
    const session = this.session();
    const anchor = this.backward ? session.selectionEnd : session.selectionStart;
    const focus = this.backward ? session.selectionStart : session.selectionEnd;
    const resolution = resolveIntent(
      {
        surface: "canvas",
        editMode: session.editMode,
        isScopeSession: session.isScopeSession,
        revision: state.inputRevision,
        text: session.text,
        bufferFrom: session.sourceSpan.from,
        anchor,
        focus,
        composition: state.compositionRange
          ? { from: state.compositionRange.start, to: state.compositionRange.end }
          : null,
        domain: this.layout?.domain ?? null,
        verticalGoal: state.verticalGoal,
        structure: (text) => this.views(text, this.commands),
        positions: selectionPositions(state, anchor, focus),
      },
      intent
    );
    switch (resolution.kind) {
      case "transaction": {
        const applied = applyTransaction(session.text, resolution.transaction);
        this.backward = applied.focus < applied.anchor;
        this.dispatch({ type: "apply_transaction", transaction: resolution.transaction, time: this.time });
        return;
      }
      case "history":
        this.backward = false;
        this.dispatch({ type: "history", direction: resolution.direction });
        return;
      case "close":
        throw new Error("canvas-session driver: the session closed");
      case "none":
        return;
    }
  }
}
