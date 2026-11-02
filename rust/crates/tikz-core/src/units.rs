//! Physical unit primitives shared by parsing, evaluation, and SVG emission.
//!
//! PGF/TikZ's authoritative scale is `1cm = 28.45276pt` (see pgfmanual,
//! "Coordinate Systems"; the legacy renderer bakes this into its emitter).
//! All rotations and stroke widths are stored in points; SVG output treats
//! `1pt == 1 user unit` exactly like the legacy emitter does.
#![forbid(unsafe_code)]

/// Numbers (1pt = 1 SVG user unit; TS numbers are IEEE doubles, so the port
/// uses f64 everywhere to keep the 4-decimal SVG rounding contract identical).
pub type Pt = f64;

/// Conversion constant: centimeters to points — the exact PGF `PT_PER_CM`
/// (`coords/source.ts:4` = 28.4527559055; `toFixed(4)` renders it as 28.4528, matching goldens).
pub const CM_TO_PT: f64 = 28.4527559055;

/// Default axis line width in points (TikZ default is 0.4pt).
pub const DEFAULT_LINE_WIDTH_PT: f64 = 0.4;

/// Millimeters to points — the legacy mm constant used by pattern tiles
/// (`svg/emit.ts:1485` = 2.84527559055).
pub const MM_TO_PT: f64 = 2.84527559055;

/// A free 2D point in the TikZ user coordinate space (canvas pt), created
/// after any transform rescale/shift/rotate is fully resolved.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Vec2 {
    /// X in pt, increasing right.
    pub x: Pt,
    /// Y in pt, increasing up (before SVG y-flip).
    pub y: Pt,
}

impl Vec2 {
    /// Constructor from two coordinates.
    #[inline]
    #[must_use]
    pub const fn new(x: Pt, y: Pt) -> Self {
        Self { x, y }
    }
}

impl core::ops::Add for Vec2 {
    type Output = Self;
    /// Componentwise vector sum.
    #[inline]
    fn add(self, rhs: Self) -> Self::Output {
        Self::new(self.x + rhs.x, self.y + rhs.y)
    }
}

impl core::ops::Sub for Vec2 {
    type Output = Self;
    /// Componentwise vector difference.
    #[inline]
    fn sub(self, rhs: Self) -> Self::Output {
        Self::new(self.x - rhs.x, self.y - rhs.y)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cm_to_pt_matches_legacy_svg_scale() {
        // 1cm line drawn from (0,0) to (1cm,0) should be 28.45276pt long in the
        // output — verified against golden minimal.svg (28.4528 after round).
        let width = 1.0 * CM_TO_PT;
        let rounded = (width * 1e4).round() / 1e4;
        assert_eq!(rounded, 28.4528);
    }

    #[test]
    fn vec2_ops() {
        let a = Vec2::new(3.0, 4.0);
        assert_eq!(a + Vec2::new(1.0, -1.0), Vec2::new(4.0, 3.0));
        assert_eq!(a - Vec2::new(1.0, 1.0), Vec2::new(2.0, 3.0));
    }
}
