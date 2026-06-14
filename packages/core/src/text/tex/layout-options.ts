import type { TexTextFontProfile } from "./fonts/text-profile.js";

export interface TexLayoutIrOptions {
  readonly parindent?: number;
  readonly tikzTextWidthNode?: boolean;
  readonly textFontProfile?: TexTextFontProfile;
}
