import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function texOracleEnv(extra = {}) {
  return {
    ...process.env,
    TEXMFVAR: process.env.TEXMFVAR ?? "/private/tmp",
    TEXMFCACHE: process.env.TEXMFCACHE ?? "/private/tmp",
    ...extra,
  };
}

export function escapeTexText(text, options = {}) {
  const escaped = text.replaceAll("{", "\\{").replaceAll("}", "\\}");
  return options.preserveCommands === true ? escaped : escaped.replaceAll("\\", "\\\\");
}

export function runTexOracleDocument({
  engine,
  source,
  filename = "oracle.tex",
  tempPrefix = "tikz-tex-oracle-",
  env,
  maxBuffer,
}) {
  const tempDir = mkdtempSync(join(tmpdir(), tempPrefix));
  const texPath = join(tempDir, filename);
  writeFileSync(texPath, source, "utf8");
  try {
    return execFileSync(engine, ["--interaction=nonstopmode", "--halt-on-error", texPath], {
      encoding: "utf8",
      cwd: tempDir,
      env: texOracleEnv(env),
      maxBuffer,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
