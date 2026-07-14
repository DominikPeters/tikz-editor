import type { ResolvedTexFont } from "./fonts/types.js";
import { roundTexPt, tfmToPt } from "./fonts/units.js";
import type { TexSpaceGlueProfile } from "./ir.js";
import { texLength, type TexLength } from "./coordinates.js";

export interface TexInterwordGlue {
  readonly width: TexLength;
  readonly stretch: TexLength;
  readonly shrink: TexLength;
  readonly spaceFactor: number;
}

export function texInterwordGlueForSpaceFactor(
  font: ResolvedTexFont,
  spaceFactor: number,
  spaceGlueProfile: TexSpaceGlueProfile
): TexInterwordGlue {
  const normalized = Number.isFinite(spaceFactor) && spaceFactor > 0 ? spaceFactor : 1000;
  if (spaceGlueProfile === "tikz-fixed") {
    return {
      width: texLength(roundTexPt((normalized >= 2000 ? 0.5 : 0.3333) * font.atPt)),
      stretch: texLength(0),
      shrink: texLength(0),
      spaceFactor: normalized,
    };
  }
  const baseSpace = tfmToPt(font, font.data.fontdimen.space);
  const extraSpace = tfmToPt(font, font.data.fontdimen.extraspace ?? 0);
  const baseStretch = tfmToPt(font, font.data.fontdimen.stretch);
  const baseShrink = tfmToPt(font, font.data.fontdimen.shrink);
  return {
    width: texLength(roundTexPt(baseSpace + (normalized >= 2000 ? extraSpace : 0))),
    stretch: texLength(roundTexPt(baseStretch * normalized / 1000)),
    shrink: texLength(roundTexPt(baseShrink * 1000 / normalized)),
    spaceFactor: normalized,
  };
}
