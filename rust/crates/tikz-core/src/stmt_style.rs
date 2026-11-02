//! Style-definition statement mapping.
//!
//! Port of `mapTikzSetStatement`, `mapTikzStyleStatement`,
//! `mapPgfkeysStatement`, `mapTikzLibraryStatement`,
//! `mapColorletStatement`, and `mapDefineColorStatement` in
//! `packages/core/src/domains/statements/parse.ts`. Payload spans are the
//! *full node spans* (wrapping braces or brackets included), and option
//! lists re-anchor offsets with the legacy `parseStyleValueAsOptionList`
//! glue.
//!
//! All offsets below are byte offsets into the source, exactly matching the
//! legacy probe outputs.
//!
//! ```
//! use tikz_core::span::Span;
//! use tikz_core::stmt_style::map_tikz_set;
//! let stmt = map_tikz_set(
//!     "\\tikzset{fill=red}",
//!     Span::new(0, 18),
//!     Some(Span::new(8, 18)),
//!     "tikz-set:0".to_string(),
//! );
//! assert_eq!(stmt.payload_raw, "{fill=red}");
//! assert_eq!(stmt.payload_span, Some(Span::new(8, 18)));
//! assert_eq!(stmt.option_list.raw, "[fill=red]");
//! let entry = stmt.option_list.entries[0].kv().expect("kv entry");
//! assert_eq!(entry.key, "fill");
//! assert_eq!(entry.value_raw, "red");
//! ```

use crate::ast::{
    ColorletStatement, DefineColorStatement, PgfkeysStatement, StyleDefinitionKind,
    TikzLibraryStatement, TikzSetStatement, TikzStyleStatement,
};
use crate::options::{parse_option_list_raw, parse_style_value_as_option_list, OptionListAst};
use crate::region::{extract_group_inner_raw, to_group_inner_span};
use crate::span::Span;

/// Map one `\tikzset { … }` statement node.
///
/// `payload` is the direct `StylePayload` child node span (full node,
/// braces included); `None` mirrors the legacy no-child case.
pub fn map_tikz_set(
    source: &str,
    stmt_span: Span,
    payload: Option<Span>,
    id: String,
) -> TikzSetStatement {
    let (payload_raw, option_list) = style_payload_and_options(source, stmt_span, payload);
    TikzSetStatement {
        id,
        span: stmt_span,
        raw: slice_of(source, stmt_span),
        command_raw: "\\tikzset".to_string(),
        payload_raw,
        payload_span: payload,
        option_list,
    }
}

/// Map one `\pgfkeys { … }` statement node.
///
/// Same payload handling as [`map_tikz_set`]; see the module header for the
/// offset conventions.
pub fn map_pgfkeys(
    source: &str,
    stmt_span: Span,
    payload: Option<Span>,
    id: String,
) -> PgfkeysStatement {
    let (payload_raw, option_list) = style_payload_and_options(source, stmt_span, payload);
    PgfkeysStatement {
        id,
        span: stmt_span,
        raw: slice_of(source, stmt_span),
        command_raw: "\\pgfkeys".to_string(),
        payload_raw,
        payload_span: payload,
        option_list,
    }
}

/// Source node selected for the `\tikzstyle` name part.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StyleNameSource {
    /// A `Group` node (`span` includes the wrapping braces).
    Group(Span),
    /// An identifier node without braces.
    Identifier(Span),
}

impl StyleNameSource {
    /// The full node span carried by the variant.
    pub fn span(self) -> Span {
        match self {
            Self::Group(node) | Self::Identifier(node) => node,
        }
    }
}

/// Source node selected for the `\tikzstyle` payload part.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StylePayloadSource {
    /// An `OptionList` node (`[a=b]`), parsed without the brace glue.
    OptionList(Span),
    /// Any other payload node (`{…}` group), glued through
    /// [`parse_style_value_as_option_list`].
    Payload(Span),
}

impl StylePayloadSource {
    /// The full node span carried by the variant.
    pub fn span(self) -> Span {
        match self {
            Self::OptionList(node) | Self::Payload(node) => node,
        }
    }
}

