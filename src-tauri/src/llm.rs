use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::process::{Child, Command};
use std::io::Write;
use futures_util::StreamExt;
use sha2::{Sha256, Digest};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Emitter};

// ─────────────────────────────────────────────────────────────────────────────
// Model registry — source URLs and expected SHA256 hashes
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct ModelInfo {
    pub id: &'static str,
    pub display_name: &'static str,
    pub url: &'static str,
    pub filename: &'static str,
    pub size_bytes: u64,
    /// Optional SHA256 hash of the file for integrity verification (hex string)
    #[allow(dead_code)]
    pub sha256: Option<&'static str>,
}

pub const MODELS: &[ModelInfo] = &[
    ModelInfo {
        id: "llama3.2",
        display_name: "Llama 3.2 (3B)",
        url: "https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        filename: "Llama-3.2-3B-Instruct-Q4_K_M.gguf",
        size_bytes: 2_019_377_696,
        sha256: Some("6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff"),
    },
    ModelInfo {
        id: "qwen3:8b",
        display_name: "Qwen3 (8B)",
        url: "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf",
        filename: "Qwen3-8B-Q4_K_M.gguf",
        size_bytes: 5_027_783_488,
        sha256: Some("d98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785"),
    },
];

fn find_model(id: &str) -> Option<&'static ModelInfo> {
    MODELS.iter().find(|m| m.id == id)
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM state — wraps optional child llama-server process
// ─────────────────────────────────────────────────────────────────────────────

pub struct LlmState {
    pub server_process: Mutex<Option<Child>>,
    pub current_model_id: Mutex<Option<String>>,
    pub server_port: u16,
}

impl LlmState {
    pub fn new() -> Self {
        Self {
            server_process: Mutex::new(None),
            current_model_id: Mutex::new(None),
            server_port: 11435, // Avoid collision with Ollama's 11434
        }
    }
}

impl Drop for LlmState {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.server_process.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: models directory
// ─────────────────────────────────────────────────────────────────────────────

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    let models = data_dir.join("models");
    std::fs::create_dir_all(&models)
        .map_err(|e| format!("Cannot create models directory: {e}"))?;
    Ok(models)
}

// ─────────────────────────────────────────────────────────────────────────────
// Tauri Commands
// ─────────────────────────────────────────────────────────────────────────────

/// List available models with download status.
#[derive(Serialize)]
pub struct ModelStatus {
    pub id: String,
    pub display_name: String,
    pub downloaded: bool,
    pub size_bytes: u64,
    pub file_size_bytes: u64, // actual downloaded bytes on disk (0 if not downloaded)
}

#[tauri::command]
pub async fn llm_list_models(app: AppHandle) -> Result<Vec<ModelStatus>, String> {
    let dir = models_dir(&app)?;
    let mut result = Vec::new();
    for m in MODELS {
        let path = dir.join(m.filename);
        let file_size_bytes = if path.exists() {
            std::fs::metadata(&path)
                .map(|meta| meta.len())
                .unwrap_or(0)
        } else {
            0
        };
        let downloaded = file_size_bytes > 0 && file_size_bytes >= m.size_bytes.saturating_sub(1024 * 1024);
        result.push(ModelStatus {
            id: m.id.to_string(),
            display_name: m.display_name.to_string(),
            downloaded,
            size_bytes: m.size_bytes,
            file_size_bytes,
        });
    }
    Ok(result)
}

/// Check if a specific model GGUF is already on disk.
#[tauri::command]
pub async fn llm_check_model(app: AppHandle, model_id: String) -> Result<bool, String> {
    let info = find_model(&model_id).ok_or_else(|| format!("Unknown model: {model_id}"))?;
    let path = models_dir(&app)?.join(info.filename);
    if !path.exists() {
        return Ok(false);
    }
    let size = std::fs::metadata(&path)
        .map(|m| m.len())
        .unwrap_or(0);
    Ok(size >= info.size_bytes.saturating_sub(1024 * 1024))
}

