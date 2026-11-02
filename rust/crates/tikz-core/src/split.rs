//! Top-level splitting helpers shared by option lists and path parsing.
//!
//! All depth-tracking characters (`\`, `( )`, `{ }`, `[ ]`) are single ASCII
//! bytes, so byte offsets preserve character order and mirror the legacy
//! code-unit offsets.
//!
//! ```
//! use tikz_core::split::split_top_level_with_ranges;
//! let parts = split_top_level_with_ranges("draw, (a,b), {x,y}", b',');
//! assert_eq!(parts.len(), 3);
//! assert_eq!(parts[1].value, " (a,b)");
//! assert_eq!(parts[1].from, 5);
//! ```

/// Part of a top-level split with the index range it covered.
#[derive(Debug, Clone, PartialEq)]
pub struct SplitPart {
    /// Split result text.
    pub value: String,
    /// Start offset within `input`.
    pub from: usize,
    /// End offset within `input`.
    pub to: usize,
}

/// Depth counter trio used by the top-level scanners.
struct Depths {
    paren: i64,
    brace: i64,
    bracket: i64,
}

impl Depths {
    fn new() -> Self {
        Self { paren: 0, brace: 0, bracket: 0 }
    }

    fn open(&mut self, byte: u8) {
        match byte {
            b'(' => self.paren += 1,
            b'{' => self.brace += 1,
            b'[' if self.brace == 0 => self.bracket += 1,
            _ => {}
        }
    }

    fn close(&mut self, byte: u8) {
        match byte {
            b')' => self.paren = (self.paren - 1).max(0),
            b'}' => self.brace = (self.brace - 1).max(0),
            b']' if self.brace == 0 => self.bracket = (self.bracket - 1).max(0),
            _ => {}
        }
    }

    fn at_top(&self) -> bool {
        self.paren == 0 && self.brace == 0 && self.bracket == 0
    }
}

/// Split on `separator` at top depth, skipping escapes and comments.
pub fn split_top_level_with_ranges(input: &str, separator: u8) -> Vec<SplitPart> {
    let bytes = input.as_bytes();
    let mut ranges: Vec<SplitPart> = Vec::new();
    let mut depths = Depths::new();
    let mut cursor = 0usize;

    let mut i = 0usize;
    while i < bytes.len() {
        let byte = bytes[i];
        if byte == b'\\' {
            i += 2;
            continue;
        }
        if byte == b'(' || byte == b'{' || byte == b'[' {
            depths.open(byte);
        } else if byte == b')' || byte == b'}' || byte == b']' {
            depths.close(byte);
        }
        if byte == separator && depths.at_top() {
            ranges.push(SplitPart { value: input[cursor..i].to_string(), from: cursor, to: i });
            cursor = i + 1;
        }
        i += 1;
    }
    ranges.push(SplitPart { value: input[cursor..].to_string(), from: cursor, to: bytes.len() });
    ranges
}

/// Index of the first `separator` at top depth, or `None`.
pub fn find_top_level_separator(input: &str, separator: u8) -> Option<usize> {
    let bytes = input.as_bytes();
    let mut depths = Depths::new();

    let mut i = 0usize;
    while i < bytes.len() {
        let byte = bytes[i];
        if byte == b'\\' {
            i += 2;
            continue;
        }
        if byte == b'(' || byte == b'{' || byte == b'[' {
            depths.open(byte);
        } else if byte == b')' || byte == b'}' || byte == b']' {
            depths.close(byte);
        }
        if byte == separator && depths.at_top() {
            return Some(i);
        }
        i += 1;
    }
    None
}

/// Trim ASCII whitespace of a token and return its inner bounds.
///
/// Returns `None` when the token trims to empty.
pub fn trim_local_bounds(value: &str) -> Option<(usize, usize)> {
    let bytes = value.as_bytes();
    let mut from = 0usize;
    while from < bytes.len() && bytes[from].is_ascii_whitespace() {
        from += 1;
    }
    let mut to = bytes.len();
    while to > from && bytes[to - 1].is_ascii_whitespace() {
        to -= 1;
    }
    if to <= from {
        return None;
    }
    Some((from, to))
}

#[cfg(test)]
mod split_unit_tests {
    use super::*;

    #[test]
    fn skips_nested_separators() {
        let parts = split_top_level_with_ranges("a={1,2}, b", b',');
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].value, "a={1,2}");
        assert_eq!(parts[1].value, " b");
    }

    #[test]
    fn brackets_below_braces_are_plain() {
        // `[` only counts while `{}` depth is zero, so `x={[a,b]}` stays whole.
        let parts = split_top_level_with_ranges("x={[p,f=]!}, y", b',');
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0].value, "x={[p,f=]!}");
    }

    #[test]
    fn separator_search_respects_depth() {
        // `k(a=b)` has no top-level `=`.
        assert_eq!(find_top_level_separator("k(a=b)", b'='), None);
        // The `=` at 3 sits inside parentheses; the first top-level one is 6.
        assert_eq!(find_top_level_separator("k(a=b)=c", b'='), Some(6));
    }

    #[test]
    fn trim_bounds_are_inner() {
        let bounds = trim_local_bounds("  ab  ").unwrap();
        assert_eq!(bounds, (2, 4));
        assert_eq!(trim_local_bounds("   "), None);
    }
}
