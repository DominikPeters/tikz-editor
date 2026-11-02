//! Macro-definition statement mapping.
//!
//! Port of the `mapMacroDefinitionStatement`,
//! `mapMacroAliasStatement`, `mapMacroCommandDefinitionStatement`, and
//! `mapPgfMathStatement` mappers in
//! `packages/core/src/domains/statements/parse.ts`. The statement scanner
//! resolves the child node spans (direct children, deep lookups, and the
//! last-`Group` body scan) and hands them in as plain byte spans.
//!
//! All offsets below are byte offsets, matching the legacy probe outputs.
//!
//! ```
//! use tikz_core::region::to_group_inner_span;
//! use tikz_core::span::Span;
//! use tikz_core::stmt_macro::map_macro_definition;
//! let source = "\\def \\foo {hello }";
//! let stmt = map_macro_definition(
//!     source,
//!     Span::new(0, 18),
//!     Some(Span::new(5, 9)),
//!     Some(Span::new(10, 18)),
//!     "macro-definition:0".to_string(),
//! );
//! assert_eq!(stmt.name_raw, "\\foo");
//! assert_eq!(stmt.value_raw, "hello ");
//! assert_eq!(stmt.value_span, Some(to_group_inner_span(Span::new(10, 18), source)));
//! ```

use crate::ast::{
    MacroAliasStatement, MacroCommandDefinitionStatement, MacroDefinitionStatement, PgfMathStatement,
};
use crate::region::{extract_group_inner_raw, to_bracket_inner_span, to_group_inner_span};
use crate::span::Span;

/// Map one `\def` statement.
///
/// `name` is the direct `CommandName` child span; `value_group` is the full
/// `Group` child span (braces included, inner offsets are derived here).
pub fn map_macro_definition(
    source: &str,
    stmt_span: Span,
    name: Option<Span>,
    value_group: Option<Span>,
    id: String,
) -> MacroDefinitionStatement {
    let (value_raw, value_span) = match value_group {
        Some(group) => {
            let inner = to_group_inner_span(group, source);
            (scalar(&source[inner.from..inner.to]), Some(inner))
        }
        None => (default_empty(), None),
    };
    MacroDefinitionStatement {
        id,
        span: stmt_span,
        raw: scalar(&source[stmt_span.from.min(source.len())..stmt_span.to]),
        command_raw: scalar("\\def"),
        name_raw: match name {
            Some(node) => scalar(&source[node.from..node.to]),
            None => default_empty(),
        },
        name_span: name,
        value_raw,
        value_span,
    }
}

/// Target kind of a `\let` alias statement.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AliasTargetSource {
    /// `\let \a = \b` - the target `CommandName` node span.
    Command(Span),
    /// `\let \a = {\b}` - the full target `Group` node span.
    Group(Span),
}

/// Map one `\let` statement.
///
/// `name` is the direct `CommandName` child span and `target` the selected
/// target node state (the legacy mapper resolves `LetAliasTarget` →
/// `CommandName` or `Group` itself, either may qualify).
pub fn map_macro_alias(
    source: &str,
    stmt_span: Span,
    name: Option<Span>,
    target: Option<AliasTargetSource>,
    id: String,
) -> MacroAliasStatement {
    let (target_raw, target_span) = match target {
        Some(AliasTargetSource::Command(node)) => {
            (scalar(&source[node.from..node.to]), Some(node))
        }
        Some(AliasTargetSource::Group(node)) => {
            let inner = to_group_inner_span(node, source);
            (scalar(&source[inner.from..inner.to]), Some(inner))
        }
        None => (default_empty(), None),
    };
    MacroAliasStatement {
        id,
        span: stmt_span,
        raw: scalar(&source[stmt_span.from.min(source.len())..stmt_span.to]),
        command_raw: scalar("\\let"),
        name_raw: match name {
            Some(node) => scalar(&source[node.from..node.to]),
            None => default_empty(),
        },
        name_span: name,
        target_raw,
        target_span,
    }
}

/// A name match scanned out of a braced macro name.
struct GroupNameMatch {
    raw: String,
    span: Span,
}

