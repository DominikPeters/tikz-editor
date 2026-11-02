//! TikZ coordinate parsing.
//!
//! Port of the pure core of `packages/core/src/domains/coordinates/parse.ts`
//! (`parseCoordinate` and splitting helpers). Byte-based; all structural
//! characters (`\ ( ) { } [ ] , :`) are ASCII.
//!
//! ```
//! use tikz_core::coordinate::{parse_coordinate, CoordinateForm};
//! let parsed = parse_coordinate("(1 + 2, sin(30))");
//! assert_eq!(parsed.form, CoordinateForm::Cartesian);
//! let polar = parse_coordinate("(30:2cm)");
//! assert_eq!(polar.form, CoordinateForm::Polar);
//! assert_eq!(polar.x, "30");
//! assert_eq!(polar.y, "2cm");
//! ```

use crate::split::split_top_level_with_ranges;
use crate::span::Span;

/// Coordinate syntax form.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CoordinateForm {
    /// `(x, y)`
    Cartesian,
    /// `(x, y, z)`
    Xyz,
    /// `(angle: radius)`
    Polar,
    /// Bare node name or `intersection … of` expression
    Named,
    /// `($ … $)`
    Calc,
    /// Canvas-space `cs:` systems
    Explicit,
    /// Not a coordinate
    Unknown,
}

/// Result of [`parse_coordinate`].
///
/// `x`/`y`/`z` hold the trimmed sub-expressions (never re-parsed).
#[derive(Debug, Clone)]
pub struct ParsedCoordinate {
    /// First component (or whole expression for calc/explicit/named).
    pub x: String,
    /// Second component (empty for calc/explicit/named).
    pub y: String,
    /// Third component for `xyz`.
    pub z: Option<String>,
    /// Which syntax form matched.
    pub form: CoordinateForm,
    /// Well-formedness of the matched form.
    pub is_well_formed: bool,
    /// Span of the leading `[...]` inside the parens, relative to raw start.
    pub options_span: Option<Span>,
    /// Leading `[...]` text including brackets.
    pub options_raw: Option<String>,
}

impl ParsedCoordinate {
    fn not_well_formed() -> ParsedCoordinate {
        ParsedCoordinate {
            x: String::new(),
            y: String::new(),
            z: None,
            form: CoordinateForm::Unknown,
            is_well_formed: false,
            options_span: None,
            options_raw: None,
        }
    }
}

/// Parse one `(…)` coordinate expression.
pub fn parse_coordinate(raw: &str) -> ParsedCoordinate {
    let trimmed = raw.trim();
    if !trimmed.starts_with('(') {
        return ParsedCoordinate::not_well_formed();
    }
    if !trimmed.ends_with(')') {
        return ParsedCoordinate::not_well_formed();
    }

    let inner = trimmed[1..trimmed.len() - 1].trim();
    if inner.is_empty() {
        return ParsedCoordinate::not_well_formed();
    }

    let extracted = extract_leading_coordinate_options(inner);
    let core = extracted.remainder;
    if core.is_empty() {
        return ParsedCoordinate::not_well_formed();
    }

    let options_span = extracted.options_raw.as_ref().map(|r| {
        Span::new(1 + extracted.options_offset, 1 + extracted.options_offset + r.len())
    });

    if is_calc_coordinate(&core) {
        return ParsedCoordinate {
            x: core.to_string(),
            y: String::new(),
            z: None,
            form: CoordinateForm::Calc,
            is_well_formed: true,
            options_span,
            options_raw: extracted.options_raw,
        };
    }

    if contains_cs_colon(&core) {
        return ParsedCoordinate {
            x: core.to_string(),
            y: String::new(),
            z: None,
            form: CoordinateForm::Explicit,
            is_well_formed: true,
            options_span,
            options_raw: extracted.options_raw,
        };
    }

    if is_intersection_coordinate_expression(&core) {
        return ParsedCoordinate {
            x: core.to_string(),
            y: String::new(),
            z: None,
            form: CoordinateForm::Named,
            is_well_formed: true,
            options_span,
            options_raw: extracted.options_raw,
        };
    }

    let comma_parts: Vec<String> = split_all_at_top_level(&core, b',')
        .iter()
        .map(|part| part.trim().to_string())
        .collect();
    if comma_parts.len() == 2 {
        let x = comma_parts.first().cloned().unwrap_or_default();
        let y = comma_parts.get(1).cloned().unwrap_or_default();
        return ParsedCoordinate {
            form: CoordinateForm::Cartesian,
            is_well_formed: !x.is_empty() && !y.is_empty(),
            x,
            y,
            z: None,
            options_span,
            options_raw: extracted.options_raw,
        };
    }
    if comma_parts.len() >= 3 {
        let x = comma_parts.first().cloned().unwrap_or_default();
        let y = comma_parts.get(1).cloned().unwrap_or_default();
        let z = comma_parts
            .get(2..)
            .map(|rest| rest.join(",").trim().to_string())
            .unwrap_or_default();
        return ParsedCoordinate {
            form: CoordinateForm::Xyz,
            is_well_formed: !x.is_empty() && !y.is_empty() && !z.is_empty(),
            x,
            y,
            z: Some(z),
            options_span,
            options_raw: extracted.options_raw,
        };
    }

    if let Some(colon) = split_at_top_level(&core, b':') {
        let angle = colon.0.trim();
        let radius = colon.1.trim();
        return ParsedCoordinate {
            x: angle.to_string(),
            y: radius.to_string(),
            z: None,
            form: CoordinateForm::Polar,
            is_well_formed: !angle.is_empty() && !radius.is_empty(),
            options_span,
            options_raw: extracted.options_raw,
        };
    }

    ParsedCoordinate {
        x: core.to_string(),
        y: String::new(),
        z: None,
        form: CoordinateForm::Named,
        is_well_formed: true,
        options_span,
        options_raw: extracted.options_raw,
    }
}

