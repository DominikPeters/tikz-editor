# Runtime fonts

Status: design, 2026-11-26. Nothing implemented yet. Split out of the
[beamerposter design](beamerposter.md) after two reviews (Fable with TeX
probes; codex `gpt-6.2-sol`).

Documents that select fonts render in those fonts: Beamer decks and posters
with fontspec, TikZ documents with fontspec, and pdfLaTeX documents with
font packages such as `times` or `helvet`. Today they fall back to the
bundled faces. Posters with the Gemini theme (Lato for text, Raleway for
headings) are the first target.

## Today

Every face is converted at build time by
`scripts/generate-tex-font-data.mjs`: a TFM path through `tftopl` for
Computer Modern and the AMS fonts, and an OpenType path through `ttx`,
LuaLaTeX measurements and a hand-written ligature list for Fira Sans and
Latin Modern. Decks that load fontspec are already detected and compiled with
XeLaTeX (`beamer/compile.ts`), but render natively in substitute faces.

## Evidence

- Poster themes: Lato and Raleway in 10 theme files (the Gemini family);
  TeX Gyre Heros in 2; singletons, several proprietary (Helvetica Neue,
  Georgia, Arial, HelveticaNow). Font packages in poster entry points:
  `lmodern` 14, `times` 4, `helvet` 4, `libertine` 4, `newtxmath` 5,
  `inconsolata` 5. Engines: pdfLaTeX 42, LuaLaTeX 18, XeLaTeX 11.
- Gemini sizes its templates in `ex`, so its x-heights decide its layout; it
  cannot be compared with TeX before its fonts load.
- TikZ figures written for papers often load `times` or `newtx`.

## OpenType text fonts at runtime

- **Loader.** harfbuzzjs shapes and provides outlines. The shaping-only
  `harfbuzz.wasm` (1.6.4) is 444 KB, 147 KB with brotli; it loads only when
  a document needs a runtime font. Computer Modern, Latin Modern and Fira
  keep their generated data.
- **Glyph records.** Shaped clusters map back to source ranges and caret
  stops, as the generated fonts' glyph records do
  (`text/tex/fonts/types.ts`), so editing and caret movement behave the same
  in both paths.
- **Features.** Match the TeX defaults: `liga` and `kern`, `Ligatures=TeX`
  (`--`, `---`, quotes), and fontspec's face mapping
  (`UprightFont=*-Light`, `BoldFont=*-Regular`, `ItalicFont`,
  `BoldItalicFont`), `\newfontfamily` and `\setsansfont`/`\setmainfont`.
- **Search order.** Mirror what the TeX engine finds: fonts in the project
  (fontspec `Path=`, a `fonts/` folder), then the TeX Live tree, then system
  fonts. On desktop the TeX Live lookup uses `kpsewhich` where TeX is
  installed. A system copy of a font with a different version has different
  metrics; TeX's copy wins.
- **Platforms.** Desktop reads all three locations. Web reads project fonts,
  and system fonts only through the Local Font Access API in Chromium, after
  a permission prompt. iPad reads project fonts.
- **Fallbacks.** Bundle Lato and Raleway (both freely licensed, both in TeX
  Live) so that Gemini documents render the same everywhere. Any other
  missing font is substituted deterministically and reported.

## pdfLaTeX font packages

`times`, `helvet`, `libertine`, `newtxtext`/`newtxmath`, `inconsolata` and
the like are Type 1 fonts with TFM metrics. They are a small fixed set, so
their data is generated at build time through the existing TFM path from the
fonts TeX Live actually uses, not approximated by OpenType look-alikes whose
metrics differ. Which packages enter is decided by counts across the poster,
deck and TikZ corpora.

## Out of scope

- OpenType math fonts (Fira Math, Erewhon Math, STIX Two Math) need the MATH
  table: variants, constants and assembly. Gemini uses `professionalfonts`,
  so its math stays Computer Modern.
- CJK fonts and `ctexbeamer`.

## Verification

- Glyph advances, kerns and ligatures of runtime fonts against LuaLaTeX and
  XeLaTeX for the same font file.
- Line breaks and box heights of `ex`-sized template code against TeX traces
  with the theme's fonts.
- Caret stops and source ranges agree between generated and runtime fonts on
  the same text.

## Risks

- A second font path whose glyph records, caret stops and metrics must agree
  with the generated one.
- luaotfload and XeTeX shape slightly differently from each other; the oracle
  uses the engine the document names.
