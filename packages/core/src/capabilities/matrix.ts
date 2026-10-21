import type { CapabilityMatrix } from "./types.js";

export const capabilityMatrix: CapabilityMatrix = {
  path_statement: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "stable",
    fixtures: ["basic_draw"]
  },
  scope_statement: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["scope_transform"]
  },
  foreach_statement: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["foreach_basic", "foreach_options_core"],
    notes: "Expanded during semantic evaluation with provenance metadata on generated scene elements."
  },
  foreach_path_operation: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["foreach_path_basic"]
  },
  foreach_node_operation: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["foreach_node_basic"]
  },
  pic_operation: {
    parser: "partial",
    semantic: "partial",
    svg: "partial",
    edit: "partial",
    fixtures: ["pic_inline_code", "pic_simple_definition", "pic_path_placement", "pic_template_editing"],
    notes:
      "Supports inline pics/code, simple .pic and pics/name/.style={code=...} definitions, placement, simple transforms, and template-based inspector edits. Parameterized and built-in library pics are deferred."
  },
  unknown_statement: {
    parser: "stable",
    semantic: "partial",
    svg: "none",
    edit: "none",
    fixtures: ["unknown_statement"]
  },
  pgfmath_expression: {
    parser: "none",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["pgfmath_expression"]
  },
  pgfmath_seed_commands: {
    parser: "none",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["pgfmath_seed_commands"]
  },
  pgfmath_random_functions: {
    parser: "none",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["pgfmath_random_functions"]
  },
  options_structured: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["option_styles"]
  },
  transform_cm: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["transform_cm"]
  },
  path_shading: {
    parser: "stable",
    semantic: "stable",
    svg: "partial",
    edit: "partial",
    fixtures: ["shading_styles"],
    notes:
      "Core axis/radial/ball shading keys map to SVG gradients; advanced functional shadings currently fall back with SVG diagnostics."
  },
  path_patterns: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["pattern_styles"]
  },
  path_shadows: {
    parser: "stable",
    semantic: "stable",
    svg: "partial",
    edit: "none",
    fixtures: ["shadow_styles"],
    notes:
      "General/drop/copy/double-copy/circular shadow presets resolve to semantic shadow layers and render via SVG duplicates; advanced fading variants remain partial."
  },
  path_clipping: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["path_clipping"]
  },
  use_as_bounding_box: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["use_as_bounding_box"]
  },
  backgrounds_library: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["backgrounds_library"],
    notes:
      "V1 supports background scopes and documented end-picture background rectangle/grid/side hooks via semantic scene layers."
  },
  arrow_tips: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["arrow_tips"]
  },
  path_operators_basic: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["basic_draw"]
  },
  path_operator_curves: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["curve_operator"]
  },
  path_cycle: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["cycle_polygon"]
  },
  shape_rectangle: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["rectangle_shape"]
  },
  shape_rounded_rectangle: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["rounded_rectangle_shape"]
  },
  shape_chamfered_rectangle: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["chamfered_rectangle_shape"]
  },
  shape_cross_out: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["cross_out_shape"]
  },
  shape_strike_out: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["strike_out_shape"]
  },
  shape_circle: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["circle_shape"]
  },
  shape_magnifying_glass: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["magnifying_glass_shape"]
  },
  shape_circle_split: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["circle_split_shape"]
  },
  shape_circle_solidus: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["circle_solidus_shape"]
  },
  shape_ellipse_split: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["ellipse_split_shape"]
  },
  shape_diamond_split: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["diamond_split_shape"]
  },
  shape_rectangle_split: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["rectangle_split_shape"]
  },
  shape_ellipse: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["ellipse_shape"]
  },
  shape_diamond: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["diamond_shape"]
  },
  shape_trapezium: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["trapezium_shape"]
  },
  shape_semicircle: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["semicircle_shape"]
  },
  shape_isosceles_triangle: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["isosceles_triangle_shape"]
  },
  shape_kite: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["kite_shape"]
  },
  shape_dart: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["dart_shape"]
  },
  shape_circular_sector: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["circular_sector_shape"]
  },
  shape_cylinder: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["cylinder_shape"]
  },
  shape_regular_polygon: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["regular_polygon_shape"]
  },
  shape_star: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["star_shape"]
  },
  shape_cloud: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["cloud_shape"]
  },
  shape_starburst: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["starburst_shape"]
  },
  shape_signal: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["signal_shape"]
  },
  shape_tape: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["tape_shape"]
  },
  shape_rectangle_callout: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["rectangle_callout_shape"]
  },
  shape_ellipse_callout: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["ellipse_callout_shape"]
  },
  shape_cloud_callout: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["cloud_callout_shape"]
  },
  shape_single_arrow: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["single_arrow_shape"]
  },
  shape_double_arrow: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["double_arrow_shape"]
  },
  matrix_node: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["matrix_basic"]
  },
  fit_node: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["fit_basic"]
  },
  named_coordinates: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["coordinate_operation"]
  },
  calc_coordinates: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "partial",
    fixtures: ["calc_coordinates"],
    notes: "Visual translation preserves calc expressions by editing a numeric Cartesian offset or appending one. Relative calc coordinates, singular transforms, and shared expanded source are not rewritten."
  },
  graph_operation: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["graph_operation"]
  },
  plot_operation: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["plot_operation"]
  },
  to_operation: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["to_operation"]
  },
  edge_operation: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["edge_operation"]
  },
  child_operation: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["tree_child_operation"]
  },
  edge_from_parent_operation: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["tree_edge_from_parent"]
  },
  tree_layout_keys: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "partial",
    fixtures: ["tree_layout_keys"]
  },
  tree_level_styles: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["tree_level_styles"]
  },
  tree_every_child_styles: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["tree_every_child_styles"]
  },
  tree_anchor_keys: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["tree_anchor_keys"]
  },
  tree_missing_child: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["tree_missing_child"]
  },
  tree_auto_naming: {
    parser: "none",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["tree_auto_naming"]
  },
  tree_deferred_hooks: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["tree_deferred_hooks"],
    notes: "Low-level tree hooks are parsed and diagnosed, then default tree layout/edge behavior is used as fallback."
  },
  svg_operation: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["svg_operation"]
  },
  let_operation: {
    parser: "stable",
    semantic: "none",
    svg: "none",
    edit: "none",
    fixtures: ["let_operation"]
  },
  decorate_operation: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["decorate_operation"]
  },
  decorate_option: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["decorate_option"]
  },
  decoration_pathmorphing: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["decoration_pathmorphing"]
  },
  decoration_pathreplacing: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["decoration_pathreplacing"]
  },
  decoration_fractals: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["decoration_fractals"]
  },
  decoration_shape_marks: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["decoration_shape_marks"]
  },
  decoration_footprints: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["decoration_footprints"]
  },
  decoration_shape_backgrounds: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["decoration_shape_backgrounds"]
  },
  keyword_ellipse: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["ellipse_keyword"]
  },
  keyword_arc: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["arc_keyword"]
  },
  keyword_grid: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["grid_keyword"]
  },
  keyword_to: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["to_operation"]
  },
  keyword_edge: {
    parser: "stable",
    semantic: "partial",
    svg: "partial",
    edit: "none",
    fixtures: ["edge_operation"]
  },
  keyword_controls: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["curve_operator"]
  },
  keyword_and: {
    parser: "stable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["curve_operator"]
  },
  svg_path: {
    parser: "not-applicable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["basic_draw"]
  },
  svg_circle: {
    parser: "not-applicable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["circle_shape"]
  },
  svg_text: {
    parser: "not-applicable",
    semantic: "stable",
    svg: "stable",
    edit: "stable",
    fixtures: ["node_text"]
  },
  text_includegraphics: {
    parser: "not-applicable",
    semantic: "stable",
    svg: "stable",
    edit: "none",
    fixtures: ["node_text_includegraphics"],
    notes:
      "V1 supports PNG/JPEG/SVG inline graphics, trim/clip/viewport rendering, and desktop PDF graphics rasterized through the app asset resolver. Desktop resolves local assets; browser and unresolved assets render placeholders."
  },
  text_tabular: {
    parser: "partial",
    semantic: "not-applicable",
    svg: "partial",
    edit: "none",
    fixtures: ["text_tabular"],
    notes: "Shared TeX text boxes support l/c/r, fixed-width p columns, array m/b columns and font/alignment declarations, repeated preambles, multicolumn, intercolumn inserts, scoped registers, row spacing, kernel/array rules and stock booktabs rules, spacing and trimmed partial rules. Cell and preamble glyphs retain source ownership through the common text/math renderer. Column macros, multicolumn boundary inserts, nonparagraph vertical cell material and package-specific table engines remain visible source literals."
  },
  text_math_fonts: {
    parser: "partial",
    semantic: "not-applicable",
    svg: "partial",
    edit: "none",
    fixtures: ["text_math_fonts"],
    notes: "Shared math layout supports literal LaTeX mathcodes, scoped math alphabets, boldsymbol and the common bm alphabet with genuine bold fonts, class-specific Latin/operator substitutions, nested Roman alphabets, scripts and accents. Literal bars and vert are single; escaped bars and Vert are double. Literal punctuation uses its declared font and atom class, including ordinary slash spacing. Escaped percent uses the active operators font. bm's unavailable bold extension fallback (pmb) is explicitly unsupported; arbitrary math font declarations are not executed. Dedicated parser, spacing, font and LuaLaTeX glyph checks cover these contracts.",
  },
  text_transform_boxes: {
    parser: "partial",
    semantic: "not-applicable",
    svg: "partial",
    edit: "none",
    fixtures: ["text_transform_boxes"],
    notes: "Shared TeX text layout supports graphicx rotatebox, scalebox, reflectbox and resizebox/star with source-backed text/math, rules and natural-height minipage/parbox composition. Rotation origins, explicit pivots, anisotropic/negative scales and nested transforms preserve painted glyph positions, font axes and caret source ownership. Explicit-height paragraph boxes, unsupported content and complex transform dimensions remain visible source material."
  },
  beamer_slide_manager: {
    parser: "not-applicable", semantic: "not-applicable", svg: "not-applicable", edit: "partial",
    fixtures: ["beamer_slide_manager"],
    notes: "Shared dockable navigator with strip, vertical and grid layouts; source-backed section headings and frame multiselection with a counted drag preview. Copy/paste uses frame-source clipboard text, preserves comments, and renames colliding literal labels and references in one undo step. Complete authored frames support insertion, reorder, duplication with literal label/reference renaming, and deletion. Source operations preserve attached comments. Reordering checks groups, conditional branches and macro bindings, follows understood macro invocations with their actual arguments, and identifies concrete state changes; private literal definitions and their understood dependencies can travel with slides. Identified state changes or changed bindings require review with source excerpts; unknown command uses and opaque expansions do not warn. Uncertain ownership prevents automatic dependency relocation; structural crossings and missing known providers are blocked. Active slide, selection and overlay positions follow frame moves and undo. Source dimming is applied only to the matching source revision. Rendering resolves macros visible at each frame, including between-frame redefinitions. Generated or incomplete frames and computed labels require source editing."
  },
  beamer_direct_resize: {
    parser: "not-applicable",
    semantic: "not-applicable",
    svg: "not-applicable",
    edit: "partial",
    fixtures: ["beamer_direct_resize"],
    notes: "Canvas dividers resize adjacent columns together while preserving their combined width and authored units. Selected resolved images resize proportionally using their existing width/height or scale options. Explicit vertical spacing exposes draggable bands in frames, columns, blocks, and paragraphs. Numeric vspace edits preserve units and stars; smallskip/medskip/bigskip convert to fixed vspace only when resized. Flexible fills and complex dimensions remain source-editable. Gestures preview source changes and commit one undo step. Column widths resolve absolute units and textwidth, linewidth, columnwidth, and paperwidth references."
  },
  beamer_builds: {
    parser: "partial",
    semantic: "not-applicable",
    svg: "not-applicable",
    edit: "partial",
    fixtures: ["beamer_builds"],
    notes:
      "Source-backed overlay inventory and effective per-step states for supported Beamer overlays, including branches, nested rules, pauses and inherited list defaults. Canvas object menus add/remove visibility rules for blocks, items and figures, and navigate shared/complex owners to the Overlays panel. Numeric specs support direct edits and from/only/through timing commands. Single numeric visibility ranges support boundary dragging with transient source previews and one undo commit. Relative, inverted and branching rules retain their own editing semantics."
  },
  beamer_document_scan: {
    parser: "stable",
    semantic: "none",
    svg: "none",
    edit: "none",
    fixtures: ["beamer_document_scan"],
    notes:
      "Headless source scanner inventories Beamer frames, sections, frame headers, preamble metadata, and nested TikZ roots. Frame content lowering and rendering are tracked by later Beamer phases."
  },
  beamer_frame_shrink: {
    parser: "partial", semantic: "not-applicable", svg: "partial", edit: "partial",
    fixtures: ["beamer_frame_shrink"],
    notes: "Stock shrink frames expand body text widths before layout, apply TeX's minimum/overflow scale and cramped list item separation, and retain unscaled titles/chrome. Body glyphs/rules, caret stops and source hit bounds share the same outer transform. Squeeze uses live cramped item separation without scaling. Frame zoom and arbitrary shrink/template redefinitions remain unsupported.",
  },
  beamer_frame_flow: {
    parser: "partial", semantic: "not-applicable", svg: "partial", edit: "none",
    fixtures: ["beamer_frame_flow"],
    notes: "Source-backed frame titles/subtitles and title overlays, empty titles, class size ladders, command/environment columns and default/explicit column glue participate in common paragraph and block/list flow. Default, sidebar, shadow, smoothbars/smoothtree and modern heading boxes measure wrapped content; Moloch subtitles retain their own font and template baseline register. Infolines author/institute/date and sidebar author metadata, standalone frame centering, text/math/list overlayarea boxes, default/ball section-subsection contents, and modern head/title/foot progress bars have independent LuaLaTeX checks. Lists, optical bullet fonts and display skips honor all eight Beamer class sizes (8–20pt). Generated section-hook frames, arbitrary TOC/template programs and package frontends remain outside this bounded support.",
  },
  beamer_titlepages: {
    parser: "partial", semantic: "not-applicable", svg: "partial", edit: "partial",
    fixtures: ["beamer_titlepages"],
    notes: "Measured default/rounded/inmargin and distinct Metropolis/Moloch titlepage templates support title/subtitle wrapping, author/institute/date metadata, titlegraphics, class font sizes, literal preamble font-role settings and maketitle. Source-backed metadata retains edit scopes. Metropolis uses native Fira Sans Light/Regular and their italics, with Latin Modern overrides retained. Literal block font declarations execute within frame/group lifetime. Arbitrary template code, font parents, Fira Mono and general fontspec programs are not executed.",
  },
  beamer_theme_colors: {
    parser: "partial", semantic: "not-applicable", svg: "partial", edit: "none",
    fixtures: ["beamer_theme_colors"],
    notes: "Preamble setbeamercolor declarations interleave with theme components, supporting fg/bg expressions, ordered parent/use roles and starred resets, definecolor/colorlet aliases and background-canvas inheritance. Dove's monochrome roles and text-alert weight, serif TU optical sizes and professionalfonts math-replacement suppression are registered stock components. Literal frame-local block role declarations retain source order and group lifetime; title-only background colorboxes retain asymmetric color separation. Arbitrary color macros and general TeX execution remain outside this support boundary.",
  },
  beamer_tcolorbox: {
    parser: "partial", semantic: "not-applicable", svg: "partial", edit: "none",
    fixtures: ["beamer_tcolorbox"],
    notes: "Basic tcolorbox standard-skin boxes support source-backed titles/body, stock colors/rules/padding/corners, ordinary font and dimension options, minipage text/list layout and surrounding spacing. Skins, breakable/side-by-side or nested boxes, lower panels, global tcbset and arbitrary style code retain bounded unsupported source cards with diagnostics.",
  },
  beamer_source_placeholders: {
    parser: "partial",
    semantic: "not-applicable",
    svg: "partial",
    edit: "partial",
    fixtures: ["beamer_source_placeholders"],
    notes:
      "Beamer frame, column, block and theorem flow render bounded source cards for unsupported environments and failed paragraph layout, preserving supported siblings, overlay-aware geometry and click-to-source selection. Inline fallback remains separate."
  },
  beamer_hyperlinks: {
    parser: "partial",
    semantic: "not-applicable",
    svg: "partial",
    edit: "partial",
    fixtures: ["beamer_references"],
    notes: "Beamer document renderer resolves frame labels, label/hypertarget destinations, hyperlink/hyperref links and safe href/url links. Numeric ref/eqref values and document-wide tags support equation/equation* with explicit tags or automatic numbers. Canvas activation is disabled during text editing. Other counters, full hyperref package execution and PDF annotations are not implemented."
  },
  beamer_manual_bibliography: {
    parser: "partial",
    semantic: "not-applicable",
    svg: "partial",
    edit: "partial",
    fixtures: ["beamer_references"],
    notes: "Beamer document renderer supports manual thebibliography/bibitem entries, numeric/custom citation labels, multi-key cite with an optional note, and citation navigation. Stock bibliography markers (default/article, text, book, online, triangle), label widths, hanging indentation, entry colors and newblock spacing are checked against LuaLaTeX. Arbitrary bibliography template/font/color redefinitions and BibTeX/biblatex processing are not implemented."
  },
  beamer_speaker_notes: {
    parser: "partial",
    semantic: "not-applicable",
    svg: "partial",
    edit: "partial",
    fixtures: ["beamer_speaker_notes"],
    notes: "Literal standard note commands are excluded from audience output and exposed separately for the presenter. Supports overlay specifications, accumulated prose and [item] entries, the final outside-frame note, and unscoped AtBeginNote/AtEndNote hooks. The Notes panel edits a slide's literal notes inside and after its frame as LaTeX, writes a new note at the end of the frame, removes emptied notes, and holds back text that would end a note or frame early. Custom note macros, scoped hooks and note-page PDF templates are not implemented, and hooks and notes from macros are not editable.",
  },
  beamer_footnotes: {
    parser: "partial",
    semantic: "not-applicable",
    svg: "partial",
    edit: "partial",
    fixtures: ["beamer_footnotes"],
    notes: "Beamer frame footnotes support automatic or explicit numeric marks, multiple and wrapped notes, the stock bottom rule and text template, and explicit [frame] notes inside columns or blocks. Glyph sizes, superscript placement and insertion geometry are checked against LuaLaTeX. Minipage-local footnotes, footnotemark/footnotetext and arbitrary template/font redefinitions are not implemented.",
  },
  beamer_overlay_pictures: {
    parser: "partial",
    semantic: "not-applicable",
    svg: "partial",
    edit: "partial",
    fixtures: ["beamer_overlay_pictures"],
    notes: "A tikzpicture with `overlay` among its own options is set as TeX sets it, an empty box in the paragraph around it, and drawn from that place over the page; with `remember picture` its `current page` node is the page. Explicit true/false options respect source order. Paragraph glue, the picture's origin and its text are checked against LuaLaTeX in frames, lists, columns, blocks and under \\only/\\uncover. Shapes can be selected and edited directly on the slide without changing the active frame or text-editing surface. Drawing tools reuse a visible layer or create one with the first drawing, in one undo step: a `tikzlayer` environment at the end of the frame, defined in the preamble (with the TikZ package when needed) as `\\par\\nointerlineskip` and a remembered overlay picture, so the frame's text does not move (checked against LuaLaTeX). A `tikzlayer` is a drawing layer only while every definition of it is the editor's; where the author defines their own, new layers are plain pictures joined to the frame without moving its text. Copied slides carry the definition, and pasting adds it where it is missing (or, into a deck with its own `tikzlayer`, writes each layer as a plain picture). Deleting the last drawing removes the empty picture. The viewed overlay step and slide viewport are shared with the layer. Pictures inherit visible preamble/frame styles, colors and macros, and have separate SVG IDs for clips, gradients and patterns. Drags, inspector scrubs and structurally masked node typing reuse parsing, semantic checkpoints and per-object SVG paint; the slide is laid out with the layer undrawn, and that layout stands while the layer keeps its length; 500-object, text-heavy layers and resize/rotate/paste/cancellation are covered by regressions. The `\\tikz` command form, references between remembered pictures, `remember picture` set through styles, scaling by frame shrink and drawing covered pictures invisibly are not implemented.",
  },
  text_dirac_notation: {
    parser: "partial", semantic: "not-applicable", svg: "partial", edit: "partial",
    fixtures: ["text_dirac_notation"],
    notes: "Source-backed math supports braket's fixed bra, ket and braket, including a single unbraced token, plus scalable Bra/Ket. Delimiter classes, nested fractions, glyphs and spacing are checked against LuaLaTeX. Braket/Set/set and automatic middle delimiters are not implemented."
  },
  beamer_scientific_notation: {
    parser: "partial", semantic: "not-applicable", svg: "partial", edit: "partial",
    fixtures: ["beamer_scientific_notation"],
    notes: "Beamer body paragraphs lower default SI/si/num decimal and e-notation quantities, named SI units, milli/kilo/centi/nano prefixes, squared/cubed and nonsticky per. Numeric input keeps source ranges and unit output owns its authored factor. Package configuration, localization, uncertainty, grouping, micro and S columns are outside this subset and expressions receive package diagnostics."
  },
  beamer_preformatted: {
    parser: "partial", semantic: "not-applicable", svg: "partial", edit: "partial",
    fixtures: ["beamer_preformatted"],
    notes: "Beamer listings supports fullflexible typewriter blocks, preserved spaces/tabs and blank lines, basic font sizes and Python token styles; alltt retains TeX controls and groups. Literal source has structural editing ownership. Unsupported listing options/styles receive a package diagnostic. Line numbers, frames, line wrapping, escape modes and arbitrary language definitions are not implemented."
  },
  beamer_float_captions: {
    parser: "partial",
    semantic: "not-applicable",
    svg: "partial",
    edit: "partial",
    fixtures: ["beamer_float_captions"],
    notes: "Beamer figure/table environments participate in centered source-backed flow. Captions support the default and numbered stock templates, optional short text, stock label separators, caption-name color and class-size-specific caption fonts. Ordinary caption/subcaption-package captions support short centered or wrapped ragged-right text and unnumbered caption* without advancing counters. Struts, bottom minipage depth and caption skips are checked against LuaLaTeX. Subcaption image panels support explicit widths, bottom alignment, letter labels and hfill composition with local graphicx trim/clip. Arbitrary caption template/font/package-option redefinitions are not implemented.",
  },
  beamer_frame_continuations: {
    parser: "partial",
    semantic: "not-applicable",
    svg: "partial",
    edit: "partial",
    fixtures: ["beamer_frame_continuations"],
    notes: "Beamer allowframebreaks renders forced and automatic continuation pages at legal vertical breaks, with stock continuation titles, list glue, split topskip, and footnotes on the final page. Continuation page count is distinct from overlay step count. LuaLaTeX glyph and rule snapshots cover these contracts. Arbitrary continuation template definitions and custom output-routine changes are not implemented.",
  },
  render_pipeline: {
    parser: "not-applicable",
    semantic: "none",
    svg: "stable",
    edit: "none",
    fixtures: ["basic_draw", "circle_shape", "node_text"]
  }
};
