use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::env;
use std::ffi::OsString;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

const ASSISTANT_EVENT_NAME: &str = "desktop-assistant-event";
const WATCH_INTERVAL_MS: u64 = 300;

enum CodexLaunch {
    Native {
        executable: PathBuf,
    },
    #[cfg(target_os = "windows")]
    Wsl,
}

#[cfg(target_os = "windows")]
fn windows_pathexts() -> Vec<String> {
    let default = vec![
        ".COM".to_string(),
        ".EXE".to_string(),
        ".BAT".to_string(),
        ".CMD".to_string(),
    ];
    env::var("PATHEXT")
        .ok()
        .map(|value| {
            value
                .split(';')
                .map(str::trim)
                .filter(|entry| !entry.is_empty())
                .map(|entry| entry.to_ascii_uppercase())
                .collect::<Vec<_>>()
        })
        .filter(|exts| !exts.is_empty())
        .unwrap_or(default)
}

fn executable_in_dir(dir: &Path, name: &str) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let has_ext = Path::new(name).extension().is_some();
        if has_ext {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
            return None;
        }
        let upper_name = name.to_ascii_uppercase();
        for ext in windows_pathexts() {
            let candidate = dir.join(format!("{upper_name}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
        let direct = dir.join(name);
        if direct.is_file() {
            return Some(direct);
        }
        None
    }
    #[cfg(not(target_os = "windows"))]
    {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
        None
    }
}

fn find_executable_in_path(name: &str) -> Option<PathBuf> {
    env::var_os("PATH").and_then(|raw_path| {
        for dir in env::split_paths(&raw_path) {
            if let Some(path) = executable_in_dir(&dir, name) {
                return Some(path);
            }
        }
        None
    })
}

fn common_bin_dirs() -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let mut dirs = Vec::new();
        if let Some(user_profile) = env::var_os("USERPROFILE") {
            dirs.push(
                PathBuf::from(user_profile)
                    .join("AppData")
                    .join("Roaming")
                    .join("npm"),
            );
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            dirs.push(PathBuf::from(program_files).join("nodejs"));
        }
        dirs
    }
    #[cfg(not(target_os = "windows"))]
    {
        vec![
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/opt/local/bin"),
            PathBuf::from("/usr/bin"),
            PathBuf::from("/bin"),
        ]
    }
}

fn find_executable(name: &str) -> Option<PathBuf> {
    if let Some(path) = find_executable_in_path(name) {
        return Some(path);
    }
    for dir in common_bin_dirs() {
        if let Some(path) = executable_in_dir(&dir, name) {
            return Some(path);
        }
    }
    None
}

fn npm_global_bin_dir(app: &AppHandle) -> Option<PathBuf> {
    let npm = find_executable("npm")?;
    let output = tauri::async_runtime::block_on(
        app.shell()
            .command(npm.to_string_lossy().to_string())
            .args(["config", "get", "prefix"])
            .output(),
    )
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let prefix = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if prefix.is_empty() || prefix == "undefined" {
        return None;
    }
    let prefix_path = PathBuf::from(prefix);
    #[cfg(target_os = "windows")]
    {
        Some(prefix_path)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Some(prefix_path.join("bin"))
    }
}

