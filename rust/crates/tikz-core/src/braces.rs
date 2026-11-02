//! Brace-stripping helpers.
//!
//! Port of `packages/core/src/utils/braces.ts`. Works on bytes: the three
//! structural characters `{`, `}`, `\` are single ASCII bytes, and UTF-8
//! continuation bytes can never collide with them.
//!
//! ```
//! use tikz_core::braces::strip_wrapping_braces;
//! assert_eq!(strip_wrapping_braces(" { A } "), "A");
//! assert_eq!(strip_wrapping_braces("{A} {B}"), "{A} {B}");
//! assert_eq!(strip_wrapping_braces("{{A}}"), "A");
//! ```

/// True when the raw text consists of exactly one balanced brace group.
pub fn is_wrapped_by_single_brace_pair(raw: &str) -> bool {
    let bytes = raw.as_bytes();
    let mut depth: i64 = 0;
    let mut index = 0usize;
    while index < bytes.len() {
        let byte = bytes[index];
        if byte == b'\\' {
            // Skip the escaped character too.
            index += 2;
            continue;
        }
        if byte == b'{' {
            depth += 1;
            index += 1;
            continue;
        }
        if byte == b'}' {
            depth -= 1;
            if depth == 0 && index != bytes.len() - 1 {
                return false;
            }
            if depth < 0 {
                return false;
            }
            index += 1;
            continue;
        }
        index += 1;
    }
    depth == 0
}

/// Trim and peel matching outer `{…}` pairs, repeatedly, until the value no
/// longer starts and ends with a single balanced brace pair.
pub fn strip_wrapping_braces(value_raw: &str) -> &str {
    let mut value = value_raw.trim();
    while value.starts_with('{')
        && value.ends_with('}')
        && is_wrapped_by_single_brace_pair(value)
    {
        value = value[1..value.len() - 1].trim();
    }
    value
}
