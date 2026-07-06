mod assistant;

use assistant::{
    AssistantAccountSnapshot, AssistantModelOption, AssistantState, AssistantThreadStatePayload,
    AssistantThreadSummary,
};
use base64::Engine;
use clipboard_rs::{
    common::RustImage, Clipboard, ClipboardContent, ClipboardContext, RustImageData,
};
use flate2::read::GzDecoder;
use notify::{Config as NotifyConfig, RecommendedWatcher, RecursiveMode, Watcher};
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::env;
use std::ffi::OsString;
use std::fs;
use std::io;
use std::io::Cursor;
use std::io::Read;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Component;
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    menu::{
        CheckMenuItemBuilder, Menu, MenuItemBuilder, MenuItemKind, PredefinedMenuItem,
        SubmenuBuilder,
    },
    AppHandle, Emitter, Manager,
};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::{process::CommandEvent, ShellExt};
use url::Url;

#[cfg(target_os = "macos")]
mod macos_accessibility {
    use super::*;
    use block2::RcBlock;
    use core::ptr::NonNull;
    use objc2::rc::Retained;
    use objc2::runtime::{Bool as ObjcBool, ProtocolObject};
    use objc2_foundation::{
        NSNotification, NSNotificationCenter, NSNotificationName, NSObjectProtocol,
        NSOperationQueue,
    };

    pub const PREFERS_NON_BLINKING_TEXT_INSERTION_INDICATOR_CHANGED_EVENT: &str =
        "desktop-prefers-non-blinking-text-insertion-indicator-changed";

    #[link(name = "Accessibility", kind = "framework")]
    extern "C" {
        pub static AXPrefersNonBlinkingTextInsertionIndicatorDidChangeNotification:
            &'static NSNotificationName;
        fn AXPrefersNonBlinkingTextInsertionIndicator() -> ObjcBool;
    }

    pub fn prefers_non_blinking_text_insertion_indicator() -> bool {
        unsafe { AXPrefersNonBlinkingTextInsertionIndicator().as_bool() }
    }

    pub fn install_observer(app: AppHandle) -> Retained<ProtocolObject<dyn NSObjectProtocol>> {
        let center = NSNotificationCenter::defaultCenter();
        let queue = NSOperationQueue::mainQueue();
        let block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
            let value = prefers_non_blinking_text_insertion_indicator();
            let _ = app.emit(
                PREFERS_NON_BLINKING_TEXT_INSERTION_INDICATOR_CHANGED_EVENT,
                value,
            );
        });
        unsafe {
            center.addObserverForName_object_queue_usingBlock(
                Some(AXPrefersNonBlinkingTextInsertionIndicatorDidChangeNotification),
                None,
                Some(&queue),
                &block,
            )
        }
    }
}

#[cfg(target_os = "macos")]
mod macos_about {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::AllocAnyThread;
    use objc2_app_kit::{
        NSAboutPanelOptionApplicationIcon, NSAboutPanelOptionApplicationName,
        NSAboutPanelOptionApplicationVersion, NSAboutPanelOptionCredits, NSApplication, NSImage,
        NSLinkAttributeName, NSMutableAttributedStringAppKitAdditions, NSTextAlignment,
    };
    use objc2_foundation::{
        MainThreadMarker, NSData, NSDictionary, NSMutableAttributedString, NSRange, NSString, NSURL,
    };
    use tauri::AppHandle;

    const APP_DISPLAY_NAME: &str = "TikZ Editor";
    const APP_AUTHOR: &str = "Dominik Peters";
    const APP_LICENSE: &str = "MIT";
    const APP_WEBSITE: &str = "https://tikz.dev/editor/";
    const APP_ICON: &[u8] = include_bytes!("../icons/icon.png");

    pub fn show(app: AppHandle) -> Result<(), String> {
        let version = app.package_info().version.to_string();
        app.run_on_main_thread(move || {
            show_on_main_thread(&version);
        })
        .map_err(|error| error.to_string())
    }

    fn show_on_main_thread(version: &str) {
        let mut keys: Vec<&NSString> = Vec::new();
        let mut objects: Vec<Retained<AnyObject>> = Vec::new();

        keys.push(unsafe { NSAboutPanelOptionApplicationName });
        objects.push(Retained::into_super(Retained::into_super(
            NSString::from_str(APP_DISPLAY_NAME),
        )));

        keys.push(unsafe { NSAboutPanelOptionApplicationVersion });
        objects.push(Retained::into_super(Retained::into_super(
            NSString::from_str(version),
        )));

        if let Some(icon) = app_icon() {
            keys.push(unsafe { NSAboutPanelOptionApplicationIcon });
            objects.push(Retained::into_super(Retained::into_super(icon)));
        }

        keys.push(unsafe { NSAboutPanelOptionCredits });
        objects.push(Retained::into_super(Retained::into_super(
            Retained::into_super(credits()),
        )));

        let dict = NSDictionary::from_retained_objects(&keys, &objects);
        let mtm = MainThreadMarker::new().expect("About panel must be shown on the main thread");
        unsafe {
            NSApplication::sharedApplication(mtm).orderFrontStandardAboutPanelWithOptions(&dict)
        };
    }

    fn app_icon() -> Option<Retained<NSImage>> {
        let data = NSData::with_bytes(APP_ICON);
        NSImage::initWithData(NSImage::alloc(), &data)
    }

    fn credits() -> Retained<NSMutableAttributedString> {
        let text = format!("Author: {APP_AUTHOR}\nLicense: {APP_LICENSE}\nWebsite: {APP_WEBSITE}");
        let credits = NSMutableAttributedString::from_nsstring(&NSString::from_str(&text));
        credits.setAlignment_range(
            NSTextAlignment::Center,
            NSRange::new(0, text.encode_utf16().count()),
        );

        if let Some(link_start) = text.find(APP_WEBSITE) {
            if let Some(url) = NSURL::URLWithString(&NSString::from_str(APP_WEBSITE)) {
                let link_start = text[..link_start].encode_utf16().count();
                let link_len = APP_WEBSITE.encode_utf16().count();
                let url: Retained<AnyObject> = Retained::into_super(Retained::into_super(url));
                unsafe {
                    credits.addAttribute_value_range(
                        NSLinkAttributeName,
                        &url,
                        NSRange::new(link_start, link_len),
                    );
                }
            }
        }

        credits
    }
}

#[cfg(target_os = "macos")]
mod macos_activation {
    use objc2_app_kit::NSApplication;
    use objc2_foundation::MainThreadMarker;

    pub fn activate_ignoring_other_apps() {
        let mtm = MainThreadMarker::new().expect("app activation must run on the main thread");
        let app = NSApplication::sharedApplication(mtm);
        #[allow(deprecated)]
        app.activateIgnoringOtherApps(true);
    }
}

const MAX_RECENT_FILES: usize = 10;
const LATEX_COMMAND_TIMEOUT_SECS: u64 = 20;
const ARXIV_SOURCE_DOWNLOAD_TIMEOUT_SECS: u64 = 60;
const ARXIV_SOURCE_MAX_ARCHIVE_BYTES: u64 = 80 * 1024 * 1024;
const ARXIV_SOURCE_MAX_TEXT_BYTES: u64 = 30 * 1024 * 1024;
const ARXIV_SOURCE_MAX_FILES: usize = 2_000;
const RECENTS_FILENAME: &str = "recent-files.json";
const UPDATE_RELAUNCH_MARKER_FILENAME: &str = "pending-update-relaunch";
const CONTEXT_MENU_EVENT_PREFIX: &str = "ctx::";
const DESKTOP_OPEN_REQUESTS_CHANGED_EVENT: &str = "desktop-open-requests-changed";
const DESKTOP_LINKED_FILE_CHANGED_EVENT: &str = "desktop-linked-file-changed";
static NEXT_LATEX_COMPILE_ID: AtomicU64 = AtomicU64::new(1);
#[cfg(target_os = "macos")]
const DESKTOP_SVG_CLIPBOARD_FORMATS: [&str; 2] =
    ["public.svg-image", "com.microsoft.image-svg-xml"];
#[cfg(not(target_os = "macos"))]
const DESKTOP_SVG_CLIPBOARD_FORMATS: [&str; 3] = [
    "image/svg+xml",
    "public.svg-image",
    "com.microsoft.image-svg-xml",
];
#[cfg(target_os = "macos")]
const DESKTOP_PNG_CLIPBOARD_FORMATS: [&str; 2] = ["public.png", "image/png"];
#[cfg(target_os = "windows")]
const DESKTOP_PNG_CLIPBOARD_FORMATS: [&str; 2] = ["image/png", "PNG"];
#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
const DESKTOP_PNG_CLIPBOARD_FORMATS: [&str; 1] = ["image/png"];
#[cfg(target_os = "macos")]
const TIKZ_CUSTOM_CLIPBOARD_FORMATS: [&str; 1] = ["com.tikzeditor.tikz-json"];
#[cfg(not(target_os = "macos"))]
const TIKZ_CUSTOM_CLIPBOARD_FORMATS: [&str; 2] = [
    "web application/x-tikz-editor+json",
    "application/x-tikz-editor+json",
];

#[derive(Default)]
struct RecentFilesState {
    files: Mutex<Vec<String>>,
}

