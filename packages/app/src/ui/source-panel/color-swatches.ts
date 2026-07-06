import type { Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import type { EditorView} from "@codemirror/view";
import { Decoration, type DecorationSet, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import {
  collectDetectedColors,
  resolveDeclaredColorAnalysis,
  type DetectedColorOccurrence,
  type SourceRange
} from "../../colors/source-color-detection";

export type ColorSwatchPickRequest = {
  occurrence: DetectedColorOccurrence;
  anchorRect: DOMRectReadOnly;
};

export type ColorSwatchesOptions = {
  onPickRequest?: (request: ColorSwatchPickRequest) => void;
};

class ColorSwatchWidget extends WidgetType {
  constructor(
    private readonly occurrence: DetectedColorOccurrence,
    private readonly onPickRequest: ColorSwatchesOptions["onPickRequest"]
  ) {
    super();
  }

  eq(other: ColorSwatchWidget): boolean {
    return (
      this.occurrence.from === other.occurrence.from &&
      this.occurrence.to === other.occurrence.to &&
      this.occurrence.token === other.occurrence.token &&
      this.occurrence.cssColor === other.occurrence.cssColor &&
      this.occurrence.editable === other.occurrence.editable &&
      this.occurrence.source === other.occurrence.source
    );
  }

  toDOM(): HTMLElement {
    const dom = document.createElement("span");
    dom.className = "cm-inline-color-swatch";
    if (this.occurrence.cssColor == null) {
      dom.classList.add("cm-inline-color-swatch-none");
    } else {
      dom.style.backgroundColor = this.occurrence.cssColor;
    }

    if (!this.occurrence.editable) {
      dom.classList.add("cm-inline-color-swatch-readonly");
      dom.title = this.occurrence.readOnlyReason ?? "Color preview";
    } else {
      dom.title = `Edit color: ${this.occurrence.token}`;
    }

    dom.setAttribute("aria-hidden", "true");
    dom.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    dom.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!this.occurrence.editable || !this.onPickRequest) {
        return;
      }
      this.onPickRequest({
        occurrence: this.occurrence,
        anchorRect: dom.getBoundingClientRect()
      });
    });

    return dom;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export function colorSwatches(options: ColorSwatchesOptions = {}): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      private occurrences: DetectedColorOccurrence[] = [];
      private declaredColorRanges: readonly SourceRange[] = [];
      private visibleRanges: readonly SourceRange[] = [];

      constructor(private readonly view: EditorView) {
        this.recomputeDecorations();
      }

      update(update: ViewUpdate): void {
        const nextVisibleRanges = cloneRanges(this.view.visibleRanges);
        if (update.docChanged) {
          if (
            sameRanges(nextVisibleRanges, this.visibleRanges.map((range) => mapRange(range, update))) &&
            canReuseDecorationsAfterDocChange(update, this.occurrences, this.declaredColorRanges)
          ) {
            this.decorations = this.decorations.map(update.changes);
            this.occurrences = this.occurrences.map((occurrence) => mapOccurrence(occurrence, update));
            this.declaredColorRanges = this.declaredColorRanges.map((range) => mapRange(range, update));
            this.visibleRanges = nextVisibleRanges;
            return;
          }
          this.recomputeDecorations();
          return;
        }
        if (update.viewportChanged) {
          if (!sameRanges(nextVisibleRanges, this.visibleRanges)) {
            this.recomputeDecorations();
          }
        }
      }

      private recomputeDecorations(): void {
        const source = this.view.state.doc.toString();
        this.visibleRanges = cloneRanges(this.view.visibleRanges);
        const tree = syntaxTree(this.view.state);
        const declaredColorAnalysis = resolveDeclaredColorAnalysis(source, tree);
        this.declaredColorRanges = declaredColorAnalysis.ranges;
        this.occurrences = collectDetectedColors(
          source,
          tree,
          this.visibleRanges,
          declaredColorAnalysis.colors
        );
        if (this.occurrences.length === 0) {
          this.decorations = Decoration.none;
          return;
        }

        this.decorations = Decoration.set(
          this.occurrences.map((occurrence) =>
            Decoration.widget({
              widget: new ColorSwatchWidget(occurrence, options.onPickRequest),
              side: -1
            }).range(occurrence.from)
          ),
          true
        );
      }
    },
    {
      decorations: (value) => value.decorations
    }
  );
}

function cloneRanges(ranges: readonly { from: number; to: number }[]): SourceRange[] {
  return ranges.map((range) => ({ from: range.from, to: range.to }));
}

function sameRanges(left: readonly SourceRange[], right: readonly SourceRange[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftRange = left[index];
    const rightRange = right[index];
    if (leftRange?.from !== rightRange?.from || leftRange.to !== rightRange.to) {
      return false;
    }
  }
  return true;
}

function canReuseDecorationsAfterDocChange(
  update: ViewUpdate,
  occurrences: readonly DetectedColorOccurrence[],
  declaredColorRanges: readonly SourceRange[]
): boolean {
  let reusable = true;

  update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (!reusable) {
      return;
    }
    if (intersectsAnyRange(fromA, toA, occurrences) || intersectsAnyRange(fromA, toA, declaredColorRanges)) {
      reusable = false;
      return;
    }

    const removedText = update.startState.sliceDoc(fromA, toA);
    const insertedText = update.state.sliceDoc(fromB, toB);
    if (!isDefinitelyColorIrrelevantText(removedText) || !isDefinitelyColorIrrelevantText(insertedText)) {
      reusable = false;
    }
  });

  return reusable;
}

function intersectsAnyRange(from: number, to: number, ranges: readonly SourceRange[]): boolean {
  for (const range of ranges) {
    if (range.to <= from) {
      continue;
    }
    if (range.from >= to) {
      continue;
    }
    return true;
  }
  return false;
}

function isDefinitelyColorIrrelevantText(text: string): boolean {
  return /^[\d\s.,;()+-]*$/u.test(text);
}

function mapOccurrence(occurrence: DetectedColorOccurrence, update: ViewUpdate): DetectedColorOccurrence {
  return {
    ...occurrence,
    from: update.changes.mapPos(occurrence.from, -1),
    to: update.changes.mapPos(occurrence.to, 1)
  };
}

function mapRange(range: SourceRange, update: ViewUpdate): SourceRange {
  return {
    from: update.changes.mapPos(range.from, -1),
    to: update.changes.mapPos(range.to, 1)
  };
}
