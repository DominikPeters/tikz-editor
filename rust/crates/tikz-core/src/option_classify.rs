//! Option-token classification.
//!
//! Port of the legacy `classifyOptionToken` heuristics from
//! `packages/core/src/parser/tex-lexical.ts` region: `=` split first, then
//! flag / arrow / color shape tests. Regex-like checks use the JS definition
//! of word characters (ASCII `[A-Za-z0-9_]` only) for `\b` parity.

use crate::options::{FlagEntry, KvEntry, OptionEntry, UnknownEntry};
use crate::span::Span;
use crate::split::{find_top_level_separator, trim_local_bounds};

/// Classify one comma-separated option token into KV / Flag / Unknown.
pub(crate) fn classify_option_token(token: &str, token_from: usize) -> OptionEntry {
    let span = Span::new(token_from, token_from + token.len());

    if let Some(separator) = find_top_level_separator(token, b'=') {
        let key_raw = &token[..separator];
        let value_raw_untrimmed = &token[separator + 1..];
        let key = key_raw.trim().to_lowercase();
        let value_raw = value_raw_untrimmed.trim();
        if key.is_empty() {
            return OptionEntry::Unknown(UnknownEntry { span, raw: token.to_string() });
        }

        let Some(key_bounds) = trim_local_bounds(key_raw) else {
            return OptionEntry::Unknown(UnknownEntry { span, raw: token.to_string() });
        };
        let value_bounds = trim_local_bounds(value_raw_untrimmed);
        let key_span = Span::new(token_from + key_bounds.0, token_from + key_bounds.1);
        let value_span = value_bounds
            .map(|b| Span::new(token_from + separator + 1 + b.0, token_from + separator + 1 + b.1));

        return OptionEntry::KV(KvEntry {
            key,
            value_raw: value_raw.to_string(),
            span,
            key_span,
            value_span,
            raw: token.to_string(),
        });
    }

    if is_flag_shape(token) || looks_like_arrow_specification(token) || looks_like_color_specification(token) {
        return OptionEntry::Flag(FlagEntry {
            key: token.trim().to_lowercase(),
            span,
            key_span: Span::new(token_from, token_from + token.len()),
            raw: token.to_string(),
        });
    }

    OptionEntry::Unknown(UnknownEntry { span, raw: token.to_string() })
}

fn is_flag_shape(token: &str) -> bool {
    let bytes = token.as_bytes();
    let b = |i: usize| -> u8 { *bytes.get(i).unwrap_or(&0) };
    match token {
        "-" | "<-" | "->" | "<->" | "|-|" => return true,
        _ => {}
    }
    // ^[A-Za-z][A-Za-z0-9 -]*$
    !bytes.is_empty()
        && bytes[0].is_ascii_alphabetic()
        && (1..bytes.len()).all(|i| b(i).is_ascii_alphanumeric() || b(i) == b' ' || b(i) == b'-')
}

fn looks_like_arrow_specification(token: &str) -> bool {
    let trimmed = token.trim();
    if trimmed.is_empty() || !trimmed.contains('-') {
        return false;
    }
    if find_top_level_separator(trimmed, b'-').is_none() {
        return false;
    }
    let bytes = trimmed.as_bytes();
    let has_arrow_syntax = bytes.iter().any(|&b| matches!(b, b'<' | b'>' | b'|' | b'{' | b'}' | b'[' | b']'));
    let has_known_arrow_name = contains_known_arrow_name(trimmed);
    if !has_arrow_syntax && !has_known_arrow_name {
        return false;
    }
    // ^[A-Za-z0-9<>|{}[\].'=,:!# -]+$
    bytes.iter().all(|&b| {
        b.is_ascii_alphanumeric()
            || matches!(b, b'<' | b'>' | b'|' | b'{' | b'}' | b'[' | b']' | b'.' | b'\'' | b'=' | b',' | b':' | b'!' | b'#' | b' ' | b'-')
    })
}

/// JS `\w` inside `\b`: only ASCII `[A-Za-z0-9_]` are word characters.
pub(crate) fn is_js_word_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn contains_known_arrow_name(trimmed: &str) -> bool {
    let lower = trimmed.to_lowercase();
    // Single words from the legacy alternation regex, matched with word
    // boundaries; multiword names (`arc barb` etc.) allow any whitespace run.
    const WORDS: [&str; 18] = [
        "stealth", "latex", "triangle", "bar", "hooks", "to", "implies", "rightarrow",
        "kite", "square", "circle", "rays", "bracket", "parenthesis", "diamond",
        "rectangle", "ellipse", "cap",
    ];
    for name in WORDS {
        if word_boundary_contains(&lower, name) {
            return true;
        }
    }
    const MULTIWORD: [&str; 3] = ["arc", "tee", "straight"];
    for first in MULTIWORD {
        if multiword_arrow_match(&lower, first) {
            return true;
        }
    }
    false
}