/// Download a model GGUF from Hugging Face to the app data directory.
/// Emits "llm_download_progress" events with { model_id, percent, downloaded_bytes, total_bytes }.
#[tauri::command]
pub async fn llm_download_model(
    app: AppHandle,
    model_id: String,
) -> Result<String, String> {
    let info = find_model(&model_id)
        .ok_or_else(|| format!("Unknown model ID: {model_id}"))?;

    let out_path = models_dir(&app)?.join(info.filename);

    // If already fully downloaded, skip
    if out_path.exists() {
        let size = std::fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0);
        if size >= info.size_bytes.saturating_sub(1024 * 1024) {
            app.emit("llm_download_progress", serde_json::json!({
                "model_id": model_id,
                "percent": 100,
                "downloaded_bytes": size,
                "total_bytes": info.size_bytes,
                "status": "already_downloaded"
            })).ok();
            return Ok(out_path.to_string_lossy().into_owned());
        }
    }

    // Support resume: check existing partial download
    let existing_bytes = if out_path.exists() {
        std::fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0)
    } else {
        0
    };

    // Build HTTP client with connection timeout and keepalive
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .tcp_keepalive(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let mut req = client.get(info.url);
    if existing_bytes > 0 {
        req = req.header("Range", format!("bytes={}-", existing_bytes));
    }

    let response = req
        .send()
        .await
        .map_err(|e| format!("Download request failed: {e}"))?;

    let status = response.status();
    if !status.is_success() && status.as_u16() != 206 {
        return Err(format!("Server returned status {status}"));
    }

    let content_length = response.content_length().unwrap_or(0);
    let total_bytes = if existing_bytes > 0 && content_length > 0 {
        existing_bytes + content_length
    } else if content_length > 0 {
        content_length
    } else {
        info.size_bytes
    };

    // Open file for append (or create)
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(existing_bytes > 0)
        .write(true)
        .open(&out_path)
        .map_err(|e| format!("Cannot open output file: {e}"))?;

    let mut downloaded = existing_bytes;
    let mut last_percent: u8 = 0;
    let mut hasher = Sha256::new();
    let mut stream = response.bytes_stream();
    let model_id_clone = model_id.clone();

    loop {
        // Wrap next chunk retrieval in a 30 second timeout to prevent stalling
        let next_chunk = tokio::time::timeout(tokio::time::Duration::from_secs(30), stream.next()).await;
        match next_chunk {
            Err(_) => return Err("Download stalled: no data received for 30 seconds".to_string()),
            Ok(None) => break, // Stream completed
            Ok(Some(chunk_result)) => {
                let chunk = chunk_result.map_err(|e| format!("Download stream error: {e}"))?;
                hasher.update(&chunk);
                file.write_all(&chunk).map_err(|e| format!("File write error: {e}"))?;
                downloaded += chunk.len() as u64;

                let percent = if total_bytes > 0 {
                    ((downloaded as f64 / total_bytes as f64) * 100.0).min(99.0) as u8
                } else {
                    0
                };

                if percent != last_percent {
                    last_percent = percent;
                    app.emit("llm_download_progress", serde_json::json!({
                        "model_id": model_id_clone,
                        "percent": percent,
                        "downloaded_bytes": downloaded,
                        "total_bytes": total_bytes,
                        "status": "downloading"
                    })).ok();
                }
            }
        }
    }

    // Final flush
    file.flush().map_err(|e| format!("File flush error: {e}"))?;
    drop(file);

    // Final SHA256 integrity verification (only if downloading the whole file from scratch)
    if existing_bytes == 0 {
        if let Some(expected_hash) = info.sha256 {
            let computed_hash = format!("{:x}", hasher.finalize());
            if computed_hash != expected_hash {
                // Delete the corrupted file
                let _ = std::fs::remove_file(&out_path);
                return Err(format!(
                    "Integrity check failed. Expected SHA256: {}, got: {}. Model file deleted.",
                    expected_hash, computed_hash
                ));
            }
        }
    }

    // Emit 100%
    app.emit("llm_download_progress", serde_json::json!({
        "model_id": model_id,
        "percent": 100,
        "downloaded_bytes": downloaded,
        "total_bytes": total_bytes,
        "status": "complete"
    })).ok();

    Ok(out_path.to_string_lossy().into_owned())
}

