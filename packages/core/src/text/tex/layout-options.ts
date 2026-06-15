import type { TexTextFontProfile } from "./fonts/text-profile.js";
import type { TexMathBoxProvider } from "./layout-inline-items.js";

export interface TexLayoutIrOptions {
  readonly width?: number;
  readonly parindent?: number;
  readonly tikzTextWidthNode?: boolean;
  readonly textFontProfile?: TexTextFontProfile;
  readonly mathBoxProvider?: TexMathBoxProvider;
}
