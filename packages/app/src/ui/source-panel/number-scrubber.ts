import { syntaxTree } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import type { EditorView} from "@codemirror/view";
import { ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import {
  computeScrubbedValue,
  formatScrubNumber,
  fractionDigits,
  shouldStartScrub
} from "../../scrub-utils";

interface NumberScrubberOptions {
  onScrubStateChange?: (state: { isActive: boolean; from: number | null; to: number | null }) => void;
}

type ScrubKind = "coordinate" | "length" | "angle" | "scale" | "opacity" | "numeric";

interface ScrubContext {
  kind: ScrubKind;
  step: number;
  minPrecision: number;
  integerOnly?: boolean;
  min?: number;
  max?: number;
}

interface ScrubTarget {
  from: number;
  to: number;
  value: number;
  step: number;
  precision: number;
  minDisplayPrecision: number;
  min?: number;
  max?: number;
}

interface ActiveScrub {
  from: number;
  to: number;
  startX: number;
  startValue: number;
  step: number;
  precision: number;
  minDisplayPrecision: number;
  min?: number;
  max?: number;
  lastText: string;
}

interface PendingScrub {
  target: ScrubTarget;
  startX: number;
  startPos: number;
}

const LENGTH_UNITS = /^(cm|mm|pt|bp|pc|in|dd|cc|sp|em|ex|mu)\b/i;
const LENGTH_KEYS = new Set([
  "line width",
  "radius",
  "x radius",
  "y radius",
  "xshift",
  "yshift",
  "step",
  "minimum width",
  "minimum height",
  "inner sep",
  "outer sep",
  "node distance",
  "rounded corners"
]);

const ANGLE_KEYS = new Set([
  "rotate",
  "start angle",
  "end angle",
  "delta angle",
  "bend left",
  "bend right",
  "in",
  "out"
]);

const SCALE_KEYS = new Set(["scale", "xscale", "yscale"]);

const OPACITY_KEYS = new Set(["opacity", "fill opacity", "draw opacity", "text opacity"]);

const NUMERIC_KEYS = new Set(["line cap", "line join", "miter limit", "looseness", "samples"]);

const NON_NEGATIVE_KEYS = new Set([
  "line width",
  "radius",
  "x radius",
  "y radius",
  "step",
  "minimum width",
  "minimum height",
  "inner sep",
  "outer sep",
  "node distance",
  "rounded corners"
]);

export function numberScrubber(options: NumberScrubberOptions = {}): Extension {
  return ViewPlugin.fromClass(
    class {
      private readonly view: EditorView;
      private hovered: ScrubTarget | null = null;
      private active: ActiveScrub | null = null;
      private pending: PendingScrub | null = null;
      private hasWindowListeners = false;
      private readonly onScrubStateChange = options.onScrubStateChange;

      private readonly onWindowMouseMove = (event: MouseEvent): void => {
        if (!this.active && this.pending) {
          this.maybeStartScrub(event);
          return;
        }
        this.applyScrubDrag(event);
      };

      private readonly onWindowMouseUp = (event: MouseEvent): void => {
        this.commitPendingClick(event);
        this.stopScrub();
      };

      private readonly onWindowBlur = (): void => {
        this.pending = null;
        this.stopScrub();
        this.removeWindowListenersIfIdle();
        this.updateHoverCursorClass();
      };

      constructor(view: EditorView) {
        this.view = view;
      }

      update(update: ViewUpdate): void {
        if (this.active && update.docChanged) {
          this.active.from = update.changes.mapPos(this.active.from, 1);
          this.active.to = update.changes.mapPos(this.active.to, -1);
        }
      }

      destroy(): void {
        this.pending = null;
        this.stopScrub();
        this.removeWindowListenersIfIdle();
        this.hovered = null;
        this.updateHoverCursorClass();
      }

      handleMouseMove(event: MouseEvent): void {
        if (this.active) {
          return;
        }
        this.hovered = scrubTargetAtCoords(this.view, event.clientX, event.clientY);
        this.updateHoverCursorClass();
      }

      handleMouseLeave(): void {
        if (this.active || this.pending) {
          return;
        }
        this.hovered = null;
        this.updateHoverCursorClass();
      }

      handleMouseDown(event: MouseEvent): boolean {
        if (event.button !== 0 || event.ctrlKey || event.metaKey) {
          return false;
        }
        const target = this.hovered ?? scrubTargetAtCoords(this.view, event.clientX, event.clientY);
        if (!target) {
          this.pending = null;
          this.removeWindowListenersIfIdle();
          return false;
        }

        this.pending = {
          target,
          startX: event.clientX,
          startPos: this.view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? target.from
        };
        this.ensureWindowListeners();
        this.updateHoverCursorClass();
        event.preventDefault();
        return true;
      }

      private maybeStartScrub(event: MouseEvent): void {
        const pending = this.pending;
        if (!pending) {
          return;
        }
        const deltaX = event.clientX - pending.startX;
        if (!shouldStartScrub(deltaX)) {
          return;
        }

        this.pending = null;
        event.preventDefault();
        this.active = {
          from: pending.target.from,
          to: pending.target.to,
          startX: pending.startX,
          startValue: pending.target.value,
          step: pending.target.step,
          precision: pending.target.precision,
          minDisplayPrecision: pending.target.minDisplayPrecision,
          min: pending.target.min,
          max: pending.target.max,
          lastText: this.view.state.doc.sliceString(pending.target.from, pending.target.to)
        };

        document.body.classList.add("is-scrubbing");
        this.onScrubStateChange?.({
          isActive: true,
          from: this.active.from,
          to: this.active.to
        });
        this.updateHoverCursorClass();
        this.applyScrubDrag(event);
      }

      private applyScrubDrag(event: MouseEvent): void {
        const active = this.active;
        if (!active) {
          return;
        }
        event.preventDefault();

        const nextValue = computeScrubbedValue({
          startX: active.startX,
          currentX: event.clientX,
          startValue: active.startValue,
          step: active.step,
          min: active.min,
          max: active.max,
          modifiers: {
            shiftKey: event.shiftKey,
            altKey: event.altKey
          }
        });
        const nextText = formatScrubNumber(nextValue, active.precision, active.minDisplayPrecision);
        if (nextText === active.lastText) {
          return;
        }

        this.view.dispatch({
          changes: { from: active.from, to: active.to, insert: nextText }
        });
        active.to = active.from + nextText.length;
        active.lastText = nextText;
      }

      private stopScrub(): void {
        if (this.active) {
          this.active = null;
          document.body.classList.remove("is-scrubbing");
          this.onScrubStateChange?.({
            isActive: false,
            from: null,
            to: null
          });
        }
        this.removeWindowListenersIfIdle();
        this.updateHoverCursorClass();
      }

      private updateHoverCursorClass(): void {
        this.view.dom.classList.toggle(
          "cm-scrub-hover",
          this.active !== null || this.pending !== null || this.hovered !== null
        );
      }

      private commitPendingClick(event: MouseEvent): void {
        const pending = this.pending;
        if (!pending) {
          return;
        }
        this.pending = null;
        this.removeWindowListenersIfIdle();
        this.updateHoverCursorClass();

        if (shouldStartScrub(event.clientX - pending.startX)) {
          return;
        }

        const position = pending.startPos;
        this.view.dispatch({
          selection: { anchor: position },
          scrollIntoView: true
        });
        this.view.focus();
      }

      private ensureWindowListeners(): void {
        if (this.hasWindowListeners) {
          return;
        }
        window.addEventListener("mousemove", this.onWindowMouseMove);
        window.addEventListener("mouseup", this.onWindowMouseUp);
        window.addEventListener("blur", this.onWindowBlur);
        this.hasWindowListeners = true;
      }

      private removeWindowListenersIfIdle(): void {
        if (!this.hasWindowListeners || this.active || this.pending) {
          return;
        }
        window.removeEventListener("mousemove", this.onWindowMouseMove);
        window.removeEventListener("mouseup", this.onWindowMouseUp);
        window.removeEventListener("blur", this.onWindowBlur);
        this.hasWindowListeners = false;
      }
    },
    {
      eventHandlers: {
        mousemove(this: { handleMouseMove: (event: MouseEvent) => void }, event: MouseEvent): void {
          this.handleMouseMove(event);
        },
        mouseleave(this: { handleMouseLeave: () => void }): void {
          this.handleMouseLeave();
        },
        mousedown(this: { handleMouseDown: (event: MouseEvent) => boolean }, event: MouseEvent): boolean {
          return this.handleMouseDown(event);
        }
      }
    }
  );
}

function scrubTargetAtCoords(view: EditorView, x: number, y: number): ScrubTarget | null {
  const position = view.posAtCoords({ x, y });
  if (position == null) {
    return null;
  }
  return scrubTargetAtPosition(view, position);
}

function scrubTargetAtPosition(view: EditorView, position: number): ScrubTarget | null {
  const docLength = view.state.doc.length;
  const positions = [position, Math.max(0, position - 1), Math.min(docLength, position + 1)];
  for (const pos of positions) {
    const node = findNumberNode(view, pos);
    if (!node) {
      continue;
    }
    const target = buildScrubTarget(view, node);
    if (target) {
      return target;
    }
  }
  return null;
}

function findNumberNode(view: EditorView, position: number): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(view.state).resolveInner(position, -1);
  while (node) {
    if (node.name === "Number") {
      return node;
    }
    node = node.parent;
  }
  return null;
}

