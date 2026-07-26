import type { Span } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { formatDocumentRootId } from "../document/root-id.js";
import { parseOptionListRaw } from "../options/parse.js";
import { scanTikzFigures } from "../parser/figure-scan.js";
import { collectContextDefinitions } from "../transform/cst-to-ast.js";
import {
  createBeamerSyntaxContext,
  readBeamerOptionalArgument,
  readBeamerOverlayArgument,
  readBeamerRequiredArgument,
  scanBeamerControlSequences,
  scanBeamerEnvironmentTokens,
  type BeamerControlSequence,
  type BeamerEnvironmentToken,
  type BeamerSyntaxContext,
} from "./syntax.js";
import type {
  BeamerDelimitedSourceValue,
  BeamerDocumentClassModel,
  BeamerDocumentModel,
  BeamerFrameModel,
  BeamerFrameOption,
  BeamerFrameOptions,
  BeamerMetadataFieldModel,
  BeamerMetadataFieldName,
  BeamerPreambleModel,
  BeamerSectionModel,
  BeamerTheoremDeclarationModel,
  BeamerTheoremStyle,
  BeamerTheoremTemplateVariant,
  BeamerThemeKind,
  BeamerThemeUseModel,
  BeamerTikzPictureRoot,
} from "./types.js";

type DocumentRange = {
  documentSpan: Span | null;
  bodySpan: Span;
  preambleSpan: Span;
};

type FrameCandidate = {
  begin: BeamerEnvironmentToken;
  end: BeamerEnvironmentToken | null;
};

const THEME_COMMANDS = new Map<string, BeamerThemeKind>([
  ["usetheme", "theme"],
  ["usecolortheme", "color-theme"],
  ["usefonttheme", "font-theme"],
  ["useinnertheme", "inner-theme"],
  ["useoutertheme", "outer-theme"],
]);

const METADATA_COMMANDS = new Set<BeamerMetadataFieldName>([
  "title",
  "subtitle",
  "author",
  "institute",
  "date",
]);

/**
 * Scan source syntax only; this does not execute TeX.
 *
 * The accepted frame head order and the option semantics below follow
 * TeX Live 2025's `beamerbaseframe.sty`: `\beamer@copewithframeenv`,
 * `\beamer@framecommand`, `\beamer@@@@frame`, and the `beamerframe` keys.
 */
export function scanBeamerDocument(source: string): BeamerDocumentModel {
  return scanBeamerDocumentWithSyntax(createBeamerSyntaxContext(source));
}

export function scanBeamerDocumentWithSyntax(
  syntaxContext: BeamerSyntaxContext
): BeamerDocumentModel {
  const { source } = syntaxContext;
  const diagnostics: Diagnostic[] = [];
  const documentRange = findDocumentRange(
    syntaxContext,
    diagnostics
  );
  const frameCandidates = collectFrameCandidates(
    syntaxContext,
    documentRange.bodySpan,
    diagnostics
  );
  const preliminaryFrames = frameCandidates.map((candidate, index) =>
    buildFrameModel(syntaxContext, candidate, index)
  );
  const sections = scanSections(
    syntaxContext,
    documentRange.bodySpan,
    preliminaryFrames,
    diagnostics
  );
  const frames = associateFramesWithSections(preliminaryFrames, sections);
  const roots = [...sections, ...frames].sort(
    (left, right) => left.span.from - right.span.from
  );

  roots.forEach((root, sourceOrder) => {
    root.sourceOrder = sourceOrder;
  });

  return {
    source,
    documentSpan: documentRange.documentSpan,
    documentBodySpan: documentRange.bodySpan,
    preamble: scanPreamble(syntaxContext, documentRange.preambleSpan),
    sections,
    frames,
    roots,
    diagnostics,
  };
}

