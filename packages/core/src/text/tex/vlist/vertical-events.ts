/**
 * Applies the IR's vertical events (lists, trivlists, quotes, \par, registers) to a
 * VerticalListBuilder, with the list registers the layout profile selects
 * (design/vertical-list-builder.md).
 */
import type { SimpleTexVerticalEvent } from "../ir.js";
import type { TexListLayoutProfile } from "../layout-options.js";
import {
  glue,
  ZERO_GLUE,
  type VerticalGlue,
  type VerticalListBuilder,
  type VerticalListRegisters,
} from "./vertical-builder.js";

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
