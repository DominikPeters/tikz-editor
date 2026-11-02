//! Statement-level tokenizer.
//!
//! Port of the Lezer `@tokens` block from `tikz.grammar`. The token stream
//! keeps comments (they can continue unknown statements) and drops plain
//! whitespace. Balanced regions (`{}`, `[]`, `()`) are classified by their
//! individual bracket tokens so downstream scanners can span them with
//! token scans; escaped braces (`\{`) never open a region because they
//! classify before any brace check runs.
//!
//! All structural characters are single ASCII bytes, and UTF-8 corpora are
//! out of scope for the statements slice: non-ASCII bytes tokenize as
//! [`TokKind::StraySymbol`] and byte spans are documented as offsets into
//! the original string.

use crate::span::Span;

/// Token classification mirroring the grammar's `@tokens` block.
///
/// Specific command/keyword kinds only exist where statement dispatch (or
/// unknown-statement continue sets) needs to distinguish them; every other
/// control word collapses to [`TokKind::CommandName`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TokKind {
    /// `\begin{tikzpicture}` family opener (brace-adjacent literal).
    BeginTikz,
    /// `\end{tikzpicture}` family closer (brace-adjacent literal).
    EndTikz,
    /// `\begin{scope}`.
    BeginScope,
    /// `\end{scope}`.
    EndScope,
    /// `\draw`.
    DrawCmd,
    /// `\graph`.
    GraphCmd,
    /// `\path`.
    PathCmd,
    /// `\filldraw`.
    FillDrawCmd,
    /// `\fill`.
    FillCmd,
    /// `\pattern`.
    PatternCmd,
    /// `\clip`.
    ClipCmd,
    /// `\shade`.
    ShadeCmd,
    /// `\shadedraw`.
    ShadeDrawCmd,
    /// `\useasboundingbox`.
    UseAsBoundingBoxCmd,
    /// `\matrix` (statement maps to a node later).
    MatrixCmd,
    /// `\node`.
    NodeCmd,
    /// `\coordinate`.
    CoordinateCmd,
    /// `\pic`.
    PicCmd,
    /// `\foreach`.
    ForeachCmd,
    /// Font-size control words (`\small`, `\Large`, …).
    FontSizeCmd,
    /// `\tikzset`.
    TikzSetCmd,
    /// `\tikzstyle`.
    TikzStyleCmd,
    /// `\pgfkeys`.
    PgfkeysCmd,
    /// `\def`.
    DefCmd,
    /// `\let`.
    LetDefCmd,
    /// `\colorlet`.
    ColorletCmd,
    /// `\definecolor`.
    DefineColorCmd,
    /// `\newcommand` (same literal class as `\renewcommand`).
    NewCommandCmd,
    /// `\renewcommand`.
    RenewCommandCmd,
    /// `\providecommand`.
    ProvideCommandCmd,
    /// `\DeclareRobustCommand`.
    DeclareRobustCommandCmd,
    /// `\DeclareMathOperator`.
    DeclareMathOperatorCmd,
    /// `\pgfmathsetmacro`.
    PgfMathSetMacroCmd,
    /// `\pgfmathparse`.
    PgfMathParseCmd,
    /// `\pgfmathsetseed`.
    PgfMathSetSeedCmd,
    /// `\usetikzlibrary`.
    UseTikzLibraryCmd,
    /// `\\` matrix row separator.
    MatrixRowSepCmd,
    /// `\&`, `\%`, `\$`, `\{`, `\}`, ` `, `\(`, `\)`, `\[`, `\]`.
    EscapedXCmd,
    /// `\,` and friends (any `\` + non-letter byte, e.g. `\1`).
    ControlSymbolCmd,
    /// Any other `\word` control sequence.
    CommandName,
    /// `$$`.
    DoubleDollar,
    /// `$`.
    Dollar,
    /// Numeric literal (`.5`, `1.5e2`, `10`).
    Number,
    /// Word identifier, possibly a keyword (see [`is_path_keyword_word`]).
    Identifier,
    /// `%` line comment (span excludes the terminator newline).
    Comment,
    /// `{`.
    BraceOpen,
    /// `}`.
    BraceClose,
    /// `[`.
    BracketOpen,
    /// `]`.
    BracketClose,
    /// `(`.
    ParenOpen,
    /// `)`.
    ParenClose,
    /// `"…"` quoted SVG payload, greedy to the last quote on the line.
    QuotedSvg,
    /// `--`, `-|`, `|-`, `..` path operators.
    PathOperator,
    /// `,`.
    Comma,
    /// `;`.
    Semicolon,
    /// `:`.
    Colon,
    /// `.`.
    Dot,
    /// `=`.
    Equals,
    /// `-` on its own.
    Dash,
    /// `+` on its own.
    Plus,
    /// `/`.
    Slash,
    /// Stray symbol characters (`*!?'$|&^_~@` and unclassified bytes).
    StraySymbol,
}