function findDocumentRange(
  context: BeamerSyntaxContext,
  diagnostics: Diagnostic[]
): DocumentRange {
  const { source } = context;
  const tokens = scanBeamerEnvironmentTokens(context, {
    from: 0,
    to: source.length,
  });
  const begin = tokens.find(
    (token) => token.kind === "begin" && token.name === "document"
  );
  if (!begin) {
    diagnostics.push({
      severity: "warning",
      code: "beamer-missing-document",
      message: "No \\\\begin{document} was found; scanning the complete source.",
      span: { from: 0, to: Math.min(source.length, 1) },
    });
    return {
      documentSpan: null,
      bodySpan: { from: 0, to: source.length },
      preambleSpan: { from: 0, to: source.length },
    };
  }

  const end = tokens.find(
    (token) =>
      token.kind === "end" &&
      token.name === "document" &&
      token.span.from >= begin.span.to
  );
  if (!end) {
    diagnostics.push({
      severity: "error",
      code: "beamer-unterminated-document",
      message: "The document environment has no matching \\\\end{document}.",
      span: begin.span,
    });
  }

  const bodyTo = end?.span.from ?? source.length;
  return {
    documentSpan: {
      from: begin.span.from,
      to: end?.span.to ?? source.length,
    },
    bodySpan: { from: begin.span.to, to: bodyTo },
    preambleSpan: { from: 0, to: begin.span.from },
  };
}

function collectFrameCandidates(
  context: BeamerSyntaxContext,
  range: Span,
  diagnostics: Diagnostic[]
): FrameCandidate[] {
  const tokens = scanBeamerEnvironmentTokens(context, range).filter(
    (token) => token.name === "frame"
  );
  const candidates: FrameCandidate[] = [];
  let open: { begin: BeamerEnvironmentToken; depth: number } | null = null;

  for (const token of tokens) {
    if (token.kind === "begin") {
      if (!open) {
        open = { begin: token, depth: 1 };
        continue;
      }
      open.depth += 1;
      diagnostics.push({
        severity: "error",
        code: "beamer-nested-frame",
        message: "Beamer frame environments cannot be nested.",
        span: token.span,
      });
      continue;
    }

    if (!open) {
      diagnostics.push({
        severity: "error",
        code: "beamer-unmatched-frame-end",
        message: "This \\\\end{frame} has no matching frame start.",
        span: token.span,
      });
      continue;
    }

    open.depth -= 1;
    if (open.depth === 0) {
      candidates.push({ begin: open.begin, end: token });
      open = null;
    }
  }

  if (open) {
    candidates.push({ begin: open.begin, end: null });
    diagnostics.push({
      severity: "error",
      code: "beamer-unterminated-frame",
      message: "The frame environment has no matching \\\\end{frame}.",
      span: open.begin.span,
    });
  }

  return candidates;
}

function buildFrameModel(
  context: BeamerSyntaxContext,
  candidate: FrameCandidate,
  index: number
): BeamerFrameModel {
  const { source } = context;
  const frameEnd = candidate.end?.span.from ?? source.length;
  const header = scanFrameHeader(context, candidate.begin.span.to, frameEnd);
  const bodySpan = { from: header.headerSpan.to, to: frameEnd };
  const id = formatDocumentRootId({ kind: "beamer-frame", index });
  const children = scanFrameTikzPictures(source, bodySpan, index);
  const title =
    header.title ??
    scanFirstCommandValue(context, bodySpan, "frametitle", children);
  const subtitle =
    header.subtitle ??
    scanFirstCommandValue(context, bodySpan, "framesubtitle", children);

  return {
    kind: "frame",
    id,
    sourceOrder: index,
    span: {
      from: candidate.begin.span.from,
      to: candidate.end?.span.to ?? source.length,
    },
    beginSpan: candidate.begin.span,
    endSpan: candidate.end?.span ?? null,
    headerSpan: header.headerSpan,
    bodySpan,
    overlay: header.overlay,
    options: header.options
      ? parseFrameOptions(source, header.options)
      : undefined,
    title,
    subtitle,
    sectionId: null,
    subsectionId: null,
    children,
  };
}

