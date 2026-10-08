import {
  applyBeamerStructuralPatchToBuffer,
  buildBeamerCaretStopDomain,
  prepareBeamerDocument,
  resolveBeamerEditScopeAt,
  resolveCanvasRenderedMotion,
  resolveCanvasStructuralKey,
  type BeamerCaretDomain,
  type CanvasKeyStroke,
  type CanvasVerticalGoal,
} from "../../packages/core/src/beamer/index.js";
import type { Span } from "../../packages/core/src/ast/types.js";
import {
  activeTextFormatWrapper,
  toggleTextFormatCommand,
} from "../../packages/core/src/text/format-commands.js";
import type {
  EditorDriver,
  EditorSession,
  EditorState,
  ScenarioKey,
} from "../../packages/core/src/editing/testing/index.js";

/**
 * Today's canvas-focus behavior in a Beamer scope session, headless. It
 * follows the hidden-input keydown order in useCanvasTextEditSession.ts
 * (structural keys, Tab swallow, rendered motion, ⌘B/I/U, then native
 * textarea editing) and uses the same core functions the hook calls.
 *
 * Native textarea behavior is approximated: text replaces the selection,
 * Backspace/Delete remove one UTF-16 unit or the selection, Enter inserts
 * "\n", and ←/→ move one character. Anything not modelled throws, so a
 * scenario never silently tests an approximation it does not intend.
 *
 * Every edit re-renders before the next key, like the app after source
 * reconciliation. Burst typing ahead of layout is not modelled here.
 */
export const legacyCanvasDriver: EditorDriver = {
  name: "legacy-canvas",
  async open(initial) {
    const session = new LegacyCanvasSession(initial.source, initial.selection, initial.step);
    await session.reconcile();
    return session;
  },
};

const FORMAT_KEYS: Readonly<Record<string, "textbf" | "textit" | "underline">> = {
  b: "textbf",
  i: "textit",
  u: "underline",
};

class LegacyCanvasSession implements EditorSession {
  private domain: BeamerCaretDomain | null = null;
  private scope: Span = { from: 0, to: 0 };
  private verticalGoal: CanvasVerticalGoal | null = null;

  constructor(
    private source: string,
    private selection: { anchor: number; focus: number },
    private readonly step: number
  ) {}

  state(): EditorState {
    return { source: this.source, selection: { ...this.selection } };
  }

  /** Re-renders and rebuilds the scope's caret domain, as the app does per revision. */
  async reconcile(): Promise<void> {
    const page = await prepareBeamerDocument(this.source).renderFrame({
      frameIndex: 0,
      step: this.step,
    });
    const caret = Math.min(this.selection.anchor, this.selection.focus);
    const scope = resolveBeamerEditScopeAt(page.layout.editScopes ?? [], caret);
    if (!scope) {
      throw new Error(`No edit scope at offset ${caret}`);
    }
    this.scope = scope.span;
    const paragraphs = page.layout.paragraphs.filter((paragraph) =>
      paragraph.role !== "headline" &&
      paragraph.role !== "footline" &&
      resolveBeamerEditScopeAt(page.layout.editScopes, paragraph.sourceSpan.from)?.id === scope.id &&
      paragraph.sourceSpan.to <= scope.span.to
    );
    this.domain = paragraphs.length
      ? buildBeamerCaretStopDomain({ paragraphs, source: this.source })
      : null;
  }

  async press(key: ScenarioKey): Promise<void> {
    if (key.kind === "text") {
      await this.replaceSelection(key.text);
      return;
    }
    const stroke: CanvasKeyStroke = {
      key: key.key,
      shift: key.shift,
      primary: key.primary,
      alt: key.alt,
    };
    const local = this.bufferSelection();

    const structural = resolveCanvasStructuralKey(this.domain, local, stroke);
    if (structural.kind === "swallow") {
      return;
    }
    if (structural.kind === "patch") {
      const buffer = { text: this.source.slice(this.scope.from, this.scope.to), from: this.scope.from };
      const applied = applyBeamerStructuralPatchToBuffer(buffer, this.domain!.source, structural.patch);
      if (applied) {
        await this.replaceBuffer(applied.nextText, applied.caretLocal, applied.selectionEndLocal);
      }
      return;
    }
    if (key.key === "Tab") {
      return;
    }

    const motion = resolveCanvasRenderedMotion(this.domain, local, stroke, this.verticalGoal);
    if (motion) {
      this.verticalGoal = motion.verticalGoal;
      const anchorLocal = motion.direction === "backward" ? motion.selectionEnd : motion.selectionStart;
      const focusLocal = motion.direction === "backward" ? motion.selectionStart : motion.selectionEnd;
      this.selection = { anchor: this.scope.from + anchorLocal, focus: this.scope.from + focusLocal };
      return;
    }

    if (key.primary && !key.alt && !key.shift && FORMAT_KEYS[key.key]) {
      await this.toggleFormat(FORMAT_KEYS[key.key]);
      return;
    }
    if (key.primary || key.alt) {
      throw new Error(`legacy driver: modified key not modelled: ${JSON.stringify(key)}`);
    }
    await this.nativeKey(key.key, key.shift);
  }

