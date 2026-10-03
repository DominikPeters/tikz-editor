/** @vitest-environment jsdom */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { act } from "react";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { mountFileApp, unmountFileApp } from "./app-file-operations-fixtures";
import { createDesktopPlatformAdapter, type DesktopBridge } from "../../apps/desktop/src/platform/desktop-platform";
import { getActiveEditorPlatform, setActiveEditorPlatform } from "../../packages/app/src/platform/current";
import { useEditorStore } from "../../packages/app/src/store/store";
import { revisionForText } from "../../packages/app/src/linked-file-sync";

vi.mock("../../apps/desktop/src/platform/native-menu", () => ({
  createNativeDesktopMenuManager: () => ({ sync: async () => {}, refreshRecents: () => {} }), serializeDesktopContextMenuItems: () => []
}));
const previousPlatform = getActiveEditorPlatform();
const previousState = useEditorStore.getState();
let temp: string;
let nativeEvents: string;
beforeAll(async () => {
  temp = await mkdtemp(join(tmpdir(), "tikz-linked-alias-events-"));
  nativeEvents = join(temp, "native-events");
  const production = readFileSync("apps/desktop/src-tauri/src/lib.rs", "utf8");
  const start = production.indexOf("fn linked_watch_identity(");
  const end = production.indexOf("fn linked_watch_directories(", start);
  const program = `use std::{path::{Path,PathBuf},collections::HashMap};\n${production.slice(start, end)}
fn main() { let args = std::env::args().skip(1).map(PathBuf::from).collect::<Vec<_>>();
let mut paths = args[1..].iter().map(|path| (path.clone(), linked_watch_identity(path))).collect::<HashMap<_,_>>();
for path in changed_linked_paths_for_event(&args[..1], &mut paths) { println!("{}", path.display()); } }`;
  const rust = join(temp, "native-events.rs");
  await writeFile(rust, program);
  execFileSync("rustc", ["--edition=2021", rust, "-o", nativeEvents]);
});
afterEach(async () => {
  vi.useRealTimers();
  await unmountFileApp();
  setActiveEditorPlatform(previousPlatform);
  useEditorStore.setState(previousState, true);
});
afterAll(async () => { await rm(temp, { recursive: true, force: true }); });

it("routes a canonical native target event through authored aliases, desktop adapter, and App refresh", async () => {
  const disk = join(temp, "actual.tex"), alias = join(temp, "Authored.tex");
  await writeFile(disk, "original");
  await symlink(disk, alias);
  let emit: ((payload: { path: string }) => void) | undefined;
  const read = vi.fn(async (path: string) => {
    const source = await readFile(path, "utf8");
    return { status: "ok" as const, source, revision: revisionForText(source), fileRef: { path, name: basename(path) } };
  });
  const watched = vi.fn(async () => {});
  const bridge = { onWindowCloseRequest: async () => () => {}, onContextMenuCommand: async () => () => {},
    onPendingOpenRequestsChanged: async () => () => {}, takePendingOpenRequests: async () => [], takePendingOpenFailures: async () => [],
    listRecentFiles: async () => [], setWindowTitle: async () => {}, setTheme: async () => {},
    readLinkedText: read, syncLinkedFileWatches: watched,
    onLinkedFileChanged: async (handler: (payload: { path: string }) => void) => { emit = handler; return () => { emit = undefined; }; }
  } as unknown as DesktopBridge;
  const platform = createDesktopPlatformAdapter({ bridge, storage: { getItem: () => null, setItem: () => {} } });
  const id = await mountFileApp(platform, "original");
  const fileRef = { kind: "file" as const, provider: "desktop-fs" as const, path: alias, name: "Authored.tex" };
  await act(async () => { useEditorStore.getState().dispatch({ type: "MARK_DOCUMENT_SAVED", documentId: id,
    fileRef, diskRevision: revisionForText("original"), lastKnownDiskSource: "original" }); });
  expect(watched).toHaveBeenLastCalledWith([alias]);
  await writeFile(disk, "external edit");
  const authoredEvents = execFileSync(nativeEvents, [await realpath(disk), alias], { encoding: "utf8" }).trim().split("\n");
  expect(authoredEvents).toEqual([alias]);
  vi.useFakeTimers();
  await act(async () => { for (const path of authoredEvents) emit?.({ path }); await vi.advanceTimersByTimeAsync(350); });
  expect(read).toHaveBeenCalledExactlyOnceWith(alias);
  await act(async () => { await read.mock.results[0].value; });
  expect(useEditorStore.getState().documents[id].source).toBe("external edit");
  expect(useEditorStore.getState().documents[id].fileRef).toEqual(fileRef);
});
