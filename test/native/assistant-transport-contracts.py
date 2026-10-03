#!/usr/bin/env python3
"""Compile current transport/worker bodies with controlled pipes and cached Rust deps.

No Tauri app, Codex process, full crate build, or live GUI starts. The heartbeat
is an executor contract, not a measured native UI latency claim.
"""
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = (ROOT / "apps/desktop/src-tauri/src/assistant.rs").read_text()
LIB = (ROOT / "apps/desktop/src-tauri/src/lib.rs").read_text()


def function(source, name):
    start = re.search(r"\bfn " + re.escape(name) + r"\b", source).start()
    start = source.rfind("\n", 0, start) + 1
    brace = source.index("{", start)
    cursor, depth = brace + 1, 1
    while depth:
        depth += (source[cursor] == "{") - (source[cursor] == "}")
        cursor += 1
    return source[start:cursor]


wrappers = re.findall(r"(?:async\s+)?fn (desktop_assistant_\w+)\(", LIB)
assert len(wrappers) == 17, wrappers
for name in wrappers:
    body = function(LIB, name)
    assert body.lstrip().startswith("async fn"), name + " is not asynchronously dispatched"
    assert "run_assistant_command(assistant.inner().clone(), move |assistant|" in body, name
assert ".process_initializing.lock()" in re.sub(r"\s+", "", function(SOURCE, "ensure_process"))
assert "self.request(" not in function(SOURCE, "ensure_process")  # Initialization cannot recursively lock itself.
reader = function(SOURCE, "spawn_command_event_reader")
assert reader.count("state.end_process(") == 3  # Error, termination, and channel closure.
assert "spawn_server_message_worker(state.clone(), process.clone())" in reader
assert "server_messages.send(message)" in reader
assert "spawn_blocking" in function(SOURCE, "spawn_server_message_worker")
for name in ["handle_server_request", "send_server_request_error", "send_server_request_response", "write_server_reply"]:
    assert "ensure_process" not in function(SOURCE, name), name + " must never re-enter initialization"

