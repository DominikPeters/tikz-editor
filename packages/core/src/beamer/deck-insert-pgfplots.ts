import { layout, tikz, userText, type TikzFragment } from "../edit/fragment.js";
import { PGFPLOTS_TEMPLATES, pgfplotsPreambleInsertions, type PgfplotsTemplateKind } from "../edit/pgfplots/templates.js";
import type { BeamerGraphicsPlacement } from "./deck-insert-graphics.js";
import { scanBeamerDocument } from "./scan.js";
import type { BeamerStructuralEdit } from "./structural-edit.js";
import type { BeamerFrameLayout, BeamerFrameLayoutItem } from "./types.js";

/**
 * Insert → Function Plot / Data Plot / Bar Chart on a slide: a centred
 * `tikzpicture` holding the template's axis, sized to the slide's text
 * (`width=0.8\linewidth, height=0.6\textheight`), after the selected object or
 * at the end of the frame body (a text caret puts it at the end too: an axis
 * is a figure, not a word). The preamble gains `\usepackage{pgfplots}` and
 * `\pgfplotsset{compat=1.18}` when it has none.
 */
/**
 * The axis height on a slide, as a fraction of `\textheight` (the frame's text
 * height: default 4:3 theme 269.14662pt, behaviour Y4): what is left below
 * the frame's content, less the `center` environment's skips, at most 0.6
 * (a chart under a frame title and a line of text) and at least 0.3 (below
 * that the axis box is too small to edit; a slide that full overflows, as
 * it would in TeX). `height` is pgfplots' total height with its labels (A2),
 * so the picture takes about that much room.
 */
export function deckChartHeight(frameLayout: BeamerFrameLayout): string {
  return deckChartHeightPlan(frameLayout).fraction;
}

/**
 * The height rule with whether the chart is expected to fit: below the 0.3
 * floor the frame has no room for an editable chart, and LuaLaTeX confirms
 * the overflow (a second inserted chart on a frame with a title and a line of
 * text: `Overfull \vbox` of 1.7pt to 9.2pt, test/pgfplots-export-compile.spec.ts).
 */
export function deckChartHeightPlan(frameLayout: BeamerFrameLayout): { fraction: string; fits: boolean } {
  const text = frameLayout.page.textArea;
  // Frames centre their content vertically: the room is the text area below the title, less the content's height.
  const titleBottom = Math.max(text.y, ...frameLayout.items.filter((item) => item.kind === "frame-title" || item.kind === "frame-subtitle").map((item) => item.bounds.y + item.bounds.height));
  const hasBody = frameLayout.items.some((item) => !BODYLESS_KINDS.has(item.kind));
  const used = hasBody ? frameLayout.contentBounds.height : 0;
  const centerSkips = 2 * 6;
  const remaining = text.y + text.height - titleBottom - used - centerSkips;
  const fraction = text.height > 0 ? Math.floor((remaining / text.height) * 20) / 20 : DECK_CHART_HEIGHT_MAX;
  return { fraction: String(Math.min(DECK_CHART_HEIGHT_MAX, Math.max(DECK_CHART_HEIGHT_MIN, fraction))), fits: fraction >= DECK_CHART_HEIGHT_MIN };
}

const BODYLESS_KINDS = new Set<BeamerFrameLayoutItem["kind"]>(["background", "frame-title", "frame-subtitle", "navigation-symbols", "mini-frame-navigation", "headline-decoration"]);
const DECK_CHART_HEIGHT_MAX = 0.6;
const DECK_CHART_HEIGHT_MIN = 0.3;

export function beamerPgfplotsInsertionEdits(
  source: string,
  frameLayout: BeamerFrameLayout,
  template: PgfplotsTemplateKind,
  placement: BeamerGraphicsPlacement,
): { edits: BeamerStructuralEdit[]; note?: string } | { reason: string } {
  const frame = scanBeamerDocument(source).frames.find((candidate) => candidate.id === frameLayout.frameId);
  if (!frame?.endSpan) return { reason: "The frame was not found." };
  const body = frame.bodySpan;
  let at: number;
  if (placement.kind === "after") {
    if (placement.span.from < body.from || placement.span.to > body.to) return { reason: "The object is not on this frame." };
    at = placement.span.to;
  } else {
    at = body.to;
    while (at > body.from && /\s/u.test(source[at - 1] ?? "")) at--;
  }
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lineStart = source.lastIndexOf("\n", at - 1) + 1;
  const indent = at > body.from ? /^[ \t]*/u.exec(source.slice(lineStart, at))?.[0] ?? "" : "";
  // Every chart kind's environment (`axis`, `semilogyaxis`, ...) gets the slide size.
  const height = deckChartHeightPlan(frameLayout);
  const axis = PGFPLOTS_TEMPLATES[template].text
    .replace(/^\\begin\{(\w+)\}\[/u, (opening) => `${opening}width=0.8\\linewidth, height=${height.fraction}\\textheight, `)
    .replace(/\n/gu, `${newline}${indent}    `);
  const tail = at === body.from && source[body.from] !== "\n" && source[body.from] !== "\r" ? newline : "";
  const block: TikzFragment = userText(`${newline}${indent}\\begin{center}${newline}${indent}  \\begin{tikzpicture}${newline}${indent}    ${axis}${newline}${indent}  \\end{tikzpicture}${newline}${indent}\\end{center}`, "pasted-tikz");
  const edits: BeamerStructuralEdit[] = pgfplotsPreambleInsertions(source).map((insertion) => ({
    span: { from: insertion.at, to: insertion.at }, insert: insertion.text,
  }));
  edits.push({ span: { from: at, to: at }, insert: tikz`${block}${layout(tail)}` });
  if (!height.fits) {
    return { edits, note: "Not enough room on the slide. The chart may overflow." };
  }
  return { edits };
}
