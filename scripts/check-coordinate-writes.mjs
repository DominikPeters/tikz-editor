// Coordinate-write guard: the rules that keep runtime strings out of edited
// source except through the typed constructors in `edit/fragment.ts`
// (design/coordinate-writer.md). The type system rejects building fragments
// from strings; these rules close what it cannot see:
//
// F1  assertions and type predicates to a fragment type, outside fragment.ts
//     and the writer;
// F2  calls of the constructors that take anything (`userText`,
//     `sourceSlice`, `unchangedSource`, the slices `sliceFragment` and
//     `editedSlice`, which could cut a value out of its option,
//     `plainNumber` for numbers no frame reads, `macroExpansion` for a
//     flattened loop, `optionEntry` for a mutation's key): every call site
//     is listed;
// F3  writer internals used outside the writer, resolved by symbol so
//     aliases and re-exports count; `ptToCm` only on point components;
// F4  `tikz` used other than as a template tag;
// F5  a point or vector constructor fed the components of a point in
//     another space (rebranding without a transform).
// F6  references to low-level authored-value serializers outside the writer:
//     every use must be reviewed, including aliases and namespace escapes.
//
// Every current violation is a fingerprinted exception in
// `scripts/coordinate-write-exceptions.json`: rule, file, enclosing
// declaration and a hash of the offending expression, with a count. Line
// moves keep the fingerprint; replacing one violation with another changes
// it. The list only shrinks: `--update` removes stale entries and refuses
// new ones unless `--accept-new` is given (which is the review).
//
//   node scripts/check-coordinate-writes.mjs [--update [--accept-new]]

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const FRAGMENT_FILE = "packages/core/src/edit/fragment.ts";
const WRITER_DIR = "packages/core/src/edit/writer/";
const AUTHORED_VALUES_FILE = `${WRITER_DIR}authored-values.ts`;
const POINTS_FILE = "packages/core/src/coords/points.ts";
/** The coordinate transforms themselves, where rebranding through components is the conversion (F5). */
const TRANSFORM_DIRS = ["packages/core/src/coords/", "packages/app/src/ui/coords/"];
export const EXCEPTIONS_FILE = "scripts/coordinate-write-exceptions.json";

/**
 * Constructors that accept anything, by defining file: string-taking
 * fragment constructors and slices, each call site reviewed. (The migration
 * escapes `legacyText` and `legacyEditedSource` are gone with phase 5.)
 */
const LISTED_CONSTRUCTORS = new Map([
  ["userText", "reviewed"],
  ["sourceSlice", "reviewed"],
  ["unchangedSource", "reviewed"],
  ["sliceFragment", "reviewed"],
  ["editedSlice", "reviewed"],
  ["plainNumber", "reviewed"],
  ["macroExpansion", "reviewed"],
  ["optionEntry", "reviewed"]
]);
const LISTED_FILES = new Set([FRAGMENT_FILE]);

/** Writer internals by defining file, all inside the writer. */
const WRITER_INTERNALS = new Map([
  ["packages/core/src/edit/writer/format.ts", ["formatCoordinate", "formatPolarCoordinate", "formatCanvasCoordinate"]],
  ["packages/core/src/edit/writer/source-units.ts", ["localToSourceUnits"]],
  ["packages/core/src/edit/writer/coordinate-text.ts", ["coordinateText"]],
  ["packages/core/src/edit/writer/radius.ts", ["writeRadiusLength"]],
  ["packages/core/src/edit/writer/calc.ts", ["writeCalcCoordinate"]]
]);
const PT_TO_CM_FILE = "packages/core/src/coords/source.ts";

const PRODUCTION_PREFIXES = ["packages/", "apps/"];

function normalizePath(path) {
  return path.split(sep).join("/");
}

/**
 * The repository's program over `rootNames`, or over its production sources
 * (packages and apps, not tests or scripts).
 */
export function createProgram(root, rootNames, extraOptions = {}) {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) throw new Error("Unable to locate tsconfig.json for the coordinate-write guard");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root, undefined, configPath);
  return ts.createProgram({
    rootNames: rootNames ?? parsed.fileNames.filter((fileName) => isProductionFile(root, fileName)),
    options: { ...parsed.options, ...extraOptions, noEmit: true },
    projectReferences: parsed.projectReferences
  });
}

function isProductionFile(root, fileName) {
  const path = normalizePath(relative(root, fileName));
  return PRODUCTION_PREFIXES.some((prefix) => path.startsWith(prefix)) && /\/src\//.test(path) && !path.endsWith(".d.ts");
}

