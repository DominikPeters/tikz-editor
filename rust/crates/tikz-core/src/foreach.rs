//! `\foreach` header parsing.
//!
//! Port of `packages/core/src/foreach/header.ts`. Byte-based scanning: all
//! delimiter characters (`\`, `( )`, `{ }`, `[ ]`, `%`, `\n`) are ASCII, and
//! byte offsets of structural positions are always character boundaries.
//!
//! ```
//! use tikz_core::foreach::parse_foreach_header_raw;
//! let header = parse_foreach_header_raw("\\x in {1,2}");
//! assert!(header.is_valid);
//! assert_eq!(header.variables_raw, "\\x");
//! assert_eq!(header.list_raw, "{1,2}");
//! ```

use crate::span::Span;

/// Raw parse of a `\foreach` header (everything up to the body).
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedForeachHeaderRaw {
    /// Trimmed original header text.
    pub header_raw: String,
    /// Variables side with top-level `[...]` option runs removed.
    pub variables_raw: String,
    /// Text after the `in` keyword (trimmed); empty when no `in` was found.
    pub list_raw: String,
    /// First top-level bracket run found on the variables side.
    pub options_raw: Option<String>,
    /// Span of `options_raw` within the variables-side text.
    pub options_span: Option<Span>,
    /// True when a variables/list part exists (or an `in` split succeeded).
    pub is_valid: bool,
}

/// Drop a leading `\foreach`/`foreach` prefix, trimming whitespace.
///
/// Legacy callers strip the command token before parsing the header.
/// ```
/// use tikz_core::foreach::strip_foreach_command_prefix;
/// assert_eq!(strip_foreach_command_prefix("\\foreach \\x"), "\\x");
/// assert_eq!(strip_foreach_command_prefix("foreach x"), "x");
/// assert_eq!(strip_foreach_command_prefix("  no-prefix"), "no-prefix");
/// ```
pub fn strip_foreach_command_prefix(raw: &str) -> String {
    let trimmed = raw.trim_start();
    let without = trimmed
        .strip_prefix("\\foreach")
        .or_else(|| trimmed.strip_prefix("foreach"))
        .unwrap_or(trimmed);
    without.trim_start().to_string()
}

/// Parse a foreach header into variables / `in` list / bracket options.
pub fn parse_foreach_header_raw(raw: &str) -> ParsedForeachHeaderRaw {
    let header_raw = raw.trim();
    let empty = ParsedForeachHeaderRaw {
        header_raw: header_raw.to_string(),
        variables_raw: String::new(),
        list_raw: String::new(),
        options_raw: None,
        options_span: None,
        is_valid: false,
    };
    if header_raw.is_empty() {
        return empty;
    }

    let masked = mask_line_comments_preserving_length(header_raw);
    let empty = ParsedForeachHeaderRaw { variables_raw: String::new(), ..empty };
    let Some(in_index) = find_top_level_in_keyword(&masked) else {
        let left = remove_top_level_option_lists(header_raw);
        return ParsedForeachHeaderRaw {
            variables_raw: left.variables,
            list_raw: String::new(),
            options_raw: left.first_option_raw,
            options_span: left.first_option_span,
            ..empty
        };
    };

    let left_raw = &header_raw[..in_index];
    let list_raw = header_raw[in_index + 2..].trim();
    let left = remove_top_level_option_lists(left_raw);
    let is_valid = !left.variables.is_empty() || !list_raw.is_empty();

    ParsedForeachHeaderRaw {
        variables_raw: left.variables,
        list_raw: list_raw.to_string(),
        options_raw: left.first_option_raw,
        options_span: left.first_option_span,
        is_valid,
        ..empty
    }
}

/// Index of a top-level `in` keyword with word boundaries on its sides.
fn find_top_level_in_keyword(raw: &str) -> Option<usize> {
    let bytes = raw.as_bytes();
    let mut depths = Depths {
        paren: 0,
        brace: 0,
        bracket: 0,
    };

    let mut index = 0usize;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'\\' {
            // Skip the two-character escape run (legacy `index += 1` twice).
            index += 2;
            continue;
        }
        match byte {
            b'(' => depths.paren += 1,
            b')' => depths.paren = (depths.paren - 1).max(0),
            b'{' => depths.brace += 1,
            b'}' => depths.brace = (depths.brace - 1).max(0),
            b'[' => depths.bracket += 1,
            b']' => depths.bracket = (depths.bracket - 1).max(0),
            _ => {}
        }

        if !depths.at_top() || !raw[index..].starts_with("in") {
            index += 1;
            continue;
        }

        let left = index.checked_sub(1).map(|from| bytes[from]);
        let right = bytes.get(index + 2).copied();
        if is_word_boundary_byte(left) && is_word_boundary_byte(right) {
            return Some(index);
        }
        index += 1;
    }
    None
}

/// Boundary char test of `[A-Za-z0-9_@]` (empty and non-word bytes pass).
fn is_word_boundary_byte(value: Option<u8>) -> bool {
    !value.is_some_and(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'@')
}

