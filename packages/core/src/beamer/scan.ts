import type { Span } from "../ast/types.js";
import type { Diagnostic } from "../diagnostics/types.js";
import { formatDocumentRootId } from "../document/root-id.js";
import { scanTikzFigures } from "../parser/figure-scan.js";
import { collectContextDefinitions } from "../transform/cst-to-ast.js";
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

export type BeamerControlSequence = {
  from: number;
  to: number;
  name: string;
  starred: boolean;
};

export type BeamerEnvironmentToken = {
  kind: "begin" | "end";
  name: string;
  span: Span;
};

type DocumentRange = {
  documentSpan: Span | null;
  bodySpan: Span;
  preambleSpan: Span;
};

type FrameCandidate = {
  begin: BeamerEnvironmentToken;
  end: BeamerEnvironmentToken | null;
};

const OPAQUE_ENVIRONMENTS = new Set([
  "BVerbatim",
  "Verbatim",
  "alltt",
  "lstlisting",
  "minted",
  "semiverbatim",
  "verbatim",
  "verbatim*",
]);

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
  const diagnostics: Diagnostic[] = [];
  const documentRange = findDocumentRange(source, diagnostics);
  const frameCandidates = collectFrameCandidates(
    source,
    documentRange.bodySpan,
    diagnostics
  );
  const preliminaryFrames = frameCandidates.map((candidate, index) =>
    buildFrameModel(source, candidate, index)
  );
  const sections = scanSections(
    source,
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
    preamble: scanPreamble(source, documentRange.preambleSpan),
    sections,
    frames,
    roots,
    diagnostics,
  };
}

