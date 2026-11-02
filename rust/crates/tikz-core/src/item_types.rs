//! Path item AST payload types (leaf/simple items and `\\foreach` clauses).
//!
//! Port of the `packages/core/src/ast/types.ts` path-item half. Field names
//! mirror the legacy camelCase contract in snake_case; tagged unions become
//! Rust enums with the same variant shapes. Repetitive `id`/`span` field
//! meanings are stated once here: `id` is the item id string, `span` the
//! source span covering the item. The [`crate::items::PathItem`] enum is the
//! facade that joins these payloads.
//!
//! ```no_run
//! use tikz_core::item_types::{PathKeywordItem, PathCommentItem};
//! let keyword = PathKeywordItem {
//!     id: "i:2".into(),
//!     span: tikz_core::span::Span::new(0, 5),
//!     keyword: "cycle".into(),
//! };
//! assert_eq!(keyword.keyword, "cycle");
//! ```

use crate::options::OptionListAst;
use crate::span::Span;

/// Coordinate form marker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoordinateForm {
    /// `x,y` Cartesian.
    Cartesian,
    /// `xyz` vector form.
    Xyz,
    /// polar form.
    Polar,
    /// named coordinate reference.
    Named,
    /// `($ … $)` calc form.
    Calc,
    /// explicit parser node text.
    Explicit,
    /// unrecognized.
    Unknown,
}

/// `+`/`++` relative coordinate prefix.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelativeCoordinatePrefix {
    /// `+`.
    Plus,
    /// `++`.
    PlusPlus,
}

/// `to`-operation target variant (coordinate or cycle).
#[derive(Debug, Clone, PartialEq)]
pub enum ToOperationTarget {
    /// A `(…)`-or-name target coordinate.
    Coordinate(ToCoordinateTarget),
    /// The `cycle` target.
    Cycle(ToCycleTarget),
}

/// Coordinate target payload.
#[derive(Debug, Clone, PartialEq)]
pub struct ToCoordinateTarget {
    /// Target text as written.
    pub raw: String,
    /// `+`/`++` prefix when present.
    pub relative_prefix: Option<RelativeCoordinatePrefix>,
    /// Span of the target.
    pub span: Option<Span>,
}

/// Cycle target payload.
#[derive(Debug, Clone, PartialEq)]
pub struct ToCycleTarget {
    /// Span of the `cycle` token.
    pub span: Option<Span>,
}

/// A shared `\\foreach` clause payload (Node / Pic / Child use one shared
/// shape), replacing the legacy `NodeForeachClause` trio.
#[derive(Debug, Clone, PartialEq)]
pub struct ForeachClause {
    /// Item id.
    pub id: String,
    /// Span covering the raw clause.
    pub span: Span,
    /// Raw clause text.
    pub raw: String,
    /// Header text (before `:`).
    pub header_raw: String,
    /// Variables side text.
    pub variables_raw: Option<String>,
    /// List side text.
    pub list_raw: Option<String>,
    /// Span of the option run.
    pub options_span: Option<Span>,
    /// Options parsed from the option run.
    pub options: Option<OptionListAst>,
}

/// `(…)` coordinate point in a path.
#[derive(Debug, Clone, PartialEq)]
pub struct CoordinateItem {
    /// Item id.
    pub id: String,
    /// Span covering the coordinate.
    pub span: Span,
    /// Span of the `[..]` option run.
    pub options_span: Option<Span>,
    /// Options parsed from the option run.
    pub options: Option<OptionListAst>,
    /// `+`/`++` prefix, when present.
    pub relative_prefix: Option<RelativeCoordinatePrefix>,
    /// X component text.
    pub x: String,
    /// Y component text.
    pub y: String,
    /// Z component text (xyz vector form).
    pub z: Option<String>,
    /// Raw source text of the coordinate.
    pub raw: String,
    /// Coordinate form marker.
    pub form: CoordinateForm,
}

/// Bare comment run inside a path.
#[derive(Debug, Clone, PartialEq)]
pub struct PathCommentItem {
    /// Item id.
    pub id: String,
    /// Span covering the comment.
    pub span: Span,
    /// Raw comment text including `%`.
    pub raw: String,
}

/// Inline option run (`[..]`) that applies to subsequent items.
#[derive(Debug, Clone, PartialEq)]
pub struct PathOptionItem {
    /// Item id.
    pub id: String,
    /// Span covering the option run.
    pub span: Span,
    /// Raw option-run text.
    pub raw: String,
    /// Parsed options.
    pub options: OptionListAst,
}

