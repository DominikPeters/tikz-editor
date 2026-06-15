import type { TexTextFontProfile } from "./fonts/text-profile.js";
import type { TexSpaceGlueProfile } from "./ir.js";
import type { TexMathBoxProvider } from "./layout-inline-items.js";

export interface TexLayoutIrOptions {
  readonly width?: number;
  readonly parindent?: number;
  readonly rightskipStretch?: number;
  readonly tikzTextWidthNode?: boolean;
  readonly spaceGlueProfile?: TexSpaceGlueProfile;
  readonly textFontProfile?: TexTextFontProfile;
  readonly mathBoxProvider?: TexMathBoxProvider;
}
