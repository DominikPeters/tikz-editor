//! TeX-level lexical helpers.
//!
//! Port of `packages/core/src/parser/tex-lexical.ts`. All structural
//! characters (`\`, `{`, `}`, `[`, `]`, `%`, `\n`) are single ASCII bytes;
//! UTF-8 continuation bytes can never match them, so byte-based scanning is
//! character-safe and preserves the legacy code-unit offsets.

use crate::span::Span;

/// One control word or escaped control symbol, e.g. `\node` or `\\`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TexControlSequence {
    /// Including the leading backslash.
    pub raw: String,
    /// Inclusive byte range of the control sequence.
    pub span: Span,
}

/// Read one ordinary-catcode control word (letters + `@`) or, when nothing
/// letter-like follows, the two-character escaped symbol fallback.
///
/// ```
/// use tikz_core::tex_lex::read_tex_control_sequence;
/// let seq = read_tex_control_sequence(" \\node at (0,1);", 0);
/// assert!(seq.is_none());
/// let seq = read_tex_control_sequence(" \\node at (0,1);", 1);
/// assert_eq!(seq.map(|s| s.raw), Some("\\node".to_string()));
/// ```
pub fn read_tex_control_sequence(source: &str, from: usize) -> Option<TexControlSequence> {
    let bytes = source.as_bytes();
    if bytes.get(from) != Some(&b'\\') {
        return None;
    }
    let mut cursor = from + 1;
    while cursor < bytes.len() && bytes[cursor].is_ascii_alphabetic() || cursor < bytes.len() && bytes[cursor] == b'@' {
        cursor += 1;
    }
    if cursor == from + 1 {
        // Control symbol: the backslash plus exactly one *character*. Using
        // `from + 2` bytes would split a multibyte char and panic on slice.
        let symbol_len = source[from + 1..].chars().next().map_or(0, char::len_utf8);
        cursor = from + 1 + symbol_len;
    }
    Some(TexControlSequence {
        raw: source[from..cursor].to_string(),
        span: Span::new(from, cursor),
    })
}

/// Consume a `%` comment through the end of its line (terminator included).
pub fn skip_tex_comment(source: &str, from: usize) -> usize {
    let bytes = source.as_bytes();
    let mut cursor = from;
    while cursor < bytes.len() {
        let byte = bytes[cursor];
        cursor += 1;
        if byte == b'\n' || byte == b'\r' {
            break;
        }
    }
    cursor
}

/// Consume whitespace and comments up to (but not past) `limit`.
pub fn skip_tex_whitespace_and_comments(source: &str, from: usize, limit: usize) -> usize {
    let bytes = source.as_bytes();
    let mut cursor = from;
    while cursor < limit {
        let byte = bytes[cursor];
        if byte.is_ascii_whitespace() {
            cursor += 1;
        } else if byte == b'%' {
            cursor = limit.min(skip_tex_comment(source, cursor));
        } else {
            break;
        }
    }
    cursor
}

/// `\begin{…}` or `\end{…}` with an adjacent `{name}` argument.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TexEnvironmentDelimiter {
    /// Span covering the whole `\begin{name}` / `\end{name}` token.
    pub span: Span,
    /// Whether this begins or ends an environment.
    pub kind: TexEnvironmentKind,
    /// Environment body, between the braces.
    pub name: String,
}

/// Begin or end marker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TexEnvironmentKind {
    /// `\begin{…}`
    Begin,
    /// `\end{…}`
    End,
}

/// Read a literal environment name, preserving all original offsets. The
/// TikZ grammar requires an adjacent argument; pass `allow_trivia = true` to
/// accept TeX trivia between the control word and its argument.
pub fn read_tex_environment_delimiter(
    source: &str,
    from: usize,
    allow_trivia: bool,
) -> Option<TexEnvironmentDelimiter> {
    let command = read_tex_control_sequence(source, from)?;
    if command.raw != "\\begin" && command.raw != "\\end" {
        return None;
    }
    let name_from = if allow_trivia {
        skip_tex_whitespace_and_comments(source, command.span.to, source.len())
    } else {
        command.span.to
    };
    let bytes = source.as_bytes();
    if bytes.get(name_from) != Some(&b'{') {
        return None;
    }
    let mut cursor = name_from + 1;
    while cursor < bytes.len() && is_env_name_byte(bytes[cursor]) {
        cursor += 1;
    }
    if cursor == name_from + 1 || bytes.get(cursor) != Some(&b'}') {
        return None;
    }
    Some(TexEnvironmentDelimiter {
        span: Span::new(from, cursor + 1),
        kind: if command.raw == "\\begin" { TexEnvironmentKind::Begin } else { TexEnvironmentKind::End },
        name: source[name_from + 1..cursor].to_string(),
    })
}

fn is_env_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'*' || byte == b'@' || byte == b'-'
}