fn find_codex_native(app: &AppHandle) -> Option<PathBuf> {
    if let Some(path) = find_executable("codex") {
        return Some(path);
    }
    if let Some(npm_bin) = npm_global_bin_dir(app) {
        if let Some(path) = executable_in_dir(&npm_bin, "codex") {
            return Some(path);
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn wsl_command_exists(app: &AppHandle, name: &str) -> bool {
    tauri::async_runtime::block_on(
        app.shell()
            .command("wsl")
            .args(["sh", "-lc", &format!("command -v {name} >/dev/null 2>&1")])
            .status(),
    )
    .map(|status| status.success())
    .unwrap_or(false)
}

fn resolve_codex_launch(app: &AppHandle) -> Option<CodexLaunch> {
    if let Some(path) = find_codex_native(app) {
        return Some(CodexLaunch::Native { executable: path });
    }
    #[cfg(target_os = "windows")]
    {
        if find_executable("wsl").is_some() && wsl_command_exists(app, "codex") {
            return Some(CodexLaunch::Wsl);
        }
    }
    None
}

fn augmented_path(extra_dir: Option<&Path>, app: Option<&AppHandle>) -> Option<OsString> {
    let mut seen = HashSet::new();
    let mut entries = Vec::<PathBuf>::new();
    if let Some(raw) = env::var_os("PATH") {
        for dir in env::split_paths(&raw) {
            if seen.insert(dir.clone()) {
                entries.push(dir);
            }
        }
    }
    if let Some(dir) = extra_dir {
        if seen.insert(dir.to_path_buf()) {
            entries.push(dir.to_path_buf());
        }
    }
    for dir in common_bin_dirs() {
        if seen.insert(dir.clone()) {
            entries.push(dir);
        }
    }
    if let Some(npm_bin) = app.and_then(npm_global_bin_dir) {
        if seen.insert(npm_bin.clone()) {
            entries.push(npm_bin);
        }
    }
    env::join_paths(entries).ok()
}

#[derive(Clone)]
pub struct AssistantState {
    inner: Arc<AssistantStateInner>,
}

struct AssistantStateInner {
    app: AppHandle,
    process: Mutex<Option<ProcessHandle>>,
    documents: Mutex<HashMap<String, DocumentAssistantSession>>,
    approval_policy: Mutex<String>,
    watcher_started: Mutex<bool>,
}

struct ProcessHandle {
    child: Arc<Mutex<CommandChild>>,
    pending: Arc<Mutex<HashMap<String, Sender<Value>>>>,
    next_request_id: Arc<AtomicU64>,
}

#[derive(Clone)]
enum PendingServerRequestKind {
    CommandApproval,
    FileChangeApproval,
    ToolRequestUserInput,
    DynamicToolCall,
}

#[derive(Clone)]
struct PendingServerRequest {
    id: Value,
    kind: PendingServerRequestKind,
}

#[derive(Clone)]
struct DocumentAssistantSession {
    document_id: String,
    thread_id: String,
    workspace_path: PathBuf,
    figure_path: PathBuf,
    preview_path: PathBuf,
    items: Vec<Value>,
    pending_server_requests: HashMap<String, PendingServerRequest>,
    current_turn_id: Option<String>,
    has_sent_initial_context: bool,
    last_seen_figure_source: String,
    revision_counter: u64,
}

#[derive(Serialize)]
pub struct AssistantThreadSummary {
    #[serde(rename = "threadId")]
    pub thread_id: String,
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
    #[serde(rename = "figurePath")]
    pub figure_path: String,
    #[serde(rename = "previewPath")]
    pub preview_path: String,
}

#[derive(Serialize)]
pub struct AssistantThreadStatePayload {
    #[serde(rename = "threadId")]
    pub thread_id: String,
    #[serde(rename = "workspacePath")]
    pub workspace_path: String,
    #[serde(rename = "figurePath")]
    pub figure_path: String,
    #[serde(rename = "previewPath")]
    pub preview_path: String,
    pub items: Vec<Value>,
}

#[derive(Serialize)]
pub struct AssistantModelOption {
    pub id: String,
    pub label: String,
}

#[derive(Serialize)]
pub struct AssistantAccountSnapshot {
    pub account: Value,
    #[serde(rename = "rateLimits")]
    pub rate_limits: Value,
}

#[derive(Clone, Deserialize)]
pub struct AssistantPastedImageInput {
    pub base64: String,
    #[serde(rename = "mimeType")]
    pub mime_type: String,
    #[serde(rename = "fileName")]
    pub file_name: String,
}

#[derive(Clone, Serialize)]
struct AssistantEventPayload {
    #[serde(rename = "type")]
    kind: String,
    #[serde(flatten)]
    data: Value,
}

impl AssistantState {
    pub fn new(app: AppHandle) -> Self {
        let state = Self {
            inner: Arc::new(AssistantStateInner {
                app,
                process: Mutex::new(None),
                documents: Mutex::new(HashMap::new()),
                approval_policy: Mutex::new("on-request".to_string()),
                watcher_started: Mutex::new(false),
            }),
        };
        state.start_file_watcher();
        state
    }

    fn start_file_watcher(&self) {
        let mut started = self
            .inner
            .watcher_started
            .lock()
            .expect("watcher lock poisoned");
        if *started {
            return;
        }
        *started = true;
        let state = self.clone();
        thread::spawn(move || loop {
            thread::sleep(Duration::from_millis(WATCH_INTERVAL_MS));
            state.poll_figure_files();
        });
    }

    fn poll_figure_files(&self) {
        let sessions = {
            let docs = self
                .inner
                .documents
                .lock()
                .expect("documents lock poisoned");
            docs.values().cloned().collect::<Vec<_>>()
        };

        for session in sessions {
            let Ok(source) = fs::read_to_string(&session.figure_path) else {
                continue;
            };
            let mut docs = self
                .inner
                .documents
                .lock()
                .expect("documents lock poisoned");
            let Some(current) = docs.get_mut(&session.document_id) else {
                continue;
            };
            if source == current.last_seen_figure_source {
                continue;
            }
            current.last_seen_figure_source = source.clone();
            current.revision_counter += 1;
            let revision = format!("rev-{}", current.revision_counter);
            drop(docs);
            let _ = self.emit_event(AssistantEventPayload {
                kind: "source-updated".to_string(),
                data: json!({
                  "documentId": session.document_id,
                  "source": source,
                  "revisionToken": revision
                }),
            });
        }
    }

    fn ensure_process(&self) -> Result<(), String> {
        if self
            .inner
            .process
            .lock()
            .map_err(|_| "process lock unavailable".to_string())?
            .is_some()
        {
            return Ok(());
        }

        let launch = resolve_codex_launch(&self.inner.app).ok_or_else(|| {
            "Codex CLI was not found. Install it from the Assistant panel and retry.".to_string()
        })?;
        let command = match &launch {
            CodexLaunch::Native { executable } => {
                let mut cmd = self
                    .inner
                    .app
                    .shell()
                    .command(executable.to_string_lossy().to_string())
                    .args(["app-server"]);
                if let Some(path) = augmented_path(executable.parent(), Some(&self.inner.app)) {
                    cmd = cmd.env("PATH", path);
                }
                cmd
            }
            #[cfg(target_os = "windows")]
            CodexLaunch::Wsl => self
                .inner
                .app
                .shell()
                .command("wsl")
                .args(["codex", "app-server"]),
        };
        let (receiver, child) = command
            .spawn()
            .map_err(|error| format!("Failed to start `codex app-server`: {error}"))?;

        let pending = Arc::new(Mutex::new(HashMap::<String, Sender<Value>>::new()));
        let next_request_id = Arc::new(AtomicU64::new(1));
        let state = self.clone();
        spawn_command_event_reader(state.clone(), receiver, pending.clone());

        let process = ProcessHandle {
            child: Arc::new(Mutex::new(child)),
            pending,
            next_request_id,
        };
        {
            let mut process_slot = self
                .inner
                .process
                .lock()
                .map_err(|_| "process lock unavailable".to_string())?;
            *process_slot = Some(process);
        }

        let app_version = self.inner.app.package_info().version.to_string();
        let initialize_result = self.request(
            "initialize",
            json!({
              "clientInfo": {
                "name": "tikz_editor_desktop",
                "title": "TikZ Editor Desktop",
                "version": app_version
              },
              "capabilities": {
                "experimentalApi": true
              }
            }),
        )?;
        if initialize_result.get("error").is_some() {
            return Err("Failed to initialize Codex App Server.".to_string());
        }
        self.notify("initialized", json!({}))?;
        self.configure_approval_policy();
        Ok(())
    }

    fn configure_approval_policy(&self) {
        if let Ok(result) = self.request("configRequirements/read", json!({})) {
            let allowed = result
                .get("requirements")
                .and_then(|value| value.get("allowedApprovalPolicies"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let allowed_strings = allowed
                .iter()
                .filter_map(Value::as_str)
                .map(normalize_approval_policy_value)
                .collect::<Vec<_>>();
            let next = if allowed_strings.iter().any(|value| *value == "never") {
                "never"
            } else if allowed_strings.iter().any(|value| *value == "on-request") {
                "on-request"
            } else if allowed_strings.iter().any(|value| *value == "untrusted") {
                "untrusted"
            } else if allowed_strings.iter().any(|value| *value == "on-failure") {
                "on-failure"
            } else {
                allowed_strings.first().copied().unwrap_or("on-request")
            };
            if let Ok(mut approval_policy) = self.inner.approval_policy.lock() {
                *approval_policy = next.to_string();
            }
        }
    }

    fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        self.ensure_process()?;
        let (id, pending) = {
            let process_guard = self
                .inner
                .process
                .lock()
                .map_err(|_| "process lock unavailable".to_string())?;
            let process = process_guard
                .as_ref()
                .ok_or_else(|| "Codex app-server is unavailable".to_string())?;
            (
                process.next_request_id.fetch_add(1, Ordering::Relaxed),
                process.pending.clone(),
            )
        };

        let (sender, receiver) = mpsc::channel();
        pending
            .lock()
            .map_err(|_| "pending lock unavailable".to_string())?
            .insert(id.to_string(), sender);

        let payload = json!({
          "id": id,
          "method": method,
          "params": params
        });
        self.write_json_line(&payload)?;

        let response = receiver
            .recv_timeout(Duration::from_secs(120))
            .map_err(|_| {
                format!("Timed out waiting for `{method}` response from Codex App Server")
            })?;

        if let Some(error) = response.get("error") {
            return Err(error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Codex App Server request failed.")
                .to_string());
        }

        Ok(response.get("result").cloned().unwrap_or(Value::Null))
    }

    fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        self.ensure_process()?;
        let payload = json!({
          "method": method,
          "params": params
        });
        self.write_json_line(&payload)
    }

    pub fn ensure_document_thread(
        &self,
        document_id: String,
        source: String,
        thread_id: Option<String>,
        workspace_path: Option<String>,
        figure_path: Option<String>,
        preview_path: Option<String>,
    ) -> Result<AssistantThreadSummary, String> {
        self.ensure_process()?;

        if let Some(existing) = self
            .inner
            .documents
            .lock()
            .map_err(|_| "documents lock unavailable".to_string())?
            .get(&document_id)
            .cloned()
        {
            return Ok(summary_from_session(&existing));
        }

        let workspace =
            resolve_workspace(&self.inner.app, &document_id, workspace_path.as_deref())?;
        let figure = figure_path
            .map(PathBuf::from)
            .unwrap_or_else(|| workspace.join("figure.tex"));
        let preview = preview_path
            .map(PathBuf::from)
            .unwrap_or_else(|| workspace.join("current.png"));

        fs::create_dir_all(&workspace).map_err(|error| error.to_string())?;
        fs::write(&figure, &source).map_err(|error| error.to_string())?;

        let resumed_existing_thread = thread_id.is_some();
        let thread_id = if let Some(existing_thread_id) = thread_id {
            let _ = self.request(
                "thread/resume",
                json!({
                  "threadId": existing_thread_id,
                  "cwd": workspace.to_string_lossy().to_string()
                }),
            )?;
            existing_thread_id
        } else {
            let result = self.request(
        "thread/start",
        json!({
          "cwd": workspace.to_string_lossy().to_string(),
          "serviceName": "tikz-editor-desktop",
          "dynamicTools": [
            {
              "name": "get_latest_preview_png",
              "description": "Request a freshly rendered PNG preview of figure.tex from the TikZ editor. Supports optional overlay code (appended before \\end{tikzpicture} without modifying the file), coordinate grid overlay with numbered ticks, and zoom into a TikZ coordinate region.",
              "inputSchema": {
                "type": "object",
                "properties": {
                  "overlay_code": {
                    "type": "string",
                    "description": "TikZ code to append before \\end{tikzpicture} for temporary visual guides or prototyping. Does NOT modify the source file."
                  },
                  "show_grid": {
                    "type": "object",
                    "description": "Show a coordinate grid overlay with numbered tick marks in TikZ coordinate space.",
                    "properties": {
                      "spacing": { "type": "number", "description": "Grid line spacing in TikZ units (default: 1)" },
                      "color": { "type": "string", "description": "Grid line color as CSS color (default: #cccccc)" }
                    },
                    "additionalProperties": false
                  },
                  "zoom_region": {
                    "type": "object",
                    "description": "Zoom into a rectangular region specified in TikZ coordinates.",
                    "properties": {
                      "min_x": { "type": "number" },
                      "min_y": { "type": "number" },
                      "max_x": { "type": "number" },
                      "max_y": { "type": "number" }
                    },
                    "required": ["min_x", "min_y", "max_x", "max_y"],
                    "additionalProperties": false
                  },
                  "figure_index": {
                    "type": "integer",
                    "description": "1-indexed figure number for multi-figure documents. Omit to use the active figure."
                  }
                },
                "additionalProperties": false
              }
            },
            {
              "name": "get_diagnostics",
              "description": "Get current parse errors and warnings for the TikZ source. Returns diagnostics with severity, line number, code, and message.",
              "inputSchema": {
                "type": "object",
                "properties": {
                  "figure_index": {
                    "type": "integer",
                    "description": "1-indexed figure number for multi-figure documents. Omit to use the active figure."
                  }
                },
                "additionalProperties": false
              }
            },
            {
              "name": "get_element_list",
              "description": "Get a compact list of all rendered elements with their sourceId, kind, bounding box, source line range, draw/fill colors, and for nodes: name and center position.",
              "inputSchema": {
                "type": "object",
                "properties": {
                  "figure_index": {
                    "type": "integer",
                    "description": "1-indexed figure number for multi-figure documents. Omit to use the active figure."
                  }
                },
                "additionalProperties": false
              }
            },
            {
              "name": "get_node_anchors",
              "description": "Get the resolved anchor positions (center, east, north, etc.) for a named TikZ node. Coordinates are in TikZ units (cm).",
              "inputSchema": {
                "type": "object",
                "properties": {
                  "node_name": { "type": "string", "description": "The name of the node (e.g. 'A', 'mynode')" },
                  "figure_index": {
                    "type": "integer",
                    "description": "1-indexed figure number for multi-figure documents. Omit to use the active figure."
                  }
                },
                "required": ["node_name"],
                "additionalProperties": false
              }
            },
            {
              "name": "get_bounds",
              "description": "Get the bounding box of the entire scene in TikZ coordinates (cm).",
              "inputSchema": {
                "type": "object",
                "properties": {
                  "figure_index": {
                    "type": "integer",
                    "description": "1-indexed figure number for multi-figure documents. Omit to use the active figure."
                  }
                },
                "additionalProperties": false
              }
            }
          ]
        }),
      )?;
            result
                .get("thread")
                .and_then(|value| value.get("id"))
                .and_then(Value::as_str)
                .ok_or_else(|| "App-server did not return a thread id".to_string())?
                .to_string()
        };

        let session = DocumentAssistantSession {
            document_id: document_id.clone(),
            thread_id: thread_id.clone(),
            workspace_path: workspace.clone(),
            figure_path: figure.clone(),
            preview_path: preview.clone(),
            items: Vec::new(),
            pending_server_requests: HashMap::new(),
            current_turn_id: None,
            has_sent_initial_context: resumed_existing_thread,
            last_seen_figure_source: source,
            revision_counter: 0,
        };
        self.inner
            .documents
            .lock()
            .map_err(|_| "documents lock unavailable".to_string())?
            .insert(document_id, session.clone());
        Ok(summary_from_session(&session))
    }

    pub fn start_turn(
        &self,
        document_id: String,
        prompt: String,
        source: String,
        png_base64: Option<String>,
        pasted_images: Option<Vec<AssistantPastedImageInput>>,
        thread_id: Option<String>,
        workspace_path: Option<String>,
        figure_path: Option<String>,
        preview_path: Option<String>,
        model: Option<String>,
        figure_context: Option<String>,
        diagnostics_text: Option<String>,
    ) -> Result<Option<String>, String> {
        let summary = self.ensure_document_thread(
            document_id.clone(),
            source.clone(),
            thread_id,
            workspace_path,
            figure_path,
            preview_path,
        )?;
        self.sync_source(document_id.clone(), source.clone())?;
        if let Some(base64_png) = png_base64 {
            write_base64_file(Path::new(&summary.preview_path), &base64_png)?;
        }
        let pasted_image_paths = persist_pasted_images(
            Path::new(&summary.workspace_path),
            pasted_images.unwrap_or_default(),
        )?;

        let is_first_turn = {
            let docs = self
                .inner
                .documents
                .lock()
                .map_err(|_| "documents lock unavailable".to_string())?;
            let session = docs
                .get(&document_id)
                .ok_or_else(|| "Assistant thread not initialized for document".to_string())?;
            !session.has_sent_initial_context
        };
        let input = build_turn_input(
            &summary.figure_path,
            &summary.preview_path,
            &pasted_image_paths,
            &prompt,
            &source,
            is_first_turn,
            figure_context.as_deref(),
            diagnostics_text.as_deref(),
        );
        let mut turn_start_params = json!({
          "threadId": summary.thread_id,
          "cwd": summary.workspace_path,
          "input": input,
          "approvalPolicy": self.inner.approval_policy.lock().map_err(|_| "approval policy unavailable".to_string())?.clone(),
          "sandboxPolicy": {
            "type": "workspaceWrite",
            "writableRoots": [summary.workspace_path],
            "networkAccess": false
          }
        });
        if let Some(model) = model.filter(|value| !value.trim().is_empty()) {
            if let Some(map) = turn_start_params.as_object_mut() {
                map.insert("model".to_string(), Value::String(model));
            }
        }
        let result = self.request("turn/start", turn_start_params)?;

        let turn_id = result
            .get("turn")
            .and_then(|value| value.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string);
        if let Some(session) = self
            .inner
            .documents
            .lock()
            .map_err(|_| "documents lock unavailable".to_string())?
            .get_mut(&document_id)
        {
            session.current_turn_id = turn_id.clone();
            session.has_sent_initial_context = true;
        }
        Ok(turn_id)
    }

    pub fn warm_up(&self) -> Result<(), String> {
        self.ensure_process()
    }

    pub fn list_models(&self) -> Result<Vec<AssistantModelOption>, String> {
        let result = self.request(
            "model/list",
            json!({
                "includeHidden": false
            }),
        )?;
        let Some(models) = result.get("data").and_then(Value::as_array) else {
            return Ok(Vec::new());
        };
        Ok(models
            .iter()
            .filter_map(|model| {
                let id = model.get("id").and_then(Value::as_str)?.to_string();
                let label = model
                    .get("name")
                    .and_then(Value::as_str)
                    .filter(|name| !name.trim().is_empty())
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| id.clone());
                Some(AssistantModelOption { id, label })
            })
            .collect())
    }

    pub fn read_account_snapshot(&self) -> Result<AssistantAccountSnapshot, String> {
        self.ensure_process()?;
        let account = self
            .request("account/read", json!({ "refreshToken": false }))
            .unwrap_or(Value::Null);
        let rate_limits = self
            .request("account/rateLimits/read", json!({}))
            .unwrap_or(Value::Null);
        Ok(AssistantAccountSnapshot {
            account,
            rate_limits,
        })
    }

    pub fn read_account(&self) -> Result<Value, String> {
        self.ensure_process()?;
        Ok(self
            .request("account/read", json!({ "refreshToken": false }))
            .unwrap_or(Value::Null))
    }

    pub fn read_rate_limits(&self) -> Result<Value, String> {
        self.ensure_process()?;
        Ok(self
            .request("account/rateLimits/read", json!({}))
            .unwrap_or(Value::Null))
    }

    pub fn login_start(&self, login_type: &str, api_key: Option<&str>) -> Result<Value, String> {
        self.ensure_process()?;
        let params = if login_type == "apiKey" {
            json!({
                "type": "apiKey",
                "apiKey": api_key.unwrap_or("")
            })
        } else {
            json!({ "type": login_type })
        };
        self.request("account/login/start", params)
    }

    pub fn login_cancel(&self, login_id: &str) -> Result<(), String> {
        self.ensure_process()?;
        let _ = self.request("account/login/cancel", json!({ "loginId": login_id }))?;
        Ok(())
    }

    pub fn logout(&self) -> Result<(), String> {
        self.ensure_process()?;
        let _ = self.request("account/logout", json!({}))?;
        Ok(())
    }

    pub fn interrupt_turn(&self, document_id: String) -> Result<(), String> {
        let session = self
            .inner
            .documents
            .lock()
            .map_err(|_| "documents lock unavailable".to_string())?
            .get(&document_id)
            .cloned()
            .ok_or_else(|| "Assistant thread not initialized for document".to_string())?;
        if let Some(turn_id) = session.current_turn_id {
            let _ = self.request(
                "turn/interrupt",
                json!({ "threadId": session.thread_id, "turnId": turn_id }),
            )?;
        }
        Ok(())
    }

    pub fn steer_turn(
        &self,
        document_id: String,
        prompt: String,
        pasted_images: Option<Vec<AssistantPastedImageInput>>,
    ) -> Result<Option<String>, String> {
        let session = self
            .inner
            .documents
            .lock()
            .map_err(|_| "documents lock unavailable".to_string())?
            .get(&document_id)
            .cloned()
            .ok_or_else(|| "Assistant thread not initialized for document".to_string())?;
        let turn_id = session
            .current_turn_id
            .clone()
            .ok_or_else(|| "No active assistant turn to steer".to_string())?;
        let pasted_image_paths = persist_pasted_images(
            Path::new(&session.workspace_path),
            pasted_images.unwrap_or_default(),
        )?;
        let mut input = vec![json!({
          "type": "text",
          "text": prompt
        })];
        for pasted_image_path in pasted_image_paths {
            if Path::new(&pasted_image_path).exists() {
                input.push(json!({
                  "type": "localImage",
                  "path": pasted_image_path
                }));
            }
        }
        let result = self.request(
            "turn/steer",
            json!({
                "threadId": session.thread_id,
                "input": input,
                "expectedTurnId": turn_id
            }),
        )?;
        Ok(result
            .get("turnId")
            .and_then(Value::as_str)
            .map(str::to_string))
    }

    pub fn sync_source(&self, document_id: String, source: String) -> Result<(), String> {
        let mut docs = self
            .inner
            .documents
            .lock()
            .map_err(|_| "documents lock unavailable".to_string())?;
        let session = docs
            .get_mut(&document_id)
            .ok_or_else(|| "Assistant thread not initialized for document".to_string())?;
        fs::create_dir_all(&session.workspace_path).map_err(|error| error.to_string())?;
        fs::write(&session.figure_path, &source).map_err(|error| error.to_string())?;
        session.last_seen_figure_source = source;
        Ok(())
    }

    pub fn respond_to_approval(
        &self,
        document_id: String,
        request_id: String,
        decision: String,
    ) -> Result<(), String> {
        let pending_request = {
            let docs = self
                .inner
                .documents
                .lock()
                .map_err(|_| "documents lock unavailable".to_string())?;
            let session = docs
                .get(&document_id)
                .ok_or_else(|| "Assistant thread not initialized for document".to_string())?;
            session
                .pending_server_requests
                .get(&request_id)
                .cloned()
                .ok_or_else(|| "Unknown approval request".to_string())?
        };

        match pending_request.kind {
            PendingServerRequestKind::CommandApproval
            | PendingServerRequestKind::FileChangeApproval => self.send_server_request_response(
                pending_request.id,
                json!({ "decision": normalize_approval_decision_value(&decision) }),
            ),
            PendingServerRequestKind::ToolRequestUserInput => {
                // Until a dedicated question UI exists, return empty answers to unblock the turn.
                self.send_server_request_response(pending_request.id, json!({ "answers": {} }))
            }
            PendingServerRequestKind::DynamicToolCall => {
                Err("Request is not an approval request".to_string())
            }
        }
    }

    pub fn respond_to_dynamic_tool_call(
        &self,
        document_id: String,
        request_id: String,
        result: Value,
    ) -> Result<(), String> {
        if let Some(image_data) = extract_dynamic_tool_image_base64(&result) {
            let preview_path = {
                let docs = self
                    .inner
                    .documents
                    .lock()
                    .map_err(|_| "documents lock unavailable".to_string())?;
                docs.get(&document_id)
                    .map(|session| session.preview_path.clone())
                    .ok_or_else(|| "Assistant thread not initialized for document".to_string())?
            };
            write_base64_file(&preview_path, &image_data)?;
        }

        let pending_request = {
            let docs = self
                .inner
                .documents
                .lock()
                .map_err(|_| "documents lock unavailable".to_string())?;
            let session = docs
                .get(&document_id)
                .ok_or_else(|| "Assistant thread not initialized for document".to_string())?;
            session
                .pending_server_requests
                .get(&request_id)
                .cloned()
                .ok_or_else(|| "Unknown dynamic tool request".to_string())?
        };
        if !matches!(
            pending_request.kind,
            PendingServerRequestKind::DynamicToolCall
        ) {
            return Err("Request is not a dynamic tool call".to_string());
        }
        self.send_server_request_response(pending_request.id, result)
    }

    pub fn load_thread_state(
        &self,
        document_id: String,
    ) -> Result<Option<AssistantThreadStatePayload>, String> {
        let docs = self
            .inner
            .documents
            .lock()
            .map_err(|_| "documents lock unavailable".to_string())?;
        let Some(session) = docs.get(&document_id) else {
            return Ok(None);
        };
        Ok(Some(AssistantThreadStatePayload {
            thread_id: session.thread_id.clone(),
            workspace_path: session.workspace_path.to_string_lossy().to_string(),
            figure_path: session.figure_path.to_string_lossy().to_string(),
            preview_path: session.preview_path.to_string_lossy().to_string(),
            items: session.items.clone(),
        }))
    }

    fn send_server_request_response(&self, request_id: Value, result: Value) -> Result<(), String> {
        let payload = json!({
          "id": request_id,
          "result": result
        });
        self.write_json_line(&payload)
    }

    fn send_server_request_error(
        &self,
        request_id: Value,
        code: i64,
        message: &str,
    ) -> Result<(), String> {
        let payload = json!({
          "id": request_id,
          "error": {
            "code": code,
            "message": message
          }
        });
        self.write_json_line(&payload)
    }

    fn write_json_line(&self, payload: &Value) -> Result<(), String> {
        self.ensure_process()?;
        let child = {
            let process_guard = self
                .inner
                .process
                .lock()
                .map_err(|_| "process lock unavailable".to_string())?;
            process_guard
                .as_ref()
                .ok_or_else(|| "Codex app-server is unavailable".to_string())?
                .child
                .clone()
        };
        let line = serde_json::to_string(payload).map_err(|error| error.to_string())?;
        let mut child = child
            .lock()
            .map_err(|_| "child lock unavailable".to_string())?;
        child
            .write(line.as_bytes())
            .map_err(|error| error.to_string())?;
        child.write(b"\n").map_err(|error| error.to_string())
    }

    fn handle_response(
        &self,
        message: Value,
        pending: &Arc<Mutex<HashMap<String, Sender<Value>>>>,
    ) {
        let Some(id) = message.get("id").and_then(request_id_to_key) else {
            return;
        };
        let maybe_sender = pending.lock().ok().and_then(|mut map| map.remove(&id));
        if let Some(sender) = maybe_sender {
            let _ = sender.send(message);
        }
    }

    fn handle_server_request(&self, message: Value) {
        let Some(id) = message.get("id").cloned() else {
            return;
        };
        let Some(id_key) = request_id_to_key(&id) else {
            let _ = self.send_server_request_error(
                id,
                -32600,
                "Server request id must be string or number.",
            );
            return;
        };
        let Some(method) = message.get("method").and_then(Value::as_str) else {
            return;
        };
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let Some(document_id) = self.document_id_from_params(&params) else {
            let _ = self.emit_event(AssistantEventPayload {
        kind: "error".to_string(),
        data: json!({ "message": format!("Unhandled app-server request `{method}` without thread context.") }),
      });
            let _ = self.send_server_request_error(
                id,
                -32602,
                "Missing or unknown thread context for server request.",
            );
            return;
        };

        match method {
            "item/tool/call" => {
                if let Ok(mut docs) = self.inner.documents.lock() {
                    if let Some(session) = docs.get_mut(&document_id) {
                        session.pending_server_requests.insert(
                            id_key.clone(),
                            PendingServerRequest {
                                id: id.clone(),
                                kind: PendingServerRequestKind::DynamicToolCall,
                            },
                        );
                    }
                }
                let _ = self.emit_event(AssistantEventPayload {
                    kind: "dynamic-tool-call".to_string(),
                    data: json!({
                      "documentId": document_id,
                      "requestId": id_key,
                      "itemId": params.get("itemId").and_then(Value::as_str),
                      "tool": params.get("tool").and_then(Value::as_str).unwrap_or("dynamic-tool"),
                      "arguments": params.get("arguments").cloned().unwrap_or(Value::Null)
                    }),
                });
            }
            "item/commandExecution/requestApproval" => {
                if let Ok(mut docs) = self.inner.documents.lock() {
                    if let Some(session) = docs.get_mut(&document_id) {
                        session.pending_server_requests.insert(
                            id_key.clone(),
                            PendingServerRequest {
                                id: id.clone(),
                                kind: PendingServerRequestKind::CommandApproval,
                            },
                        );
                    }
                }
                let _ = self.emit_event(AssistantEventPayload {
          kind: "approval-requested".to_string(),
          data: json!({
            "documentId": document_id,
            "approval": {
              "kind": "command",
              "requestId": id_key,
              "itemId": params.get("itemId").and_then(Value::as_str).unwrap_or_default(),
              "threadId": params.get("threadId").and_then(Value::as_str).unwrap_or_default(),
              "turnId": params.get("turnId").and_then(Value::as_str).unwrap_or_default(),
              "reason": params.get("reason").cloned().unwrap_or(Value::Null),
              "command": params.get("command").cloned().unwrap_or(Value::Null),
              "cwd": params.get("cwd").cloned().unwrap_or(Value::Null),
              "availableDecisions": params.get("availableDecisions").cloned().unwrap_or(Value::Null)
            }
          }),
        });
            }
            "item/fileChange/requestApproval" => {
                if let Ok(mut docs) = self.inner.documents.lock() {
                    if let Some(session) = docs.get_mut(&document_id) {
                        session.pending_server_requests.insert(
                            id_key.clone(),
                            PendingServerRequest {
                                id: id.clone(),
                                kind: PendingServerRequestKind::FileChangeApproval,
                            },
                        );
                    }
                }
                let _ = self.emit_event(AssistantEventPayload {
          kind: "approval-requested".to_string(),
          data: json!({
            "documentId": document_id,
            "approval": {
              "kind": "fileChange",
              "requestId": id_key,
              "itemId": params.get("itemId").and_then(Value::as_str).unwrap_or_default(),
              "threadId": params.get("threadId").and_then(Value::as_str).unwrap_or_default(),
              "turnId": params.get("turnId").and_then(Value::as_str).unwrap_or_default(),
              "reason": params.get("reason").cloned().unwrap_or(Value::Null),
              "grantRoot": params.get("grantRoot").cloned().unwrap_or(Value::Null)
            }
          }),
        });
            }
            "item/tool/requestUserInput" | "tool/requestUserInput" => {
                if let Ok(mut docs) = self.inner.documents.lock() {
                    if let Some(session) = docs.get_mut(&document_id) {
                        session.pending_server_requests.insert(
                            id_key.clone(),
                            PendingServerRequest {
                                id: id.clone(),
                                kind: PendingServerRequestKind::ToolRequestUserInput,
                            },
                        );
                    }
                }
                let _ = self.emit_event(AssistantEventPayload {
          kind: "approval-requested".to_string(),
          data: json!({
            "documentId": document_id,
            "approval": {
              "kind": "toolInput",
              "requestId": id_key,
              "threadId": params.get("threadId").and_then(Value::as_str).unwrap_or_default(),
              "turnId": params.get("turnId").cloned().unwrap_or(Value::Null),
              "payload": params
            }
          }),
        });
            }
            _ => {
                let _ = self.emit_event(AssistantEventPayload {
                    kind: "error".to_string(),
                    data: json!({
                      "documentId": document_id,
                      "message": format!("Unhandled app-server request `{method}`.")
                    }),
                });
                let _ = self.send_server_request_error(
                    id,
                    -32601,
                    &format!("Unsupported server request method `{method}`"),
                );
            }
        }
    }

    fn handle_notification(&self, message: Value) {
        let Some(method) = message.get("method").and_then(Value::as_str) else {
            return;
        };
        let params = message.get("params").cloned().unwrap_or(Value::Null);
        let document_id = self.document_id_from_params(&params);

        match method {
            "turn/started" => {
                if let Some(document_id) = document_id {
                    let turn_id = params
                        .get("turn")
                        .and_then(|value| value.get("id"))
                        .and_then(Value::as_str)
                        .map(str::to_string);
                    if let Ok(mut docs) = self.inner.documents.lock() {
                        if let Some(session) = docs.get_mut(&document_id) {
                            session.current_turn_id = turn_id.clone();
                        }
                    }
                    let _ = self.emit_event(AssistantEventPayload {
                        kind: "turn-status".to_string(),
                        data: json!({
                          "documentId": document_id,
                          "turnId": turn_id,
                          "status": "inProgress"
                        }),
                    });
                }
            }
            "turn/completed" => {
                if let Some(document_id) = document_id {
                    let turn = params.get("turn").cloned().unwrap_or(Value::Null);
                    let status = turn
                        .get("status")
                        .and_then(Value::as_str)
                        .unwrap_or("completed");
                    let error = turn
                        .get("error")
                        .and_then(|value| {
                            value.get("message").or_else(|| value.get("error")).cloned()
                        })
                        .unwrap_or(Value::Null);
                    if let Ok(mut docs) = self.inner.documents.lock() {
                        if let Some(session) = docs.get_mut(&document_id) {
                            session.current_turn_id = None;
                        }
                    }
                    let _ = self.emit_event(AssistantEventPayload {
                        kind: "turn-status".to_string(),
                        data: json!({
                          "documentId": document_id,
                          "status": status,
                          "turnId": turn.get("id").cloned().unwrap_or(Value::Null),
                          "error": error
                        }),
                    });
                }
            }
            "item/started" | "item/completed" => {
                if let Some(document_id) = document_id {
                    let item = params.get("item").cloned().unwrap_or(Value::Null);
                    self.upsert_item(&document_id, &item);
                    let _ = self.emit_event(AssistantEventPayload {
                        kind: if method == "item/started" {
                            "item-started".to_string()
                        } else {
                            "item-completed".to_string()
                        },
                        data: json!({
                          "documentId": document_id,
                          "item": item
                        }),
                    });
                }
            }
            "item/agentMessage/delta"
            | "item/plan/delta"
            | "item/reasoning/summaryTextDelta"
            | "item/reasoning/textDelta"
            | "item/commandExecution/outputDelta" => {
                if let Some(document_id) = document_id {
                    let item_id = params
                        .get("itemId")
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let delta = params
                        .get("delta")
                        .or_else(|| params.get("text"))
                        .or_else(|| params.get("output"))
                        .and_then(Value::as_str)
                        .unwrap_or_default();
                    let _ = self.emit_event(AssistantEventPayload {
                        kind: "item-delta".to_string(),
                        data: json!({
                          "documentId": document_id,
                          "itemId": item_id,
                          "deltaType": method,
                          "delta": delta
                        }),
                    });
                }
            }
            "serverRequest/resolved" => {
                if let Some(document_id) = document_id {
                    let request_id = params
                        .get("requestId")
                        .and_then(request_id_to_key)
                        .unwrap_or_default();
                    if let Ok(mut docs) = self.inner.documents.lock() {
                        if let Some(session) = docs.get_mut(&document_id) {
                            session.pending_server_requests.remove(&request_id);
                        }
                    }
                    let _ = self.emit_event(AssistantEventPayload {
                        kind: "approval-cleared".to_string(),
                        data: json!({
                          "documentId": document_id,
                          "requestId": request_id
                        }),
                    });
                }
            }
            "error" => {
                let _ = self.emit_event(AssistantEventPayload {
                    kind: "error".to_string(),
                    data: json!({
                      "documentId": document_id,
                      "message": params
                        .get("error")
                        .and_then(|value| value.get("message"))
                        .and_then(Value::as_str)
                        .unwrap_or("Codex App Server error.")
                    }),
                });
            }
            "account/updated" => {
                let _ = self.emit_event(AssistantEventPayload {
                    kind: "account-updated".to_string(),
                    data: params,
                });
            }
            "account/login/completed" => {
                let _ = self.emit_event(AssistantEventPayload {
                    kind: "login-completed".to_string(),
                    data: params,
                });
            }
            "account/rateLimits/updated" => {
                let _ = self.emit_event(AssistantEventPayload {
                    kind: "rate-limits-updated".to_string(),
                    data: params,
                });
            }
            _ => {}
        }
    }

    fn upsert_item(&self, document_id: &str, item: &Value) {
        let Some(item_id) = item.get("id").and_then(Value::as_str) else {
            return;
        };
        if let Ok(mut docs) = self.inner.documents.lock() {
            if let Some(session) = docs.get_mut(document_id) {
                if let Some(index) = session.items.iter().position(|existing| {
                    existing.get("id").and_then(Value::as_str) == Some(item_id)
                }) {
                    session.items[index] = merge_json(session.items[index].clone(), item.clone());
                } else {
                    session.items.push(item.clone());
                }
            }
        }
    }

    fn document_id_from_params(&self, params: &Value) -> Option<String> {
        let thread_id = params
            .get("threadId")
            .or_else(|| params.get("thread").and_then(|value| value.get("id")))
            .and_then(Value::as_str)?;
        let docs = self.inner.documents.lock().ok()?;
        docs.iter()
            .find(|(_, session)| session.thread_id == thread_id)
            .map(|(document_id, _)| document_id.clone())
    }

    fn emit_event(&self, payload: AssistantEventPayload) -> Result<(), String> {
        self.inner
            .app
            .emit(ASSISTANT_EVENT_NAME, payload)
            .map_err(|error| error.to_string())
    }
}

fn normalize_approval_policy_value(value: &str) -> &str {
    match value {
        "onRequest" | "on-request" => "on-request",
        "unlessTrusted" | "untrusted" => "untrusted",
        "onFailure" | "on-failure" => "on-failure",
        "reject" => "reject",
        "never" => "never",
        other => other,
    }
}

fn normalize_approval_decision_value(value: &str) -> &str {
    match value {
        "acceptForSession" | "accept-for-session" => "acceptForSession",
        "accept" => "accept",
        "decline" => "decline",
        "cancel" => "cancel",
        other => other,
    }
}

fn request_id_to_key(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        _ => None,
    }
}

fn parse_data_url_base64_image(url: &str) -> Option<String> {
    let (_, right) = url.split_once(',')?;
    if !url[..url.find(',')?].contains(";base64") {
        return None;
    }
    Some(right.to_string())
}

fn extract_dynamic_tool_image_base64(result: &Value) -> Option<String> {
    let items = result.get("contentItems").and_then(Value::as_array)?;
    for item in items {
        let item_type = item.get("type").and_then(Value::as_str).unwrap_or_default();
        if item_type == "image" {
            if let Some(data) = item.get("data").and_then(Value::as_str) {
                return Some(data.to_string());
            }
        }
        if item_type == "inputImage" {
            if let Some(url) = item.get("imageUrl").and_then(Value::as_str) {
                if let Some(base64_data) = parse_data_url_base64_image(url) {
                    return Some(base64_data);
                }
            }
        }
    }
    None
}

fn spawn_command_event_reader(
    state: AssistantState,
    mut receiver: tauri::async_runtime::Receiver<CommandEvent>,
    pending: Arc<Mutex<HashMap<String, Sender<Value>>>>,
) {
    tauri::async_runtime::spawn(async move {
        let mut stdout_buffer: Vec<u8> = Vec::new();
        while let Some(event) = receiver.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    stdout_buffer.extend(bytes);
                    while let Some(newline_index) =
                        stdout_buffer.iter().position(|byte| *byte == b'\n')
                    {
                        let mut line_bytes =
                            stdout_buffer.drain(..newline_index).collect::<Vec<_>>();
                        let _ = stdout_buffer.drain(..1);
                        if line_bytes.last() == Some(&b'\r') {
                            line_bytes.pop();
                        }
                        let line = String::from_utf8_lossy(&line_bytes).to_string();
                        if line.is_empty() {
                            continue;
                        }
                        let Ok(message) = serde_json::from_str::<Value>(&line) else {
                            let _ = state.emit_event(AssistantEventPayload {
                                kind: "error".to_string(),
                                data: json!({ "message": format!("Failed to parse app-server message: {line}") }),
                            });
                            continue;
                        };
                        if message.get("method").is_some() && message.get("id").is_some() {
                            state.handle_server_request(message);
                        } else if message.get("method").is_some() {
                            state.handle_notification(message);
                        } else if message.get("id").is_some() {
                            state.handle_response(message, &pending);
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes)
                        .trim_end_matches(['\r', '\n'])
                        .to_string();
                    if !line.is_empty() {
                        eprintln!("[codex app-server] {line}");
                    }
                }
                CommandEvent::Error(error) => {
                    let _ = state.emit_event(AssistantEventPayload {
                        kind: "error".to_string(),
                        data: json!({ "message": format!("Codex app-server error: {error}") }),
                    });
                }
                CommandEvent::Terminated(payload) => {
                    if !stdout_buffer.iter().all(u8::is_ascii_whitespace) {
                        let buffered = String::from_utf8_lossy(&stdout_buffer);
                        let _ = state.emit_event(AssistantEventPayload {
                            kind: "error".to_string(),
                            data: json!({ "message": format!("Discarding unterminated app-server message: {buffered}") }),
                        });
                    }
                    let _ = state.emit_event(AssistantEventPayload {
                        kind: "error".to_string(),
                        data: json!({
                          "message": format!("Codex app-server terminated (code: {:?}, signal: {:?}).", payload.code, payload.signal)
                        }),
                    });
                }
                _ => {}
            }
        }
    });
}

