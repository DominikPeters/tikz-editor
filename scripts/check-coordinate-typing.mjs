import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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

const violations = [];

for (const target of targets) {
  walk(join(root, target));
}

if (violations.length > 0) {
  console.error("Coordinate typing guard failed:");
  for (const violation of violations) {
    console.error(`- ${violation.file}: ${violation.reason}`);
  }
  process.exit(1);
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
  for (const { name, regex } of bannedPatterns) {
    if (regex.test(content)) {
      violations.push({
        file: relative(root, path),
        reason: name
      });
    }
  }
}