/// Look for `<ws><first> <ws>+barb` boundary-forms of a multiword arrow name.
fn multiword_arrow_match(lower: &str, first: &str) -> bool {
    let bytes = lower.as_bytes();
    let mut cursor = 0usize;
    while let Some(found) = lower[cursor..].find(first) {
        let start = cursor + found;
        let after = start + first.len();
        let before = start.checked_sub(1).map(|off| bytes[off]);
        let before_ok = !before.is_some_and(is_js_word_byte);
        let mut ws = after;
        while ws < bytes.len() && bytes[ws].is_ascii_whitespace() {
            ws += 1;
        }
        if before_ok && ws > after && lower[ws..].starts_with("barb") {
            let after_ok = ws + "barb".len() >= lower.len()
                || !bytes.get(ws + "barb".len()).copied().is_some_and(is_js_word_byte);
            if after_ok {
                return true;
            }
        }
        cursor = start + 1;
        if cursor >= lower.len() {
            break;
        }
    }
    false
}

fn word_boundary_contains(haystack: &str, needle: &str) -> bool {
    // JS `\b` counts only ASCII [A-Za-z0-9_] as word characters.
    let bytes = haystack.as_bytes();
    let mut cursor = 0usize;
    while let Some(found) = haystack[cursor..].find(needle) {
        let start = cursor + found;
        let end = start + needle.len();
        let before = start.checked_sub(1).map(|from| bytes[from]);
        let before_ok = !(before.is_some_and(is_js_word_byte));
        let after = bytes.get(end).copied();
        let after_ok = !(after.is_some_and(is_js_word_byte));
        if before_ok && after_ok {
            return true;
        }
        cursor = start + 1;
        if cursor >= haystack.len() {
            break;
        }
    }
    false
}

fn looks_like_color_specification(token: &str) -> bool {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        return false;
    }
    if is_hash_hex(trimmed) {
        return true;
    }
    if !trimmed.contains('!') {
        return false;
    }
    is_color_mix_chain(trimmed)
}

fn is_hash_hex(trimmed: &str) -> bool {
    let bytes = trimmed.as_bytes();
    if bytes.len() < 4 || bytes.len() > 9 || bytes[0] != b'#' {
        return false;
    }
    bytes[1..].iter().all(|&b| b.is_ascii_hexdigit())
}

fn is_color_mix_chain(trimmed: &str) -> bool {
    // NAME ! FRACTION (! NAME ! FRACTION)*
    for (index, segment) in trimmed.split('!').enumerate() {
        let segment = segment.trim();
        if index % 2 == 0 {
            let bytes = segment.as_bytes();
            let ok = !bytes.is_empty()
                && bytes[0].is_ascii_alphabetic()
                && bytes.iter().all(|&b| b.is_ascii_alphanumeric());
            if !ok {
                return false;
            }
        } else if parse_js_number(segment).is_none() {
            return false;
        }
    }
    true
}

/// Numbers a JS `\d+(?:\.\d+)?` regex allows (no sign, no exponent).
pub(crate) fn parse_js_number(text: &str) -> Option<()> {
    let mut digits_before = 0usize;
    let mut cursor = 0usize;
    let bytes = text.as_bytes();
    while cursor < bytes.len() && bytes[cursor].is_ascii_digit() {
        digits_before += 1;
        cursor += 1;
    }
    if digits_before == 0 {
        return None;
    }
    if cursor >= bytes.len() {
        return Some(());
    }
    if bytes[cursor] != b'.' {
        return None;
    }
    cursor += 1;
    let mut digits_after = 0usize;
    while cursor < bytes.len() && bytes[cursor].is_ascii_digit() {
        digits_after += 1;
        cursor += 1;
    }
    if cursor != bytes.len() || digits_after == 0 {
        return None;
    }
    Some(())
}

#[cfg(test)]
mod option_classify_unit_tests {
    use super::*;

    #[test]
    fn kv_classification() {
        let entry = classify_option_token("fill=red!50", 3);
        let kv = entry.kv().unwrap();
        assert_eq!(kv.key, "fill");
        assert_eq!(kv.value_raw, "red!50");
        assert_eq!(kv.key_span, Span::new(3, 7));
    }

    #[test]
    fn flag_classification() {
        assert!(classify_option_token("draw", 0).flag_key().is_some());
        assert!(classify_option_token("blue!40", 0).flag_key().is_some());
        assert!(classify_option_token("->", 0).flag_key().is_some());
    }

    #[test]
    fn arrow_names_with_boundaries() {
        assert!(classify_option_token("-stealth", 0).flag_key().is_some());
        assert!(classify_option_token("arc barb", 0).flag_key().is_some());
    }

    #[test]
    fn unknown_when_no_shape() {
        assert!(matches!(classify_option_token("$1+2$", 0), OptionEntry::Unknown(_)));
    }
}
