//! Path-item operation payloads (node/pic/child/to/edge/graph/plot).
//!
//! Port of the operation-side `packages/core/src/ast/types.ts` path-item
//! shapes, including the `graph` spec structures. Field names mirror the
//! legacy camelCase contract in snake_case. [`crate::items::PathItem`] is the
//! facade joining these payloads with the leaf types.

use crate::item_types::{RelativeCoordinatePrefix, ToOperationTarget};
use crate::options::OptionListAst;
use crate::span::Span;

/// `textSource`/`typeSource` marker shared by Node and Pic items.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GroupOptionSource {
    /// Value came from a `{...}` group.
    Group,
    /// Value came from `text=…`/`pic=…` option.
    Option,
}

/// Plot source marker (`\\plot data form`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlotOperationMode {
    /// `{(x,y) …}` coordinate list.
    Coordinates,
    /// `{f(x) …}` expression.
    Expression,
    /// `{samples function}` function.
    Function,
    /// `{file name}` file.
    File,
    /// unrecognized payload.
    Unknown,
}

/// Graph-spec node name.
#[derive(Debug, Clone, PartialEq)]
pub struct GraphSpecNode {
    /// Span of the node text.
    pub span: Span,
    /// Node text as written.
    pub raw: String,
}

/// Graph-spec connector between two chain nodes.
#[derive(Debug, Clone, PartialEq)]
pub struct GraphSpecConnector {
    /// Operator text (`--`, `->`, `<-`, `<->`, `-!-`).
    pub operator: String,
    /// Span covering `op[..]`.
    pub span: Span,
    /// Span of the `[..]` option run.
    pub options_span: Option<Span>,
    /// Option-run text.
    pub options_raw: Option<String>,
}

/// One chain `A -- op -- B`.
#[derive(Debug, Clone, PartialEq)]
pub struct GraphSpecChain {
    /// Span covering the chain.
    pub span: Span,
    /// Raw chain text.
    pub raw: String,
    /// Chain nodes in order.
    pub nodes: Vec<GraphSpecNode>,
    /// Connectors between consecutive nodes.
    pub connectors: Vec<GraphSpecConnector>,
}

/// Top-level chain of a graph spec.
#[derive(Debug, Clone, PartialEq)]
pub struct GraphSpecSegment {
    /// Span covering the segment.
    pub span: Span,
    /// Raw segment text.
    pub raw: String,
    /// The parsed chain.
    pub chain: GraphSpecChain,
}

/// Full `graph` spec.
#[derive(Debug, Clone, PartialEq)]
pub struct GraphSpec {
    /// Span covering the spec.
    pub span: Span,
    /// Raw spec text.
    pub raw: String,
    /// Segments separated by `;` or `,`.
    pub segments: Vec<GraphSpecSegment>,
}

/// `graph …` operation item.
#[derive(Debug, Clone, PartialEq)]
pub struct GraphOperationItem {
    /// Item id.
    pub id: String,
    /// Span covering the operation.
    pub span: Span,
    /// Span of the `[..]` option run.
    pub options_span: Option<Span>,
    /// Options parsed from the option run.
    pub options: Option<OptionListAst>,
    /// Span of the spec payload.
    pub spec_span: Span,
    /// Raw spec text.
    pub spec_raw: String,
    /// Parsed spec, when recognized.
    pub spec: Option<GraphSpec>,
    /// Raw source text of the whole operation.
    pub raw: String,
}

/// `plot …` operation item.
#[derive(Debug, Clone, PartialEq)]
pub struct PlotOperationItem {
    /// Item id.
    pub id: String,
    /// Span covering the operation.
    pub span: Span,
    /// Raw source text.
    pub raw: String,
    /// Span of the `[..]` option run.
    pub options_span: Option<Span>,
    /// Options parsed from the option run.
    pub options: Option<OptionListAst>,
    /// Source marker.
    pub mode: PlotOperationMode,
    /// Span of the data payload.
    pub data_span: Option<Span>,
    /// Data payload text.
    pub data_raw: Option<String>,
}

/// `{…}`-or-option node mid-path.
#[derive(Debug, Clone, PartialEq)]
pub struct NodeItem {
    /// Item id.
    pub id: String,
    /// Span covering the full node.
    pub span: Span,
    /// Raw source text.
    pub raw: String,
    /// Template containing a `\\foreach` clause, when one wraps this node.
    pub template_raw: String,
    /// Node name from `name=…`/alias `()`.
    pub name: Option<String>,
    /// Extra node alias names.
    pub aliases: Vec<String>,
    /// Span of the `[..]` option run.
    pub options_span: Option<Span>,
    /// Options parsed from the option run.
    pub options: Option<OptionListAst>,
    /// `\\foreach` clauses wrapping the node.
    pub foreach_clauses: Vec<crate::item_types::ForeachClause>,
    /// Span of the `at (…)` position.
    pub at_span: Option<Span>,
    /// Position text.
    pub at_raw: Option<String>,
    /// `+`/`++` prefix of the position, when present.
    pub at_relative_prefix: Option<RelativeCoordinatePrefix>,
    /// Where the label text came from.
    pub text_source: GroupOptionSource,
    /// Span of the label text.
    pub text_span: Span,
    /// Label text.
    pub text: String,
    /// Same-length masked text for structural parses during text edits.
    pub structural_text: Option<String>,
    /// `label`/`pin` adornments attached to this node.
    pub adornment: Option<crate::adornment::Adornment>,
}

