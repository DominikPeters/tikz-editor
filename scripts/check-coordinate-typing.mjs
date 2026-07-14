import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const root = process.cwd();
const targets = [
  "packages/core/src/coords",
  "packages/core/src/semantic",
  "packages/core/src/svg",
  "packages/core/src/edit",
  "packages/core/src/geometry",
  "packages/core/src/text",
  "packages/app/src/ui/coords",
  "packages/app/src/ui/canvas-panel"
];

const bannedPatterns = [
  {
    name: "unsafe coordinate constructors",
    regex: /\bunsafe(?:Point|Bounds|Transform)\b/
  },
  {
    name: "vector aliases to point types",
    regex: /\btype\s+\w*Vector\s*=\s*\w*Point\b/
  },
  {
    name: "raw branded point/bounds object literals",
    regex: /:\s*(?:WorldPoint|SvgPoint|FrameLocalPoint|ViewportPoint|ClientPoint|TextRectLocalPoint|WorldBounds|SvgBounds|ViewportBounds|ClientBounds)\b[^;}\n=]*=\s*\{/
  }
];

const texCoordinateTypeNames = [
  "TexLength",
  "TexVListX",
  "TexVListLocalX",
  "TexVListY",
  "TexVListLocalY",
  "TexLineX",
  "TexLineLocalX",
  "TexLineY",
  "TexHBoxX",
  "TexHBoxY",
  "TexHBoxLocalX",
  "TexHBoxLocalY",
  "TexHBoxOffsetX",
  "TexHBoxOffsetY",
  "TexMuLength"
];
const directTexCoordinateAssertion = new RegExp(
  `\\bas\\s+(?:${texCoordinateTypeNames.join("|")})\\b`
);
const texCoordinateConstructorFile =
  "packages/core/src/text/tex/coordinates.ts";

const violations = [];

for (const target of targets) {
  walk(join(root, target));
}

function walk(path) {
  const entry = statSync(path);
  if (entry.isDirectory()) {
    for (const child of readdirSync(path)) {
      walk(join(path, child));
    }
    return;
  }
  if (!path.endsWith(".ts") && !path.endsWith(".tsx")) {
    return;
  }

  const content = readFileSync(path, "utf8");
  const relativePath = relative(root, path);
  for (const { name, regex } of bannedPatterns) {
    if (regex.test(content)) {
      violations.push({
        file: relativePath,
        reason: name
      });
    }
  }
  if (
    relativePath !== texCoordinateConstructorFile &&
    directTexCoordinateAssertion.test(content)
  ) {
    violations.push({
      file: relativePath,
      reason: "direct TeX coordinate assertion outside coordinate constructors"
    });
  }
}

/**
 * Catch only operations whose two operands retain distinct branded coordinate
 * aliases. This intentionally leaves ordinary numeric/length calculations to
 * TypeScript and the type-contract test:
 *
 * - `TexLength` arithmetic and same-unit `TexMuLength` arithmetic are allowed.
 * - subtracting two positions with the same role is allowed.
 * - root + local and HList-local + offset pairs on the same axis are allowed;
 *   subtraction is directional (root - local or local - offset).
 * - offset arithmetic is allowed only between offsets on the same axis.
 * - conversions inside `coordinates.ts` are the trusted transform boundary.
 *
 * The pass rejects position + position, cross-space/axis position arithmetic,
 * and passing one branded TeX position directly to another role's branding
 * constructor. Extent/position constructor boundaries remain allowed because a
 * measured length commonly establishes a new origin-relative position.
 * Arithmetic that has already become a plain number is ignored; keeping this
 * pass conservative avoids treating measurement math as geometry.
 */
function checkTexCoordinateOperations() {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) {
    throw new Error("Unable to locate tsconfig.json for coordinate typing guard");
  }
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(formatTypeScriptDiagnostic(configFile.error));
  }
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    root,
    undefined,
    configPath
  );
  const textSourcePrefix = join(root, "packages/core/src/text/");
  const program = ts.createProgram({
    rootNames: parsedConfig.fileNames.filter((fileName) =>
      fileName.startsWith(textSourcePrefix)
    ),
    options: parsedConfig.options,
    projectReferences: parsedConfig.projectReferences
  });
  const checker = program.getTypeChecker();

  for (const sourceFile of program.getSourceFiles()) {
    if (
      sourceFile.isDeclarationFile ||
      !sourceFile.fileName.startsWith(textSourcePrefix) ||
      relative(root, sourceFile.fileName) === texCoordinateConstructorFile
    ) {
      continue;
    }
    visit(sourceFile, sourceFile);
  }

  function visit(node, sourceFile) {
    if (ts.isBinaryExpression(node)) {
      checkBinaryExpression(node, sourceFile);
    } else if (ts.isCallExpression(node)) {
      checkCoordinateConstructorCall(node, sourceFile);
    }
    ts.forEachChild(node, (child) => visit(child, sourceFile));
  }

  function checkBinaryExpression(node, sourceFile) {
    const operator = node.operatorToken.kind;
    if (
      operator !== ts.SyntaxKind.PlusToken &&
      operator !== ts.SyntaxKind.MinusToken
    ) {
      return;
    }

    const left = texCoordinateAlias(checker.getTypeAtLocation(node.left), checker);
    const right = texCoordinateAlias(checker.getTypeAtLocation(node.right), checker);
    if (!left || !right || isAllowedTexArithmetic(left, right, operator)) {
      return;
    }

    addTypeScriptViolation(
      sourceFile,
      node.operatorToken,
      `unsafe TeX coordinate arithmetic (${left} ${node.operatorToken.getText(sourceFile)} ${right})`
    );
  }

  function checkCoordinateConstructorCall(node, sourceFile) {
    if (!ts.isIdentifier(node.expression) || node.arguments.length === 0) {
      return;
    }
    const target = texCoordinateConstructorTypes.get(node.expression.text);
    if (!target) {
      return;
    }
    const source = texCoordinateAlias(
      checker.getTypeAtLocation(node.arguments[0]),
      checker
    );
    if (!source || source === target) {
      return;
    }
    if (
      source !== "TexMuLength" &&
      target !== "TexMuLength" &&
      (texPointLengthTypes.has(source) || texPointLengthTypes.has(target))
    ) {
      return;
    }

    addTypeScriptViolation(
      sourceFile,
      node.expression,
      `direct TeX coordinate rebranding (${source} to ${target}); use an explicit transform`
    );
  }
}