#[derive(Default)]
struct PendingOpenRequestsState {
    requests: Mutex<Vec<OpenTextPayload>>,
    failures: Mutex<Vec<OpenTextFailurePayload>>,
}

#[derive(Default)]
struct LinkedFileWatchState {
    watcher: Mutex<Option<RecommendedWatcher>>,
    watched_paths: Arc<Mutex<HashSet<PathBuf>>>,
}

#[derive(Clone, Serialize)]
struct LatexAvailabilityStatus {
    available: bool,
    details: String,
}

#[derive(Serialize)]
struct OpenTextPayload {
    source: String,
    path: String,
    name: String,
}

#[derive(Serialize)]
struct OpenBinaryPayload {
    #[serde(rename = "bytesBase64")]
    bytes_base64: String,
    path: String,
    name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArxivSourceFilePayload {
    path: String,
    source: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ArxivSourcePayload {
    id: String,
    files: Vec<ArxivSourceFilePayload>,
}

#[derive(Debug, Clone, Serialize)]
struct OpenTextFailurePayload {
    path: String,
    message: String,
}

#[derive(Serialize)]
struct SaveTextPayload {
    ok: bool,
    path: Option<String>,
    name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
struct FileRevisionPayload {
    #[serde(rename = "mtimeMs", skip_serializing_if = "Option::is_none")]
    mtime_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
    hash: String,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
enum LinkedTextReadPayload {
    Ok {
        source: String,
        revision: FileRevisionPayload,
        #[serde(rename = "fileRef")]
        file_ref: LinkedFileRefPayload,
    },
    Missing,
    Failed {
        reason: String,
    },
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
enum LinkedTextWritePayload {
    Saved {
        revision: FileRevisionPayload,
        #[serde(rename = "fileRef")]
        file_ref: LinkedFileRefPayload,
    },
    ChangedOnDisk {
        source: String,
        revision: FileRevisionPayload,
        #[serde(rename = "fileRef")]
        file_ref: LinkedFileRefPayload,
    },
    Missing,
    Failed {
        reason: String,
    },
}

#[derive(Clone, Serialize)]
struct LinkedFileRefPayload {
    kind: String,
    name: String,
    path: String,
    provider: String,
}

#[derive(Clone, Serialize)]
struct LinkedFileChangedPayload {
    path: String,
}

#[derive(Debug, Clone, Serialize)]
struct DesktopCustomClipboardTextPayload {
    format: String,
    text: String,
}

#[derive(Debug, Clone, Serialize)]
struct DesktopCustomClipboardBytesPayload {
    format: String,
    #[serde(rename = "bytesBase64")]
    bytes_base64: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopClipboardWriteBundlePayload {
    plain_text: String,
    tikz_json: Option<String>,
    svg_text: Option<String>,
    png_base64: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
enum DesktopContextMenuItemPayload {
    #[serde(rename = "separator")]
    Separator,
    #[serde(rename = "command")]
    Command {
        #[serde(rename = "commandId")]
        command_id: String,
        label: String,
        enabled: bool,
        #[serde(default)]
        checked: Option<bool>,
        #[serde(default)]
        accelerator: Option<String>,
    },
    #[serde(rename = "submenu")]
    Submenu {
        label: String,
        items: Vec<DesktopContextMenuItemPayload>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DesktopContextMenuPayload {
    #[serde(rename = "requestId")]
    request_id: String,
    items: Vec<DesktopContextMenuItemPayload>,
}

#[derive(Debug, Clone, Serialize)]
struct DesktopContextMenuCommandEvent {
    #[serde(rename = "requestId")]
    request_id: String,
    #[serde(rename = "commandId")]
    command_id: String,
}

fn panic_to_string(panic_payload: Box<dyn std::any::Any + Send>) -> String {
    if let Some(message) = panic_payload.downcast_ref::<&str>() {
        return (*message).to_string();
    }
    if let Some(message) = panic_payload.downcast_ref::<String>() {
        return message.clone();
    }
    "unknown panic".to_string()
}

fn map_unsaved_changes_dialog_result(result: rfd::MessageDialogResult) -> &'static str {
    match result {
        rfd::MessageDialogResult::Custom(label) => {
            let normalized = label.trim().to_ascii_lowercase();
            if normalized == "save" {
                "save"
            } else if normalized == "don't save"
                || normalized == "dont save"
                || normalized == "don’t save"
            {
                "discard"
            } else {
                "cancel"
            }
        }
        rfd::MessageDialogResult::Yes => "save",
        rfd::MessageDialogResult::No => "discard",
        rfd::MessageDialogResult::Ok => "save",
        rfd::MessageDialogResult::Cancel => "cancel",
    }
}

fn recents_file_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(RECENTS_FILENAME))
}

fn load_recent_files_from_disk(app: &AppHandle) -> Vec<String> {
    let Some(path) = recents_file_path(app) else {
        return Vec::new();
    };
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    match serde_json::from_str::<Vec<String>>(&raw) {
        Ok(entries) => entries
            .into_iter()
            .filter(|entry| !entry.trim().is_empty())
            .collect(),
        Err(_) => Vec::new(),
    }
}

fn save_recent_files_to_disk(app: &AppHandle, files: &[String]) {
    let Some(path) = recents_file_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(raw) = serde_json::to_string_pretty(files) {
        let _ = fs::write(path, raw);
    }
}

fn update_relaunch_marker_path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|dir| dir.join(UPDATE_RELAUNCH_MARKER_FILENAME))
}

fn write_update_relaunch_marker(app: &AppHandle) -> Result<(), String> {
    let Some(path) = update_relaunch_marker_path(app) else {
        return Err("Could not resolve app config directory.".to_string());
    };
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(path, b"1").map_err(|error| error.to_string())
}

fn consume_update_relaunch_marker(app: &AppHandle) -> bool {
    let Some(path) = update_relaunch_marker_path(app) else {
        return false;
    };
    match fs::remove_file(path) {
        Ok(()) => true,
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(_) => false,
    }
}

fn normalize_recents(entries: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for entry in entries {
        if entry.trim().is_empty() {
            continue;
        }
        if out.iter().any(|known| known == &entry) {
            continue;
        }
        out.push(entry);
        if out.len() >= MAX_RECENT_FILES {
            break;
        }
    }
    out
}

fn add_recent_file(app: &AppHandle, path: String) {
    let normalized = {
        let state = app.state::<RecentFilesState>();
        let mut entries = state.files.lock().expect("recent files mutex poisoned");
        let mut next = vec![path];
        next.extend(entries.iter().cloned());
        let compact = normalize_recents(next);
        *entries = compact.clone();
        compact
    };
    save_recent_files_to_disk(app, &normalized);
}

fn context_menu_item_id(request_id: &str, command_id: &str) -> String {
    format!("{CONTEXT_MENU_EVENT_PREFIX}{request_id}::{command_id}")
}

fn parse_context_menu_item_id(raw_id: &str) -> Option<(String, String)> {
    let remainder = raw_id.strip_prefix(CONTEXT_MENU_EVENT_PREFIX)?;
    let (request_id, command_id) = remainder.split_once("::")?;
    Some((request_id.to_string(), command_id.to_string()))
}

fn has_supported_association_extension(path: &Path) -> bool {
    let Some(ext) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    matches!(ext.to_ascii_lowercase().as_str(), "tikz" | "tex")
}

fn collect_associated_file_paths(args: &[String], cwd: Option<&str>) -> Vec<PathBuf> {
    let base_dir = cwd.map(PathBuf::from);
    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<PathBuf> = Vec::new();

    for arg in args.iter().skip(1) {
        let trimmed = arg.trim();
        if trimmed.is_empty() {
            continue;
        }

        let raw = PathBuf::from(trimmed);
        let resolved = if raw.is_absolute() {
            raw
        } else if let Some(base) = base_dir.as_ref() {
            base.join(raw)
        } else {
            raw
        };

        if !has_supported_association_extension(&resolved) {
            continue;
        }

        let key = resolved.to_string_lossy().to_string();
        if !seen.insert(key) {
            continue;
        }
        out.push(resolved);
    }

    out
}

fn collect_associated_file_paths_from_urls(urls: &[Url]) -> Vec<PathBuf> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<PathBuf> = Vec::new();

    for url in urls {
        if url.scheme() != "file" {
            continue;
        }
        let Ok(path) = url.to_file_path() else {
            continue;
        };
        if !has_supported_association_extension(&path) {
            continue;
        }

        let key = path.to_string_lossy().to_string();
        if !seen.insert(key) {
            continue;
        }
        out.push(path);
    }

    out
}

fn read_open_text_payload_from_path(path: &Path) -> Result<OpenTextPayload, String> {
    let source = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let path_string = path.to_string_lossy().to_string();
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "document.tex".to_string());
    Ok(OpenTextPayload {
        source,
        path: path_string,
        name,
    })
}

fn split_arxiv_version_suffix(value: &str) -> (&str, Option<&str>) {
    let Some((base, version)) = value.rsplit_once('v') else {
        return (value, None);
    };
    if base.is_empty() || version.is_empty() || !version.chars().all(|ch| ch.is_ascii_digit()) {
        return (value, None);
    }
    (base, Some(version))
}

fn is_valid_arxiv_id(value: &str) -> bool {
    let value = value.trim();
    let (base, version) = split_arxiv_version_suffix(value);
    if version.is_some_and(|v| v == "0") {
        return false;
    }
    if let Some((left, right)) = base.split_once('.') {
        return left.len() == 4
            && left.chars().all(|ch| ch.is_ascii_digit())
            && (right.len() == 4 || right.len() == 5)
            && right.chars().all(|ch| ch.is_ascii_digit());
    }
    if let Some((category, number)) = base.split_once('/') {
        return !category.is_empty()
            && category
                .chars()
                .all(|ch| ch.is_ascii_alphabetic() || ch == '-' || ch == '.')
            && number.len() == 7
            && number.chars().all(|ch| ch.is_ascii_digit());
    }
    false
}

fn extract_arxiv_id(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Enter an arXiv URL or ID.".to_string());
    }
    if is_valid_arxiv_id(trimmed) {
        return Ok(trimmed.to_string());
    }
    let parsed = Url::parse(trimmed).map_err(|_| "Invalid arXiv URL or ID.".to_string())?;
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if host != "arxiv.org" && host != "www.arxiv.org" {
        return Err("URL must point to arxiv.org.".to_string());
    }
    let segments: Vec<&str> = parsed
        .path_segments()
        .map(|segments| segments.collect())
        .unwrap_or_default();
    if segments.len() < 2 || !matches!(segments[0], "abs" | "pdf" | "src" | "html") {
        return Err("URL must be an arXiv abstract, PDF, HTML, or source URL.".to_string());
    }
    let first = segments[1].trim_end_matches(".pdf");
    let candidate = if is_valid_arxiv_id(first) {
        first.to_string()
    } else if segments.len() >= 3 {
        format!("{}/{}", first, segments[2].trim_end_matches(".pdf"))
    } else {
        first.to_string()
    };
    if is_valid_arxiv_id(&candidate) {
        Ok(candidate)
    } else {
        Err("Invalid arXiv URL or ID.".to_string())
    }
}

fn is_source_text_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    matches!(
        Path::new(&lower).extension().and_then(|ext| ext.to_str()),
        Some(
            "tex" | "tikz" | "sty" | "cls" | "dtx" | "ins" | "ltx" | "def" | "bib" | "bbl" | "txt"
        )
    )
}

