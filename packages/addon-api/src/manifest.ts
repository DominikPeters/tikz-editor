export type AddonLayerStatus = "not-applicable" | "none" | "partial" | "stable";

/**
 * A capability-matrix row contributed by an add-on. Feature ids must be
 * namespaced as `addon:<addonId>:<feature>` so they merge into the host's
 * capability matrix without colliding with core feature ids.
 */
export type AddonCapabilityRow = {
  featureId: `addon:${string}`;
  parser: AddonLayerStatus;
  semantic: AddonLayerStatus;
  svg: AddonLayerStatus;
  edit: AddonLayerStatus;
  notes?: string;
};

export type AddonTriggers = {
  /** Environment names the add-on claims, e.g. ["axis", "semilogxaxis"]. */
  environments?: string[];
  /**
   * Semicolon-terminated command names the add-on claims, with leading
   * backslash, e.g. ["\\addplot"]. These parse through the host grammar.
   */
  commands?: string[];
  /**
   * TeX-macro-style command names whose arguments are only {...} groups and
   * [...] option lists and that are NOT semicolon-terminated, e.g.
   * ["\\pgfplotsset", "\\duck"]. These are recovered by a host prescan.
   */
  macroCommands?: string[];
  /** \usepackage names that activate the add-on, e.g. ["pgfplots"]. */
  packages?: string[];
  /** \usetikzlibrary (or add-on-specific library command) names. */
  tikzLibraries?: string[];
};

export type AddonManifest = {
  /** Stable identifier, e.g. "pgfplots". Used to namespace features, properties, and commands. */
  id: string;
  /** The add-on's own semver version. */
  version: string;
  /** Semver range of @tikz-editor/addon-api this add-on targets, e.g. "^0.1.0". */
  apiVersion: string;
  displayName: string;
  /** SPDX license expression, shown in the add-on manager UI. */
  license: string;
  /** Corresponding-source link (GPL compliance for GPL add-ons). */
  sourceUrl: string;
  triggers: AddonTriggers;
  /** Preamble lines required for standalone-LaTeX export of documents using this add-on. */
  requiredPreamble?: string[];
  capabilities?: AddonCapabilityRow[];
  /** Module specifiers within the distributed bundle. */
  entries: { engine: string; ui?: string };
};
