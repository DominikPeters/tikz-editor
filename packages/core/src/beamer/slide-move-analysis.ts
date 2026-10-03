import type { Span } from "../ast/types.js";
import { isTexMathTypesettingCommand } from "../text/tex/math/parser.js";
import { applyMacroArguments, parseMacroInvocationArgs } from "../macros/expand.js";
import { parseForeachHeaderRaw } from "../foreach/header.js";
import { collectContextDefinitions } from "../transform/cst-to-ast.js";
import { matchTexSyntaxEnvironments, type TexSyntaxIndex } from "../text/tex/syntax-index.js";
import { scanBeamerDocument } from "./scan.js";
import { createBeamerSyntaxContext } from "./syntax.js";
import { beamerSlideInsertionPoint, beamerSlideIsEditable, beamerSlideSourceSpan } from "./slide-source.js";
import type { BeamerSlideEdit } from "./slide-manager.js";

export type BeamerSlideMoveExcerpt = { label: string; span: Span; line: number; text: string };
export type BeamerSlideMoveIssue = {
  severity: "review" | "blocked";
  message: string;
  excerpts: BeamerSlideMoveExcerpt[];
};
export type BeamerSlideMoveAnalysis = {
  status: "safe" | "review" | "blocked";
  issues: BeamerSlideMoveIssue[];
  dependencies: { frameId: string; span: Span }[];
};
type Definition = {
  name: string; span: Span; command: string; body: string; references: string[];
  literal: boolean; alias: boolean; wellFormed: boolean;
  arity: number; optionalDefault?: string;
};
type Scope = { id: number; span: Span; kind: "group" | "conditional"; opening: Span };
const inside = (outer: Span, inner: Span) => outer.from <= inner.from && inner.to <= outer.to;
const contains = (span: Span, at: number) => span.from <= at && at < span.to;
const DEFINITION_COMMANDS = new Set(["def", "let", "newcommand", "renewcommand", "providecommand", "DeclareRobustCommand", "DeclareMathOperator"]);
const STORED_COMMANDS = new Set([...DEFINITION_COMMANDS, "gdef", "edef", "xdef", "newenvironment", "renewenvironment"]);
const CONDITIONALS = new Set("if ifcat ifnum ifdim ifodd ifvmode ifhmode ifmmode ifinner ifvoid ifhbox ifvbox ifx ifeof iftrue iffalse ifcase ifdefined ifcsname iffontchar".split(" "));
// Known local commands help prove that every consumer of a relocatable definition
// is visible. Unknown commands prevent that proof, but do not themselves warrant a warning.
const LOCAL_ENVIRONMENTS = new Set("document frame itemize enumerate description columns column block alertblock exampleblock center flushleft flushright equation equation* align align* aligned alignedat gather gather* gathered split multline multline* cases matrix pmatrix bmatrix Bmatrix vmatrix Vmatrix array tabular tabular* figure table tikzpicture tikzpicture* axis scope overlayarea overprint onlyenv uncoverenv visibleenv invisibleenv altenv actionenv verbatim verbatim* Verbatim semiverbatim lstlisting minted thebibliography".split(" "));
const STRUCTURAL_COMMANDS = new Set("begin end section subsection subsubsection part appendix begingroup endgroup bgroup egroup else or fi relax".split(" "));
const LOCAL_COMMANDS = new Set((
  "begin end documentclass usepackage section subsection subsubsection part appendix " +
  "frametitle framesubtitle label ref pageref eqref autoref hyperref hyperlink hypertarget cite nocite " +
  "only uncover visible invisible onslide alt temporal pause alert item itemize enumerate description " +
  "textbf textit texttt textrm textsf textsc textsl emph texorpdfstring footnote url href " +
  "bfseries mdseries itshape upshape rmfamily sffamily ttfamily normalfont " +
  "tiny scriptsize footnotesize small normalsize large Large LARGE huge Huge " +
  "centering raggedright raggedleft par newline linebreak hfill vfill hspace vspace smallskip medskip bigskip " +
  "includegraphics column columns color textcolor colorbox fcolorbox rule strut hphantom vphantom phantom " +
  "titlepage tableofcontents insertframenumber inserttotalframenumber insertsection insertsubsection " +
  "insertframetitle insertframesubtitle inserttitle insertsubtitle insertauthor insertdate insertinstitute " +
  "LaTeX TeX beamer logo ldots dots cdots vdots ddots mathrm mathbf mathit mathsf mathtt mathcal mathbb " +
  "frac dfrac tfrac sqrt left right middle big Big bigg Bigg sum prod int iint lim log ln exp sin cos tan " +
  "alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi pi rho sigma tau upsilon phi varphi chi psi omega " +
  "Gamma Delta Theta Lambda Xi Pi Sigma Upsilon Phi Psi Omega infty partial nabla times cdot pm mp le leq ge geq ne neq approx equiv sim simeq " +
  "in notin subset subseteq supset supseteq cup cap to rightarrow leftarrow Rightarrow Leftarrow mapsto iff forall exists neg land lor lnot " +
  "overline underline hat bar vec dot ddot underbrace overbrace text operatorname ensuremath quad qquad limits nolimits " +
  "draw path node coordinate fill filldraw clip shade shadedraw foreach matrix addplot axis pgfmathparse pgfmathresult " +
  "textwidth linewidth columnwidth textheight paperwidth paperheight baselineskip relax " +
  "begingroup endgroup bgroup egroup else or fi newif"
).split(" "));

