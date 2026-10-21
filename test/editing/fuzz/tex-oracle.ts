import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * LuaLaTeX as the oracle for edited source: a deck compiled as TeX reads
 * it, and the errors it reports. Each compile runs in a fresh directory,
 * from the deck's own directory so that its inputs resolve.
 */

export type TexError = {
  /** The error line without its `! ` (`Undefined control sequence.`). */
  readonly message: string;
  /** For an undefined control sequence, its name (`\foo`). */
  readonly name: string | null;
  /** The source line TeX stopped on (`l.12 …`), and what it had read of it. */
  readonly line: number | null;
  readonly context: string;
};

export type Compilation = {
  readonly errors: readonly TexError[];
  readonly timedOut: boolean;
};

const TIMEOUT_MS = 60_000;

export function lualatexAvailable(): boolean {
  return (process.env.PATH ?? "").split(path.delimiter).some((directory) => fs.existsSync(path.join(directory, "lualatex")));
}

/** Compiles `source` as if it were the file at `deckPath`. */
export function compileDeck(source: string, deckPath: string): Promise<Compilation> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "keystroke-tex-oracle-"));
  const file = path.join(directory, "deck.tex");
  fs.writeFileSync(file, source, "utf8");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "lualatex",
      // Draft mode: errors without writing (or reading in) the PDF.
      ["--interaction=nonstopmode", "--draftmode", "--no-shell-escape", `--output-directory=${directory}`, file],
      {
        cwd: path.dirname(deckPath),
        env: { ...process.env, TEXMFVAR: process.env.TEXMFVAR ?? "/private/tmp", TEXMFCACHE: process.env.TEXMFCACHE ?? "/private/tmp" },
        stdio: ["ignore", "ignore", "ignore"],
      }
    );
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    child.on("error", reject);
    child.on("close", () => {
      clearTimeout(timer);
      const logPath = path.join(directory, "deck.log");
      const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
      fs.rmSync(directory, { recursive: true, force: true });
      resolve({ errors: texErrors(log), timedOut });
    });
  });
}

/**
 * A deck cut down to one frame: everything outside frames (preamble,
 * definitions, sections) stays, other frames go. Compiles in about half
 * the time of a whole deck, and errors in it are the frame's.
 * `edit` replaces a span inside the kept frame.
 */
export function oneFrameDeck(
  source: string,
  frames: readonly { readonly from: number; readonly to: number }[],
  keep: number,
  edit?: { readonly from: number; readonly to: number; readonly text: string }
): string {
  let result = "";
  let at = 0;
  frames.forEach((frame, index) => {
    result += source.slice(at, frame.from);
    if (index === keep) {
      result += edit ? source.slice(frame.from, edit.from) + edit.text + source.slice(edit.to, frame.to) : source.slice(frame.from, frame.to);
    }
    at = frame.to;
  });
  return result + source.slice(at);
}

/** The errors of a TeX log: each `! …` line, with the `l.N …` line that follows it. */
export function texErrors(log: string): TexError[] {
  const lines = log.split(/\r?\n/u);
  const errors: TexError[] = [];
  lines.forEach((text, index) => {
    if (!text.startsWith("! ")) {
      return;
    }
    let line: number | null = null;
    let context = "";
    let name: string | null = null;
    const message = text.slice(2);
    for (let next = index + 1; next < Math.min(lines.length, index + 12); next += 1) {
      // The first context line ends with the undefined name (in a frame, a line of the collected body).
      if (message.startsWith("Undefined control sequence") && name == null) {
        name = /(\\[A-Za-z@]+|\\.)$/u.exec(lines[next])?.[1] ?? null;
      }
      const match = /^l\.(\d+) (.*)$/u.exec(lines[next]);
      if (match) {
        line = Number(match[1]);
        context = match[2];
        break;
      }
    }
    errors.push({ message, name, line, context });
  });
  return errors;
}

/** An error as compared across compilations (the line moves with edits). */
export function errorKey(error: TexError): string {
  return error.name ? `${error.message} ${error.name}` : error.message;
}

/** The errors of `after` that `before` does not have, as many times as they are new. */
export function newErrors(before: readonly TexError[], after: readonly TexError[]): TexError[] {
  const counts = new Map<string, number>();
  for (const error of before) {
    counts.set(errorKey(error), (counts.get(errorKey(error)) ?? 0) + 1);
  }
  return after.filter((error) => {
    const left = counts.get(errorKey(error)) ?? 0;
    counts.set(errorKey(error), left - 1);
    return left <= 0;
  });
}

/** Runs `tasks` with at most `limit` at a time, keeping their order. */
export async function pooled<T>(tasks: readonly (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}