function findDocumentRange(
  source: string,
  diagnostics: Diagnostic[]
): DocumentRange {
  const tokens = scanBeamerEnvironmentTokens(source, { from: 0, to: source.length });
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
  source: string,
  range: Span,
  diagnostics: Diagnostic[]
): FrameCandidate[] {
  const tokens = scanBeamerEnvironmentTokens(source, range).filter(
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
  source: string,
  candidate: FrameCandidate,
  index: number
): BeamerFrameModel {
  const frameEnd = candidate.end?.span.from ?? source.length;
  const header = scanFrameHeader(source, candidate.begin.span.to, frameEnd);
  const bodySpan = { from: header.headerSpan.to, to: frameEnd };
  const id = formatDocumentRootId({ kind: "beamer-frame", index });
  const children = scanFrameTikzPictures(source, bodySpan, index);
  const title =
    header.title ??
    scanFirstCommandValue(source, bodySpan, "frametitle", children);
  const subtitle =
    header.subtitle ??
    scanFirstCommandValue(source, bodySpan, "framesubtitle", children);

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
  source: string,
  from: number,
  frameEnd: number
): {
  headerSpan: Span;
  overlay?: BeamerDelimitedSourceValue;
  options?: BeamerDelimitedSourceValue;
  title?: BeamerDelimitedSourceValue;
  subtitle?: BeamerDelimitedSourceValue;
} {
  let cursor = skipWhitespaceAndComments(source, from, frameEnd);
  let headerEnd = from;
  let overlay: BeamerDelimitedSourceValue | undefined;
  let options: BeamerDelimitedSourceValue | undefined;
  let title: BeamerDelimitedSourceValue | undefined;
  let subtitle: BeamerDelimitedSourceValue | undefined;

  if (source.charAt(cursor) === "<") {
    overlay = readDelimitedValue(source, cursor, "<", ">", frameEnd) ?? undefined;
    if (overlay) {
      headerEnd = overlay.span.to;
      cursor = skipWhitespaceAndComments(source, overlay.span.to, frameEnd);
    }
  }

  if (source.charAt(cursor) === "[") {
    options = readDelimitedValue(source, cursor, "[", "]", frameEnd) ?? undefined;
    if (options) {
      headerEnd = options.span.to;
      cursor = skipWhitespaceAndComments(source, options.span.to, frameEnd);
    }
  }

  if (source.charAt(cursor) === "{") {
    title = readDelimitedValue(source, cursor, "{", "}", frameEnd) ?? undefined;
    if (title) {
      headerEnd = title.span.to;
      cursor = skipWhitespaceAndComments(source, title.span.to, frameEnd);
    }
  }

  if (source.charAt(cursor) === "{") {
    subtitle = readDelimitedValue(source, cursor, "{", "}", frameEnd) ?? undefined;
    if (subtitle) {
      headerEnd = subtitle.span.to;
    }
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
  const entries = splitFrameOptions(source, options.contentSpan);
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

function splitFrameOptions(source: string, span: Span): BeamerFrameOption[] {
  const ranges: Span[] = [];
  let entryFrom = span.from;
  let braceDepth = 0;
  let bracketDepth = 0;
  let cursor = span.from;

  while (cursor < span.to) {
    const char = source.charAt(cursor);
    if (char === "%") {
      cursor = skipComment(source, cursor, span.to);
      continue;
    }
    if (char === "\\") {
      cursor = Math.min(span.to, cursor + 2);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
    } else if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (char === "," && braceDepth === 0 && bracketDepth === 0) {
      ranges.push({ from: entryFrom, to: cursor });
      entryFrom = cursor + 1;
    }
    cursor += 1;
  }
  ranges.push({ from: entryFrom, to: span.to });

  return ranges.flatMap((range) => {
    const trimmed = trimSpan(source, range);
    if (trimmed.from >= trimmed.to) {
      return [];
    }
    const equals = findTopLevelEquals(source, trimmed);
    const keySpan = trimSpan(source, {
      from: trimmed.from,
      to: equals ?? trimmed.to,
    });
    const valueSpan =
      equals == null
        ? undefined
        : trimSpan(source, { from: equals + 1, to: trimmed.to });
    return [{
      span: trimmed,
      keySpan,
      valueSpan,
      key: source.slice(keySpan.from, keySpan.to),
      value: valueSpan
        ? source.slice(valueSpan.from, valueSpan.to)
        : undefined,
    }];
  });
}

function findTopLevelEquals(source: string, span: Span): number | null {
  let depth = 0;
  for (let cursor = span.from; cursor < span.to; cursor += 1) {
    const char = source.charAt(cursor);
    if (char === "\\") {
      cursor += 1;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth = Math.max(0, depth - 1);
    } else if (char === "=" && depth === 0) {
      return cursor;
    }
  }
  return null;
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
  source: string,
  range: Span,
  frames: readonly BeamerFrameModel[],
  diagnostics: Diagnostic[]
): BeamerSectionModel[] {
  const sections: BeamerSectionModel[] = [];
  let cursor = range.from;

  while (cursor < range.to) {
    if (source.charAt(cursor) === "%") {
      cursor = skipComment(source, cursor, range.to);
      continue;
    }
    if (source.charAt(cursor) !== "\\") {
      cursor += 1;
      continue;
    }
    const command = readControlSequence(source, cursor, range.to);
    if (!command) {
      cursor += 1;
      continue;
    }
    cursor = command.to;
    if (
      (command.name !== "section" && command.name !== "subsection") ||
      isInsideAnyFrame(command.from, frames)
    ) {
      continue;
    }

    let argumentCursor = skipWhitespaceAndComments(
      source,
      command.to,
      range.to
    );
    if (source.charAt(argumentCursor) === "<") {
      const overlay = readDelimitedValue(
        source,
        argumentCursor,
        "<",
        ">",
        range.to
      );
      if (overlay) {
        argumentCursor = skipWhitespaceAndComments(
          source,
          overlay.span.to,
          range.to
        );
      }
    }
    let shortTitle: BeamerDelimitedSourceValue | undefined;
    if (source.charAt(argumentCursor) === "[") {
      shortTitle =
        readDelimitedValue(source, argumentCursor, "[", "]", range.to) ??
        undefined;
      if (shortTitle) {
        argumentCursor = skipWhitespaceAndComments(
          source,
          shortTitle.span.to,
          range.to
        );
      }
    }
    const title =
      source.charAt(argumentCursor) === "{"
        ? readDelimitedValue(source, argumentCursor, "{", "}", range.to)
        : null;
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
    cursor = title.span.to;
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

function scanPreamble(source: string, span: Span): BeamerPreambleModel {
  const controls = scanBeamerControlSequences(source, span);
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
      documentClass = readDocumentClass(source, command, span.to);
      continue;
    }
    const themeKind = THEME_COMMANDS.get(command.name);
    if (themeKind) {
      const theme = readThemeUse(source, command, themeKind, span.to);
      if (theme) {
        themes.push(theme);
      }
      continue;
    }
    if (METADATA_COMMANDS.has(command.name as BeamerMetadataFieldName)) {
      const name = command.name as BeamerMetadataFieldName;
      if (!metadata[name]) {
        const field = readMetadataField(source, command, name, span.to);
        if (field) {
          metadata[name] = field;
        }
      }
      continue;
    }
    if (command.name === "AtBeginSection") {
      const value = readCommandMainArgument(
        source,
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
    source,
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
      source,
      span,
      controls,
      macroDefinitions.map((definition) => definition.span)
    ),
    macroDefinitions,
  };
}

function scanBeamerTheoremDeclarations(params: {
  source: string;
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
        params.source,
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
      params.source,
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
  source: string,
  command: BeamerControlSequence,
  limit: number,
  style: BeamerTheoremStyle
): BeamerTheoremDeclarationModel | null {
  const name = readBeamerRequiredArgument(source, command.to, limit);
  if (!name || name.value.trim().length === 0) {
    return null;
  }
  let cursor = name.span.to;
  const shared = readBeamerOptionalArgument(source, cursor, limit);
  if (shared) {
    cursor = shared.span.to;
  }
  const displayName = readBeamerRequiredArgument(source, cursor, limit);
  if (!displayName) {
    return null;
  }
  cursor = displayName.span.to;
  const within = shared
    ? null
    : readBeamerOptionalArgument(source, cursor, limit);
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
  source: string,
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
    const template = readBeamerRequiredArgument(source, command.to, span.to);
    if (template?.value.trim() !== "theorems") {
      continue;
    }
    const variant = readBeamerOptionalArgument(
      source,
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
  const controls = scanBeamerControlSequences(source, {
    from: 0,
    to: source.length,
  });
  for (const command of controls) {
    if (command.name === "documentclass") {
      return readDocumentClass(source, command, source.length);
    }
  }
  return null;
}

function readDocumentClass(
  source: string,
  command: BeamerControlSequence,
  limit: number
): BeamerDocumentClassModel | null {
  let cursor = skipWhitespaceAndComments(source, command.to, limit);
  let options: BeamerDelimitedSourceValue | undefined;
  if (source.charAt(cursor) === "[") {
    options =
      readDelimitedValue(source, cursor, "[", "]", limit) ?? undefined;
    cursor = options
      ? skipWhitespaceAndComments(source, options.span.to, limit)
      : cursor;
  }
  const className =
    source.charAt(cursor) === "{"
      ? readDelimitedValue(source, cursor, "{", "}", limit)
      : null;
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
  source: string,
  command: BeamerControlSequence,
  kind: BeamerThemeKind,
  limit: number
): BeamerThemeUseModel | null {
  let cursor = skipWhitespaceAndComments(source, command.to, limit);
  let options: BeamerDelimitedSourceValue | undefined;
  if (source.charAt(cursor) === "[") {
    options =
      readDelimitedValue(source, cursor, "[", "]", limit) ?? undefined;
    cursor = options
      ? skipWhitespaceAndComments(source, options.span.to, limit)
      : cursor;
  }
  const name =
    source.charAt(cursor) === "{"
      ? readDelimitedValue(source, cursor, "{", "}", limit)
      : null;
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
  source: string,
  command: BeamerControlSequence,
  name: BeamerMetadataFieldName,
  limit: number
): BeamerMetadataFieldModel | null {
  let cursor = skipWhitespaceAndComments(source, command.to, limit);
  let shortValue: BeamerDelimitedSourceValue | undefined;
  if (source.charAt(cursor) === "[") {
    shortValue =
      readDelimitedValue(source, cursor, "[", "]", limit) ?? undefined;
    cursor = shortValue
      ? skipWhitespaceAndComments(source, shortValue.span.to, limit)
      : cursor;
  }
  const value =
    source.charAt(cursor) === "{"
      ? readDelimitedValue(source, cursor, "{", "}", limit)
      : null;
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
  source: string,
  range: Span,
  commandName: string,
  excludedRoots: readonly BeamerTikzPictureRoot[]
): BeamerDelimitedSourceValue | undefined {
  for (const command of scanBeamerControlSequences(source, range)) {
    if (
      command.name !== commandName ||
      excludedRoots.some(
        (root) =>
          command.from >= root.span.from && command.from < root.span.to
      )
    ) {
      continue;
    }
    const value = readCommandMainArgument(source, command.to, range.to);
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function readBeamerRequiredArgument(
  source: string,
  from: number,
  limit: number
): BeamerDelimitedSourceValue | null {
  const cursor = skipWhitespaceAndComments(source, from, limit);
  return source.charAt(cursor) === "{"
    ? readDelimitedValue(source, cursor, "{", "}", limit)
    : null;
}

export function readBeamerOptionalArgument(
  source: string,
  from: number,
  limit: number
): BeamerDelimitedSourceValue | null {
  const cursor = skipWhitespaceAndComments(source, from, limit);
  return source.charAt(cursor) === "["
    ? readDelimitedValue(source, cursor, "[", "]", limit)
    : null;
}

export function readBeamerOverlayArgument(
  source: string,
  from: number,
  limit: number
): BeamerDelimitedSourceValue | null {
  const cursor = skipWhitespaceAndComments(source, from, limit);
  return source.charAt(cursor) === "<"
    ? readDelimitedValue(source, cursor, "<", ">", limit)
    : null;
}

function readCommandMainArgument(
  source: string,
  from: number,
  limit: number
): BeamerDelimitedSourceValue | null {
  let cursor = skipWhitespaceAndComments(source, from, limit);
  if (source.charAt(cursor) === "<") {
    const overlay = readDelimitedValue(source, cursor, "<", ">", limit);
    if (overlay) {
      cursor = skipWhitespaceAndComments(source, overlay.span.to, limit);
    }
  }
  if (source.charAt(cursor) === "[") {
    const optional = readDelimitedValue(source, cursor, "[", "]", limit);
    if (optional) {
      cursor = skipWhitespaceAndComments(source, optional.span.to, limit);
    }
  }
  return source.charAt(cursor) === "{"
    ? readDelimitedValue(source, cursor, "{", "}", limit)
    : null;
}

export function scanBeamerEnvironmentTokens(
  source: string,
  range: Span
): BeamerEnvironmentToken[] {
  const tokens: BeamerEnvironmentToken[] = [];
  let cursor = range.from;

  while (cursor < range.to) {
    const char = source.charAt(cursor);
    if (char === "%") {
      cursor = skipComment(source, cursor, range.to);
      continue;
    }
    if (char !== "\\") {
      cursor += 1;
      continue;
    }
    const command = readControlSequence(source, cursor, range.to);
    if (!command) {
      cursor += 1;
      continue;
    }
    cursor = command.to;
    if (command.name !== "begin" && command.name !== "end") {
      continue;
    }
    const nameArgument = readBeamerRequiredArgument(
      source,
      command.to,
      range.to
    );
    if (!nameArgument) {
      continue;
    }
    const name = nameArgument.value.trim();
    const token: BeamerEnvironmentToken = {
      kind: command.name,
      name,
      span: { from: command.from, to: nameArgument.span.to },
    };
    tokens.push(token);
    cursor = nameArgument.span.to;

    if (token.kind === "begin" && OPAQUE_ENVIRONMENTS.has(name)) {
      const endToken = `\\end{${name}}`;
      const endFrom = source.indexOf(endToken, cursor);
      if (endFrom >= 0 && endFrom < range.to) {
        cursor = endFrom + endToken.length;
      } else {
        cursor = range.to;
      }
    }
  }
  return tokens;
}

export function scanBeamerControlSequences(
  source: string,
  range: Span
): BeamerControlSequence[] {
  const controls: BeamerControlSequence[] = [];
  let cursor = range.from;
  while (cursor < range.to) {
    const char = source.charAt(cursor);
    if (char === "%") {
      cursor = skipComment(source, cursor, range.to);
      continue;
    }
    if (char !== "\\") {
      cursor += 1;
      continue;
    }
    const command = readControlSequence(source, cursor, range.to);
    if (!command) {
      cursor += 1;
      continue;
    }
    controls.push(command);
    cursor = command.to;
  }
  return controls;
}

function readControlSequence(
  source: string,
  from: number,
  limit: number
): BeamerControlSequence | null {
  if (source.charAt(from) !== "\\") {
    return null;
  }
  let cursor = from + 1;
  while (
    cursor < limit &&
    /[A-Za-z@]/u.test(source.charAt(cursor))
  ) {
    cursor += 1;
  }
  if (cursor === from + 1) {
    cursor = Math.min(limit, from + 2);
  }
  const nameTo = cursor;
  const starred = source.charAt(cursor) === "*";
  if (starred) {
    cursor += 1;
  }
  return {
    from,
    to: cursor,
    name: source.slice(from + 1, nameTo),
    starred,
  };
}

function readDelimitedValue(
  source: string,
  from: number,
  open: "{" | "[" | "<",
  close: "}" | "]" | ">",
  limit: number
): BeamerDelimitedSourceValue | null {
  if (source.charAt(from) !== open) {
    return null;
  }
  let depth = 0;
  let cursor = from;
  while (cursor < limit) {
    const char = source.charAt(cursor);
    if (char === "%") {
      cursor = skipComment(source, cursor, limit);
      continue;
    }
    if (char === "\\") {
      cursor = Math.min(limit, cursor + 2);
      continue;
    }
    if (char === open) {
      depth += 1;
    } else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        const span = { from, to: cursor + 1 };
        const contentSpan = { from: from + 1, to: cursor };
        return {
          span,
          contentSpan,
          value: source.slice(contentSpan.from, contentSpan.to),
        };
      }
    }
    cursor += 1;
  }
  return null;
}

function skipWhitespaceAndComments(
  source: string,
  from: number,
  limit: number
): number {
  let cursor = from;
  while (cursor < limit) {
    const char = source.charAt(cursor);
    if (/\s/u.test(char)) {
      cursor += 1;
      continue;
    }
    if (char === "%") {
      cursor = skipComment(source, cursor, limit);
      continue;
    }
    break;
  }
  return cursor;
}

function skipComment(source: string, from: number, limit: number): number {
  let cursor = from;
  while (cursor < limit) {
    const char = source.charAt(cursor);
    cursor += 1;
    if (char === "\n" || char === "\r") {
      break;
    }
  }
  return cursor;
}

function trimSpan(source: string, span: Span): Span {
  let from = span.from;
  let to = span.to;
  while (from < to && /\s/u.test(source.charAt(from))) {
    from += 1;
  }
  while (to > from && /\s/u.test(source.charAt(to - 1))) {
    to -= 1;
  }
  return { from, to };
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
