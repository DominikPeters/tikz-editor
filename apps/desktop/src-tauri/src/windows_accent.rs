//! The Windows accent colour, for the Windows look's `--control-accent`
//! (design/native-windows-look.md, phase 5).
//!
//! Windows keeps the shades of the accent in
//! `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Accent\AccentPalette`:
//! eight RGBA quadruples, light 3, light 2, light 1, the accent, dark 1,
//! dark 2, dark 3 and one unused. WinUI fills accent controls with dark 1 in
//! the light theme and light 2 in the dark one.

/// The palette as `#rrggbb` strings, lightest first; `None` where there is
/// none (other systems, or the value is missing).
#[tauri::command]
pub fn desktop_accent_palette() -> Option<Vec<String>> {
    #[cfg(target_os = "windows")]
    {
        let key = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
            .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent")
            .ok()?;
        let palette = key.get_raw_value("AccentPalette").ok()?;
        if palette.bytes.len() < 28 {
            return None;
        }
        Some(
            palette.bytes.chunks_exact(4).take(7)
                .map(|rgba| format!("#{:02x}{:02x}{:02x}", rgba[0], rgba[1], rgba[2]))
                .collect(),
        )
    }
    #[cfg(not(target_os = "windows"))]
    {
        None
    }
}