/// All child node spans a `\newcommand`-family mapper needs.
#[derive(Debug, Clone, Copy, Default)]
pub struct MacroCommandParts {
    /// `NewCommandCmd` node span.
    pub newcommand: Option<Span>,
    /// `RenewCommandCmd` node span.
    pub renewcommand: Option<Span>,
    /// `ProvideCommandCmd` node span.
    pub providecommand: Option<Span>,
    /// `DeclareRobustCommandCmd` node span.
    pub declare_robust: Option<Span>,
    /// `DeclareMathOperatorCmd` node span.
    pub declare_operator: Option<Span>,
    /// `CommandName` inside `MacroCommandName`.
    pub name_token: Option<Span>,
    /// `Group` inside `MacroCommandName`.
    pub name_group: Option<Span>,
    /// `Number` inside `MacroCommandArity`.
    pub number: Option<Span>,
    /// Full `MacroCommandDefaultArg` span (brackets included).
    pub default_arg: Option<Span>,
    /// Full span of the last direct `Group` child (body node).
    pub body_group: Option<Span>,
}

/// Map one `\newcommand` / `\renewcommand` / `\providecommand` /
/// `\DeclareRobustCommand` / `\DeclareMathOperator` statement.
pub fn map_macro_command_definition(
    source: &str,
    stmt_span: Span,
    parts: MacroCommandParts,
    id: String,
) -> MacroCommandDefinitionStatement {
    let MacroCommandParts {
        newcommand,
        renewcommand,
        providecommand,
        declare_robust,
        declare_operator,
        name_token,
        name_group,
        number,
        default_arg,
        body_group,
    } = parts;

    // Legacy keeps two separate resolutions: `commandNode` prefers
    // `\newcommand`, the emitted `commandRaw` prefers `\DeclareMathOperator`.
    let command_node = newcommand
        .or(renewcommand)
        .or(providecommand)
        .or(declare_robust)
        .or(declare_operator);
    let command_raw = if declare_operator.is_some() {
        "\\DeclareMathOperator"
    } else if declare_robust.is_some() {
        "\\DeclareRobustCommand"
    } else if providecommand.is_some() {
        "\\providecommand"
    } else if renewcommand.is_some() {
        "\\renewcommand"
    } else {
        "\\newcommand"
    };

    let name_node = name_token.or(name_group);
    let (name_raw, name_span) = match name_token {
        Some(token) => (scalar(&source[token.from..token.to]), Some(token)),
        None => match name_group.and_then(|group| scan_group_command_name(group, source)) {
            Some(hit) => (hit.raw, Some(hit.span)),
            None => (default_empty(), None),
        },
    };

    let arity_raw = number
        .map(|node| &source[node.from..node.to])
        .unwrap_or("");
    // Legacy clamps with `Math.max(0, …)`: negative parse results become 0.
    let arity = parse_js_int(arity_raw).map_or(0, |value| value.max(0));

    let (optional_default_raw, optional_default_span) = match default_arg {
        Some(node) => {
            let inner = to_bracket_inner_span(node, source);
            (Some(scalar(&source[inner.from..inner.to])), Some(inner))
        }
        None => (None, None),
    };

    let body_inner = body_group.map(|node| to_group_inner_span(node, source));
    let starred = match (command_node, name_node) {
        (Some(cmd), Some(name)) => {
            let zone = if name.from >= cmd.to {
                &source[cmd.to..name.from]
            } else {
                ""
            };
            zone.contains('*')
        }
        _ => false,
    };

    let body_raw = match body_inner {
        Some(inner) if command_raw == "\\DeclareMathOperator" => {
            declare_operator_body(&source[inner.from..inner.to], starred)
        }
        Some(inner) => scalar(&source[inner.from..inner.to]),
        None if command_raw == "\\DeclareMathOperator" => declare_operator_body("", starred),
        None => default_empty(),
    };

    MacroCommandDefinitionStatement {
        id,
        span: stmt_span,
        raw: scalar(&source[stmt_span.from.min(source.len())..stmt_span.to]),
        command_raw: scalar(command_raw),
        name_raw,
        name_span,
        arity,
        arity_span: number,
        optional_default_raw,
        optional_default_span,
        body_raw,
        body_span: body_inner,
        starred,
    }
}