const texCoordinateConstructorTypes = new Map([
  ["texLength", "TexLength"],
  ["texVListX", "TexVListX"],
  ["texVListLocalX", "TexVListLocalX"],
  ["texVListY", "TexVListY"],
  ["texVListLocalY", "TexVListLocalY"],
  ["texLineX", "TexLineX"],
  ["texLineLocalX", "TexLineLocalX"],
  ["texLineY", "TexLineY"],
  ["texHBoxX", "TexHBoxX"],
  ["texHBoxY", "TexHBoxY"],
  ["texHBoxLocalX", "TexHBoxLocalX"],
  ["texHBoxLocalY", "TexHBoxLocalY"],
  ["texHBoxOffsetX", "TexHBoxOffsetX"],
  ["texHBoxOffsetY", "TexHBoxOffsetY"],
  ["texMuLength", "TexMuLength"]
]);

const texPointLengthTypes = new Set(["TexLength"]);
const texPositionTypes = new Set([
  "TexVListX",
  "TexVListLocalX",
  "TexVListY",
  "TexVListLocalY",
  "TexLineX",
  "TexLineLocalX",
  "TexLineY",
  "TexHBoxX",
  "TexHBoxY",
  "TexHBoxLocalX",
  "TexHBoxLocalY"
]);
const texOffsetTypes = new Set(["TexHBoxOffsetX", "TexHBoxOffsetY"]);
const allowedTexAdditionPairs = new Set([
  coordinatePair("TexVListX", "TexVListLocalX"),
  coordinatePair("TexVListY", "TexVListLocalY"),
  coordinatePair("TexLineX", "TexLineLocalX"),
  coordinatePair("TexHBoxX", "TexHBoxLocalX"),
  coordinatePair("TexHBoxY", "TexHBoxLocalY"),
  coordinatePair("TexHBoxLocalX", "TexHBoxOffsetX"),
  coordinatePair("TexHBoxLocalY", "TexHBoxOffsetY")
]);
const allowedTexSubtractionPairs = new Set([
  directionalCoordinatePair("TexVListX", "TexVListLocalX"),
  directionalCoordinatePair("TexVListY", "TexVListLocalY"),
  directionalCoordinatePair("TexLineX", "TexLineLocalX"),
  directionalCoordinatePair("TexHBoxX", "TexHBoxLocalX"),
  directionalCoordinatePair("TexHBoxY", "TexHBoxLocalY"),
  directionalCoordinatePair("TexHBoxLocalX", "TexHBoxOffsetX"),
  directionalCoordinatePair("TexHBoxLocalY", "TexHBoxOffsetY")
]);

function isAllowedTexArithmetic(left, right, operator) {
  if (left === "TexMuLength" || right === "TexMuLength") {
    return left === "TexMuLength" && right === "TexMuLength";
  }
  if (texPointLengthTypes.has(left) || texPointLengthTypes.has(right)) {
    return true;
  }
  if (texOffsetTypes.has(left) && texOffsetTypes.has(right)) {
    return left === right;
  }
  if (
    operator === ts.SyntaxKind.PlusToken &&
    allowedTexAdditionPairs.has(coordinatePair(left, right))
  ) {
    return true;
  }
  if (
    operator === ts.SyntaxKind.MinusToken &&
    allowedTexSubtractionPairs.has(directionalCoordinatePair(left, right))
  ) {
    return true;
  }
  if (
    operator === ts.SyntaxKind.MinusToken &&
    left === right &&
    texPositionTypes.has(left)
  ) {
    return true;
  }
  return !(texPositionTypes.has(left) || texPositionTypes.has(right));
}

function coordinatePair(left, right) {
  return [left, right].sort().join("|");
}

function directionalCoordinatePair(left, right) {
  return `${left}|${right}`;
}

function texCoordinateAlias(type, checker) {
  const aliasName = type.aliasSymbol?.getName();
  if (aliasName && texCoordinateTypeNames.includes(aliasName)) {
    return aliasName;
  }
  const rendered = checker.typeToString(
    type,
    undefined,
    ts.TypeFormatFlags.NoTruncation
  );
  return texCoordinateTypeNames.includes(rendered) ? rendered : null;
}

function addTypeScriptViolation(sourceFile, node, reason) {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  violations.push({
    file: `${relative(root, sourceFile.fileName)}:${position.line + 1}:${position.character + 1}`,
    reason
  });
}

function formatTypeScriptDiagnostic(diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}

checkTexCoordinateOperations();

if (violations.length > 0) {
  console.error("Coordinate typing guard failed:");
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.reason}`);
  }
  process.exit(1);
}
