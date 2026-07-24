import type { BeamerThemeVariant } from "./beamer-theme-variants.mjs";

export interface BuiltInBeamerTheme {
  readonly id: string;
  readonly label: string;
  readonly variant: BeamerThemeVariant;
}

export const BUILT_IN_BEAMER_THEMES: readonly BuiltInBeamerTheme[];
