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

/// The app runs on UIKit's scene life cycle (the `UIApplicationSceneManifest`
/// in `Info.ios.plist`), which apps built with the iOS 27 SDK must, while tao
/// stays in its classic mode: there it creates the editor's window before any
/// scene exists and never offers more windows (iPadOS's "new window" would
/// open an empty one). The scene delegate below gives that window to the
/// app's scene once both exist.
#[cfg(target_os = "ios")]
mod scenes {
    use objc2::runtime::{AnyClass, AnyObject, AnyProtocol, ClassBuilder, Sel};
    use objc2::{msg_send, sel};
    use std::ffi::CStr;
    use std::sync::atomic::{AtomicPtr, Ordering};

    /// The class `Info.ios.plist` names for the app's scene.
    const DELEGATE_CLASS: &CStr = c"TikzEditorSceneDelegate";

    static EDITOR_WINDOW: AtomicPtr<AnyObject> = AtomicPtr::new(std::ptr::null_mut());
    static EDITOR_SCENE: AtomicPtr<AnyObject> = AtomicPtr::new(std::ptr::null_mut());

    /// Registers the delegate class; UIKit looks it up by name when the
    /// scene connects, after launch.
    pub fn register_delegate() {
        let Some(superclass) = AnyClass::get(c"UIResponder") else { return };
        let Some(mut builder) = ClassBuilder::new(DELEGATE_CLASS, superclass) else { return };
        if let Some(protocol) = AnyProtocol::get(c"UIWindowSceneDelegate") {
            builder.add_protocol(protocol);
        }
        unsafe {
            builder.add_method(
                sel!(scene:willConnectToSession:options:),
                scene_will_connect as unsafe extern "C-unwind" fn(_, _, _, _, _),
            );
            builder.add_method(
                sel!(sceneDidDisconnect:),
                scene_did_disconnect as unsafe extern "C-unwind" fn(_, _, _),
            );
        }
        builder.register();
    }

    unsafe extern "C-unwind" fn scene_will_connect(
        _this: &AnyObject,
        _cmd: Sel,
        scene: *mut AnyObject,
        _session: *mut AnyObject,
        _options: *mut AnyObject,
    ) {
        if scene.is_null() {
            return;
        }
        let _: *mut AnyObject = unsafe { msg_send![scene, retain] };
        let previous = EDITOR_SCENE.swap(scene, Ordering::SeqCst);
        if !previous.is_null() {
            let _: () = unsafe { msg_send![previous, release] };
        }
        unsafe { attach() };
    }

    unsafe extern "C-unwind" fn scene_did_disconnect(_this: &AnyObject, _cmd: Sel, scene: *mut AnyObject) {
        if EDITOR_SCENE.compare_exchange(scene, std::ptr::null_mut(), Ordering::SeqCst, Ordering::SeqCst).is_ok() {
            let _: () = unsafe { msg_send![scene, release] };
        }
    }

    /// The UIWindow tao made for the editor (the web view's window).
    pub unsafe fn remember_editor_window(window: *mut AnyObject) {
        if window.is_null() {
            return;
        }
        let _: *mut AnyObject = unsafe { msg_send![window, retain] };
        let previous = EDITOR_WINDOW.swap(window, Ordering::SeqCst);
        if !previous.is_null() {
            let _: () = unsafe { msg_send![previous, release] };
        }
        unsafe { attach() };
    }

    /// Main thread only, like everything UIKit.
    unsafe fn attach() {
        let window = EDITOR_WINDOW.load(Ordering::SeqCst);
        let scene = EDITOR_SCENE.load(Ordering::SeqCst);
        if window.is_null() || scene.is_null() {
            return;
        }
        unsafe {
            let current: *mut AnyObject = msg_send![window, windowScene];
            if current != scene {
                let _: () = msg_send![window, setWindowScene: scene];
            }
            let _: () = msg_send![window, makeKeyAndVisible];
        }
    }
}

/// A projector or monitor, by cable or AirPlay: UIKit connects a scene with
/// the non-interactive external-display role (`Info.ios.plist`). It gets a
/// window only while a presentation shows its slides there; otherwise the
/// iPad's screen is mirrored as usual. The slide is a plain web view showing
/// the image the page sends (`ipad_external_show`), and the page hears of the
/// display coming and going through the `ipad-external-display` event.
#[cfg(target_os = "ios")]
mod external_display {
    use objc2::runtime::{AnyClass, AnyObject, AnyProtocol, Bool, ClassBuilder, Sel};
    use objc2::{class, msg_send, sel};
    use objc2_foundation::NSString;
    use std::ffi::CStr;
    use std::sync::atomic::{AtomicPtr, Ordering};
    use std::sync::OnceLock;
    use tauri::Emitter;