/// One classified token.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tok {
    /// Classification.
    pub kind: TokKind,
    /// Byte span of the token.
    pub span: Span,
}

impl Tok {
    /// Slice the token's raw source text.
    pub fn raw<'a>(&self, source: &'a str) -> &'a str {
        source.get(self.span.from..self.span.to).unwrap_or("")
    }
}

/// True when an identifier word is one of the path keywords.
pub fn is_path_keyword_word(word: &str) -> bool {
    matches!(
        word,
        "at" | "bend" | "cycle" | "circle" | "controls" | "and" | "rectangle" | "ellipse"
            | "arc" | "grid" | "plot" | "coordinates" | "parabola" | "sin" | "cos"
    )
}

/// Control words in `@precedence` literal order; the cutter compares for the
/// longest literal. No literal is a prefix of another *table entry*, but a
/// literal can be a prefix of a longer word (e.g. `\filldrawx`): the rule is
/// "longest literal prefix vs full word length; longest wins; equal length →
/// earliest table row" (rendered as CommandName font sizes toward the end).
const COMMAND_TABLE: &[(&str, TokKind)] = &[
    ("tikzset", TokKind::TikzSetCmd),
    ("tikzstyle", TokKind::TikzStyleCmd),
    ("definecolor", TokKind::DefineColorCmd),
    ("def", TokKind::DefCmd),
    ("colorlet", TokKind::ColorletCmd),
    ("let", TokKind::LetDefCmd),
    ("newcommand", TokKind::NewCommandCmd),
    ("renewcommand", TokKind::RenewCommandCmd),
    ("providecommand", TokKind::ProvideCommandCmd),
    ("DeclareRobustCommand", TokKind::DeclareRobustCommandCmd),
    ("DeclareMathOperator", TokKind::DeclareMathOperatorCmd),
    ("pgfmathsetmacro", TokKind::PgfMathSetMacroCmd),
    ("pgfmathparse", TokKind::PgfMathParseCmd),
    ("pgfmathsetseed", TokKind::PgfMathSetSeedCmd),
    ("filldraw", TokKind::FillDrawCmd),
    ("fill", TokKind::FillCmd),
    ("pattern", TokKind::PatternCmd),
    ("draw", TokKind::DrawCmd),
    ("graph", TokKind::GraphCmd),
    ("path", TokKind::PathCmd),
    ("clip", TokKind::ClipCmd),
    ("shadedraw", TokKind::ShadeDrawCmd),
    ("shade", TokKind::ShadeCmd),
    ("useasboundingbox", TokKind::UseAsBoundingBoxCmd),
    ("foreach", TokKind::ForeachCmd),
    ("matrix", TokKind::MatrixCmd),
    ("node", TokKind::NodeCmd),
    ("pic", TokKind::PicCmd),
    ("coordinate", TokKind::CoordinateCmd),
    ("pgfkeys", TokKind::PgfkeysCmd),
    ("usetikzlibrary", TokKind::UseTikzLibraryCmd),
];

/// Font-size words spanning before `CommandName` in `@precedence`.
const FONT_SIZE_TABLE: &[&str] = &[
    "tiny",
    "scriptsize",
    "footnotesize",
    "small",
    "normalsize",
    "large",
    "Large",
    "LARGE",
    "huge",
    "Huge",
];

const TIKZ_PICTURE_ENVS: [&str; 3] = ["tikzpicture", "tikzpicture*", "tikzlayer"];

/// Tokenize `source` into classified tokens (whitespace dropped).
///
/// ```
/// use tikz_core::tok::{tokenize, TokKind};
/// let toks = tokenize(r"\node at (0,1);");
/// assert_eq!(toks[0].kind, TokKind::NodeCmd);
/// assert_eq!(toks[toks.len() - 1].kind, TokKind::Semicolon);
/// ```
pub fn tokenize(source: &str) -> Vec<Tok> {
    let mut toks = Vec::new();
    let bytes = source.as_bytes();
    let mut cursor = 0usize;
    while cursor < bytes.len() {
        cursor = next_token(source, bytes, cursor, &mut toks);
    }
    toks
}

