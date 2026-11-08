//! Image files beside a document: the bounded listing the insertion planner
//! reads, and the writes, moves and removals of an inserted image.

use base64::Engine;
use rfd::FileDialog;
use serde::Serialize;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

const MAX_DEPTH: usize = 2;
const MAX_ENTRIES: usize = 5000;
const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "pdf", "eps", "svg", "gif", "tif", "tiff", "bmp", "webp", "heic", "mps",
];

#[derive(Serialize)]
pub struct GraphicsListingFile {
    path: String,
    size: u64,
}

#[derive(Serialize)]
pub struct GraphicsListing {
    files: Vec<GraphicsListingFile>,
    directories: Vec<String>,
}

#[derive(Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum GraphicsWriteResult {
    Written {
        #[serde(rename = "createdDirectories")]
        created_directories: Vec<String>,
    },
    Exists,
}

fn skipped_directory(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules" || name.starts_with("_minted") || name == "__pycache__"
}

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| IMAGE_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str()))
}

fn relative(root: &Path, path: &Path) -> Option<String> {
    let parts: Vec<String> = path
        .strip_prefix(root)
        .ok()?
        .components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect();
    Some(parts.join("/"))
}

/// Image files and folders up to two levels below `directory`.
#[tauri::command]
pub fn desktop_list_graphics_files(directory: String) -> Result<GraphicsListing, String> {
    let root = PathBuf::from(directory);
    let mut listing = GraphicsListing { files: Vec::new(), directories: Vec::new() };
    let mut queue = vec![(root.clone(), 0usize)];
    let mut visited = 0usize;
    while let Some((folder, depth)) = queue.pop() {
        let Ok(entries) = fs::read_dir(&folder) else { continue };
        for entry in entries.flatten() {
            visited += 1;
            if visited > MAX_ENTRIES {
                return Ok(listing);
            }
            let path = entry.path();
            let Ok(kind) = entry.file_type() else { continue };
            let name = entry.file_name().to_string_lossy().to_string();
            if kind.is_dir() {
                if depth < MAX_DEPTH && !skipped_directory(&name) {
                    if let Some(relative) = relative(&root, &path) {
                        listing.directories.push(relative);
                    }
                    queue.push((path, depth + 1));
                }
            } else if kind.is_file() && !name.starts_with('.') && is_image(&path) {
                if let (Some(relative), Ok(metadata)) = (relative(&root, &path), entry.metadata()) {
                    listing.files.push(GraphicsListingFile { path: relative, size: metadata.len() });
                }
            }
        }
    }
    Ok(listing)
}

/// Folders `create_dir_all` would make for `path`'s parent, outermost first.
fn missing_directories(path: &Path) -> Vec<PathBuf> {
    let mut missing = Vec::new();
    let mut current = path.parent();
    while let Some(folder) = current {
        if folder.as_os_str().is_empty() || folder.exists() {
            break;
        }
        missing.push(folder.to_path_buf());
        current = folder.parent();
    }
    missing.reverse();
    missing
}

fn create_parent(path: &Path) -> Result<Vec<String>, String> {
    let missing = missing_directories(path);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    Ok(missing.iter().map(|folder| folder.to_string_lossy().to_string()).collect())
}

/// Write a new file, never replacing one.
#[tauri::command]
pub fn desktop_write_graphics_file(path: String, bytes_base64: String) -> Result<GraphicsWriteResult, String> {
    let target = PathBuf::from(path);
    if target.exists() {
        return Ok(GraphicsWriteResult::Exists);
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(bytes_base64)
        .map_err(|error| error.to_string())?;
    let created_directories = create_parent(&target)?;
    let mut file = match fs::OpenOptions::new().write(true).create_new(true).open(&target) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => return Ok(GraphicsWriteResult::Exists),
        Err(error) => return Err(error.to_string()),
    };
    file.write_all(&bytes).map_err(|error| error.to_string())?;
    Ok(GraphicsWriteResult::Written { created_directories })
}

/// Move an inserted image, never replacing a file.
#[tauri::command]
pub fn desktop_move_graphics_file(from: String, to: String) -> Result<GraphicsWriteResult, String> {
    let target = PathBuf::from(to);
    if target.exists() {
        return Ok(GraphicsWriteResult::Exists);
    }
    let created_directories = create_parent(&target)?;
    fs::rename(&from, &target).map_err(|error| error.to_string())?;
    Ok(GraphicsWriteResult::Written { created_directories })
}

/// Undo an insertion: remove the file it wrote, if it still has the size
/// written, then each folder it created, innermost first, while empty.
#[tauri::command]
pub fn desktop_remove_graphics_file(path: String, expected_size: u64, directories: Vec<String>) -> Result<(), String> {
    let target = PathBuf::from(path);
    match fs::metadata(&target) {
        Ok(metadata) if metadata.is_file() && metadata.len() == expected_size => {
            fs::remove_file(&target).map_err(|error| error.to_string())?;
        }
        Ok(_) => return Err("The image file has changed since it was saved.".to_string()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    for folder in directories.iter().rev() {
        // Fails, and is left alone, unless empty.
        let _ = fs::remove_dir(folder);
    }
    Ok(())
}

/// The system save panel, opened at the image's current place.
#[tauri::command]
pub fn desktop_choose_graphics_location(directory: String, name: String, extension: String) -> Option<String> {
    FileDialog::new()
        .set_directory(directory)
        .set_file_name(name)
        .add_filter(extension.to_ascii_uppercase(), &[extension.as_str()])
        .save_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_images_two_levels_deep_and_writes_without_replacing() {
        let root = std::env::temp_dir().join(format!("tikz-graphics-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("figs/week1/deep")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join("a.PNG"), b"x").unwrap();
        fs::write(root.join("notes.txt"), b"x").unwrap();
        fs::write(root.join("figs/week1/b.pdf"), b"xy").unwrap();
        fs::write(root.join("figs/week1/deep/c.png"), b"x").unwrap();
        fs::write(root.join(".git/d.png"), b"x").unwrap();
        let listing = desktop_list_graphics_files(root.to_string_lossy().to_string()).unwrap();
        let mut files: Vec<_> = listing.files.iter().map(|file| (file.path.clone(), file.size)).collect();
        files.sort();
        assert_eq!(files, vec![("a.PNG".to_string(), 1), ("figs/week1/b.pdf".to_string(), 2)]);

        let target = root.join("new/sub/e.png");
        let written = desktop_write_graphics_file(target.to_string_lossy().to_string(), "eA==".to_string()).unwrap();
        let GraphicsWriteResult::Written { created_directories } = written else { panic!("expected a write") };
        assert_eq!(created_directories.len(), 2);
        assert!(matches!(
            desktop_write_graphics_file(target.to_string_lossy().to_string(), "eA==".to_string()).unwrap(),
            GraphicsWriteResult::Exists
        ));
        desktop_remove_graphics_file(target.to_string_lossy().to_string(), 1, created_directories).unwrap();
        assert!(!root.join("new").exists());
        fs::remove_dir_all(&root).unwrap();
    }
}