    /// The class `Info.ios.plist` names for the external display's scene.
    const DELEGATE_CLASS: &CStr = c"TikzEditorExternalDisplayDelegate";
    pub const EVENT: &str = "ipad-external-display";
    /// UIScrollViewContentInsetAdjustmentNever
    const INSET_ADJUSTMENT_NEVER: isize = 2;

    static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
    static SCENE: AtomicPtr<AnyObject> = AtomicPtr::new(std::ptr::null_mut());
    static WINDOW: AtomicPtr<AnyObject> = AtomicPtr::new(std::ptr::null_mut());
    static WEBVIEW: AtomicPtr<AnyObject> = AtomicPtr::new(std::ptr::null_mut());

    pub fn set_app(app: tauri::AppHandle) {
        let _ = APP.set(app);
    }

    pub fn connected() -> bool {
        !SCENE.load(Ordering::SeqCst).is_null()
    }

    fn announce(connected: bool) {
        if let Some(app) = APP.get() {
            let _ = app.emit(EVENT, connected);
        }
    }

    pub fn register_delegate() {
        let Some(superclass) = AnyClass::get(c"UIResponder") else { return };
        let Some(mut builder) = ClassBuilder::new(DELEGATE_CLASS, superclass) else { return };
        if let Some(protocol) = AnyProtocol::get(c"UIWindowSceneDelegate") {
            builder.add_protocol(protocol);
        }
        unsafe {
            builder.add_method(
                sel!(scene:willConnectToSession:options:),
                scene_will_connect as unsafe extern "C-unwind" fn(_, _, _, _, _),
            );
            builder.add_method(
                sel!(sceneDidDisconnect:),
                scene_did_disconnect as unsafe extern "C-unwind" fn(_, _, _),
            );
        }
        builder.register();
    }

    unsafe extern "C-unwind" fn scene_will_connect(
        _this: &AnyObject,
        _cmd: Sel,
        scene: *mut AnyObject,
        _session: *mut AnyObject,
        _options: *mut AnyObject,
    ) {
        if scene.is_null() {
            return;
        }
        unsafe {
            let _: *mut AnyObject = msg_send![scene, retain];
            let previous = SCENE.swap(scene, Ordering::SeqCst);
            if !previous.is_null() {
                remove_window();
                let _: () = msg_send![previous, release];
            }
        }
        announce(true);
    }

    unsafe extern "C-unwind" fn scene_did_disconnect(_this: &AnyObject, _cmd: Sel, scene: *mut AnyObject) {
        if SCENE.compare_exchange(scene, std::ptr::null_mut(), Ordering::SeqCst, Ordering::SeqCst).is_ok() {
            unsafe {
                remove_window();
                let _: () = msg_send![scene, release];
            }
            announce(false);
        }
    }

    /// Shows `src` (an image URL, the slide) on the display, filling it on
    /// `background`; `None` shows the background alone. Main thread only.
    pub unsafe fn show(src: Option<&str>, background: &str) {
        let scene = SCENE.load(Ordering::SeqCst);
        if scene.is_null() {
            return;
        }
        let webview = unsafe { ensure_window(scene) };
        if webview.is_null() {
            return;
        }
        let color = if background == "white" { "#fff" } else { "#000" };
        // The URL comes from encodeURIComponent: no quote can end the attribute.
        let image = src
            .filter(|src| !src.contains('"'))
            .map(|src| format!(r#"<img src="{src}" alt="">"#))
            .unwrap_or_default();
        let html = format!(
            r#"<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{{margin:0;height:100%;overflow:hidden;background:{color}}}img{{display:block;width:100%;height:100%;object-fit:contain}}</style></head><body>{image}</body></html>"#
        );
        let html = NSString::from_str(&html);
        unsafe {
            let _: *mut AnyObject = msg_send![webview, loadHTMLString: &*html, baseURL: std::ptr::null_mut::<AnyObject>()];
        }
    }

    /// Takes the slide off the display: the iPad's screen is mirrored again.
    pub unsafe fn hide() {
        unsafe { remove_window() };
    }

    unsafe fn ensure_window(scene: *mut AnyObject) -> *mut AnyObject {
        let existing = WEBVIEW.load(Ordering::SeqCst);
        if !existing.is_null() {
            return existing;
        }
        unsafe {
            let black: *mut AnyObject = msg_send![class!(UIColor), blackColor];
            let webview: *mut AnyObject = msg_send![class!(WKWebView), new];
            let _: () = msg_send![webview, setOpaque: Bool::NO];
            let _: () = msg_send![webview, setBackgroundColor: black];
            let scroll_view: *mut AnyObject = msg_send![webview, scrollView];
            if !scroll_view.is_null() {
                let _: () = msg_send![scroll_view, setScrollEnabled: Bool::NO];
                let _: () = msg_send![scroll_view, setBackgroundColor: black];
                let _: () = msg_send![scroll_view, setContentInsetAdjustmentBehavior: INSET_ADJUSTMENT_NEVER];
            }
            let controller: *mut AnyObject = msg_send![class!(UIViewController), new];
            let _: () = msg_send![controller, setView: webview];
            let window: *mut AnyObject = msg_send![class!(UIWindow), alloc];
            let window: *mut AnyObject = msg_send![window, initWithWindowScene: scene];
            let _: () = msg_send![window, setBackgroundColor: black];
            let _: () = msg_send![window, setRootViewController: controller];
            let _: () = msg_send![controller, release];
            // Shown, but never key: typing stays with the editor.
            let _: () = msg_send![window, setHidden: Bool::NO];
            WINDOW.store(window, Ordering::SeqCst);
            WEBVIEW.store(webview, Ordering::SeqCst);
            webview
        }
    }

    unsafe fn remove_window() {
        let window = WINDOW.swap(std::ptr::null_mut(), Ordering::SeqCst);
        let webview = WEBVIEW.swap(std::ptr::null_mut(), Ordering::SeqCst);
        unsafe {
            if !window.is_null() {
                let _: () = msg_send![window, setHidden: Bool::YES];
                let _: () = msg_send![window, release];
            }
            if !webview.is_null() {
                let _: () = msg_send![webview, release];
            }
        }
    }
}

#[tauri::command]
fn ipad_external_display_connected() -> bool {
    #[cfg(target_os = "ios")]
    return external_display::connected();
    #[cfg(not(target_os = "ios"))]
    false
}

/// Shows a slide (an image URL) on the external display, or only its
/// background when `src` is null.
#[tauri::command]
fn ipad_external_show<R: tauri::Runtime>(app: tauri::AppHandle<R>, src: Option<String>, background: String) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    return app
        .run_on_main_thread(move || unsafe { external_display::show(src.as_deref(), &background) })
        .map_err(|error| error.to_string());
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, src, background);
        Ok(())
    }
}

