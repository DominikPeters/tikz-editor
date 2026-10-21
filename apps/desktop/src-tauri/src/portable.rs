use std::path::{Path, PathBuf};
use tauri::AppHandle;

const PORTABLE_IDENTIFIER: &str = "com.tikz.editor.portable";
const DATA_DIRECTORY: &str = "tikz-editor-data";

pub fn is_portable(app: &AppHandle) -> bool {
    app.config().identifier == PORTABLE_IDENTIFIER
}

#[tauri::command]
pub fn desktop_is_portable(app: AppHandle) -> bool {
    is_portable(&app)
}

fn data_directory(executable: &Path) -> Result<PathBuf, String> {
    executable
        .parent()
        .map(|directory| directory.join(DATA_DIRECTORY))
        .ok_or_else(|| "Could not locate the portable executable's folder.".to_string())
}

/// Check storage before Tauri creates any windows, profiles or plugins. Portable
/// mode is baked into the configuration; deleting the data folder never disables it.
pub fn prepare(config: &tauri::Config) -> Result<(), String> {
    if config.identifier != PORTABLE_IDENTIFIER {
        return Ok(());
    }
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let directory = data_directory(&executable)?;
    prepare_data_directory(&directory)
}

fn prepare_data_directory(directory: &Path) -> Result<(), String> {
    std::fs::create_dir_all(directory).map_err(|error| {
        format!(
            "Could not create {}: {error}. Move TikZ Editor to a writable folder.",
            directory.display()
        )
    })?;
    tempfile::NamedTempFile::new_in(&directory).map_err(|error| {
        format!(
            "Portable data folder {} is not writable: {error}. Move TikZ Editor to a writable folder.",
            directory.display()
        )
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_follows_the_executable_even_in_a_shared_folder() {
        let folder = std::env::temp_dir().join("portable apps with spaces");
        assert_eq!(
            data_directory(&folder.join("renamed-editor.exe")).unwrap(),
            folder.join("tikz-editor-data")
        );
    }

    #[test]
    fn portable_config_has_an_independent_identity_and_dedicated_storage() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.portable.conf.json")).unwrap();
        assert_eq!(config["identifier"], PORTABLE_IDENTIFIER);
        assert_eq!(
            config["app"]["appDirectoriesOverride"],
            format!("./{DATA_DIRECTORY}")
        );
        assert_eq!(config["bundle"]["active"], false);
        assert_eq!(config["bundle"]["createUpdaterArtifacts"], false);
    }

    #[test]
    fn starting_with_existing_data_preserves_preferences_and_leaves_no_probe_files() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join(DATA_DIRECTORY);
        prepare_data_directory(&directory).unwrap();
        let settings = directory.join("settings.json");
        std::fs::write(&settings, "user preferences").unwrap();
        prepare_data_directory(&directory).unwrap();
        assert_eq!(
            std::fs::read_to_string(settings).unwrap(),
            "user preferences"
        );
        assert_eq!(std::fs::read_dir(directory).unwrap().count(), 1);
    }

    #[test]
    fn a_blocked_data_folder_reports_an_error_without_destroying_it() {
        let root = tempfile::tempdir().unwrap();
        let directory = root.path().join(DATA_DIRECTORY);
        std::fs::write(&directory, "existing file").unwrap();
        assert!(prepare_data_directory(&directory)
            .unwrap_err()
            .contains("writable folder"));
        assert_eq!(std::fs::read_to_string(directory).unwrap(), "existing file");
    }
}
