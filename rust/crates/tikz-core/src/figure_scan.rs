//! Scan TeX source for TikZ picture environments.
//!
//! Port of `packages/core/src/parser/figure-scan.ts`. Byte-based on the same
//! ASCII structural characters.
//!
//! ```
//! use tikz_core::figure_scan::scan_tikz_figures;
//! let figures = scan_tikz_figures("\\begin{tikzpicture}\\end{tikzpicture}");
//! assert_eq!(figures.len(), 1);
//! assert_eq!(figures[0].environment, "tikzpicture");
//! assert!(!figures[0].is_template);
//! ```

use crate::span::Span;
use crate::tex_lex::*;

/// Environments that are a TikZ picture.
pub const TIKZ_PICTURE_ENVIRONMENTS: [&str; 3] = ["tikzpicture", "tikzpicture*", "tikzlayer"];

/// One scanned TikZ picture region.
#[derive(Debug, Clone, PartialEq)]
pub struct ScannedFigure {
    /// Span of the whole environment (begin token through end token).
    pub span: Span,
    /// Environment body, e.g. `tikzpicture`.
    pub environment: String,
    /// Span of the `\begin{…}` token including braces.
    pub begin_span: Span,
    /// Span of the `\end{…}` token including braces.
    pub end_span: Span,
    /// True when the body is an unexpanded macro template.
    pub is_template: bool,
}

struct FigCursor {
    name: String,
    span: Span,
}

/// Scan the full document source; collection order matches the legacy scan.
pub fn scan_tikz_figures(source: &str) -> Vec<ScannedFigure> {
    struct PendingCandidate {
        base: ScannedFigure,
        contains_unresolved_placeholder: bool,
    }

    let bytes = source.as_bytes();
    let mut candidates: Vec<PendingCandidate> = Vec::new();
    let mut has_placeholder_candidate = false;
    let mut cursor = 0usize;
    let mut begin: Option<FigCursor> = None;

    while cursor < bytes.len() {
        if bytes[cursor] == b'%' {
            cursor = skip_tex_comment(source, cursor);
            continue;
        }
        let Some(command) = read_tex_control_sequence(source, cursor) else {
            // Advance one character (byte) - multibyte chars are inert here.
            cursor += 1;
            continue;
        };
        cursor = command.span.to;
        if let Some(verbatim_end) = skip_tex_verbatim(source, &command, false) {
            cursor = verbatim_end;
            continue;
        }
        let Some(environment) = read_tex_environment_delimiter(source, command.span.from, false) else {
            continue;
        };
        cursor = environment.span.to;
        if !TIKZ_PICTURE_ENVIRONMENTS.contains(&environment.name.as_str()) {
            continue;
        }
        match environment.kind {
            TexEnvironmentKind::Begin => {
                // Preserve the existing recovery boundary for malformed nested pictures.
                begin.get_or_insert(FigCursor { name: environment.name.clone(), span: environment.span });
            }
            TexEnvironmentKind::End => {
                let Some(begin_fig) = &begin else { continue };
                if environment.name != begin_fig.name {
                    continue;
                }
                let inner = source[begin_fig.span.to..environment.span.from].to_string();
                let contains_unresolved_placeholder = contains_unresolved_macro_placeholder(&inner);
                has_placeholder_candidate |= contains_unresolved_placeholder;

                candidates.push(PendingCandidate {
                    base: ScannedFigure {
                        span: Span::new(begin_fig.span.from, environment.span.to),
                        environment: begin_fig.name.clone(),
                        begin_span: begin_fig.span,
                        end_span: environment.span,
                        is_template: false,
                    },
                    contains_unresolved_placeholder,
                });
                begin = None;
            }
        }
    }

    let maybe_macro_spans = if has_placeholder_candidate {
        Some(collect_macro_definition_body_spans(source))
    } else {
        None
    };

    candidates
        .into_iter()
        .map(|pending| {
            let mut base = pending.base;
            base.is_template = pending.contains_unresolved_placeholder
                && maybe_macro_spans.as_deref().is_some_and(|spans| {
                    is_inside_any_span(base.begin_span.from, spans)
                });
            base
        })
        .collect()
}