/// Delete a downloaded model to free disk space.
#[tauri::command]
pub async fn llm_delete_model(app: AppHandle, model_id: String) -> Result<(), String> {
    let info = find_model(&model_id).ok_or_else(|| format!("Unknown model: {model_id}"))?;
    let path = models_dir(&app)?.join(info.filename);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Cannot delete model file: {e}"))?;
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Inference via llama-server (OpenAI-compatible REST API)
// ─────────────────────────────────────────────────────────────────────────────

fn is_valid_llama_server(path: &PathBuf) -> bool {
    if !path.exists() {
        return false;
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(parent) = path.parent() {
            let has_dll = parent.join("llama-server-impl.dll").exists()
                       || parent.join("llama.dll").exists()
                       || parent.join("ggml.dll").exists();
            if has_dll {
                return true;
            }
        }
    }
    if let Ok(meta) = std::fs::metadata(path) {
        // On macOS/Linux, llama-server is a standalone binary (> 500 KB)
        if meta.len() > 500_000 {
            return true;
        }
    }
    false
}

/// Finds llama-server binary — checks Homebrew/system paths first, then app data and bundled sidecars.
fn find_llama_server(app: &AppHandle) -> Result<PathBuf, String> {
    // 1. Check common Homebrew and system locations first
    let system_candidates: &[&str] = &[
        "/opt/homebrew/bin/llama-server",
        "/usr/local/bin/llama-server",
        "/usr/bin/llama-server",
    ];

    for path in system_candidates {
        let p = PathBuf::from(path);
        if is_valid_llama_server(&p) {
            return Ok(p);
        }
    }

    // 2. Check inside app data dir
    if let Ok(data_dir) = app.path().app_data_dir() {
        let app_data_candidates = [
            data_dir.join("bin/llama-server.exe"),
            data_dir.join("bin/llama-server-x86_64-pc-windows-msvc.exe"),
            data_dir.join("llama-server.exe"),
            data_dir.join("bin/llama-server"),
            data_dir.join("llama-server"),
        ];
        for c in &app_data_candidates {
            if is_valid_llama_server(c) {
                return Ok(c.clone());
            }
        }
    }

    // 3. Check inside app bundle resources & target-triple candidates
    if let Ok(resource_dir) = app.path().resource_dir() {
        let bundled_candidates = [
            resource_dir.join("llama-server"),
            resource_dir.join("llama-server.exe"),
            resource_dir.join("bin/llama-server"),
            resource_dir.join("bin/llama-server.exe"),
            resource_dir.join("bin/llama-server-aarch64-apple-darwin"),
            resource_dir.join("bin/llama-server-x86_64-apple-darwin"),
            resource_dir.join("bin/llama-server-x86_64-pc-windows-msvc.exe"),
        ];
        for c in &bundled_candidates {
            if is_valid_llama_server(c) {
                return Ok(c.clone());
            }
        }
    }

    // 4. Check system PATH via `which` / `where`, filtering out target/debug mock binaries
    #[cfg(not(windows))]
    let which_output = std::process::Command::new("which")
        .arg("-a")
        .arg("llama-server")
        .output();
    #[cfg(windows)]
    let which_output = {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("where")
            .arg("llama-server")
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .output()
    };

    if let Ok(out) = which_output {
        if out.status.success() {
            let output_str = String::from_utf8_lossy(&out.stdout);
            for line in output_str.lines() {
                let path_str = line.trim();
                if !path_str.is_empty() && !path_str.contains("target/debug") && !path_str.contains("target/release") {
                    let p = PathBuf::from(path_str);
                    if is_valid_llama_server(&p) {
                        return Ok(p);
                    }
                }
            }
        }
    }

    Err(
        "llama-server not found. To use local AI:\n\
        • Windows: place llama-server.exe in %APPDATA%\\com.kognitec.kognote\\bin\\\n\
        • macOS: run `brew install llama.cpp` in Terminal\n\
        • Download: https://github.com/ggml-org/llama.cpp/releases".into()
    )
}

/// Helper: Automatically download and extract llama-server runtime binaries if missing.
pub async fn ensure_llama_server(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = find_llama_server(app) {
        return Ok(path);
    }

    let bin_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?
        .join("bin");

    std::fs::create_dir_all(&bin_dir)
        .map_err(|e| format!("Cannot create bin directory: {e}"))?;

    // Platform release ZIP containing prebuilt llama-server
    #[cfg(target_os = "windows")]
    let runtime_url = "https://github.com/ggml-org/llama.cpp/releases/download/b4800/llama-b4800-bin-win-cpu-x64.zip";

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    let runtime_url = "https://github.com/ggml-org/llama.cpp/releases/download/b4800/llama-b4800-bin-macos-arm64.zip";

    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    let runtime_url = "https://github.com/ggml-org/llama.cpp/releases/download/b4800/llama-b4800-bin-macos-x64.zip";

    #[cfg(target_os = "linux")]
    let runtime_url = "https://github.com/ggml-org/llama.cpp/releases/download/b4800/llama-b4800-bin-ubuntu-x64.zip";

    app.emit("llm_download_progress", serde_json::json!({
        "model_id": "llama-runtime",
        "percent": 0,
        "downloaded_bytes": 0,
        "total_bytes": 0,
        "status": "downloading_runtime"
    })).ok();

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .tcp_keepalive(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let response = client.get(runtime_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download llama-server runtime from {runtime_url}: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Downloading runtime failed with HTTP {}", response.status()));
    }

    let bytes = response.bytes().await.map_err(|e| format!("Failed to read runtime zip: {e}"))?;

    let reader = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| format!("Zip archive error: {e}"))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| format!("Zip file index error: {e}"))?;
        let raw_name = file.name().to_string();

        if raw_name.ends_with('/') || raw_name.contains("__MACOSX") {
            continue;
        }

        let filename = match std::path::Path::new(&raw_name).file_name() {
            Some(name) => name,
            None => continue,
        };

        let outpath = bin_dir.join(filename);

        let mut outfile = std::fs::File::create(&outpath)
            .map_err(|e| format!("Failed to create file {:?}: {e}", outpath))?;
        std::io::copy(&mut file, &mut outfile)
            .map_err(|e| format!("Failed to extract file {:?}: {e}", outpath))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = file.unix_mode() {
                std::fs::set_permissions(&outpath, std::fs::Permissions::from_mode(mode)).ok();
            } else {
                std::fs::set_permissions(&outpath, std::fs::Permissions::from_mode(0o755)).ok();
            }
        }
    }

    app.emit("llm_download_progress", serde_json::json!({
        "model_id": "llama-runtime",
        "percent": 100,
        "downloaded_bytes": 0,
        "total_bytes": 0,
        "status": "runtime_ready"
    })).ok();

    find_llama_server(app)
}

