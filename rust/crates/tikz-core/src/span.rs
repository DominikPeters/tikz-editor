//! Inclusive-exclusive span offsets into a source string.

/// A half-open `[from, to)` byte range in the source document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Span {
    /// First byte inside the span.
    pub from: usize,
    /// One past the last byte inside the span.
    pub to: usize,
}

impl Span {
    /// Build a span.
    pub fn new(from: usize, to: usize) -> Span {
        Span { from, to }
    }

    /// Slice `source` with this span.
    pub fn slice<'a>(&self, source: &'a str) -> &'a str {
        &source[self.from..self.to]
    }
}