/// Map one `\tikzstyle` statement node.
///
/// `cmd` is the `TikzStyleCmd` span; `name` and `payload` select between the
/// legacy `Group`/`IdentifierLike` and `OptionList`/`StylePayload` child
/// nodes. The `+`-detection reads the source text strictly between the name
/// node end and the payload node start.
pub fn map_tikz_style(
    source: &str,
    stmt_span: Span,
    cmd: Option<Span>,
    name: Option<StyleNameSource>,
    payload: Option<StylePayloadSource>,
    id: String,
) -> TikzStyleStatement {
    let name_full = name.map(|slot| slot.span());
    let (name_untrimmed, style_name_span) = match name {
        Some(StyleNameSource::Group(group)) => (
            extract_group_inner_raw(group, source),
            Some(to_group_inner_span(group, source)),
        ),
        Some(StyleNameSource::Identifier(identifier)) => {
            (slice_of(source, identifier), Some(identifier))
        }
        None => (String::new(), None),
    };
    let style_name_raw = name_untrimmed.trim().to_string();

    let (payload_span, payload_raw, option_list) = match payload {
        Some(StylePayloadSource::OptionList(list)) => {
            let raw = slice_of(source, list);
            let list_ast = parse_option_list_raw(&raw, list.from);
            (Some(list), raw, list_ast)
        }
        Some(StylePayloadSource::Payload(node)) => {
            let (raw, list) = style_payload_and_options(source, stmt_span, Some(node));
            (Some(node), raw, list)
        }
        None => {
            let (_, list) = style_payload_and_options(source, stmt_span, None);
            (None, String::new(), list)
        }
    };

    let between_raw = match (cmd, name_full, payload_span) {
        (Some(_), Some(name_node), Some(payload_node)) if payload_node.from >= name_node.to => {
            &source[name_node.to..payload_node.from]
        }
        _ => "",
    };
    let definition_kind = if between_raw.contains('+') {
        StyleDefinitionKind::Append
    } else {
        StyleDefinitionKind::Style
    };

    TikzStyleStatement {
        id,
        span: stmt_span,
        raw: slice_of(source, stmt_span),
        command_raw: "\\tikzstyle".to_string(),
        style_name_raw,
        style_name_span,
        definition_kind,
        payload_raw,
        payload_span,
        option_list,
    }
}

/// Map one `\usetikzlibrary { … }` statement node.
///
/// `libraries_group` is the direct `Group` child span (braces included);
/// the emitted `libraries_raw`/`libraries_span` are the *inner* region and
/// the library list is split on commas, trimmed, and emptied of blanks.
pub fn map_tikz_library(
    source: &str,
    stmt_span: Span,
    libraries_group: Option<Span>,
    id: String,
) -> TikzLibraryStatement {
    let libraries_raw = match libraries_group {
        Some(group) => extract_group_inner_raw(group, source),
        None => String::new(),
    };
    let libraries: Vec<String> = libraries_raw
        .split(',')
        .map(|entry| entry.trim())
        .filter(|entry| !entry.is_empty())
        .map(|entry| entry.to_string())
        .collect();
    TikzLibraryStatement {
        id,
        span: stmt_span,
        raw: slice_of(source, stmt_span),
        command_raw: "\\usetikzlibrary".to_string(),
        libraries_raw,
        libraries_span: libraries_group.map(|group| to_group_inner_span(group, source)),
        libraries,
    }
}

/// Map one `\colorlet {name} {value}` statement node.
///
/// Both groups are the first and second direct `Group` children in order,
/// with full splice into the source handled here.
pub fn map_colorlet(
    source: &str,
    stmt_span: Span,
    name_group: Option<Span>,
    value_group: Option<Span>,
    id: String,
) -> ColorletStatement {
    let name_raw = name_group.map_or(String::new(), |group| extract_group_inner_raw(group, source));
    let name_span = name_group.map(|group| to_group_inner_span(group, source));
    let value_raw = value_group.map_or(String::new(), |group| extract_group_inner_raw(group, source));
    let value_span = value_group.map(|group| to_group_inner_span(group, source));
    ColorletStatement {
        id,
        span: stmt_span,
        raw: slice_of(source, stmt_span),
        command_raw: "\\colorlet".to_string(),
        name_raw,
        name_span,
        value_raw,
        value_span,
    }
}