fn collect_macro_definition_body_spans(source: &str) -> Vec<Span> {
    let bytes = source.as_bytes();
    let mut spans: Vec<Span> = Vec::new();
    let mut cursor = 0usize;

    while cursor < bytes.len() {
        if bytes[cursor] == b'%' {
            cursor = skip_tex_comment(source, cursor);
            continue;
        }
        if bytes[cursor] != b'\\' {
            cursor += 1;
            continue;
        }
        let Some(command) = read_tex_control_sequence(source, cursor) else {
            cursor += 1;
            continue;
        };
        cursor = command.span.to;

        if command.raw == "\\def" {
            if let Some(body) = try_read_def_body_span(source, command.span.to) {
                spans.push(body);
                cursor = body.to + 1;
            }
            continue;
        }

        if matches!(
            command.raw.as_str(),
            "\\newcommand" | "\\renewcommand" | "\\providecommand" | "\\DeclareRobustCommand" | "\\DeclareMathOperator"
        ) {
            if let Some(body) = try_read_new_command_body_span(source, command.span.to) {
                spans.push(body);
                cursor = body.to + 1;
            }
            continue;
        }
    }

    spans
}

fn contains_unresolved_macro_placeholder(source: &str) -> bool {
    let bytes = source.as_bytes();
    let mut cursor = 0usize;
    while cursor < bytes.len() {
        let byte = bytes[cursor];
        if byte == b'%' {
            cursor = skip_tex_comment(source, cursor);
            continue;
        }
        if byte == b'\\' {
            cursor = bytes.len().min(cursor + 2);
            continue;
        }
        if byte == b'#' {
            match bytes.get(cursor + 1) {
                Some(&b'#') => {
                    cursor += 2;
                    continue;
                }
                Some(&next) if next.is_ascii_digit() => return true,
                _ => {}
            }
        }
        cursor += 1;
    }
    false
}

fn try_read_def_body_span(source: &str, from_cursor: usize) -> Option<Span> {
    let bytes = source.as_bytes();
    let mut cursor = skip_tex_whitespace_and_comments(source, from_cursor, bytes.len());
    let name = read_tex_control_sequence(source, cursor)?;
    cursor = name.span.to;

    while cursor < bytes.len() {
        cursor = skip_tex_whitespace_and_comments(source, cursor, bytes.len());
        if cursor >= bytes.len() {
            break;
        }
        match bytes[cursor] {
            b'{' => {
                let group = read_tex_balanced_delimited(source, cursor, b'{', b'}', bytes.len())?;
                return Some(Span::new(group.from + 1, group.to - 1));
            }
            b'\\' => {
                let control = read_tex_control_sequence(source, cursor)?;
                cursor = control.span.to;
            }
            _ => cursor += 1,
        }
    }
    None
}

fn try_read_new_command_body_span(source: &str, from_cursor: usize) -> Option<Span> {
    let bytes = source.as_bytes();
    let mut cursor = skip_tex_whitespace_and_comments(source, from_cursor, bytes.len());
    if bytes.get(cursor) == Some(&b'*') {
        cursor += 1;
    }
    cursor = skip_tex_whitespace_and_comments(source, cursor, bytes.len());

    if let Some(direct_name) = read_tex_control_sequence(source, cursor) {
        cursor = direct_name.span.to;
    } else {
        let name_group = read_tex_balanced_delimited(source, cursor, b'{', b'}', bytes.len())?;
        cursor = name_group.to;
    }

    cursor = skip_tex_whitespace_and_comments(source, cursor, bytes.len());
    if let Some(arity_group) = read_tex_balanced_delimited(source, cursor, b'[', b']', bytes.len()) {
        cursor = arity_group.to;
    }

    cursor = skip_tex_whitespace_and_comments(source, cursor, bytes.len());
    if let Some(optional_group) = read_tex_balanced_delimited(source, cursor, b'[', b']', bytes.len()) {
        cursor = optional_group.to;
    }

    cursor = skip_tex_whitespace_and_comments(source, cursor, bytes.len());
    let body = read_tex_balanced_delimited(source, cursor, b'{', b'}', bytes.len())?;
    Some(Span::new(body.from + 1, body.to - 1))
}

fn is_inside_any_span(offset: usize, spans: &[Span]) -> bool {
    spans.iter().any(|span| offset >= span.from && offset <= span.to)
}