fn summary_from_session(session: &DocumentAssistantSession) -> AssistantThreadSummary {
    AssistantThreadSummary {
        thread_id: session.thread_id.clone(),
        workspace_path: session.workspace_path.to_string_lossy().to_string(),
        figure_path: session.figure_path.to_string_lossy().to_string(),
        preview_path: session.preview_path.to_string_lossy().to_string(),
    }
}

fn resolve_workspace(
    app: &AppHandle,
    document_id: &str,
    provided: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(path) = provided {
        return Ok(PathBuf::from(path));
    }
    let workspace_name = short_workspace_name(document_id);
    let base = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("codex-assistant")
        .join(workspace_name);
    Ok(base)
}

fn write_base64_file(path: &Path, base64_contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_contents)
        .map_err(|error| error.to_string())?;
    fs::write(path, bytes).map_err(|error| error.to_string())
}

fn build_turn_input(
    figure_path: &str,
    preview_path: &str,
    pasted_image_paths: &[String],
    prompt: &str,
    source: &str,
    is_first_turn: bool,
    figure_context: Option<&str>,
    diagnostics_text: Option<&str>,
) -> Vec<Value> {
    let mut input = if is_first_turn {
        let source_section = if let Some(ctx) = figure_context {
            ctx.to_string()
        } else {
            format!("Current figure source:\n```tex\n{source}\n```")
        };

        let diagnostics_section = match diagnostics_text {
            Some(text) if !text.is_empty() => format!("\n\nCurrent diagnostics:\n{text}"),
            _ => String::new(),
        };

        vec![json!({
          "type": "text",
          "text": format!(
            "You are assisting a user inside a WYSIWYG TikZ editor. The user edits the figure visually and sees the current TikZ source directly in the interface.\n\
        Apply requested changes to `{figure_path}` as needed, but do not mention local filenames or paths in your user-facing response.\n\
        After making edits, call the `get_latest_preview_png` tool to verify the rendered output before finalizing your response.\n\
        The preview tool supports `overlay_code` (temporary TikZ code for guides/prototyping, injected before \\end{{tikzpicture}} without modifying the file), `show_grid` (coordinate grid with numbered ticks), and `zoom_region` (zoom into TikZ coordinates).\n\
        You can call `get_diagnostics` to check for parse errors, `get_element_list` for a compact element inventory, `get_node_anchors` for resolved node positions, and `get_bounds` for the scene bounding box.\n\
        The editor uses its own TikZ renderer which supports most common features but not every TikZ package or advanced construct. The rendering is accurate — trust what the preview shows. If something doesn't render, try simpler TikZ constructs.\n\
        The user sees source changes live, so keep your response brief: list what you changed and why, don't repeat the code.\n\n\
        The image attached below is the current rendered preview of the figure.\n\n\
        {source_section}{diagnostics_section}\n\n\
        User request: {prompt}"
          )
        })]
    } else {
        vec![json!({
          "type": "text",
          "text": prompt
        })]
    };
    for pasted_image_path in pasted_image_paths {
        if Path::new(pasted_image_path).exists() {
            input.push(json!({
              "type": "localImage",
              "path": pasted_image_path
            }));
        }
    }
    if Path::new(preview_path).exists() {
        input.push(json!({
          "type": "localImage",
          "path": preview_path
        }));
    }
    input
}