fn safe_archive_path(path: &Path) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => {
                let text = value.to_str()?;
                if text.is_empty() {
                    return None;
                }
                parts.push(text.to_string());
            }
            Component::CurDir => {}
            _ => return None,
        }
    }
    if parts.is_empty() {
        return None;
    }
    Some(parts.join("/"))
}

fn decode_utf8_lossy(bytes: Vec<u8>) -> String {
    match String::from_utf8(bytes) {
        Ok(source) => source,
        Err(error) => String::from_utf8_lossy(error.as_bytes()).into_owned(),
    }
}

fn read_text_entry(path: String, bytes: Vec<u8>) -> ArxivSourceFilePayload {
    ArxivSourceFilePayload {
        path,
        size: bytes.len() as u64,
        source: decode_utf8_lossy(bytes),
    }
}

fn arxiv_source_files_from_gzip(bytes: &[u8]) -> Result<Vec<ArxivSourceFilePayload>, String> {
    let mut decoder = GzDecoder::new(Cursor::new(bytes));
    let mut decoded: Vec<u8> = Vec::new();
    decoder
        .read_to_end(&mut decoded)
        .map_err(|error| format!("Could not decompress arXiv source: {error}"))?;
    if decoded.len() as u64 > ARXIV_SOURCE_MAX_TEXT_BYTES {
        return Err("arXiv source archive is too large.".to_string());
    }

    let mut archive = tar::Archive::new(Cursor::new(decoded.as_slice()));
    let mut files: Vec<ArxivSourceFilePayload> = Vec::new();
    if let Ok(entries) = archive.entries() {
        for entry_result in entries {
            if files.len() >= ARXIV_SOURCE_MAX_FILES {
                break;
            }
            let mut entry = match entry_result {
                Ok(entry) => entry,
                Err(_) => {
                    files.clear();
                    break;
                }
            };
            if !entry.header().entry_type().is_file() {
                continue;
            }
            let path = match entry.path().ok().and_then(|path| safe_archive_path(&path)) {
                Some(path) => path,
                None => continue,
            };
            if !is_source_text_path(&path) {
                continue;
            }
            let entry_size = entry.header().size().unwrap_or(0);
            if entry_size > ARXIV_SOURCE_MAX_TEXT_BYTES {
                continue;
            }
            let mut entry_bytes: Vec<u8> = Vec::new();
            if entry.read_to_end(&mut entry_bytes).is_ok() {
                files.push(read_text_entry(path, entry_bytes));
            }
        }
    }

    if !files.is_empty() {
        return Ok(files);
    }

    Ok(vec![read_text_entry("main.tex".to_string(), decoded)])
}

fn arxiv_source_files_from_response(bytes: &[u8]) -> Result<Vec<ArxivSourceFilePayload>, String> {
    if bytes.len() >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b {
        return arxiv_source_files_from_gzip(bytes);
    }
    if bytes.starts_with(b"%PDF") {
        return Err("arXiv returned a PDF rather than TeX source for this paper.".to_string());
    }
    if bytes.len() as u64 > ARXIV_SOURCE_MAX_TEXT_BYTES {
        return Err("arXiv source file is too large.".to_string());
    }
    Ok(vec![read_text_entry(
        "main.tex".to_string(),
        bytes.to_vec(),
    )])
}

fn hash_text_for_revision(text: &str) -> String {
    let mut hash: u32 = 0x811c9dc5;
    for byte in text.as_bytes() {
        hash ^= *byte as u32;
        hash = hash.wrapping_mul(0x01000193);
    }
    format!("{hash:08x}")
}

fn revision_for_path_and_source(path: &Path, source: &str) -> FileRevisionPayload {
    let metadata = fs::metadata(path).ok();
    let mtime_ms = metadata
        .as_ref()
        .and_then(|meta| meta.modified().ok())
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs_f64() * 1000.0);
    FileRevisionPayload {
        mtime_ms,
        size: metadata.as_ref().map(|meta| meta.len()),
        hash: hash_text_for_revision(source),
    }
}

fn linked_file_ref_payload(path: &Path) -> LinkedFileRefPayload {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "document.tex".to_string());
    LinkedFileRefPayload {
        kind: "file".to_string(),
        name,
        path: path.to_string_lossy().to_string(),
        provider: "desktop-fs".to_string(),
    }
}

fn read_linked_text_payload(path: &Path) -> Result<LinkedTextReadPayload, String> {
    match fs::read_to_string(path) {
        Ok(source) => Ok(LinkedTextReadPayload::Ok {
            revision: revision_for_path_and_source(path, &source),
            file_ref: linked_file_ref_payload(path),
            source,
        }),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(LinkedTextReadPayload::Missing),
        Err(error) => Ok(LinkedTextReadPayload::Failed {
            reason: error.to_string(),
        }),
    }
}

fn normalize_watch_path(path: PathBuf) -> PathBuf {
    path.canonicalize().unwrap_or(path)
}

fn changed_linked_paths_for_event(
    event_paths: &[PathBuf],
    watched_paths: &HashSet<PathBuf>,
) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for watched in watched_paths {
        let watched_parent = watched.parent();
        let changed = event_paths.iter().any(|event_path| {
            let normalized_event = normalize_watch_path(event_path.clone());
            normalized_event == *watched
                || (watched_parent.is_some() && normalized_event.parent() == watched_parent)
        });
        if changed && seen.insert(watched.clone()) {
            out.push(watched.clone());
        }
    }
    out
}

fn emit_linked_file_changed(app: &AppHandle, path: &Path) {
    let _ = app.emit(
        DESKTOP_LINKED_FILE_CHANGED_EVENT,
        LinkedFileChangedPayload {
            path: path.to_string_lossy().to_string(),
        },
    );
}

fn enqueue_pending_open_results(
    app: &AppHandle,
    requests: Vec<OpenTextPayload>,
    failures: Vec<OpenTextFailurePayload>,
) {
    if requests.is_empty() && failures.is_empty() {
        return;
    }

    let state = app.state::<PendingOpenRequestsState>();
    if let Ok(mut pending) = state.requests.lock() {
        pending.extend(requests);
    }
    if let Ok(mut pending_failures) = state.failures.lock() {
        pending_failures.extend(failures);
    }

    let _ = app.emit(DESKTOP_OPEN_REQUESTS_CHANGED_EVENT, ());
}

fn process_associated_open_requests(app: &AppHandle, args: &[String], cwd: Option<&str>) {
    let candidates = collect_associated_file_paths(args, cwd);
    process_associated_file_paths(app, candidates);
}

fn process_associated_open_urls(app: &AppHandle, urls: &[Url]) {
    let candidates = collect_associated_file_paths_from_urls(urls);
    process_associated_file_paths(app, candidates);
}

fn process_associated_file_paths(app: &AppHandle, candidates: Vec<PathBuf>) {
    if candidates.is_empty() {
        return;
    }

    let mut successes: Vec<OpenTextPayload> = Vec::new();
    let mut failures: Vec<OpenTextFailurePayload> = Vec::new();

    for path in candidates {
        match read_open_text_payload_from_path(&path) {
            Ok(payload) => {
                add_recent_file(app, payload.path.clone());
                successes.push(payload);
            }
            Err(message) => failures.push(OpenTextFailurePayload {
                path: path.to_string_lossy().to_string(),
                message,
            }),
        }
    }

    enqueue_pending_open_results(app, successes, failures);
}

