//! Statement and item identifier strings.
//!
//! Port of `packages/core/src/ast/ids.ts`. Every AST node carries a stable
//! string id built from its statement index (and, for items, the item index
//! plus an optional clause index). The id format must match the legacy editor
//! exactly so persisted documents and diagnostics stay comparable.
//!
//! ```
//! use tikz_core::ids::path_statement_id;
//! assert_eq!(path_statement_id(7), "path:7");
//! ```

/// Id of a path statement.
pub fn path_statement_id(statement_index: usize) -> String {
    format!("path:{statement_index}")
}

/// Id of a scope statement.
pub fn scope_statement_id(statement_index: usize) -> String {
    format!("scope:{statement_index}")
}

/// Id of a foreach statement.
pub fn foreach_statement_id(statement_index: usize) -> String {
    format!("foreach:{statement_index}")
}

/// Id of a macro definition (`\def`).
pub fn macro_definition_statement_id(statement_index: usize) -> String {
    format!("macro-definition:{statement_index}")
}

/// Id of a macro alias (`\let`).
pub fn macro_alias_statement_id(statement_index: usize) -> String {
    format!("macro-alias:{statement_index}")
}

/// Id of a macro command definition (`\newcommand` family).
pub fn macro_command_definition_statement_id(statement_index: usize) -> String {
    format!("macro-command-definition:{statement_index}")
}

/// Id of a pgf math assignment statement.
pub fn pgf_math_statement_id(statement_index: usize) -> String {
    format!("pgfmath:{statement_index}")
}

/// Id of a `\tikzset` statement.
pub fn tikz_set_statement_id(statement_index: usize) -> String {
    format!("tikz-set:{statement_index}")
}

/// Id of a `\tikzstyle` statement.
pub fn tikz_style_statement_id(statement_index: usize) -> String {
    format!("tikz-style:{statement_index}")
}

/// Id of a `\pgfkeys` statement.
pub fn pgfkeys_statement_id(statement_index: usize) -> String {
    format!("pgfkeys:{statement_index}")
}

/// Id of a `\usetikzlibrary` statement.
pub fn tikz_library_statement_id(statement_index: usize) -> String {
    format!("tikz-library:{statement_index}")
}

/// Id of a `\colorlet` statement.
pub fn colorlet_statement_id(statement_index: usize) -> String {
    format!("colorlet:{statement_index}")
}

/// Id of a `\definecolor` statement.
pub fn define_color_statement_id(statement_index: usize) -> String {
    format!("definecolor:{statement_index}")
}

/// Id of an unknown statement.
pub fn unknown_statement_id(statement_index: usize) -> String {
    format!("unknown-statement:{statement_index}")
}

/// Id of a coordinate item.
pub fn coordinate_item_id(statement_index: usize, item_index: usize) -> String {
    format!("coordinate:{statement_index}:{item_index}")
}

/// Id of a node item.
pub fn node_item_id(statement_index: usize, item_index: usize) -> String {
    format!("node:{statement_index}:{item_index}")
}

/// Id of a node foreach clause.
pub fn node_foreach_clause_id(statement_index: usize, item_index: usize, clause_index: usize) -> String {
    format!("node-foreach-clause:{statement_index}:{item_index}:{clause_index}")
}

/// Id of a path option item.
pub fn path_option_item_id(statement_index: usize, item_index: usize) -> String {
    format!("path-option:{statement_index}:{item_index}")
}

/// Id of a path comment item.
pub fn path_comment_item_id(statement_index: usize, item_index: usize) -> String {
    format!("path-comment:{statement_index}:{item_index}")
}

/// Id of a path keyword item.
pub fn path_keyword_item_id(statement_index: usize, item_index: usize) -> String {
    format!("path-keyword:{statement_index}:{item_index}")
}

/// Id of a graph operation item.
pub fn graph_operation_item_id(statement_index: usize, item_index: usize) -> String {
    format!("graph-operation:{statement_index}:{item_index}")
}

/// Id of a plot operation item.
pub fn plot_operation_item_id(statement_index: usize, item_index: usize) -> String {
    format!("plot-operation:{statement_index}:{item_index}")
}

/// Id of a path foreach item.
pub fn path_foreach_item_id(statement_index: usize, item_index: usize) -> String {
    format!("path-foreach:{statement_index}:{item_index}")
}

/// Id of a pic operation item.
pub fn pic_operation_item_id(statement_index: usize, item_index: usize) -> String {
    format!("pic-operation:{statement_index}:{item_index}")
}

/// Id of a pic foreach clause.
pub fn pic_foreach_clause_id(statement_index: usize, item_index: usize, clause_index: usize) -> String {
    format!("pic-foreach-clause:{statement_index}:{item_index}:{clause_index}")
}

/// Id of a to operation item.
pub fn to_operation_item_id(statement_index: usize, item_index: usize) -> String {
    format!("to-operation:{statement_index}:{item_index}")
}

/// Id of an edge operation item.
pub fn edge_operation_item_id(statement_index: usize, item_index: usize) -> String {
    format!("edge-operation:{statement_index}:{item_index}")
}

/// Id of a child operation item.
pub fn child_operation_item_id(statement_index: usize, item_index: usize) -> String {
    format!("child-operation:{statement_index}:{item_index}")
}

/// Id of an edge-from/edge-to-parent operation item.
pub fn edge_from_parent_operation_item_id(statement_index: usize, item_index: usize) -> String {
    format!("edge-from-parent-operation:{statement_index}:{item_index}")
}

/// Id of a child foreach clause.
pub fn child_foreach_clause_id(statement_index: usize, item_index: usize, clause_index: usize) -> String {
    format!("child-foreach-clause:{statement_index}:{item_index}:{clause_index}")
}

/// Id of an svg operation item.
pub fn svg_operation_item_id(statement_index: usize, item_index: usize) -> String {
    format!("svg-operation:{statement_index}:{item_index}")
}

/// Id of a let operation item.
pub fn let_operation_item_id(statement_index: usize, item_index: usize) -> String {
    format!("let-operation:{statement_index}:{item_index}")
}

/// Id of a decorate operation item.
pub fn decorate_operation_item_id(statement_index: usize, item_index: usize) -> String {
    format!("decorate-operation:{statement_index}:{item_index}")
}

/// Id of a coordinate operation item.
pub fn coordinate_operation_item_id(statement_index: usize, item_index: usize) -> String {
    format!("coordinate-operation:{statement_index}:{item_index}")
}

/// Id of an unknown path item.
pub fn unknown_path_item_id(statement_index: usize, item_index: usize) -> String {
    format!("unknown-path-item:{statement_index}:{item_index}")
}