#[tauri::command]
pub async fn llm_ensure_runtime(app: AppHandle) -> Result<String, String> {
    let bin = ensure_llama_server(&app).await?;
    Ok(bin.to_string_lossy().into_owned())
}

/// Start the llama-server sidecar with the given model.
/// The server is started once and reused across inference calls.
#[tauri::command]
pub async fn llm_load_model(
    app: AppHandle,
    state: tauri::State<'_, Arc<LlmState>>,
    model_id: String,
) -> Result<(), String> {
    let info = find_model(&model_id).ok_or_else(|| format!("Unknown model: {model_id}"))?;
    let model_path = models_dir(&app)?.join(info.filename);

    if !model_path.exists() {
        return Err("Model not downloaded yet. Run llm_download_model first.".to_string());
    }

    // Kill existing server stored in state
    {
        let mut proc = state.server_process.lock().map_err(|e| e.to_string())?;
        if let Some(mut child) = proc.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    // Kill any orphaned llama-server process on the system to prevent port collisions
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        use std::process::Stdio;
        let _ = Command::new("taskkill")
            .args(&["/F", "/IM", "llama-server.exe"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(0x08000000)
            .status();
    }
    
    #[cfg(not(target_os = "windows"))]
    let _ = Command::new("killall").arg("llama-server").status();

    let server_bin = ensure_llama_server(&app).await?;
    let port = state.server_port;

    let log_path = app
        .path()
        .app_data_dir()
        .map(|p| p.join("llama_server.log"))
        .ok();

    let mut cmd = Command::new(&server_bin);
    if let Some(parent) = server_bin.parent() {
        cmd.current_dir(parent);
    }
    cmd.arg("--model")
       .arg(&model_path)
       .arg("--port")
       .arg(port.to_string())
       .arg("--ctx-size")
       .arg("8192")
       .arg("--threads")
       .arg(num_cpus().to_string())
       .arg("-ngl")
       .arg("99");

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    if let Some(ref path) = log_path {
        if let Ok(file_out) = std::fs::File::create(path) {
            if let Ok(file_err) = file_out.try_clone() {
                cmd.stdout(file_out);
                cmd.stderr(file_err);
            }
        }
    }

    let child = cmd
        .spawn()
        .map_err(|e| format!("Failed to start llama-server: {e}"))?;

    {
        let mut proc = state.server_process.lock().map_err(|e| e.to_string())?;
        *proc = Some(child);
        let mut current = state.current_model_id.lock().map_err(|e| e.to_string())?;
        *current = Some(model_id);
    }

    // Give server a brief moment to start up process
    tokio::time::sleep(tokio::time::Duration::from_millis(1000)).await;

    // Verify server is up — poll /health endpoint for up to 60 seconds to allow large GGUF models to load from disk
    let client = reqwest::Client::new();
    for _ in 0..120 {
        // Check if process exited prematurely
        {
            let mut proc_guard = state.server_process.lock().map_err(|e| e.to_string())?;
            if let Some(ref mut child) = *proc_guard {
                if let Ok(Some(status)) = child.try_wait() {
                    let _ = proc_guard.take();
                    let mut current = state.current_model_id.lock().map_err(|e| e.to_string())?;
                    *current = None;
                    return Err(format!("llama-server process exited prematurely with status: {status}"));
                }
            }
        }

        if client
            .get(format!("http://127.0.0.1:{port}/health"))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
        {
            return Ok(());
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    }

    // Read log output for diagnostics
    let log_content = log_path
        .as_ref()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .unwrap_or_default();

    let last_lines: String = log_content
        .lines()
        .rev()
        .take(6)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");

    // Health check failed — clean up state
    {
        let mut proc = state.server_process.lock().map_err(|e| e.to_string())?;
        if let Some(mut child) = proc.take() {
            let _ = child.kill();
        }
        let mut current = state.current_model_id.lock().map_err(|e| e.to_string())?;
        *current = None;
    }

    Err(format!(
        "llama-server failed to respond on http://127.0.0.1:{port}/health.\nLogs:\n{}",
        if last_lines.is_empty() { "No log output recorded" } else { &last_lines }
    ))
}

/// Stop the running model server and free resources.
#[tauri::command]
pub async fn llm_unload_model(
    state: tauri::State<'_, Arc<LlmState>>,
) -> Result<(), String> {
    let mut proc = state.server_process.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = proc.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    let mut current = state.current_model_id.lock().map_err(|e| e.to_string())?;
    *current = None;
    Ok(())
}

/// Run a prompt through the loaded local model. Returns generated text.
#[derive(Deserialize)]
struct OaiChoice {
    message: OaiMessage,
}

#[derive(Deserialize)]
struct OaiMessage {
    content: String,
}

#[derive(Deserialize)]
struct OaiResponse {
    choices: Vec<OaiChoice>,
}

/// Check if the local llama-server process is active and responding to health pings.
#[tauri::command]
pub async fn llm_check_connection(
    state: tauri::State<'_, Arc<LlmState>>,
) -> Result<bool, String> {
    let port = state.server_port;
    let client = reqwest::Client::new();
    let is_healthy = client
        .get(format!("http://127.0.0.1:{port}/health"))
        .timeout(tokio::time::Duration::from_secs(2))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);
    Ok(is_healthy)
}

#[tauri::command]
pub async fn llm_generate(
    app: AppHandle,
    state: tauri::State<'_, Arc<LlmState>>,
    prompt: String,
    system_prompt: Option<String>,
) -> Result<String, String> {
    let port = state.server_port;
    let client = reqwest::Client::new();

    // Check if llama-server is healthy; if not, attempt auto-recovery load
    let is_healthy = client
        .get(format!("http://127.0.0.1:{port}/health"))
        .timeout(tokio::time::Duration::from_secs(2))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);

    if !is_healthy {
        let active_model = {
            let guard = state.current_model_id.lock().map_err(|e| e.to_string())?;
            guard.clone().unwrap_or_else(|| "llama3.2".to_string())
        };
        llm_load_model(app.clone(), state.clone(), active_model).await?;
    }

    let mut messages: Vec<serde_json::Value> = Vec::new();
    if let Some(sys) = system_prompt {
        messages.push(serde_json::json!({ "role": "system", "content": sys }));
    }
    messages.push(serde_json::json!({ "role": "user", "content": prompt }));

    let response = client
        .post(format!("http://127.0.0.1:{port}/v1/chat/completions"))
        .json(&serde_json::json!({
            "model": "local-model",
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": 2048
        }))
        .timeout(tokio::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| format!("Inference request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Server returned status {}", response.status()));
    }

    let oai: OaiResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {e}"))?;

    Ok(oai
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .unwrap_or_default())
}

