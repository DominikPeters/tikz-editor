//! AST statement types.
//!
//! Port of `packages/core/src/ast/types.ts` (statement half). Path items
//! live in [`crate::items`]; the shared span type is [`crate::span::Span`].
//! Field names mirror the legacy camelCase contract, converted to
//! snake_case.

use crate::options::OptionListAst;
use crate::span::Span;

/// A parsed TikZ figure (one `tikzpicture`-like block).
#[derive(Debug, Clone, PartialEq)]
pub struct TikzFigure {
    /// Span covering the whole figure.
    pub span: Span,
    /// Figure-level option list.
    pub options: Option<OptionListAst>,
    /// Top-level statements in order.
    pub body: Vec<Statement>,
}

/// One body statement of any statement kind.
#[derive(Debug, Clone, PartialEq)]
pub enum Statement {
    /// `\draw …`-style path statement.
    Path(PathStatement),
    /// `{ … }` grouped statements.
    Scope(ScopeStatement),
    /// `\foreach \x in {…} { … }`.
    Foreach(ForeachStatement),
    /// `\def \name {…}`.
    MacroDefinition(MacroDefinitionStatement),
    /// `\let \a = \b`.
    MacroAlias(MacroAliasStatement),
    /// `\newcommand` family (incl. `\DeclareMathOperator`).
    MacroCommandDefinition(MacroCommandDefinitionStatement),
    /// `\pgfmathsetmacro` family.
    PgfMath(PgfMathStatement),
    /// `\tikzset { … }`.
    TikzSet(TikzSetStatement),
    /// `\tikzstyle …`.
    TikzStyle(TikzStyleStatement),
    /// `\pgfkeys { … }`.
    Pgfkeys(PgfkeysStatement),
    /// `\usetikzlibrary { … }`.
    TikzLibrary(TikzLibraryStatement),
    /// `\colorlet {name} {value}`.
    Colorlet(ColorletStatement),
    /// `\definecolor {name} {model} {spec}`.
    DefineColor(DefineColorStatement),
    /// Unrecognized text between `;` terminators.
    Unknown(UnknownStatement),
}

impl Statement {
    /// Span covering the statement.
    pub fn span(&self) -> Span {
        match self {
            Statement::Path(e) => e.span,
            Statement::Scope(e) => e.span,
            Statement::Foreach(e) => e.span,
            Statement::MacroDefinition(e) => e.span,
            Statement::MacroAlias(e) => e.span,
            Statement::MacroCommandDefinition(e) => e.span,
            Statement::PgfMath(e) => e.span,
            Statement::TikzSet(e) => e.span,
            Statement::TikzStyle(e) => e.span,
            Statement::Pgfkeys(e) => e.span,
            Statement::TikzLibrary(e) => e.span,
            Statement::Colorlet(e) => e.span,
            Statement::DefineColor(e) => e.span,
            Statement::Unknown(e) => e.span,
        }
    }

    /// Statement id (`"name:…"` style string).
    pub fn id(&self) -> &str {
        match self {
            Statement::Path(e) => &e.id,
            Statement::Scope(e) => &e.id,
            Statement::Foreach(e) => &e.id,
            Statement::MacroDefinition(e) => &e.id,
            Statement::MacroAlias(e) => &e.id,
            Statement::MacroCommandDefinition(e) => &e.id,
            Statement::PgfMath(e) => &e.id,
            Statement::TikzSet(e) => &e.id,
            Statement::TikzStyle(e) => &e.id,
            Statement::Pgfkeys(e) => &e.id,
            Statement::TikzLibrary(e) => &e.id,
            Statement::Colorlet(e) => &e.id,
            Statement::DefineColor(e) => &e.id,
            Statement::Unknown(e) => &e.id,
        }
    }
}

/// `path`/`draw`/… command kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathCommand {
    /// `\path` / `path`.
    Path,
    /// `\graph`.
    Graph,
    /// `\draw`.
    Draw,
    /// `\fill`.
    Fill,
    /// `\filldraw`.
    Filldraw,
    /// `\pattern`.
    Pattern,
    /// `\clip`.
    Clip,
    /// `\shade`.
    Shade,
    /// `\shadedraw`.
    Shadedraw,
    /// `\useasboundingbox`.
    Useasboundingbox,
    /// `\node` used as a statement.
    Node,
    /// `\coordinate` used as a statement.
    Coordinate,
}

