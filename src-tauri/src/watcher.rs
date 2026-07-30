#![allow(dead_code)]

use notify::{Watcher, RecursiveMode, RecommendedWatcher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

use std::collections::HashMap;
use std::time::Instant;
use std::sync::Arc;

#[derive(Clone)]
pub struct WatcherState {
    #[allow(dead_code)]
    pub watcher: Arc<Mutex<Option<RecommendedWatcher>>>,
    pub vault_path: Arc<Mutex<Option<PathBuf>>>,
    pub internal_writes: Arc<Mutex<HashMap<String, Instant>>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watcher: Arc::new(Mutex::new(None)),
            vault_path: Arc::new(Mutex::new(None)),
            internal_writes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn register_internal_write(&self, path: &str) {
        if let Ok(mut map) = self.internal_writes.lock() {
            let now = Instant::now();
            map.retain(|_, time| now.duration_since(*time).as_secs() < 5);
            let clean_path = path.replace('\\', "/").to_lowercase();
            map.insert(clean_path, now);
        }
    }

    pub fn is_recent_internal_write(&self, path: &str) -> bool {
        if let Ok(map) = self.internal_writes.lock() {
            let clean_path = path.replace('\\', "/").to_lowercase();
            if let Some(timestamp) = map.get(&clean_path) {
                if timestamp.elapsed().as_millis() < 800 {
                    return true;
                }
            }
        }
        false
    }
}

/// Helper to strip Windows UNC prefix (`\\?\`) and normalize path string
pub fn clean_canonical_path(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    let stripped = if s.starts_with(r"\\?\") {
        &s[4..]
    } else {
        &s
    };
    PathBuf::from(stripped)
}

/// Helper to verify that a target path is strictly within the currently watched vault directory.
pub fn is_path_in_vault(path_str: &str, state: &WatcherState) -> Result<(), String> {
    let vault_guard = state.vault_path.lock().map_err(|e| e.to_string())?;
    if let Some(ref vault_root) = *vault_guard {
        let clean_vault = clean_canonical_path(vault_root);
        let path = Path::new(path_str);
        
        // Clean and resolve path. If it doesn't exist, climb up parents until one exists to canonicalize.
        let mut target = clean_canonical_path(path);
        for ancestor in path.ancestors() {
            if ancestor.exists() {
                if let Ok(canonical) = ancestor.canonicalize() {
                    let clean_canon = clean_canonical_path(&canonical);
                    let remaining = path.strip_prefix(ancestor).unwrap_or_else(|_| Path::new(""));
                    if !remaining.as_os_str().is_empty() {
                        target = clean_canon.join(remaining);
                    } else {
                        target = clean_canon;
                    }
                    break;
                }
            }
        }
        
        if target.starts_with(&clean_vault) || clean_canonical_path(&target).starts_with(&clean_vault) {
            Ok(())
        } else {
            Err(format!(
                "Path access violation: target '{:?}' is outside vault boundary '{:?}'",
                target, clean_vault
            ))
        }
    } else {
        // If no vault path is watched yet, allow access (e.g. during initial vault setup picker)
        Ok(())
    }
}

#[derive(serde::Serialize, Clone)]
#[allow(dead_code)]
struct FileChangeEvent {
    path: String,
    kind: String,
}

#[tauri::command]
pub async fn watch_vault(
    app: AppHandle,
    state: State<'_, WatcherState>,
    vault_path: String,
) -> Result<(), String> {
    // 1. Unwatch existing first
    let mut guard = state.watcher.lock().map_err(|e| e.to_string())?;
    if let Some(watcher) = guard.take() {
        drop(watcher);
    }

    let path = Path::new(&vault_path);
    if !path.exists() {
        return Err("Vault path does not exist".to_string());
    }
    
    let canonical_vault_path = path.canonicalize().map_err(|e| e.to_string())?;
    let app_handle = app.clone();
    let watcher_state_clone = state.inner().clone();
    
    // 2. Create recommended watcher
    let mut watcher = notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
        if let Ok(event) = res {
            let kind_str = match event.kind {
                notify::EventKind::Create(_) => "create",
                notify::EventKind::Modify(_) => "modify",
                notify::EventKind::Remove(_) => "delete",
                _ => return, // ignore other events
            };

            for p in event.paths {
                let path_str = p.to_string_lossy().into_owned();
                
                // Suppress echo loops from app internal writes
                if watcher_state_clone.is_recent_internal_write(&path_str) {
                    continue;
                }

                // Exclude temp files or lock files (e.g. starting with . or in .vault-meta)
                let name = p.file_name().unwrap_or_default().to_string_lossy();
                if name.starts_with('.') || path_str.contains(".vault-meta") || path_str.contains(".git") {
                    continue;
                }

                let _ = app_handle.emit(
                    "vault_file_changed",
                    FileChangeEvent {
                        path: path_str,
                        kind: kind_str.to_string(),
                    },
                );
            }
        }
    })
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    // 3. Start watching
    watcher
        .watch(&canonical_vault_path, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory: {e}"))?;

    // 4. Store watcher and vault path in state
    *guard = Some(watcher);
    
    let mut path_guard = state.vault_path.lock().map_err(|e| e.to_string())?;
    *path_guard = Some(canonical_vault_path.clone());

    #[cfg(debug_assertions)]
    println!("Now watching vault at: {:?}", canonical_vault_path);
    Ok(())
}

#[tauri::command]
pub async fn unwatch_vault(state: State<'_, WatcherState>) -> Result<(), String> {
    let mut guard = state.watcher.lock().map_err(|e| e.to_string())?;
    if let Some(watcher) = guard.take() {
        drop(watcher);
    }
    
    let mut path_guard = state.vault_path.lock().map_err(|e| e.to_string())?;
    *path_guard = None;
    Ok(())
}