function buildScrubTarget(view: EditorView, numberNode: SyntaxNode): ScrubTarget | null {
  const doc = view.state.doc;
  const rawText = doc.sliceString(numberNode.from, numberNode.to);
  if (!/^\d+(?:\.\d+)?$/u.test(rawText)) {
    return null;
  }

  const signedFrom = signedNumberStart(doc, numberNode.from);
  const signedText = doc.sliceString(signedFrom, numberNode.to);
  const value = Number.parseFloat(signedText);
  if (!Number.isFinite(value)) {
    return null;
  }

  const context = classifyScrubContext(doc, numberNode, signedFrom);
  if (!context) {
    return null;
  }

  const sourcePrecision = context.integerOnly ? 0 : fractionDigits(rawText);
  const stepPrecision = fractionDigits(context.step.toString());
  const precision = context.integerOnly ? 0 : Math.max(sourcePrecision, context.minPrecision, stepPrecision);

  return {
    from: signedFrom,
    to: numberNode.to,
    value: context.integerOnly ? Math.round(value) : value,
    step: context.step,
    precision,
    minDisplayPrecision: sourcePrecision,
    min: context.min,
    max: context.max
  };
}

function classifyScrubContext(doc: EditorView["state"]["doc"], numberNode: SyntaxNode, signedFrom: number): ScrubContext | null {
  const optionKey = extractOptionKey(doc, signedFrom);
  const unit = extractUnitAfterNumber(doc, numberNode.to);
  const insideCoordinate = hasAncestor(numberNode, "Coordinate");
  const nonNegative = optionKey ? NON_NEGATIVE_KEYS.has(optionKey) : false;

  if (optionKey && ANGLE_KEYS.has(optionKey)) {
    return { kind: "angle", step: 1, minPrecision: 0 };
  }
  if (optionKey && SCALE_KEYS.has(optionKey)) {
    return { kind: "scale", step: 0.05, minPrecision: 2 };
  }
  if (optionKey && OPACITY_KEYS.has(optionKey)) {
    return { kind: "opacity", step: 0.02, minPrecision: 2, min: 0, max: 1 };
  }
  if (isXcolorMixPercentage(doc, numberNode)) {
    return { kind: "numeric", step: 1, minPrecision: 0, integerOnly: true, min: 0, max: 100 };
  }
  if (unit) {
    const unitStep = lengthStepForUnit(unit);
    return { kind: "length", step: unitStep.step, minPrecision: unitStep.minPrecision, min: nonNegative ? 0 : undefined };
  }
  if (optionKey && LENGTH_KEYS.has(optionKey)) {
    return { kind: "length", step: 0.05, minPrecision: 2, min: nonNegative ? 0 : undefined };
  }
  if (insideCoordinate) {
    if (!isNumericCoordinateValue(doc, numberNode, signedFrom, unit)) {
      return null;
    }
    return { kind: "coordinate", step: 0.1, minPrecision: 1 };
  }
  if (optionKey && NUMERIC_KEYS.has(optionKey)) {
    return { kind: "numeric", step: 0.1, minPrecision: 1 };
  }

  return null;
}