/// `pic …` operation item.
#[derive(Debug, Clone, PartialEq)]
pub struct PicOperationItem {
    /// Item id.
    pub id: String,
    /// Span covering the operation.
    pub span: Span,
    /// Raw source text.
    pub raw: String,
    /// Template text for a foreach-wrapped pic.
    pub template_raw: String,
    /// Span of the `[..]` option run.
    pub options_span: Option<Span>,
    /// Options parsed from the option run.
    pub options: Option<OptionListAst>,
    /// `\\foreach` clauses wrapping the pic.
    pub foreach_clauses: Vec<crate::item_types::ForeachClause>,
    /// Pic name.
    pub name: Option<String>,
    /// Span of the pic name.
    pub name_span: Option<Span>,
    /// Span of the `at (…)` position.
    pub at_span: Option<Span>,
    /// Position text.
    pub at_raw: Option<String>,
    /// `+`/`++` prefix of the position.
    pub at_relative_prefix: Option<RelativeCoordinatePrefix>,
    /// Where the pic type came from.
    pub type_source: GroupOptionSource,
    /// Span of the pic type.
    pub type_span: Option<Span>,
    /// Pic type text.
    pub type_raw: String,
}

/// `to …` operation item.
#[derive(Debug, Clone, PartialEq)]
pub struct ToOperationItem {
    /// Item id.
    pub id: String,
    /// Span covering the operation.
    pub span: Span,
    /// Span of the `[..]` option run.
    pub options_span: Option<Span>,
    /// Options parsed from the option run.
    pub options: Option<OptionListAst>,
    /// Nodes attached mid-operation, when any.
    pub nodes: Vec<NodeItem>,
    /// Pics attached mid-operation, when any.
    pub pics: Vec<PicOperationItem>,
    /// Operation target (coordinate or cycle).
    pub target: Option<ToOperationTarget>,
    /// Raw source text.
    pub raw: String,
}

/// `edge …` operation item.
#[derive(Debug, Clone, PartialEq)]
pub struct EdgeOperationItem {
    /// Item id.
    pub id: String,
    /// Span covering the operation.
    pub span: Span,
    /// Span of the `[..]` option run.
    pub options_span: Option<Span>,
    /// Options parsed from the option run.
    pub options: Option<OptionListAst>,
    /// Nodes attached mid-operation.
    pub nodes: Vec<NodeItem>,
    /// Pics attached mid-operation.
    pub pics: Vec<PicOperationItem>,
    /// Operation target (coordinate or cycle).
    pub target: Option<ToOperationTarget>,
    /// Raw source text.
    pub raw: String,
}

/// `child { … }` operation item.
#[derive(Debug, Clone, PartialEq)]
pub struct ChildOperationItem {
    /// Item id.
    pub id: String,
    /// Span covering the operation.
    pub span: Span,
    /// Raw source text.
    pub raw: String,
    /// Template text for a foreach-wrapped child.
    pub template_raw: String,
    /// Span of the `[..]` option run.
    pub options_span: Option<Span>,
    /// Options parsed from the option run.
    pub options: Option<OptionListAst>,
    /// `\\foreach` clauses wrapping the child.
    pub foreach_clauses: Vec<crate::item_types::ForeachClause>,
    /// Span of the `{ … }` body.
    pub body_span: Option<Span>,
    /// Body text.
    pub body_raw: String,
    /// Parsed body path items.
    pub body: Vec<crate::items::PathItem>,
}

/// `edge from parent` / `edge to parent` operation item.
#[derive(Debug, Clone, PartialEq)]
pub struct EdgeFromParentOperationItem {
    /// Item id.
    pub id: String,
    /// Span covering the operation.
    pub span: Span,
    /// Span of the `[..]` option run.
    pub options_span: Option<Span>,
    /// Options parsed from the option run.
    pub options: Option<OptionListAst>,
    /// Nodes attached mid-operation.
    pub nodes: Vec<NodeItem>,
    /// Alias text (`edge from parent` or `edge to parent`).
    pub alias: String,
    /// Raw source text.
    pub raw: String,
}

#[cfg(test)]
mod items_ops_unit_tests {
    use super::*;
    use crate::item_types::{ToCycleTarget, ToOperationTarget};

    #[test]
    fn graph_spec_chain_shape() {
        let spec = GraphSpec {
            span: Span::new(0, 11),
            raw: "a -- b -- c".into(),
            segments: vec![GraphSpecSegment {
                span: Span::new(0, 11),
                raw: "a -- b -- c".into(),
                chain: GraphSpecChain {
                    span: Span::new(0, 11),
                    raw: "a -- b -- c".into(),
                    nodes: vec![],
                    connectors: vec![],
                },
            }],
        };
        assert_eq!(spec.segments.len(), 1);
        assert_eq!(spec.segments[0].chain.raw, "a -- b -- c");
    }

    #[test]
    fn to_item_with_target() {
        let item = ToOperationItem {
            id: "i:7".into(),
            span: Span::new(0, 4),
            options_span: None,
            options: None,
            nodes: vec![],
            pics: vec![],
            target: Some(ToOperationTarget::Cycle(ToCycleTarget { span: None })),
            raw: "to".into(),
        };
        assert!(matches!(item.target, Some(ToOperationTarget::Cycle(_))));
    }
}