rust = r'''
#![allow(dead_code)]
use std::collections::HashMap;
use std::sync::{Arc, Mutex, mpsc::{self, Sender, RecvTimeoutError}, atomic::{AtomicBool, AtomicU64, Ordering}};
use std::time::Duration;
use serde_json::{Value, json};
mod tauri { pub mod async_runtime { pub use tokio::task::{spawn, spawn_blocking}; pub type Receiver<T> = tokio::sync::mpsc::Receiver<T>; } }
struct CommandChild { writer: Sender<Vec<u8>>, fail: bool, killed: Arc<AtomicBool>, slow: Arc<AtomicBool> }
impl CommandChild {
    fn write(&mut self, bytes: &[u8]) -> Result<(), String> {
        if self.fail { return Err("controlled write failure".into()); }
        if self.slow.load(Ordering::Acquire) { std::thread::sleep(Duration::from_millis(100)); }
        self.writer.send(bytes.into()).map_err(|_| "pipe closed".into())
    }
    fn kill(self) -> Result<(), String> { self.killed.store(true, Ordering::Release); Ok(()) }
}
'''
rust += SOURCE[SOURCE.index("#[derive(Clone)]\nstruct ProcessHandle {"):SOURCE.index("#[derive(Clone)]\nstruct DocumentAssistantSession")]
rust += r'''
struct DocumentAssistantSession { thread_id: String, session_generation: u64, pending_server_requests: HashMap<String, PendingServerRequest>, current_turn_id: Option<String>, items: Vec<Value> }
#[derive(Clone)] struct AssistantEventPayload { kind: String, data: Value }
struct AppHandle { events: Mutex<Vec<AssistantEventPayload>> }
struct PackageInfo { version: String }
impl AppHandle { fn package_info(&self) -> PackageInfo { PackageInfo { version: "controlled".into() } } }
enum CommandEvent { Stdout(Vec<u8>), Stderr(Vec<u8>), Error(String), Terminated(TerminatedPayload), Other }
struct TerminatedPayload { code: Option<i32>, signal: Option<i32> }
#[derive(Clone)] struct AssistantState { inner: Arc<Inner> }
struct Inner { process: Mutex<Option<ProcessHandle>>, process_initializing: Mutex<()>, next_server_request_id: AtomicU64, documents: Mutex<HashMap<String,DocumentAssistantSession>>, app: AppHandle, approval_policy: Mutex<String> }
impl AssistantState {
    fn fixture(fail: bool) -> (Self, mpsc::Receiver<Vec<u8>>, Arc<AtomicBool>) {
        let (writer, receiver) = mpsc::channel();
        let killed = Arc::new(AtomicBool::new(false));
        (Self { inner: Arc::new(Inner { process_initializing: Mutex::new(()), next_server_request_id: AtomicU64::new(1), documents: Mutex::new(HashMap::new()), app: AppHandle { events: Mutex::new(Vec::new()) }, approval_policy: Mutex::new("on-request".into()), process: Mutex::new(Some(ProcessHandle {
            child: Arc::new(Mutex::new(Some(CommandChild { writer, fail, killed: killed.clone(), slow: Arc::new(AtomicBool::new(false)) }))),
            pending: Arc::new(Mutex::new(HashMap::new())), next_request_id: Arc::new(AtomicU64::new(1)),
        })) }) }, receiver, killed)
    }
    fn pending(&self) -> PendingRequests { self.inner.process.lock().unwrap().as_ref().unwrap().pending.clone() }
    fn process(&self) -> ProcessHandle { self.inner.process.lock().unwrap().as_ref().unwrap().clone() }
    fn emit_event(&self, payload: AssistantEventPayload) -> Result<(), String> { self.inner.app.events.lock().unwrap().push(payload); Ok(()) }
'''
for name in ["request_in_process", "end_process", "write_json_line_to_child", "handle_response", "is_current_process", "write_server_reply", "send_server_request_error", "send_server_request_response", "handle_server_request", "handle_notification", "upsert_item", "register_server_request", "document_id_from_params", "respond_to_approval", "configure_approval_policy"]:
    rust += function(SOURCE, name) + "\n"
# The actual handshake tail executes under the same held initialization mutex;
# only launch/publish is substituted by a controlled pipe already in the slot.
handshake = function(SOURCE, "ensure_process")
rust += "fn initialize_fixture(&self) -> Result<ProcessHandle, String> { let _initializing = self.inner.process_initializing.lock().unwrap(); let process = self.process(); let pending = process.pending.clone();\n"
rust += handshake[handshake.index("        let app_version ="):]
rust += "}\n"
for name in ["request_id_to_key", "normalize_approval_policy_value", "normalize_approval_decision_value", "spawn_server_message_worker", "spawn_command_event_reader", "merge_json"]:
    rust += function(SOURCE, name) + "\n"