/// `path` statement carrying a sequence of path items.
#[derive(Debug, Clone, PartialEq)]
pub struct PathStatement {
    pub id: String,
    /// Span covering everything including the trailing `;`.
    pub span: Span,
    /// The command keyword, lowercased.
    pub command: PathCommand,
    /// Command-level option list (`[..]` after the keyword).
    pub options: Option<OptionListAst>,
    /// Parsed path items, ending at `;`.
    pub items: Vec<crate::items::PathItem>,
}

/// Grouped `{ … }` statements.
#[derive(Debug, Clone, PartialEq)]
pub struct ScopeStatement {
    pub id: String,
    /// Span covering `{ … }`.
    pub span: Span,
    /// Scope-level option list.
    pub options: Option<OptionListAst>,
    /// Nested statements.
    pub body: Vec<Statement>,
}

/// `\foreach` top-level statement.
#[derive(Debug, Clone, PartialEq)]
pub struct ForeachStatement {
    pub id: String,
    /// Span covering the statement through the body.
    pub span: Span,
    /// Option list extracted from the header (options are header-level).
    pub options: Option<OptionListAst>,
    /// Span of the option list tokens.
    pub options_span: Option<Span>,
    /// Span covering the stripped header text.
    pub header_span: Option<Span>,
    /// Stripped header text (`\x in {…}`); always present in dumps.
    pub header_raw: String,
    /// Variables part text (before `in`).
    pub variables_raw: String,
    /// List part text (after `in`).
    pub list_raw: String,
    /// Stripped header text as written (equal to [`Self::header_raw`]).
    pub prefix_raw: String,
    /// Body text raw; empty when the statement has no body node.
    pub body_raw: String,
    /// Span covering the body.
    pub body_span: Option<Span>,
}

/// `\def` macro definition.
#[derive(Debug, Clone, PartialEq)]
pub struct MacroDefinitionStatement {
    pub id: String,
    pub span: Span,
    /// Whole text as written.
    pub raw: String,
    /// Control sequence name (`\def`).
    pub command_raw: String,
    /// Defined macro name as written.
    pub name_raw: String,
    /// Span of the macro name.
    pub name_span: Option<Span>,
    /// Replacement text.
    pub value_raw: String,
    /// Span of the replacement text.
    pub value_span: Option<Span>,
}

/// `\let` macro alias.
#[derive(Debug, Clone, PartialEq)]
pub struct MacroAliasStatement {
    pub id: String,
    pub span: Span,
    /// Whole text as written.
    pub raw: String,
    /// Control sequence name (`\let`).
    pub command_raw: String,
    /// Alias name as written.
    pub name_raw: String,
    /// Span of the alias name.
    pub name_span: Option<Span>,
    /// Macro target text.
    pub target_raw: String,
    /// Span of the macro target.
    pub target_span: Option<Span>,
}

/// `\newcommand`-family statement.
#[derive(Debug, Clone, PartialEq)]
pub struct MacroCommandDefinitionStatement {
    pub id: String,
    pub span: Span,
    /// Whole text as written.
    pub raw: String,
    /// Control sequence name (`\newcommand` etc.).
    pub command_raw: String,
    /// Defined macro name as written.
    pub name_raw: String,
    /// Span of the macro name.
    pub name_span: Option<Span>,
    /// Number of parameters (`0` when none or unknown).
    pub arity: i64,
    /// Span of the parameter count tokens.
    pub arity_span: Option<Span>,
    /// Optional-argument default text.
    pub optional_default_raw: Option<String>,
    /// Span of the default text.
    pub optional_default_span: Option<Span>,
    /// Replacement body text.
    pub body_raw: String,
    /// Span of the body.
    pub body_span: Option<Span>,
    /// True for the starred command variants.
    pub starred: bool,
}

/// `\pgfmath…` statement; args are the brace or plain payloads in order.
#[derive(Debug, Clone, PartialEq)]
pub struct PgfMathStatement {
    pub id: String,
    pub span: Span,
    /// Whole text as written.
    pub raw: String,
    /// Control sequence name (`\pgfmathsetmacro` etc.).
    pub command_raw: String,
    /// Payloads, in order.
    pub args_raw: Vec<String>,
    /// Spans of the payloads.
    pub args_span: Vec<Span>,
}

