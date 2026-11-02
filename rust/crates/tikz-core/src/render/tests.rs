//! Tests for the render facade: golden parity, diagnostics, fuzz safety.

use super::*;
use proptest::prelude::*;

/// Committed legacy golden (`migration/goldens/<name>.{tex,svg}`).
fn golden(name: &str, ext: &str) -> String {
    let path = format!("{}/../../../migration/goldens/{name}.{ext}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
}

fn fig(body: &str) -> String {
    format!("\\begin{{tikzpicture}}{body}\\end{{tikzpicture}}")
}

#[test]
fn minimal_golden_is_byte_identical() {
    let svg = render_tex(&golden("minimal", "tex")).expect("minimal renders");
    assert_eq!(svg, golden("minimal", "svg").trim_end_matches('\n'));
}

#[test]
fn comments_between_statements_are_inert() {
    let src = fig("\n % \\draw (9,9) -- (8,8);\n \\draw (0,0) -- (1,1); % tail ; here\n");
    let scene = compile(&src).unwrap();
    assert_eq!(scene.paths.len(), 1);
    assert_eq!(scene.paths[0].source_id, "path:0");
}

#[test]
fn empty_figure_uses_fallback_viewbox() {
    let svg = render_tex(&fig("")).unwrap();
    assert!(svg.contains(r#"viewBox="-12 -12 124 124""#));
}

#[test]
fn units_and_polylines_evaluate() {
    let scene = compile(&fig("\\draw (0,0) -- (10pt,2mm) -- (1in,0);")).unwrap();
    let pts: Vec<_> = scene.paths[0].segs.iter().map(|s| s.point()).collect();
    assert_eq!(pts.len(), 3);
    assert_eq!(pts[1], Vec2::new(10.0, 2.0 * MM_TO_PT));
    assert_eq!(pts[2].x, 72.27);
}

#[test]
fn unsupported_input_is_diagnosed_never_dropped() {
    for (body, needle) in [
        ("\\draw[thick] (0,0) -- (1,1);", "path options"),
        ("\\node at (0,0) {A};", "only \\draw"),
        ("\\draw (0,0) -- (1,1) node {A};", "unsupported path operation"),
        ("\\draw (0,0) -- (1,1) -- cycle;", "unsupported path operation"),
        ("\\draw (30:2) -- (1,1);", "only (x,y)"),
        ("\\draw (0,0);", "at least two"),
        ("\\draw (0,0) -- (1em,1);", "unsupported unit"),
        ("\\draw (0,0) -- (1,1)", "missing its terminating"),
    ] {
        let err = compile(&fig(body)).expect_err(body);
        assert!(err.iter().any(|d| d.message.contains(needle)), "{body}: {err:?}");
    }
}

#[test]
fn figure_options_and_multiple_figures_are_diagnosed() {
    assert!(compile(&fig("[scale=2]\\draw (0,0) -- (1,1);")).is_err());
    assert!(compile(&fig("[]\\draw (0,0) -- (1,1);")).is_ok());
    let two = format!("{}\n{}", fig("\\draw (0,0) -- (1,1);"), fig("\\draw (0,0) -- (2,2);"));
    assert!(compile(&two).unwrap_err()[0].message.contains("multi-figure"));
    assert!(compile("no figure here").is_err());
}

#[test]
fn path_ids_count_every_statement_slot() {
    let scene = compile(&fig("\\draw (0,0) -- (1,0);\\draw (0,1) -- (1,1);")).unwrap();
    let ids: Vec<_> = scene.paths.iter().map(|p| p.source_id.as_str()).collect();
    assert_eq!(ids, ["path:0", "path:1"]);
}

#[test]
fn dimension_rejects_garbage() {
    assert!(dimension_pt("").is_err());
    assert!(dimension_pt("abc").is_err());
    assert_eq!(dimension_pt(" .5 "), Ok(0.5 * CM_TO_PT));
    assert!((dimension_pt("1bp").unwrap() - 72.27 / 72.0).abs() < 1e-12);
}

proptest! {
    /// Arbitrary printable soup (plus multibyte) never panics.
    #[test]
    fn token_soup_never_panics(body in "[ -~\n\u{e9}\u{4e2d}]{0,80}") {
        let _ = render_tex(&fig(&body));
    }

    /// Any well-formed integer polyline renders to exactly one path.
    #[test]
    fn integer_polylines_render(pts in prop::collection::vec((-50i32..50, -50i32..50), 2..8)) {
        let chain: Vec<String> = pts.iter().map(|(x, y)| format!("({x},{y})")).collect();
        let svg = render_tex(&fig(&format!("\\draw {};", chain.join(" -- ")))).unwrap();
        prop_assert_eq!(svg.matches("<path ").count(), 1);
        prop_assert!(svg.ends_with("</svg>"));
    }
}
