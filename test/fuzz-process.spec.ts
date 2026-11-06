import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { execOracleTool } from "../scripts/lib/oracle-tool-process.mjs";
import { runFuzzProcess } from "../scripts/lib/fuzz-process.mjs";

describe("isolated fuzz process", () => {
  it("kills a synchronous hang and runs the next case", async () => {
    const out = mkdtempSync(join(tmpdir(), "fuzz-watchdog-"));
    try {
      const hung = await runFuzzProcess(process.execPath, ["-e", "while(true){}"], { timeoutMs: 250, heapMb: 64, logPath: join(out, "hang.log") });
      expect(hung.status).toBe("timeout");
      expect(hung.elapsedMs).toBeLessThan(5000);
      const next = await runFuzzProcess(process.execPath, ["-e", "console.log('ready')"], { timeoutMs: 3000, heapMb: 64, logPath: join(out, "next.log") });
      expect(next.status).toBe("completed");
      expect(readFileSync(join(out, "next.log"), "utf8")).toContain("ready");
    } finally { rmSync(out, { recursive: true, force: true }); }
  });
  it.skipIf(process.platform === "win32")("kills descendants with the case process group", async () => {
    const out = mkdtempSync(join(tmpdir(), "fuzz-tree-"));
    try {
      const started = join(out, "started"), leaked = join(out, "leaked");
      const grandchild = `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(started)},'ready');setTimeout(()=>fs.writeFileSync(${JSON.stringify(leaked)},'leak'),1000);`;
      const target = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore'});while(true){}`;
      const result = await runFuzzProcess(process.execPath, ["-e", target], { timeoutMs: 400, heapMb: 64, logPath: join(out, "tree.log") });
      expect(result.status).toBe("timeout");
      expect(existsSync(started)).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(existsSync(leaked)).toBe(false);
    } finally { rmSync(out, { recursive: true, force: true }); }
  });
  it("bounds a synchronous native oracle call", () => {
    expect(() => execOracleTool(process.execPath, ["-e", "while(true){}"], { encoding: "utf8", timeout: 100 })).toThrow(/ETIMEDOUT/u);
  });
  it("applies the heap cap and distinguishes actual worker OOM", async () => {
    const out = mkdtempSync(join(tmpdir(), "fuzz-memory-"));
    try {
      const cap = await runFuzzProcess(process.execPath, ["-e", "console.log(require('node:v8').getHeapStatistics().heap_size_limit)"], { timeoutMs: 3000, heapMb: 64, logPath: join(out, "cap.log") });
      expect(cap.status).toBe("completed");
      const larger = await runFuzzProcess(process.execPath, ["-e", "console.log(require('node:v8').getHeapStatistics().heap_size_limit)"], { timeoutMs: 3000, heapMb: 128, logPath: join(out, "larger.log") });
      expect(larger.status).toBe("completed");
      expect(Number(readFileSync(join(out, "larger.log"), "utf8")) - Number(readFileSync(join(out, "cap.log"), "utf8"))).toBe(64 * 1024 * 1024);
      const oom = await runFuzzProcess(process.execPath, ["-e", `const {Worker}=require('node:worker_threads'); const w=new Worker('const a=[];while(true)a.push(new Array(100000).fill(1))',{eval:true,resourceLimits:{maxOldGenerationSizeMb:8}});w.on('error',e=>{console.error(e.code);process.exitCode=1});`],
        { timeoutMs: 5000, heapMb: 64, logPath: join(out, "oom.log") });
      expect(oom.status).toBe("oom");
    } finally { rmSync(out, { recursive: true, force: true }); }
  });
  it("bounds log output and handles startup failures separately", async () => {
    const out = mkdtempSync(join(tmpdir(), "fuzz-output-"));
    try {
      const flood = await runFuzzProcess(process.execPath, ["-e", "while(true)console.log('x'.repeat(1000))"], { timeoutMs: 3000, maxOutputBytes: 4096, heapMb: 64, logPath: join(out, "flood.log") });
      expect(flood.status).toBe("output-limit");
      expect(readFileSync(join(out, "flood.log")).length).toBe(4096);
      const missing = await runFuzzProcess(join(out, "missing"), [], { timeoutMs: 3000, logPath: join(out, "missing.log") });
      expect(missing.status).toBe("startup-error");
    } finally { rmSync(out, { recursive: true, force: true }); }
  });
});