struct RemovedOptions {
    variables: String,
    first_option_raw: Option<String>,
    first_option_span: Option<Span>,
}

/// Remove top-level `[...]` bracket runs from the variables side.
fn remove_top_level_option_lists(raw: &str) -> RemovedOptions {
    let masked = mask_line_comments_preserving_length(raw);
    let masked_bytes = masked.as_bytes();
    let mut builder = String::new();
    let mut first_option_raw: Option<String> = None;
    let mut first_option_span: Option<Span> = None;
    let mut depths = Depths {
        paren: 0,
        brace: 0,
        bracket: 0,
    };

    let mut index = 0usize;
    while index < masked_bytes.len() {
        let byte = masked_bytes[index];
        if byte == b'\\' {
            builder.push('\\');
            if index + 1 < masked_bytes.len() {
                builder.push_str(&masked[index + 1..index + 2]);
            }
            index += 2;
            continue;
        }
        match byte {
            b'(' => depths.paren += 1,
            b')' => depths.paren = (depths.paren - 1).max(0),
            b'{' => depths.brace += 1,
            b'}' => depths.brace = (depths.brace - 1).max(0),
            _ => {}
        }

        if byte == b'[' && depths.paren == 0 && depths.brace == 0 {
            let Some(option_end) = find_matching_bracket(&masked, index) else {
                builder.push_str(&masked[index..index + 1]);
                index += 1;
                continue;
            };
            if first_option_raw.is_none() {
                first_option_raw = Some(raw[index..option_end + 1].to_string());
                first_option_span = Some(Span::new(index, option_end + 1));
            }
            index = option_end + 1;
            continue;
        }

        builder.push_str(&masked[index..index + 1]);
        index += 1;
    }

    RemovedOptions {
        variables: builder.trim().to_string(),
        first_option_raw,
        first_option_span,
    }
}

/// Index of the matching `]` for a `[`, with escapes inert.
fn find_matching_bracket(raw: &str, from: usize) -> Option<usize> {
    let bytes = raw.as_bytes();
    let mut depth = 0i64;
    let mut index = from;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'\\' {
            index += 2;
            continue;
        }
        if byte == b'[' {
            depth += 1;
        } else if byte == b']' {
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
        }
        index += 1;
    }
    None
}

struct Depths {
    paren: i64,
    brace: i64,
    bracket: i64,
}

impl Depths {
    fn at_top(&self) -> bool {
        self.paren == 0 && self.brace == 0 && self.bracket == 0
    }
}

/// Replace `%<newline>` comment interiors with spaces, length-preserving.
fn mask_line_comments_preserving_length(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut masked = Vec::with_capacity(bytes.len());
    let mut in_comment = false;
    for (index, &byte) in bytes.iter().enumerate() {
        if in_comment {
            if byte == b'\n' || byte == b'\r' {
                in_comment = false;
                masked.push(byte);
            } else {
                masked.push(b' ');
            }
            continue;
        }
        let prev = index.checked_sub(1).and_then(|from| bytes.get(from)).copied();
        if byte == b'%' && prev != Some(b'\\') {
            in_comment = true;
            masked.push(b' ');
            continue;
        }
        masked.push(byte);
    }
    String::from_utf8(masked).expect("masked bytes remain valid UTF-8")
}

#[cfg(test)]
mod foreach_unit_tests {
    use super::*;

    #[test]
    fn parses_basic_header() {
        let header = parse_foreach_header_raw("\\a in {1,2,3} body");
        assert!(header.is_valid);
        assert_eq!(header.variables_raw, "\\a");
        assert_eq!(header.list_raw, "{1,2,3} body");
        assert!(header.options_raw.is_none());
    }

    #[test]
    fn strips_foreach_prefix() {
        assert_eq!(strip_foreach_command_prefix("\\foreach \\x"), "\\x");
        assert_eq!(strip_foreach_command_prefix("foreach x"), "x");
        assert_eq!(strip_foreach_command_prefix("  no-prefix"), "no-prefix");
    }

    #[test]
    fn missing_in_keyword_is_invalid() {
        let header = parse_foreach_header_raw("[x=1] \\a");
        assert!(!header.is_valid);
        assert_eq!(header.variables_raw, "\\a");
        assert_eq!(header.options_raw, Some("[x=1]".to_string()));
    }

    #[test]
    fn options_remove_compact_variables() {
        let header = parse_foreach_header_raw("[very] \\i in {a}");
        assert_eq!(header.variables_raw, "\\i");
        assert_eq!(header.options_raw, Some("[very]".to_string()));
        assert_eq!(header.options_span, Some(Span::new(0, 6)));
    }

    #[test]
    fn nested_in_is_skipped() {
        // `in` inside a group is not the split keyword.
        let header = parse_foreach_header_raw("\\x {in} in {y}");
        assert!(header.is_valid);
        assert_eq!(header.variables_raw, "\\x {in}");
    }

    #[test]
    fn in_at_word_boundary_only() {
        let header = parse_foreach_header_raw("varin {y}");
        assert!(!header.is_valid);
    }
}