fn next_token(source: &str, bytes: &[u8], mut cursor: usize, toks: &mut Vec<Tok>) -> usize {
    loop {
        match bytes.get(cursor) {
            Some(&b) if b.is_ascii_whitespace() => cursor += 1,
            Some(b'%') => return push_comment(bytes, cursor, toks),
            _ => break,
        }
    }
    if cursor >= bytes.len() {
        return cursor;
    }
    match bytes[cursor] {
        b'\\' => lex_backslash(source, bytes, cursor, toks),
        b'{' => push(TokKind::BraceOpen, cursor, 1, toks),
        b'}' => push(TokKind::BraceClose, cursor, 1, toks),
        b'[' => push(TokKind::BracketOpen, cursor, 1, toks),
        b']' => push(TokKind::BracketClose, cursor, 1, toks),
        b'(' => push(TokKind::ParenOpen, cursor, 1, toks),
        b')' => push(TokKind::ParenClose, cursor, 1, toks),
        b'$' => dollar(bytes, cursor, toks),
        b'"' => lex_quote(bytes, cursor, toks),
        b',' => push(TokKind::Comma, cursor, 1, toks),
        b';' => push(TokKind::Semicolon, cursor, 1, toks),
        b'=' => push(TokKind::Equals, cursor, 1, toks),
        b'+' => push(TokKind::Plus, cursor, 1, toks),
        b'-' => lex_dash_or_operator(bytes, cursor, toks),
        b'|' => or_or_operator(bytes, cursor, toks),
        b'.' => lex_dot(bytes, cursor, toks),
        b':' => push(TokKind::Colon, cursor, 1, toks),
        b'/' => push(TokKind::Slash, cursor, 1, toks),
        b'0'..=b'9' => push(
            TokKind::Number,
            cursor,
            number_end(bytes, cursor, false) - cursor,
            toks,
        ),
        b'@' => push(TokKind::StraySymbol, cursor, 1, toks),
        b if b.is_ascii_alphabetic() => push(
            TokKind::Identifier,
            cursor,
            identifier_end(bytes, cursor) - cursor,
            toks,
        ),
        _ => push(TokKind::StraySymbol, cursor, 1, toks),
    }
}

fn push(kind: TokKind, cursor: usize, len: usize, toks: &mut Vec<Tok>) -> usize {
    toks.push(Tok {
        kind,
        span: Span::new(cursor, cursor + len),
    });
    cursor + len
}

fn push_comment(bytes: &[u8], cursor: usize, toks: &mut Vec<Tok>) -> usize {
    let mut end = cursor + 1;
    while end < bytes.len() && bytes[end] != b'\n' && bytes[end] != b'\r' {
        end += 1;
    }
    toks.push(Tok {
        kind: TokKind::Comment,
        span: Span::new(cursor, end),
    });
    end
}

fn dollar(bytes: &[u8], cursor: usize, toks: &mut Vec<Tok>) -> usize {
    if bytes.get(cursor + 1) == Some(&b'$') {
        push(TokKind::DoubleDollar, cursor, 2, toks)
    } else {
        push(TokKind::Dollar, cursor, 1, toks)
    }
}

/// QuotedSvg is greedy: everything to the *last* quote on the line matches
/// `"` ![\n\r] * `"`, so `"a" def "b"` is a single token.
fn lex_quote(bytes: &[u8], cursor: usize, toks: &mut Vec<Tok>) -> usize {
    let mut end = cursor + 1;
    let mut last_quote: Option<usize> = None;
    while end < bytes.len() && bytes[end] != b'\n' && bytes[end] != b'\r' {
        if bytes[end] == b'"' {
            last_quote = Some(end);
        }
        end += 1;
    }
    if let Some(close) = last_quote {
        push(TokKind::QuotedSvg, cursor, close + 1 - cursor, toks)
    } else {
        // No closing quote: `"` falls back to StraySymbol.
        push(TokKind::StraySymbol, cursor, 1, toks)
    }
}

fn lex_dash_or_operator(bytes: &[u8], cursor: usize, toks: &mut Vec<Tok>) -> usize {
    match bytes.get(cursor + 1) {
        Some(b'-') | Some(b'|') => push(TokKind::PathOperator, cursor, 2, toks),
        _ => push(TokKind::Dash, cursor, 1, toks),
    }
}

fn or_or_operator(bytes: &[u8], cursor: usize, toks: &mut Vec<Tok>) -> usize {
    if bytes.get(cursor + 1) == Some(&b'-') {
        push(TokKind::PathOperator, cursor, 2, toks)
    } else {
        push(TokKind::StraySymbol, cursor, 1, toks)
    }
}

