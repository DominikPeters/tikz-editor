#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const rootDir = resolve(new URL("../..", import.meta.url).pathname);
const toolDir = resolve(rootDir, "tools/tex-paragraph-lab");
const publicDir = resolve(toolDir, "public");
const coreDistDir = resolve(rootDir, "packages/core/dist");
const port = Number(process.env.TEX_PARAGRAPH_LAB_PORT ?? 43291);
const host = process.env.TEX_PARAGRAPH_LAB_HOST ?? "127.0.0.1";
const oracleCache = new Map();

const mimeByExt = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (request.method === "POST" && url.pathname === "/api/oracle") {
      const payload = await readJsonBody(request);
      const result = await renderOracle(payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { ok: false, error: "Method not allowed." });
      return;
    }

    const filePath = resolveStaticPath(url.pathname);
    if (!filePath) {
      sendJson(response, 404, { ok: false, error: "Not found." });
      return;
    }
    const body = readFileSync(filePath);
    response.writeHead(200, {
      "content-type": mimeByExt.get(extname(filePath)) ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    if (request.method !== "HEAD") {
      response.end(body);
    } else {
      response.end();
    }
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, host, () => {
  console.log(`TeX paragraph lab: http://${host}:${port}`);
});

function resolveStaticPath(pathname) {
  if (pathname === "/") {
    return join(publicDir, "index.html");
  }
  if (pathname.startsWith("/core/")) {
    return safeJoin(coreDistDir, pathname.slice("/core/".length));
  }
  return safeJoin(publicDir, pathname.slice(1));
}

function safeJoin(baseDir, requestPath) {
  const normalized = normalize(requestPath).replace(/^(\.\.(?:\/|\\|$))+/, "");
  const resolved = resolve(baseDir, normalized);
  if (resolved !== baseDir && !resolved.startsWith(`${baseDir}${sep}`)) {
    return null;
  }
  return existsSync(resolved) ? resolved : null;
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function renderOracle(input) {
  const options = normalizeOracleInput(input);
  const cacheKey = stableHash(JSON.stringify(options));
  const cached = oracleCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const tempDir = mkdtempSync(join(tmpdir(), "tikz-tex-paragraph-lab-"));
  try {
    const texPath = join(tempDir, "paragraph.tex");
    const pdfPath = join(tempDir, "paragraph.pdf");
    const svgPath = join(tempDir, "paragraph.svg");
    writeFileSync(texPath, buildOracleDocument(options));

    const env = {
      ...process.env,
      TEXMFVAR: process.env.TEXMFVAR ?? "/private/tmp",
      TEXMFCACHE: process.env.TEXMFCACHE ?? "/private/tmp",
    };
    const latex = await execFileAsync(
      "lualatex",
      ["--interaction=nonstopmode", "--halt-on-error", texPath],
      { cwd: tempDir, env, timeout: 8000, maxBuffer: 2_000_000 }
    );
    await execFileAsync(
      "pdftocairo",
      ["-svg", pdfPath, svgPath],
      { cwd: tempDir, timeout: 5000, maxBuffer: 1_000_000 }
    );
    const pdfText = await execFileAsync(
      "pdftotext",
      ["-layout", "-nopgbrk", pdfPath, "-"],
      { cwd: tempDir, timeout: 5000, maxBuffer: 1_000_000 }
    );

    const svg = readFileSync(svgPath, "utf8");
    const result = {
      ok: true,
      compiler: "lualatex",
      svg,
      lineTexts: extractPdfTextLines(pdfText.stdout),
      visualRows: extractSvgRows(svg),
      logTail: tail(latex.stdout, 4000),
    };
    oracleCache.set(cacheKey, result);
    return result;
  } catch (error) {
    const stdout = error && typeof error === "object" && "stdout" in error ? String(error.stdout ?? "") : "";
    const stderr = error && typeof error === "object" && "stderr" in error ? String(error.stderr ?? "") : "";
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      lineTexts: extractPdfTextLines(stdout),
      logTail: tail(`${stdout}\n${stderr}`, 6000),
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function normalizeOracleInput(input) {
  const alignment = new Set(["ragged-right", "ragged-left", "center", "justified"]).has(input.alignment)
    ? input.alignment
    : "ragged-right";
  return {
    text: typeof input.text === "string" ? input.text.slice(0, 10_000) : "",
    width: clampFinite(Number(input.width), 20, 800, 150),
    parindent: clampFinite(Number(input.parindent), 0, 200, 0),
    alignment,
  };
}

function clampFinite(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function buildOracleDocument(options) {
  const tikzAlign = texTikzAlign(options.alignment);
  const visualSetup = `text width=${formatPt(options.width)}pt, align=${tikzAlign}, inner sep=0pt, outer sep=0pt, anchor=north west, execute at begin node={\\fontencoding{OT1}\\fontfamily{cmr}\\selectfont\\parindent=${formatPt(options.parindent)}pt}`;
  return String.raw`\documentclass[tikz,border=2pt]{standalone}
\usepackage[OT1]{fontenc}
\usepackage{amsmath,amssymb}
\renewcommand{\rmdefault}{cmr}
\pagestyle{empty}
\begin{document}
\fontencoding{OT1}\fontfamily{cmr}\selectfont
\begin{tikzpicture}
\node[${visualSetup}] at (0,0) {${options.text}};
\end{tikzpicture}
\end{document}
`;
}

function texTikzAlign(alignment) {
  switch (alignment) {
    case "ragged-left":
      return "right";
    case "center":
      return "center";
    case "justified":
      return "justify";
    case "ragged-right":
    default:
      return "left";
  }
}

function extractPdfTextLines(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function extractSvgRows(svg) {
  const rows = new Map();
  const usePattern = /<use\b[^>]*\bx="([^"]+)"[^>]*\by="([^"]+)"/g;
  for (const match of svg.matchAll(usePattern)) {
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }
    const rowKey = y.toFixed(3);
    const row = rows.get(rowKey) ?? { y, xStart: x, xEnd: x, glyphCount: 0 };
    row.xStart = Math.min(row.xStart, x);
    row.xEnd = Math.max(row.xEnd, x);
    row.glyphCount += 1;
    rows.set(rowKey, row);
  }
  return [...rows.values()]
    .sort((a, b) => a.y - b.y)
    .map((row) => ({
      y: Number(row.y.toFixed(3)),
      xStart: Number(row.xStart.toFixed(3)),
      xEnd: Number(row.xEnd.toFixed(3)),
      glyphCount: row.glyphCount,
    }));
}

function stableHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function formatPt(value) {
  return Number(value.toFixed(6)).toString();
}

function tail(value, maxLength) {
  return value.length <= maxLength ? value : value.slice(value.length - maxLength);
}
