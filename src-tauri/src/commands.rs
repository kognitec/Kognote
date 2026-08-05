use std::fs;
use std::io::Write;
use std::path::Path;
use crate::watcher::{WatcherState, is_path_in_vault};
use crate::db::{DbState, insert_note_version, with_conn};
use rusqlite::params;
use similar::{ChangeTag, TextDiff};
use sha2::{Sha256, Digest};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

#[derive(serde::Serialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub modified_at: u64,
    pub created_at: u64,
    pub children: Option<Vec<FileEntry>>,
}

/// Recursively traverses a folder and returns its files and folders.
fn walk_dir(dir_path: &Path) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
    if dir_path.is_dir() {
        for entry in fs::read_dir(dir_path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let name = path.file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned();

            // Ignore hidden files/folders (e.g. .git, .vault-meta)
            if name.starts_with('.') {
                continue;
            }

            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            let is_dir = metadata.is_dir();

            let modified_at = metadata.modified()
                .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64)
                .unwrap_or(0);
            let created_at = metadata.created()
                .map(|t| t.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64)
                .unwrap_or(modified_at);

            let children = if is_dir {
                Some(walk_dir(&path)?)
            } else {
                None
            };

            let name_lower = name.to_lowercase();
            let is_allowed_file = is_dir 
                || name_lower.ends_with(".md") 
                || name_lower.ends_with(".excalidraw")
                || name_lower.ends_with(".pdf")
                || name_lower.ends_with(".png")
                || name_lower.ends_with(".jpg")
                || name_lower.ends_with(".jpeg")
                || name_lower.ends_with(".webp")
                || name_lower.ends_with(".gif")
                || name_lower.ends_with(".svg")
                || name_lower.ends_with(".mp3")
                || name_lower.ends_with(".wav")
                || name_lower.ends_with(".m4a")
                || name_lower.ends_with(".mp4")
                || name_lower.ends_with(".mov");

            if is_allowed_file {
                entries.push(FileEntry {
                    name,
                    path: path.to_string_lossy().into_owned(),
                    is_dir,
                    modified_at,
                    created_at,
                    children,
                });
            }
        }
    }
    // Sort: directories first, then alphabetical by name
    entries.sort_by(|a, b| {
        if a.is_dir == b.is_dir {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        } else if a.is_dir {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });
    Ok(entries)
}

#[tauri::command]
pub fn list_vault_files(vault_path: String) -> Result<Vec<FileEntry>, String> {
    let path = Path::new(&vault_path);
    if !path.exists() {
        return Err("Vault path does not exist".to_string());
    }
    walk_dir(path)
}

#[tauri::command]
pub fn read_note(
    path: String,
    watcher_state: tauri::State<'_, WatcherState>,
) -> Result<String, String> {
    is_path_in_vault(&path, &watcher_state)?;
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err("File not found".to_string());
    }

    let bytes = fs::read(file_path).map_err(|e| e.to_string())?;
    let raw = String::from_utf8(bytes).map_err(|e| format!("Invalid UTF-8: {}", e))?;

    // Automatically strip any residual HTML comment IDs (<!-- id: xxxxxxxx ... -->)
    let comment_regex = regex::Regex::new(r"\s*<!--\s*id:\s*[a-f0-9]{8}.*?-->").unwrap();
    let cleaned = comment_regex.replace_all(&raw, "").to_string();
    Ok(cleaned)
}

fn atomic_write_file(target_path: &Path, content: &[u8]) -> Result<(), String> {
    let parent = target_path.parent().ok_or_else(|| "Invalid parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;

    let file_name = target_path.file_name().unwrap_or_default().to_string_lossy();
    let tmp_path = parent.join(format!(".{}.tmp.{}", file_name, rand::random::<u32>()));

    let mut attempts = 0;
    loop {
        match fs::File::create(&tmp_path).and_then(|mut f| f.write_all(content).and_then(|_| f.sync_all())) {
            Ok(_) => break,
            Err(_e) if attempts < 3 => {
                attempts += 1;
                std::thread::sleep(std::time::Duration::from_millis(50 * attempts as u64));
            }
            Err(e) => {
                let _ = fs::remove_file(&tmp_path);
                return Err(format!("Atomic write failed: {e}"));
            }
        }
    }

    fs::rename(&tmp_path, target_path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("Atomic rename failed: {e}")
    })
}

