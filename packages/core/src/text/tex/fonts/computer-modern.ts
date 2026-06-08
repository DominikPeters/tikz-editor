import { COMPUTER_MODERN_OT1_FONTS } from "./data/computer-modern-ot1.generated.js";
import type { GeneratedTexFont, ResolvedTexFont, ShapeTexTextOptions, ShapedTexTextRun } from "./types.js";
import { shapeOt1Text } from "../shaping/shape.js";

export const DEFAULT_COMPUTER_MODERN_TEXT_FONTS = [
  "cmr10",
  "cmbx10",
  "cmti10",
  "cmbxti10",
  "cmtt10",
  "cmss10",
  "cmssi10",
  "cmssbx10",
  "cmcsc10",
] as const;

export type DefaultComputerModernTextFont = typeof DEFAULT_COMPUTER_MODERN_TEXT_FONTS[number];

export interface ResolveComputerModernFontOptions {
  readonly fontId?: DefaultComputerModernTextFont;
  readonly atPt?: number;
}

export class ComputerModernTexMetricProvider {
  public resolveFont(options: ResolveComputerModernFontOptions = {}): ResolvedTexFont {
    const id = options.fontId ?? "cmr10";
    const data = COMPUTER_MODERN_OT1_FONTS[id] as GeneratedTexFont | undefined;
    if (!data) {
      throw new Error(`Computer Modern font '${id}' is not available in the generated OT1 table.`);
    }
    return {
      id,
      atPt: options.atPt ?? data.designSize,
      data,
    };
  }

  public shapeText(
    text: string,
    font: ResolvedTexFont = this.resolveFont(),
    options: ShapeTexTextOptions = {}
  ): ShapedTexTextRun {
    return shapeOt1Text(text, font, options);
  }
}

export const computerModernTexMetricProvider = new ComputerModernTexMetricProvider();