fn persist_pasted_images(
    workspace_path: &Path,
    pasted_images: Vec<AssistantPastedImageInput>,
) -> Result<Vec<String>, String> {
    if pasted_images.is_empty() {
        return Ok(Vec::new());
    }

    let image_dir = workspace_path.join("pasted-images");
    fs::create_dir_all(&image_dir).map_err(|error| error.to_string())?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();

    let mut saved_paths: Vec<String> = Vec::new();
    for (index, image) in pasted_images.iter().enumerate() {
        if image.base64.trim().is_empty() {
            continue;
        }
        let ext = extension_for_mime_type(&image.mime_type);
        let stem = sanitized_file_stem(&image.file_name);
        let file_name = format!("{timestamp}-{index:03}-{stem}.{ext}");
        let file_path = image_dir.join(file_name);
        write_base64_file(&file_path, &image.base64)?;
        saved_paths.push(file_path.to_string_lossy().to_string());
    }
    Ok(saved_paths)
}

fn extension_for_mime_type(mime_type: &str) -> &'static str {
    match mime_type.trim().to_ascii_lowercase().as_str() {
        "image/png" => "png",
        "image/jpeg" | "image/jpg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "img",
    }
}

fn sanitized_file_stem(file_name: &str) -> String {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("pasted-image");
    let normalized = stem
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    let compact = normalized
        .trim_matches('-')
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if compact.is_empty() {
        "pasted-image".to_string()
    } else {
        compact
    }
}

