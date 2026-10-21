export interface BeamerThemeGalleryReport {
  readonly formatVersion: number;
  readonly decks: readonly string[];
  readonly variants: readonly string[];
  readonly variantCatalog?: readonly {
    readonly id: string;
    readonly label: string;
  }[];
  readonly raster: boolean;
  readonly passed: number;
  readonly failed: number;
  readonly results: readonly unknown[];
}

export function renderBeamerThemeGallery(
  report: BeamerThemeGalleryReport
): string;