function scanFrameHeader(
  context: BeamerSyntaxContext,
  from: number,
  frameEnd: number
): {
  headerSpan: Span;
  overlay?: BeamerDelimitedSourceValue;
  options?: BeamerDelimitedSourceValue;
  title?: BeamerDelimitedSourceValue;
  subtitle?: BeamerDelimitedSourceValue;
} {
  let cursor = from;
  let headerEnd = from;

  const overlay =
    readBeamerOverlayArgument(context, cursor, frameEnd) ?? undefined;
  if (overlay) {
    headerEnd = overlay.span.to;
    cursor = overlay.span.to;
  }

  const options =
    readBeamerOptionalArgument(context, cursor, frameEnd) ?? undefined;
  if (options) {
    headerEnd = options.span.to;
    cursor = options.span.to;
  }

  const title =
    readBeamerRequiredArgument(context, cursor, frameEnd) ?? undefined;
  if (title) {
    headerEnd = title.span.to;
    cursor = title.span.to;
  }

  const subtitle =
    readBeamerRequiredArgument(context, cursor, frameEnd) ?? undefined;
  if (subtitle) {
    headerEnd = subtitle.span.to;
  }

  return {
    headerSpan: { from, to: headerEnd },
    overlay,
    options,
    title,
    subtitle,
  };
}

function parseFrameOptions(
  source: string,
  options: BeamerDelimitedSourceValue
): BeamerFrameOptions {
  const optionList = parseOptionListRaw(
    source.slice(options.span.from, options.span.to),
    options.span.from
  );
  const entries: BeamerFrameOption[] = optionList.entries.map((entry) => {
    if (entry.kind === "kv") {
      return {
        span: entry.span,
        keySpan: entry.keySpan ?? entry.span,
        valueSpan: entry.valueSpan ?? undefined,
        key: entry.key,
        value: entry.valueRaw,
      };
    }
    return {
      span: entry.span,
      keySpan: entry.kind === "flag"
        ? entry.keySpan ?? entry.span
        : entry.span,
      key: entry.kind === "flag" ? entry.key : entry.raw.trim(),
      value: undefined,
    };
  });
  let alignment: BeamerFrameOptions["alignment"] = "center";
  let fragile = false;
  let plain = false;
  let label: string | undefined;

  for (const entry of entries) {
    if (entry.key === "t") {
      alignment = "top";
    } else if (entry.key === "b") {
      alignment = "bottom";
    } else if (entry.key === "c") {
      alignment = "center";
    } else if (
      entry.key === "fragile" ||
      entry.key === "containsverbatim"
    ) {
      fragile = entry.value !== "false";
    } else if (entry.key === "plain") {
      plain = entry.value !== "false";
    } else if (entry.key === "label") {
      label = entry.value;
    }
  }

  return {
    source: options,
    entries,
    alignment,
    fragile,
    plain,
    label,
  };
}

function scanFrameTikzPictures(
  source: string,
  bodySpan: Span,
  frameIndex: number
): BeamerTikzPictureRoot[] {
  const body = source.slice(bodySpan.from, bodySpan.to);
  return scanTikzFigures(body)
    .filter((figure) => !figure.isTemplate)
    .map((figure, index) => ({
      kind: "tikzpicture",
      id: formatDocumentRootId({
        kind: "beamer-frame-tikz",
        frameIndex,
        index,
      }),
      span: shiftSpan(figure.span, bodySpan.from),
      beginSpan: shiftSpan(figure.beginSpan, bodySpan.from),
      endSpan: shiftSpan(figure.endSpan, bodySpan.from),
    }));
}

