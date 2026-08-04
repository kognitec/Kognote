use serde::{Deserialize, Serialize};
use rayon::prelude::*;
use walkdir::WalkDir;
use regex::Regex;
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScannedTask {
    pub id: String,
    pub note_path: String,
    pub note_name: String,
    pub content: String,
    pub completed: bool,
    pub line_number: usize,
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub raw_due_date: Option<String>,
    pub tags: Vec<String>,
    pub priority: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScannedDateReference {
    pub id: String,
    pub note_path: String,
    pub note_name: String,
    pub date: String,
    pub context: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultScanResult {
    pub tasks: Vec<ScannedTask>,
    pub date_refs: Vec<ScannedDateReference>,
}

pub fn is_ignored_path(norm: &str) -> bool {
    norm.contains("/archived/") || norm.contains("/archive/") || norm.ends_with("/archived") || norm.ends_with("/archive")
    || norm.contains("/trash/") || norm.contains("/.deleted/") || norm.ends_with("/trash") || norm.ends_with("/.deleted")
    || norm.contains("/templates/") || norm.contains("/template/") || norm.ends_with("/templates") || norm.ends_with("/template")
}

#[tauri::command]
pub fn scan_vault_tasks(vault_path: String) -> Result<VaultScanResult, String> {
    let vault_dir = Path::new(&vault_path);
    if !vault_dir.exists() {
        return Err("Vault path does not exist".to_string());
    }

    // Collect all markdown file paths in vault
    let file_paths: Vec<String> = WalkDir::new(vault_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let path_str = e.path().to_string_lossy().to_string();
            let norm = path_str.to_lowercase().replace('\\', "/");
            if norm.ends_with(".md") && !is_ignored_path(&norm) {
                Some(path_str)
            } else {
                None
            }
        })
        .collect();

    // Parallel scan over all collected files using Rayon thread pool
    let scan_results: Vec<(Vec<ScannedTask>, Vec<ScannedDateReference>)> = file_paths
        .par_iter()
        .filter_map(|path_str| {
            let path = Path::new(path_str);
            let text = fs::read_to_string(path).ok()?;
            
            // Check storage annotations in text
            let text_lower = text.to_lowercase();
            if text_lower.contains("storage: \"archived\"") || text_lower.contains("storage: 'archived'")
            || text_lower.contains("storage: \"deleted\"") || text_lower.contains("storage: 'deleted'")
            || text_lower.contains("type: \"template\"") || text_lower.contains("type: 'template'") {
                return None;
            }

            let file_name = path.file_name()?.to_string_lossy().to_string();
            let note_name = file_name.trim_end_matches(".md").to_string();
            
            let mut tasks = Vec::new();
            let mut date_refs = Vec::new();

            // Regex patterns using raw hashes
            let checkbox_re = Regex::new(r#"^\s*[-*]\s*\[([ xX])\]\s+(.+)$"#).ok()?;
            let tag_re = Regex::new(r#"(?:^|\s|\\)#([a-zA-Z0-9_\-/]+)"#).ok()?;
            let date_mention_re = Regex::new(r#"@?(20\d{2}[-/]\d{2}[-/]\d{2})(?:T(\d{2}:\d{2}))?"#).ok()?;
            let due_re = Regex::new(r#"(?m)^due:\s*["']?([^"\r\n]+)["']?"#).ok()?;
            let date_sub_re = Regex::new(r#"^(20\d{2}[-/]\d{2}[-/]\d{2})"#).ok()?;

            // Frontmatter due date extraction
            if text.starts_with("---") {
                if let Some(end_fm) = text[3..].find("---") {
                    let fm_text = &text[3..3 + end_fm];
                    if let Some(caps) = due_re.captures(fm_text) {
                        let raw_due = caps.get(1).map_or("", |m| m.as_str()).trim();
                        if let Some(dcaps) = date_sub_re.captures(raw_due) {
                            let std_date = dcaps.get(1).map_or("", |m| m.as_str()).replace('/', "-");
                            date_refs.push(ScannedDateReference {
                                id: format!("{}:frontmatter:{}", path_str, std_date),
                                note_path: path_str.clone(),
                                note_name: note_name.clone(),
                                date: std_date,
                                context: format!("Kanban Due: {}", note_name),
                            });
                        }
                    }
                }
            }

            // Line by line scanning
            for (idx, line) in text.lines().enumerate() {
                if line.trim().is_empty() {
                    continue;
                }

                if let Some(caps) = checkbox_re.captures(line) {
                    let mark = caps.get(1).map_or(" ", |m| m.as_str());
                    let completed = mark == "x" || mark == "X";
                    let mut content = caps.get(2).map_or("", |m| m.as_str()).to_string();

                    // Priority check
                    let mut priority = "none".to_string();
                    let content_lower = content.to_lowercase();
                    if content.contains("!!!") || content.contains("🔴") || content_lower.contains("priority:high") {
                        priority = "high".to_string();
                    } else if content.contains("!!") || content.contains("🟡") || content_lower.contains("priority:medium") {
                        priority = "medium".to_string();
                    } else if content.contains('!') || content.contains("🔵") || content_lower.contains("priority:low") {
                        priority = "low".to_string();
                    }

                    // Extract tags
                    let mut tags = Vec::new();
                    for tcap in tag_re.captures_iter(&content) {
                        if let Some(tag_match) = tcap.get(1) {
                            tags.push(tag_match.as_str().to_string());
                        }
                    }

                    // Extract due date in task
                    let mut due_date = None;
                    let mut due_time = None;
                    let mut raw_due_date = None;

                    if let Some(dcaps) = date_mention_re.captures(&content) {
                        if let Some(dm) = dcaps.get(1) {
                            let std_date = dm.as_str().replace('/', "-");
                            due_date = Some(std_date.clone());
                            raw_due_date = Some(dm.as_str().to_string());

                            if let Some(tm) = dcaps.get(2) {
                                due_time = Some(tm.as_str().to_string());
                            }

                            // Clean date string out of task text
                            content = date_mention_re.replace(&content, "").trim().to_string();
                        }
                    }

                    let task_id = format!("{}:line:{}", path_str, idx);

                    tasks.push(ScannedTask {
                        id: task_id,
                        note_path: path_str.clone(),
                        note_name: note_name.clone(),
                        content,
                        completed,
                        line_number: idx,
                        due_date,
                        due_time,
                        raw_due_date,
                        tags,
                        priority,
                    });
                }
            }

            Some((tasks, date_refs))
        })
        .collect();

    // Flatten parallel results
    let mut all_tasks = Vec::new();
    let mut all_date_refs = Vec::new();

    for (tasks, date_refs) in scan_results {
        all_tasks.extend(tasks);
        all_date_refs.extend(date_refs);
    }

    Ok(VaultScanResult {
        tasks: all_tasks,
        date_refs: all_date_refs,
    })
}