fn native_clipboard_role(command_id: &str) -> Option<&'static str> {
    match command_id {
        "edit.cut" => Some("cut"),
        "edit.copy" => Some("copy"),
        "edit.paste" => Some("paste"),
        _ => None,
    }
}

fn validate_external_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL must not be empty".to_string());
    }
    let parsed = Url::parse(trimmed).map_err(|error| format!("Malformed URL: {error}"))?;
    let scheme = parsed.scheme().to_ascii_lowercase();
    let is_supported_scheme = matches!(scheme.as_str(), "http" | "https" | "mailto");
    if !is_supported_scheme {
        return Err(format!(
            "Unsupported URL scheme '{scheme}'. Allowed: http, https, mailto."
        ));
    }
    if matches!(scheme.as_str(), "http" | "https") && parsed.host_str().is_none() {
        return Err("HTTP(S) URLs must include a host".to_string());
    }
    Ok(trimmed.to_string())
}

fn build_context_menu_item<R: tauri::Runtime>(
    manager: &impl Manager<R>,
    request_id: &str,
    item: &DesktopContextMenuItemPayload,
) -> Result<MenuItemKind<R>, String> {
    match item {
        DesktopContextMenuItemPayload::Separator => PredefinedMenuItem::separator(manager)
            .map(MenuItemKind::Predefined)
            .map_err(|error| error.to_string()),
        DesktopContextMenuItemPayload::Submenu { label, items } => {
            let submenu = SubmenuBuilder::new(manager, label)
                .build()
                .map_err(|error| error.to_string())?;
            for child in items {
                let built = build_context_menu_item(manager, request_id, child)?;
                submenu.append(&built).map_err(|error| error.to_string())?;
            }
            Ok(MenuItemKind::Submenu(submenu))
        }
        DesktopContextMenuItemPayload::Command {
            command_id,
            label,
            enabled,
            checked,
            accelerator,
        } => {
            if *enabled {
                if let Some(role) = native_clipboard_role(command_id) {
                    let predefined = match role {
                        "cut" => PredefinedMenuItem::cut(manager, Some(label)),
                        "copy" => PredefinedMenuItem::copy(manager, Some(label)),
                        "paste" => PredefinedMenuItem::paste(manager, Some(label)),
                        _ => unreachable!(),
                    }
                    .map_err(|error| error.to_string())?;
                    return Ok(MenuItemKind::Predefined(predefined));
                }
            }

            if let Some(checked) = checked {
                let mut builder = CheckMenuItemBuilder::with_id(
                    context_menu_item_id(request_id, command_id),
                    label,
                )
                .enabled(*enabled)
                .checked(*checked);
                if let Some(accelerator) = accelerator {
                    builder = builder.accelerator(accelerator);
                }
                return builder
                    .build(manager)
                    .map(MenuItemKind::Check)
                    .map_err(|error| error.to_string());
            }

            let mut builder =
                MenuItemBuilder::with_id(context_menu_item_id(request_id, command_id), label)
                    .enabled(*enabled);
            if let Some(accelerator) = accelerator {
                builder = builder.accelerator(accelerator);
            }
            builder
                .build(manager)
                .map(MenuItemKind::MenuItem)
                .map_err(|error| error.to_string())
        }
    }
}

fn build_context_menu<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    payload: &DesktopContextMenuPayload,
) -> Result<Menu<R>, String> {
    let menu = Menu::new(window).map_err(|error| error.to_string())?;
    for item in &payload.items {
        let built = build_context_menu_item(window, &payload.request_id, item)?;
        menu.append(&built).map_err(|error| error.to_string())?;
    }
    Ok(menu)
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

fn find_executable_base(name: &str) -> Option<PathBuf> {
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

fn npm_global_bin_dir(app: Option<&AppHandle>) -> Option<PathBuf> {
    let app = app?;
    let npm = find_executable_base("npm")?;
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

fn find_executable(name: &str, app: Option<&AppHandle>) -> Option<PathBuf> {
    if let Some(path) = find_executable_base(name) {
        return Some(path);
    }
    if name == "codex" {
        if let Some(npm_bin) = npm_global_bin_dir(app) {
            if let Some(path) = executable_in_dir(&npm_bin, name) {
                return Some(path);
            }
        }
    }
    None
}

fn command_exists(name: &str, app: Option<&AppHandle>) -> bool {
    find_executable(name, app).is_some()
}

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
    if let Some(npm_bin) = npm_global_bin_dir(app) {
        if seen.insert(npm_bin.clone()) {
            entries.push(npm_bin);
        }
    }
    env::join_paths(entries).ok()
}

#[derive(Serialize)]
struct CodexStatus {
    installed: bool,
    has_npm: bool,
    has_brew: bool,
    has_wsl: bool,
}

#[tauri::command]
fn desktop_show_about_panel(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        return macos_about::show(app);
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
fn desktop_check_codex_status(app: AppHandle) -> CodexStatus {
    let has_wsl = cfg!(target_os = "windows") && command_exists("wsl", Some(&app));
    let installed =
        command_exists("codex", Some(&app)) || (has_wsl && wsl_command_exists(&app, "codex"));
    CodexStatus {
        installed,
        has_npm: command_exists("npm", Some(&app)),
        has_brew: command_exists("brew", Some(&app)),
        has_wsl,
    }
}

#[tauri::command]
async fn desktop_install_codex(method: String, app: AppHandle) -> Result<String, String> {
    let (cmd, args): (String, Vec<&str>) = match method.as_str() {
        "npm" => {
            let npm = find_executable("npm", Some(&app))
                .ok_or_else(|| "npm is not available. Install Node.js/npm first.".to_string())?;
            (
                npm.to_string_lossy().to_string(),
                vec!["install", "-g", "@openai/codex"],
            )
        }
        "brew" => {
            let brew = find_executable("brew", Some(&app))
                .ok_or_else(|| "Homebrew is not available on this machine.".to_string())?;
            (brew.to_string_lossy().to_string(), vec!["install", "codex"])
        }
        "wsl" => {
            if !command_exists("wsl", Some(&app)) {
                return Err("WSL is not available on this machine.".to_string());
            }
            (
                "wsl".to_string(),
                vec!["npm", "install", "-g", "@openai/codex"],
            )
        }
        _ => return Err(format!("Unknown install method: {method}")),
    };
    let mut command = app.shell().command(cmd.clone()).args(args.clone());
    if method != "wsl" {
        if let Some(path) = augmented_path(None, Some(&app)) {
            command = command.env("PATH", path);
        }
    }
    let output = command
        .output()
        .await
        .map_err(|e| format!("Failed to run {cmd}: {e}"))?;
    if output.status.success() {
        let installed_now = command_exists("codex", Some(&app))
            || (cfg!(target_os = "windows")
                && command_exists("wsl", Some(&app))
                && wsl_command_exists(&app, "codex"));
        let mut message = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if message.is_empty() {
            message = "Install completed.".to_string();
        }
        if installed_now {
            message.push_str("\nCodex is now discoverable by the app.");
        } else {
            message.push_str(
                "\nInstall finished, but Codex is not yet discoverable from this process PATH.",
            );
            message.push_str("\nThe app will keep probing common npm/bin locations automatically.");
        }
        Ok(message)
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            Err(format!(
                "{cmd} failed with exit code {:?}",
                output.status.code()
            ))
        } else {
            Err(format!("{cmd} failed: {stderr}"))
        }
    }
}

#[tauri::command]
fn desktop_check_latex_available(app: AppHandle) -> LatexAvailabilityStatus {
    let latex_path = find_executable("latex", Some(&app));
    let dvisvgm_path = find_executable("dvisvgm", Some(&app));
    let available = latex_path.is_some() && dvisvgm_path.is_some();
    let latex_cmd = latex_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "latex".to_string());
    let dvisvgm_cmd = dvisvgm_path
        .as_ref()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "dvisvgm".to_string());
    let working_dir = latex_compile_working_dir();
    let details = format!(
        "latex: {latex_cmd}\ndvisvgm: {dvisvgm_cmd}\nworking_dir: {}\nPATH={}\ncompile_timeout_secs={}\n\nCommands used by the app:\ncd \"{}\"\n\"{latex_cmd}\" -interaction=batchmode -file-line-error -halt-on-error input.tex\n\"{dvisvgm_cmd}\" --page=1 --bbox=min --exact --font-format=woff2 -o output.svg input.dvi",
        working_dir.to_string_lossy(),
        env::var("PATH").unwrap_or_else(|_| "<unavailable>".to_string()),
        LATEX_COMMAND_TIMEOUT_SECS,
        working_dir.to_string_lossy(),
    );
    LatexAvailabilityStatus { available, details }
}

fn latex_compile_working_dir() -> PathBuf {
    env::temp_dir().join("tikz-editor-native-compile")
}

fn last_latex_compile_dir() -> PathBuf {
    latex_compile_working_dir().join("last")
}