function scanSections(
  context: BeamerSyntaxContext,
  range: Span,
  frames: readonly BeamerFrameModel[],
  diagnostics: Diagnostic[]
): BeamerSectionModel[] {
  const sections: BeamerSectionModel[] = [];
  for (const command of scanBeamerControlSequences(context, range)) {
    if (
      (command.name !== "section" && command.name !== "subsection") ||
      isInsideAnyFrame(command.from, frames)
    ) {
      continue;
    }

    let argumentCursor = command.to;
    const overlay = readBeamerOverlayArgument(
      context,
      argumentCursor,
      range.to
    );
    if (overlay) {
      argumentCursor = overlay.span.to;
    }
    const shortTitle =
      readBeamerOptionalArgument(context, argumentCursor, range.to) ??
      undefined;
    if (shortTitle) {
      argumentCursor = shortTitle.span.to;
    }
    const title = readBeamerRequiredArgument(
      context,
      argumentCursor,
      range.to
    );
    if (!title) {
      diagnostics.push({
        severity: "warning",
        code: "beamer-section-missing-title",
        message: `\\\\${command.name} has no complete title argument.`,
        span: { from: command.from, to: command.to },
      });
      continue;
    }

    sections.push({
      kind: "section",
      id: `section:${sections.length}`,
      sourceOrder: sections.length,
      level: command.name === "section" ? 1 : 2,
      starred: command.starred,
      span: { from: command.from, to: title.span.to },
      commandSpan: { from: command.from, to: command.to },
      shortTitle,
      title,
      parentSectionId: null,
    });
  }

  let currentSectionId: string | null = null;
  for (const section of sections) {
    if (section.level === 1) {
      currentSectionId = section.id;
    } else {
      section.parentSectionId = currentSectionId;
    }
  }
  return sections;
}

function associateFramesWithSections(
  frames: readonly BeamerFrameModel[],
  sections: readonly BeamerSectionModel[]
): BeamerFrameModel[] {
  return frames.map((frame) => {
    let sectionId: string | null = null;
    let subsectionId: string | null = null;
    for (const section of sections) {
      if (section.span.from > frame.span.from) {
        break;
      }
      if (section.level === 1) {
        sectionId = section.id;
        subsectionId = null;
      } else {
        subsectionId = section.id;
      }
    }
    return { ...frame, sectionId, subsectionId };
  });
}

function scanPreamble(
  context: BeamerSyntaxContext,
  span: Span
): BeamerPreambleModel {
  const { source } = context;
  const controls = scanBeamerControlSequences(context, span);
  let documentClass: BeamerDocumentClassModel | null = null;
  const themes: BeamerThemeUseModel[] = [];
  const metadata: BeamerPreambleModel["metadata"] = {};
  const atBeginSectionSpans: Span[] = [];
  const macroDefinitions = collectContextDefinitions(
    source.slice(0, span.to)
  ).filter((statement) =>
    statement.kind === "MacroDefinition" ||
    statement.kind === "MacroAlias" ||
    statement.kind === "MacroCommandDefinition"
  );

  for (const command of controls) {
    if (command.name === "documentclass" && !documentClass) {
      documentClass = readDocumentClass(context, command, span.to);
      continue;
    }
    const themeKind = THEME_COMMANDS.get(command.name);
    if (themeKind) {
      const theme = readThemeUse(context, command, themeKind, span.to);
      if (theme) {
        themes.push(theme);
      }
      continue;
    }
    if (METADATA_COMMANDS.has(command.name as BeamerMetadataFieldName)) {
      const name = command.name as BeamerMetadataFieldName;
      if (!metadata[name]) {
        const field = readMetadataField(context, command, name, span.to);
        if (field) {
          metadata[name] = field;
        }
      }
      continue;
    }
    if (command.name === "AtBeginSection") {
      const value = readCommandMainArgument(
        context,
        command.to,
        span.to
      );
      atBeginSectionSpans.push({
        from: command.from,
        to: value?.span.to ?? command.to,
      });
    }
  }

  const theoremDeclarations = scanBeamerTheoremDeclarations({
    context,
    span,
    controls,
    documentClass,
    excludedSpans: macroDefinitions.map((definition) => definition.span),
  });
  return {
    span,
    documentClass,
    themes,
    metadata,
    atBeginSectionSpans,
    theoremDeclarations,
    theoremTemplate: scanBeamerTheoremTemplate(
      context,
      span,
      controls,
      macroDefinitions.map((definition) => definition.span)
    ),
    macroDefinitions,
  };
}