/**
 * Every violation in `files` (absolute paths in `program`), unfiltered by
 * the exception list. Paths are reported relative to `root`.
 */
export function collectViolations(program, root, files) {
  const checker = program.getTypeChecker();
  const wanted = new Set(files.map((file) => normalizePath(file)));
  const violations = [];

  const fragmentFile = normalizePath(join(root, FRAGMENT_FILE));
  const authoredValuesFile = normalizePath(join(root, AUTHORED_VALUES_FILE));
  const pointsFile = normalizePath(join(root, POINTS_FILE));
  const ptToCmFile = normalizePath(join(root, PT_TO_CM_FILE));
  const internalFiles = new Map([...WRITER_INTERNALS].map(([file, names]) => [normalizePath(join(root, file)), new Set(names)]));
  const listedFiles = new Set([...LISTED_FILES].map((file) => normalizePath(join(root, file))));
  const pointsModule = program.getSourceFile(join(root, POINTS_FILE));
  const pointConstructors = pointsModule
    ? checker.getExportsOfModule(checker.getSymbolAtLocation(pointsModule)).map((symbol) => symbol.getName())
    : [];
  // Resolving every identifier's symbol is slow; only these names (and local
  // renames of them, from import and export specifiers) can resolve to a
  // checked declaration.
  const watchedNames = new Set([
    ...LISTED_CONSTRUCTORS.keys(), "tikz", ...[...WRITER_INTERNALS.values()].flat(), "ptToCm", ...pointConstructors
  ]);

  for (const sourceFile of program.getSourceFiles()) {
    const fileName = normalizePath(sourceFile.fileName);
    if (sourceFile.isDeclarationFile || !wanted.has(fileName)) continue;
    const path = normalizePath(relative(root, fileName));
    const inFragment = fileName === fragmentFile;
    const inWriter = path.startsWith(WRITER_DIR);
    const inTransforms = TRANSFORM_DIRS.some((dir) => path.startsWith(dir));
    const definesPtToCm = fileName === ptToCmFile;
    const names = new Set(watchedNames);
    collectRenames(sourceFile);
    visit(sourceFile);

    function collectRenames(node) {
      if ((ts.isImportSpecifier(node) || ts.isExportSpecifier(node)) && node.propertyName && watchedNames.has(node.propertyName.text)) {
        names.add(node.name.text);
      }
      ts.forEachChild(node, collectRenames);
    }

    function visit(node) {
      if (!inFragment && !inWriter) checkFragmentAssertion(node);
      if (!inWriter) checkAuthoredValueReference(node);
      if (ts.isIdentifier(node) && names.has(node.text)) checkReference(node);
      if (ts.isCallExpression(node)) checkPointConstructor(node);
      ts.forEachChild(node, visit);
    }

    // F6. The raw serializers live in their own module, so they cannot leak
    // through a narrowed CoordinateWriter object. Resolve the function's
    // declaration through its type too: destructuring, bracket access and
    // forwarding an inferred alias must not hide its origin. Namespace values
    // themselves are guarded when copied, spread, destructured or forwarded.
    function checkAuthoredValueReference(node) {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const module = node.arguments[0] && checker.getSymbolAtLocation(node.arguments[0]);
        if (module && checker.getExportsOfModule(module).some(symbol =>
          checker.getTypeOfSymbolAtLocation(symbol, node).getCallSignatures().some(signature =>
            signature.declaration && normalizePath(signature.declaration.getSourceFile().fileName) === authoredValuesFile))) {
          report("F6", node, "dynamic import of low-level serializers; review the namespace before it can escape", "authored-values");
        }
        return;
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        const module = checker.getSymbolAtLocation(node.moduleSpecifier);
        if (module?.declarations?.some(declaration => normalizePath(declaration.getSourceFile().fileName) === authoredValuesFile) && !node.exportClause) {
          report("F6", node, "re-export of low-level serializers; review every exposed reference", "authored-values");
        }
        return;
      }
      if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return;
      const parent = node.parent;
      if (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return;
      if (ts.isExportSpecifier(parent) && parent.propertyName && parent.name === node) return;
      if ((ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)) && parent.name === node) return;
      if ((ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        ((ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) && parent.expression === node)) return;
      if (ts.isIdentifier(node) && ts.isPropertyAssignment(parent) && parent.name === node) return;

      const target = resolvedDeclaration(node);
      const type = checker.getTypeAtLocation(node);
      const authoredSignature = type => type.getCallSignatures().find(signature =>
        signature.declaration && normalizePath(signature.declaration.getSourceFile().fileName) === authoredValuesFile);
      const signature = authoredSignature(type);
      // A namespace imported through a barrel may be narrowed before a raw
      // method is read. Guard that namespace escape as well as direct imports.
      const namespace = type.getSymbol();
      const exposesAuthoredValues = namespace && (namespace.flags & ts.SymbolFlags.Module) !== 0 &&
        checker.getExportsOfModule(namespace).some(symbol => authoredSignature(checker.getTypeOfSymbolAtLocation(symbol, node)));
      const access = ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node);
      const receiver = access ? checker.getTypeAtLocation(node.expression) : undefined;
      const authoredReceiver = receiver && (authoredSignature(receiver) ||
        resolvedDeclaration(node.expression)?.file === authoredValuesFile &&
        ((receiver.getSymbol()?.flags ?? 0) & ts.SymbolFlags.Module) !== 0);
      if (!signature && !authoredReceiver && !exposesAuthoredValues) return;
      const name = signature?.declaration?.name?.getText() ?? target?.name ?? "authored-values";
      report("F6", useSite(node), `low-level serializer ${name}; list this reference with --update --accept-new after reviewing its authored frame or text provenance`, name);
    }

    function report(rule, node, message, symbol) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const text = node.getText(sourceFile);
      violations.push({
        rule,
        symbol,
        file: path,
        line: position.line + 1,
        column: position.character + 1,
        declaration: enclosingDeclaration(node),
        hash: createHash("sha256").update(`${rule}\u0000${text.replace(/\s+/g, "")}`).digest("hex").slice(0, 12),
        expression: text.replace(/\s+/g, " ").slice(0, 120),
        message
      });
    }

    // F1
    function checkFragmentAssertion(node) {
      let typeNode = null;
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) typeNode = node.type;
      else if (ts.isTypePredicateNode(node) && node.type) typeNode = node.type;
      if (!typeNode || typeNode.getText(sourceFile) === "const") return;
      const type = checker.getTypeFromTypeNode(typeNode);
      if (carriesFragmentBrand(type, 0)) {
        report("F1", node, `assertion or type predicate to ${typeNode.getText(sourceFile)} outside fragment.ts and the writer; use a typed constructor`);
      }
    }

    function carriesFragmentBrand(type, depth) {
      if (depth > 4) return false;
      if (type.isUnionOrIntersection()) return type.types.some((member) => carriesFragmentBrand(member, depth + 1));
      for (const property of type.getProperties()) {
        if (property.declarations?.some((declaration) => normalizePath(declaration.getSourceFile().fileName) === fragmentFile)) return true;
      }
      const args = checker.getTypeArguments?.(type) ?? [];
      return (type.flags & ts.TypeFlags.Object) !== 0 && args.some((arg) => carriesFragmentBrand(arg, depth + 1));
    }

    // F2, F3, F4
    function checkReference(node) {
      const parent = node.parent;
      if (!parent || ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return;
      // `export { a as b }` is one reference, made by `a`.
      if (ts.isExportSpecifier(parent) && parent.propertyName && parent.name === node) return;
      if ((ts.isFunctionDeclaration(parent) || ts.isVariableDeclaration(parent)) && parent.name === node) return;
      if (ts.isPropertyAccessExpression(parent) && parent.name === node && !isNamespaceAccess(parent)) return;
      const target = resolvedDeclaration(node);
      if (!target) return;
      const { name, file } = target;

      if (listedFiles.has(file) && file !== fileName) {
        const listed = LISTED_CONSTRUCTORS.get(name);
        if (listed) {
          report("F2", useSite(node), `${name} call site (${listed}); list it with --update --accept-new after review`, name);
        }
        if (file === fragmentFile && name === "tikz" && !(ts.isTaggedTemplateExpression(parent) && parent.tag === node) && !ts.isExportSpecifier(parent)) {
          report("F4", useSite(node), "tikz used other than as a template tag; its literal parts must be fixed at compile time", name);
        }
        return;
      }
      if (inWriter || definesPtToCm) return;
      if (internalFiles.get(file)?.has(name)) {
        report("F3", useSite(node), `writer internal ${name} outside the writer`, name);
        return;
      }
      if (file === ptToCmFile && name === "ptToCm" && ts.isCallExpression(parent) && parent.expression === node) {
        const argument = parent.arguments[0];
        if (argument && pointComponentSpace(argument)) {
          report("F3", parent, "ptToCm on a point component outside the writer; convert the point through its frame", name);
        }
      }
    }

    function isNamespaceAccess(access) {
      const symbol = checker.getSymbolAtLocation(access.expression);
      return symbol !== undefined && (symbol.flags & ts.SymbolFlags.Alias) !== 0 &&
        checker.getAliasedSymbol(symbol).flags & ts.SymbolFlags.ValueModule;
    }

    function resolvedDeclaration(node) {
      let symbol = checker.getSymbolAtLocation(node);
      if (ts.isExportSpecifier(node.parent)) {
        symbol = checker.getExportSpecifierLocalTargetSymbol(node.parent) ?? symbol;
      }
      if (!symbol) return null;
      if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      const declaration = symbol.declarations?.[0];
      if (!declaration) return null;
      return { name: symbol.getName(), file: normalizePath(declaration.getSourceFile().fileName) };
    }

    // F5
    function checkPointConstructor(node) {
      if (inWriter || inTransforms) return;
      const callee = ts.isIdentifier(node.expression) ? node.expression
        : ts.isPropertyAccessExpression(node.expression) ? node.expression.name : null;
      if (!callee || !names.has(callee.text)) return;
      const target = resolvedDeclaration(callee);
      if (!target || target.file !== pointsFile) return;
      const resultSpace = brandSpace(checker.getTypeAtLocation(node));
      if (!resultSpace) return;
      for (const argument of node.arguments) {
        for (const component of componentReads(argument)) {
          const space = pointComponentSpace(component);
          if (space && space !== resultSpace) {
            report("F5", node, `${target.name} built from ${space} components; use an explicit transform`, target.name);
            return;
          }
        }
      }
    }

    function componentReads(expression) {
      const node = skipWrappers(expression);
      if (ts.isBinaryExpression(node) && (node.operatorToken.kind === ts.SyntaxKind.PlusToken || node.operatorToken.kind === ts.SyntaxKind.MinusToken)) {
        return [...componentReads(node.left), ...componentReads(node.right)];
      }
      if (ts.isCallExpression(node) && node.arguments.length === 1) return componentReads(node.arguments[0]);
      return [node];
    }

    /** The space of the point whose `x`/`y` this expression reads, if any. */
    function pointComponentSpace(expression) {
      const node = skipWrappers(expression);
      if (!ts.isPropertyAccessExpression(node) || !["x", "y"].includes(node.name.text)) return null;
      return brandSpace(checker.getTypeAtLocation(node.expression));
    }

    function brandSpace(type) {
      for (const property of type.getProperties()) {
        if (!property.declarations?.some((declaration) => normalizePath(declaration.getSourceFile().fileName) === pointsFile)) continue;
        if (property.getName() === "x" || property.getName() === "y") continue;
        const brand = checker.getTypeOfSymbol(property);
        if (brand.isStringLiteral()) return brand.value.split(":")[1] ?? null;
      }
      return null;
    }
  }

  return violations;
}

