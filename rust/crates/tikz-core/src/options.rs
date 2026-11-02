//! Option list parsing.
//!
//! Port of `packages/core/src/options/parse.ts` + `options/types.ts`.
//! Byte-based: all depth-tracking characters (`\`, `( )`, `{ }`, `[ ]`, `,`,
//! `=`, `%`) are ASCII, so byte offsets preserve character order and the
//! same splitting invariants hold.
//!
//! ```
//! use tikz_core::options::parse_option_list_raw;
//! let list = parse_option_list_raw("[draw, fill=red!50]", 0);
//! assert_eq!(list.entries.len(), 2);
//! assert_eq!(list.entries[0].flag_key().unwrap(), "draw");
//! assert_eq!(list.entries[1].kv().unwrap().key, "fill");
//! ```

use crate::span::Span;
use crate::split::{split_top_level_with_ranges, trim_local_bounds};
use crate::tex_lex::read_tex_balanced_delimited;
use crate::option_classify::classify_option_token;

/// A single option entry inside an option list.
#[derive(Debug, Clone, PartialEq)]
pub enum OptionEntry {
    /// `key=value` pair.
    KV(KvEntry),
    /// Bare flag such as `draw` or `->`.
    Flag(FlagEntry),
    /// Unrecognized token.
    Unknown(UnknownEntry),
}

/// `key=value` option entry.
#[derive(Debug, Clone, PartialEq)]
pub struct KvEntry {
    /// Lower-cased, trimmed key.
    pub key: String,
    /// Trimmed raw value (no brace peeling - callers decide).
    pub value_raw: String,
    /// Span covering the whole `key=value` token.
    pub span: Span,
    /// Span covering only the key.
    pub key_span: Span,
    /// Span covering only the value, `None` when the value is whitespace-only.
    pub value_span: Option<Span>,
    /// Raw token text (trimmed).
    pub raw: String,
}

/// Bare flag option entry.
#[derive(Debug, Clone, PartialEq)]
pub struct FlagEntry {
    /// Lower-cased, trimmed flag text.
    pub key: String,
    /// Span covering the flag token.
    pub span: Span,
    /// Span covering the flag token (same as `span`).
    pub key_span: Span,
    /// Raw flag text.
    pub raw: String,
}

/// Unrecognized option entry.
#[derive(Debug, Clone, PartialEq)]
pub struct UnknownEntry {
    /// Span covering the token.
    pub span: Span,
    /// Raw token text.
    pub raw: String,
}

impl OptionEntry {
    /// All entry variants carry a span.
    pub fn span(&self) -> Span {
        match self {
            OptionEntry::KV(e) => e.span,
            OptionEntry::Flag(e) => e.span,
            OptionEntry::Unknown(e) => e.span,
        }
    }

    /// The `entry.raw` field of the legacy AST.
    pub fn raw(&self) -> &str {
        match self {
            OptionEntry::KV(e) => &e.raw,
            OptionEntry::Flag(e) => &e.raw,
            OptionEntry::Unknown(e) => &e.raw,
        }
    }

    /// Bang access for `kind === "kv"`.
    pub fn kv(&self) -> Option<&KvEntry> {
        match self {
            OptionEntry::KV(e) => Some(e),
            _ => None,
        }
    }

    /// Bang access for `kind === "flag"`.
    pub fn flag_key(&self) -> Option<&str> {
        match self {
            OptionEntry::Flag(e) => Some(&e.key),
            _ => None,
        }
    }
}

/// A parsed option list, e.g. the contents of `[...]`.
#[derive(Debug, Clone, PartialEq)]
pub struct OptionListAst {
    /// Span covering the entire (trimmed) option list.
    pub span: Span,
    /// The trimmed raw text.
    pub raw: String,
    /// Entries in order; dropped when a comma part trims to empty.
    pub entries: Vec<OptionEntry>,
}

/// Parse a raw option list such as `[draw, fill=red]`.
///
/// `absolute_from` is the absolute source offset of (the start of) `raw`.
pub fn parse_option_list_raw(raw: &str, absolute_from: usize) -> OptionListAst {
    let normalized = raw.trim();
    let open_index = normalized.find('[');
    let close_index = find_option_close_index(normalized);

    let inner_from = open_index.map_or(0, |i| i + 1);
    let inner_to = close_index.unwrap_or(normalized.len());
    let inner = if inner_from <= inner_to && inner_from <= normalized.len() {
        &normalized[inner_from.min(normalized.len())..inner_to.min(normalized.len())]
    } else {
        ""
    };
    let masked_inner_bytes = mask_line_comments(inner);
    let masked_inner = String::from_utf8(masked_inner_bytes).expect("masked bytes are valid UTF-8");

    let mut entries = Vec::new();
    for part in split_top_level_with_ranges(&masked_inner, b',') {
        let Some(bounds) = trim_local_bounds(&part.value) else {
            continue;
        };
        let token = &part.value[bounds.0..bounds.1];
        let token_from = absolute_from + inner_from + part.from + bounds.0;
        entries.push(classify_option_token(token, token_from));
    }

    OptionListAst {
        span: Span::new(absolute_from, absolute_from + normalized.len()),
        raw: normalized.to_string(),
        entries,
    }
}

/// Replace `%<newline>` line comments with spaces, keeping offsets fixed.
fn mask_line_comments(input: &str) -> Vec<u8> {
    let bytes = input.as_bytes();
    let mut masked = Vec::with_capacity(bytes.len());
    let mut in_comment = false;
    for i in 0..bytes.len() {
        let byte = bytes[i];
        if in_comment {
            if byte == b'\n' || byte == b'\r' {
                in_comment = false;
                masked.push(byte);
            } else {
                masked.push(b' ');
            }
            continue;
        }
        if byte == b'%' && (i == 0 || bytes[i - 1] != b'\\') {
            in_comment = true;
            masked.push(b' ');
            continue;
        }
        masked.push(byte);
    }
    masked
}

fn find_option_close_index(raw: &str) -> Option<usize> {
    let open = raw.find('[')?;
    let span = read_tex_balanced_delimited(raw, open, b'[', b']', raw.len())?;
    Some(span.to - 1)
}

/// Parse a style payload value (e.g. the `…` in `\tikzset{A/.style={fill=red}}`)
/// as an option list, matching the legacy brace/offset handling.
pub fn parse_style_value_as_option_list(value_raw: &str, absolute_from: usize) -> Option<OptionListAst> {
    let trimmed = value_raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut inner = trimmed.to_string();
    let mut inner_start_offset = 0usize;
    if inner.starts_with('{') && inner.ends_with('}') {
        let without_outer = inner[1..inner.len() - 1].to_string();
        let leading_inner = without_outer.find(|c: char| !c.is_whitespace()).unwrap_or(0);
        inner_start_offset = 1 + leading_inner;
        inner = without_outer.trim().to_string();
    }

    if inner.is_empty() {
        return None;
    }

    let has_explicit_brackets = inner.starts_with('[');
    let option_raw = if has_explicit_brackets { inner.clone() } else { format!("[{inner}]") };
    let offset_adjustment = if has_explicit_brackets { inner_start_offset } else {
        inner_start_offset.checked_sub(1)?
    };
    Some(parse_option_list_raw(&option_raw, absolute_from + offset_adjustment))
}
