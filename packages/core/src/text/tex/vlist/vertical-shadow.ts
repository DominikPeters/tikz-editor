/**
 * Shadow comparison between the old skip planner (spacing.ts) and the
 * VerticalListBuilder. Development aid for design/vertical-list-builder.md:
 * enabled only when a listener is installed with setVerticalShadowListener.
 */
import type { SimpleTexVerticalEvent } from "../ir.js";
import type { ResolvedTexFont } from "../fonts/types.js";
import type { TexListLayoutProfile } from "../layout-options.js";
import { planSimpleTexParagraphVerticalSkips } from "./spacing.js";
import type { TexVListItem } from "./types.js";
import {
  glue,
  VerticalListBuilder,
  ZERO_GLUE,
  type VerticalGlue,
  type VerticalListRegisters,
} from "./vertical-builder.js";

export interface VerticalShadowBoundary {
  readonly blockIndex: number;
  readonly sourceStart: number;
  readonly text: string;
  readonly old: number;
  readonly builder: number;
  /** The paragraph is next to a display; the builder does not model displays yet. */
  readonly nearDisplay: boolean;
  /** The first paragraph of this layout: its leading skip depends on the enclosing container. */
  readonly first: boolean;
  /** The paragraph inherits a list from an enclosing container that this layout cannot see. */
  readonly fragment: boolean;
  /** Events and items replayed since the previous paragraph, for diagnosis. */
  readonly trace: string;
}

export interface VerticalShadowReport {
  readonly boundaries: readonly VerticalShadowBoundary[];
  readonly events: readonly SimpleTexVerticalEvent[];
}

type Listener = (report: VerticalShadowReport) => void;
let listener: Listener | undefined;

export function setVerticalShadowListener(next: Listener | undefined): void {
  listener = next;
}

export function verticalShadowEnabled(): boolean {
  return listener !== undefined;
}

function at(values: readonly number[] | undefined, depth: number): number {
  if (!values?.length) return 0;
  return values[Math.min(depth, values.length) - 1] ?? 0;
}

function listRegisters(profile: TexListLayoutProfile | undefined, depth: number, fontSizePt: number | undefined): VerticalListRegisters {
  if (!profile) {
    return { topsep: glue(8), partopsep: glue(2), itemsep: glue(4), parsep: glue(4) };
  }
  const size = depth === 1 && fontSizePt !== undefined
    ? profile.sizeOverrides?.find(item => Math.abs(item.fontSizePt - fontSizePt) < 0.001) : undefined;
  if (size) {
    return {
      topsep: glue(size.topsepPt, size.topsepStretchPt, size.topsepShrinkPt),
      partopsep: glue(at(profile.partopsepPtByDepth, depth)),
      itemsep: glue(size.itemsepPt, size.itemsepStretchPt, size.itemsepShrinkPt),
      parsep: glue(size.parsepPt, size.parsepStretchPt, size.parsepShrinkPt),
    };
  }
  return {
    topsep: glue(at(profile.topsepPtByDepth, depth), at(profile.topsepStretchPtByDepth, depth), at(profile.topsepShrinkPtByDepth, depth)),
    partopsep: glue(at(profile.partopsepPtByDepth, depth)),
    itemsep: glue(at(profile.itemsepPtByDepth, depth), at(profile.itemsepStretchPtByDepth, depth), at(profile.itemsepShrinkPtByDepth, depth)),
    parsep: glue(at(profile.parsepPtByDepth, depth), at(profile.parsepStretchPtByDepth, depth), at(profile.parsepShrinkPtByDepth, depth)),
  };
}

type Step =
  | { readonly at: number; readonly order: 1; readonly event: SimpleTexVerticalEvent }
  | { readonly at: number; readonly order: 0; readonly item: TexVListItem };

