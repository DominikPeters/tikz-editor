import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileSha256 } from "./beamer-frame-oracle.mjs";
import { texOracleEnv } from "./tex-oracle.mjs";

/** Instrument the authored document, independently of the native renderer. */
export function instrumentBeamerDeckCounters(source, document) {
  let result = "";
  let cursor = 0;
  const mark = (phase, index) => `\n\\typeout{TIKZ_BEAMER_CONTEXT ${phase} ${index} \\arabic{framenumber} \\arabic{page} \\arabic{figure} \\arabic{table}}\n`;
  for (const [index, frame] of document.frames.entries()) {
    if (!frame.endSpan) throw new Error(`Full-deck counter context requires complete frame ${index + 1}.`);
    result += source.slice(cursor, frame.span.from) + mark("B", index) + source.slice(frame.span.from, frame.span.to) + mark("E", index);
    cursor = frame.span.to;
  }
  return result + source.slice(cursor);
}

export function parseBeamerDeckCounters(log, navSource, frameCount) {
  const entries = new Map();
  for (const match of log.matchAll(/TIKZ_BEAMER_CONTEXT ([BE]) (\d+) (\d+) (\d+)(?: (\d+) (\d+))?/gu)) {
    const index = Number(match[2]);
    const frame = entries.get(index) ?? {};
    if (match[1] === "B") { frame.beforeFrameNumber = Number(match[3]); frame.firstPage = Number(match[4]); }
    else { frame.afterFrameNumber = Number(match[3]); frame.lastPage = Number(match[4]) - 1; }
    if (match[1] === "B" && match[5] !== undefined) {
      frame.beforeFigureNumber = Number(match[5]); frame.beforeTableNumber = Number(match[6]);
    }
    entries.set(index, frame);
  }
  const total = /\\gdef\s*\\inserttotalframenumber\s*\{(\d+)\}/u.exec(navSource);
  if (!total) throw new Error("Full-deck .nav does not contain an actual total frame number.");
  const frames = Array.from({ length: frameCount }, (_, index) => {
    const frame = entries.get(index);
    if (!frame || !Object.values(frame).every(Number.isInteger) || ![4,6].includes(Object.keys(frame).length)) throw new Error(`Full-deck counter context missing authored frame ${index + 1}.`);
    return frame;
  });
  return { totalFrames: Number(total[1]), frames, navSource };
}

/** Cache by source/tool context and validate every recorder input dependency. */
export function collectBeamerDeckContext({ source, document, inputPath, sourceDir = dirname(inputPath), texRoot, cacheDir }) {
  const engine = execFileSync("lualatex", ["--version"], { encoding: "utf8" });
  const beamerClass = execFileSync("kpsewhich", ["beamer.cls"], { encoding: "utf8" }).trim();
  const digest = createHash("sha256").update(JSON.stringify({ version: 2, source, sourceDir, texRoot, engine, beamerClassSha256: fileSha256(beamerClass) })).digest("hex");
  const directory = join(cacheDir, digest);
  const contextPath = join(directory, "context.json");
  if (existsSync(contextPath)) {
    const cached = JSON.parse(readFileSync(contextPath, "utf8"));
    if (cached.dependencies.every(dependency => existsSync(dependency.path) && fileSha256(dependency.path) === dependency.sha256)) return { ...cached.context, cacheDirectory: directory, cached: true };
  }
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "deck-context.tex"), instrumentBeamerDeckCounters(source, document));
  const searchPath = [directory, sourceDir, ...(texRoot ? [`${texRoot}//`] : [])].join(delimiter) + delimiter;
  for (let pass = 1; pass <= 2; pass++) {
    try {
      const stdout = execFileSync("lualatex", ["--interaction=nonstopmode", "--halt-on-error", "--file-line-error", "--no-shell-escape", "--recorder", `--output-directory=${directory}`, join(directory, "deck-context.tex")], {
        cwd: sourceDir, encoding: "utf8", maxBuffer: 30 * 1024 * 1024,
        env: texOracleEnv({ TEXINPUTS: searchPath + (process.env.TEXINPUTS ?? ""), BIBINPUTS: searchPath + (process.env.BIBINPUTS ?? "") }),
      });
      writeFileSync(join(directory, `lualatex-pass-${pass}.txt`), stdout);
    } catch (error) {
      writeFileSync(join(directory, `lualatex-pass-${pass}.txt`), `${error.stdout ?? ""}\n${error.stderr ?? ""}`);
      throw new Error(`Full-deck TeX counter context failed; inspect ${join(directory, `lualatex-pass-${pass}.txt`)}.`, { cause: error });
    }
  }
  const context = parseBeamerDeckCounters(readFileSync(join(directory, "deck-context.log"), "utf8"), readFileSync(join(directory, "deck-context.nav"), "utf8"), document.frames.length);
  const dependencies = [...new Set(readFileSync(join(directory, "deck-context.fls"), "utf8").split(/\r?\n/u).filter(line => line.startsWith("INPUT ")).map(line => {
    const path = line.slice(6);
    return isAbsolute(path) ? path : resolve(sourceDir, path);
  }))].filter(path => !path.startsWith(`${directory}/`) && existsSync(path) && statSync(path).isFile()).map(path => ({ path, sha256: fileSha256(path) }));
  writeFileSync(contextPath, `${JSON.stringify({ context, dependencies }, null, 2)}\n`);
  return { ...context, cacheDirectory: directory, cached: false };
}
