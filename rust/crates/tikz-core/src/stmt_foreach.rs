//! `\foreach` statement mapping.
//!
//! Port of `mapForeachStatement` in
//! `packages/core/src/domains/statements/parse.ts`. The statement scanner
//! hands in the statement span plus the optional `ForeachCmd` and
//! `ForeachBody` node spans; header parsing, option-list anchoring and the
//! prefix clamping mirror the legacy code byte for byte.
//!
//! All offsets below are byte offsets into the source, exactly matching the
//! legacy probe outputs.
//!
//! ```
//! use tikz_core::span::Span;
//! use tikz_core::stmt_foreach::map_foreach;
//! let source = "\\begin{tikzpicture}\n\\foreach \\x in {1,2}";
//! let stmt = map_foreach(
//!     source,
//!     Span::new(20, 40),
//!     Some(Span::new(20, 28)),
//!     None,
//!     "foreach:0".to_string(),
//! );
//! assert_eq!(stmt.header_raw, "\\x in {1,2}");
//! assert_eq!(stmt.body_raw, "");
//! assert_eq!(stmt.body_span, None);
//! ```

use crate::ast::ForeachStatement;
use crate::foreach::parse_foreach_header_raw;
use crate::options::parse_option_list_raw;
use crate::span::Span;

/// Map one `\foreach` statement node.
///
/// `cmd` is the `ForeachCmd` node span and `body` the `ForeachBody` node
/// span; both are `None` when the scanner found no such direct child
/// (matching the legacy optional nodes). The header text between the command
/// end and the body start is re-parsed from the source exactly like legacy.
///
/// ```
/// use tikz_core::span::Span;
/// use tikz_core::stmt_foreach::map_foreach;
/// // Trailing whitespace after the header belongs to the statement, and the
/// // header span starts at the first byte of the *trimmed* header.
/// let source = "\\begin{tikzpicture}\n\\foreach \\x in {1,2}\n";
/// let stmt = map_foreach(
///     source,
///     Span::new(20, 41),
///     Some(Span::new(20, 28)),
///     None,
///     "foreach:0".to_string(),
/// );
/// assert_eq!(stmt.header_span, Some(Span::new(29, 40)));
/// ```
pub fn map_foreach(
    source: &str,
    stmt_span: Span,
    cmd: Option<Span>,
    body: Option<Span>,
    id: String,
) -> ForeachStatement {
    let prefix_from = match cmd {
        Some(command) => command.to,
        None => stmt_span.from,
    };
    let prefix_to = match body {
        Some(node) => node.from,
        None => stmt_span.to,
    };
    let prefix_slice = &source[prefix_from..prefix_from.max(prefix_to)];
    let header = parse_foreach_header_raw(prefix_slice);

    // Legacy semantics: an empty `header_raw` still "finds" offset 0, and a
    // missing `indexOf` hit falls back to the prefix start.
    let header_from = prefix_from + prefix_slice.find(&header.header_raw).unwrap_or(0);

    let body_raw = match body {
        Some(node) => node.slice(source).to_string(),
        None => String::new(),
    };

    let options = match (&header.options_raw, &header.options_span) {
        (Some(options_raw), Some(relative)) => {
            Some(parse_option_list_raw(options_raw, header_from + relative.from))
        }
        _ => None,
    };
    let options_span = header
        .options_span
        .map(|relative| Span::new(header_from + relative.from, header_from + relative.to));
    let header_span = if header.header_raw.is_empty() {
        None
    } else {
        Some(Span::new(
            header_from,
            header_from + header.header_raw.len(),
        ))
    };

    ForeachStatement {
        id,
        span: stmt_span,
        options,
        options_span,
        header_span,
        header_raw: header.header_raw.clone(),
        variables_raw: header.variables_raw.clone(),
        list_raw: header.list_raw.clone(),
        prefix_raw: header.header_raw.clone(),
        body_raw,
        body_span: body,
    }
}

#[cfg(test)]
mod stmt_foreach_unit_tests {
    use super::*;

    // `\begin{tikzpicture}\n` is 20 bytes, matching the legacy probe layout
    // where statements start at offset 20.
    const PREFIX: &str = "\\begin{tikzpicture}\n";