/// Build the `\operatorname…{…}` body text legacy emits for
/// `\DeclareMathOperator`: a star-suffixed or plain `\operatorname`
/// wrapping the inner text of the last group in braces.
fn declare_operator_body(inner: &str, starred: bool) -> String {
    format!(
        "{}{{{inner}}}",
        if starred { "\\operatorname*" } else { "\\operatorname" }
    )
}

/// Scan `\name` inside the bare inner text of a macro-name group.
///
/// Mirrors the legacy regex `/\\[A-Za-z@]+/.exec(innerRaw)`: the leftmost
/// backslash that has at least one following letter (or `@`) wins.
fn scan_group_command_name(group: Span, source: &str) -> Option<GroupNameMatch> {
    let inner = to_group_inner_span(group, source);
    let inner_raw = &source[inner.from..inner.to];
    let bytes = inner_raw.as_bytes();
    for (start, &byte) in bytes.iter().enumerate() {
        if byte != b'\\' {
            continue;
        }
        let mut end = start + 1;
        while end < bytes.len()
            && (bytes[end].is_ascii_alphabetic() || bytes[end] == b'@')
        {
            end += 1;
        }
        if end > start + 1 {
            return Some(GroupNameMatch {
                raw: scalar(&inner_raw[start..end]),
                span: Span::new(inner.from + start, inner.from + end),
            });
        }
    }
    None
}

/// Parse an integer the way JS `parseInt(value, 10)` does: optional sign and
/// leading digits, stopping at the first other character.
fn parse_js_int(raw: &str) -> Option<i64> {
    let bytes = raw.trim_start().as_bytes();
    let mut idx = usize::from(matches!(bytes.first(), Some(b'+') | Some(b'-')));
    let negative = matches!(bytes.first(), Some(b'-'));
    let mut value: i64 = 0;
    let mut any = false;
    while let Some(&byte) = bytes.get(idx) {
        if !byte.is_ascii_digit() {
            break;
        }
        any = true;
        value = value.saturating_mul(10).saturating_add((byte - b'0') as i64);
        idx += 1;
    }
    if !any {
        return None;
    }
    Some(if negative { -value } else { value })
}

/// Clone a plain `&str` into an owned `String` (the fuzzer-visible copy).
fn scalar(raw: &str) -> String {
    raw.to_string()
}

/// A legacy-empty string.
fn default_empty() -> String {
    String::new()
}

/// Statement mapping for `\pgfmath…` assignments.
#[derive(Debug, Clone, Default)]
pub struct PgfMathParts {
    /// Selected command node span (`setmacro` → `parse` → `setseed`).
    pub command: Option<Span>,
    /// Direct `Group` children in order.
    pub groups: Vec<Span>,
}

/// Map one `\pgfmathsetmacro` / `\pgfmathparse` / `\pgfmathsetseed`
/// statement.
pub fn map_pgf_math(
    source: &str,
    stmt_span: Span,
    parts: PgfMathParts,
    id: String,
) -> PgfMathStatement {
    let raw_command = parts
        .command
        .map(|node| scalar(&source[node.from..node.to]))
        .unwrap_or_else(|| "\\pgfmathparse".to_string());
    let command_raw = if raw_command == "\\pgfmathsetmacro"
        || raw_command == "\\pgfmathsetseed"
    {
        raw_command
    } else {
        "\\pgfmathparse".to_string()
    };
    let args_raw = parts
        .groups
        .iter()
        .map(|group| extract_group_inner_raw(*group, source))
        .collect();
    let args_span = parts
        .groups
        .iter()
        .map(|group| to_group_inner_span(*group, source))
        .collect();
    PgfMathStatement {
        id,
        span: stmt_span,
        raw: scalar(&source[stmt_span.from.min(source.len())..stmt_span.to]),
        command_raw,
        args_raw,
        args_span,
    }
}

#[cfg(test)]
mod stmt_macro_unit_tests {
    use super::*;