rust += function(LIB, "run_assistant_command")
rust += r'''
fn request_id(receiver: &mpsc::Receiver<Vec<u8>>) -> Value {
    outgoing(receiver)["id"].clone()
}
fn outgoing(receiver: &mpsc::Receiver<Vec<u8>>) -> Value {
    let line = receiver.recv_timeout(Duration::from_secs(1)).unwrap();
    assert_eq!(receiver.recv_timeout(Duration::from_secs(1)).unwrap(), b"\n");
    serde_json::from_slice::<Value>(&line).unwrap()
}
async fn read_outgoing(receiver: mpsc::Receiver<Vec<u8>>) -> (mpsc::Receiver<Vec<u8>>, Value) {
    tokio::task::spawn_blocking(move || { let message = outgoing(&receiver); (receiver, message) }).await.unwrap()
}
async fn send_stdout(sender: &tokio::sync::mpsc::Sender<CommandEvent>, message: Value) {
    let mut bytes = serde_json::to_vec(&message).unwrap(); bytes.push(b'\n');
    sender.send(CommandEvent::Stdout(bytes)).await.unwrap();
}
fn main() {
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
    runtime.block_on(async {
        let (state, pipe, _) = AssistantState::fixture(false);
        state.inner.documents.lock().unwrap().insert("doc".into(), DocumentAssistantSession { thread_id: "thread".into(), session_generation: 1, pending_server_requests: HashMap::new(), current_turn_id: None, items: Vec::new() });
        let origin = state.process();
        let (events, receiver) = tokio::sync::mpsc::channel(16);
        spawn_command_event_reader(state.clone(), receiver, origin.clone());
        let initializing = tokio::spawn(run_assistant_command(state.clone(), |state| state.initialize_fixture().map(|_| ())));
        let (mut pipe, initialize) = read_outgoing(pipe).await;
        assert_eq!(initialize["method"], "initialize");
        assert!(state.inner.process_initializing.try_lock().is_err());
        let slow = origin.child.lock().unwrap().as_ref().unwrap().slow.clone();
        slow.store(true, Ordering::Release);
        // One stdout chunk puts an error-producing server request before the
        // initialize response. A slow pipe must block only a worker, not the
        // reader or this single-thread runtime's heartbeat.
        let mut chunk = serde_json::to_vec(&json!({"id":null,"method":"unsupported","params":{}})).unwrap();
        chunk.push(b'\n');
        chunk.extend(serde_json::to_vec(&json!({"id":initialize["id"],"result":{}})).unwrap());
        chunk.push(b'\n');
        events.send(CommandEvent::Stdout(chunk)).await.unwrap();
        for _ in 0..5 { tokio::time::sleep(Duration::from_millis(5)).await; }
        assert!(origin.pending.lock().unwrap().is_empty(), "reader must consume initialize response while a worker writes its reply");
        assert!(!initializing.is_finished());
        let mut saw_invalid_id = false;
        let mut saw_initialized = false;
        let config_id = loop {
            let (next, message) = read_outgoing(pipe).await; pipe = next;
            if message["error"]["code"] == -32600 { saw_invalid_id = true; }
            if message["method"] == "initialized" { saw_initialized = true; }
            if message["method"] == "configRequirements/read" { break message["id"].clone(); }
        };
        slow.store(false, Ordering::Release);
        assert!(saw_initialized);
        assert!(state.inner.process_initializing.try_lock().is_err());
        send_stdout(&events, json!({"id":"missing-context","method":"unsupported","params":{}})).await;
        send_stdout(&events, json!({"id":"unsupported-method","method":"unsupported","params":{"threadId":"thread"}})).await;
        send_stdout(&events, json!({"id":"approval","method":"item/commandExecution/requestApproval","params":{"threadId":"thread"}})).await;
        send_stdout(&events, json!({"id":config_id,"result":{"requirements":{"allowedApprovalPolicies":["never"]}}})).await;
        tokio::time::timeout(Duration::from_secs(1), initializing).await.unwrap().unwrap().unwrap();
        assert_eq!(*state.inner.approval_policy.lock().unwrap(), "never");
        let mut saw_missing = false;
        let mut saw_unsupported = false;
        while !(saw_invalid_id && saw_missing && saw_unsupported) {
            let (next, message) = read_outgoing(pipe).await; pipe = next;
            saw_invalid_id |= message["error"]["code"] == -32600;
            saw_missing |= message["id"] == "missing-context" && message["error"]["code"] == -32602;
            saw_unsupported |= message["id"] == "unsupported-method" && message["error"]["code"] == -32601;
        }
        tokio::time::timeout(Duration::from_secs(1), async {
            while state.inner.documents.lock().unwrap()["doc"].pending_server_requests.is_empty() { tokio::time::sleep(Duration::from_millis(1)).await; }
        }).await.unwrap();
        let first_key = state.inner.documents.lock().unwrap()["doc"].pending_server_requests.keys().next().unwrap().clone();
        let reply_key = first_key.clone();
        run_assistant_command(state.clone(), move |state| state.respond_to_approval("doc".into(), 1, reply_key, "accept".into())).await.unwrap();
        let (next, response) = read_outgoing(pipe).await; pipe = next;
        assert_eq!(response["id"], "approval"); assert_eq!(response["result"]["decision"], "accept");
        println!("PASS actual reader/server handler interleaves requests before initialize/config responses with held initialization mutex and heartbeat; bound error/success replies complete");

        send_stdout(&events, json!({"method":"serverRequest/resolved","params":{"threadId":"thread","requestId":"approval"}})).await;
        tokio::time::timeout(Duration::from_secs(1), async {
            while !state.inner.app.events.lock().unwrap().iter().any(|event| event.kind == "approval-cleared" && event.data["requestId"] == first_key) { tokio::time::sleep(Duration::from_millis(1)).await; }
        }).await.unwrap();
        assert!(!state.inner.documents.lock().unwrap()["doc"].pending_server_requests.contains_key(&first_key));
        let error = state.respond_to_approval("doc".into(), 1, first_key, "accept".into()).unwrap_err();
        assert!(error.contains("Unknown approval request"));

        // Force registration to wait while the reader queues request+resolution
        // from a single chunk. They must remain ordered on their worker and
        // publish the same opaque GUI key even though the protocol uses a raw ID.
        let event_count = state.inner.app.events.lock().unwrap().len();
        let docs = state.inner.documents.lock().unwrap();
        let mut chunk = serde_json::to_vec(&json!({"id":77,"method":"item/commandExecution/requestApproval","params":{"threadId":"thread"}})).unwrap(); chunk.push(b'\n');
        chunk.extend(serde_json::to_vec(&json!({"method":"serverRequest/resolved","params":{"threadId":"thread","requestId":77}})).unwrap()); chunk.push(b'\n');
        events.try_send(CommandEvent::Stdout(chunk)).unwrap_or_else(|_| panic!("controlled event channel available"));
        for _ in 0..5 { tokio::time::sleep(Duration::from_millis(5)).await; }
        assert_eq!(state.inner.app.events.lock().unwrap().len(), event_count);
        drop(docs);
        tokio::time::timeout(Duration::from_secs(1), async {
            while state.inner.app.events.lock().unwrap().len() < event_count + 2 { tokio::time::sleep(Duration::from_millis(1)).await; }
        }).await.unwrap();
        {
            let published = state.inner.app.events.lock().unwrap();
            assert_eq!(published[event_count].kind, "approval-requested");
            assert_eq!(published[event_count + 1].kind, "approval-cleared");
            assert_eq!(published[event_count].data["approval"]["requestId"], published[event_count + 1].data["requestId"]);
            assert!(published[event_count + 1].data["requestId"].as_str().unwrap().starts_with("server-"));
        }
        assert!(state.inner.documents.lock().unwrap()["doc"].pending_server_requests.is_empty());
        println!("PASS actual resolution notification translates raw IDs to GUI keys; same-chunk request/resolved stays ordered before delayed registration and clears pending/UI identity");

        state.handle_server_request(json!({"id":"reused","method":"item/commandExecution/requestApproval","params":{"threadId":"thread"}}), &origin);
        let old_key = state.inner.documents.lock().unwrap()["doc"].pending_server_requests.iter().find(|(_, request)| request.id == "reused").unwrap().0.clone();
        let (replacement, replacement_pipe, killed) = AssistantState::fixture(false);
        *state.inner.process.lock().unwrap() = replacement.inner.process.lock().unwrap().take();
        let current = state.process();
        state.handle_server_request(json!({"id":"reused","method":"item/commandExecution/requestApproval","params":{"threadId":"thread"}}), &current);
        let new_key = state.inner.documents.lock().unwrap()["doc"].pending_server_requests.iter().find(|(_, request)| request.id == "reused" && Arc::ptr_eq(&request.process.pending, &current.pending)).unwrap().0.clone();
        assert_ne!(old_key, new_key, "GUI identities must not collide when server IDs are reused");
        send_stdout(&events, json!({"id":"late-reader","method":"unsupported","params":{"threadId":"thread"}})).await;
        let delayed_key = old_key.clone();
        let error = run_assistant_command(state.clone(), move |state| state.respond_to_approval("doc".into(), 1, delayed_key, "accept".into())).await.unwrap_err();
        assert!(error.contains("stopped process"));
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(matches!(replacement_pipe.try_recv(), Err(mpsc::TryRecvError::Empty)));
        assert!(matches!(pipe.try_recv(), Err(mpsc::TryRecvError::Empty)));
        let event_count = state.inner.app.events.lock().unwrap().len();
        state.handle_notification(json!({"method":"serverRequest/resolved","params":{"threadId":"thread","requestId":"unknown"}}), &origin);
        assert_eq!(state.inner.app.events.lock().unwrap().len(), event_count);
        assert!(state.inner.documents.lock().unwrap()["doc"].pending_server_requests.contains_key(&old_key));
        send_stdout(&events, json!({"method":"serverRequest/resolved","params":{"threadId":"thread","requestId":"reused"}})).await;
        tokio::time::timeout(Duration::from_secs(1), async {
            while !state.inner.app.events.lock().unwrap().iter().any(|event| event.kind == "approval-cleared" && event.data["requestId"] == old_key) { tokio::time::sleep(Duration::from_millis(1)).await; }
        }).await.unwrap();
        assert!(!state.inner.documents.lock().unwrap()["doc"].pending_server_requests.contains_key(&old_key));
        assert!(state.inner.documents.lock().unwrap()["doc"].pending_server_requests.contains_key(&new_key));
        assert!(!state.inner.app.events.lock().unwrap().iter().any(|event| event.kind == "approval-cleared" && event.data["requestId"] == new_key));
        let reply_key = new_key.clone();
        run_assistant_command(state.clone(), move |state| state.respond_to_approval("doc".into(), 1, reply_key, "accept".into())).await.unwrap();
        let (replacement_pipe, response) = read_outgoing(replacement_pipe).await;
        assert_eq!(response["id"], "reused"); assert_eq!(response["result"]["decision"], "accept");
        state.handle_notification(json!({"method":"serverRequest/resolved","params":{"threadId":"thread","requestId":"reused"}}), &current);
        assert!(!state.inner.documents.lock().unwrap()["doc"].pending_server_requests.contains_key(&new_key));
        assert!(state.inner.documents.lock().unwrap()["doc"].pending_server_requests.is_empty());
        assert!(state.inner.app.events.lock().unwrap().iter().any(|event| event.kind == "approval-cleared" && event.data["requestId"] == new_key));
        events.send(CommandEvent::Error("late origin death".into())).await.unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(state.is_current_process(&current)); assert!(!killed.load(Ordering::Acquire));
        assert!(matches!(replacement_pipe.try_recv(), Err(mpsc::TryRecvError::Empty)));
        println!("PASS stale reader/GUI replies reject replacement; retired resolution clears only old opaque key, leaves reused-ID replacement pending, and unknown resolution is a no-op");

        let (state, pipe, _) = AssistantState::fixture(false);
        let pending = state.pending();
        let worker = tokio::spawn(run_assistant_command(state.clone(), |state| state.request_in_process(&state.process(), "slow", json!({}), Duration::from_secs(5))));
        let id = tokio::task::spawn_blocking(move || request_id(&pipe)).await.unwrap();
        for _ in 0..5 { tokio::time::sleep(Duration::from_millis(5)).await; }
        assert!(!worker.is_finished(), "request must still be waiting while heartbeat progresses");
        state.handle_response(json!({"id": id, "result": "ordinary response"}), &pending);
        assert_eq!(worker.await.unwrap().unwrap(), "ordinary response");
        assert!(pending.lock().unwrap().is_empty());
        println!("PASS slow response leaves single-thread executor heartbeat free; ordinary response cleans pending");

        let (state, _pipe, _) = AssistantState::fixture(false);
        let pending = state.pending();
        let error = run_assistant_command(state, |state| state.request_in_process(&state.process(), "timeout", json!({}), Duration::from_millis(20))).await.unwrap_err();
        assert!(error.contains("Timed out")); assert!(pending.lock().unwrap().is_empty());
        let (state, _, _) = AssistantState::fixture(true);
        let pending = state.pending();
        assert!(run_assistant_command(state, |state| state.request_in_process(&state.process(), "write", json!({}), Duration::from_secs(5))).await.unwrap_err().contains("write failure"));
        assert!(pending.lock().unwrap().is_empty());
        println!("PASS timeout and write failure remove pending entries");

        let (state, pipe, killed) = AssistantState::fixture(false);
        let pending = state.pending();
        let worker = tokio::spawn(run_assistant_command(state.clone(), |state| state.request_in_process(&state.process(), "death", json!({}), Duration::from_secs(5))));
        tokio::task::spawn_blocking(move || request_id(&pipe)).await.unwrap();
        state.end_process(&pending, "controlled process terminated");
        let error = tokio::time::timeout(Duration::from_millis(500), worker).await.unwrap().unwrap().unwrap_err();
        assert!(error.contains("terminated")); assert!(pending.lock().unwrap().is_empty());
        assert!(state.inner.process.lock().unwrap().is_none()); assert!(killed.load(Ordering::Acquire));
        println!("PASS process death releases waiters immediately and retires handle");

        let (state, pipe, _) = AssistantState::fixture(false);
        let pending = state.pending();
        let worker = tokio::spawn(run_assistant_command(state.clone(), |state| state.request_in_process(&state.process(), "disconnect", json!({}), Duration::from_secs(5))));
        tokio::task::spawn_blocking(move || request_id(&pipe)).await.unwrap();
        pending.lock().unwrap().clear();
        assert!(worker.await.unwrap().unwrap_err().contains("disconnected"));
        println!("PASS disconnection reports a distinct error rather than full timeout");

        let (state, _, _) = AssistantState::fixture(false);
        let old = state.pending();
        let (replacement, pipe, killed) = AssistantState::fixture(false);
        *state.inner.process.lock().unwrap() = replacement.inner.process.lock().unwrap().take();
        let current = state.pending();
        state.end_process(&old, "late old reader");
        assert!(Arc::ptr_eq(&current, &state.pending())); assert!(!killed.load(Ordering::Acquire));
        let worker = tokio::spawn(run_assistant_command(state.clone(), |state| state.request_in_process(&state.process(), "replacement", json!({}), Duration::from_secs(5))));
        let id = tokio::task::spawn_blocking(move || request_id(&pipe)).await.unwrap();
        state.handle_response(json!({"id":id,"error":{"message":"controlled server error"}}), &current);
        assert_eq!(worker.await.unwrap().unwrap_err(), "controlled server error");
        assert!(current.lock().unwrap().is_empty());
        println!("PASS stale reader cannot retire replacement; server error cleans pending");
    });
}
'''

deps = ROOT / "apps/desktop/src-tauri/target/debug/deps"
compiler = subprocess.check_output(["rustc", "--version"]).strip()
libraries = {}
for name in ["serde_json", "tokio"]:
    candidates = sorted((p for p in deps.glob(f"lib{name}-*.rlib") if compiler in p.read_bytes()), key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidates:
        raise SystemExit(f"Unavailable verification: no compatible compiled {name} dependency")
    libraries[name] = candidates[0]
with tempfile.TemporaryDirectory(prefix="tikz-assistant-transport-") as temp:
    src, executable = Path(temp) / "contracts.rs", Path(temp) / "contracts"
    src.write_text(rust)
    args = ["rustc", "--edition=2021", str(src), "-L", f"dependency={deps}", "-o", str(executable)]
    for name, path in libraries.items():
        args += ["--extern", f"{name}={path}"]
    subprocess.run(args, check=True)
    subprocess.run([str(executable)], check=True, timeout=15)
print("PASS all 17 assistant IPC wrappers use owned blocking tasks; initialization/readers guarded")
