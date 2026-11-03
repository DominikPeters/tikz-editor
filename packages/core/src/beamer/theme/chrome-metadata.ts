import type { ResolvedBeamerTheme } from "./types.js";

export type BeamerChromeMetadataField = "title" | "author" | "institute" | "date";

const ORDER: readonly BeamerChromeMetadataField[] = ["title", "author", "institute", "date"];

/**
 * The title-page fields a theme's headline, footline and sidebar print. These
 * templates print the short form (`\author[short]{long}`) when there is one,
 * else the long form, so this is where short forms matter.
 * `test/beamer-deck-document-inspector.spec.ts` checks it against the
 * rendered chrome of every catalog theme.
 */
export function beamerChromeMetadataFields(theme: ResolvedBeamerTheme): BeamerChromeMetadataField[] {
  const fields = new Set<BeamerChromeMetadataField>();
  const { footline, headline, sidebar } = theme.templates;
  switch (footline.id) {
    case "beamer/footline/infolines":
      for (const field of ORDER) fields.add(field);
      break;
    case "beamer/footline/split":
      fields.add("author").add("title");
      break;
    case "beamer/footline/miniframes": {
      // The style names its boxes: authorinstitutetitle, institutetitle, ….
      const style = typeof footline.options.style === "string" ? footline.options.style : "empty";
      for (const field of ["author", "institute", "title"] as const) {
        if (style.includes(field)) fields.add(field);
      }
      break;
    }
  }
  if (headline.id === "beamer/headline/tree" || headline.id === "beamer/headline/smoothtree") {
    fields.add("title");
  }
  if (sidebar.id === "beamer/sidebar/navigation" && Number(sidebar.options.widthPt ?? 0) > 0) {
    fields.add("title").add("author");
  }
  return ORDER.filter((field) => fields.has(field));
}