fn short_workspace_name(document_id: &str) -> String {
    let compact = document_id
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase();
    if compact.len() >= 7 {
        return compact.chars().take(7).collect();
    }

    let mut hasher = DefaultHasher::new();
    document_id.hash(&mut hasher);
    let hash_hex = format!("{:016x}", hasher.finish());
    format!("{compact}{hash_hex}")
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .take(7)
        .collect()
}

fn merge_json(existing: Value, incoming: Value) -> Value {
    match (existing, incoming) {
        (Value::Object(mut left), Value::Object(right)) => {
            for (key, value) in right {
                let merged = match left.remove(&key) {
                    Some(previous) => merge_json(previous, value),
                    None => value,
                };
                left.insert(key, merged);
            }
            Value::Object(left)
        }
        (_, right) => right,
    }
}

#[cfg(test)]
mod tests {
    use super::build_turn_input;
    use serde_json::Value;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn item_path(item: &Value) -> Option<String> {
        item.get("path").and_then(Value::as_str).map(str::to_string)
    }

    fn make_temp_dir() -> PathBuf {
        static NEXT_ID: AtomicU64 = AtomicU64::new(0);
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock drift")
            .as_millis();
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("tikz-editor-assistant-test-{millis}-{id}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn build_turn_input_first_turn_includes_pasted_images_then_preview() {
        let dir = make_temp_dir();
        let pasted_a = dir.join("pasted-a.png");
        let pasted_b = dir.join("pasted-b.png");
        let preview = dir.join("preview.png");
        fs::write(&pasted_a, b"a").expect("write pasted a");
        fs::write(&pasted_b, b"b").expect("write pasted b");
        fs::write(&preview, b"p").expect("write preview");

        let input = build_turn_input(
            "figure.tex",
            preview.to_string_lossy().as_ref(),
            &[
                pasted_a.to_string_lossy().to_string(),
                pasted_b.to_string_lossy().to_string(),
            ],
            "make line thicker",
            "\\draw (0,0)--(1,1);",
            true,
            None,
            None,
        );

        let first_text = input
            .first()
            .and_then(|item| item.get("text"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        assert!(first_text.contains("User request: make line thicker"));
        assert_eq!(
            item_path(&input[1]),
            Some(pasted_a.to_string_lossy().to_string())
        );
        assert_eq!(
            item_path(&input[2]),
            Some(pasted_b.to_string_lossy().to_string())
        );
        assert_eq!(
            item_path(&input[3]),
            Some(preview.to_string_lossy().to_string())
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn build_turn_input_follow_up_uses_plain_prompt_text() {
        let dir = make_temp_dir();
        let pasted = dir.join("pasted.png");
        let preview = dir.join("preview.png");
        fs::write(&pasted, b"a").expect("write pasted");
        fs::write(&preview, b"p").expect("write preview");

        let input = build_turn_input(
            "figure.tex",
            preview.to_string_lossy().as_ref(),
            &[pasted.to_string_lossy().to_string()],
            "nudge the label",
            "\\draw (0,0)--(1,1);",
            false,
            None,
            None,
        );

        let first_text = input
            .first()
            .and_then(|item| item.get("text"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        assert_eq!(first_text, "nudge the label");
        assert_eq!(
            item_path(&input[1]),
            Some(pasted.to_string_lossy().to_string())
        );
        assert_eq!(
            item_path(&input[2]),
            Some(preview.to_string_lossy().to_string())
        );

        let _ = fs::remove_dir_all(dir);
    }
}
