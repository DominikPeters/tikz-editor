#!/usr/bin/env python3
"""Run current native lifecycle methods against isolated IPC and temporary files.

Only AppHandle and Codex transport are substituted. No native app/process starts.
Uses existing compatible Rust dependencies; fails explicitly if unavailable.
"""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "apps/desktop/src-tauri/src/assistant.rs").read_text()


def between(start, end):
    offset = SOURCE.index(start)
    return SOURCE[offset:SOURCE.index(end, offset)]


rust = r'''
#![allow(dead_code)]
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::{fs, sync::{Arc, Mutex, mpsc}};
use std::time::{SystemTime, UNIX_EPOCH};
use base64::Engine;
use serde_json::{Value, json};
const ASSISTANT_EVENT_NAME: &str = "assistant";
#[derive(Clone)] struct AssistantPastedImageInput { base64: String, mime_type: String, file_name: String }
#[derive(Debug)] struct AssistantThreadSummary { thread_id: String, workspace_path: String, figure_path: String, preview_path: String }
struct AssistantThreadStatePayload { thread_id: String, workspace_path: String, figure_path: String, preview_path: String, items: Vec<Value> }
#[derive(Clone)] struct AssistantEventPayload { kind: String, data: Value }
#[derive(Clone)] struct AppHandle { root: PathBuf, events: Arc<Mutex<Vec<AssistantEventPayload>>> }
impl AppHandle {
    fn path(&self) -> Self { self.clone() }
    fn app_cache_dir(&self) -> Result<PathBuf, String> { Ok(self.root.clone()) }
    fn emit(&self, _: &str, payload: AssistantEventPayload) -> Result<(), String> { self.events.lock().unwrap().push(payload); Ok(()) }
}
struct AssistantStateInner {
    app: AppHandle, documents: Mutex<HashMap<String, DocumentAssistantSession>>,
    session_generations: Mutex<HashMap<String, u64>>, initializing: Mutex<()>,
    requests: Mutex<Vec<(String, Value)>>, errors: Mutex<Vec<Value>>, approval_policy: Mutex<String>,
    pause: Mutex<Option<(mpsc::Sender<()>, mpsc::Receiver<()>)>>,
}
#[derive(Clone)] struct AssistantState { inner: Arc<AssistantStateInner> }
impl AssistantState {
    fn fixture(root: &Path) -> Self { Self { inner: Arc::new(AssistantStateInner {
        app: AppHandle { root: root.into(), events: Arc::new(Mutex::new(Vec::new())) },
        documents: Mutex::new(HashMap::new()), session_generations: Mutex::new(HashMap::new()), initializing: Mutex::new(()),
        requests: Mutex::new(Vec::new()), errors: Mutex::new(Vec::new()), approval_policy: Mutex::new("never".into()), pause: Mutex::new(None),
    }) } }
    fn ensure_process(&self) -> Result<(), String> { Ok(()) }
    fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = { let mut requests = self.inner.requests.lock().unwrap(); requests.push((method.into(), params)); requests.len() };
        if method == "thread/start" {
            if let Some((started, released)) = self.inner.pause.lock().unwrap().take() { started.send(()).unwrap(); released.recv().unwrap(); }
        }
        Ok(if method == "turn/start" { json!({"turn": {"id": format!("turn-{id}")}}) } else { json!({"thread": {"id": format!("thread-{id}")}}) })
    }
    fn send_server_request_error(&self, id: Value, _: i64, _: &str) -> Result<(), String> { self.inner.errors.lock().unwrap().push(id); Ok(()) }
    fn send_server_request_response(&self, _: Value, _: Value) -> Result<(), String> { Ok(()) }
'''
rust += between("    pub fn reset_document_thread(", "    pub fn warm_up(")
rust += between("    pub fn sync_source(", "    fn send_server_request_response(")
rust += between("    fn poll_figure_files(", "    fn ensure_process(")
rust += between("    fn handle_server_request(", "fn normalize_approval_policy_value(")
rust += between("#[derive(Clone)]\nenum PendingServerRequestKind", "#[derive(Serialize)]\npub struct AssistantThreadSummary")
rust += between("fn normalize_approval_policy_value(", "fn spawn_command_event_reader(")
rust += between("fn summary_from_session(", "#[cfg(test)]")
rust += r'''
fn ensure(state: &AssistantState, generation: u64) -> AssistantThreadSummary {
    state.ensure_document_thread("doc".into(), generation, "current source".into(), None, None, None, None).unwrap()
}
fn turn(state: &AssistantState, generation: u64) {
    state.start_turn("doc".into(), generation, "prompt".into(), "current source".into(), None, None, None, None, None, None, None, None, None).unwrap();
}
fn main() {
    let root = PathBuf::from(std::env::args().nth(1).unwrap());
    let state = AssistantState::fixture(&root);
    let first = ensure(&state, 0);
    let retry = ensure(&state, 0);
    assert_eq!(first.thread_id, retry.thread_id); // Ordinary null identity retries reuse ownership.
    turn(&state, 0);
    turn(&state, 0);
    { let requests = state.inner.requests.lock().unwrap();
      assert!(requests[1].1["input"][0]["text"].as_str().unwrap().contains("WYSIWYG TikZ editor"));
      assert!(!requests[2].1["input"][0]["text"].as_str().unwrap().contains("WYSIWYG TikZ editor")); }
    state.handle_server_request(json!({"id":"pending", "method":"item/tool/call", "params":{"threadId":first.thread_id,"tool":"preview"}}));
    state.handle_notification(json!({"method":"item/started", "params":{"threadId":first.thread_id,"item":{"id":"old-item"}}}));
    state.reset_document_thread("doc".into(), 1).unwrap();
    assert!(state.load_thread_state("doc".into(), 1).unwrap().is_none());
    assert_eq!(*state.inner.errors.lock().unwrap(), vec![json!("pending")]);
    let second = ensure(&state, 1);
    state.reset_document_thread("doc".into(), 1).unwrap(); // Delayed duplicate reset cannot remove the new session.
    assert_eq!(ensure(&state, 1).thread_id, second.thread_id);
    assert!(!state.register_server_request("doc",0,"late-request".into(),PendingServerRequest { id:json!("late-request"),kind:PendingServerRequestKind::DynamicToolCall }));
    assert!(state.inner.errors.lock().unwrap().contains(&json!("late-request")));
    assert_ne!(first.thread_id, second.thread_id);
    assert_ne!(first.figure_path, second.figure_path);
    let loaded = state.load_thread_state("doc".into(), 1).unwrap().unwrap();
    assert!(loaded.items.is_empty());
    assert!(state.inner.documents.lock().unwrap()["doc"].current_turn_id.is_none());
    assert!(state.inner.documents.lock().unwrap()["doc"].pending_server_requests.is_empty());
    assert!(state.sync_source("doc".into(), 0, "retired source".into()).is_err());
    assert!(state.respond_to_dynamic_tool_call("doc".into(), 0, "pending".into(), json!({"contentItems":[{"type":"image","data":"b2xk"}]})).is_err());
    assert!(!Path::new(&second.preview_path).exists());
    let before = state.inner.app.events.lock().unwrap().len();
    for method in ["item/started", "turn/started", "error"] {
      state.handle_notification(json!({"method":method,"params":{"threadId":first.thread_id,"item":{"id":"late"},"turn":{"id":"late-turn"}}}));
    }
    state.emit_event(AssistantEventPayload { kind:"source-updated".into(),data:json!({"documentId":"doc","sessionGeneration":0,"source":"retired"}) }).unwrap();
    fs::write(&first.figure_path, "old thread write").unwrap();
    state.poll_figure_files();
    assert_eq!(state.inner.app.events.lock().unwrap().len(), before);
    assert_eq!(fs::read_to_string(&second.figure_path).unwrap(), "current source");
    fs::write(&second.figure_path, "new thread write").unwrap();
    state.poll_figure_files();
    assert_eq!(state.inner.app.events.lock().unwrap().last().unwrap().data["sessionGeneration"], 1);
    turn(&state, 1);
    assert!(state.inner.requests.lock().unwrap().last().unwrap().1["input"][0]["text"].as_str().unwrap().contains("WYSIWYG TikZ editor"));
    let restarted = AssistantState::fixture(&root);
    let restored = restarted.ensure_document_thread("doc".into(),1,"restored".into(),Some(second.thread_id.clone()),Some(first.workspace_path),Some(first.figure_path),Some(first.preview_path)).unwrap();
    assert_eq!(restored.figure_path, second.figure_path);
    assert_eq!(restored.thread_id, second.thread_id);
    assert!(state.ensure_document_thread("doc".into(),0,"stale".into(),None,None,None,None).is_err());
    println!("PASS reset, retry, pending requests, initial context, late events/source/preview, persisted generation");

    let racing = AssistantState::fixture(&root.join("racing"));
    let (started_tx, started_rx) = mpsc::channel(); let (release_tx, release_rx) = mpsc::channel();
    *racing.inner.pause.lock().unwrap() = Some((started_tx, release_rx));
    let worker = racing.clone();
    let pending = std::thread::spawn(move || worker.ensure_document_thread("doc".into(),0,"old".into(),None,None,None,None));
    started_rx.recv().unwrap();
    racing.reset_document_thread("doc".into(),1).unwrap();
    release_tx.send(()).unwrap();
    assert!(pending.join().unwrap().is_err());
    let fresh = ensure(&racing,1);
    assert_eq!(fs::read_to_string(fresh.figure_path).unwrap(), "current source");
    println!("PASS reset during pending initialization cannot reclaim cache ownership");
}
'''

deps = ROOT / "apps/desktop/src-tauri/target/debug/deps"
compiler = subprocess.check_output(["rustc", "--version"]).strip()
libraries = {}
for name in ["serde_json", "base64"]:
    candidates = sorted((p for p in deps.glob(f"lib{name}-*.rlib") if compiler in p.read_bytes()), key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        raise SystemExit(f"Unavailable verification: no compatible compiled {name} dependency")
    libraries[name] = candidates[0]
with tempfile.TemporaryDirectory(prefix="tikz-assistant-session-") as temp:
    src, executable = Path(temp) / "contracts.rs", Path(temp) / "contracts"
    src.write_text(rust)
    args = ["rustc", "--edition=2021", str(src), "-L", f"dependency={deps}", "-o", str(executable)]
    for name, path in libraries.items():
        args += ["--extern", f"{name}={path}"]
    subprocess.run(args, check=True)
    subprocess.run([str(executable), str(Path(temp) / "files")], check=True, timeout=30)