// A smaller set than LOCAL_COMMANDS: macro expansion must not hide structural
// commands, assignments or environments. Every argument token is checked too.
const FORMATTING_COMMANDS = new Set((
  "textbf textit texttt textrm textsf textsc textsl textnormal emph texorpdfstring " +
  "bfseries mdseries itshape upshape rmfamily sffamily ttfamily normalfont " +
  "tiny scriptsize footnotesize small normalsize large Large LARGE huge Huge " +
  "centering raggedright raggedleft par newline linebreak hfill vfill hspace vspace smallskip medskip bigskip " +
  "color textcolor colorbox fcolorbox rule strut ensuremath LaTeX TeX " +
  "textwidth linewidth columnwidth textheight paperwidth paperheight baselineskip relax"
).split(" "));
const FORMATTING_SYMBOLS = new Set(["\\", "{", "}", "$", "%", "&", "#", "_", " ", ",", ":", ";", "!", "/", "|", "(", ")", "[", "]", "=", "'", '"', "~", "`", "^", ">"]);
const stockFormattingCommand = (name: string) => FORMATTING_COMMANDS.has(name) || FORMATTING_SYMBOLS.has(name) || isTexMathTypesettingCommand(name);
const stockLocalCommand = (name: string) => LOCAL_COMMANDS.has(name) || stockFormattingCommand(name);

// Warn about identifiable operations, never about an unfamiliar command name.
const COUNTER_COMMANDS = new Set("setcounter addtocounter stepcounter refstepcounter".split(" "));
const SETTING_COMMANDS = new Set((
  "setbeamertemplate addtobeamertemplate setbeamercolor setbeamerfont setbeamersize " +
  "usebeamertheme usetheme usecolortheme usefonttheme useinnertheme useoutertheme " +
  "tikzset pgfkeys pgfplotsset pgfmathsetseed"
).split(" "));
const FONT_SWITCHES = new Set((
  "color bfseries mdseries itshape upshape slshape scshape rmfamily sffamily ttfamily normalfont " +
  "tiny scriptsize footnotesize small normalsize large Large LARGE huge Huge centering raggedright raggedleft"
).split(" "));
const REGISTER_COMMANDS = new Set("textwidth linewidth columnwidth textheight paperwidth paperheight baselineskip parskip parindent count dimen skip muskip toks globaldefs catcode mathcode".split(" "));
const ASSIGNMENT_COMMANDS = new Set("setlength addtolength advance multiply divide".split(" "));

