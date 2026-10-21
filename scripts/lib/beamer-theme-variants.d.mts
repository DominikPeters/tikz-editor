export interface BeamerThemeVariant {
  readonly theme?: string | false;
  readonly colorTheme?: string | false;
  readonly fontTheme?: string | false;
  readonly innerTheme?: string | false;
  readonly outerTheme?: string | false;
}

export function applyBeamerThemeVariant(
  source: string,
  variant?: BeamerThemeVariant
): string;

export function beamerThemeVariantSlug(
  variant?: BeamerThemeVariant
): string;