fn create_latex_compile_working_dir() -> Result<PathBuf, String> {
    let base = latex_compile_working_dir();
    fs::create_dir_all(&base).map_err(|e| {
        format!(
            "Failed to create working dir {}: {e}",
            base.to_string_lossy()
        )
    })?;
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let id = NEXT_LATEX_COMPILE_ID.fetch_add(1, Ordering::Relaxed);
    let working_dir = base.join(format!("run-{millis}-{id}"));
    fs::create_dir_all(&working_dir).map_err(|e| {
        format!(
            "Failed to create working dir {}: {e}",
            working_dir.to_string_lossy()
        )
    })?;
    Ok(working_dir)
}

fn publish_last_latex_compile_log(working_dir: &Path) {
    let last_dir = last_latex_compile_dir();
    if fs::create_dir_all(&last_dir).is_err() {
        return;
    }
    let source = working_dir.join("input.log");
    let target = last_dir.join("input.log");
    if source.exists() {
        let _ = fs::copy(source, target);
    } else {
        let _ = fs::write(target, "");
    }
}

fn clear_last_latex_compile_log() {
    let last_dir = last_latex_compile_dir();
    if fs::create_dir_all(&last_dir).is_ok() {
        let _ = fs::write(last_dir.join("input.log"), "");
    }
}

fn read_text_if_exists(path: &Path) -> String {
    if !path.exists() {
        return String::new();
    }
    fs::read_to_string(path).unwrap_or_default()
}

fn format_command_failure(
    command_label: &str,
    status_code: Option<i32>,
    stdout: &[u8],
    stderr: &[u8],
    log_path: Option<&Path>,
    working_dir: &Path,
) -> String {
    let stdout_text = String::from_utf8_lossy(stdout).trim().to_string();
    let stderr_text = String::from_utf8_lossy(stderr).trim().to_string();
    let log_text = log_path.map(read_text_if_exists).unwrap_or_default();
    let mut out = String::new();
    out.push_str(&format!(
        "{command_label} failed (exit code: {:?})\nworking_dir: {}\n",
        status_code,
        working_dir.to_string_lossy()
    ));
    if !stdout_text.is_empty() {
        out.push_str("\n--- stdout ---\n");
        out.push_str(&stdout_text);
        out.push('\n');
    }
    if !stderr_text.is_empty() {
        out.push_str("\n--- stderr ---\n");
        out.push_str(&stderr_text);
        out.push('\n');
    }
    if !log_text.trim().is_empty() {
        out.push_str("\n--- latex log ---\n");
        out.push_str(&log_text);
        out.push('\n');
    }
    if stdout_text.is_empty() && stderr_text.is_empty() && log_text.trim().is_empty() {
        out.push_str("\n(no command output)\n");
    }
    out
}

struct CommandRunOutput {
    status_code: Option<i32>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

async fn run_shell_command(
    app: &AppHandle,
    command: &str,
    args: &[&str],
    working_dir: &Path,
) -> Result<CommandRunOutput, String> {
    let (mut receiver, child) = app
        .shell()
        .command(command)
        .args(args.to_vec())
        .current_dir(working_dir)
        .spawn()
        .map_err(|e| {
            format!(
                "Failed to spawn `{command}` in {}: {e}",
                working_dir.to_string_lossy()
            )
        })?;

    let mut stdout = Vec::<u8>::new();
    let mut stderr = Vec::<u8>::new();
    let mut status_code = None;
    let deadline = Instant::now() + Duration::from_secs(LATEX_COMMAND_TIMEOUT_SECS);

    loop {
        let now = Instant::now();
        if now >= deadline {
            let _ = child.kill();
            let timeout_details =
                format_command_failure(command, None, &stdout, &stderr, None, working_dir);
            return Err(format!(
                "Command timed out after {}s.\n{}",
                LATEX_COMMAND_TIMEOUT_SECS, timeout_details
            ));
        }
        let remaining = deadline.saturating_duration_since(now);
        let maybe_event = match tokio::time::timeout(remaining, receiver.recv()).await {
            Ok(event) => event,
            Err(_) => {
                let _ = child.kill();
                let timeout_details =
                    format_command_failure(command, None, &stdout, &stderr, None, working_dir);
                return Err(format!(
                    "Command timed out after {}s.\n{}",
                    LATEX_COMMAND_TIMEOUT_SECS, timeout_details
                ));
            }
        };

        let Some(event) = maybe_event else {
            break;
        };

        match event {
            CommandEvent::Stdout(bytes) => stdout.extend(bytes),
            CommandEvent::Stderr(bytes) => stderr.extend(bytes),
            CommandEvent::Terminated(payload) => {
                status_code = payload.code;
                break;
            }
            CommandEvent::Error(error) => {
                return Err(format!(
                    "`{command}` emitted an error in {}: {error}",
                    working_dir.to_string_lossy()
                ));
            }
            _ => {}
        }
    }

    Ok(CommandRunOutput {
        status_code,
        stdout,
        stderr,
    })
}

#[tauri::command]
async fn desktop_compile_tikz(latex_document: String, app: AppHandle) -> Result<String, String> {
    let working_dir = create_latex_compile_working_dir()?;
    clear_last_latex_compile_log();
    let tex_path = working_dir.join("input.tex");
    fs::write(&tex_path, &latex_document).map_err(|e| {
        format!(
            "Failed to write .tex in {}: {e}",
            working_dir.to_string_lossy()
        )
    })?;

    // Run latex
    let latex_result = run_shell_command(
        &app,
        "latex",
        &[
            "-interaction=batchmode",
            "-file-line-error",
            "-halt-on-error",
            "input.tex",
        ],
        &working_dir,
    )
    .await?;

    if latex_result.status_code != Some(0) {
        let latex_log_path = working_dir.join("input.log");
        let message = format_command_failure(
            "latex",
            latex_result.status_code,
            &latex_result.stdout,
            &latex_result.stderr,
            Some(&latex_log_path),
            &working_dir,
        );
        publish_last_latex_compile_log(&working_dir);
        let _ = fs::remove_dir_all(&working_dir);
        return Err(message);
    }

    let dvi_path = working_dir.join("input.dvi");
    if !dvi_path.exists() {
        let latex_log_path = working_dir.join("input.log");
        let log = read_text_if_exists(&latex_log_path);
        let mut message = format!(
            "latex succeeded but DVI was not produced.\nworking_dir: {}",
            working_dir.to_string_lossy()
        );
        if !log.trim().is_empty() {
            message.push_str("\n\n--- latex log ---\n");
            message.push_str(&log);
        }
        publish_last_latex_compile_log(&working_dir);
        let _ = fs::remove_dir_all(&working_dir);
        return Err(message);
    }

    // Run dvisvgm
    let svg_path = working_dir.join("output.svg");
    let dvisvgm_result = run_shell_command(
        &app,
        "dvisvgm",
        &[
            "--page=1",
            "--bbox=min",
            "--exact",
            "--font-format=woff2",
            "-o",
            "output.svg",
            "input.dvi",
        ],
        &working_dir,
    )
    .await?;

    if dvisvgm_result.status_code != Some(0) {
        let message = format_command_failure(
            "dvisvgm",
            dvisvgm_result.status_code,
            &dvisvgm_result.stdout,
            &dvisvgm_result.stderr,
            None,
            &working_dir,
        );
        publish_last_latex_compile_log(&working_dir);
        let _ = fs::remove_dir_all(&working_dir);
        return Err(message);
    }

    if !svg_path.exists() {
        let message = format!(
            "dvisvgm succeeded but SVG was not produced.\nworking_dir: {}",
            working_dir.to_string_lossy()
        );
        publish_last_latex_compile_log(&working_dir);
        let _ = fs::remove_dir_all(&working_dir);
        return Err(message);
    }

    let svg = fs::read_to_string(&svg_path).map_err(|e| format!("Failed to read SVG: {e}"))?;
    publish_last_latex_compile_log(&working_dir);
    let _ = fs::remove_dir_all(&working_dir);
    Ok(svg)
}

#[tauri::command]
fn desktop_read_last_compile_log() -> Result<String, String> {
    let log_path = last_latex_compile_dir().join("input.log");
    if !log_path.exists() {
        return Ok(String::new());
    }
    fs::read_to_string(&log_path)
        .map_err(|e| format!("Failed to read {}: {e}", log_path.to_string_lossy()))
}

#[tauri::command]
fn desktop_open_text(
    path: Option<String>,
    add_to_recent: Option<bool>,
    app: AppHandle,
) -> Result<Option<OpenTextPayload>, String> {
    let resolved_path = if let Some(raw_path) = path {
        Some(PathBuf::from(raw_path))
    } else {
        FileDialog::new()
            .add_filter("TikZ/SVG/Ipe", &["tex", "tikz", "txt", "svg", "ipe"])
            .pick_file()
    };
    let Some(path_buf) = resolved_path else {
        return Ok(None);
    };
    let payload = read_open_text_payload_from_path(&path_buf)?;
    if add_to_recent.unwrap_or(true) {
        add_recent_file(&app, payload.path.clone());
    }
    Ok(Some(payload))
}

#[tauri::command]
fn desktop_open_binary(
    path: Option<String>,
    add_to_recent: Option<bool>,
    app: AppHandle,
) -> Result<Option<OpenBinaryPayload>, String> {
    let resolved_path = if let Some(raw_path) = path {
        Some(PathBuf::from(raw_path))
    } else {
        FileDialog::new()
            .add_filter("PowerPoint", &["pptx"])
            .pick_file()
    };
    let Some(path_buf) = resolved_path else {
        return Ok(None);
    };
    let bytes = fs::read(&path_buf).map_err(|error| error.to_string())?;
    let path = path_buf.to_string_lossy().to_string();
    let name = path_buf
        .file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| "imported.pptx".to_string());
    if add_to_recent.unwrap_or(true) {
        add_recent_file(&app, path.clone());
    }
    Ok(Some(OpenBinaryPayload {
        bytes_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
        path,
        name,
    }))
}