    #[test]
    fn map_macro_definition_maps_name_and_value() {
        let source = "\\def \\foo {hello }";
        let stmt = map_macro_definition(
            source,
            Span::new(0, 18),
            Some(Span::new(5, 9)),
            Some(Span::new(10, 18)),
            "macro-definition:0".to_string(),
        );
        assert_eq!(stmt.id, "macro-definition:0");
        assert_eq!(stmt.span, Span::new(0, 18));
        assert_eq!(stmt.raw, "\\def \\foo {hello }");
        assert_eq!(stmt.command_raw, "\\def");
        assert_eq!(stmt.name_raw, "\\foo");
        assert_eq!(stmt.name_span, Some(Span::new(5, 9)));
        assert_eq!(stmt.value_raw, "hello ");
        assert_eq!(stmt.value_span, Some(Span::new(11, 17)));
    }

    #[test]
    fn map_macro_definition_tolerates_missing_children() {
        let stmt = map_macro_definition(
            "",
            Span::new(0, 0),
            None,
            None,
            "macro-definition:1".to_string(),
        );
        assert_eq!(stmt.name_raw, "");
        assert_eq!(stmt.name_span, None);
        assert_eq!(stmt.value_raw, "");
        assert_eq!(stmt.value_span, None);
        assert_eq!(stmt.command_raw, "\\def");
    }

    #[test]
    fn map_macro_alias_maps_token_target() {
        let source = "\\let \\a = \\b";
        let stmt = map_macro_alias(
            source,
            Span::new(0, 12),
            Some(Span::new(5, 7)),
            Some(AliasTargetSource::Command(Span::new(10, 12))),
            "macro-alias:0".to_string(),
        );
        assert_eq!(stmt.command_raw, "\\let");
        assert_eq!(stmt.name_raw, "\\a");
        assert_eq!(stmt.name_span, Some(Span::new(5, 7)));
        assert_eq!(stmt.target_raw, "\\b");
        assert_eq!(stmt.target_span, Some(Span::new(10, 12)));
    }

    #[test]
    fn map_macro_alias_maps_group_target() {
        let source = "\\let \\a = {\\b}";
        let stmt = map_macro_alias(
            source,
            Span::new(0, 14),
            Some(Span::new(5, 7)),
            Some(AliasTargetSource::Group(Span::new(10, 14))),
            "macro-alias:1".to_string(),
        );
        assert_eq!(stmt.target_raw, "\\b");
        assert_eq!(stmt.target_span, Some(Span::new(11, 13)));
    }

    #[test]
    fn macro_command_basic_pins_probe_offsets() {
        let source = "\\newcommand{\\foo}[2][x]{y}";
        let stmt = map_macro_command_definition(
            source,
            Span::new(0, 26),
            MacroCommandParts {
                newcommand: Some(Span::new(0, 11)),
                name_group: Some(Span::new(11, 17)),
                number: Some(Span::new(18, 19)),
                default_arg: Some(Span::new(20, 23)),
                body_group: Some(Span::new(23, 26)),
                ..MacroCommandParts::default()
            },
            "macro-command-definition:0".to_string(),
        );
        assert_eq!(stmt.command_raw, "\\newcommand");
        assert_eq!(stmt.name_raw, "\\foo");
        assert_eq!(stmt.name_span, Some(Span::new(12, 16)));
        assert_eq!(stmt.arity, 2);
        assert_eq!(stmt.arity_span, Some(Span::new(18, 19)));
        assert_eq!(stmt.optional_default_raw, Some("x".to_string()));
        assert_eq!(stmt.optional_default_span, Some(Span::new(21, 22)));
        assert_eq!(stmt.body_raw, "y");
        assert_eq!(stmt.body_span, Some(Span::new(24, 25)));
        assert!(!stmt.starred);
    }

