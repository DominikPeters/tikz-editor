//! SVG backend: [`Scene`] -> SVG 1.1 string.
//!
//! Port of the path/viewBox portion of `packages/core/src/svg/emit.ts` and
//! `svg/viewbox.ts`. Conventions (all verified against the committed
//! goldens):
//!
//! * viewBox padding is 12pt plus half the widest stroke on every side; an
//!   empty scene falls back to `-12 -12 124 124`;
//! * the y-flip is `svg_y = 2*vb.y + vb.height - y`;
//! * stroke attributes appear in a fixed order, one function emits them.

use crate::scene::{PathSeg, Scene, ScenePath};
use crate::svg_numbers::fmt_num;

/// Padding added around the drawing on each side, in pt.
const VIEWBOX_PAD: f64 = 12.0;

/// ViewBox in canvas units.
#[derive(Debug, Clone, Copy, PartialEq)]
struct ViewBox {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl ViewBox {
    fn of(scene: &Scene) -> ViewBox {
        let Some((lo, hi)) = scene.bounds() else {
            return ViewBox { x: -12.0, y: -12.0, width: 124.0, height: 124.0 };
        };
        let half = scene.paths.iter().map(|p| p.stroke_width / 2.0).fold(0.0, f64::max);
        let pad = VIEWBOX_PAD + half;
        ViewBox {
            x: lo.x - pad,
            y: lo.y - pad,
            width: (hi.x - lo.x) + 2.0 * pad,
            height: (hi.y - lo.y) + 2.0 * pad,
        }
    }

    /// Constant of the y-flip: `svg_y = flip_k - y`.
    fn flip_k(&self) -> f64 {
        2.0 * self.y + self.height
    }
}

/// Emit the SVG document for `scene`.
///
/// ```
/// use tikz_core::scene::Scene;
/// use tikz_core::svg_emit::emit_svg;
/// assert!(emit_svg(&Scene::default()).contains(r#"viewBox="-12 -12 124 124""#));
/// ```
pub fn emit_svg(scene: &Scene) -> String {
    let vb = ViewBox::of(scene);
    let mut out = format!(
        r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="{} {} {} {}" role="img" aria-label="TikZ SVG preview">"#,
        fmt_num(vb.x),
        fmt_num(vb.y),
        fmt_num(vb.width),
        fmt_num(vb.height)
    );
    for path in &scene.paths {
        out.push_str(&emit_path(path, vb.flip_k()));
    }
    out.push_str("</svg>");
    out
}

fn emit_path(path: &ScenePath, flip_k: f64) -> String {
    let mut d = String::new();
    for seg in &path.segs {
        if !d.is_empty() {
            d.push(' ');
        }
        let (cmd, p) = match seg {
            PathSeg::Move(p) => ('M', p),
            PathSeg::Line(p) => ('L', p),
        };
        d.push_str(&format!("{cmd} {} {}", fmt_num(p.x), fmt_num(flip_k - p.y)));
    }
    format!(
        r#"<path data-source-id="{}" d="{d}" {} />"#,
        escape_attr(&path.source_id),
        stroke_attrs(path.stroke_width)
    )
}

/// Stroke attributes in the one legacy order (see blueprint row 24).
fn stroke_attrs(width: f64) -> String {
    format!(
        r#"stroke="black" fill="none" stroke-width="{}" stroke-linecap="butt" stroke-linejoin="miter" stroke-opacity="1" fill-opacity="1""#,
        fmt_num(width)
    )
}

/// Attribute escaping: `& < >` plus the double quote (blueprint row 23).
fn escape_attr(raw: &str) -> String {
    raw.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::units::Vec2;

    fn line(a: (f64, f64), b: (f64, f64)) -> Scene {
        Scene {
            paths: vec![ScenePath {
                source_id: "path:0".into(),
                segs: vec![PathSeg::Move(Vec2::new(a.0, a.1)), PathSeg::Line(Vec2::new(b.0, b.1))],
                stroke_width: 0.4,
            }],
        }
    }

    #[test]
    fn viewbox_adds_pad_and_half_stroke() {
        let vb = ViewBox::of(&line((0.0, 0.0), (10.0, 20.0)));
        assert_eq!((vb.x, vb.y), (-12.2, -12.2));
        assert!((vb.width - 34.4).abs() < 1e-12 && (vb.height - 44.4).abs() < 1e-12);
    }

    #[test]
    fn y_flip_maps_bottom_to_top_edge() {
        let svg = emit_svg(&line((0.0, 0.0), (10.0, 20.0)));
        assert!(svg.contains(r#"d="M 0 20 L 10 0""#), "{svg}");
    }

    #[test]
    fn attribute_escaping_covers_quote() {
        assert_eq!(escape_attr(r#"a"b<&>"#), "a&quot;b&lt;&amp;&gt;");
    }
}