    #[test]
    fn basic_foreach_with_body() {
        // Live-probe output for `\foreach \x in {1,2} {\draw (0,\x);}`:
        // span (20,56), headerSpan (29,40), headerRaw `\x in {1,2}`,
        // bodyRaw `{\draw (0,\x);}`, bodySpan (41,56), no options.
        let source = "\\begin{tikzpicture}\n\\foreach \\x in {1,2} {\\draw (0,\\x);}";
        let stmt = map_foreach(
            source,
            Span::new(20, 56),
            Some(Span::new(20, 28)),
            Some(Span::new(41, 56)),
            "foreach:0".to_string(),
        );
        assert_eq!(stmt.span, Span::new(20, 56));
        assert_eq!(stmt.header_span, Some(Span::new(29, 40)));
        assert_eq!(stmt.header_raw, "\\x in {1,2}");
        assert_eq!(stmt.variables_raw, "\\x");
        assert_eq!(stmt.list_raw, "{1,2}");
        assert_eq!(stmt.prefix_raw, "\\x in {1,2}");
        assert_eq!(stmt.body_raw, "{\\draw (0,\\x);}");
        assert_eq!(stmt.body_span, Some(Span::new(41, 56)));
        assert_eq!(stmt.options, None);
        assert_eq!(stmt.options_span, None);
        assert_eq!(stmt.id, "foreach:0");
    }

    #[test]
    fn header_without_body_runs_to_statement_end() {
        // Live probe: `\foreach \x in {1,2}` with a trailing newline inside
        // the statement span: statement (20,41), no body fields.
        let source = "\\begin{tikzpicture}\n\\foreach \\x in {1,2}\n";
        let stmt = map_foreach(
            source,
            Span::new(20, 41),
            Some(Span::new(20, 28)),
            None,
            "foreach:1".to_string(),
        );
        assert_eq!(stmt.header_span, Some(Span::new(29, 40)));
        assert_eq!(stmt.body_raw, "");
        assert_eq!(stmt.body_span, None);
        assert_eq!(stmt.list_raw, "{1,2}");
        assert_eq!(stmt.prefix_raw, "\\x in {1,2}");
    }

    #[test]
    fn bracket_options_are_probed_byte_exact() {
        // Live probe for `\foreach \x [count=\i] in {1} {X}`: optionsSpan
        // (32,42), kv entry spans (33,38) key / (39,41) value / (33,41) raw.
        let source = "\\begin{tikzpicture}\n\\foreach \\x [count=\\i] in {1} {X}\n";
        let stmt = map_foreach(
            source,
            Span::new(20, 53),
            Some(Span::new(20, 28)),
            Some(Span::new(50, 53)),
            "foreach:2".to_string(),
        );
        assert_eq!(stmt.options_span, Some(Span::new(32, 42)));
        assert_eq!(stmt.header_span, Some(Span::new(29, 49)));
        assert_eq!(stmt.header_raw, "\\x [count=\\i] in {1}");
        assert_eq!(stmt.variables_raw, "\\x");
        assert_eq!(stmt.list_raw, "{1}");
        assert_eq!(stmt.body_raw, "{X}");
        let options = stmt.options.expect("options parsed");
        assert_eq!(options.raw, "[count=\\i]");
        assert_eq!(options.span, Span::new(32, 42));
        assert_eq!(options.entries.len(), 1);
        let entry = options.entries.first().expect("entry");
        let kv = entry.kv().expect("kv entry");
        assert_eq!(kv.key, "count");
        assert_eq!(kv.value_raw, "\\i");
        assert_eq!(entry.span(), Span::new(33, 41));
    }

    #[test]
    fn empty_statement_maps_to_empty_fields() {
        let source = "";
        let stmt = map_foreach(source, Span::new(0, 0), None, None, "foreach:3".to_string());
        assert_eq!(stmt.header_raw, "");
        assert_eq!(stmt.header_span, None);
        assert_eq!(stmt.body_raw, "");
        assert_eq!(stmt.body_span, None);
        assert_eq!(stmt.options, None);
        assert_eq!(stmt.prefix_raw, "");
    }

    #[test]
    fn prefix_is_the_stripped_header() {
        // Without a body the prefix runs to the statement end; here the
        // command span is absent on purpose and the whole span is scanned.
        let stmt = map_foreach(PREFIX, Span::new(20, 20), None, None, "foreach:4".to_string());
        assert_eq!(stmt.header_raw, "");
        assert_eq!(stmt.prefix_raw, "");
        assert_eq!(stmt.variables_raw, "");
        assert_eq!(stmt.list_raw, "");
    }

}
