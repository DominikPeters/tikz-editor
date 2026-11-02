//! Node adornment (`label` / `pin` option) metadata.
//!
//! Port of the `AdornmentOwnerGeometry` and `NodeItem["adornment"]` shapes in
//! `packages/core/src/ast/types.ts`.

use crate::span::Span;

/// Adornment kind (`label` or `pin`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdornmentKind {
    /// `label` option.
    Label,
    /// `pin` option.
    Pin,
}

/// Geometry of the shape owning an adornment.
#[derive(Debug, Clone, PartialEq)]
pub struct AdornmentOwnerGeometry {
    /// Shape name as written, e.g. `rectangle`, `circle`.
    pub shape: String,
    /// Anchor center.
    pub center: Point,
    /// Optional anchor transform matrix.
    pub anchor_transform: Option<AnchorTransform>,
    /// Anchor half-width.
    pub anchor_half_width: f64,
    /// Anchor half-height.
    pub anchor_half_height: f64,
    /// Anchor radius.
    pub anchor_radius: f64,
    /// Anchor polygon vertices, when the shape has one.
    pub anchor_polygon: Option<Vec<Point>>,
}

/// 2×3 anchor transform matrix (`a b c d e f`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AnchorTransform {
    /// Matrix entry `a`.
    pub a: f64,
    /// Matrix entry `b`.
    pub b: f64,
    /// Matrix entry `c`.
    pub c: f64,
    /// Matrix entry `d`.
    pub d: f64,
    /// Matrix entry `e`.
    pub e: f64,
    /// Matrix entry `f`.
    pub f: f64,
}

/// A 2D point.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Point {
    /// X coordinate.
    pub x: f64,
    /// Y coordinate.
    pub y: f64,
}

/// One `label`/`pin` adornment attached to a node.
#[derive(Debug, Clone, PartialEq)]
pub struct Adornment {
    /// Adornment kind.
    pub kind: AdornmentKind,
    /// Node id that owns the adornment.
    pub owner_node_id: String,
    /// Source id of the owning node's origin statement.
    pub owner_source_id: String,
    /// Index of the adornment within its owner node.
    pub adornment_index: i64,
    /// Span of the adornment option (`label={…}` part before `:`).
    pub option_span: Span,
    /// Span of the option payload value.
    pub value_span: Span,
    /// Span of the adornment text.
    pub text_span: Span,
    /// Angle as written (empty when omitted).
    pub angle_raw: String,
    /// Span of the angle token.
    pub angle_span: Option<Span>,
    /// Effective distance in pt.
    pub distance_pt: f64,
    /// Default distance applied when not explicit.
    pub default_distance_pt: f64,
    /// True when distance was provided by options.
    pub distance_explicit: bool,
    /// `pin` edge spec as written (`[]`-syntax may still carry one).
    pub pin_edge_raw: Option<String>,
    /// Owner shape geometry, computed by the semantic layer.
    pub owner_geometry: Option<AdornmentOwnerGeometry>,
}

#[cfg(test)]
mod adornment_unit_tests {
    use super::*;

    #[test]
    fn adornment_roundtrip() {
        let a = Adornment {
            kind: AdornmentKind::Pin,
            owner_node_id: "n:1".into(),
            owner_source_id: "st:0".into(),
            adornment_index: 0,
            option_span: Span::new(0, 9),
            value_span: Span::new(6, 8),
            text_span: Span::new(11, 14),
            angle_raw: "60".into(),
            angle_span: Some(Span::new(0, 2)),
            distance_pt: 30.0,
            default_distance_pt: 30.0,
            distance_explicit: false,
            pin_edge_raw: None,
            owner_geometry: None,
        };
        assert_eq!(a.kind, AdornmentKind::Pin);
        assert_eq!(a.angle_raw, "60");
    }
}
