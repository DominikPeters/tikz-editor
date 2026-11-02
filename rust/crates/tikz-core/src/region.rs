//! Inner-region helpers for brace/bracket-wrapped spans.
//!
//! Port of the private helpers `toGroupInnerSpan`, `toBracketInnerSpan`,
//! `extractGroupInnerRaw`, and `extractBracketInnerRaw` in
//! `packages/core/src/domains/statements/parse.ts`. The open and close
//! delimiters are stripped *independently* by looking at the raw source
//! bytes, including the legacy clamping `to = Math.max(from, to)`.
//!
//! ```
//! use tikz_core::region::to_group_inner_span;
//! use tikz_core::span::Span;
//! let source = "\\def \\foo {hello }";
//! assert_eq!(to_group_inner_span(Span::new(10, 18), source), Span::new(11, 17));
//! ```

use crate::span::Span;

/// Span of `span` without its wrapping braces, when present.
///
/// The checks are independent: `{…` (missing close) still strips the open
/// brace and vice versa. Out-of-range bounds are treated as "no mismatch".
///
/// ```
/// use tikz_core::region::to_group_inner_span;
/// use tikz_core::span::Span;
/// // Group `{2}` in `\newcommand {\bar} {2}` sits at bytes 19..22.
/// let source = "\\newcommand {\\bar} {2}";
/// assert_eq!(to_group_inner_span(Span::new(19, 22), source), Span::new(20, 21));
/// ```
pub fn to_group_inner_span(span: Span, source: &str) -> Span {
    strip_delimiters(span, source, b'{', b'}')
}

/// Span of `span` without its wrapping brackets, when present.
///
/// ```
/// use tikz_core::region::to_bracket_inner_span;
/// use tikz_core::span::Span;
/// // `[count=\i]` inside `\x [count=\i] in {1}`.
/// let source = "\\x [count=\\i] in {1}";
/// assert_eq!(to_bracket_inner_span(Span::new(3, 13), source), Span::new(4, 12));
/// ```
pub fn to_bracket_inner_span(span: Span, source: &str) -> Span {
    strip_delimiters(span, source, b'[', b']')
}

/// Raw text inside `span`'s wrapping braces.
pub fn extract_group_inner_raw(span: Span, source: &str) -> String {
    let inner = to_group_inner_span(span, source);
    inner.slice(source).to_string()
}

/// Raw text inside `span`'s wrapping brackets.
pub fn extract_bracket_inner_raw(span: Span, source: &str) -> String {
    let inner = to_bracket_inner_span(span, source);
    inner.slice(source).to_string()
}

/// Strip one open byte from the front and one close byte from the end.
///
/// Mirrors the legacy JavaScript helpers byte for byte: each side is checked
/// against the source characters independently, and the final `to` is clamped
/// with `Math.max(from, to)` so degenerate spans stay non-negative.
fn strip_delimiters(span: Span, source: &str, open: u8, close: u8) -> Span {
    let bytes = source.as_bytes();
    let from = if bytes.get(span.from) == Some(&open) {
        span.from + 1
    } else {
        span.from
    };
    let to = if span.to > 0 && bytes[span.to - 1] == close {
        span.to - 1
    } else {
        span.to
    };
    Span::new(from, to.max(from))
}

#[cfg(test)]
mod region_unit_tests {
    use super::*;

    #[test]
    fn strips_matching_braces() {
        let source = "\\def \\foo {hello }";
        assert_eq!(to_group_inner_span(Span::new(10, 18), source), Span::new(11, 17));
        assert_eq!(extract_group_inner_raw(Span::new(10, 18), source), "hello ");
    }

    #[test]
    fn open_without_close_still_strips_open() {
        // `source {y` has an open brace at 5 and no closing one at 8.
        let source = "x {y";
        assert_eq!(to_group_inner_span(Span::new(2, 4), source), Span::new(3, 4));
    }

    #[test]
    fn close_without_open_still_strips_close() {
        // `a}` ends in a close brace but never opens: only the close side
        // is stripped, independently of the open check.
        let source = "a} b";
        assert_eq!(to_group_inner_span(Span::new(0, 2), source), Span::new(0, 1));
        assert_eq!(extract_group_inner_raw(Span::new(0, 2), source), "a");
    }

    #[test]
    fn clamps_degenerate_spans_to_non_negative() {
        // `to - 1` past `from + 1` would go negative without the clamp.
        let source = "{}";
        assert_eq!(to_group_inner_span(Span::new(0, 1), source), Span::new(1, 1));
    }

    #[test]
    fn non_delimiter_bounds_are_kept() {
        let source = "plain";
        assert_eq!(to_group_inner_span(Span::new(2, 4), source), Span::new(2, 4));
    }

    #[test]
    fn brackets_strip_independently() {
        let source = "\\x [count=\\i] in {1}";
        assert_eq!(to_bracket_inner_span(Span::new(3, 13), source), Span::new(4, 12));
        assert_eq!(extract_bracket_inner_raw(Span::new(3, 13), source), "count=\\i");
    }
}