/// Map one `\definecolor {name} {model} {spec}` statement node.
///
/// The three groups are the first three direct `Group` children in order.
pub fn map_definecolor(
    source: &str,
    stmt_span: Span,
    name_group: Option<Span>,
    model_group: Option<Span>,
    specification_group: Option<Span>,
    id: String,
) -> DefineColorStatement {
    DefineColorStatement {
        id,
        span: stmt_span,
        raw: slice_of(source, stmt_span),
        command_raw: "\\definecolor".to_string(),
        name_raw: name_group.map_or(String::new(), |group| extract_group_inner_raw(group, source)),
        name_span: name_group.map(|group| to_group_inner_span(group, source)),
        model_raw: model_group.map_or(String::new(), |group| extract_group_inner_raw(group, source)),
        model_span: model_group.map(|group| to_group_inner_span(group, source)),
        specification_raw: specification_group.map_or(String::new(), |group| {
            extract_group_inner_raw(group, source)
        }),
        specification_span: specification_group.map(|group| to_group_inner_span(group, source)),
    }
}

/// Legacy glue for the `StylePayload` part: slice the raw text, hand it to
/// `parseStyleValueAsOptionList` anchored at the payload node start, and
/// fall back to parsing an empty list anchored at the *statement* start.
fn style_payload_and_options(
    source: &str,
    stmt_span: Span,
    payload: Option<Span>,
) -> (String, OptionListAst) {
    let payload_raw = match payload {
        Some(node) => slice_of(source, node),
        None => String::new(),
    };
    let glue_base = payload.map_or(stmt_span.from, |node| node.from);
    let option_list = parse_style_value_as_option_list(&payload_raw, glue_base)
        .unwrap_or_else(|| parse_option_list_raw("[]", stmt_span.from));
    (payload_raw, option_list)
}

/// Legacy `source.slice(from, to)` for an in-range span.
fn slice_of(source: &str, span: Span) -> String {
    source[span.from.min(source.len())..span.to.min(source.len())].to_string()
}

#[cfg(test)]
mod stmt_style_unit_tests {
    use super::*;

    #[test]
    fn tikz_set_pins_probe_offsets() {
        // Live probe for `\tikzset{fill=red}`: payload span (8,18) is the
        // full `{fill=red}` group; glue re-anchors at base 8.
        let source = "\\tikzset{fill=red}";
        let stmt = map_tikz_set(
            source,
            Span::new(0, 18),
            Some(Span::new(8, 18)),
            "tikz-set:0".to_string(),
        );
        assert_eq!(stmt.id, "tikz-set:0");
        assert_eq!(stmt.raw, source);
        assert_eq!(stmt.command_raw, "\\tikzset");
        assert_eq!(stmt.payload_raw, "{fill=red}");
        assert_eq!(stmt.payload_span, Some(Span::new(8, 18)));
        assert_eq!(stmt.option_list.span, Span::new(8, 18));
        assert_eq!(stmt.option_list.raw, "[fill=red]");
        assert_eq!(stmt.option_list.entries.len(), 1);
        let entry = stmt.option_list.entries[0].kv().expect("kv entry");
        assert_eq!(entry.key, "fill");
        assert_eq!(entry.value_raw, "red");
        assert_eq!(stmt.option_list.entries[0].span(), Span::new(9, 17));
        assert_eq!(entry.key_span, Span::new(9, 13));
        assert_eq!(entry.value_span, Some(Span::new(14, 17)));
    }

    #[test]
    fn pgf_keys_pins_probe_offsets() {
        // Live probe for `\pgfkeys {fill=red}` (19 bytes): payload (9,19),
        // entry (10,18); the glue re-anchors the same way as `\tikzset`.
        let source = "\\pgfkeys {fill=red}";
        let stmt = map_pgfkeys(
            source,
            Span::new(0, 19),
            Some(Span::new(9, 19)),
            "pgfkeys:0".to_string(),
        );
        assert_eq!(stmt.payload_raw, "{fill=red}");
        assert_eq!(stmt.payload_span, Some(Span::new(9, 19)));
        assert_eq!(stmt.option_list.span, Span::new(9, 19));
        assert_eq!(stmt.option_list.raw, "[fill=red]");
        assert_eq!(stmt.option_list.entries[0].span(), Span::new(10, 18));
        let entry = stmt.option_list.entries[0].kv().expect("kv entry");
        assert_eq!(entry.key, "fill");
        assert_eq!(entry.key_span, Span::new(10, 14));
        assert_eq!(entry.value_span, Some(Span::new(15, 18)));
    }