function scanBeamerTheoremDeclarations(params: {
  context: BeamerSyntaxContext;
  span: Span;
  controls: readonly BeamerControlSequence[];
  documentClass: BeamerDocumentClassModel | null;
  excludedSpans: readonly Span[];
}): BeamerTheoremDeclarationModel[] {
  const classOptions = new Set(
    params.documentClass?.options?.value
      .split(",")
      .map((option) => option.trim())
      .filter(Boolean) ?? []
  );
  const declarations = classOptions.has("notheorems") ||
      classOptions.has("noamsthm")
    ? []
    : builtInBeamerTheoremDeclarations(
        params.documentClass?.span ?? { from: 0, to: 0 },
        classOptions.has("envcountsect")
      );
  let style: BeamerTheoremStyle = "plain";

  for (const command of params.controls) {
    if (params.excludedSpans.some((span) =>
      command.from >= span.from && command.from < span.to
    )) {
      continue;
    }
    if (command.name === "theoremstyle") {
      const value = readBeamerRequiredArgument(
        params.context,
        command.to,
        params.span.to
      );
      if (value) {
        style = normalizeBeamerTheoremStyle(value.value);
      }
      continue;
    }
    if (command.name !== "newtheorem") {
      continue;
    }
    const declaration = readBeamerTheoremDeclaration(
      params.context,
      command,
      params.span.to,
      style
    );
    if (declaration) {
      declarations.push(declaration);
    }
  }
  return declarations;
}

function readBeamerTheoremDeclaration(
  context: BeamerSyntaxContext,
  command: BeamerControlSequence,
  limit: number,
  style: BeamerTheoremStyle
): BeamerTheoremDeclarationModel | null {
  const name = readBeamerRequiredArgument(context, command.to, limit);
  if (!name || name.value.trim().length === 0) {
    return null;
  }
  let cursor = name.span.to;
  const shared = readBeamerOptionalArgument(context, cursor, limit);
  if (shared) {
    cursor = shared.span.to;
  }
  const displayName = readBeamerRequiredArgument(context, cursor, limit);
  if (!displayName) {
    return null;
  }
  cursor = displayName.span.to;
  const within = shared
    ? null
    : readBeamerOptionalArgument(context, cursor, limit);
  if (within) {
    cursor = within.span.to;
  }
  const environmentName = name.value.trim();
  return {
    kind: "theorem-declaration",
    name: environmentName,
    span: { from: command.from, to: cursor },
    commandSpan: { from: command.from, to: command.to },
    nameSource: name,
    displayName,
    style,
    counter: command.starred ? null : environmentName,
    ...(shared ? { sharedCounter: shared.value.trim() } : {}),
    ...(within ? { within: within.value.trim() } : {}),
    starred: command.starred,
    builtIn: false,
  };
}