/// `\tikzset { … }` statement.
#[derive(Debug, Clone, PartialEq)]
pub struct TikzSetStatement {
    pub id: String,
    pub span: Span,
    /// Whole text as written.
    pub raw: String,
    /// Control sequence name (`\tikzset`).
    pub command_raw: String,
    /// The brace payload as written.
    pub payload_raw: String,
    /// Full payload node span (wrapping braces included).
    pub payload_span: Option<Span>,
    /// Payload parsed as an option list.
    pub option_list: OptionListAst,
}

/// `\tikzstyle` statement.
#[derive(Debug, Clone, PartialEq)]
pub struct TikzStyleStatement {
    pub id: String,
    pub span: Span,
    /// Whole text as written.
    pub raw: String,
    /// Control sequence name (`\tikzstyle`).
    pub command_raw: String,
    /// Style name as written.
    pub style_name_raw: String,
    /// Span of the style name (the group's inner span for the group form).
    pub style_name_span: Option<Span>,
    /// `style` or `append` (the name-to-payload in-between text contains `+`).
    pub definition_kind: StyleDefinitionKind,
    /// Payload text.
    pub payload_raw: String,
    /// Full payload node span (braces or brackets included).
    pub payload_span: Option<Span>,
    /// Payload parsed as an option list.
    pub option_list: OptionListAst,
}

/// Style `definitionKind` marker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StyleDefinitionKind {
    /// Plain `style` definition.
    Style,
    /// `append` definition (the in-between text contains `+`).
    Append,
}

/// `\pgfkeys { … }` statement.
#[derive(Debug, Clone, PartialEq)]
pub struct PgfkeysStatement {
    pub id: String,
    pub span: Span,
    /// Whole text as written.
    pub raw: String,
    /// Control sequence name (`\pgfkeys`).
    pub command_raw: String,
    /// Payload text.
    pub payload_raw: String,
    /// Full payload node span (wrapping braces included).
    pub payload_span: Option<Span>,
    /// Payload parsed as an option list.
    pub option_list: OptionListAst,
}

/// `\usetikzlibrary { … }` statement.
#[derive(Debug, Clone, PartialEq)]
pub struct TikzLibraryStatement {
    pub id: String,
    pub span: Span,
    /// Whole text as written.
    pub raw: String,
    /// Control sequence name (`\usetikzlibrary`).
    pub command_raw: String,
    /// Comma-separated payload text (inner, without braces).
    pub libraries_raw: String,
    /// Span of the payload (inner, without braces).
    pub libraries_span: Option<Span>,
    /// Split library names.
    pub libraries: Vec<String>,
}

/// `\colorlet` statement.
#[derive(Debug, Clone, PartialEq)]
pub struct ColorletStatement {
    pub id: String,
    pub span: Span,
    /// Whole text as written.
    pub raw: String,
    /// Control sequence name (`\colorlet`).
    pub command_raw: String,
    /// Color name as written.
    pub name_raw: String,
    /// Span of the color name.
    pub name_span: Option<Span>,
    /// Color value text.
    pub value_raw: String,
    /// Span of the color value.
    pub value_span: Option<Span>,
}

/// `\definecolor` statement.
#[derive(Debug, Clone, PartialEq)]
pub struct DefineColorStatement {
    pub id: String,
    pub span: Span,
    /// Whole text as written.
    pub raw: String,
    /// Control sequence name (`\definecolor`).
    pub command_raw: String,
    /// Color name as written.
    pub name_raw: String,
    /// Span of the color name.
    pub name_span: Option<Span>,
    /// Color model text (e.g. `rgb`).
    pub model_raw: String,
    /// Span of the model.
    pub model_span: Option<Span>,
    /// Specification text (component list or hex).
    pub specification_raw: String,
    /// Span of the specification.
    pub specification_span: Option<Span>,
}

/// Unrecognized statement.
#[derive(Debug, Clone, PartialEq)]
pub struct UnknownStatement {
    pub id: String,
    pub span: Span,
    /// Whole text as written.
    pub raw: String,
}