/** Read definitions through the shared macro parser; keep unsupported bodies opaque. */
function definitions(syntax: TexSyntaxIndex): { definitions: Definition[]; stored: Span[] } {
  const source = syntax.source, result: Definition[] = [], stored: Span[] = [];
  let skipTo = 0;
  for (const control of syntax.controls) {
    if (control.span.from < skipTo || !STORED_COMMANDS.has(control.name)) continue;
    let end = control.span.to;
    if (control.name === "let") {
      const rest = source.slice(end);
      const match = /^\s*\\(?:[a-zA-Z@]+|.)\s*=?\s*(?:\\(?:[a-zA-Z@]+|.)|[^\s])/u.exec(rest);
      if (match) end += match[0].length;
    } else {
      // A primitive definition has a control name (and possibly parameter text)
      // before its body. LaTeX definitions have a name argument and body argument.
      const primitive = ["def", "gdef", "edef", "xdef"].includes(control.name);
      let cursor = end;
      if (primitive) {
        const body = syntax.groups.find(group => group.span.from >= cursor);
        if (body?.complete) end = body.span.to;
      } else {
        const name = syntax.argumentAfter(cursor, "required", source.length);
        if (name?.complete) cursor = name.span.to;
        else {
          const next = syntax.controls.find(item => item.span.from >= cursor);
          if (next) cursor = next.span.to;
        }
        for (let i = 0; i < 2; i++) cursor = syntax.argumentAfter(cursor, "optional", source.length)?.span.to ?? cursor;
        const body = syntax.argumentAfter(cursor, "required", source.length);
        if (body?.complete) end = body.span.to;
        if (control.name.endsWith("environment")) end = syntax.argumentAfter(end, "required", source.length)?.span.to ?? end;
      }
    }
    const span = { from: control.span.from, to: end };
    stored.push(span); skipTo = end;
    if (!DEFINITION_COMMANDS.has(control.name)) continue;
    const parsed = collectContextDefinitions(source.slice(span.from, span.to)).find(item => item.span.from === 0);
    if (!parsed || !["MacroDefinition", "MacroAlias", "MacroCommandDefinition"].includes(parsed.kind)) continue;
    if (parsed.kind !== "MacroDefinition" && parsed.kind !== "MacroAlias" && parsed.kind !== "MacroCommandDefinition") continue;
    const body = parsed.kind === "MacroDefinition" ? parsed.valueRaw : parsed.kind === "MacroAlias" ? parsed.targetRaw : parsed.bodyRaw;
    const bodySyntax = createBeamerSyntaxContext(body).syntax;
    const defaultSyntax = parsed.kind === "MacroCommandDefinition" && parsed.optionalDefaultRaw != null
      ? createBeamerSyntaxContext(parsed.optionalDefaultRaw).syntax : null;
    result.push({ name: parsed.nameRaw.replace(/^\\/u, ""), span, command: control.name, body,
      alias: parsed.kind === "MacroAlias",
      arity: parsed.kind === "MacroCommandDefinition" ? parsed.arity : 0,
      optionalDefault: parsed.kind === "MacroCommandDefinition" ? parsed.optionalDefaultRaw : undefined,
      references: [...bodySyntax.controls, ...(defaultSyntax?.controls ?? [])].map(item => item.name),
      wellFormed: bodySyntax.errors.length === 0 && (!defaultSyntax || defaultSyntax.errors.length === 0),
      literal: !/[#$&^_~]/u.test(body) && bodySyntax.errors.length === 0 &&
        (parsed.kind !== "MacroCommandDefinition" || (parsed.arity === 0 && !parsed.optionalDefaultRaw)) });
  }
  return { definitions: result, stored };
}

/** Literal foreach values are local bindings, not calls to document macros. */
function literalForeachBindings(syntax: TexSyntaxIndex, stored: Span[]): { span: Span; names: string[] }[] {
  const loops: { span: Span; names: string[] }[] = [];
  for (const control of syntax.controls) {
    if (control.name !== "foreach" || stored.some(span => inside(span, control.span))) continue;
    const list = syntax.groups.find(group => group.span.from >= control.span.to);
    if (!list?.complete) continue;
    const header = parseForeachHeaderRaw(syntax.source.slice(control.span.to, list.span.from));
    if (!header.isValid || header.optionsRaw || header.listRaw ||
      !/^\\[a-zA-Z@]+(?:\s*\/\s*\\[a-zA-Z@]+)*$/u.test(header.variablesRaw) ||
      !/^[0-9eE.,/+\-\s]+$/u.test(syntax.source.slice(list.contentSpan.from, list.contentSpan.to))) continue;
    const body = syntax.argumentAfter(list.span.to, "required", syntax.source.length);
    if (!body?.complete) continue;
    loops.push({ span: { from: control.span.to, to: body.span.to }, names: header.variablesRaw.split("/").map(name => name.trim().slice(1)) });
  }
  return loops;
}

/** Scope identities, including primitive groups and individual conditional branches. */
function scopes(syntax: TexSyntaxIndex, stored: Span[]): { scopes: Scope[]; malformed: Span[] } {
  const result: Scope[] = [], malformed: Span[] = [];
  const skip = (span: Span) => stored.some(item => inside(item, span));
  for (const group of syntax.groups) {
    if (!skip(group.span)) result.push({ id: group.span.from, span: group.contentSpan, kind: "group", opening: { from: group.span.from, to: group.contentSpan.from } });
  }
  for (const env of matchTexSyntaxEnvironments(syntax).values()) {
    if (env.name !== "document" && !skip(env.span)) result.push({ id: env.span.from, span: env.contentSpan, kind: "group", opening: env.begin.span });
  }
  const groups: { opening: Span; from: number }[] = [];
  const branches: { opening: Span; from: number; id: number; confirmed: boolean }[] = [];
  const custom = new Set<string>();
  let declaration = false;
  for (const command of syntax.controls) {
    if (skip(command.span)) continue;
    const { name, span } = command;
    if (declaration) { custom.add(name); declaration = false; continue; }
    if (name === "newif") { declaration = true; continue; }
    if (name === "begingroup" || name === "bgroup") groups.push({ opening: span, from: span.to });
    if (name === "endgroup" || name === "egroup") {
      const group = groups.pop();
      if (group) result.push({ id: group.opening.from, span: { from: group.from, to: span.from }, kind: "group", opening: group.opening });
      else malformed.push(span);
    }
    if (CONDITIONALS.has(name) || custom.has(name) || (/^if[a-z]+$/u.test(name) && name !== "ifthenelse")) branches.push({ opening: span, from: span.to, id: span.from, confirmed: CONDITIONALS.has(name) || custom.has(name) });
    if (name === "else" || name === "or" || name === "fi") {
      const branch = branches.pop();
      if (!branch) { malformed.push(span); continue; }
      result.push({ id: branch.id, span: { from: branch.from, to: span.from }, kind: "conditional", opening: branch.opening });
      if (name !== "fi") branches.push({ opening: span, from: span.to, id: span.from, confirmed: true });
    }
  }
  // An unfamiliar \if... name alone is not evidence of an unmatched TeX branch.
  // A matching \else/\or/\fi above does establish a boundary worth preserving.
  for (const open of [...groups, ...branches.filter(branch => branch.confirmed)]) malformed.push({ from: open.opening.from, to: syntax.source.length });
  return { scopes: result, malformed };
}

/** Analyze the exact proposed move. No source edits or cached safety decisions. */
export function analyzeBeamerSlideMove(source: string, edit: Extract<BeamerSlideEdit, { kind: "move" }>): BeamerSlideMoveAnalysis {
  const document = scanBeamerDocument(source), syntax = createBeamerSyntaxContext(source).syntax;
  const issues: BeamerSlideMoveIssue[] = [], dependencies: BeamerSlideMoveAnalysis["dependencies"] = [];
  const excerpt = (span: Span, label = "Source"): BeamerSlideMoveExcerpt => ({ span, label,
    line: source.slice(0, span.from).split("\n").length, text: source.slice(span.from, span.to) });
  const issue = (severity: "review" | "blocked", message: string, excerpts: BeamerSlideMoveExcerpt[]) => {
    if (!issues.some(item => item.message === message && item.excerpts[0]?.span.from === excerpts[0]?.span.from)) issues.push({ severity, message, excerpts });
  };
  const finish = (): BeamerSlideMoveAnalysis => ({ status: issues.some(item => item.severity === "blocked") ? "blocked" : issues.length ? "review" : "safe", issues, dependencies });
  const wanted = new Set(edit.frameIds), frames = document.frames.filter(frame => wanted.has(frame.id));
  const targetId = "frameId" in edit.destination ? edit.destination.frameId : null;
  let at = beamerSlideInsertionPoint(document, edit.destination);
  if (!document.documentSpan || !frames.length || frames.length !== wanted.size || at == null || frames.some(frame => !beamerSlideIsEditable(source, frame))) {
    const excerpts = frames.map(frame => excerpt(frame.span, "Slide"));
    const target = document.frames.find(frame => frame.id === targetId && !wanted.has(frame.id));
    if (target) excerpts.push(excerpt(target.beginSpan, "Destination"));
    issue("blocked", "This move would split an enclosing command or an incomplete slide.", excerpts);
    return finish();
  }
  const frameSpans = frames.map(frame => beamerSlideSourceSpan(source, frame));
  at = frameSpans.find(span => contains(span, at!))?.from ?? at;
  const destination = at;
  if (frameSpans.every((span, i) => i === 0 || frameSpans[i - 1].to === span.from) &&
    frameSpans[0].from <= at && at <= frameSpans.at(-1)!.to) return finish();
  const { definitions: defs, stored } = definitions(syntax);
  const structure = scopes(syntax, stored);
  const path = (position: number, kind?: Scope["kind"]) => structure.scopes.filter(scope => (!kind || scope.kind === kind) && contains(scope.span, position));
  const sameScope = (a: number, b: number) => path(a).map(scope => scope.id).join(",") === path(b).map(scope => scope.id).join(",");
  const affected = { from: Math.min(at, ...frameSpans.map(span => span.from)), to: Math.max(at, ...frameSpans.map(span => span.to)) };
  for (const frame of frames) {
    const from = path(frame.span.from), to = path(at);
    const end = path(frame.endSpan!.from);
    const boundary = [...from, ...to, ...end].find(scope => !from.includes(scope) || !to.includes(scope) || !end.includes(scope));
    if (boundary) issue("blocked", boundary.kind === "conditional" ? "This move crosses a conditional branch." : "This move crosses a TeX group boundary.", [excerpt(boundary.opening, "Boundary"), excerpt(frame.beginSpan, "Slide")]);
  }
  for (const span of structure.malformed) {
    if (span.from < affected.to && affected.from < span.to || contains(affected, span.from)) issue("blocked", "The surrounding TeX groups or conditionals are incomplete.", [excerpt(span, "Unmatched boundary")]);
  }
  if (issues.length) return finish();

  const movedFrame = (position: number) => frames.find(frame => contains(frame.span, position));
  const definitionAt = new Map(defs.map(def => [def.span.from, def]));
  // The offset mapping is also used for unmoved consumers and declarations.
  const mapPosition = (position: number): number => {
    const chunks = frames.flatMap(frame => [...dependencies.filter(item => item.frameId === frame.id).map(item => item.span), beamerSlideSourceSpan(source, frame)]);
    const insertion = chunks.find(span => contains(span, destination))?.from ?? destination;
    const removedBefore = (point: number) => chunks.filter(span => span.to <= point).reduce((sum, span) => sum + span.to - span.from, 0);
    const base = insertion - removedBefore(insertion);
    let offset = 0;
    for (const span of chunks) {
      if (contains(span, position)) return base + offset + position - span.from;
      offset += span.to - span.from + (source[span.to - 1] === "\n" ? 0 : 1);
    }
    return position - removedBefore(position) + (position >= insertion ? offset : 0);
  };
  const visible = (def: Definition, position: number) => path(def.span.from).every(scope => contains(scope.span, position));
  const binding = (name: string, position: number, after: boolean): Definition | undefined => {
    const order = (point: number) => after ? mapPosition(point) : point;
    const candidates = defs.filter(def => def.name === name && order(def.span.from) < order(position) && visible(def, position))
      .sort((a, b) => order(a.span.from) - order(b.span.from));
    let current: Definition | undefined;
    for (const def of candidates) if (def.command !== "providecommand" || !current) current = def;
    return current;
  };
  const loops = defs.some(def => def.name === "foreach") ? [] : literalForeachBindings(syntax, stored).reverse();
  const loopVariable = (name: string, at: number, after = false): boolean => {
    const loop = loops.find(loop => contains(loop.span, at) && loop.names.includes(name));
    if (!loop) return false;
    const provider = binding(name, at, after);
    // An explicit definition inside the loop can override an iteration variable.
    return !provider || provider.span.from < loop.span.from;
  };
  const knownNames = new Set(defs.map(def => def.name));
  const usages = syntax.controls.filter(control => !stored.some(span => inside(span, control.span)) && knownNames.has(control.name));
  type Use = { name: string; at: number; span: Span; before?: Definition; after?: Definition };
  const resolveUses = (): Use[] => {
    const result: Use[] = [];
    const walk = (name: string, position: number, span: Span, seen: Set<string>, beforeAt = position, afterAt = position) => {
      if (seen.has(name) || (loopVariable(name, beforeAt) && loopVariable(name, afterAt, true))) return;
      const before = binding(name, beforeAt, false), after = binding(name, afterAt, true);
      result.push({ name, at: position, span, before, after });
      const next = new Set([...seen, name]);
      for (const dependency of new Set([...(before?.references ?? []), ...(after?.references ?? [])])) {
        if (knownNames.has(dependency)) walk(dependency, position, span, next,
          before?.alias ? before.span.from : position, after?.alias ? after.span.from : position);
      }
    };
    for (const use of usages) walk(use.name, use.span.from, use.span, new Set());
    // Aliases capture their target when declared, even if never expanded later.
    for (const def of defs.filter(item => item.alias)) for (const name of def.references) walk(name, def.span.from, def.span, new Set());
    return result;
  };
  const canRelocate = (def: Definition, seen = new Set<Definition>()): boolean => {
    if (!def.literal || seen.has(def) || stockLocalCommand(def.name) || CONDITIONALS.has(def.name) || STORED_COMMANDS.has(def.name)) return false;
    const next = new Set([...seen, def]);
    return def.references.every(name => {
      const candidates = defs.filter(item => item.name === name);
      return candidates.length === 1 && canRelocate(candidates[0], next);
    });
  };
  // This proof is used only for automatic relocation. An opaque expansion can
  // hide consumers, but uncertainty is not evidence of a state-changing operation.
  const hasInspectableExpansion = (def: Definition, at: number, after: boolean, seen = new Set<Definition>()): boolean => {
    if (!def.wellFormed || seen.has(def)) return false;
    const next = new Set([...seen, def]);
    return def.references.every(name => {
      const position = def.alias ? def.span.from : at;
      if (loopVariable(name, position, after)) return true;
      const provider = binding(name, position, after);
      if (provider) return hasInspectableExpansion(provider, at, after, next);
      const candidates = defs.filter(candidate => candidate.name === name);
      if (candidates.some(candidate => path(candidate.span.from, "conditional").length > 0)) return false;
      // Missing literal dependencies are handled by the binding comparison and
      // may be carried with their consumers. They cannot conceal side effects.
      if (candidates.length && candidates.every(candidate => canRelocate(candidate))) return true;
      return stockFormattingCommand(name);
    });
  };
  const opaqueConsumers = syntax.controls.filter(control => {
    const environment = syntax.environmentBoundaryByStart.get(control.span.from);
    const storedSpan = stored.find(span => contains(span, control.span.from));
    if (storedSpan) {
      if (storedSpan.from !== control.span.from) return false;
      const declaration = definitionAt.get(control.span.from);
      return !declaration || stockLocalCommand(declaration.name) || CONDITIONALS.has(declaration.name) ||
        path(control.span.from, "conditional").length > 0;
    }
    if (loopVariable(control.name, control.span.from) && loopVariable(control.name, control.span.from, true)) return false;
    if (environment?.kind === "begin" && !LOCAL_ENVIRONMENTS.has(environment.name)) return true;
    // Formatting outside a frame persists into following frames; the same
    // command inside a frame is local. Section titles are ordinary consumers.
    if (!document.frames.some(frame => inside(frame.span, control.span)) &&
      !document.sections.some(section => inside(section.span, control.span)) &&
      !STRUCTURAL_COMMANDS.has(control.name) && !CONDITIONALS.has(control.name)) return true;
    if (knownNames.has(control.name)) {
      const before = binding(control.name, control.span.from, false), after = binding(control.name, control.span.from, true);
      if ((before && !hasInspectableExpansion(before, control.span.from, false)) ||
        (after && !hasInspectableExpansion(after, control.span.from, true))) return true;
      if (!before && defs.some(def => def.name === control.name && path(def.span.from, "conditional").length > 0)) return true;
      return !before && !after && !stockFormattingCommand(control.name);
    }
    return control.kind !== "symbol" && !stockLocalCommand(control.name) && !CONDITIONALS.has(control.name);
  }).filter(control => control.span.from >= document.documentBodySpan.from);
  // Unknown commands can hide uses of private definitions. Do not relocate their
  // providers on the assumption that every consumer was visible to this scan.
  if (!opaqueConsumers.length) {
    for (let pass = 0; pass <= defs.length; pass++) {
      const uses = resolveUses();
      let added = false;
      for (const use of uses.filter(use => use.before && use.before !== use.after)) {
        const def = use.before!, consumers = uses.filter(item => item.name === def.name);
        const owners = consumers.map(item => movedFrame(item.at) ?? frames.find(frame => dependencies.some(dependency => dependency.frameId === frame.id && contains(dependency.span, item.at))));
        if (owners.some(owner => !owner) || !owners.length || movedFrame(def.span.from) || dependencies.some(item => inside(item.span, def.span)) ||
          defs.some(other => other.references.includes(def.name) && !movedFrame(other.span.from) && !dependencies.some(item => inside(item.span, other.span))) ||
          !canRelocate(def) || defs.filter(item => item.name === def.name).length !== 1 || def.span.from < document.documentBodySpan.from ||
          !sameScope(def.span.from, destination) || !sameScope(def.span.from, owners[0]!.span.from)) continue;
        // Carry exact declaration lines and attached comments, only when they do
        // not include another declaration/frame. Shared aliases count as consumers.
        const span = beamerSlideSourceSpan(source, { span: def.span });
        if (frameSpans.some(item => item.from < span.to && span.from < item.to) || dependencies.some(item => item.span.from < span.to && span.from < item.span.to)) continue;
        const owner = frames.find(frame => owners.includes(frame))!;
        dependencies.push({ frameId: owner.id, span }); added = true;
      }
      dependencies.sort((a, b) => a.span.from - b.span.from);
      if (!added) break;
    }
  }
  for (const use of resolveUses()) {
    if (use.before === use.after) continue;
    const frame = document.frames.find(frame => contains(frame.span, use.at));
    const subject = frame ? `“${frame.title?.value?.trim() ? frame.title.value : `Slide ${document.frames.indexOf(frame) + 1}`}”` : "This source";
    const excerpts = [excerpt(use.span, "Use"), ...(use.before ? [excerpt(use.before.span, "Current definition")] : []), ...(use.after ? [excerpt(use.after.span, "Definition after move")] : [])];
    issue(use.before && !use.after ? "blocked" : "review", use.before && !use.after ? `${subject} would lose the definition of \\${use.name}.` : `${subject} would use a different definition of \\${use.name}.`, excerpts);
  }
  for (const def of defs) {
    if (!["newcommand", "renewcommand", "providecommand", "DeclareRobustCommand"].includes(def.command)) continue;
    if (binding(def.name, def.span.from, false) !== binding(def.name, def.span.from, true)) issue("review", `The move changes the existing binding at \\${def.command}{\\${def.name}}.`, [excerpt(def.span, "Declaration")]);
  }
  // Follow understood invocations with their actual arguments. Stored bodies and
  // unused arguments are not executed. Cycles, dynamic names, package commands and
  // failed expansions remain quiet. This intentionally is not a TeX safety proof.
  let expansionBudget = 2_000;
  const inspectEffects = (index: TexSyntaxIndex, after: boolean, invocation?: Span,
    trail: Definition[] = [], seen = new Set<Definition>(), enclosingLocal = false, inheritedGlobal = false) => {
    const nested = invocation != null;
    const declarations = nested ? definitions(index) : { definitions: defs, stored };
    const localScopes = nested ? scopes(index, declarations.stored).scopes : structure.scopes;
    const generatedLoops = nested && ![...defs, ...declarations.definitions].some(def => def.name === "foreach")
      ? literalForeachBindings(index, declarations.stored) : [];
    // Preserve offsets while letting the shared argument reader skip TeX comments.
    let argumentSource = index.source;
    for (const comment of [...index.comments].reverse()) argumentSource = argumentSource.slice(0, comment.from) +
      argumentSource.slice(comment.from, comment.to).replace(/[^\n]/gu, " ") + argumentSource.slice(comment.to);
    let skipTo = 0, global = inheritedGlobal, prefixFrom: number | undefined;
    for (const control of index.controls) {
      if (control.span.from < skipTo || (!nested && control.span.from < document.documentBodySpan.from)) continue;
      const position = invocation?.from ?? control.span.from;
      if (!nested && !contains(affected, position)) continue;
      const local = enclosingLocal || localScopes.some(scope => scope.kind === "group" && contains(scope.span, control.span.from));
      const storedSpan = declarations.stored.find(span => contains(span, control.span.from));
      if (storedSpan && storedSpan.from !== control.span.from) continue;
      if (control.name === "global") { global = true; prefixFrom ??= control.span.from; continue; }
      if (["long", "outer", "protected"].includes(control.name)) continue;
      let end = control.span.to;
      for (;;) {
        const argument = index.argumentAfter(end, "required", index.source.length) ?? index.argumentAfter(end, "optional", index.source.length) ?? index.argumentAfter(end, "overlay", index.source.length);
        if (!argument?.complete) break;
        end = argument.span.to;
      }
      const commandSpan = { from: prefixFrom ?? control.span.from, to: storedSpan?.to ?? end };
      const origin = invocation ?? commandSpan;
      const report = (reason: string, command = control.name, definitions = trail) => {
        issue("review",
          `${invocation ? "This macro executes" : "This move crosses"} \\${command}, which ${reason}.`,
          [excerpt(origin, invocation ? "Macro use" : "Operation"), ...definitions.map(def => excerpt(def.span, "Definition"))]);
      };
      if (storedSpan) {
        const def = declarations.definitions.find(def => def.span.from === control.span.from);
        if (global || ["gdef", "xdef"].includes(control.name)) report("defines a macro globally");
        else if (!local && (nested || !def || stockLocalCommand(def.name) || CONDITIONALS.has(def.name) ||
          localScopes.some(scope => scope.kind === "conditional" && contains(scope.span, control.span.from)))) {
          report("changes definitions available to subsequent slides");
        }
        skipTo = storedSpan.to;
      } else if (nested && declarations.definitions.some(def => def.name === control.name && def.span.to <= control.span.from &&
        localScopes.filter(scope => contains(scope.span, def.span.from)).every(scope => contains(scope.span, control.span.from)))) {
        // Generated bindings are not in the source-level resolver. Do not mistake
        // a shadowed outer definition for the operation this invocation executes.
        skipTo = end;
      } else if (!loopVariable(control.name, position, after) &&
        !generatedLoops.some(loop => contains(loop.span, control.span.from) && loop.names.includes(control.name))) {
        let provider = binding(control.name, position, after);
        const providers: Definition[] = [];
        let name = control.name;
        // A let alias captures its target at declaration time; references in the
        // captured body still resolve at the invocation, just as in resolveUses.
        while (provider?.alias && !seen.has(provider) && !providers.includes(provider)) {
          providers.push(provider); name = provider.references[0] ?? "";
          provider = binding(name, provider.span.from, after);
        }
        if (provider) {
          const args = parseMacroInvocationArgs(argumentSource, control.span.to, provider.arity, provider.optionalDefault);
          skipTo = args?.nextIndex ?? end;
          if (args && !seen.has(provider) && !providers.includes(provider) && seen.size < 64 && expansionBudget-- > 0) {
            const expanded = applyMacroArguments(provider.body, args.values);
            // Bound malformed/exponentially growing input without adding warnings.
            if (expanded.length <= 100_000) inspectEffects(createBeamerSyntaxContext(expanded).syntax, after,
              invocation ?? { from: control.span.from, to: args.nextIndex }, [...trail, ...providers, provider],
              new Set([...seen, ...providers, provider]), local, global);
          }
        } else {
          const definitionTrail = [...trail, ...providers];
          if (STORED_COMMANDS.has(name)) {
            if (global || ["gdef", "xdef"].includes(name)) report("defines a macro globally", name, definitionTrail);
            else if (!local) report("changes definitions available to subsequent slides", name, definitionTrail);
            skipTo = end;
          } else if (COUNTER_COMMANDS.has(name)) { report("changes a counter", name, definitionTrail); skipTo = end; }
          else if ((global || !local) && SETTING_COMMANDS.has(name)) { report("changes settings used by subsequent slides", name, definitionTrail); skipTo = end; }
          else if ((global || !local) && FONT_SWITCHES.has(name)) report("changes formatting used by subsequent slides", name, definitionTrail);
          else if ((global || !local) && (ASSIGNMENT_COMMANDS.has(name) ||
            (REGISTER_COMMANDS.has(name) && /^\s*(?:\d+\s*)?=/u.test(index.source.slice(control.span.to))))) {
            report("assigns a value used by subsequent slides", name, definitionTrail); skipTo = end;
          } else if (name === "newif") {
            if (!local || global) report("defines a conditional", name, definitionTrail);
            skipTo = index.controls.find(item => item.span.from >= control.span.to)?.span.to ?? end;
          } else if (!stockLocalCommand(name)) {
            // We do not know whether an unknown command executes its arguments.
            skipTo = end;
          }
        }
      }
      global = false; prefixFrom = undefined;
    }
  };
  inspectEffects(syntax, false);
  expansionBudget = 2_000;
  inspectEffects(syntax, true);
  return finish();
}