function skipWrappers(node) {
  let current = node;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isNonNullExpression(current)) current = current.expression;
  return current;
}

/** The call around a callee, or the reference itself. */
function useSite(node) {
  const parent = node.parent;
  if ((ts.isCallExpression(parent) || ts.isTaggedTemplateExpression(parent)) && (parent.expression === node || parent.tag === node)) return parent;
  return node;
}

function enclosingDeclaration(node) {
  const names = [];
  for (let current = node.parent; current; current = current.parent) {
    if ((ts.isFunctionDeclaration(current) || ts.isClassDeclaration(current) || ts.isMethodDeclaration(current) ||
      ts.isVariableDeclaration(current) || ts.isPropertyAssignment(current) || ts.isPropertyDeclaration(current)) &&
      current.name && (ts.isIdentifier(current.name) || ts.isStringLiteral(current.name))) {
      names.unshift(current.name.text);
    }
  }
  return names.join(".") || "<module>";
}

function fingerprint(entry) {
  return `${entry.rule}|${entry.file}|${entry.declaration}|${entry.hash}`;
}

/** Groups violations into exception entries with counts. */
export function exceptionEntries(violations) {
  const grouped = new Map();
  for (const violation of violations) {
    const key = fingerprint(violation);
    const entry = grouped.get(key);
    if (entry) entry.count += 1;
    else {
      grouped.set(key, {
        rule: violation.rule,
        ...(violation.symbol && { symbol: violation.symbol }),
        file: violation.file,
        declaration: violation.declaration,
        hash: violation.hash,
        count: 1,
        expression: violation.expression
      });
    }
  }
  return [...grouped.values()].sort((left, right) =>
    left.file.localeCompare(right.file) || left.rule.localeCompare(right.rule) ||
    left.declaration.localeCompare(right.declaration) || left.hash.localeCompare(right.hash));
}