    #[test]
    fn macro_command_without_name_pointer() {
        let source = "\\newcommand{no cmd}{y}";
        let stmt = map_macro_command_definition(
            source,
            Span::new(0, 22),
            MacroCommandParts {
                newcommand: Some(Span::new(0, 11)),
                name_group: Some(Span::new(11, 19)),
                body_group: Some(Span::new(19, 22)),
                ..MacroCommandParts::default()
            },
            "macro-command-definition:1".to_string(),
        );
        assert_eq!(stmt.name_raw, "");
        assert_eq!(stmt.name_span, None);
        assert_eq!(stmt.body_raw, "y");
        assert_eq!(stmt.body_span, Some(Span::new(20, 21)));
        assert_eq!(stmt.arity, 0);
    }

    #[test]
    fn macro_command_scans_name_from_group() {
        let source = "\\newcommand{some\\bar}{body}";
        let stmt = map_macro_command_definition(
            source,
            Span::new(0, 27),
            MacroCommandParts {
                newcommand: Some(Span::new(0, 11)),
                name_group: Some(Span::new(11, 21)),
                body_group: Some(Span::new(21, 27)),
                ..MacroCommandParts::default()
            },
            "macro-command-definition:2".to_string(),
        );
        assert_eq!(stmt.name_raw, "\\bar");
        assert_eq!(stmt.name_span, Some(Span::new(16, 20)));
        assert_eq!(stmt.body_raw, "body");
        assert_eq!(stmt.body_span, Some(Span::new(22, 26)));
    }

    #[test]
    fn macro_command_starred_token() {
        let source = "\\newcommand*\\bar{y}";
        let stmt = map_macro_command_definition(
            source,
            Span::new(0, 19),
            MacroCommandParts {
                newcommand: Some(Span::new(0, 11)),
                name_token: Some(Span::new(12, 16)),
                body_group: Some(Span::new(16, 19)),
                ..MacroCommandParts::default()
            },
            "macro-command-definition:3".to_string(),
        );
        assert_eq!(stmt.name_raw, "\\bar");
        assert_eq!(stmt.name_span, Some(Span::new(12, 16)));
        assert!(stmt.starred);
        assert_eq!(stmt.body_raw, "y");
        assert_eq!(stmt.body_span, Some(Span::new(17, 18)));
    }

    #[test]
    fn declare_math_operator_starred_pins_probe_offsets() {
        let source = "\\DeclareMathOperator*{\\foo}{x y}";
        let stmt = map_macro_command_definition(
            source,
            Span::new(0, 32),
            MacroCommandParts {
                declare_operator: Some(Span::new(0, 20)),
                name_group: Some(Span::new(21, 27)),
                body_group: Some(Span::new(27, 32)),
                ..MacroCommandParts::default()
            },
            "macro-command-definition:4".to_string(),
        );
        // The star sits between the command token and the name node.
        assert_eq!(stmt.command_raw, "\\DeclareMathOperator");
        assert!(stmt.starred);
        assert_eq!(stmt.name_raw, "\\foo");
        assert_eq!(stmt.name_span, Some(Span::new(22, 26)));
        assert_eq!(stmt.body_raw, "\\operatorname*{x y}");
        assert_eq!(stmt.body_span, Some(Span::new(28, 31)));
    }

    #[test]
    fn declare_math_operator_unstarred() {
        let source = "\\DeclareMathOperator{\\foo}{x}";
        let stmt = map_macro_command_definition(
            source,
            Span::new(0, 29),
            MacroCommandParts {
                declare_operator: Some(Span::new(0, 20)),
                name_group: Some(Span::new(20, 26)),
                body_group: Some(Span::new(26, 29)),
                ..MacroCommandParts::default()
            },
            "macro-command-definition:5".to_string(),
        );
        assert!(!stmt.starred);
        assert_eq!(stmt.body_raw, "\\operatorname{x}");
        assert_eq!(stmt.body_span, Some(Span::new(27, 28)));
    }