function builtInBeamerTheoremDeclarations(
  owner: Span,
  withinSection: boolean
): BeamerTheoremDeclarationModel[] {
  const definitions: Array<{
    name: string;
    displayName: string;
    style: BeamerTheoremStyle;
    sharedCounter?: string;
  }> = [
    { name: "theorem", displayName: "Theorem", style: "plain" },
    {
      name: "corollary",
      displayName: "Corollary",
      style: "plain",
      sharedCounter: "theorem",
    },
    {
      name: "fact",
      displayName: "Fact",
      style: "plain",
      sharedCounter: "theorem",
    },
    {
      name: "lemma",
      displayName: "Lemma",
      style: "plain",
      sharedCounter: "theorem",
    },
    {
      name: "problem",
      displayName: "Problem",
      style: "plain",
      sharedCounter: "theorem",
    },
    {
      name: "solution",
      displayName: "Solution",
      style: "plain",
      sharedCounter: "theorem",
    },
    {
      name: "definition",
      displayName: "Definition",
      style: "definition",
      sharedCounter: "theorem",
    },
    {
      name: "definitions",
      displayName: "Definitions",
      style: "definition",
      sharedCounter: "theorem",
    },
    {
      name: "example",
      displayName: "Example",
      style: "example",
      sharedCounter: "theorem",
    },
    {
      name: "examples",
      displayName: "Examples",
      style: "example",
      sharedCounter: "theorem",
    },
    {
      name: "Beispiel",
      displayName: "Beispiel",
      style: "example",
      sharedCounter: "theorem",
    },
    {
      name: "Beispiele",
      displayName: "Beispiele",
      style: "example",
      sharedCounter: "theorem",
    },
    {
      name: "Loesung",
      displayName: String.raw`L\"osung`,
      style: "plain",
      sharedCounter: "theorem",
    },
    {
      name: "Satz",
      displayName: "Satz",
      style: "plain",
      sharedCounter: "theorem",
    },
    {
      name: "Folgerung",
      displayName: "Folgerung",
      style: "plain",
      sharedCounter: "theorem",
    },
    {
      name: "Fakt",
      displayName: "Fakt",
      style: "plain",
      sharedCounter: "theorem",
    },
    {
      name: "Lemma",
      displayName: "Lemma",
      style: "plain",
      sharedCounter: "theorem",
    },
    {
      name: "Theorem",
      displayName: "Theorem",
      style: "plain",
      sharedCounter: "theorem",
    },
    {
      name: "Problem",
      displayName: "Problem",
      style: "plain",
      sharedCounter: "theorem",
    },
    {
      name: "Corollary",
      displayName: "Corollary",
      style: "plain",
      sharedCounter: "theorem",
    },
    {
      name: "Example",
      displayName: "Example",
      style: "example",
      sharedCounter: "theorem",
    },
    {
      name: "Examples",
      displayName: "Examples",
      style: "example",
      sharedCounter: "theorem",
    },
    {
      name: "Definition",
      displayName: "Definition",
      style: "definition",
      sharedCounter: "theorem",
    },
  ];
  return definitions.map((definition) => {
    const sourceValue: BeamerDelimitedSourceValue = {
      span: owner,
      contentSpan: owner,
      value: definition.name,
    };
    return {
      kind: "theorem-declaration",
      name: definition.name,
      span: owner,
      commandSpan: owner,
      nameSource: sourceValue,
      displayName: {
        span: owner,
        contentSpan: owner,
        value: definition.displayName,
      },
      style: definition.style,
      counter: definition.name === "theorem"
        ? "theorem"
        : definition.sharedCounter ?? definition.name,
      ...(definition.sharedCounter
        ? { sharedCounter: definition.sharedCounter }
        : {}),
      ...(definition.name === "theorem" && withinSection
        ? { within: "section" }
        : {}),
      starred: false,
      builtIn: true,
    };
  });
}

function normalizeBeamerTheoremStyle(value: string): BeamerTheoremStyle {
  const normalized = value.trim().toLowerCase();
  return normalized === "example"
    ? "example"
    : normalized === "definition"
      ? "definition"
      : normalized === "remark"
        ? "remark"
        : "plain";
}

function scanBeamerTheoremTemplate(
  context: BeamerSyntaxContext,
  span: Span,
  controls: readonly BeamerControlSequence[],
  excludedSpans: readonly Span[]
): BeamerTheoremTemplateVariant {
  let result: BeamerTheoremTemplateVariant = "default";
  for (const command of controls) {
    if (
      command.name !== "setbeamertemplate" ||
      excludedSpans.some((excluded) =>
        command.from >= excluded.from && command.from < excluded.to
      )
    ) {
      continue;
    }
    const template = readBeamerRequiredArgument(
      context,
      command.to,
      span.to
    );
    if (template?.value.trim() !== "theorems") {
      continue;
    }
    const variant = readBeamerOptionalArgument(
      context,
      template.span.to,
      span.to
    )?.value.trim().toLowerCase();
    if (variant === "numbered") {
      result = "numbered";
    } else if (variant === "ams style") {
      result = "ams-style";
    } else if (variant === "normal font") {
      result = "normal-font";
    } else if (variant === "default") {
      result = "default";
    }
  }
  return result;
}