  private bufferSelection() {
    const from = Math.min(this.selection.anchor, this.selection.focus);
    const to = Math.max(this.selection.anchor, this.selection.focus);
    return {
      bufferFrom: this.scope.from,
      bufferLength: this.scope.to - this.scope.from,
      selectionStart: from - this.scope.from,
      selectionEnd: to - this.scope.from,
      backward: this.selection.focus < this.selection.anchor,
    };
  }

  private async toggleFormat(name: "textbf" | "textit" | "underline"): Promise<void> {
    const text = this.source.slice(this.scope.from, this.scope.to);
    const { selectionStart, selectionEnd } = this.bufferSelection();
    const active = activeTextFormatWrapper(text, selectionStart, selectionEnd, name);
    // Mirrors textFormatSelectionEditable in the hook.
    if (!active && /\\(?:item|begin|end)(?![a-zA-Z])/u.test(text.slice(selectionStart, selectionEnd))) {
      return;
    }
    const result = toggleTextFormatCommand(text, selectionStart, selectionEnd, name);
    if (result) {
      await this.replaceBuffer(result.nextText, result.selectionStart, result.selectionEnd);
    }
  }

  private async nativeKey(key: string, shift: boolean): Promise<void> {
    const from = Math.min(this.selection.anchor, this.selection.focus);
    const to = Math.max(this.selection.anchor, this.selection.focus);
    switch (key) {
      case "Backspace":
      case "Delete": {
        if (from !== to) {
          await this.replaceSelection("");
          return;
        }
        const span = key === "Backspace" ? { from: from - 1, to: from } : { from, to: from + 1 };
        if (span.from < this.scope.from || span.to > this.scope.to) {
          return;
        }
        await this.edit(span, "", span.from);
        return;
      }
      case "Enter":
        await this.replaceSelection("\n");
        return;
      case "ArrowLeft":
      case "ArrowRight": {
        if (shift) {
          throw new Error("legacy driver: native shift-arrow not modelled");
        }
        const next = from !== to
          ? (key === "ArrowLeft" ? from : to)
          : Math.min(this.scope.to, Math.max(this.scope.from, from + (key === "ArrowLeft" ? -1 : 1)));
        this.selection = { anchor: next, focus: next };
        this.verticalGoal = null;
        return;
      }
      case "Escape":
        throw new Error("legacy driver: Escape closes the session; not modelled");
      default:
        throw new Error(`legacy driver: native key not modelled: ${key}`);
    }
  }

  private async replaceSelection(text: string): Promise<void> {
    const from = Math.min(this.selection.anchor, this.selection.focus);
    const to = Math.max(this.selection.anchor, this.selection.focus);
    await this.edit({ from, to }, text, from + text.length);
  }

  private async replaceBuffer(nextText: string, selectionStart: number, selectionEnd: number): Promise<void> {
    this.source = this.source.slice(0, this.scope.from) + nextText + this.source.slice(this.scope.to);
    this.selection = { anchor: this.scope.from + selectionStart, focus: this.scope.from + selectionEnd };
    this.verticalGoal = null;
    await this.reconcile();
  }

  private async edit(span: Span, insert: string, caret: number): Promise<void> {
    this.source = this.source.slice(0, span.from) + insert + this.source.slice(span.to);
    this.selection = { anchor: caret, focus: caret };
    this.verticalGoal = null;
    await this.reconcile();
  }
}