#[tauri::command]
pub fn write_note(
    path: String,
    content: String,
    watcher_state: tauri::State<'_, WatcherState>,
    db_state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    is_path_in_vault(&path, &watcher_state)?;
    let file_path = Path::new(&path);
    
    // Ensure parent directory exists
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // --- Delta versioning logic ---
    let old_content = if file_path.exists() {
        match fs::read(file_path) {
            Ok(bytes) => String::from_utf8(bytes).unwrap_or_default(),
            Err(_) => String::new(),
        }
    } else {
        String::new()
    };

    // Calculate checksum of the new content
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let checksum = format!("{:x}", hasher.finalize());

    // Generate unified patch diff using similar
    let diff = TextDiff::from_lines(&old_content, &content);
    let mut patch = String::new();
    for change in diff.iter_all_changes() {
        let tag = match change.tag() {
            ChangeTag::Delete => "-",
            ChangeTag::Insert => "+",
            ChangeTag::Equal => " ",
        };
        patch.push_str(&format!("{}{}", tag, change.value()));
    }

    // Insert version into DB
    let _ = insert_note_version(&db_state, &path, &patch, &checksum);
    // --- End delta versioning logic ---

    atomic_write_file(file_path, content.as_bytes())?;
    watcher_state.register_internal_write(&path);
    Ok(())
}

#[tauri::command]
pub fn create_note(
    path: String,
    watcher_state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    is_path_in_vault(&path, &watcher_state)?;
    let file_path = Path::new(&path);
    if file_path.exists() {
        return Err("File already exists".to_string());
    }
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(file_path, "").map_err(|e| e.to_string())?;
    watcher_state.register_internal_write(&path);
    Ok(())
}

#[tauri::command]
pub fn create_folder(
    path: String,
    watcher_state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    is_path_in_vault(&path, &watcher_state)?;
    let dir_path = Path::new(&path);
    if dir_path.exists() {
        return Err("Directory already exists".to_string());
    }
    fs::create_dir_all(dir_path).map_err(|e| e.to_string())?;
    watcher_state.register_internal_write(&path);
    Ok(())
}

#[tauri::command]
pub fn delete_note(
    path: String,
    watcher_state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    is_path_in_vault(&path, &watcher_state)?;
    let target_path = Path::new(&path);
    if !target_path.exists() {
        return Err("Target path not found".to_string());
    }
    if target_path.is_dir() {
        fs::remove_dir_all(target_path).map_err(|e| e.to_string())?;
    } else {
        fs::remove_file(target_path).map_err(|e| e.to_string())?;
    }
    watcher_state.register_internal_write(&path);
    Ok(())
}

#[tauri::command]
pub fn purge_expired_trash(
    vault_path: String,
    max_age_hours: Option<u64>,
    max_age_days: Option<u64>,
) -> Result<usize, String> {
    let trash_dir = Path::new(&vault_path).join("Trash");
    if !trash_dir.exists() || !trash_dir.is_dir() {
        return Ok(0);
    }

    let now = std::time::SystemTime::now();
    let max_age_secs = if let Some(hours) = max_age_hours {
        hours * 3600
    } else if let Some(days) = max_age_days {
        days * 86400
    } else {
        24 * 3600 // Default: 24 hours
    };
    let mut purged_count = 0;

    if let Ok(entries) = fs::read_dir(trash_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if let Ok(metadata) = path.metadata() {
                let modified = metadata.modified().unwrap_or(now);
                if let Ok(elapsed) = now.duration_since(modified) {
                    if elapsed.as_secs() >= max_age_secs {
                        if path.is_dir() {
                            let _ = fs::remove_dir_all(&path);
                        } else {
                            let _ = fs::remove_file(&path);
                        }
                        purged_count += 1;
                    }
                }
            }
        }
    }

    Ok(purged_count)
}