/**
 * Read the first \documentclass declaration without scanning document
 * structure. Document-kind detection consumes this directly.
 */
export function scanBeamerDocumentClass(
  source: string
): BeamerDocumentClassModel | null {
  const context = createBeamerSyntaxContext(source);
  const controls = scanBeamerControlSequences(context, {
    from: 0,
    to: source.length,
  });
  for (const command of controls) {
    if (command.name === "documentclass") {
      return readDocumentClass(context, command, source.length);
    }
  }
  return null;
}

function readDocumentClass(
  context: BeamerSyntaxContext,
  command: BeamerControlSequence,
  limit: number
): BeamerDocumentClassModel | null {
  const options =
    readBeamerOptionalArgument(context, command.to, limit) ?? undefined;
  const className = readBeamerRequiredArgument(
    context,
    options?.span.to ?? command.to,
    limit
  );
  if (!className) {
    return null;
  }
  return {
    span: { from: command.from, to: className.span.to },
    commandSpan: { from: command.from, to: command.to },
    options,
    className,
  };
}

function readThemeUse(
  context: BeamerSyntaxContext,
  command: BeamerControlSequence,
  kind: BeamerThemeKind,
  limit: number
): BeamerThemeUseModel | null {
  const options =
    readBeamerOptionalArgument(context, command.to, limit) ?? undefined;
  const name = readBeamerRequiredArgument(
    context,
    options?.span.to ?? command.to,
    limit
  );
  if (!name) {
    return null;
  }
  return {
    kind,
    span: { from: command.from, to: name.span.to },
    commandSpan: { from: command.from, to: command.to },
    options,
    name,
  };
}

function readMetadataField(
  context: BeamerSyntaxContext,
  command: BeamerControlSequence,
  name: BeamerMetadataFieldName,
  limit: number
): BeamerMetadataFieldModel | null {
  const shortValue =
    readBeamerOptionalArgument(context, command.to, limit) ?? undefined;
  const value = readBeamerRequiredArgument(
    context,
    shortValue?.span.to ?? command.to,
    limit
  );
  if (!value) {
    return null;
  }
  return {
    name,
    span: { from: command.from, to: value.span.to },
    commandSpan: { from: command.from, to: command.to },
    shortValue,
    value,
  };
}

function scanFirstCommandValue(
  context: BeamerSyntaxContext,
  range: Span,
  commandName: string,
  excludedRoots: readonly BeamerTikzPictureRoot[]
): BeamerDelimitedSourceValue | undefined {
  for (const command of scanBeamerControlSequences(context, range)) {
    if (
      command.name !== commandName ||
      excludedRoots.some(
        (root) =>
          command.from >= root.span.from && command.from < root.span.to
      )
    ) {
      continue;
    }
    const value = readCommandMainArgument(context, command.to, range.to);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function readCommandMainArgument(
  context: BeamerSyntaxContext,
  from: number,
  limit: number
): BeamerDelimitedSourceValue | null {
  let cursor = from;
  const overlay = readBeamerOverlayArgument(context, cursor, limit);
  if (overlay) {
    cursor = overlay.span.to;
  }
  const optional = readBeamerOptionalArgument(context, cursor, limit);
  if (optional) {
    cursor = optional.span.to;
  }
  return readBeamerRequiredArgument(context, cursor, limit);
}

function shiftSpan(span: Span, offset: number): Span {
  return { from: span.from + offset, to: span.to + offset };
}

function isInsideAnyFrame(
  offset: number,
  frames: readonly BeamerFrameModel[]
): boolean {
  return frames.some(
    (frame) => offset >= frame.span.from && offset < frame.span.to
  );
}