/// Given the control sequence at `command`, consume a supported verbatim form
/// (`\verb*`…`*`, `\begin{verbatim}` … `\end{verbatim*}`) and return the end
/// offset, or [`None`] when the command is not verbatim-like.
pub fn skip_tex_verbatim(source: &str, command: &TexControlSequence, allow_environment_trivia: bool) -> Option<usize> {
    let bytes = source.as_bytes();
    if command.raw == "\\verb" {
        let delimiter_from = if bytes.get(command.span.to) == Some(&b'*') {
            command.span.to + 1
        } else {
            command.span.to
        };
        let delimiter = match bytes.get(delimiter_from) {
            None => return Some(delimiter_from),
            Some(&b'\n') | Some(&b'\r') => return Some(delimiter_from),
            Some(&delim) => delim,
        };
        let mut cursor = delimiter_from + 1;
        while cursor < bytes.len() {
            let byte = bytes[cursor];
            if byte == b'\n' || byte == b'\r' {
                return Some(cursor);
            }
            cursor += 1;
            if byte == delimiter {
                return Some(cursor);
            }
        }
        return Some(cursor);
    }
    let environment = read_tex_environment_delimiter(source, command.span.from, allow_environment_trivia)?;
    if environment.kind != TexEnvironmentKind::Begin
        || (environment.name != "verbatim" && environment.name != "verbatim*")
    {
        return None;
    }
    let end_token = format!("\\end{{{}}}", environment.name);
    match source.find(&end_token) {
        None => Some(bytes.len()),
        Some(end_from) => Some(end_from + end_token.len()),
    }
}

/// Read a balanced group or option list, with comments and escapes inert.
///
/// When `open_char` is `[`, `{`/`}` nested inside the option list do not
/// affect the bracket depth; a bare `}` inside an option list is skipped.
///
/// ```
/// use tikz_core::tex_lex::read_tex_balanced_delimited;
/// let span = read_tex_balanced_delimited("[a,b]{x}[c]", 5, b'{', b'}', 11).unwrap();
/// assert_eq!(span.from, 5);
/// assert_eq!(span.to, 8);
/// let list = read_tex_balanced_delimited("[a,b]{x}[c]", 0, b'[', b']', 11).unwrap();
/// assert_eq!(list.to, 5);
/// assert!(read_tex_balanced_delimited("[a,b]{x}[c]", 4, b'{', b'}', 11).is_none());
/// ```
pub fn read_tex_balanced_delimited(
    source: &str,
    from: usize,
    open_char: u8,
    close_char: u8,
    limit: usize,
) -> Option<Span> {
    let bytes = source.as_bytes();
    if bytes.get(from) != Some(&open_char) {
        return None;
    }
    let mut depth = 0i64;
    let mut brace_depth = 0i64;
    let mut cursor = from;
    while cursor < limit {
        let byte = bytes[cursor];
        if byte == b'%' {
            cursor = limit.min(skip_tex_comment(source, cursor));
            continue;
        }
        if byte == b'\\' {
            cursor = limit.min(cursor + 2);
            continue;
        }
        if open_char == b'[' {
            if byte == b'{' {
                brace_depth += 1;
            } else if byte == b'}' && brace_depth > 0 {
                brace_depth -= 1;
            }
            if brace_depth > 0 || byte == b'}' {
                cursor += 1;
                continue;
            }
        }
        if byte == open_char {
            depth += 1;
        } else if byte == close_char {
            depth -= 1;
            if depth == 0 {
                return Some(Span::new(from, cursor + 1));
            }
        }
        cursor += 1;
    }
    None
}

#[cfg(test)]
mod tex_lex_unit_tests {
    use super::*;

    #[test]
    fn balanced_group() {
        // Index 4 is the closing `]` of the header `[a,b]`; the group `{…}`
        // starts at 5 and closes at 7.
        let span = read_tex_balanced_delimited("[a,b]{x}[c]", 5, b'{', b'}', 11);
        assert_eq!(span, Some(Span::new(5, 8)));
    }

    #[test]
    fn rejects_non_opening_offset() {
        assert_eq!(read_tex_balanced_delimited("[a,b]{x}[c]", 4, b'{', b'}', 11), None);
    }

    #[test]
    fn option_list_braces_inert() {
        // In `[` mode, `{}` interiors are inert and bare `}` is skipped.
        assert_eq!(read_tex_balanced_delimited("[a,{b}]", 0, b'[', b']', 7), Some(Span::new(0, 7)));
    }

    #[test]
    fn option_list_brackets_inside_braces_inert() {
        assert_eq!(
            read_tex_balanced_delimited("[x={[content]}]", 0, b'[', b']', 15),
            Some(Span::new(0, 15))
        );
    }

    #[test]
    fn escapes_and_comments_inert() {
        // `\(2)` escaped close brace and a `%` comment are transparent.
        let source = "{a\\}b % t }\n}";
        let span = read_tex_balanced_delimited(source, 0, b'{', b'}', source.len());
        assert_eq!(span, Some(Span::new(0, source.len())));
    }
}

#[cfg(test)]
mod multibyte_regression {
    use super::*;

    #[test]
    fn control_symbol_before_multibyte_char_does_not_split_it() {
        let seq = read_tex_control_sequence("\\\u{4e2d}x", 0).unwrap();
        assert_eq!(seq.raw, "\\\u{4e2d}");
        assert_eq!(seq.span, Span::new(0, 4));
        assert_eq!(read_tex_control_sequence("\\", 0).unwrap().raw, "\\");
    }
}
