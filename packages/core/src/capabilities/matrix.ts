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
  render_pipeline: {
    parser: "not-applicable",
    semantic: "none",
    svg: "stable",
    edit: "none",
    fixtures: ["basic_draw", "circle_shape", "node_text"]
  }
};
