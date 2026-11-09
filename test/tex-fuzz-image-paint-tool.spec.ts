import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { execOracleTool } from "../scripts/lib/oracle-tool-process.mjs";
import { compareTexFuzzImagePaint } from "../scripts/lib/tex-fuzz-image-paint.mjs";

vi.mock("../scripts/lib/oracle-tool-process.mjs", () => ({ execOracleTool: vi.fn() }));
vi.mock("../scripts/lib/beamer-paint-compare.mjs", () => ({ compareColorMasks: vi.fn(() => []) }));

const directories: string[] = [];
afterEach(() => {
  vi.resetAllMocks();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("image oracle tool output", () => {
  function fixture() {
    const directory = mkdtempSync(join(tmpdir(), "tex-image-output-")); directories.push(directory);
    return { directory, pdfPath: join(directory, "case.pdf"), nativePngPath: join(directory, "native.png"), width: 20, height: 10 };
  }

  it.each(["MuPDF 1.23", "current MuPDF"])("reads the first SVG page written by %s", version => {
    const options = fixture();
    vi.mocked(execOracleTool).mockImplementation((command, args) => {
      if (command === "mutool") {
        const output = String(args[args.indexOf("-o") + 1]);
        // Older SVG writers append a page number to a literal filename;
        // current writers leave it literal. Both expand an explicit %d.
        const target = output.includes("%d") ? output.replace("%d", "1")
          : version === "MuPDF 1.23" ? output.replace(/\.svg$/u, "1.svg") : output;
        writeFileSync(target, '<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>');
      }
      return "";
    });
    expect(compareTexFuzzImagePaint(options).reference).toBe("MuPDF SVG / librsvg");
    expect(readFileSync(join(options.directory, "tex-image-paint.svg"), "utf8")).toContain("<path/>");
  });

  it("rejects a missing fresh page instead of accepting a previous run's SVG", () => {
    const options = fixture();
    writeFileSync(join(options.directory, "tex-image-paint.svg"), "<svg/>");
    writeFileSync(join(options.directory, "tex-image-paint-page-1.svg"), "<svg/>");
    vi.mocked(execOracleTool).mockReturnValue("");
    expect(() => compareTexFuzzImagePaint(options)).toThrow(/ENOENT/u);
  });
});
