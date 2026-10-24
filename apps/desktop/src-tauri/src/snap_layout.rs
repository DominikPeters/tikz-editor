//! Snap Layouts for the self-drawn Windows title bar
//! (design/native-windows-look.md, phase 6).
//!
//! Windows 11 offers its Snap Layouts flyout when the pointer rests on a
//! window's maximise button, which it finds by hit-testing: `WM_NCHITTEST`
//! must answer `HTMAXBUTTON`. Our maximise button is HTML inside the webview,
//! so a transparent native child window is laid over it and answers for it.
//! That window then owns the pointer: it maximises or restores on click and
//! reports hover to the page, which draws the button's hover state.
//!
//! Adapted from tauri-plugin-snap-layout,
//! https://github.com/Hyph-M/tauri-plugin-snap-layout, under the MIT License:
//! Copyright (c) 2026 Hyph-M, (c) 2024 clarifei, (c) 2024 Siddharth.
//! Permission is hereby granted, free of charge, to any person obtaining a copy
//! of this software and associated documentation files, to deal in the
//! Software without restriction, subject to including this notice.

use serde::Deserialize;

/// The maximise button's box in CSS pixels, relative to the window's client area.
#[derive(Clone, Copy, Debug, Deserialize)]
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub struct ButtonBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// Places the Snap Layouts window over the maximise button, or removes it.
#[tauri::command]
pub fn desktop_set_maximize_button_bounds(
    window: tauri::WebviewWindow,
    bounds: Option<ButtonBounds>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        windows_impl::set_bounds(&window, bounds)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, bounds);
        Ok(())
    }
}

#[cfg(target_os = "windows")]
mod windows_impl {
    use super::ButtonBounds;
    use tauri::{Emitter, WebviewWindow};
    use windows_sys::Win32::{
        Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM},
        UI::{
            HiDpi::GetDpiForWindow,
            Input::KeyboardAndMouse::{TrackMouseEvent, TME_LEAVE, TME_NONCLIENT, TRACKMOUSEEVENT},
            Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{
                CreateWindowExW, DestroyWindow, GetPropW, IsWindow, IsZoomed, LoadCursorW,
                RemovePropW, SendMessageW, SetCursor, SetPropW, SetWindowPos, HTMAXBUTTON,
                IDC_ARROW, SC_MAXIMIZE, SC_RESTORE, SWP_NOACTIVATE, WM_NCDESTROY, WM_NCHITTEST,
                WM_NCLBUTTONDOWN, WM_NCLBUTTONUP, WM_NCMOUSELEAVE, WM_SETCURSOR, WM_SYSCOMMAND,
                WS_CHILD, WS_VISIBLE,
            },
        },
    };

    const HOVER_EVENT: &str = "desktop-maximize-button-hover";
    const SUBCLASS_ID: usize = 0x7469_6b7a_736e;

    fn wide(text: &str) -> Vec<u16> {
        text.encode_utf16().chain(std::iter::once(0)).collect()
    }

    struct OverlayState {
        hovering: bool,
        parent: HWND,
        report_hover: Box<dyn Fn(bool) + Send + Sync>,
    }

    pub fn set_bounds(window: &WebviewWindow, bounds: Option<ButtonBounds>) -> Result<(), String> {
        // HWND is not Send; carry it to the main thread as an integer.
        let parent = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
        let emitter = window.clone();
        window
            .run_on_main_thread(move || unsafe {
                let parent = parent as HWND;
                if IsWindow(parent) == 0 {
                    return;
                }
                let child_prop = wide("TikzEditorSnapChild");
                let child = GetPropW(parent, child_prop.as_ptr()) as HWND;
                let Some(bounds) = bounds else {
                    if !child.is_null() {
                        RemovePropW(parent, child_prop.as_ptr());
                        DestroyWindow(child);
                    }
                    return;
                };
                // CSS pixels are device-independent pixels at the window's DPI.
                let dpi = GetDpiForWindow(parent) as f64;
                let scale = |value: f64| (value * dpi / 96.0).round() as i32;
                let (x, y, width, height) =
                    (scale(bounds.x), scale(bounds.y), scale(bounds.width), scale(bounds.height));
                if !child.is_null() {
                    SetWindowPos(child, std::ptr::null_mut(), x, y, width, height, SWP_NOACTIVATE);
                    return;
                }
                let class = wide("STATIC");
                let child = CreateWindowExW(
                    0,
                    class.as_ptr(),
                    std::ptr::null(),
                    WS_CHILD | WS_VISIBLE,
                    x,
                    y,
                    width,
                    height,
                    parent,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null(),
                );
                if child.is_null() {
                    return;
                }
                SetPropW(parent, child_prop.as_ptr(), child as HANDLE);
                let state = Box::into_raw(Box::new(OverlayState {
                    hovering: false,
                    parent,
                    report_hover: Box::new(move |hovered| {
                        let _ = emitter.emit_to(emitter.label(), HOVER_EVENT, hovered);
                    }),
                }));
                SetWindowSubclass(child, Some(overlay_proc), SUBCLASS_ID, state as usize);
            })
            .map_err(|error| error.to_string())
    }

    unsafe extern "system" fn overlay_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        subclass_id: usize,
        ref_data: usize,
    ) -> LRESULT {
        let state = ref_data as *mut OverlayState;
        match msg {
            WM_NCDESTROY => {
                RemoveWindowSubclass(hwnd, Some(overlay_proc), subclass_id);
                if !state.is_null() {
                    ((*state).report_hover)(false);
                    drop(Box::from_raw(state));
                }
                return DefSubclassProc(hwnd, msg, wparam, lparam);
            }
            WM_NCHITTEST if !state.is_null() => {
                let state = &mut *state;
                if !state.hovering {
                    state.hovering = true;
                    (state.report_hover)(true);
                    let mut track = TRACKMOUSEEVENT {
                        cbSize: std::mem::size_of::<TRACKMOUSEEVENT>() as u32,
                        dwFlags: TME_LEAVE | TME_NONCLIENT,
                        hwndTrack: hwnd,
                        dwHoverTime: 0,
                    };
                    TrackMouseEvent(&mut track);
                }
                return HTMAXBUTTON as LRESULT;
            }
            WM_NCMOUSELEAVE if !state.is_null() => {
                let state = &mut *state;
                if state.hovering {
                    state.hovering = false;
                    (state.report_hover)(false);
                }
            }
            WM_NCLBUTTONDOWN if wparam == HTMAXBUTTON as usize => return 0,
            WM_NCLBUTTONUP if wparam == HTMAXBUTTON as usize && !state.is_null() => {
                let parent = (*state).parent;
                let command = if IsZoomed(parent) != 0 { SC_RESTORE } else { SC_MAXIMIZE };
                SendMessageW(parent, WM_SYSCOMMAND, command as WPARAM, 0);
                return 0;
            }
            WM_SETCURSOR => {
                SetCursor(LoadCursorW(std::ptr::null_mut(), IDC_ARROW));
                return 1;
            }
            _ => {}
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }
}