#[tauri::command]
fn ipad_external_hide<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    return app
        .run_on_main_thread(|| unsafe { external_display::hide() })
        .map_err(|error| error.to_string());
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Ok(())
    }
}

/// Keeps the display from dimming and locking while a presentation runs.
#[tauri::command]
fn ipad_keep_awake<R: tauri::Runtime>(app: tauri::AppHandle<R>, active: bool) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        // UIKit: main thread only.
        app.run_on_main_thread(move || unsafe {
            use objc2::runtime::{AnyObject, Bool};
            use objc2::{class, msg_send};
            let application: *mut AnyObject = msg_send![class!(UIApplication), sharedApplication];
            if let Some(application) = application.as_ref() {
                let _: () = msg_send![application, setIdleTimerDisabled: Bool::new(active)];
            }
        })
        .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, active);
        Ok(())
    }
}

/// While the slides fill the screen: no status bar, and the home indicator
/// fades until the screen is touched near it.
#[tauri::command]
fn ipad_full_screen<R: tauri::Runtime>(window: tauri::WebviewWindow<R>, active: bool) -> Result<(), String> {
    #[cfg(target_os = "ios")]
    {
        // with_webview runs on the main thread. The view controller is tao's,
        // which keeps both preferences and asks UIKit to apply them.
        window
            .with_webview(move |webview| unsafe {
                use objc2::runtime::{AnyObject, Bool};
                use objc2::msg_send;
                let controller = webview.view_controller().cast::<AnyObject>();
                if let Some(controller) = controller.as_ref() {
                    let _: () = msg_send![controller, setPrefersStatusBarHidden: Bool::new(active)];
                    let _: () = msg_send![controller, setPrefersHomeIndicatorAutoHidden: Bool::new(active)];
                }
            })
            .map_err(|error| error.to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (window, active);
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "ios")]
    {
        scenes::register_delegate();
        external_display::register_delegate();
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            ipad_create_bookmark,
            ipad_resolve_bookmark,
            ipad_keep_awake,
            ipad_full_screen,
            ipad_external_display_connected,
            ipad_external_show,
            ipad_external_hide
        ])
        .setup(|app| {
            #[cfg(target_os = "ios")]
            external_display::set_app(app.handle().clone());
            #[cfg(target_os = "ios")]
            if let Some(window) = app.get_webview_window("main") {
                let_page_own_safe_area(&window);
                let _ = window.with_webview(|webview| unsafe {
                    use objc2::msg_send;
                    use objc2::runtime::AnyObject;
                    let wk_webview = &*webview.inner().cast::<AnyObject>();
                    let ui_window: *mut AnyObject = msg_send![wk_webview, window];
                    scenes::remember_editor_window(ui_window);
                });
            }
            #[cfg(not(target_os = "ios"))]
            let _ = app;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running TikZ Editor for iPad");
}