/// True when the normalized core matches `^intersection(?:\s+\d+)?\s+of\b/i`.
pub fn is_intersection_coordinate_expression(core: &str) -> bool {
    let normalized = unwrap_outer_braces(core.trim());
    matches_intersection_prefix(&lowercase_ascii(normalized))
}

fn unwrap_outer_braces(raw: &str) -> &str {
    let mut normalized = raw.trim();
    while normalized.starts_with('{') && normalized.ends_with('}') && normalized.len() >= 2 {
        normalized = normalized[1..normalized.len() - 1].trim();
    }
    normalized
}

/// Case-insensitive `intersection(?:\s+\d+)?\s+of\b` on an already
/// lowercased string.
fn matches_intersection_prefix(lower: &str) -> bool {
    let rest = match lower.strip_prefix("intersection") {
        Some(rest) => rest,
        None => return false,
    };
    let mut cursor = 0usize;
    let rest_bytes = rest.as_bytes();
    while cursor < rest_bytes.len() && rest_bytes[cursor].is_ascii_whitespace() {
        cursor += 1;
    }
    while cursor < rest_bytes.len() && rest_bytes[cursor].is_ascii_digit() {
        cursor += 1;
    }
    while cursor < rest_bytes.len() && rest_bytes[cursor].is_ascii_whitespace() {
        cursor += 1;
    }
    if !rest[cursor..].starts_with("of") {
        return false;
    }
    // \b: next char must not be a JS word char (ASCII [A-Za-z0-9_] only).
    let rest_bytes = rest.as_bytes();
    let after = rest_bytes.get(cursor + 2).copied();
    !after.is_some_and(|b| b.is_ascii_alphanumeric() || b == b'_')
}

fn lowercase_ascii(value: &str) -> String {
    value
        .chars()
        .map(|c| if c.is_ascii() { c.to_ascii_lowercase() } else { c })
        .collect()
}

struct ExtractedOptions {
    options_raw: Option<String>,
    options_offset: usize,
    remainder: String,
}

fn extract_leading_coordinate_options(inner: &str) -> ExtractedOptions {
    let bytes = inner.as_bytes();
    let offset = bytes.iter().take_while(|&&b| b.is_ascii_whitespace()).count();
    if bytes.get(offset) != Some(&b'[') {
        return ExtractedOptions {
            options_raw: None,
            options_offset: 0,
            remainder: inner.trim().to_string(),
        };
    }
    let Some(option_end) = find_matching_bracket(inner, offset) else {
        return ExtractedOptions {
            options_raw: None,
            options_offset: 0,
            remainder: inner.trim().to_string(),
        };
    };

    let options_raw = inner[offset..option_end + 1].to_string();
    let mut cursor = option_end + 1;
    while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
        cursor += 1;
    }
    ExtractedOptions {
        options_raw: Some(options_raw),
        options_offset: offset,
        remainder: inner[cursor.min(bytes.len())..].trim().to_string(),
    }
}

fn find_matching_bracket(input: &str, from: usize) -> Option<usize> {
    let bytes = input.as_bytes();
    let mut depth: i64 = 0;
    let mut i = from;
    while i < bytes.len() {
        let byte = bytes[i];
        if byte == b'\\' {
            i += 2;
            continue;
        }
        if byte == b'[' {
            depth += 1;
        } else if byte == b']' {
            depth -= 1;
            if depth == 0 {
                return Some(i);
            }
        }
        i += 1;
    }
    None
}

fn is_calc_coordinate(core: &str) -> bool {
    let trimmed = core.trim();
    trimmed.starts_with('$') && trimmed.ends_with('$') && trimmed.len() >= 2
}

/// Case-insensitive `\bcs\s*:` search.
fn contains_cs_colon(core: &str) -> bool {
    let lower = lowercase_ascii(core);
    let bytes = lower.as_bytes();
    let mut cursor = 0usize;
    while let Some(found) = lower[cursor..].find("cs") {
        let start = cursor + found;
        // Left `\b` for `cs`: JS word chars are ASCII [A-Za-z0-9_] only.
        if start > 0 && (bytes[start - 1].is_ascii_alphanumeric() || bytes[start - 1] == b'_') {
            cursor = start + 1;
            continue;
        }
        let mut ws = start + 2;
        while ws < bytes.len() && bytes[ws].is_ascii_whitespace() {
            ws += 1;
        }
        if bytes.get(ws) == Some(&b':') {
            return true;
        }
        cursor = start + 1;
    }
    false
}

/// Split at every unescaped, top-level separator occurrence.
pub fn split_all_at_top_level(input: &str, separator: u8) -> Vec<String> {
    split_top_level_with_ranges(input, separator)
        .into_iter()
        .map(|part| part.value)
        .collect()
}

/// Split at the first top-level separator; the right side re-joins the rest.
///
/// Returns `(left, joined rest)`, or `None` below two parts.
pub fn split_at_top_level(input: &str, separator: u8) -> Option<(String, String)> {
    let parts = split_top_level_with_ranges(input, separator);
    if parts.len() < 2 {
        return None;
    }
    let left = parts[0].value.clone();
    let mut right = parts[1].value.clone();
    for part in &parts[2..] {
        right.push(separator as char);
        right.push_str(&part.value);
    }
    Some((left, right))
}
