import type { SpaceRun } from "../knuth-plass/paragraph/types.js";
import type { ResolvedTexFont } from "./fonts/types.js";
import { roundTexPt, tfmToPt } from "./fonts/units.js";
import type { TexSpaceGlueProfile } from "./ir.js";

export function texInterwordGlueForSpaceFactor(
  font: ResolvedTexFont,
  spaceFactor: number,
  spaceGlueProfile: TexSpaceGlueProfile
): NonNullable<SpaceRun["texGlue"]> {
  const normalized = Number.isFinite(spaceFactor) && spaceFactor > 0 ? spaceFactor : 1000;
  if (spaceGlueProfile === "tikz-fixed") {
    return {
      width: roundTexPt((normalized >= 2000 ? 0.5 : 0.3333) * font.atPt),
      stretch: 0,
      shrink: 0,
      spaceFactor: normalized,
    };
  }
  const baseSpace = tfmToPt(font, font.data.fontdimen.space);
  const extraSpace = tfmToPt(font, font.data.fontdimen.extraspace ?? 0);
  const baseStretch = tfmToPt(font, font.data.fontdimen.stretch);
  const baseShrink = tfmToPt(font, font.data.fontdimen.shrink);
  return {
    width: roundTexPt(baseSpace + (normalized >= 2000 ? extraSpace : 0)),
    stretch: roundTexPt(baseStretch * normalized / 1000),
    shrink: roundTexPt(baseShrink * 1000 / normalized),
    spaceFactor: normalized,
  };
}