/** Runs the builder over the raw vlist and events and reports per-paragraph skips. */
export function runVerticalShadow(
  items: readonly TexVListItem[],
  events: readonly SimpleTexVerticalEvent[],
  font: ResolvedTexFont,
  profile: TexListLayoutProfile | undefined
): void {
  if (!listener) return;
  const oldSkips = new Map<number, number>();
  const paragraphIds = new Set(items.flatMap(item => item.kind === "paragraph" ? [item.blockIndex] : []));
  for (const skip of planSimpleTexParagraphVerticalSkips(items, font, profile)) {
    if (skip.segmentIndex === 0) oldSkips.set(skip.blockIndex, Number(skip.size));
  }
  const steps: Step[] = [
    // A label line the parser emits at an \item or \end offset is set before that command's glue.
    ...events.map(event => ({ at: event.sourceStart, order: 1 as const, event })),
    // Items without a source span (a block's after-skip) stay after the item before them.
    ...((): Step[] => { let at = 0; return items.map(item => ({ at: (at = item.sourceSpan?.start ?? at), order: 0 as const, item })); })(),
  ].sort((left, right) => left.at - right.at || left.order - right.order);

  // Block bodies, columns and inline boxes start in minipage mode (\@setminipage).
  const builder = new VerticalListBuilder({ parskip: glue(profile?.paragraphSkipPt ?? 0), listColorWhatsits: profile !== undefined,
    minipage: profile?.suppressInitialTopsep === true });
  const listSizes: (number | undefined)[] = [];
  const nearDisplay = new Set<number>();
  const paragraphs: { blockIndex: number; sourceStart: number; text: string; trace: string; old: number; fragment: boolean }[] = [];
  let oldSinceParagraph = 0;
  let trace: string[] = [];
  let previousWasDisplay = false;
  const trivlistTopsep = (): VerticalGlue => {
    const depth = builder.listDepth;
    if (depth === 0) return glue(profile?.trivlistTopsepPt ?? 8);
    return listRegisters(profile, depth, listSizes.at(-1)).topsep;
  };
  for (const step of steps) {
    if (step.order === 1) {
      const event = step.event;
      trace.push(event.kind === "list-begin" ? `list-begin:${event.depth}@${event.fontSizePt}` : event.kind);
      switch (event.kind) {
        case "par": builder.par(); break;
        case "list-begin":
          if (event.inheritsPendingLabel && builder.listDepth === 0 && !builder.pendingLabel) builder.inheritPendingLabel();
          listSizes.push(event.fontSizePt);
          builder.beginList(listRegisters(profile, event.registerDepth, event.fontSizePt));
          break;
        case "item": builder.item(); break;
        case "list-end": builder.endList(); listSizes.pop(); break;
        case "trivlist-begin":
          builder.beginTrivlist({ topsep: trivlistTopsep(), partopsep: glue(profile?.trivlistPartopsepPt ?? 0) });
          break;
        case "trivlist-end": builder.endList(); break;
        case "quote-begin":
          builder.beginTrivlist({ topsep: trivlistTopsep(), partopsep: ZERO_GLUE });
          break;
        case "quote-end": builder.endList(); break;
        case "registers":
          for (const name of ["topsep", "partopsep", "itemsep", "parsep", "parskip"] as const) {
            const value = event.assignments[name];
            if (value) builder.setRegister(name, glue(value.sizePt, value.stretchPt, value.shrinkPt));
          }
          break;
        case "group-begin":
        case "group-end":
          break;
      }
      continue;
    }
    const item = step.item;
    if (item.kind === "paragraph") {
      const id = String(item.blockIndex);
      builder.startParagraph(id);
      paragraphs.push({ blockIndex: item.blockIndex, sourceStart: item.sourceSpan.start, text: item.paragraph.text.slice(0, 24), trace: trace.join(" "),
        old: oldSinceParagraph + (oldSkips.get(item.blockIndex) ?? 0),
        fragment: item.paragraph.listContext !== undefined && builder.listDepth === 0 });
      oldSinceParagraph = 0;
      trace = [];
      if (previousWasDisplay) nearDisplay.add(item.blockIndex);
      previousWasDisplay = false;
    } else if (item.kind === "display-math" || item.kind === "display-alignment") {
      const last = paragraphs.at(-1);
      if (last) nearDisplay.add(last.blockIndex);
      builder.startParagraph(`display:${item.sourceSpan.start}`);
      previousWasDisplay = true;
    } else {
      trace.push(item.kind === "hbox" ? `hbox:${item.role?.kind ?? ""}` : item.kind === "glue" ? `glue:${Number(item.size)}` : item.kind);
    }
    if (item.kind === "paragraph") continue;
    if (item.kind === "vbox" || item.kind === "hbox") {
      oldSinceParagraph += oldSkips.get(-3_000_000 - (item.sourceSpan?.start ?? 0)) ?? 0;
      builder.box(`box:${item.sourceSpan?.start ?? 0}`, item.kind === "hbox" && item.role?.kind === "external-flow" && item.role.consumesItemLabels === true);
    } else if (item.kind === "glue") {
      // Authored glue stays in the vlist next to the old planner's skips.
      oldSinceParagraph += Number(item.size);
      builder.vskip(glue(Number(item.size)), "authored");
    } else if (item.kind === "penalty") {
      builder.penalty(Number(item.penalty));
    }
  }
  listener({
    events,
    boundaries: paragraphs.map((paragraph, index) => ({
      first: index === 0,
      ...paragraph,
      builder: builder.glueSince(String(paragraph.blockIndex), id => paragraphIds.has(Number(id))).natural,
      nearDisplay: nearDisplay.has(paragraph.blockIndex),
    })),
  });
}
