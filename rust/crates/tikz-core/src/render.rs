//! Source -> scene -> SVG facade for the supported TikZ slice.
//!
//! This is the Rust counterpart of `render/index.ts`, collapsed to one pure
//! synchronous entry point. It currently understands exactly one statement
//! shape: `\draw` with no options, drawing a `--` chain of Cartesian
//! coordinates. **Everything else is reported as a [`Diagnostic`]; nothing is
//! silently dropped**, so unsupported input can never produce a quietly wrong
//! SVG.
//!
//! ```
//! use tikz_core::render::render_tex;
//! let svg = render_tex("\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}").unwrap();
//! assert!(svg.starts_with("<svg "));
//! assert!(svg.contains(r#"d="M 0 28.4528 L 28.4528 0""#));
//! ```

use crate::coordinate::{parse_coordinate, CoordinateForm};
use crate::figure_scan::scan_tikz_figures;
use crate::ids::path_statement_id;
use crate::scene::{PathSeg, Scene, ScenePath};
use crate::span::Span;
use crate::svg_emit::emit_svg;
use crate::units::{Vec2, CM_TO_PT, DEFAULT_LINE_WIDTH_PT, MM_TO_PT};

/// Something the renderer could not honor, with its source location.
#[derive(Debug, Clone, PartialEq)]
pub struct Diagnostic {
    /// Offending region of the source.
    pub span: Span,
    /// Human-readable reason.
    pub message: String,
}

fn diag(from: usize, to: usize, message: impl Into<String>) -> Diagnostic {
    Diagnostic { span: Span::new(from, to), message: message.into() }
}

/// Render the first (and only supported) figure of `source` to SVG.
pub fn render_tex(source: &str) -> Result<String, Vec<Diagnostic>> {
    compile(source).map(|scene| emit_svg(&scene))
}

/// Evaluate `source` into a [`Scene`].
pub fn compile(source: &str) -> Result<Scene, Vec<Diagnostic>> {
    let figures = scan_tikz_figures(source);
    let figure = match figures.as_slice() {
        [one] => one,
        [] => return Err(vec![diag(0, source.len(), "no tikzpicture found")]),
        [_, second, ..] => {
            return Err(vec![diag(
                second.span.from,
                second.span.to,
                "multi-figure documents are not supported yet",
            )])
        }
    };
    let (mut cursor, end) = (figure.begin_span.to, figure.end_span.from);
    cursor = skip_trivia(source, cursor, end);
    if source[cursor..end].starts_with('[') {
        let close = matching(source, cursor, end, b'[', b']').ok_or_else(|| {
            vec![diag(cursor, end, "unterminated figure options")]
        })?;
        if !source[cursor + 1..close].trim().is_empty() {
            return Err(vec![diag(cursor, close + 1, "figure options are not supported yet")]);
        }
        cursor = close + 1;
    }
    let mut scene = Scene::default();
    let mut errors = Vec::new();
    for (index, (from, to, terminated)) in split_statements(source, cursor, end).into_iter().enumerate() {
        if !terminated {
            errors.push(diag(from, to, "statement is missing its terminating `;`"));
            continue;
        }
        match compile_statement(source, from, to, index) {
            Ok(Some(path)) => scene.paths.push(path),
            Ok(None) => {}
            Err(d) => errors.push(d),
        }
    }
    if errors.is_empty() {
        Ok(scene)
    } else {
        Err(errors)
    }
}

/// Compile one `;`-terminated statement (`to` excludes the `;`).
fn compile_statement(
    src: &str,
    from: usize,
    to: usize,
    index: usize,
) -> Result<Option<ScenePath>, Diagnostic> {
    let mut at = skip_trivia(src, from, to);
    if at >= to {
        return Ok(None); // only whitespace/comments before the `;`
    }
    let rest = &src[at..to];
    let Some(after) = rest.strip_prefix("\\draw") else {
        return Err(diag(at, to, "only \\draw statements are supported yet"));
    };
    if after.starts_with(|c: char| c.is_ascii_alphabetic()) {
        return Err(diag(at, to, "unsupported control sequence"));
    }
    at += "\\draw".len();
    at = skip_trivia(src, at, to);
    if src[at..to].starts_with('[') {
        let close = matching(src, at, to, b'[', b']')
            .ok_or_else(|| diag(at, to, "unterminated option list"))?;
        if !src[at + 1..close].trim().is_empty() {
            return Err(diag(at, close + 1, "path options are not supported yet"));
        }
        at = skip_trivia(src, close + 1, to);
    }
    let mut segs: Vec<PathSeg> = Vec::new();
    let mut expect_coordinate = true;
    while at < to {
        if src[at..to].starts_with('(') {
            if !expect_coordinate {
                return Err(diag(at, to, "expected `--` between coordinates"));
            }
            let close = matching(src, at, to, b'(', b')')
                .ok_or_else(|| diag(at, to, "unterminated coordinate"))?;
            let point = eval_coordinate(&src[at..=close]).map_err(|m| diag(at, close + 1, m))?;
            segs.push(if segs.is_empty() { PathSeg::Move(point) } else { PathSeg::Line(point) });
            at = close + 1;
            expect_coordinate = false;
        } else if src[at..to].starts_with("--") && !expect_coordinate {
            at += 2;
            expect_coordinate = true;
        } else {
            return Err(diag(at, to, "unsupported path operation"));
        }
        at = skip_trivia(src, at, to);
    }
    if expect_coordinate || segs.len() < 2 {
        return Err(diag(from, to, "a path needs at least two coordinates joined by `--`"));
    }
    Ok(Some(ScenePath {
        source_id: path_statement_id(index),
        segs,
        stroke_width: DEFAULT_LINE_WIDTH_PT,
    }))
}