    #[test]
    fn tikz_style_bracket_payload_pins_probe_offsets() {
        // Live probe for `\tikzstyle {A}=[color=red]`: the payload is an
        // OptionList node and is parsed directly, without brace glue.
        let source = "\\tikzstyle {A}=[color=red]";
        let stmt = map_tikz_style(
            source,
            Span::new(0, 26),
            Some(Span::new(0, 10)),
            Some(StyleNameSource::Group(Span::new(11, 14))),
            Some(StylePayloadSource::OptionList(Span::new(15, 26))),
            "tikz-style:0".to_string(),
        );
        assert_eq!(stmt.style_name_raw, "A");
        assert_eq!(stmt.style_name_span, Some(Span::new(12, 13)));
        assert_eq!(stmt.definition_kind, StyleDefinitionKind::Style);
        assert_eq!(stmt.payload_raw, "[color=red]");
        assert_eq!(stmt.payload_span, Some(Span::new(15, 26)));
        assert_eq!(stmt.option_list.raw, "[color=red]");
        assert_eq!(stmt.option_list.entries[0].span(), Span::new(16, 25));
        let entry = stmt.option_list.entries[0].kv().expect("kv entry");
        assert_eq!(entry.key, "color");
        assert_eq!(entry.key_span, Span::new(16, 21));
        assert_eq!(entry.value_span, Some(Span::new(22, 25)));
    }

    #[test]
    fn tikz_style_append_pins_probe_offsets() {
        // Live probe for `\tikzstyle {A} += {draw=blue}`: the `+` lives in
        // the between slice `(14,18)` and the glue re-anchors at base 18.
        let source = "\\tikzstyle {A} += {draw=blue}";
        let stmt = map_tikz_style(
            source,
            Span::new(0, 29),
            Some(Span::new(0, 10)),
            Some(StyleNameSource::Group(Span::new(11, 14))),
            Some(StylePayloadSource::Payload(Span::new(18, 29))),
            "tikz-style:1".to_string(),
        );
        assert_eq!(stmt.definition_kind, StyleDefinitionKind::Append);
        assert_eq!(stmt.payload_raw, "{draw=blue}");
        assert_eq!(stmt.payload_span, Some(Span::new(18, 29)));
        assert_eq!(stmt.option_list.raw, "[draw=blue]");
        assert_eq!(stmt.option_list.entries[0].span(), Span::new(19, 28));
        let entry = stmt.option_list.entries[0].kv().expect("kv entry");
        assert_eq!(entry.key, "draw");
        assert_eq!(entry.key_span, Span::new(19, 23));
        assert_eq!(entry.value_span, Some(Span::new(24, 28)));
    }

    #[test]
    fn tikz_style_braced_payload_with_padded_name() {
        // `\tikzstyle { A } {fill=red}`: the name inner ` A ` is trimmed;
        // the payload group `{fill=red}` is glued at base 17.
        let source = "\\tikzstyle { A } {fill=red}";
        let stmt = map_tikz_style(
            source,
            Span::new(0, 27),
            Some(Span::new(0, 10)),
            Some(StyleNameSource::Group(Span::new(11, 16))),
            Some(StylePayloadSource::Payload(Span::new(17, 27))),
            "tikz-style:2".to_string(),
        );
        assert_eq!(stmt.style_name_raw, "A");
        assert_eq!(stmt.style_name_span, Some(Span::new(12, 15)));
        assert_eq!(stmt.definition_kind, StyleDefinitionKind::Style);
        assert_eq!(stmt.payload_raw, "{fill=red}");
        assert_eq!(stmt.option_list.entries[0].span(), Span::new(18, 26));
        let entry = stmt.option_list.entries[0].kv().expect("kv entry");
        assert_eq!(entry.key, "fill");
        assert_eq!(entry.key_span, Span::new(18, 22));
        assert_eq!(entry.value_span, Some(Span::new(23, 26)));
    }

