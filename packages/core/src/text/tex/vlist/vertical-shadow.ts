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

/** The builder's skip before one top-level vlist item. */
export interface VerticalBuilderSkip {
  /** Index of the item in the top-level vlist items. */
  readonly index: number;
  readonly kind: "paragraph" | "box" | "display";
  /** blockIndex for paragraphs; the old planner's synthetic key for boxes and displays. */
  readonly key: number;
  readonly sourceStart: number;
  readonly text: string;
  /** Builder glue since the previous item, minus authored glue items that stay in the vlist. */
  readonly glue: VerticalGlue;
  readonly first: boolean;
  /** The item is a display or next to one; displays are not modelled yet. */
  readonly nearDisplay: boolean;
  readonly trace: string;
}

export interface VerticalShadowBoundary extends VerticalBuilderSkip {
  readonly old: number;
  readonly builder: number;
  readonly oldStretch: number;
  readonly oldShrink: number;
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

let builderEnabled = true;

/** Take the builder's glue where it agrees with the old planner (on by default; off restores the old flex). */
export function setVerticalBuilderEnabled(enabled: boolean): void {
  builderEnabled = enabled;
}

export function verticalBuilderEnabled(): boolean {
  return builderEnabled;
}

let layoutEnabled = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VLIST_LAYOUT !== "0";

/** Resolve vertical glue with the builder at layout time (default). VLIST_LAYOUT=0 restores the old resolution. */
export function setVerticalLayoutEnabled(enabled: boolean): void {
  layoutEnabled = enabled;
}

export function verticalLayoutEnabled(): boolean {
  return layoutEnabled;
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
    // article.cls \@listi–\@listiii (size10.clo), in em of the list's font as the old planner keeps them.
    const em = fontSizePt ?? 10;
    const level = Math.min(depth, 3) - 1;
    return {
      topsep: glue(([0.8, 0.4, 0.2][level] ?? 0.2) * em),
      partopsep: glue((depth >= 3 ? 0.1 : 0.2) * em),
      itemsep: glue(([0.4, 0.2, 0.2][level] ?? 0.2) * em),
      parsep: glue(([0.4, 0.2, 0][level] ?? 0) * em),
    };
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
  | { readonly at: number; readonly order: 0; readonly item: TexVListItem; readonly index: number };

/** Replays the raw vlist and the IR's vertical events through the builder. */
/** Applies one IR vertical event to the builder, with the list registers the profile selects. */
export function createVerticalEventApplier(
  builder: VerticalListBuilder,
  profile: TexListLayoutProfile | undefined
): (event: SimpleTexVerticalEvent) => void {
  const listSizes: (number | undefined)[] = [];
  const trivlistTopsep = (): VerticalGlue => {
    const depth = builder.listDepth;
    if (depth === 0) return glue(profile?.trivlistTopsepPt ?? 0.8 * (listSizes.at(-1) ?? 10),
      profile?.trivlistTopsepStretchPt ?? 0, profile?.trivlistTopsepShrinkPt ?? 0);
    // \beamer@cramped sets \topsep after \list captured its own skips; an alignment reads the live value.
    return builder.currentTopsep() ?? (profile?.liveListTopsepPt !== undefined ? glue(profile.liveListTopsepPt)
      : listRegisters(profile, depth, listSizes.at(-1)).topsep);
  };
  return event => {
    switch (event.kind) {
      case "par": builder.par(true); break;
      case "list-begin":
        if (event.inheritsPendingLabel && builder.listDepth === 0 && !builder.pendingLabel) builder.inheritPendingLabel();
        listSizes.push(event.fontSizePt);
        if (event.listKind === "bibliography") {
          // Beamer's thebibliography: \itemsep, \partopsep and \topsep 0, the size's \parsep, no color
          // (beamerbaselocalstructure.sty 427-447).
          const registers = listRegisters(profile, event.registerDepth, event.fontSizePt);
          builder.beginList({ topsep: ZERO_GLUE, partopsep: ZERO_GLUE, itemsep: ZERO_GLUE,
            parsep: profile?.bibliographyParsepPt !== undefined ? glue(profile.bibliographyParsepPt) : registers.parsep }, false);
        } else builder.beginList(listRegisters(profile, event.registerDepth, event.fontSizePt));
        break;
      case "item": builder.item(); break;
      case "list-end": builder.endList(); listSizes.pop(); break;
      case "trivlist-begin":
        // A box whose first paragraph took an enclosing item's label (@inlabel is global): the alignment
        // starts on that label line and takes \@noparlist's path.
        if (event.noParList && builder.listDepth === 0 && !builder.pendingLabel) builder.inheritPendingLabel();
        builder.beginTrivlist({ topsep: trivlistTopsep(), partopsep: glue(profile ? profile.trivlistPartopsepPt ?? 0 : 2) });
        break;
      case "trivlist-end": builder.endList(); break;
      case "quote-begin":
        // quote and quotation are \list environments with \@list<depth> registers and an empty \item.
        listSizes.push(listSizes.at(-1));
        {
          const registers = profile ? { topsep: trivlistTopsep(), partopsep: ZERO_GLUE, itemsep: ZERO_GLUE, parsep: ZERO_GLUE }
            : listRegisters(undefined, builder.listDepth + 1, listSizes.at(-1));
          // quotation: \parsep\z@ \@plus\p@ (article.cls).
          builder.beginQuote(event.envName === "quotation" ? { ...registers, parsep: glue(0, 1) } : registers);
        }
        break;
      case "quote-end": builder.endList(); listSizes.pop(); break;
      case "registers":
        for (const name of ["topsep", "partopsep", "itemsep", "parsep", "parskip"] as const) {
          const value = event.assignments[name];
          if (value) builder.setRegister(name, glue(value.sizePt, value.stretchPt, value.shrinkPt));
        }
        break;
      case "whatsit": builder.whatsit(); break;
      case "group-begin":
      case "group-end":
        break;
    }
  };
}

export function computeVerticalBuilderSkips(
  items: readonly TexVListItem[],
  events: readonly SimpleTexVerticalEvent[],
  profile: TexListLayoutProfile | undefined
): VerticalBuilderSkip[] {
  const steps: Step[] = [
    // A label line the parser emits at an \item or \end offset is set before that command's glue.
    ...events.map(event => ({ at: event.sourceStart, order: 1 as const, event })),
    // Items without a source span (a block's after-skip) stay after the item before them.
    ...((): Step[] => { let at = 0; return items.map((item, index) => ({ at: (at = item.sourceSpan?.start ?? at), order: 0 as const, item, index })); })(),
  ].sort((left, right) => left.at - right.at || left.order - right.order);

  // Block bodies, columns and inline boxes start in minipage mode (\@setminipage).
  const builder = new VerticalListBuilder({ parskip: glue(profile?.paragraphSkipPt ?? 0), listColorWhatsits: profile !== undefined,
    minipage: profile?.suppressInitialTopsep === true });
  const applyEvent = createVerticalEventApplier(builder, profile);
  const anchors: { index: number; id: string; kind: VerticalBuilderSkip["kind"]; key: number; sourceStart: number; text: string; authored: VerticalGlue; trace: string }[] = [];
  let authored: VerticalGlue = ZERO_GLUE;
  let trace: string[] = [];
  const anchor = (index: number, id: string, kind: VerticalBuilderSkip["kind"], key: number, sourceStart: number, text: string) => {
    anchors.push({ index, id, kind, key, sourceStart, text, authored, trace: trace.join(" ") });
    authored = ZERO_GLUE;
    trace = [];
  };
  for (const step of steps) {
    if (step.order === 1) {
      const event = step.event;
      trace.push(event.kind === "list-begin" ? `list-begin:${event.depth}@${event.fontSizePt}` : event.kind);
      applyEvent(event);
      continue;
    }
    const { item, index } = step;
    const start = item.sourceSpan?.start ?? 0;
    if (item.kind === "paragraph") {
      const id = `p${index}`;
      builder.startParagraph(id);
      anchor(index, id, "paragraph", item.blockIndex, start, item.paragraph.text.slice(0, 24));
    } else if (item.kind === "display-math" || item.kind === "display-alignment") {
      const id = `d${index}`;
      builder.startParagraph(id);
      anchor(index, id, "display", -4_000_000 - start, start, "<display>");
    } else if (item.kind === "vbox" || item.kind === "hbox") {
      const id = `b${index}`;
      builder.box(id, item.kind === "hbox" && item.role?.kind === "external-flow" && item.role.consumesItemLabels === true);
      anchor(index, id, "box", -3_000_000 - start, start, item.kind === "hbox" ? `<${item.role?.kind ?? "hbox"}>` : "<vbox>");
    } else if (item.kind === "glue") {
      trace.push(`glue:${Number(item.size)}`);
      const value = glue(Number(item.size), Number(item.stretch ?? 0), Number(item.shrink ?? 0));
      authored = { natural: authored.natural + value.natural, stretch: authored.stretch + value.stretch, shrink: authored.shrink + value.shrink };
      builder.vskip(value, "authored");
    } else if (item.kind === "penalty") {
      builder.penalty(Number(item.penalty));
    }
  }
  const displayIndexes = new Set(anchors.flatMap((entry, position) => entry.kind === "display" ? [position] : []));
  return anchors.map((entry, position) => {
    const total = builder.glueBefore(entry.id);
    return {
      index: entry.index, kind: entry.kind, key: entry.key, sourceStart: entry.sourceStart, text: entry.text, trace: entry.trace,
      glue: { natural: total.natural - entry.authored.natural, stretch: total.stretch - entry.authored.stretch, shrink: total.shrink - entry.authored.shrink },
      first: position === 0,
      nearDisplay: displayIndexes.has(position) || displayIndexes.has(position - 1),
    };
  });
}

/** Reports the builder's skips next to the old planner's, per top-level item. */
export function runVerticalShadow(
  items: readonly TexVListItem[],
  events: readonly SimpleTexVerticalEvent[],
  font: ResolvedTexFont,
  profile: TexListLayoutProfile | undefined
): void {
  if (!listener) return;
  const oldSkips = new Map<number, { size: number; stretch: number; shrink: number }>();
  for (const skip of planSimpleTexParagraphVerticalSkips(items, font, profile)) {
    if (skip.segmentIndex === 0) oldSkips.set(skip.blockIndex, { size: Number(skip.size), stretch: Number(skip.listStretch ?? 0), shrink: Number(skip.listShrink ?? 0) });
  }
  listener({
    events,
    boundaries: computeVerticalBuilderSkips(items, events, profile).map(skip => {
      const old = oldSkips.get(skip.key);
      return { ...skip, old: old?.size ?? 0, oldStretch: old?.stretch ?? 0, oldShrink: old?.shrink ?? 0, builder: skip.glue.natural };
    }),
  });
}
