import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserPlatformAdapter, type BrowserPlatformEnvironment } from "../apps/web/src/platform/browser-platform.js";
import { revisionForText } from "../packages/app/src/linked-file-sync.js";

const ORIGINAL = "original source";
const LOCAL = "local unsaved source";
const EXTERNAL = "external edit while permission is pending";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function linkedFileFixture() {
  const directory = await mkdtemp(join(tmpdir(), "tikz-linked-save-"));
  temporaryDirectories.push(directory);
  const path = join(directory, "figure.tex");
  await writeFile(path, ORIGINAL);
  let writePermission: PermissionState = "granted";
  const promptStarted = deferred<void>();
  const permissionDecision = deferred<PermissionState>();
  const handle = {
    name: "figure.tex",
    queryPermission: async ({ mode }: { mode: "read" | "readwrite" }): Promise<PermissionState> =>
      mode === "readwrite" ? writePermission : "granted",
    requestPermission: vi.fn(async () => {
      promptStarted.resolve();
      writePermission = await permissionDecision.promise;
      return writePermission;
    }),
    getFile: vi.fn(async () => {
      const source = await readFile(path, "utf8");
      const metadata = await stat(path);
      return {
        text: async () => source,
        arrayBuffer: async () => new ArrayBuffer(0),
        lastModified: metadata.mtimeMs,
        size: metadata.size
      };
    }),
    createWritable: vi.fn(async () => {
      let pendingText = "";
      return {
        write: async (text: string) => { pendingText = text; },
        close: async () => { await writeFile(path, pendingText); }
      };
    })
  };
  const handles = new Map<string, unknown>();
  const storage = new Map<string, string>();
  const environment: BrowserPlatformEnvironment = {
    storage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); }
    },
    fsHandleStore: {
      load: async id => handles.get(id),
      save: async (id, value) => { handles.set(id, value); }
    },
    fsApi: { showOpenFilePicker: async () => [handle] }
  };
  const platform = createBrowserPlatformAdapter(environment);
  const opened = await platform.files?.openText?.();
  if (!opened?.fileRef) throw new Error("Expected a linked file");
  const baseline = await platform.files?.readLinkedText?.(opened.fileRef);
  if (baseline?.status !== "ok") throw new Error("Expected a readable linked file");
  // A fresh adapter loads the same persisted handle, as on browser restore.
  const restored = createBrowserPlatformAdapter(environment);
  const writeLinkedText = restored.files?.writeLinkedText;
  if (!writeLinkedText) throw new Error("Expected linked-file writing");
  return {
    path, handle, writeLinkedText, fileRef: opened.fileRef, revision: baseline.revision,
    promptStarted: promptStarted.promise,
    requireWritePermission: () => { writePermission = "prompt"; },
    grantPermission: () => { permissionDecision.resolve("granted"); },
    denyPermission: () => { permissionDecision.resolve("denied"); },
    cancelPermission: () => { permissionDecision.reject(new DOMException("Cancelled", "AbortError")); }
  };
}

describe("browser linked-file saves", () => {
  it("preserves an external edit made during the restored handle's write permission prompt", async () => {
    const f = await linkedFileFixture();
    f.requireWritePermission();
    const saving = f.writeLinkedText(f.fileRef, LOCAL, f.revision);
    await f.promptStarted;
    await writeFile(f.path, EXTERNAL);
    f.grantPermission();

    const result = await saving;
    expect(result.status).toBe("changed-on-disk");
    if (result.status === "changed-on-disk") {
      expect(result.source).toBe(EXTERNAL);
      expect(result.revision.hash).toBe(revisionForText(EXTERNAL).hash);
      expect(result.fileRef).toEqual(f.fileRef);
    }
    expect(await readFile(f.path, "utf8")).toBe(EXTERNAL);
    expect(f.handle.createWritable).not.toHaveBeenCalled();
  });

  it("returns an existing conflict without starting a write permission prompt", async () => {
    const f = await linkedFileFixture();
    await writeFile(f.path, EXTERNAL);
    f.requireWritePermission();
    const result = await f.writeLinkedText(f.fileRef, LOCAL, f.revision);
    expect(result.status).toBe("changed-on-disk");
    expect(await readFile(f.path, "utf8")).toBe(EXTERNAL);
    expect(f.handle.requestPermission).not.toHaveBeenCalled();
    expect(f.handle.createWritable).not.toHaveBeenCalled();
  });

  it("allows an explicit force overwrite after permission is granted", async () => {
    const f = await linkedFileFixture();
    f.requireWritePermission();
    const saving = f.writeLinkedText(f.fileRef, LOCAL, null);
    await f.promptStarted;
    await writeFile(f.path, EXTERNAL);
    f.grantPermission();

    const result = await saving;
    expect(result.status).toBe("saved");
    expect(await readFile(f.path, "utf8")).toBe(LOCAL);
    expect(f.handle.requestPermission).toHaveBeenCalledTimes(1);
    if (result.status === "saved") expect(result.revision.hash).toBe(revisionForText(LOCAL).hash);
  });

  it("saves unchanged content with already granted write permission", async () => {
    const f = await linkedFileFixture();
    const result = await f.writeLinkedText(f.fileRef, LOCAL, f.revision);
    expect(result.status).toBe("saved");
    expect(await readFile(f.path, "utf8")).toBe(LOCAL);
    expect(f.handle.requestPermission).not.toHaveBeenCalled();
  });

  it.each(["deny", "cancel"] as const)("leaves the file untouched when permission is %s", async action => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const f = await linkedFileFixture();
    f.requireWritePermission();
    const saving = f.writeLinkedText(f.fileRef, LOCAL, f.revision);
    await f.promptStarted;
    if (action === "deny") f.denyPermission(); else f.cancelPermission();

    expect((await saving).status).toBe("permission-needed");
    expect(await readFile(f.path, "utf8")).toBe(ORIGINAL);
    expect(f.handle.createWritable).not.toHaveBeenCalled();
  });

  it("does not open a writable when the final file read fails", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const f = await linkedFileFixture();
    f.requireWritePermission();
    const saving = f.writeLinkedText(f.fileRef, LOCAL, f.revision);
    await f.promptStarted;
    f.handle.getFile.mockRejectedValueOnce(new Error("File is unavailable"));
    f.grantPermission();

    expect((await saving).status).toBe("failed");
    expect(await readFile(f.path, "utf8")).toBe(ORIGINAL);
    expect(f.handle.createWritable).not.toHaveBeenCalled();
  });

  it("reports writable failures as failures rather than permission cancellation", async () => {
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    const f = await linkedFileFixture();
    f.handle.createWritable.mockRejectedValueOnce(new Error("Write failed"));
    expect((await f.writeLinkedText(f.fileRef, LOCAL, f.revision)).status).toBe("failed");
    expect(await readFile(f.path, "utf8")).toBe(ORIGINAL);
  });
});