    #[test]
    fn tikz_style_tolerates_missing_children() {
        let stmt = map_tikz_style(
            "",
            Span::new(0, 0),
            None,
            None,
            None,
            "tikz-style:3".to_string(),
        );
        assert_eq!(stmt.style_name_raw, "");
        assert_eq!(stmt.style_name_span, None);
        assert_eq!(stmt.payload_raw, "");
        assert_eq!(stmt.payload_span, None);
        assert_eq!(stmt.definition_kind, StyleDefinitionKind::Style);
        assert_eq!(stmt.option_list.raw, "[]");
        assert!(stmt.option_list.entries.is_empty());
    }

    #[test]
    fn tikz_library_splits_names() {
        // Live probe for `\usetikzlibrary{shapes, arrows.meta}` (36 bytes):
        // group (15,36), inner (16,35).
        let source = "\\usetikzlibrary{shapes, arrows.meta}";
        let stmt = map_tikz_library(
            source,
            Span::new(0, 36),
            Some(Span::new(15, 36)),
            "tikz-library:0".to_string(),
        );
        assert_eq!(stmt.libraries_raw, "shapes, arrows.meta");
        assert_eq!(stmt.libraries_span, Some(Span::new(16, 35)));
        assert_eq!(stmt.libraries, vec!["shapes".to_string(), "arrows.meta".to_string()]);
    }

    #[test]
    fn tikz_library_empty_entries() {
        // `{, }` splits into blanks only: the list collapses to nothing.
        let stmt = map_tikz_library(
            "\\usetikzlibrary{, }",
            Span::new(0, 19),
            Some(Span::new(15, 19)),
            "tikz-library:1".to_string(),
        );
        assert_eq!(stmt.libraries_raw, ", ");
        assert!(stmt.libraries.is_empty());
        let missing = map_tikz_library("", Span::new(0, 0), None, "tikz-library:2".to_string());
        assert_eq!(missing.libraries_raw, "");
        assert_eq!(missing.libraries_span, None);
        assert!(missing.libraries.is_empty());
    }

    #[test]
    fn colorlet_pins_probe_offsets() {
        // Live probe for `\colorlet {myred}{red!80}`: groups (10,17) and
        // (17,25), inners (11,16) and (18,24).
        let source = "\\colorlet {myred}{red!80}";
        let stmt = map_colorlet(
            source,
            Span::new(0, 25),
            Some(Span::new(10, 17)),
            Some(Span::new(17, 25)),
            "colorlet:0".to_string(),
        );
        assert_eq!(stmt.name_raw, "myred");
        assert_eq!(stmt.name_span, Some(Span::new(11, 16)));
        assert_eq!(stmt.value_raw, "red!80");
        assert_eq!(stmt.value_span, Some(Span::new(18, 24)));
        let missing = map_colorlet("", Span::new(0, 0), None, None, "colorlet:1".to_string());
        assert_eq!(missing.name_raw, "");
        assert_eq!(missing.name_span, None);
        assert_eq!(missing.value_raw, "");
        assert_eq!(missing.value_span, None);
    }

    #[test]
    fn definecolor_pins_probe_offsets() {
        // Live probe for `\definecolor{mygreen}{RGB}{0,128,0}` (35 bytes):
        // groups (12,21), (21,26), (26,35); inners (13,20), (22,25), (27,34).
        let source = "\\definecolor{mygreen}{RGB}{0,128,0}";
        let stmt = map_definecolor(
            source,
            Span::new(0, 35),
            Some(Span::new(12, 21)),
            Some(Span::new(21, 26)),
            Some(Span::new(26, 35)),
            "definecolor:0".to_string(),
        );
        assert_eq!(stmt.name_raw, "mygreen");
        assert_eq!(stmt.name_span, Some(Span::new(13, 20)));
        assert_eq!(stmt.model_raw, "RGB");
        assert_eq!(stmt.model_span, Some(Span::new(22, 25)));
        assert_eq!(stmt.specification_raw, "0,128,0");
        assert_eq!(stmt.specification_span, Some(Span::new(27, 34)));
    }
}
