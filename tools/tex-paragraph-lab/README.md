# TeX Paragraph Lab

Internal browser tool for comparing the TeX-derived paragraph renderer with a local LaTeX oracle.

Run from the repository root:

```sh
npm run -w @tikz-editor/core build
npm run dev:tex-paragraph-lab
```

Open `http://127.0.0.1:43291`.

The left pane imports `packages/core/dist/text/tex` directly and renders the current `layoutSimpleTexParagraph` report as SVG glyph paths, including supported TeX-derived inline and display math boxes. Unsupported math intentionally shows the renderer fallback state. The right pane posts the same text/options to the local Node server, which runs `lualatex` with the AMS math packages, converts the generated PDF to SVG with `pdftocairo`, and returns both the SVG and `pdftotext`-extracted line texts.

The server caches oracle responses by text/options hash. Set `TEX_PARAGRAPH_LAB_PORT` or `TEX_PARAGRAPH_LAB_HOST` to override the default `127.0.0.1:43291`.
