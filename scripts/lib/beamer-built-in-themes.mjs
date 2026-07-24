/**
 * Presentation themes shipped by Beamer 3.76, excluding the legacy
 * compatibility aliases (`bars`, `classic`, `lined`, and friends).
 *
 * Keep the labels identical to their `beamertheme*.sty` filenames: theme
 * names are case-sensitive at the TeX file-system boundary.
 */
export const BUILT_IN_BEAMER_THEMES = Object.freeze([
  ["default", "Default", "default"],
  ["ann-arbor", "AnnArbor", "AnnArbor"],
  ["antibes", "Antibes", "Antibes"],
  ["bergen", "Bergen", "Bergen"],
  ["berkeley", "Berkeley", "Berkeley"],
  ["berlin", "Berlin", "Berlin"],
  ["boadilla", "Boadilla", "Boadilla"],
  ["cambridge-us", "CambridgeUS", "CambridgeUS"],
  ["copenhagen", "Copenhagen", "Copenhagen"],
  ["darmstadt", "Darmstadt", "Darmstadt"],
  ["dresden", "Dresden", "Dresden"],
  ["east-lansing", "EastLansing", "EastLansing"],
  ["frankfurt", "Frankfurt", "Frankfurt"],
  ["goettingen", "Goettingen", "Goettingen"],
  ["hannover", "Hannover", "Hannover"],
  ["ilmenau", "Ilmenau", "Ilmenau"],
  ["juan-les-pins", "JuanLesPins", "JuanLesPins"],
  ["luebeck", "Luebeck", "Luebeck"],
  ["madrid", "Madrid", "Madrid"],
  ["malmoe", "Malmoe", "Malmoe"],
  ["marburg", "Marburg", "Marburg"],
  ["montpellier", "Montpellier", "Montpellier"],
  ["palo-alto", "PaloAlto", "PaloAlto"],
  ["pittsburgh", "Pittsburgh", "Pittsburgh"],
  ["rochester", "Rochester", "Rochester"],
  ["singapore", "Singapore", "Singapore"],
  ["szeged", "Szeged", "Szeged"],
  ["warsaw", "Warsaw", "Warsaw"],
].map(([id, label, theme]) => Object.freeze({
  id,
  label,
  variant: Object.freeze({
    theme,
    // The KKT/conformance fixtures select Seahorse explicitly. Remove that
    // later component so the aggregate theme is compared as shipped.
    colorTheme: false,
  }),
})));