fn lex_dot(bytes: &[u8], cursor: usize, toks: &mut Vec<Tok>) -> usize {
    if bytes.get(cursor + 1) == Some(&b'.') {
        push(TokKind::PathOperator, cursor, 2, toks)
    } else if bytes.get(cursor + 1).is_some_and(|b| b.is_ascii_digit()) {
        push(
            TokKind::Number,
            cursor,
            number_end(bytes, cursor, true) - cursor,
            toks,
        )
    } else {
        push(TokKind::Dot, cursor, 1, toks)
    }
}

/// End of a numeric literal starting at `cursor`; `dot` means the form
/// starts with a `.` already consumed by the caller's scan (`.5`).
fn number_end(bytes: &[u8], cursor: usize, dot: bool) -> usize {
    let mut end = cursor + usize::from(dot);
    while end < bytes.len() && bytes[end].is_ascii_digit() {
        end += 1;
    }
    if !dot && end < bytes.len() && bytes[end] == b'.' {
        end += 1;
        while end < bytes.len() && bytes[end].is_ascii_digit() {
            end += 1;
        }
    }
    if end < bytes.len() && (bytes[end] == b'e' || bytes[end] == b'E') {
        let mut probe = end + 1;
        if matches!(bytes.get(probe), Some(b'+') | Some(b'-')) {
            probe += 1;
        }
        if probe < bytes.len() && bytes[probe].is_ascii_digit() {
            while probe < bytes.len() && bytes[probe].is_ascii_digit() {
                probe += 1;
            }
            end = probe;
        }
    }
    end
}

/// End of an identifier run starting at `cursor`.
fn identifier_end(bytes: &[u8], cursor: usize) -> usize {
    let mut end = cursor;
    while end < bytes.len()
        && (bytes[end].is_ascii_alphanumeric() || matches!(bytes[end], b'-' | b'_' | b':' | b'@'))
    {
        end += 1;
    }
    end
}

fn lex_backslash(source: &str, bytes: &[u8], cursor: usize, toks: &mut Vec<Tok>) -> usize {
    if bytes.get(cursor + 1) == Some(&b'\\') {
        return push(TokKind::MatrixRowSepCmd, cursor, 2, toks);
    }
    let mut word_end = cursor + 1;
    while word_end < bytes.len() && (bytes[word_end].is_ascii_alphabetic() || bytes[word_end] == b'@')
    {
        word_end += 1;
    }
    if word_end > cursor + 1 {
        return lex_command_word(source, bytes, cursor, word_end, toks);
    }
    // `\` + non-letter (or EOF): escaped symbol / control symbol token.
    match bytes.get(cursor + 1) {
        Some(&b'&') | Some(&b'%') | Some(&b'$') | Some(&b'{') | Some(&b'}') | Some(&b' ')
        | Some(&b'(') | Some(&b')') | Some(&b'[') | Some(&b']') => {
            push(TokKind::EscapedXCmd, cursor, 2, toks)
        }
        Some(_) => push(TokKind::ControlSymbolCmd, cursor, 2, toks),
        None => push(TokKind::ControlSymbolCmd, cursor, 1, toks),
    }
}

/// Classify the control word occupying `cursor..word_end`, handling the
/// brace-adjacent `\begin{…}` / `\end{…}` literals first.
fn lex_command_word(
    source: &str,
    bytes: &[u8],
    cursor: usize,
    word_end: usize,
    toks: &mut Vec<Tok>,
) -> usize {
    let word = source.get((cursor + 1)..word_end).unwrap_or("");
    if (word == "begin" || word == "end") && bytes.get(word_end) == Some(&b'{') {
        if let Some((kind, token_end)) = env_literal_kind(word, source, bytes, word_end) {
            return push(kind, cursor, token_end - cursor, toks);
        }
    }
    let (kind, len) = word_literal_kind(word)
        .map(|kind| (kind, word_end - cursor))
        .unwrap_or((TokKind::CommandName, word_end - cursor));
    push(kind, cursor, len, toks)
}

/// Resolve `{name}` adjacent to `\begin`/`\end`; returns the literal kind and
/// the token end offset (after the closing brace), or `None` to fall back to
/// [`TokKind::CommandName`] covering just the `\begin`/`\end` word.
fn env_literal_kind(
    word: &str,
    source: &str,
    bytes: &[u8],
    open_brace: usize,
) -> Option<(TokKind, usize)> {
    let (name, token_end) = read_env_name(source, bytes, open_brace)?;
    let kind = if word == "begin" {
        match name {
            "scope" => TokKind::BeginScope,
            _ if TIKZ_PICTURE_ENVS.contains(&name) => TokKind::BeginTikz,
            _ => return None,
        }
    } else {
        match name {
            "scope" => TokKind::EndScope,
            _ if TIKZ_PICTURE_ENVS.contains(&name) => TokKind::EndTikz,
            _ => return None,
        }
    };
    Some((kind, token_end))
}

