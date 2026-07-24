import { describe, expect, it } from "vitest";

import {
  applyBeamerThemeVariant,
  beamerThemeVariantSlug,
} from "../scripts/lib/beamer-theme-variants.mjs";

describe("Beamer comparison theme variants", () => {
  it("replaces existing theme components in place", () => {
    const source = String.raw`\documentclass{beamer}
\usetheme{Madrid}
\usecolortheme[RGB={1,2,3}]{seahorse}
\begin{document}\end{document}`;

    expect(applyBeamerThemeVariant(source, {
      theme: "default",
      colorTheme: "dove",
    })).toBe(String.raw`\documentclass{beamer}
\usetheme{default}
\usecolortheme{dove}
\begin{document}\end{document}`);
  });

  it("injects absent components after the document class in Beamer order", () => {
    const source = String.raw`\documentclass[aspectratio=169]{beamer}
\begin{document}\end{document}`;

    expect(applyBeamerThemeVariant(source, {
      theme: "Madrid",
      colorTheme: "seahorse",
      fontTheme: "professionalfonts",
    })).toBe(String.raw`\documentclass[aspectratio=169]{beamer}

\usetheme{Madrid}
\usecolortheme{seahorse}
\usefonttheme{professionalfonts}
\begin{document}\end{document}`);
  });

  it("removes duplicate declarations for an overridden component", () => {
    const source = String.raw`\documentclass{beamer}
\usetheme{Madrid}
\usetheme{default}
\begin{document}\end{document}`;

    const transformed = applyBeamerThemeVariant(source, { theme: "Boadilla" });
    expect(transformed.match(/\\usetheme/gu)).toHaveLength(1);
    expect(transformed).toContain(String.raw`\usetheme{Boadilla}`);
  });

  it("builds stable artifact slugs from explicit components", () => {
    expect(beamerThemeVariantSlug({
      theme: "Madrid",
      colorTheme: "seahorse",
    })).toBe("theme-madrid-color-theme-seahorse");
    expect(beamerThemeVariantSlug()).toBe("source-theme");
  });
});
