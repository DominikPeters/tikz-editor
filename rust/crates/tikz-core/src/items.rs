//! Path-item facade: the [`PathItem`] discriminated enum and shared
//! accessors, plus re-exports of the payload types from
//! [`crate::item_types`] and [`crate::items_ops`].
//!
//! Import path items via this module (e.g. `tikz_core::items::*`); payload
//! structs remain importable from their concrete modules.
//!
//! ```no_run
//! use tikz_core::items::PathItem;
//! use tikz_core::item_types::{PathKeywordItem, UnknownPathItem};
//! use tikz_core::span::Span;
//!
//! let keyword = PathItem::PathKeyword(PathKeywordItem {
//!     id: "i:1".into(),
//!     span: Span::new(2, 7),
//!     keyword: "cycle".into(),
//! });
//! assert_eq!(keyword.span(), Span::new(2, 7));
//! assert_eq!(keyword.id(), "i:1");
//! ```

use crate::item_types::{
    CoordinateItem, CoordinateOperationItem, DecorateOperationItem, LetOperationItem,
    PathCommentItem, PathForeachItem, PathKeywordItem, PathOptionItem, SvgOperationItem,
    UnknownPathItem,
};
use crate::items_ops::{
    ChildOperationItem, EdgeFromParentOperationItem, EdgeOperationItem, GraphOperationItem,
    NodeItem, PicOperationItem, PlotOperationItem, ToOperationItem,
};
use crate::span::Span;

// Facade re-exports so `tikz_core::items::*` covers the whole path-item API.
pub use crate::item_types::{CoordinateForm, ForeachClause, ToCoordinateTarget, ToCycleTarget};
pub use crate::items_ops::{
    GraphSpec, GraphSpecChain, GraphSpecConnector, GraphSpecNode, GraphSpecSegment,
};

/// One item of a path statement.
// AST fidelity over memory layout: Node/Pic/Child items dwarf the leaf
// variants; boxing them would tax every parser/evaluator match for no real
// gain (ASTs here are small).
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq)]
pub enum PathItem {
    /// Coordinate point.
    Coordinate(CoordinateItem),
    /// Node shape.
    Node(NodeItem),
    /// `\\foreach` inside a path.
    PathForeach(PathForeachItem),
    /// Latent comment run inside a path.
    PathComment(PathCommentItem),
    /// Inline `[..]` option run that changes path-side state.
    PathOption(PathOptionItem),
    /// Bare keyword such as `cycle` / `and`.
    PathKeyword(PathKeywordItem),
    /// `graph …` operation.
    GraphOperation(GraphOperationItem),
    /// `plot …` operation.
    PlotOperation(PlotOperationItem),
    /// `pic …` operation.
    PicOperation(PicOperationItem),
    /// `to …` operation.
    ToOperation(ToOperationItem),
    /// `edge …` operation.
    EdgeOperation(EdgeOperationItem),
    /// `child { … }` operation.
    ChildOperation(ChildOperationItem),
    /// `edge from parent` / `edge to parent` operation.
    EdgeFromParentOperation(EdgeFromParentOperationItem),
    /// `svg …` operation.
    SvgOperation(SvgOperationItem),
    /// `let … in` operation.
    LetOperation(LetOperationItem),
    /// `decorate …` operation.
    DecorateOperation(DecorateOperationItem),
    /// `coordinate …` operation inside a path.
    CoordinateOperation(CoordinateOperationItem),
    /// Unrecognized path segment text.
    Unknown(UnknownPathItem),
}

impl PathItem {
    /// Span covering the item.
    pub fn span(&self) -> Span {
        match self {
            PathItem::Coordinate(e) => e.span,
            PathItem::Node(e) => e.span,
            PathItem::PathForeach(e) => e.span,
            PathItem::PathComment(e) => e.span,
            PathItem::PathOption(e) => e.span,
            PathItem::PathKeyword(e) => e.span,
            PathItem::GraphOperation(e) => e.span,
            PathItem::PlotOperation(e) => e.span,
            PathItem::PicOperation(e) => e.span,
            PathItem::ToOperation(e) => e.span,
            PathItem::EdgeOperation(e) => e.span,
            PathItem::ChildOperation(e) => e.span,
            PathItem::EdgeFromParentOperation(e) => e.span,
            PathItem::SvgOperation(e) => e.span,
            PathItem::LetOperation(e) => e.span,
            PathItem::DecorateOperation(e) => e.span,
            PathItem::CoordinateOperation(e) => e.span,
            PathItem::Unknown(e) => e.span,
        }
    }

    /// Item id.
    pub fn id(&self) -> &str {
        match self {
            PathItem::Coordinate(e) => &e.id,
            PathItem::Node(e) => &e.id,
            PathItem::PathForeach(e) => &e.id,
            PathItem::PathComment(e) => &e.id,
            PathItem::PathOption(e) => &e.id,
            PathItem::PathKeyword(e) => &e.id,
            PathItem::GraphOperation(e) => &e.id,
            PathItem::PlotOperation(e) => &e.id,
            PathItem::PicOperation(e) => &e.id,
            PathItem::ToOperation(e) => &e.id,
            PathItem::EdgeOperation(e) => &e.id,
            PathItem::ChildOperation(e) => &e.id,
            PathItem::EdgeFromParentOperation(e) => &e.id,
            PathItem::SvgOperation(e) => &e.id,
            PathItem::LetOperation(e) => &e.id,
            PathItem::DecorateOperation(e) => &e.id,
            PathItem::CoordinateOperation(e) => &e.id,
            PathItem::Unknown(e) => &e.id,
        }
    }
}

#[cfg(test)]
mod items_unit_tests {
    use super::*;

    #[test]
    fn enum_accessors() {
        let item = PathItem::PathKeyword(PathKeywordItem {
            id: "i:2".into(),
            span: Span::new(0, 5),
            keyword: "cycle".into(),
        });
        assert_eq!(item.span(), Span::new(0, 5));
        assert_eq!(item.id(), "i:2");
    }

    #[test]
    fn unknown_variant_casts() {
        let item = PathItem::Unknown(UnknownPathItem {
            id: "i:3".into(),
            span: Span::new(7, 9),
            raw: "??".into(),
        });
        assert!(matches!(item, PathItem::Unknown(_)));
    }
}
