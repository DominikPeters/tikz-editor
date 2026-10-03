import { COMPUTER_MODERN_OT1_FONTS } from "./data/computer-modern-ot1.generated.js";
import type {
  GeneratedTexFont,
  ResolveTexFontOptions,
  ResolvedTexFont,
  ShapeTexTextOptions,
  ShapedTexTextRun,
  TexMetricProvider,
} from "./types.js";
import { TexShapedTextCache } from "../shaping/cache.js";
import { shapeOt1Text } from "../shaping/shape.js";
import { texLength } from "../coordinates.js";

// Keep state out of serializable font profiles and support borrowed methods.
const shapedTextCaches = new WeakMap<object, TexShapedTextCache>();

export const DEFAULT_COMPUTER_MODERN_TEXT_FONTS = [
  "cmr10",
  "cmbx10",
  "cmbx7",
  "cmbx5",
  "cmti10",
  "cmti7",
  "cmbxti10",
  "cmtt10",
  "cmtt8",
  "cmss10",
  "cmss8",
  "cmssi10",
  "cmssbx10",
  "cmcsc10",
  "lmroman10-regular",
  "lmroman10-bold",
  "lmroman10-italic",
  "lmroman10-bolditalic",
  "lmroman7-regular",
  "lmroman7-bold",
  "lmroman7-italic",
  "lmroman5-regular",
  "lmroman5-bold",
  "lmromanslant10-regular",
  "lmromanslant10-bold",
  "lmromanslant8-regular",
  "lmromancaps10-regular",
  "lmmono10-regular",
  "lmmono10-italic",
  "lmmono8-regular",
  "lmmono9-regular",
  "lmmono12-regular",
  "lmmonoslant10-regular",
  "lmmonocaps10-regular",
  "lmmonolt10-bold",
  "lmmonolt10-boldoblique",
  "lmsans10-regular",
  "lmsans12-regular",
  "lmsans17-regular",
  "lmsans10-bold",
  "lmsans10-oblique",
  "lmsans12-oblique",
  "lmsans17-oblique",
  "lmsans10-boldoblique",
  "lmsans8-regular",
  "lmsans8-oblique",
  "lmsans9-regular",
  "lmsans9-oblique",
  "tcrm1000",
  "cmss9",
  "cmss12",
  "cmss17",
  "lmromandemi10-regular",
] as const;

export type DefaultComputerModernTextFont = typeof DEFAULT_COMPUTER_MODERN_TEXT_FONTS[number];

export const DEFAULT_COMPUTER_MODERN_MATH_FONTS = [
  "cmr10",
  "cmr12",
  "cmr17",
  "cmr9",
  "cmr8",
  "cmr7",
  "cmr6",
  "cmr5",
  "cmmi10",
  "cmmi12",
  "cmmi9",
  "cmmi8",
  "cmmi7",
  "cmmi6",
  "cmmi5",
  "cmsy10",
  "cmsy9",
  "cmsy8",
  "cmsy7",
  "cmsy6",
  "cmsy5",
  "cmex10",
  "cmex9",
  "cmex8",
  "cmex7",
  "cmbx10",
  "cmbx7",
  "cmbx5",
  "cmti10",
  "cmti7",
  "cmtt10",
  "cmtt8",
  "cmss10",
  "cmss8",
  "msam10",
  "msam7",
  "msam5",
  "msbm10",
  "msbm7",
  "msbm5",
  "eufm10",
  "eufm7",
  "eufm5",
  "eufb10",
  "eufb7",
  "eufb5",
  "cmmib10",
  "cmmib7",
  "cmmib5",
  "cmbsy10",
  "cmbsy7",
  "cmbsy5",
  "rsfs10",
  "rsfs7",
  "rsfs5",
  "cmss9",
  "cmss12",
  "cmss17",
] as const;

export type DefaultComputerModernMathFont = typeof DEFAULT_COMPUTER_MODERN_MATH_FONTS[number];

export type ResolveComputerModernFontOptions = ResolveTexFontOptions;

export class ComputerModernTexMetricProvider implements TexMetricProvider {
  public constructor() {
    shapedTextCaches.set(this, new TexShapedTextCache());
  }

  public resolveFont(options: ResolveComputerModernFontOptions = {}): ResolvedTexFont {
    const id = options.fontId ?? "cmr10";
    const data = Object.hasOwn(COMPUTER_MODERN_OT1_FONTS, id)
      ? COMPUTER_MODERN_OT1_FONTS[id] as GeneratedTexFont | undefined
      : undefined;
    if (!data) {
      throw new Error(`Computer Modern font '${id}' is not available in the generated OT1 table.`);
    }
    return {
      id,
      atPt: options.atPt ?? texLength(data.designSize),
      data,
    };
  }

  public shapeText(
    text: string,
    font: ResolvedTexFont = this.resolveFont(),
    options: ShapeTexTextOptions = {}
  ): ShapedTexTextRun {
    return shapedTextCaches.get(this)?.shapeText(text, font, options) ?? shapeOt1Text(text, font, options);
  }
}

export const computerModernTexMetricProvider = new ComputerModernTexMetricProvider();