/// Bare keyword item (`cycle`, `and`, …).
#[derive(Debug, Clone, PartialEq)]
pub struct PathKeywordItem {
    /// Item id.
    pub id: String,
    /// Span covering the keyword.
    pub span: Span,
    /// Keyword text as written.
    pub keyword: String,
}

/// Foreach clause attached to a path item.
#[derive(Debug, Clone, PartialEq)]
pub struct PathForeachItem {
    /// Item id.
    pub id: String,
    /// Span covering the whole clause.
    pub span: Span,
    /// Raw source text.
    pub raw: String,
    /// Command text (`foreach` or `\\foreach`).
    pub command_raw: String,
    /// Header text.
    pub header_raw: String,
    /// Variables-side text.
    pub variables_raw: Option<String>,
    /// List-side text.
    pub list_raw: Option<String>,
    /// Span of the `[..]` option run.
    pub options_span: Option<Span>,
    /// Options parsed from the option run.
    pub options: Option<OptionListAst>,
    /// Body text after `:`.
    pub body_raw: String,
}

/// `svg …` operation item.
#[derive(Debug, Clone, PartialEq)]
pub struct SvgOperationItem {
    /// Item id.
    pub id: String,
    /// Span covering the operation.
    pub span: Span,
    /// Span of the `[..]` option run.
    pub options_span: Option<Span>,
    /// Options parsed from the option run.
    pub options: Option<OptionListAst>,
    /// Span of the data payload.
    pub data_span: Option<Span>,
    /// Data payload text.
    pub data_raw: String,
}

/// `let` marker item.
#[derive(Debug, Clone, PartialEq)]
pub struct LetOperationItem {
    /// Item id.
    pub id: String,
    /// Span covering `let … in`.
    pub span: Span,
    /// Raw source text.
    pub raw: String,
}

/// `coordinate …` operation item.
#[derive(Debug, Clone, PartialEq)]
pub struct CoordinateOperationItem {
    /// Item id.
    pub id: String,
    /// Span covering the operation.
    pub span: Span,
    /// Span of the `[..]` option run.
    pub options_span: Option<Span>,
    /// Options parsed from the option run.
    pub options: Option<OptionListAst>,
    /// Coordinate name.
    pub name: Option<String>,
    /// Span of the name.
    pub name_span: Option<Span>,
    /// Span of the placement text.
    pub placement_span: Option<Span>,
    /// Raw source text.
    pub raw: String,
}

/// `decorate …` operation item.
#[derive(Debug, Clone, PartialEq)]
pub struct DecorateOperationItem {
    /// Item id.
    pub id: String,
    /// Span covering the operation.
    pub span: Span,
    /// Span of the `[..]` option run.
    pub options_span: Option<Span>,
    /// Options parsed from the option run.
    pub options: Option<OptionListAst>,
    /// Span of the `{ … }` subpath payload.
    pub subpath_span: Span,
    /// Subpath payload text.
    pub subpath_raw: String,
    /// Raw source text.
    pub raw: String,
}

/// Unrecognized path item.
#[derive(Debug, Clone, PartialEq)]
pub struct UnknownPathItem {
    /// Item id.
    pub id: String,
    /// Span covering the item.
    pub span: Span,
    /// Raw source text.
    pub raw: String,
}

#[cfg(test)]
mod item_types_unit_tests {
    use super::*;

    #[test]
    fn target_variants() {
        let target = ToOperationTarget::Cycle(ToCycleTarget { span: None });
        assert!(matches!(
            target,
            ToOperationTarget::Cycle(ToCycleTarget { span: None })
        ));
        let coord = ToOperationTarget::Coordinate(ToCoordinateTarget {
            raw: "(a)".into(),
            relative_prefix: None,
            span: Some(Span::new(1, 4)),
        });
        assert!(matches!(coord, ToOperationTarget::Coordinate(_)));
    }

    #[test]
    fn coordinate_item_shape() {
        let item = CoordinateItem {
            id: "i:1".into(),
            span: Span::new(0, 5),
            options_span: None,
            options: None,
            relative_prefix: Some(RelativeCoordinatePrefix::PlusPlus),
            x: "1".into(),
            y: "2".into(),
            z: None,
            raw: "(1,2)".into(),
            form: CoordinateForm::Cartesian,
        };
        assert_eq!(item.form, CoordinateForm::Cartesian);
    }
}
