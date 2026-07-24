export interface BeamerThemeVariant {
  readonly theme?: string;
  readonly colorTheme?: string;
  readonly fontTheme?: string;
  readonly innerTheme?: string;
  readonly outerTheme?: string;
}

export function applyBeamerThemeVariant(
  source: string,
  variant?: BeamerThemeVariant
): string;

export function beamerThemeVariantSlug(
  variant?: BeamerThemeVariant
): string;