/// `(x,y)` with plain numbers (default unit cm) -> canvas pt.
fn eval_coordinate(raw: &str) -> Result<Vec2, String> {
    let parsed = parse_coordinate(raw);
    if !parsed.is_well_formed || parsed.form != CoordinateForm::Cartesian {
        return Err("only (x,y) coordinates are supported yet".to_string());
    }
    if parsed.options_raw.is_some() {
        return Err("coordinate options are not supported yet".to_string());
    }
    Ok(Vec2::new(dimension_pt(&parsed.x)?, dimension_pt(&parsed.y)?))
}

/// Parse `1.5`, `2cm`, `3pt`, `4mm`, `1in`, `1bp` into pt.
///
/// ```
/// use tikz_core::render::dimension_pt;
/// assert_eq!(dimension_pt("2pt"), Ok(2.0));
/// assert!(dimension_pt("1em").is_err());
/// ```
pub fn dimension_pt(raw: &str) -> Result<f64, String> {
    let text = raw.trim();
    let split = text.find(|c: char| c.is_ascii_alphabetic()).unwrap_or(text.len());
    let (number, unit) = text.split_at(split);
    let value: f64 = number.trim().parse().map_err(|_| format!("not a number: `{text}`"))?;
    let factor = match unit.trim() {
        "" | "cm" => CM_TO_PT,
        "pt" => 1.0,
        "mm" => MM_TO_PT,
        "in" => 72.27,
        "bp" => 72.27 / 72.0,
        other => return Err(format!("unsupported unit `{other}`")),
    };
    Ok(value * factor)
}

/// Skip whitespace and `%` comments (to end of line) within `[at, end)`.
fn skip_trivia(src: &str, mut at: usize, end: usize) -> usize {
    let bytes = src.as_bytes();
    while at < end {
        match bytes[at] {
            b if b.is_ascii_whitespace() => at += 1,
            b'%' => {
                while at < end && bytes[at] != b'\n' {
                    at += 1;
                }
            }
            _ => break,
        }
    }
    at
}

/// Index of the delimiter closing the one at `open` (comments are inert).
fn matching(src: &str, open: usize, end: usize, lo: u8, hi: u8) -> Option<usize> {
    let bytes = src.as_bytes();
    let mut depth = 0usize;
    let mut at = open;
    while at < end {
        match bytes[at] {
            b'%' => {
                while at < end && bytes[at] != b'\n' {
                    at += 1;
                }
                continue;
            }
            b if b == lo => depth += 1,
            b if b == hi => {
                depth -= 1;
                if depth == 0 {
                    return Some(at);
                }
            }
            _ => {}
        }
        at += 1;
    }
    None
}

/// Split `[from, end)` at top-level `;` into `(from, to, terminated)`. The
/// final unterminated chunk is returned too (`terminated == false`), so a
/// missing `;` or trailing junk is diagnosed rather than ignored.
fn split_statements(src: &str, from: usize, end: usize) -> Vec<(usize, usize, bool)> {
    let bytes = src.as_bytes();
    let (mut out, mut start, mut depth, mut at) = (Vec::new(), from, 0i32, from);
    while at < end {
        match bytes[at] {
            b'%' => {
                while at < end && bytes[at] != b'\n' {
                    at += 1;
                }
                continue;
            }
            b'{' | b'[' | b'(' => depth += 1,
            b'}' | b']' | b')' => depth -= 1,
            b';' if depth <= 0 => {
                out.push((start, at, true));
                start = at + 1;
            }
            _ => {}
        }
        at += 1;
    }
    if skip_trivia(src, start, end) < end {
        out.push((start, end, false));
    }
    out
}

#[cfg(test)]
mod tests;