/// `{name}` adjacent; `(name, end_exclusive)` inclusive of the brace.
fn read_env_name<'a>(source: &'a str, bytes: &'a [u8], open: usize) -> Option<(&'a str, usize)> {
    let mut end = open + 1;
    while end < bytes.len() && bytes[end] != b'}' {
        end += 1;
    }
    if end >= bytes.len() {
        return None;
    }
    Some((source.get((open + 1)..end)?, end + 1))
}

/// Classify a full control word. A literal token beats `CommandName` only
/// when it *equals* the whole word (letters extending past a literal make
/// the `CommandName` token longer, e.g. `\smallx`); exact-equal overlaps
/// between the two tables cannot happen.
fn word_literal_kind(word: &str) -> Option<TokKind> {
    for (literal, kind) in COMMAND_TABLE {
        if *literal == word {
            return Some(*kind);
        }
    }
    if FONT_SIZE_TABLE.contains(&word) {
        return Some(TokKind::FontSizeCmd);
    }
    None
}

#[cfg(test)]
mod tok_unit_tests {
    use super::*;

    #[test]
    fn classifies_statement_heads() {
        let toks = tokenize("\\draw \\filldrawx \\foreach \\small \\node;");
        assert_eq!(toks[0].kind, TokKind::DrawCmd);
        assert_eq!(toks[1].kind, TokKind::CommandName);
        assert_eq!(toks[2].kind, TokKind::ForeachCmd);
        assert_eq!(toks[3].kind, TokKind::FontSizeCmd);
        assert_eq!(toks[4].kind, TokKind::NodeCmd);
        assert_eq!(toks[5].kind, TokKind::Semicolon);
    }

    #[test]
    fn longest_literal_prefers_longer_prefixes() {
        // `\smallx` is a plain CommandName; `\small` is FontSizeCmd.
        assert_eq!(tokenize("\\smallx")[0].kind, TokKind::CommandName);
        assert_eq!(tokenize("\\small")[0].kind, TokKind::FontSizeCmd);
        // `\def` prefix in table beats nothing longer.
        assert_eq!(tokenize("\\definecolor")[0].kind, TokKind::DefineColorCmd);
    }

    #[test]
    fn env_literals_adjoin_braces() {
        assert_eq!(tokenize("\\begin{tikzpicture}")[0].kind, TokKind::BeginTikz);
        assert_eq!(tokenize("\\begin {tikzpicture}")[0].kind, TokKind::CommandName);
        assert_eq!(tokenize("\\begin{scope}")[0].kind, TokKind::BeginScope);
        assert_eq!(tokenize("\\end{scope}")[0].kind, TokKind::EndScope);
        // Unknown env name unwinds to CommandName covering `\begin` only.
        let toks = tokenize("\\begin{figure}");
        assert_eq!(toks[0].kind, TokKind::CommandName);
        assert_eq!(toks[0].raw("\\begin{figure}"), "\\begin");
    }

    #[test]
    fn comments_paths_and_numbers() {
        let toks = tokenize("x % line;\n-- .. -| 1.5e2 .5 \\1 \\;");
        assert_eq!(toks[0].kind, TokKind::Identifier);
        assert_eq!(toks[1].kind, TokKind::Comment);
        assert_eq!(toks[1].raw("x % line;\n-- .."), "% line;");
        assert_eq!(toks[2].kind, TokKind::PathOperator);
        assert_eq!(toks[5].kind, TokKind::Number);
        assert_eq!(toks[5].span.from, toks[5].span.to - 5); // `1.5e2`
        assert_eq!(toks[6].kind, TokKind::Number);
        assert_eq!(toks[7].kind, TokKind::ControlSymbolCmd);
        assert_eq!(toks[8].kind, TokKind::ControlSymbolCmd);
    }

    #[test]
    fn quoted_svg_runs_greedy_to_last_quote() {
        let toks = tokenize("\"a\" def \"b\"");
        assert_eq!(toks.len(), 1);
        assert_eq!(toks[0].kind, TokKind::QuotedSvg);
        assert_eq!(toks[0].raw("\"a\" def \"b\""), "\"a\" def \"b\"");
        // No closing quote: StraySymbol.
        assert_eq!(tokenize("\"abc;")[0].kind, TokKind::StraySymbol);
    }
}