#[tauri::command]
pub fn rename_note(
    old_path: String,
    new_path: String,
    watcher_state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    is_path_in_vault(&old_path, &watcher_state)?;
    is_path_in_vault(&new_path, &watcher_state)?;
    let source = Path::new(&old_path);
    let destination = Path::new(&new_path);
    if !source.exists() {
        return Err("Source path not found".to_string());
    }
    if destination.exists() {
        return Err("Destination path already exists".to_string());
    }
    fs::rename(source, destination).map_err(|e| e.to_string())?;
    watcher_state.register_internal_write(&old_path);
    watcher_state.register_internal_write(&new_path);
    Ok(())
}


#[tauri::command]
pub async fn fetch_ical(url: String) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let response = client
        .get(&url)
        .header("User-Agent", "Kognote/1.0")
        .send()
        .await
        .map_err(|e| format!("Network request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Server returned error status: {}", response.status()));
    }

    response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))
}

#[tauri::command]
pub fn fs_exists(
    path: String,
    watcher_state: tauri::State<'_, WatcherState>,
) -> bool {
    if is_path_in_vault(&path, &watcher_state).is_err() {
        return false;
    }
    std::path::Path::new(&path).exists()
}

#[tauri::command]
pub fn fs_mkdir(
    path: String,
    watcher_state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    is_path_in_vault(&path, &watcher_state)?;
    let p = std::path::Path::new(&path);
    if !p.exists() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn fs_write(
    path: String,
    content: String,
    watcher_state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    is_path_in_vault(&path, &watcher_state)?;
    std::fs::write(std::path::Path::new(&path), content).map_err(|e| e.to_string())?;
    watcher_state.register_internal_write(&path);
    Ok(())
}

#[tauri::command]
pub fn fs_read(
    path: String,
    watcher_state: tauri::State<'_, WatcherState>,
) -> Result<String, String> {
    is_path_in_vault(&path, &watcher_state)?;
    std::fs::read_to_string(std::path::Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn fs_write_base64(
    path: String,
    data: String,
    watcher_state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    is_path_in_vault(&path, &watcher_state)?;
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| format!("Base64 decode error: {}", e))?;
    // Ensure parent directory exists
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(std::path::Path::new(&path), bytes).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn fs_copy(
    src: String,
    dest: String,
    watcher_state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    is_path_in_vault(&dest, &watcher_state)?;
    // Ensure parent directory of destination exists
    if let Some(parent) = std::path::Path::new(&dest).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn reveal_in_finder(
    path: String,
    watcher_state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    is_path_in_vault(&path, &watcher_state)?;
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err("File does not exist".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(file_path)
            .status()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let clean_str = file_path.to_string_lossy().trim_start_matches(r"\\?\").replace('/', "\\");
        std::process::Command::new("explorer")
            .arg(format!("/select,\"{clean_str}\""))
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .status()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = file_path.parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .status()
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn open_with_default(
    app: AppHandle,
    path: String,
    watcher_state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    is_path_in_vault(&path, &watcher_state)?;
    let file_path = Path::new(&path);
    if !file_path.exists() {
        return Err("File does not exist".to_string());
    }

    app.opener()
        .open_path(&path, None::<&str>)
        .map_err(|e| format!("Failed to open file: {e}"))
}

#[tauri::command]
pub fn sweep_orphaned_attachments(
    vault_path: String,
    watcher_state: tauri::State<'_, WatcherState>,
) -> Result<Vec<String>, String> {
    is_path_in_vault(&vault_path, &watcher_state)?;
    let vault = Path::new(&vault_path);
    let attachments_dir = vault.join("Attachments");
    
    if !attachments_dir.exists() || !attachments_dir.is_dir() {
        return Ok(Vec::new());
    }

    // 1. Gather all files in Attachments
    let mut attachment_files = Vec::new();
    for entry in fs::read_dir(&attachments_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() {
            if let Some(filename) = path.file_name() {
                attachment_files.push(filename.to_string_lossy().to_string());
            }
        }
    }

    if attachment_files.is_empty() {
        return Ok(Vec::new());
    }

    // 2. Scan all markdown files in the vault
    let mut md_files = Vec::new();
    fn collect_md_files(dir: &Path, files: &mut Vec<std::path::PathBuf>) -> Result<(), String> {
        if dir.is_dir() {
            for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
                if name.starts_with('.') || name == "Attachments" || name == "Daily Logs" {
                    continue;
                }
                if path.is_dir() {
                    collect_md_files(&path, files)?;
                } else if name.to_lowercase().ends_with(".md") {
                    files.push(path);
                }
            }
        }
        Ok(())
    }
    collect_md_files(vault, &mut md_files)?;

    // 3. Read markdown files and check references
    let mut referenced_attachments = std::collections::HashSet::new();
    for md_path in md_files {
        if let Ok(content) = fs::read_to_string(md_path) {
            for attachment in &attachment_files {
                if content.contains(attachment) {
                    referenced_attachments.insert(attachment.clone());
                }
            }
        }
    }

    // 4. Filter out referenced attachments to get orphans
    let orphans: Vec<String> = attachment_files
        .into_iter()
        .filter(|file| !referenced_attachments.contains(file))
        .collect();

    Ok(orphans)
}

#[tauri::command]
pub async fn parse_note_metadata(content: String) -> Result<crate::parser::ParsedMetadata, String> {
    tokio::task::spawn_blocking(move || {
        Ok(crate::parser::parse_markdown(&content))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn sync_note_blocks(
    state: tauri::State<'_, DbState>,
    file_path: String,
    content: String,
    watcher_state: tauri::State<'_, WatcherState>,
) -> Result<String, String> {
    is_path_in_vault(&file_path, &watcher_state)?;
    
    // Parse into blocks
    let mut blocks = crate::parser::parse_markdown_to_blocks(&file_path, &content);

    // Save to SQLite blocks table incrementally
    with_conn(&state, |conn| {
        // Find existing blocks for this note to build a list of current IDs and contents
        let mut stmt = conn.prepare("SELECT block_id, content, ai_processed, status, due_date FROM blocks WHERE parent_note_id = ?1")
            .map_err(|e| e.to_string())?;
        
        let mut existing_blocks = std::collections::HashMap::new();
        let rows = stmt.query_map([&file_path], |row| {
            Ok((
                row.get::<_, String>(0)?, 
                (
                    row.get::<_, String>(1)?, 
                    row.get::<_, i32>(2)?, 
                    row.get::<_, Option<String>>(3)?, 
                    row.get::<_, Option<String>>(4)?
                )
            ))
        }).map_err(|e| e.to_string())?;

        for r in rows {
            if let Ok((id, val)) = r {
                existing_blocks.insert(id, val);
            }
        }

        // Delete blocks not present in the new set
        let parsed_ids: std::collections::HashSet<String> = blocks.iter().map(|b| b.block_id.clone()).collect();
        for id in existing_blocks.keys() {
            if !parsed_ids.contains(id) {
                conn.execute("DELETE FROM blocks WHERE block_id = ?1", [id]).map_err(|e| e.to_string())?;
            }
        }

        // Insert or update blocks
        for block in &mut blocks {
            let mut ai_processed = 0;
            if let Some((old_content, old_processed, old_status, old_due)) = existing_blocks.get(&block.block_id) {
                if &block.content == old_content {
                    ai_processed = *old_processed;
                    block.status = old_status.clone();
                    block.due_date = old_due.clone();
                    crate::parser::update_block_markdown(block);
                }
            }

            conn.execute(
                "INSERT INTO blocks (block_id, parent_note_id, block_type, content, status, due_date, raw_markdown, position_index, ai_processed)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                 ON CONFLICT(block_id) DO UPDATE SET
                    block_type = excluded.block_type,
                    content = excluded.content,
                    status = excluded.status,
                    due_date = excluded.due_date,
                    raw_markdown = excluded.raw_markdown,
                    position_index = excluded.position_index,
                    ai_processed = excluded.ai_processed",
                params![
                    block.block_id,
                    block.parent_note_id,
                    block.block_type,
                    block.content,
                    block.status,
                    block.due_date,
                    block.raw_markdown,
                    block.position_index,
                    ai_processed,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    })?;

    // Reconstruct updated markdown (now that status/due_date are preserved for unchanged blocks)
    let updated_content = blocks
        .iter()
        .map(|b| b.raw_markdown.as_str())
        .collect::<Vec<&str>>()
        .join("\n\n");

    // Write updated note file with stable block IDs back to disk
    std::fs::write(&file_path, &updated_content).map_err(|e| e.to_string())?;
    // Register the write with the watcher so it does NOT emit a vault_file_changed event
    watcher_state.register_internal_write(&file_path);

    Ok(updated_content)
}

#[tauri::command]
pub async fn update_block_status(
    state: tauri::State<'_, DbState>,
    block_id: String,
    status: String,
    watcher_state: tauri::State<'_, WatcherState>,
) -> Result<(), String> {
    // Fetch block and update it
    let mut block = with_conn(&state, |conn| {
        let mut stmt = conn.prepare(
            "SELECT block_id, parent_note_id, block_type, content, status, due_date, raw_markdown, position_index
             FROM blocks WHERE block_id = ?1"
        ).map_err(|e| e.to_string())?;

        let mut rows = stmt.query_map([&block_id], |row| {
            Ok(crate::parser::Block {
                block_id: row.get(0)?,
                parent_note_id: row.get(1)?,
                block_type: row.get(2)?,
                content: row.get(3)?,
                status: row.get(4)?,
                due_date: row.get(5)?,
                raw_markdown: row.get(6)?,
                position_index: row.get(7)?,
            })
        }).map_err(|e| e.to_string())?;

        if let Some(r) = rows.next() {
            r.map_err(|e| e.to_string())
        } else {
            Err("Block not found".to_string())
        }
    })?;

    is_path_in_vault(&block.parent_note_id, &watcher_state)?;

    block.status = Some(status.clone());
    if block.block_type == "task" {
        let is_done = status.to_lowercase() == "done";
        let checkbox_regex = regex::Regex::new(r"^(\s*[-*]\s*\[)([ xX])(\]\s+.+)$").unwrap();
        if checkbox_regex.is_match(&block.raw_markdown) {
            block.raw_markdown = checkbox_regex
                .replace(&block.raw_markdown, |caps: &regex::Captures| {
                    format!("{}{}{}", &caps[1], if is_done { "x" } else { " " }, &caps[3])
                })
                .to_string();
        }
    }
    crate::parser::update_block_markdown(&mut block);

    // Save block updates and reconstruct document
    with_conn(&state, |conn| {
        conn.execute(
            "UPDATE blocks SET status = ?1, raw_markdown = ?2 WHERE block_id = ?3",
            params![block.status, block.raw_markdown, block.block_id],
        )
        .map_err(|e| e.to_string())?;

        // Reconstruct note file
        let mut stmt = conn.prepare(
            "SELECT raw_markdown FROM blocks WHERE parent_note_id = ?1 ORDER BY position_index ASC"
        ).map_err(|e| e.to_string())?;

        let rows = stmt.query_map([&block.parent_note_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;

        let mut md_lines = Vec::new();
        for r in rows {
            md_lines.push(r.map_err(|e| e.to_string())?);
        }
        let reconstructed = md_lines.join("\n\n");

        std::fs::write(&block.parent_note_id, reconstructed).map_err(|e| e.to_string())?;
        // Register the write so the watcher doesn't emit a spurious vault_file_changed event
        watcher_state.register_internal_write(&block.parent_note_id);

        Ok(())
    })?;

    Ok(())
}

#[tauri::command]
pub async fn run_block_query(
    state: tauri::State<'_, DbState>,
    query: String,
) -> Result<Vec<serde_json::Value>, String> {
    // Basic SELECT injection safety check
    if !query.trim().to_uppercase().starts_with("SELECT") {
        return Err("Only read-only SELECT queries are allowed".to_string());
    }

    with_conn(&state, |conn| {
        let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
        let col_count = stmt.column_count();
        let col_names: Vec<String> = stmt.column_names().iter().map(|n| n.to_string()).collect();

        let mut rows = stmt.query([]).map_err(|e| e.to_string())?;
        let mut results = Vec::new();

        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let mut map = serde_json::Map::new();
            for i in 0..col_count {
                let name = &col_names[i];
                let val = match row.get_ref(i).map_err(|e| e.to_string())? {
                    rusqlite::types::ValueRef::Null => serde_json::Value::Null,
                    rusqlite::types::ValueRef::Integer(n) => serde_json::Value::Number(n.into()),
                    rusqlite::types::ValueRef::Real(f) => {
                        if let Some(num) = serde_json::Number::from_f64(f) {
                            serde_json::Value::Number(num)
                        } else {
                            serde_json::Value::Null
                        }
                    }
                    rusqlite::types::ValueRef::Text(t) => serde_json::Value::String(String::from_utf8_lossy(t).into_owned()),
                    rusqlite::types::ValueRef::Blob(b) => {
                        use base64::Engine;
                        serde_json::Value::String(base64::engine::general_purpose::STANDARD.encode(b))
                    }
                };
                map.insert(name.clone(), val);
            }
            results.push(serde_json::Value::Object(map));
        }
        Ok(results)
    })
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ScannedNoteDelta {
    pub path: String,
    pub name: String,
    pub modified_at: u64,
    pub content: String,
    pub metadata: crate::parser::ParsedMetadata,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
pub struct ScanDeltaResult {
    pub updated: Vec<ScannedNoteDelta>,
    pub deleted_paths: Vec<String>,
    pub total_files: usize,
}

#[tauri::command]
pub fn scan_vault_delta(
    vault_path: String,
    known_mtimes: std::collections::HashMap<String, u64>,
) -> Result<ScanDeltaResult, String> {
    let root = Path::new(&vault_path);
    if !root.exists() || !root.is_dir() {
        return Err("Vault path does not exist or is not a directory".to_string());
    }

    let mut disk_paths = std::collections::HashSet::new();
    let mut updated = Vec::new();
    let mut total_files = 0;

    let mut stack = vec![root.to_path_buf()];

    while let Some(current_dir) = stack.pop() {
        if let Ok(dir_entries) = fs::read_dir(&current_dir) {
            for entry in dir_entries.flatten() {
                let path = entry.path();
                let name = path.file_name().unwrap_or_default().to_string_lossy();
                
                // Skip hidden folders/files starting with '.'
                if name.starts_with('.') {
                    continue;
                }

                if path.is_dir() {
                    stack.push(path);
                } else if path.is_file() {
                    let path_str = path.to_string_lossy().to_string();
                    let is_md = name.ends_with(".md");
                    if is_md {
                        total_files += 1;
                        disk_paths.insert(path_str.clone());

                        let disk_mtime = if let Ok(meta) = path.metadata() {
                            meta.modified()
                                .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                                .duration_since(std::time::SystemTime::UNIX_EPOCH)
                                .map(|d| d.as_millis() as u64)
                                .unwrap_or(0)
                        } else {
                            0
                        };

                        let cached_mtime = known_mtimes.get(&path_str).cloned().unwrap_or(0);

                        // If file is new or modified on disk, parse natively in Rust
                        if disk_mtime == 0 || disk_mtime > cached_mtime {
                            if let Ok(content) = fs::read_to_string(&path) {
                                let metadata = crate::parser::parse_markdown(&content);
                                updated.push(ScannedNoteDelta {
                                    path: path_str,
                                    name: name.to_string(),
                                    modified_at: disk_mtime,
                                    content,
                                    metadata,
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // Find deleted files that exist in known_mtimes but no longer on disk
    let mut deleted_paths = Vec::new();
    for (known_path, _) in known_mtimes.iter() {
        if !disk_paths.contains(known_path) {
            deleted_paths.push(known_path.clone());
        }
    }

    Ok(ScanDeltaResult {
        updated,
        deleted_paths,
        total_files,
    })
}
