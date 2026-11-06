# Broad Beamer fuzz v2: regressions

These 15 sources were copied byte-for-byte from mismatches in the 1,024-case broad campaign. Their source hashes and generation provenance are recorded in `cases.json`. They cover rotated PGF bounds, nested flow ownership, column alignment, large class fonts, list labels and wrapping, scoped alignment, paragraph glue, and overlapping picture paint order. Each has a pinned, independently compiled LuaLaTeX trace used by the ordinary fidelity tests. The live runner also checks paint against the TeX PDF with strict gates.

Replay them against live LuaLaTeX:

```sh
MAGICK_THREAD_LIMIT=1 OMP_NUM_THREADS=1 node scripts/compare-beamer-priorities.mjs \
  --manifest test/fixtures/beamer/fuzz-findings-v2/cases.json \
  --out-dir artifacts/beamer-fuzz/findings-v2
```

Use `--cases` with a case ID to replay one source. The runner exits nonzero on any mismatch.

- [rotated-curve-bounds](rotated-curve-bounds.tex): Rotated curves have displaced paint footprints.
- [leading-center-column](leading-center-column.tex): A leading alignment environment in a top-aligned column shifts text and paint.
- [large-titlepage-date](large-titlepage-date.tex): Title-page glyphs shift by about 5.56 pt at a 17-point class size.
- [picture-in-list](picture-in-list.tex): Text and rule coordinates shift by approximately 16.8 pt.
- [consecutive-pictures](consecutive-pictures.tex): A paragraph separator between pictures is diagnosed as unsupported and displaces content.
- [math-relation-spacing](math-relation-spacing.tex): The 20-point math/prose case has glyph x differences up to 41.05 pt.
- [scoped-alignment](scoped-alignment.tex): Scoped alignment followed by a picture produces unmatched lines and displaced paint.

- [negative-rotation-overlay-flow](negative-rotation-overlay-flow.tex): Negative rotations preserve PGF's authored cubic protocol bounds.
- [large-list-picture-overflow](large-list-picture-overflow.tex): An oversized picture can break after the list label.
- [top-column-itemize](top-column-itemize.tex): Leading lists set the correct top-column reference.
- [top-column-enumerate-small](top-column-enumerate-small.tex) and [top-column-enumerate](top-column-enumerate.tex): Projected labels use the class font size and contribute their full height to line layout.
- [leading-center-capital-t](leading-center-capital-t.tex): A leading alignment environment clears the capital-T column's initial skip.
- [large-relative-overlay-glyph-edge](large-relative-overlay-glyph-edge.tex): At the standard 1600px width, one pixel in a letter counter changes mask membership. This case explicitly uses 3200px, with the same strict zero-interior-disagreement gate. The original 1600px mismatch remains in the full replay report.
- [remembered-picture-paint-order](remembered-picture-paint-order.tex): Following text paints above an overlapping remembered picture.

PGF picture bounds deliberately differ from tight ink bounds. The ellipse fix preserves the original transformed axes and PGF's cubic protocol, including its deferred first-control y assignment. Logging inside `pgf@protocolsizes` changes that assignment's timing, so the focused numeric regression uses dimensions collected only after the completed path.

The baseline campaign had 664 passing cases and 360 mismatches across 1,024 cases and 2,582 pages, with no invalid references, page-count mismatches or tool errors. Raster comparisons now use Cairo for both the independent PDF and native SVG; this avoids the old Splash-versus-Cairo triangle-edge quantization discrepancy without changing any comparison tolerance, mask, paint witness or structural gate.