function extractUnitAfterNumber(doc: EditorView["state"]["doc"], numberEnd: number): string | null {
  const snippet = doc.sliceString(numberEnd, Math.min(doc.length, numberEnd + 14));
  const match = snippet.match(/^\s*([A-Za-z]+)/u);
  if (!match) {
    return null;
  }
  if (!LENGTH_UNITS.test(match[0].trim())) {
    return null;
  }
  return match[1].toLowerCase();
}

function isXcolorMixPercentage(doc: EditorView["state"]["doc"], numberNode: SyntaxNode): boolean {
  if (!hasAncestor(numberNode, "OptionList") && !hasAncestor(numberNode, "StylePayload")) {
    return false;
  }

  const before = previousNonWhitespaceChar(doc, numberNode.from);
  if (before !== "!") {
    return false;
  }

  const after = nextNonWhitespaceChar(doc, numberNode.to);
  if (after === "!") {
    return true;
  }
  if (after == null) {
    return true;
  }

  return /[,\]});%]/u.test(after);
}

function previousNonWhitespaceChar(doc: EditorView["state"]["doc"], start: number): string | null {
  for (let index = start - 1; index >= 0; index -= 1) {
    const ch = doc.sliceString(index, index + 1);
    if (!/\s/u.test(ch)) {
      return ch;
    }
  }
  return null;
}

