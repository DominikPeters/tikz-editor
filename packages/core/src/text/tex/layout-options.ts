import type { TexTextFontProfile } from "./fonts/text-profile.js";
import type { TexSpaceGlueProfile } from "./ir.js";
import type { TexMathBoxProvider } from "./layout-inline-items.js";
import type { NodeTextGraphicsResolver } from "../types.js";
import type { TexLength } from "./coordinates.js";

export interface TexLayoutIrOptions {
  readonly width?: TexLength;
  readonly parindent?: TexLength;
  readonly rightskipStretch?: TexLength;
  readonly tikzTextWidthNode?: boolean;
  readonly spaceGlueProfile?: TexSpaceGlueProfile;
  readonly textFontProfile?: TexTextFontProfile;
  readonly mathBoxProvider?: TexMathBoxProvider;
  readonly graphicsResolver?: NodeTextGraphicsResolver;
}