/**
 * Violations beyond the listed counts (`unexpected`), and listed counts the
 * code no longer reaches (`stale`, which must be removed so the list shrinks).
 */
export function compareWithExceptions(violations, listed) {
  const allowed = new Map(listed.map((entry) => [fingerprint(entry), entry.count]));
  const found = exceptionEntries(violations);
  const foundCounts = new Map(found.map((entry) => [fingerprint(entry), entry.count]));
  const unexpected = violations.filter((violation) => {
    const key = fingerprint(violation);
    const left = allowed.get(key) ?? 0;
    if (left > 0) {
      allowed.set(key, left - 1);
      return false;
    }
    return true;
  });
  const stale = listed.filter((entry) => (foundCounts.get(fingerprint(entry)) ?? 0) < entry.count)
    .map((entry) => ({ ...entry, found: foundCounts.get(fingerprint(entry)) ?? 0 }));
  return { unexpected, stale, found };
}

export function readExceptions(root) {
  const data = JSON.parse(readFileSync(join(root, EXCEPTIONS_FILE), "utf8"));
  return [...data.reviewed, ...data.migration];
}

function writeExceptions(root, entries) {
  const reviewed = entries.filter((entry) => entry.rule === "F6" || entry.rule === "F2" && LISTED_CONSTRUCTORS.get(entry.symbol) === "reviewed");
  const migration = entries.filter((entry) => !reviewed.includes(entry));
  const data = {
    comment: "Fingerprinted coordinate-write exceptions (scripts/check-coordinate-writes.mjs). Reviewed: fragment constructors and low-level authored-value serializers whose call sites were checked. Migration: violations the writer phases remove; the list only shrinks.",
    reviewed,
    migration
  };
  writeFileSync(join(root, EXCEPTIONS_FILE), `${JSON.stringify(data, null, 2)}\n`);
}

