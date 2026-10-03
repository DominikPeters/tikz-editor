#!/usr/bin/env python3
"""Check current Tauri wrapper types and ExitRequested policy without a native app."""
from pathlib import Path
import json
import os
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
LIB = (ROOT / "apps/desktop/src-tauri/src/lib.rs").read_text()
ASSISTANT = (ROOT / "apps/desktop/src-tauri/src/assistant.rs").read_text()


def function(source, name):
    start = re.search(r"\bfn " + re.escape(name) + r"\b", source).start()
    start = source.rfind("\n", 0, start) + 1
    brace = source.index("{", start)
    cursor, depth = brace + 1, 1
    while depth:
        depth += (source[cursor] == "{") - (source[cursor] == "}")
        cursor += 1
    return source[start:cursor]


deps = ROOT / "apps/desktop/src-tauri/target/debug/deps"
compiler = subprocess.check_output(["rustc", "--version"]).strip()
libraries = {}
for name in ["tauri"]:
    candidates = sorted((p for p in deps.glob(f"lib{name}-*.rlib") if compiler in p.read_bytes()), key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        raise SystemExit(f"Unavailable verification: no compatible compiled {name} dependency")
    libraries[name] = candidates[0]
fingerprints = deps.parent / ".fingerprint"
tauri_hash = libraries["tauri"].stem.removeprefix("libtauri-")
tauri_dependencies = json.loads((fingerprints / f"tauri-{tauri_hash}" / "lib-tauri.json").read_text())["deps"]
for name in ["serde", "serde_json"]:
    required = next(dependency[3] for dependency in tauri_dependencies if dependency[1] == name)
    for candidate in fingerprints.glob(f"{name}-*/lib-{name}"):
        if int.from_bytes(bytes.fromhex(candidate.read_text().strip()), "little") == required:
            library = deps / f"lib{candidate.parent.name}.rlib"
            if library.exists():
                libraries[name] = library
                break
    else:
        raise SystemExit(f"Unavailable verification: no {name} matching cached Tauri dependency graph")

tauri_fingerprint = int.from_bytes(bytes.fromhex((fingerprints / f"tauri-{tauri_hash}" / "lib-tauri").read_text().strip()), "little")
for candidate in sorted(deps.glob("libtauri_plugin_shell-*.rlib"), key=lambda path: path.stat().st_mtime, reverse=True):
    if compiler not in candidate.read_bytes():
        continue
    variant = candidate.stem.removeprefix("libtauri_plugin_shell-")
    graph = json.loads((fingerprints / f"tauri-plugin-shell-{variant}" / "lib-tauri_plugin_shell.json").read_text())["deps"]
    if any(dependency[1] == "tauri" and dependency[3] == tauri_fingerprint for dependency in graph):
        libraries["tauri_plugin_shell"] = candidate
        break
else:
    raise SystemExit("Unavailable verification: no shell plugin matching cached Tauri")
candidates = sorted((path for path in deps.glob("libbase64-*.rlib") if compiler in path.read_bytes()), key=lambda path: path.stat().st_mtime, reverse=True)
if not candidates:
    raise SystemExit("Unavailable verification: no compatible base64 dependency")
libraries["base64"] = candidates[0]
wrappers = LIB[LIB.index("#[tauri::command]\n#[allow(non_snake_case)]\nasync fn desktop_assistant_reset_document_thread"):LIB.index("#[cfg_attr(mobile, tauri::mobile_entry_point)]")]
program = "#![allow(dead_code)]\n#[path=" + json.dumps(str(ROOT / "apps/desktop/src-tauri/src/assistant.rs")) + "] mod assistant;\nuse assistant::*; use serde_json::Value;\n" + function(LIB, "run_assistant_command") + "\n" + wrappers

guard_start = LIB.index("            if let tauri::RunEvent::ExitRequested")
guard_end = LIB.index("            #[cfg(target_os = \"macos\")]", guard_start)
guard = LIB[guard_start:guard_end]
program += "\nuse tauri::{AppHandle,Manager,Emitter}; use std::sync::atomic::{AtomicBool,Ordering};\n#[derive(Default)] struct ExitApprovalState(AtomicBool);\n#[tauri::command]\n" + function(LIB, "desktop_confirm_window_close")
program += "\nfn check_exit_request(app:&AppHandle,event:tauri::RunEvent) {\n" + guard + "}\n"
exit_program = r'''
use std::sync::{Arc,atomic::{AtomicBool,AtomicI32,Ordering}};
#[derive(Default)] struct ExitApprovalState(AtomicBool);
#[derive(Default,Clone)] struct Api(Arc<AtomicBool>);
impl Api { fn prevent_exit(&self) { self.0.store(true,Ordering::Release); } }
mod tauri { pub const RESTART_EXIT_CODE:i32=i32::MAX; pub enum RunEvent { ExitRequested { code:Option<i32>,api:super::Api }, Other } }
#[derive(Clone)] struct Window { requested:Arc<AtomicBool> }
impl Window { fn emit(&self, name:&str, _:()) -> Result<(),()> { assert_eq!(name,"desktop-window-close-request");self.requested.store(true,Ordering::Release);Ok(()) } }
#[derive(Clone)] struct AppHandle { approved:Arc<ExitApprovalState>, window:Option<Window>, exited:Arc<AtomicI32> }
impl AppHandle {
 fn state<T>(&self)->&ExitApprovalState { &self.approved }
 fn get_webview_window(&self, _: &str)->Option<Window> { self.window.clone() }
 fn exit(&self, code:i32) { self.exited.store(code,Ordering::Release); }
}
'''
exit_program += function(LIB, "desktop_confirm_window_close")
exit_program += "\nfn event(app:&AppHandle,event:tauri::RunEvent) {\n" + guard + "}\n"
exit_program += r'''
fn main() {
 let request=Arc::new(AtomicBool::new(false));
 let app=AppHandle {approved:Arc::new(ExitApprovalState::default()),window:Some(Window{requested:request.clone()}),exited:Arc::new(AtomicI32::new(-1))};
 event(&app,tauri::RunEvent::Other); assert!(!request.load(Ordering::Acquire));
 for code in [None,Some(0),Some(42)] { let api=Api::default();event(&app,tauri::RunEvent::ExitRequested {code,api:api.clone()});assert!(api.0.load(Ordering::Acquire));assert!(request.swap(false,Ordering::AcqRel)); }
 let api=Api::default();event(&app,tauri::RunEvent::ExitRequested {code:Some(tauri::RESTART_EXIT_CODE),api:api.clone()});assert!(!api.0.load(Ordering::Acquire));assert!(!request.load(Ordering::Acquire));
 desktop_confirm_window_close(app.clone()).unwrap();
 assert!(app.approved.0.load(Ordering::Acquire)); assert_eq!(app.exited.load(Ordering::Acquire),0);
 let api=Api::default();event(&app,tauri::RunEvent::ExitRequested {code:Some(0),api:api.clone()});assert!(!api.0.load(Ordering::Acquire));assert!(!request.load(Ordering::Acquire));
 println!("PASS recognized exits prevent and request frontend policy; accepted exit allowed; Tauri restart remains explicitly uncancellable");
}
'''
with tempfile.TemporaryDirectory(prefix="tikz-native-commands-") as temp:
    src = Path(temp) / "commands.rs"
    src.write_text(program)
    args = ["rustc", "--edition=2021", "--crate-type=lib", "--emit=metadata", str(src), "-L", f"dependency={deps}", "-o", str(Path(temp) / "commands.rmeta")]
    for name, path in libraries.items():
        args += ["--extern", f"{name}={path}"]
    subprocess.run(args, check=True, env={**os.environ, "CARGO_PKG_NAME": "tikz-native-contracts", "CARGO_MANIFEST_DIR": str(ROOT / "apps/desktop/src-tauri")})
    print("PASS actual assistant module, all 17 command macros, blocking helper, and native quit/exit guard metadata typecheck")
    src.write_text(exit_program)
    executable = Path(temp) / "exit-policy"
    subprocess.run(["rustc", "--edition=2021", str(src), "-o", str(executable)], check=True)
    subprocess.run([str(executable)], check=True, timeout=10)
