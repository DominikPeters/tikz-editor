#[cfg(target_os = "ios")]
use tauri::Manager;

/// WKWebView's scroll view insets its content by the safe area on its own, which
/// shrinks the layout viewport while `env(safe-area-inset-*)` still reports the
/// insets — the CSS then pads a second time and leaves a dead strip at the bottom.
/// With `viewport-fit=cover` the page owns the safe area, so turn the native
/// adjustment off.
#[cfg(target_os = "ios")]
fn let_page_own_safe_area(window: &tauri::WebviewWindow) {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    const UI_SCROLL_VIEW_CONTENT_INSET_ADJUSTMENT_NEVER: isize = 2;
    let _ = window.with_webview(|webview| unsafe {
        let wk_webview = &*webview.inner().cast::<AnyObject>();
        let scroll_view: *mut AnyObject = msg_send![wk_webview, scrollView];
        if let Some(scroll_view) = scroll_view.as_ref() {
            let _: () = msg_send![
                scroll_view,
                setContentInsetAdjustmentBehavior: UI_SCROLL_VIEW_CONTENT_INSET_ADJUSTMENT_NEVER
            ];
        }
    });
}

/// Files picked from the Files app are reachable only through a security-scoped
/// URL whose grant ends with the process. A bookmark is the persistent form of
/// that grant: the page stores it next to the document and resolves it after a
/// relaunch to reach the same file — even if it was renamed or moved since.
#[cfg(target_os = "ios")]
mod bookmarks {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2_foundation::{
        NSData, NSString, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions, NSURL,
    };

    pub struct Resolved {
        pub url: String,
        pub path: String,
        pub bookmark: String,
    }

    fn file_url(location: &str) -> Result<Retained<NSURL>, String> {
        if location.starts_with("file:") {
            NSURL::URLWithString(&NSString::from_str(location))
                .ok_or_else(|| format!("Not a file URL: {location}"))
        } else {
            Ok(NSURL::fileURLWithPath(&NSString::from_str(location)))
        }
    }

    fn bookmark_for(url: &NSURL) -> Result<String, String> {
        let data = url
            .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
                NSURLBookmarkCreationOptions(0),
                None,
                None,
            )
            .map_err(|error| error.localizedDescription().to_string())?;
        Ok(STANDARD.encode(data.to_vec()))
    }

    pub fn create(location: &str) -> Result<String, String> {
        let url = file_url(location)?;
        // Harmless when the picker already granted access; needed when it did not.
        unsafe { url.startAccessingSecurityScopedResource() };
        bookmark_for(&url)
    }

    pub fn resolve(bookmark: &str) -> Result<Resolved, String> {
        let bytes = STANDARD.decode(bookmark).map_err(|error| error.to_string())?;
        let data = NSData::with_bytes(&bytes);
        let mut stale = Bool::NO;
        let url = unsafe {
            NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                &data,
                NSURLBookmarkResolutionOptions(0),
                None,
                &mut stale,
            )
        }
        .map_err(|error| error.localizedDescription().to_string())?;
        if !unsafe { url.startAccessingSecurityScopedResource() } {
            return Err("Access to the file was not granted.".into());
        }
        let bookmark = if stale.as_bool() { bookmark_for(&url)? } else { bookmark.to_owned() };
        Ok(Resolved {
            url: url
                .absoluteString()
                .map(|value| value.to_string())
                .ok_or("The bookmarked file has no URL.")?,
            path: url
                .path()
                .map(|value| value.to_string())
                .ok_or("The bookmarked file has no path.")?,
            bookmark,
        })
    }
}

#[derive(serde::Serialize)]
struct ResolvedBookmark {
    url: String,
    bookmark: String,
}

#[tauri::command]
fn ipad_create_bookmark(location: String) -> Result<String, String> {
    #[cfg(target_os = "ios")]
    return bookmarks::create(&location);
    #[cfg(not(target_os = "ios"))]
    {
        let _ = location;
        Err("Bookmarks are only available on iOS.".into())
    }
}

#[tauri::command]
fn ipad_resolve_bookmark<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    bookmark: String,
) -> Result<ResolvedBookmark, String> {
    #[cfg(target_os = "ios")]
    {
        use tauri_plugin_fs::FsExt;
        let resolved = bookmarks::resolve(&bookmark)?;
        // The fs plugin's runtime scope does not survive a relaunch either.
        app.fs_scope()
            .allow_file(&resolved.path)
            .map_err(|error| error.to_string())?;
        Ok(ResolvedBookmark { url: resolved.url, bookmark: resolved.bookmark })
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, bookmark);
        Err("Bookmarks are only available on iOS.".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![ipad_create_bookmark, ipad_resolve_bookmark])
        .setup(|app| {
            #[cfg(target_os = "ios")]
            if let Some(window) = app.get_webview_window("main") {
                let_page_own_safe_area(&window);
            }
            #[cfg(not(target_os = "ios"))]
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running TikZ Editor for iPad");
}