#[tauri::command]
async fn desktop_fetch_arxiv_source(id_or_url: String) -> Result<ArxivSourcePayload, String> {
    let id = extract_arxiv_id(&id_or_url)?;
    let url = format!("https://arxiv.org/src/{id}");
    let client = reqwest::Client::builder()
        .user_agent("TikZ Editor desktop arXiv source import")
        .build()
        .map_err(|error| error.to_string())?;
    let response = tokio::time::timeout(
        Duration::from_secs(ARXIV_SOURCE_DOWNLOAD_TIMEOUT_SECS),
        client.get(url).send(),
    )
    .await
    .map_err(|_| "Timed out while downloading arXiv source.".to_string())?
    .map_err(|error| format!("Could not download arXiv source: {error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "arXiv returned HTTP {} for this source.",
            response.status().as_u16()
        ));
    }
    if response
        .content_length()
        .is_some_and(|length| length > ARXIV_SOURCE_MAX_ARCHIVE_BYTES)
    {
        return Err("arXiv source archive is too large.".to_string());
    }

    let bytes = tokio::time::timeout(
        Duration::from_secs(ARXIV_SOURCE_DOWNLOAD_TIMEOUT_SECS),
        response.bytes(),
    )
    .await
    .map_err(|_| "Timed out while reading arXiv source.".to_string())?
    .map_err(|error| format!("Could not read arXiv source: {error}"))?;
    if bytes.len() as u64 > ARXIV_SOURCE_MAX_ARCHIVE_BYTES {
        return Err("arXiv source archive is too large.".to_string());
    }

    let files = arxiv_source_files_from_response(&bytes)?;
    if files.is_empty() {
        return Err("No TeX source files were found in this arXiv source.".to_string());
    }
    Ok(ArxivSourcePayload { id, files })
}

#[tauri::command]
fn desktop_save_text(
    text: String,
    suggested_name: Option<String>,
    path: Option<String>,
    force_save_as: bool,
    app: AppHandle,
) -> Result<SaveTextPayload, String> {
    let resolved_path = if !force_save_as {
        path.map(PathBuf::from)
    } else {
        None
    }
    .or_else(|| {
        let mut dialog = FileDialog::new();
        if let Some(name) = suggested_name.as_ref() {
            dialog = dialog.set_file_name(name);
        }
        dialog.save_file()
    });

    let Some(path_buf) = resolved_path else {
        return Ok(SaveTextPayload {
            ok: false,
            path: None,
            name: None,
        });
    };

    fs::write(&path_buf, text).map_err(|error| error.to_string())?;
    let path = path_buf.to_string_lossy().to_string();
    let name = path_buf
        .file_name()
        .and_then(|name| name.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| suggested_name.unwrap_or_else(|| "tikz-document.tex".to_string()));
    add_recent_file(&app, path.clone());
    Ok(SaveTextPayload {
        ok: true,
        path: Some(path),
        name: Some(name),
    })
}

#[tauri::command]
fn desktop_read_linked_text(path: String) -> Result<LinkedTextReadPayload, String> {
    read_linked_text_payload(Path::new(&path))
}

#[tauri::command]
fn desktop_write_linked_text(
    path: String,
    text: String,
    expected_revision: Option<FileRevisionPayload>,
    app: AppHandle,
) -> Result<LinkedTextWritePayload, String> {
    let path_buf = PathBuf::from(path);
    let current = read_linked_text_payload(&path_buf)?;
    match current {
        LinkedTextReadPayload::Ok {
            source,
            revision,
            file_ref,
        } => {
            if let Some(expected) = expected_revision {
                if expected.hash != revision.hash
                    || expected.mtime_ms != revision.mtime_ms
                    || expected.size != revision.size
                {
                    return Ok(LinkedTextWritePayload::ChangedOnDisk {
                        source,
                        revision,
                        file_ref,
                    });
                }
            }
        }
        LinkedTextReadPayload::Missing => return Ok(LinkedTextWritePayload::Missing),
        LinkedTextReadPayload::Failed { reason } => {
            return Ok(LinkedTextWritePayload::Failed { reason });
        }
    }

    if let Some(parent) = path_buf.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            return Ok(LinkedTextWritePayload::Failed {
                reason: error.to_string(),
            });
        }
    }
    if let Err(error) = fs::write(&path_buf, text) {
        return Ok(LinkedTextWritePayload::Failed {
            reason: error.to_string(),
        });
    }
    let source = fs::read_to_string(&path_buf).unwrap_or_default();
    let revision = revision_for_path_and_source(&path_buf, &source);
    let file_ref = linked_file_ref_payload(&path_buf);
    add_recent_file(&app, file_ref.path.clone());
    Ok(LinkedTextWritePayload::Saved { revision, file_ref })
}

#[tauri::command]
fn desktop_sync_linked_file_watches(paths: Vec<String>, app: AppHandle) -> Result<(), String> {
    let state = app.state::<LinkedFileWatchState>();
    let watched_paths: HashSet<PathBuf> = paths
        .into_iter()
        .map(|path| path.trim().to_string())
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .map(normalize_watch_path)
        .collect();

    {
        let mut watched = state
            .watched_paths
            .lock()
            .map_err(|_| "linked file watch state unavailable".to_string())?;
        *watched = watched_paths.clone();
    }

    let mut parent_dirs = HashSet::<PathBuf>::new();
    for path in &watched_paths {
        if let Some(parent) = path.parent() {
            parent_dirs.insert(parent.to_path_buf());
        }
    }

    if parent_dirs.is_empty() {
        let mut watcher_slot = state
            .watcher
            .lock()
            .map_err(|_| "linked file watcher unavailable".to_string())?;
        *watcher_slot = None;
        return Ok(());
    }

    let app_for_callback = app.clone();
    let watched_for_callback = Arc::clone(&state.watched_paths);
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<notify::Event>| {
            let Ok(event) = result else {
                return;
            };
            if event.paths.is_empty() {
                return;
            }
            let watched_snapshot = match watched_for_callback.lock() {
                Ok(watched) => watched.clone(),
                Err(_) => return,
            };
            for path in changed_linked_paths_for_event(&event.paths, &watched_snapshot) {
                emit_linked_file_changed(&app_for_callback, &path);
            }
        },
        NotifyConfig::default(),
    )
    .map_err(|error| error.to_string())?;

    for dir in parent_dirs {
        watcher
            .watch(&dir, RecursiveMode::NonRecursive)
            .map_err(|error| error.to_string())?;
    }

    let mut watcher_slot = state
        .watcher
        .lock()
        .map_err(|_| "linked file watcher unavailable".to_string())?;
    *watcher_slot = Some(watcher);
    Ok(())
}

#[tauri::command]
fn desktop_export_file(
    file_name: String,
    _mime_type: String,
    bytes_base64: String,
) -> Result<bool, String> {
    let target = FileDialog::new().set_file_name(&file_name).save_file();
    let Some(path_buf) = target else {
        return Ok(false);
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bytes_base64)
        .map_err(|error| error.to_string())?;
    fs::write(path_buf, bytes).map_err(|error| error.to_string())?;
    Ok(true)
}

#[tauri::command]
async fn desktop_confirm_unsaved_changes(message: String) -> Result<String, String> {
    use rfd::{AsyncMessageDialog, MessageButtons, MessageLevel};

    let result = AsyncMessageDialog::new()
        .set_level(MessageLevel::Warning)
        .set_title("Unsaved Changes")
        .set_description(&message)
        .set_buttons(MessageButtons::YesNoCancelCustom(
            "Save".to_string(),
            "Don\u{2019}t Save".to_string(),
            "Cancel".to_string(),
        ))
        .show()
        .await;

    Ok(map_unsaved_changes_dialog_result(result).to_string())
}

#[tauri::command]
async fn desktop_show_message_dialog(
    title: String,
    message: String,
    kind: Option<String>,
) -> Result<(), String> {
    use rfd::{AsyncMessageDialog, MessageButtons, MessageLevel};

    let level = match kind.as_deref() {
        Some("warning") => MessageLevel::Warning,
        Some("error") => MessageLevel::Error,
        _ => MessageLevel::Info,
    };

    AsyncMessageDialog::new()
        .set_level(level)
        .set_title(&title)
        .set_description(&message)
        .set_buttons(MessageButtons::Ok)
        .show()
        .await;

    Ok(())
}