function nextNonWhitespaceChar(doc: EditorView["state"]["doc"], start: number): string | null {
  for (let index = start; index < doc.length; index += 1) {
    const ch = doc.sliceString(index, index + 1);
    if (!/\s/u.test(ch)) {
      return ch;
    }
  }
  return null;
}

function isNumericCoordinateValue(
  doc: EditorView["state"]["doc"],
  numberNode: SyntaxNode,
  signedFrom: number,
  unit: string | null
): boolean {
  if (unit) {
    return true;
  }

  const coordinateNode = findAncestor(numberNode, "Coordinate");
  if (!coordinateNode) {
    return true;
  }

  const inner = doc.sliceString(coordinateNode.from + 1, coordinateNode.to - 1).trim();
  if (inner.length === 0) {
    return false;
  }

  if (/[,:]/u.test(inner)) {
    return true;
  }

  if (/[+*/!$]/u.test(inner)) {
    return true;
  }

  if (/^[+-]?\d+(?:\.\d+)?$/u.test(inner)) {
    return false;
  }

  if (/^[+-]?\d+(?:\.\d+)?(?:\.[A-Za-z][A-Za-z0-9_-]*)+$/u.test(inner)) {
    return false;
  }

  const token = doc.sliceString(signedFrom, numberNode.to);
  if (inner === token || inner === token.replace(/^\+/, "")) {
    return false;
  }

  return true;
}

function lengthStepForUnit(unit: string): { step: number; minPrecision: number } {
  if (unit === "cm") {
    return { step: 0.01, minPrecision: 2 };
  }
  if (unit === "mm") {
    return { step: 0.1, minPrecision: 1 };
  }
  if (unit === "in") {
    return { step: 0.01, minPrecision: 2 };
  }
  if (unit === "pt" || unit === "bp" || unit === "pc" || unit === "dd" || unit === "cc" || unit === "sp") {
    return { step: 0.5, minPrecision: 1 };
  }
  return { step: 0.05, minPrecision: 2 };
}

function extractOptionKey(doc: EditorView["state"]["doc"], numberStart: number): string | null {
  const lookbackStart = Math.max(0, numberStart - 100);
  const lookback = doc.sliceString(lookbackStart, numberStart);
  const optionBoundary = Math.max(lookback.lastIndexOf("["), lookback.lastIndexOf(","));
  const tail = lookback.slice(optionBoundary + 1);
  const match = tail.match(/([A-Za-z][A-Za-z ]*)=\s*$/u);
  if (!match) {
    return null;
  }
  return match[1].trim().replace(/\s+/gu, " ").toLowerCase();
}

function hasAncestor(node: SyntaxNode, name: string): boolean {
  let current: SyntaxNode | null = node;
  while (current) {
    if (current.name === name) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function findAncestor(node: SyntaxNode, name: string): SyntaxNode | null {
  let current: SyntaxNode | null = node;
  while (current) {
    if (current.name === name) {
      return current;
    }
    current = current.parent;
  }
  return null;
}

function signedNumberStart(doc: EditorView["state"]["doc"], numberStart: number): number {
  if (numberStart === 0) {
    return numberStart;
  }
  const maybeMinus = doc.sliceString(numberStart - 1, numberStart);
  if (maybeMinus !== "-") {
    return numberStart;
  }
  const before = numberStart >= 2 ? doc.sliceString(numberStart - 2, numberStart - 1) : "";
  if (before && /[0-9A-Za-z)\]}]/u.test(before)) {
    return numberStart;
  }
  return numberStart - 1;
}
