#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const fontId = "cmr10";
const fixtures = process.argv.slice(2).length > 0
  ? process.argv.slice(2)
  : ["office", "fluff", "AV", "To", "--", "---", "``", "''"];
const generatedPath = resolve(
  process.cwd(),
  "packages/core/src/text/tex/fonts/data/computer-modern-ot1.generated.ts"
);

function loadGeneratedFonts() {
  const source = readFileSync(generatedPath, "utf8");
  const match = /export const COMPUTER_MODERN_OT1_FONTS(?:\s*:[^=]+)?\s*=\s*(?<json>[\s\S]+?)\n};/.exec(source);
  if (!match?.groups?.json) {
    throw new Error(`Could not extract generated font table from ${generatedPath}`);
  }
  return JSON.parse(`${match.groups.json}\n}`);
}

function ruleKey(left, right) {
  return `${left}:${right}`;
}

function shapeWithGeneratedFont(text, font) {
  const rules = new Map();
  for (const rule of font.ligKerns) {
    const key = ruleKey(rule[1], rule[2]);
    if (!rules.has(key)) {
      rules.set(key, rule);
    }
  }
  const nodes = [];
  let current = null;
  const emit = () => {
    if (!current) {
      return;
    }
    const metric = font.chars[String(current.code)];
    if (!metric) {
      throw new Error(`Missing metric for ${current.code}`);
    }
    nodes.push({ kind: "glyph", code: current.code, width: metric.width * font.designSize });
    current = null;
  };
  for (const char of text) {
    const next = { code: char.codePointAt(0) };
    if (!current) {
      current = next;
      continue;
    }
    const rule = rules.get(ruleKey(current.code, next.code));
    if (rule?.[0] === "lig") {
      current = { code: rule[3] };
      continue;
    }
    emit();
    if (rule?.[0] === "kern") {
      nodes.push({ kind: "kern", width: rule[3] * font.designSize });
    }
    current = next;
  }
  emit();
  return nodes;
}

function texEscapeHboxText(text) {
  return text.replaceAll("\\", "\\\\").replaceAll("{", "\\{").replaceAll("}", "\\}");
}

function shapeWithLuaTeX(text) {
  const tempDir = mkdtempSync(join(tmpdir(), "tikz-tex-shape-"));
  const texPath = join(tempDir, "shape.tex");
  const texSource = String.raw`\font\test=${fontId} at 10pt
\test\language=-1
\setbox0=\hbox{${texEscapeHboxText(text)}}
\directlua{
  for n in node.traverse(tex.box[0].list) do
    local kind = node.type(n.id)
    if kind == "glyph" then
      texio.write_nl("term", "TIKZ_SHAPE glyph " .. n.char .. " " .. (n.width / 65536))
    elseif kind == "kern" then
      texio.write_nl("term", "TIKZ_SHAPE kern " .. (n["kern"] / 65536))
    end
  end
}
\bye
`;
  writeFileSync(texPath, texSource);
  try {
    const output = execFileSync("luatex", ["--interaction=nonstopmode", "--halt-on-error", texPath], {
      encoding: "utf8",
      cwd: tempDir,
      env: {
        ...process.env,
        TEXMFVAR: process.env.TEXMFVAR ?? "/private/tmp",
        TEXMFCACHE: process.env.TEXMFCACHE ?? "/private/tmp",
      },
    });
    return output
      .split(/\r?\n/)
      .filter((line) => line.startsWith("TIKZ_SHAPE "))
      .map((line) => {
        const parts = line.split(/\s+/);
        if (parts[1] === "glyph") {
          return { kind: "glyph", code: Number(parts[2]), width: Number(parts[3]) };
        }
        return { kind: "kern", width: Number(parts[2]) };
      });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function compareNodes(text, actual, expected) {
  const errors = [];
  if (actual.length !== expected.length) {
    errors.push(`node count ${actual.length} != ${expected.length}`);
  }
  const count = Math.min(actual.length, expected.length);
  for (let index = 0; index < count; index++) {
    const left = actual[index];
    const right = expected[index];
    if (left.kind !== right.kind) {
      errors.push(`${text}[${index}] kind ${left.kind} != ${right.kind}`);
      continue;
    }
    if (left.kind === "glyph" && left.code !== right.code) {
      errors.push(`${text}[${index}] glyph ${left.code} != ${right.code}`);
    }
    if (Math.abs(left.width - right.width) > 0.00008) {
      errors.push(`${text}[${index}] width ${left.width.toFixed(8)} != ${right.width.toFixed(8)}`);
    }
  }
  return errors;
}

const fonts = loadGeneratedFonts();
const font = fonts[fontId];
if (!font) {
  throw new Error(`Generated font table does not include ${fontId}`);
}

let failures = 0;
for (const fixture of fixtures) {
  const actual = shapeWithGeneratedFont(fixture, font);
  const expected = shapeWithLuaTeX(fixture);
  const errors = compareNodes(fixture, actual, expected);
  if (errors.length > 0) {
    failures += 1;
    console.error(`FAIL ${JSON.stringify(fixture)}`);
    for (const error of errors) {
      console.error(`  ${error}`);
    }
  } else {
    console.log(`ok ${JSON.stringify(fixture)} ${actual.length} nodes`);
  }
}

if (failures > 0) {
  process.exitCode = 1;
}