#[tauri::command]
fn desktop_confirm_window_close(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    window.destroy().map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_list_recent_files(app: AppHandle) -> Result<Vec<String>, String> {
    let state = app.state::<RecentFilesState>();
    let entries = state
        .files
        .lock()
        .map_err(|_| "recent files state unavailable".to_string())?;
    Ok(entries.clone())
}

#[tauri::command]
fn desktop_clear_recent_files(app: AppHandle) -> Result<(), String> {
    {
        let state = app.state::<RecentFilesState>();
        let mut entries = state
            .files
            .lock()
            .map_err(|_| "recent files state unavailable".to_string())?;
        entries.clear();
    }
    save_recent_files_to_disk(&app, &[]);
    Ok(())
}

#[tauri::command]
fn desktop_take_pending_open_requests(app: AppHandle) -> Result<Vec<OpenTextPayload>, String> {
    let state = app.state::<PendingOpenRequestsState>();
    let mut pending = state
        .requests
        .lock()
        .map_err(|_| "pending open requests state unavailable".to_string())?;
    Ok(std::mem::take(&mut *pending))
}

#[tauri::command]
fn desktop_take_pending_open_failures(
    app: AppHandle,
) -> Result<Vec<OpenTextFailurePayload>, String> {
    let state = app.state::<PendingOpenRequestsState>();
    let mut pending = state
        .failures
        .lock()
        .map_err(|_| "pending open failures state unavailable".to_string())?;
    Ok(std::mem::take(&mut *pending))
}

#[tauri::command]
fn desktop_open_external(url: String, app: AppHandle) -> Result<bool, String> {
    let sanitized = validate_external_url(&url)?;
    app.opener()
        .open_url(sanitized, None::<&str>)
        .map(|_| true)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn desktop_prepare_update_relaunch(app: AppHandle) -> Result<(), String> {
    write_update_relaunch_marker(&app)
}

#[tauri::command]
fn desktop_perform_snap_haptic() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use tauri_macos_haptics::haptics::{HapticFeedbackManager, HapticPattern, PerformanceTime};

        HapticFeedbackManager::default_performer()
            .perform(HapticPattern::Alignment, Some(PerformanceTime::Now))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn desktop_prefers_non_blinking_text_insertion_indicator() -> bool {
    #[cfg(target_os = "macos")]
    {
        return macos_accessibility::prefers_non_blinking_text_insertion_indicator();
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[tauri::command]
fn desktop_read_custom_clipboard_text(
    formats: Vec<String>,
) -> Result<Option<DesktopCustomClipboardTextPayload>, String> {
    catch_unwind(AssertUnwindSafe(|| {
        if formats.is_empty() {
            return Ok(None);
        }
        let ctx = ClipboardContext::new().map_err(|error| error.to_string())?;
        for format in formats {
            let trimmed = format.trim().to_string();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(buffer) = ctx.get_buffer(&trimmed) else {
                continue;
            };
            let Ok(text) = String::from_utf8(buffer) else {
                continue;
            };
            if text.trim().is_empty() {
                continue;
            }
            return Ok(Some(DesktopCustomClipboardTextPayload {
                format: trimmed,
                text,
            }));
        }
        Ok(None)
    }))
    .map_err(|panic_payload| {
        format!("Clipboard native panic: {}", panic_to_string(panic_payload))
    })?
}

#[tauri::command]
fn desktop_read_custom_clipboard_bytes(
    formats: Vec<String>,
) -> Result<Option<DesktopCustomClipboardBytesPayload>, String> {
    catch_unwind(AssertUnwindSafe(|| {
        if formats.is_empty() {
            return Ok(None);
        }
        let ctx = ClipboardContext::new().map_err(|error| error.to_string())?;
        for format in formats {
            let trimmed = format.trim().to_string();
            if trimmed.is_empty() {
                continue;
            }
            let Ok(buffer) = ctx.get_buffer(&trimmed) else {
                continue;
            };
            if buffer.is_empty() {
                continue;
            }
            return Ok(Some(DesktopCustomClipboardBytesPayload {
                format: trimmed,
                bytes_base64: base64::engine::general_purpose::STANDARD.encode(buffer),
            }));
        }
        Ok(None)
    }))
    .map_err(|panic_payload| {
        format!("Clipboard native panic: {}", panic_to_string(panic_payload))
    })?
}

#[tauri::command]
fn desktop_write_clipboard_bundle(
    payload: DesktopClipboardWriteBundlePayload,
) -> Result<(), String> {
    catch_unwind(AssertUnwindSafe(|| {
        let png_bytes = payload
            .png_base64
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .and_then(|value| base64::engine::general_purpose::STANDARD.decode(value).ok())
            .filter(|bytes| !bytes.is_empty());
        let mut contents: Vec<ClipboardContent> = Vec::new();
        if let Some(bytes) = png_bytes.as_ref() {
            if let Ok(image) = RustImageData::from_bytes(bytes) {
                contents.push(ClipboardContent::Image(image));
            }
        }
        contents.push(ClipboardContent::Text(payload.plain_text));
        if let Some(tikz_json) = payload.tikz_json {
            if !tikz_json.trim().is_empty() {
                for format in TIKZ_CUSTOM_CLIPBOARD_FORMATS {
                    contents.push(ClipboardContent::Other(
                        format.to_string(),
                        tikz_json.clone().into_bytes(),
                    ));
                }
            }
        }
        if let Some(svg_text) = payload.svg_text {
            if !svg_text.trim().is_empty() {
                let bytes = svg_text.into_bytes();
                for format in DESKTOP_SVG_CLIPBOARD_FORMATS {
                    contents.push(ClipboardContent::Other(format.to_string(), bytes.clone()));
                }
            }
        }
        if let Some(bytes) = png_bytes {
            for format in DESKTOP_PNG_CLIPBOARD_FORMATS {
                contents.push(ClipboardContent::Other(format.to_string(), bytes.clone()));
            }
        }
        let ctx = ClipboardContext::new().map_err(|error| error.to_string())?;
        ctx.set(contents).map_err(|error| error.to_string())
    }))
    .map_err(|panic_payload| {
        format!("Clipboard native panic: {}", panic_to_string(panic_payload))
    })?
}

#[tauri::command]
fn desktop_show_context_menu(
    payload: DesktopContextMenuPayload,
    app: AppHandle,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;

    let menu = match build_context_menu(&window, &payload) {
        Ok(menu) => menu,
        Err(error) => return Err(error),
    };

    window.popup_menu(&menu).map_err(|error| error.to_string())
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_ensure_document_thread(
    documentId: String,
    source: String,
    threadId: Option<String>,
    workspacePath: Option<String>,
    figurePath: Option<String>,
    previewPath: Option<String>,
    assistant: tauri::State<'_, AssistantState>,
) -> Result<AssistantThreadSummary, String> {
    assistant.ensure_document_thread(
        documentId,
        source,
        threadId,
        workspacePath,
        figurePath,
        previewPath,
    )
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_start_turn(
    documentId: String,
    prompt: String,
    source: String,
    pngBase64: Option<String>,
    pastedImages: Option<Vec<assistant::AssistantPastedImageInput>>,
    threadId: Option<String>,
    workspacePath: Option<String>,
    figurePath: Option<String>,
    previewPath: Option<String>,
    model: Option<String>,
    figureContext: Option<String>,
    diagnosticsText: Option<String>,
    assistant: tauri::State<'_, AssistantState>,
) -> Result<serde_json::Value, String> {
    let turn_id = assistant.start_turn(
        documentId,
        prompt,
        source,
        pngBase64,
        pastedImages,
        threadId,
        workspacePath,
        figurePath,
        previewPath,
        model,
        figureContext,
        diagnosticsText,
    )?;
    Ok(serde_json::json!({ "turnId": turn_id }))
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_interrupt_turn(
    documentId: String,
    assistant: tauri::State<'_, AssistantState>,
) -> Result<(), String> {
    assistant.interrupt_turn(documentId)
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_steer_turn(
    documentId: String,
    prompt: String,
    pastedImages: Option<Vec<assistant::AssistantPastedImageInput>>,
    assistant: tauri::State<'_, AssistantState>,
) -> Result<serde_json::Value, String> {
    let turn_id = assistant.steer_turn(documentId, prompt, pastedImages)?;
    Ok(serde_json::json!({ "turnId": turn_id }))
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_sync_source(
    documentId: String,
    source: String,
    assistant: tauri::State<'_, AssistantState>,
) -> Result<(), String> {
    assistant.sync_source(documentId, source)
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_respond_to_approval(
    documentId: String,
    requestId: String,
    decision: String,
    assistant: tauri::State<'_, AssistantState>,
) -> Result<(), String> {
    assistant.respond_to_approval(documentId, requestId, decision)
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_respond_to_dynamic_tool_call(
    documentId: String,
    requestId: String,
    result: Value,
    assistant: tauri::State<'_, AssistantState>,
) -> Result<(), String> {
    assistant.respond_to_dynamic_tool_call(documentId, requestId, result)
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_load_thread_state(
    documentId: String,
    assistant: tauri::State<'_, AssistantState>,
) -> Result<Option<AssistantThreadStatePayload>, String> {
    assistant.load_thread_state(documentId)
}

#[tauri::command]
fn desktop_assistant_warm_up(assistant: tauri::State<'_, AssistantState>) -> Result<(), String> {
    assistant.warm_up()
}

#[tauri::command]
fn desktop_assistant_list_models(
    assistant: tauri::State<'_, AssistantState>,
) -> Result<Vec<AssistantModelOption>, String> {
    assistant.list_models()
}

#[tauri::command]
fn desktop_assistant_read_account_snapshot(
    assistant: tauri::State<'_, AssistantState>,
) -> Result<AssistantAccountSnapshot, String> {
    assistant.read_account_snapshot()
}

#[tauri::command]
fn desktop_assistant_read_account(
    assistant: tauri::State<'_, AssistantState>,
) -> Result<serde_json::Value, String> {
    assistant.read_account()
}

#[tauri::command]
fn desktop_assistant_read_rate_limits(
    assistant: tauri::State<'_, AssistantState>,
) -> Result<serde_json::Value, String> {
    assistant.read_rate_limits()
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_login_start(
    loginType: String,
    apiKey: Option<String>,
    assistant: tauri::State<'_, AssistantState>,
) -> Result<serde_json::Value, String> {
    assistant.login_start(&loginType, apiKey.as_deref())
}

#[tauri::command]
#[allow(non_snake_case)]
fn desktop_assistant_login_cancel(
    loginId: String,
    assistant: tauri::State<'_, AssistantState>,
) -> Result<(), String> {
    assistant.login_cancel(&loginId)
}

#[tauri::command]
fn desktop_assistant_logout(assistant: tauri::State<'_, AssistantState>) -> Result<(), String> {
    assistant.logout()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            process_associated_open_requests(app, &args, Some(cwd.as_str()));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }));
    }

    builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_clipboard_x::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init());
    #[cfg(target_os = "macos")]
    {
        builder = builder.plugin(tauri_macos_haptics::init());
    }

    let builder = builder
        .manage(RecentFilesState::default())
        .manage(PendingOpenRequestsState::default())
        .manage(LinkedFileWatchState::default());

    builder
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("desktop-window-close-request", ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            desktop_check_codex_status,
            desktop_show_about_panel,
            desktop_install_codex,
            desktop_check_latex_available,
            desktop_compile_tikz,
            desktop_read_last_compile_log,
            desktop_open_text,
            desktop_open_binary,
            desktop_fetch_arxiv_source,
            desktop_save_text,
            desktop_read_linked_text,
            desktop_write_linked_text,
            desktop_sync_linked_file_watches,
            desktop_export_file,
            desktop_confirm_unsaved_changes,
            desktop_show_message_dialog,
            desktop_confirm_window_close,
            desktop_list_recent_files,
            desktop_clear_recent_files,
            desktop_take_pending_open_requests,
            desktop_take_pending_open_failures,
            desktop_open_external,
            desktop_prepare_update_relaunch,
            desktop_perform_snap_haptic,
            desktop_prefers_non_blinking_text_insertion_indicator,
            desktop_read_custom_clipboard_text,
            desktop_read_custom_clipboard_bytes,
            desktop_write_clipboard_bundle,
            desktop_show_context_menu,
            desktop_assistant_ensure_document_thread,
            desktop_assistant_start_turn,
            desktop_assistant_interrupt_turn,
            desktop_assistant_steer_turn,
            desktop_assistant_sync_source,
            desktop_assistant_respond_to_approval,
            desktop_assistant_respond_to_dynamic_tool_call,
            desktop_assistant_load_thread_state,
            desktop_assistant_warm_up,
            desktop_assistant_list_models,
            desktop_assistant_read_account_snapshot,
            desktop_assistant_read_account,
            desktop_assistant_read_rate_limits,
            desktop_assistant_login_start,
            desktop_assistant_login_cancel,
            desktop_assistant_logout
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            app.on_menu_event(move |_app, event| {
                let raw_id = event.id().0.as_ref();
                let Some((request_id, command_id)) = parse_context_menu_item_id(raw_id) else {
                    return;
                };

                if let Some(window) = handle.get_webview_window("main") {
                    // Native context menu dismissal can leave the WKWebView in a state where
                    // the first mouse-down after this command is consumed by focus restoration.
                    let _ = window.set_focus();
                    let _ = window.emit(
                        "desktop-context-menu-command",
                        DesktopContextMenuCommandEvent {
                            request_id,
                            command_id,
                        },
                    );
                }
            });

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let loaded = normalize_recents(load_recent_files_from_disk(&app.handle()));
            if let Ok(mut entries) = app.state::<RecentFilesState>().files.lock() {
                *entries = loaded.clone();
            }
            save_recent_files_to_disk(&app.handle(), &loaded);

            let startup_args: Vec<String> = env::args().collect();
            let startup_cwd = env::current_dir()
                .ok()
                .and_then(|path| path.to_str().map(ToOwned::to_owned));
            process_associated_open_requests(&app.handle(), &startup_args, startup_cwd.as_deref());

            app.manage(AssistantState::new(app.handle().clone()));

            #[cfg(target_os = "macos")]
            {
                let observer = macos_accessibility::install_observer(app.handle().clone());
                std::mem::forget(observer);
            }

            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_effects(tauri::utils::config::WindowEffectsConfig {
                    effects: vec![tauri::utils::WindowEffect::Sidebar],
                    state: None,
                    radius: None,
                    color: None,
                });
            }

            #[cfg(target_os = "macos")]
            if consume_update_relaunch_marker(&app.handle()) {
                macos_activation::activate_ignoring_other_apps();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                process_associated_open_urls(app, &urls);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::{
        changed_linked_paths_for_event, collect_associated_file_paths,
        collect_associated_file_paths_from_urls, has_supported_association_extension,
        map_unsaved_changes_dialog_result, validate_external_url,
    };
    use rfd::MessageDialogResult;
    use std::collections::HashSet;
    use std::path::{Path, PathBuf};
    use url::Url;

    #[test]
    fn validates_supported_external_urls() {
        let https = validate_external_url("https://tauri.app");
        assert!(https.is_ok());

        let mailto = validate_external_url("mailto:hello@example.com");
        assert!(mailto.is_ok());
    }

    #[test]
    fn rejects_invalid_external_urls() {
        let malformed = validate_external_url("not a url");
        assert!(malformed.is_err());

        let empty = validate_external_url("   ");
        assert!(empty.is_err());

        let unsupported = validate_external_url("file:///tmp/test.txt");
        assert!(unsupported.is_err());

        let hostless_http = validate_external_url("https://");
        assert!(hostless_http.is_err());
    }

    #[test]
    fn association_extension_filter_is_case_insensitive() {
        assert!(has_supported_association_extension(Path::new(
            "/tmp/diagram.tikz"
        )));
        assert!(has_supported_association_extension(Path::new(
            "/tmp/diagram.TEX"
        )));
        assert!(!has_supported_association_extension(Path::new(
            "/tmp/diagram.svg"
        )));
    }

    #[test]
    fn collects_associated_paths_from_args() {
        let args = vec![
            "tikz-editor".to_string(),
            "first.tikz".to_string(),
            "second.tex".to_string(),
            "third.txt".to_string(),
            "first.tikz".to_string(),
        ];

        let collected = collect_associated_file_paths(&args, Some("/tmp/work"));
        let rendered: Vec<String> = collected
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect();
        assert_eq!(
            rendered,
            vec![
                "/tmp/work/first.tikz".to_string(),
                "/tmp/work/second.tex".to_string()
            ]
        );
    }

    #[test]
    fn collects_associated_paths_from_file_urls() {
        let urls = vec![
            Url::from_file_path("/tmp/work/first.tikz").unwrap(),
            Url::parse("https://example.com/second.tex").unwrap(),
            Url::from_file_path("/tmp/work/second.tex").unwrap(),
            Url::from_file_path("/tmp/work/third.txt").unwrap(),
            Url::from_file_path("/tmp/work/first.tikz").unwrap(),
        ];

        let collected = collect_associated_file_paths_from_urls(&urls);
        let rendered: Vec<String> = collected
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect();
        assert_eq!(
            rendered,
            vec![
                "/tmp/work/first.tikz".to_string(),
                "/tmp/work/second.tex".to_string()
            ]
        );
    }

    #[test]
    fn maps_unsaved_changes_dialog_results_consistently() {
        assert_eq!(
            map_unsaved_changes_dialog_result(MessageDialogResult::Yes),
            "save"
        );
        assert_eq!(
            map_unsaved_changes_dialog_result(MessageDialogResult::No),
            "discard"
        );
        assert_eq!(
            map_unsaved_changes_dialog_result(MessageDialogResult::Custom("Save".to_string())),
            "save"
        );
        assert_eq!(
            map_unsaved_changes_dialog_result(MessageDialogResult::Custom(
                "Don’t Save".to_string()
            )),
            "discard"
        );
        assert_eq!(
            map_unsaved_changes_dialog_result(MessageDialogResult::Custom("Cancel".to_string())),
            "cancel"
        );
    }

    #[test]
    fn maps_directory_events_back_to_watched_files() {
        let watched = HashSet::from([
            PathBuf::from("/tmp/project/a.tex"),
            PathBuf::from("/tmp/project/b.tex"),
            PathBuf::from("/tmp/other/c.tex"),
        ]);
        let changed =
            changed_linked_paths_for_event(&[PathBuf::from("/tmp/project/.a.tex.swp")], &watched);
        assert_eq!(
            changed.into_iter().collect::<HashSet<_>>(),
            HashSet::from([
                PathBuf::from("/tmp/project/a.tex"),
                PathBuf::from("/tmp/project/b.tex")
            ])
        );
    }
}
