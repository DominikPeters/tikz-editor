//! Evaluated scene: resolved geometry ready for SVG emission or hit-testing.
//!
//! The legacy pipeline evaluates the AST into a scene graph before the SVG
//! backend runs. This first slice only needs stroked polylines in TikZ
//! canvas space (pt, y up); the emitter owns the y-flip.

use crate::units::Vec2;

/// One path command in canvas space.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum PathSeg {
    /// `M x y`
    Move(Vec2),
    /// `L x y`
    Line(Vec2),
}

impl PathSeg {
    /// Endpoint of the segment.
    pub fn point(self) -> Vec2 {
        match self {
            PathSeg::Move(p) | PathSeg::Line(p) => p,
        }
    }
}

/// A stroked, unfilled path.
#[derive(Debug, Clone, PartialEq)]
pub struct ScenePath {
    /// Identity hook, e.g. `path:0` (`data-source-id` in the SVG).
    pub source_id: String,
    /// Segments in drawing order.
    pub segs: Vec<PathSeg>,
    /// Stroke width in pt.
    pub stroke_width: f64,
}

/// Everything one figure draws.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Scene {
    /// Paths in document order.
    pub paths: Vec<ScenePath>,
}

impl Scene {
    /// Axis-aligned bounds `(min, max)` of every path point, if any.
    ///
    /// ```
    /// use tikz_core::scene::{PathSeg, Scene, ScenePath};
    /// use tikz_core::units::Vec2;
    /// let scene = Scene { paths: vec![ScenePath {
    ///     source_id: "path:0".into(),
    ///     segs: vec![PathSeg::Move(Vec2::new(1.0, 2.0)), PathSeg::Line(Vec2::new(3.0, -1.0))],
    ///     stroke_width: 0.4,
    /// }] };
    /// assert_eq!(scene.bounds(), Some((Vec2::new(1.0, -1.0), Vec2::new(3.0, 2.0))));
    /// assert_eq!(Scene::default().bounds(), None);
    /// ```
    pub fn bounds(&self) -> Option<(Vec2, Vec2)> {
        let mut points = self.paths.iter().flat_map(|p| p.segs.iter().map(|s| s.point()));
        let first = points.next()?;
        Some(points.fold((first, first), |(lo, hi), p| {
            (
                Vec2::new(lo.x.min(p.x), lo.y.min(p.y)),
                Vec2::new(hi.x.max(p.x), hi.y.max(p.y)),
            )
        }))
    }
}