#[tauri::command]
pub async fn llm_generate_stream(
    app: AppHandle,
    state: tauri::State<'_, Arc<LlmState>>,
    prompt: String,
    system_prompt: Option<String>,
) -> Result<(), String> {
    let port = state.server_port;
    let client = reqwest::Client::new();

    // Check if llama-server is healthy; if not, attempt auto-recovery load
    let is_healthy = client
        .get(format!("http://127.0.0.1:{port}/health"))
        .timeout(tokio::time::Duration::from_secs(2))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false);

    if !is_healthy {
        let active_model = {
            let guard = state.current_model_id.lock().map_err(|e| e.to_string())?;
            guard.clone().unwrap_or_else(|| "llama3.2".to_string())
        };
        llm_load_model(app.clone(), state.clone(), active_model).await?;
    }

    let mut messages: Vec<serde_json::Value> = Vec::new();
    if let Some(sys) = system_prompt {
        messages.push(serde_json::json!({ "role": "system", "content": sys }));
    }
    messages.push(serde_json::json!({ "role": "user", "content": prompt }));

    let response = client
        .post(format!("http://127.0.0.1:{port}/v1/chat/completions"))
        .json(&serde_json::json!({
            "model": "local-model",
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": 2048,
            "stream": true
        }))
        .timeout(tokio::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| format!("Inference request failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Server returned status {}", response.status()));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| format!("Stream read error: {e}"))?;
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        // Process lines in buffer
        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim().to_string();
            buffer.drain(..pos + 1);

            if let Some(stripped) = line.strip_prefix("data:") {
                let data = stripped.trim();
                if data == "[DONE]" {
                    break;
                }
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(choices) = val.get("choices") {
                        if let Some(first_choice) = choices.get(0) {
                            if let Some(delta) = first_choice.get("delta") {
                                if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
                                    let _ = app.emit("llm_stream_token", content);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let _ = app.emit("llm_stream_done", ());
    Ok(())
}

/// Get the currently loaded model ID.
#[tauri::command]
pub async fn llm_current_model(
    state: tauri::State<'_, Arc<LlmState>>,
) -> Result<Option<String>, String> {
    let current = state.current_model_id.lock().map_err(|e| e.to_string())?;
    Ok(current.clone())
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn num_cpus() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(8) // Cap at 8 to avoid starving other processes
}
