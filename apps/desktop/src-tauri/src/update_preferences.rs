use tauri::AppHandle;
#[cfg(not(target_os = "windows"))]
use tauri::Manager;

// Shared with windows/update-checks.nsh and windows/update-checks.wxs.
#[cfg(target_os = "windows")]
const REGISTRY_KEY: &str = r"Software\TikZEditor\Preferences";
#[cfg(target_os = "windows")]
const REGISTRY_VALUE: &str = "AutomaticUpdateChecks";

#[tauri::command]
pub fn desktop_reset_automatic_update_checks(app: AppHandle) -> Result<bool, String> {
    let enabled = true;
    desktop_set_automatic_update_checks(app, enabled)?;
    Ok(enabled)
}

#[tauri::command]
pub fn desktop_get_automatic_update_checks(app: AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        let key = match winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
            .open_subkey(REGISTRY_KEY)
        {
            Ok(key) => key,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(true),
            Err(error) => return Err(error.to_string()),
        };
        match key.get_value::<String, _>(REGISTRY_VALUE) {
            Ok(value) => Ok(value == "1"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(true),
            Err(error) => Err(error.to_string()),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let path = app
            .path()
            .app_config_dir()
            .map_err(|e| e.to_string())?
            .join("automatic-update-checks.json");
        match std::fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(true),
            Err(error) => Err(error.to_string()),
        }
    }
}

#[tauri::command]
pub fn desktop_set_automatic_update_checks(app: AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        let (key, _) = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
            .create_subkey(REGISTRY_KEY)
            .map_err(|e| e.to_string())?;
        key.set_value(REGISTRY_VALUE, &if enabled { "1" } else { "0" })
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let directory = app.path().app_config_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        std::fs::write(
            directory.join("automatic-update-checks.json"),
            if enabled { "true" } else { "false" },
        )
        .map_err(|e| e.to_string())
    }
}