    #[test]
    fn dual_priority_newcommand_and_declare_operator() {
        // Handcrafted: both tokens supplied. `commandRaw` prefers
        // `\DeclareMathOperator` while the star slice reads from the
        // `\newcommand` token, so the star still registers.
        let source = "\\newcommand*{\\foo}{y}";
        let stmt = map_macro_command_definition(
            source,
            Span::new(0, 21),
            MacroCommandParts {
                newcommand: Some(Span::new(0, 11)),
                declare_operator: Some(Span::new(0, 4)),
                name_group: Some(Span::new(12, 18)),
                body_group: Some(Span::new(18, 21)),
                ..MacroCommandParts::default()
            },
            "macro-command-definition:6".to_string(),
        );
        assert_eq!(stmt.command_raw, "\\DeclareMathOperator");
        assert!(stmt.starred);
        assert_eq!(stmt.name_raw, "\\foo");
        assert_eq!(stmt.name_span, Some(Span::new(13, 17)));
        assert_eq!(stmt.body_raw, "\\operatorname*{y}");
        assert_eq!(stmt.body_span, Some(Span::new(19, 20)));
    }

    #[test]
    fn declare_math_operator_body_group_may_reuse_name_group() {
        // No dedicated body group: the last direct `Group` child *is* the
        // name group; the scanner reports the same span.
        let source = "\\DeclareMathOperator*{\\foo}";
        let stmt = map_macro_command_definition(
            source,
            Span::new(0, 27),
            MacroCommandParts {
                declare_operator: Some(Span::new(0, 20)),
                name_group: Some(Span::new(21, 27)),
                body_group: Some(Span::new(21, 27)),
                ..MacroCommandParts::default()
            },
            "macro-command-definition:7".to_string(),
        );
        assert!(stmt.starred);
        assert_eq!(stmt.name_raw, "\\foo");
        assert_eq!(stmt.name_span, Some(Span::new(22, 26)));
        assert_eq!(stmt.body_raw, "\\operatorname*{\\foo}");
        assert_eq!(stmt.body_span, Some(Span::new(22, 26)));
    }

    #[test]
    fn pgf_math_set_macro_pins_probe_offsets() {
        let source = "\\pgfmathsetmacro{\\a}{1+2}";
        let stmt = map_pgf_math(
            source,
            Span::new(0, 25),
            PgfMathParts {
                command: Some(Span::new(0, 16)),
                groups: vec![Span::new(16, 20), Span::new(20, 25)],
            },
            "pgfmath:0".to_string(),
        );
        assert_eq!(stmt.command_raw, "\\pgfmathsetmacro");
        assert_eq!(stmt.args_raw, vec!["\\a".to_string(), "1+2".to_string()]);
        assert_eq!(
            stmt.args_span,
            vec![Span::new(17, 19), Span::new(21, 24)]
        );
        assert_eq!(stmt.raw, source);
        assert_eq!(stmt.span, Span::new(0, 25));
    }

    #[test]
    fn pgf_math_set_seed_and_parse() {
        let seed = map_pgf_math(
            "\\pgfmathsetseed{42}",
            Span::new(0, 19),
            PgfMathParts {
                command: Some(Span::new(0, 15)),
                groups: vec![Span::new(15, 19)],
            },
            "pgfmath:1".to_string(),
        );
        assert_eq!(seed.command_raw, "\\pgfmathsetseed");
        assert_eq!(seed.args_raw, vec!["42".to_string()]);
        assert_eq!(seed.args_span, vec![Span::new(16, 18)]);

        let parse = map_pgf_math(
            "\\pgfmathparse{sin(1)}",
            Span::new(0, 21),
            PgfMathParts {
                command: Some(Span::new(0, 13)),
                groups: vec![Span::new(13, 21)],
            },
            "pgfmath:2".to_string(),
        );
        assert_eq!(parse.command_raw, "\\pgfmathparse");
        assert_eq!(parse.args_raw, vec!["sin(1)".to_string()]);
        assert_eq!(parse.args_span, vec![Span::new(14, 20)]);
    }

    #[test]
    fn pgf_math_without_command_falls_back_to_parse() {
        let stmt = map_pgf_math(
            "",
            Span::new(0, 0),
            PgfMathParts::default(),
            "pgfmath:3".to_string(),
        );
        assert_eq!(stmt.command_raw, "\\pgfmathparse");
        assert!(stmt.args_raw.is_empty());
        assert!(stmt.args_span.is_empty());
    }
}