function describe(violation) {
  return `${violation.file}:${violation.line}:${violation.column} [${violation.rule}] ${violation.message} (in ${violation.declaration}: ${violation.expression})`;
}

/** Check mode: messages for every unexpected violation and stale exception (empty when clean). */
export function checkCoordinateWrites(root) {
  const program = createProgram(root, undefined);
  const violations = collectViolations(program, root, program.getRootFileNames());
  const { unexpected, stale } = compareWithExceptions(violations, readExceptions(root));
  return [
    ...unexpected.map(describe),
    ...stale.map((entry) => `${entry.file} [${entry.rule}] exception in ${entry.declaration} (${entry.expression}) is listed ${entry.count}× but found ${entry.found}×; remove it with \`node scripts/check-coordinate-writes.mjs --update\``)
  ];
}

function update(root, acceptNew) {
  const program = createProgram(root, undefined);
  const violations = collectViolations(program, root, program.getRootFileNames());
  let listed = [];
  try {
    listed = readExceptions(root);
  } catch {
    listed = [];
  }
  const { unexpected, stale, found } = compareWithExceptions(violations, listed);
  for (const entry of stale) console.log(`- ${entry.file} [${entry.rule}] ${entry.declaration}: ${entry.expression} (${entry.count} → ${entry.found})`);
  for (const violation of unexpected) console.log(`+ ${describe(violation)}`);
  if (unexpected.length > 0 && !acceptNew) {
    console.error(`Refusing to add ${unexpected.length} exception(s). Fix them, or review each and rerun with --accept-new.`);
    process.exit(1);
  }
  writeExceptions(root, found);
  console.log(`${EXCEPTIONS_FILE}: ${found.reduce((sum, entry) => sum + entry.count, 0)} listed violation(s) in ${found.length} entr${found.length === 1 ? "y" : "ies"}.`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
  if (process.argv.includes("--update")) {
    update(root, process.argv.includes("--accept-new"));
  } else {
    const messages = checkCoordinateWrites(root);
    if (messages.length > 0) {
      console.error("Coordinate-write guard failed:");
      for (const message of messages) console.error(`- ${message}`);
      process.exit(1);
    }
  }
}
