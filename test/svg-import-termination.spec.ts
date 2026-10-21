import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const importer = fileURLToPath(new URL("../packages/app/src/ui/svg-import.ts", import.meta.url));
const script = `
import { installNodeSvgEnvironment } from 'svg2tikz/node-env';
import { convertSvgToScopeSnippet, resolveOpenedFileForDocument } from ${JSON.stringify(importer)};
installNodeSvgEnvironment();
await import('svg2tikz');
let source = '';
for await (const chunk of process.stdin) source += chunk;
process.stderr.write('READY\\n');
const snippet = await convertSvgToScopeSnippet(source);
const opened = await resolveOpenedFileForDocument({ source, fileRef: { kind: 'virtual', name: 'input.svg' } }, { requireSvg: true });
process.stdout.write(JSON.stringify({ snippet, opened }));
`;
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">${body}</svg>`;
const paths = [
  ["number after close", svg('<path d="M0 0Z1 2"/>')],
  ["number before command", svg('<path d="1 2"/>')],
  ["decimal before command", svg('<path d=".5,.5"/>')],
  ["signed number after lowercase close", svg('<path d="M0 0z-.5 .5"/>')],
  ["partial numeric token after close", svg('<path d="M0 0Z+"/>')],
  ["dot token after close", svg('<path d="M0 0Z."/>')],
  ["unknown skipped characters after close", svg('<path d="M0 0Z#?!1,2"/>')],
  ["decoded numeric entities", svg('<path d="&#x31; 2"/>')],
  ["decoded close and number entities", svg('<path d="M0 0&#x5a;&#49; 2"/>')],
  ["declared XML entity", '<!DOCTYPE svg [<!ENTITY bad "M0 0Z1 2">]>' + svg('<path d="&bad;"/>')],
  ["uppercase path tag", svg('<PATH d="1 2"/>')],
  ["path in another namespace", svg('<path xmlns="urn:other" d="M0 0Z1 2"/>')],
  ["prefixed path local name", svg('<p:path xmlns:p="urn:other" d="1 2"/>')],
  ["nested SVG and group", svg('<g><svg><g><path d="M0 0Z1 2"/></g></svg></g>')],
  ["marker preprocessor", svg('<defs><marker id="bad"><path d="1 2"/></marker></defs><rect width="10" height="10"/>')],
  ["referenced definitions", svg('<defs><path id="bad" d="M0 0Z1 2"/></defs><use href="#bad"/>')],
  ["owner-document use target outside selected SVG", '<root><path id="bad" d="1 2"/>' + svg('<use href="#bad"/>') + '</root>']
] as const;

describe("bounded actual application SVG import", () => {
  it.each(paths)("rejects %s through open and paste without hanging the worker", (_name, source) => {
    // A removed/bypassed guard may hang or exhaust memory. Keep that regression
    // confined to a READY-marked child, never the Vitest/UI process.
    const result = spawnSync(process.execPath, ["--max-old-space-size=128", "--import", "tsx", "--input-type=module", "-e", script], {
      input: source, encoding: "utf8", timeout: 8_000, maxBuffer: 100_000
    });
    expect(result.stderr).toContain("READY");
    expect(result.error, result.stderr.slice(-500)).toBeUndefined();
    expect(result.signal, result.stderr.slice(-500)).toBeNull();
    expect(result.status, result.stderr.slice(-500)).toBe(0);
    const converted = JSON.parse(result.stdout) as { snippet: { kind: string; message: string }; opened: { kind: string; message: string } };
    for (const imported of [converted.snippet, converted.opened]) {
      expect(imported.kind).toBe("failure");
      expect(imported.message).toMatch(/^SVG import failed: Malformed SVG path data:/u);
    }
  });
});
