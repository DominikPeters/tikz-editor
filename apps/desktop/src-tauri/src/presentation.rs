use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewWindow};

#[cfg(target_os = "macos")]
pub fn install_display_observer(app: AppHandle) {
    use block2::RcBlock;
    use core::ptr::NonNull;
    use objc2_app_kit::NSApplicationDidChangeScreenParametersNotification;
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSOperationQueue};
    use tauri::Emitter;
    let block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        let _ = app.emit("presentation-displays-changed", ());
    });
    let observer = unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(NSApplicationDidChangeScreenParametersNotification),
            None,
            Some(&NSOperationQueue::mainQueue()),
            &block,
        )
    };
    // One observer for the app lifetime; session listeners are removed on stop.
    std::mem::forget(observer);
}

#[derive(Default)]
pub struct PresentationPowerState(Mutex<u32>);

#[cfg(target_os = "macos")]
fn set_power(state: &PresentationPowerState, active: bool) -> Result<(), String> {
    use objc2_foundation::NSString;
    use std::ffi::c_void;
    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        fn IOPMAssertionCreateWithName(
            kind: *const c_void,
            level: u32,
            name: *const c_void,
            id: *mut u32,
        ) -> i32;
        fn IOPMAssertionRelease(id: u32) -> i32;
    }
    let mut id = state.0.lock().map_err(|error| error.to_string())?;
    if active && *id == 0 {
        let kind = NSString::from_str("PreventUserIdleDisplaySleep");
        let name = NSString::from_str("TikZ Editor presentation");
        let result = unsafe {
            IOPMAssertionCreateWithName(
                (&*kind as *const NSString).cast(),
                255,
                (&*name as *const NSString).cast(),
                &mut *id,
            )
        };
        if result != 0 {
            return Err(format!("Could not prevent display sleep ({result})"));
        }
    } else if !active && *id != 0 {
        unsafe {
            IOPMAssertionRelease(*id);
        }
        *id = 0;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn set_power(state: &PresentationPowerState, active: bool) -> Result<(), String> {
    #[link(name = "kernel32")]
    extern "system" {
        fn SetThreadExecutionState(flags: u32) -> u32;
    }
    let mut held = state.0.lock().map_err(|error| error.to_string())?;
    if (*held != 0) == active {
        return Ok(());
    }
    let flags = 0x80000000 | if active { 0x00000001 | 0x00000002 } else { 0 };
    if unsafe { SetThreadExecutionState(flags) } == 0 {
        return Err("Could not prevent display sleep".into());
    }
    *held = u32::from(active);
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn set_power(state: &PresentationPowerState, active: bool) -> Result<(), String> {
    *state.0.lock().map_err(|error| error.to_string())? = u32::from(active);
    Ok(())
}

#[tauri::command]
pub async fn desktop_presentation_keep_awake(
    app: AppHandle,
    window: WebviewWindow,
    active: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the presentation controller manages display sleep".into());
    }
    // Windows execution-state assertions belong to the calling thread: acquire
    // and release on the same native UI thread, regardless of the IPC worker.
    let (send, receive) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = set_power(&handle.state::<PresentationPowerState>(), active);
        let _ = send.send(result);
    })
    .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn desktop_prepare_presentation_window(app: AppHandle, label: String) -> Result<(), String> {
    if !label.starts_with("presentation-audience-")
        && !label.starts_with("presentation-presenter-")
        && !label.starts_with("presentation-identifier-")
    {
        return Err("Invalid presentation window".into());
    }
    let window = app
        .get_webview_window(&label)
        .ok_or("Presentation window not found")?;
    #[cfg(not(target_os = "macos"))]
    if label.starts_with("presentation-audience-") || label.starts_with("presentation-identifier-")
    {
        window.remove_menu().map_err(|error| error.to_string())?;
    }
    #[cfg(target_os = "macos")]
    let _ = window;
    Ok(())
}

pub fn close_for_controller(app: &AppHandle) {
    if let Some(state) = app.try_state::<PresentationPowerState>() {
        let _ = set_power(&state, false);
    }
    for (label, window) in app.webview_windows() {
        if label.starts_with("presentation-") {
            let _ = window.destroy();
        }
    }
}
