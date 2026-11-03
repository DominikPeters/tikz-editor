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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
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
