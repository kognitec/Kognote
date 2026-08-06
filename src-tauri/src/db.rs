use std::path::PathBuf;
use std::sync::Mutex;
use rusqlite::{params, Connection};
use tauri::{AppHandle, Manager};

pub struct DbState {
    pub conn: Mutex<Option<Connection>>,
}

impl DbState {
    pub fn new() -> Self {
        Self {
            conn: Mutex::new(None),
        }
    }
}

/// Helper to get the SQLite vector database path
fn get_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Cannot resolve app data dir: {e}"))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|e| format!("Cannot create app data directory: {e}"))?;
    Ok(data_dir.join("kognote_vectors.db"))
}

/// Initialize the database connection, register sqlite-vec, and run migrations
pub fn init_db(app: &AppHandle, state: &DbState) -> Result<(), String> {
    // 1. Register the sqlite-vec extension (must be done before opening the connection)
    unsafe {
        let _ = rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute::<
            *const (),
            unsafe extern "C" fn(*mut rusqlite::ffi::sqlite3, *mut *const i8, *const rusqlite::ffi::sqlite3_api_routines) -> i32,
        >(sqlite_vec::sqlite3_vec_init as *const ())));
    }

    let db_path = get_db_path(app)?;
    let conn = match Connection::open(&db_path) {
        Ok(c) => c,
        Err(_) => {
            let corrupt_backup = db_path.with_extension("db.corrupt");
            let _ = std::fs::rename(&db_path, &corrupt_backup);
            Connection::open(&db_path).map_err(|e| format!("Failed to open vector database: {e}"))?
        }
    };

    // 2. High-performance WAL mode & lock busy timeout
    let _ = conn.execute("PRAGMA journal_mode = WAL;", []);
    let _ = conn.execute("PRAGMA busy_timeout = 5000;", []);
    let _ = conn.execute("PRAGMA synchronous = NORMAL;", []);
    let _ = conn.execute("PRAGMA foreign_keys = ON;", []);

    // 3. Create tables
    conn.execute(
        "CREATE TABLE IF NOT EXISTS embeddings_metadata (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL,
            chunk_text TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );",
        [],
    )
    .map_err(|e| format!("Failed to create embeddings_metadata: {e}"))?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_metadata_filepath ON embeddings_metadata(file_path);",
        [],
    )
    .map_err(|e| format!("Failed to create index on file_path: {e}"))?;

    // Check if existing database contains legacy 384d vector table
    let is_384d: bool = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='vec_embeddings'",
            [],
            |row| {
                let sql: String = row.get(0)?;
                Ok(sql.contains("384"))
            },
        )
        .unwrap_or(false);

    if is_384d {
        eprintln!("[Vector DB] Detected legacy 384d vector table. Automatically migrating to 768d...");
        let _ = conn.execute("DROP TABLE IF EXISTS vec_embeddings;", []);
        let _ = conn.execute("DROP TABLE IF EXISTS embeddings_metadata;", []);
        let _ = conn.execute("DROP TABLE IF EXISTS fts_chunks;", []);
    }

    // 4. Create virtual table for sqlite-vec (768 dimensions for nomic-embed-text-v1.5)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS embeddings_metadata (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL,
            chunk_text TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );",
        [],
    ).map_err(|e| format!("Failed to create embeddings_metadata: {e}"))?;

    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
            id INTEGER PRIMARY KEY,
            embedding float[768]
        );",
        [],
    ).map_err(|e| format!("Failed to create 768d vec_embeddings: {e}"))?;

    // 5. Create note_versions table for delta diff versioning
    conn.execute(
        "CREATE TABLE IF NOT EXISTS note_versions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL,
            patch TEXT NOT NULL,
            checksum TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );",
        [],
    )
    .map_err(|e| format!("Failed to create note_versions table: {e}"))?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_versions_filepath ON note_versions(file_path);",
        [],
    )
    .map_err(|e| format!("Failed to create index on note_versions(file_path): {e}"))?;

    // 6. Create fts_chunks virtual table for hybrid FTS5 search
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
            file_path,
            chunk_text
        );",
        [],
    )
    .map_err(|e| format!("Failed to create fts_chunks virtual table: {e}"))?;

    // 7. Create blocks table for block-relational structure
    conn.execute(
        "CREATE TABLE IF NOT EXISTS blocks (
            block_id TEXT PRIMARY KEY,
            parent_note_id TEXT NOT NULL,
            block_type TEXT NOT NULL,
            content TEXT NOT NULL,
            status TEXT,
            due_date TEXT,
            raw_markdown TEXT NOT NULL,
            position_index INTEGER NOT NULL,
            ai_processed INTEGER DEFAULT 0
        );",
        [],
    )
    .map_err(|e| format!("Failed to create blocks table: {e}"))?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_blocks_parent ON blocks(parent_note_id);",
        [],
    )
    .map_err(|e| format!("Failed to create index on blocks(parent_note_id): {e}"))?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_blocks_type ON blocks(block_type);",
        [],
    )
    .map_err(|e| format!("Failed to create index on blocks(block_type): {e}"))?;

    // 8. Create notes table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS notes (
            file_path TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'note',
            status TEXT NOT NULL DEFAULT 'none',
            priority TEXT NOT NULL DEFAULT 'medium',
            due TEXT,
            created TEXT,
            updated TEXT,
            encrypted TEXT NOT NULL DEFAULT 'no',
            storage TEXT NOT NULL DEFAULT 'active',
            modified_at INTEGER NOT NULL
        );",
        [],
    )
    .map_err(|e| format!("Failed to create notes table: {e}"))?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_notes_status ON notes(status);",
        [],
    )
    .map_err(|e| format!("Failed to create index on notes(status): {e}"))?;

    // 9. Create tasks table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            note_path TEXT NOT NULL,
            note_name TEXT NOT NULL,
            content TEXT NOT NULL,
            completed INTEGER NOT NULL DEFAULT 0,
            line_number INTEGER NOT NULL,
            due_date TEXT,
            tags TEXT
        );",
        [],
    )
    .map_err(|e| format!("Failed to create tasks table: {e}"))?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_tasks_note ON tasks(note_path);",
        [],
    )
    .map_err(|e| format!("Failed to create index on tasks(note_path): {e}"))?;

    // 10. Create note_links table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS note_links (
            source_path TEXT NOT NULL,
            target_name TEXT NOT NULL,
            PRIMARY KEY(source_path, target_name)
        );",
        [],
    )
    .map_err(|e| format!("Failed to create note_links table: {e}"))?;

    // 11. Create note_tags table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS note_tags (
            file_path TEXT NOT NULL,
            tag TEXT NOT NULL,
            PRIMARY KEY(file_path, tag)
        );",
        [],
    )
    .map_err(|e| format!("Failed to create note_tags table: {e}"))?;

    // 12. Create fsrs_states table for SRS flashcard progress persistence
    conn.execute(
        "CREATE TABLE IF NOT EXISTS fsrs_states (
            card_id TEXT PRIMARY KEY,
            note_path TEXT NOT NULL,
            question TEXT NOT NULL,
            answer TEXT NOT NULL,
            stability REAL NOT NULL DEFAULT 0.0,
            difficulty REAL NOT NULL DEFAULT 0.0,
            due_date TEXT NOT NULL,
            state INTEGER NOT NULL DEFAULT 0,
            repetition INTEGER NOT NULL DEFAULT 0,
            interval INTEGER NOT NULL DEFAULT 0,
            last_review TEXT,
            updated_at INTEGER NOT NULL
        );",
        [],
    )
    .map_err(|e| format!("Failed to create fsrs_states table: {e}"))?;

    // 14. Create note_metadata table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS note_metadata (
            file_path TEXT PRIMARY KEY,
            tags TEXT NOT NULL,
            links TEXT NOT NULL,
            storage TEXT NOT NULL DEFAULT 'active',
            updated_at INTEGER NOT NULL
        );",
        [],
    )
    .map_err(|e| format!("Failed to create note_metadata table: {e}"))?;

    // 15. Create ai_suggestions table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS ai_suggestions (
            file_path TEXT PRIMARY KEY,
            tags TEXT NOT NULL,
            links TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );",
        [],
    )
    .map_err(|e| format!("Failed to create ai_suggestions table: {e}"))?;

    let mut guard = state.conn.lock().map_err(|e| e.to_string())?;
    *guard = Some(conn);

    println!("sqlite-vec database initialized successfully at {:?}", db_path);
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub struct PendingAiSuggestion {
    pub id: String,
    pub note_path: String,
    pub original_block_text: String,
    pub suggested_task_text: String,
    pub extracted_due_date: Option<String>,
    pub created_at: i64,
    pub status: String,
}

#[tauri::command]
pub fn db_get_pending_ai_suggestions(
    db_state: tauri::State<'_, DbState>,
    note_path: Option<String>,
) -> Result<Vec<PendingAiSuggestion>, String> {
    with_conn(&db_state, |conn| {
        let mut result = Vec::new();
        if let Some(path) = note_path {
            let mut stmt = conn.prepare(
                "SELECT id, note_path, original_block_text, suggested_task_text, extracted_due_date, created_at, status
                 FROM pending_ai_suggestions WHERE note_path = ?1 AND status = 'pending' ORDER BY created_at DESC"
            ).map_err(|e| e.to_string())?;
            let rows = stmt.query_map([&path], |row| {
                Ok(PendingAiSuggestion {
                    id: row.get(0)?,
                    note_path: row.get(1)?,
                    original_block_text: row.get(2)?,
                    suggested_task_text: row.get(3)?,
                    extracted_due_date: row.get(4)?,
                    created_at: row.get(5)?,
                    status: row.get(6)?,
                })
            }).map_err(|e| e.to_string())?;
            for r in rows {
                result.push(r.map_err(|e| e.to_string())?);
            }
        } else {
            let mut stmt = conn.prepare(
                "SELECT id, note_path, original_block_text, suggested_task_text, extracted_due_date, created_at, status
                 FROM pending_ai_suggestions WHERE status = 'pending' ORDER BY created_at DESC"
            ).map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |row| {
                Ok(PendingAiSuggestion {
                    id: row.get(0)?,
                    note_path: row.get(1)?,
                    original_block_text: row.get(2)?,
                    suggested_task_text: row.get(3)?,
                    extracted_due_date: row.get(4)?,
                    created_at: row.get(5)?,
                    status: row.get(6)?,
                })
            }).map_err(|e| e.to_string())?;
            for r in rows {
                result.push(r.map_err(|e| e.to_string())?);
            }
        }
        Ok(result)
    })
}

#[tauri::command]
pub fn db_update_ai_suggestion_status(
    db_state: tauri::State<'_, DbState>,
    id: String,
    status: String,
) -> Result<(), String> {
    with_conn(&db_state, |conn| {
        conn.execute(
            "UPDATE pending_ai_suggestions SET status = ?1 WHERE id = ?2",
            params![status, id],
        ).map_err(|e| e.to_string())?;
        Ok(())
    })
}

/// Helper function to perform tasks with a locked connection
pub fn with_conn<F, T>(state: &DbState, f: F) -> Result<T, String>
where
    F: FnOnce(&Connection) -> Result<T, String>,
{
    let guard = state.conn.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;
    f(conn)
}

/// Helper function to perform tasks requiring mutable connection (e.g. transactions)
pub fn with_conn_mut<F, T>(state: &DbState, f: F) -> Result<T, String>
where
    F: FnOnce(&mut Connection) -> Result<T, String>,
{
    let mut guard = state.conn.lock().map_err(|e| e.to_string())?;
    let conn = guard.as_mut().ok_or("Database not initialized")?;
    f(conn)
}

/// Helper to convert a float vector to raw bytes (native endianness)
fn f32_slice_to_bytes(slice: &[f32]) -> &[u8] {
    unsafe {
        std::slice::from_raw_parts(
            slice.as_ptr() as *const u8,
            std::mem::size_of_val(slice),
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tauri Commands for Vector Operations
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn init_vector_db(
    app: AppHandle,
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    init_db(&app, &state)
}

#[derive(serde::Deserialize)]
pub struct ChunkEmbeddingInput {
    pub file_path: String,
    pub chunk_text: String,
    pub embedding: Vec<f32>,
}

#[tauri::command]
pub async fn vector_upsert(
    state: tauri::State<'_, DbState>,
    file_path: String,
    chunk_text: String,
    embedding: Vec<f32>,
) -> Result<(), String> {
    if embedding.len() != 768 {
        return Err(format!("Embedding must be exactly 768 dimensions, got {}", embedding.len()));
    }

    with_conn_mut(&state, |conn| {
        let tx = conn.transaction().map_err(|e| format!("Failed to begin transaction: {e}"))?;
        let updated_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        tx.execute(
            "INSERT INTO embeddings_metadata (file_path, chunk_text, updated_at) VALUES (?1, ?2, ?3)",
            params![file_path, chunk_text, updated_at],
        )
        .map_err(|e| format!("Upsert metadata error: {e}"))?;

        let row_id = tx.last_insert_rowid();
        let bytes = f32_slice_to_bytes(&embedding);

        tx.execute(
            "INSERT INTO vec_embeddings (id, embedding) VALUES (?1, ?2)",
            params![row_id, bytes],
        )
        .map_err(|e| format!("Upsert virtual embedding error: {e}"))?;

        tx.execute(
            "INSERT INTO fts_chunks (rowid, file_path, chunk_text) VALUES (?1, ?2, ?3)",
            params![row_id, file_path, chunk_text],
        )
        .map_err(|e| format!("Upsert FTS index error: {e}"))?;

        tx.commit().map_err(|e| format!("Failed to commit vector upsert: {e}"))?;
        Ok(())
    })
}

#[tauri::command]
pub async fn vector_upsert_batch(
    state: tauri::State<'_, DbState>,
    chunks: Vec<ChunkEmbeddingInput>,
) -> Result<(), String> {
    if chunks.is_empty() {
        return Ok(());
    }

    with_conn_mut(&state, |conn| {
        let tx = conn.transaction().map_err(|e| format!("Failed to begin transaction: {e}"))?;
        let updated_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        for item in chunks {
            if item.embedding.len() != 768 {
                return Err(format!("Embedding must be 768 dimensions, got {}", item.embedding.len()));
            }

            tx.execute(
                "INSERT INTO embeddings_metadata (file_path, chunk_text, updated_at) VALUES (?1, ?2, ?3)",
                params![item.file_path, item.chunk_text, updated_at],
            )
            .map_err(|e| format!("Upsert metadata error: {e}"))?;

            let row_id = tx.last_insert_rowid();
            let bytes = f32_slice_to_bytes(&item.embedding);

            tx.execute(
                "INSERT INTO vec_embeddings (id, embedding) VALUES (?1, ?2)",
                params![row_id, bytes],
            )
            .map_err(|e| format!("Upsert virtual embedding error: {e}"))?;

            tx.execute(
                "INSERT INTO fts_chunks (rowid, file_path, chunk_text) VALUES (?1, ?2, ?3)",
                params![row_id, item.file_path, item.chunk_text],
            )
            .map_err(|e| format!("Upsert FTS index error: {e}"))?;
        }

        tx.commit().map_err(|e| format!("Failed to commit batch vector upsert: {e}"))?;
        Ok(())
    })
}

#[tauri::command]
pub async fn vector_delete(
    state: tauri::State<'_, DbState>,
    file_path: String,
) -> Result<(), String> {
    with_conn_mut(&state, |conn| {
        let tx = conn.transaction().map_err(|e| format!("Failed to begin transaction: {e}"))?;
        let ids: Vec<i64> = {
            let mut stmt = tx
                .prepare("SELECT id FROM embeddings_metadata WHERE file_path = ?1")
                .map_err(|e| e.to_string())?;

            let rows = stmt
                .query_map([&file_path], |row| row.get(0))
                .map_err(|e| e.to_string())?;

            rows.filter_map(|r| r.ok()).collect()
        };

        for id in ids {
            tx.execute("DELETE FROM vec_embeddings WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM embeddings_metadata WHERE id = ?1", [id]).map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM fts_chunks WHERE rowid = ?1", [id]).map_err(|e| e.to_string())?;
        }

        tx.commit().map_err(|e| format!("Failed to commit vector delete: {e}"))?;
        Ok(())
    })
}



#[derive(serde::Serialize)]
pub struct VectorSearchResult {
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "chunkText")]
    pub chunk_text: String,
    pub similarity: f64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}


#[tauri::command]
pub async fn vector_search(
    state: tauri::State<'_, DbState>,
    query_text: String,
    query_embedding: Vec<f32>,
    top_k: u32,
) -> Result<Vec<VectorSearchResult>, String> {
    if query_embedding.len() != 768 {
        return Err(format!("Query embedding must be 768 dimensions, got {}", query_embedding.len()));
    }

    // query_text is accepted for API compatibility but not used in pure-vector search
    let _ = query_text;

    with_conn(&state, |conn| {
        let query_bytes = f32_slice_to_bytes(&query_embedding);

        // Pure cosine-similarity vector search — no FTS5 keyword bias.
        // Results are ordered by ascending cosine distance (= descending cosine similarity).
        // A secondary sort by updated_at breaks ties toward the most recently modified notes.
        let mut stmt = conn
            .prepare(
                "SELECT 
                    m.file_path,
                    m.chunk_text,
                    (1.0 - vec_distance_cosine(v.embedding, ?1)) AS similarity,
                    m.updated_at
                 FROM vec_embeddings v
                 JOIN embeddings_metadata m ON v.id = m.id
                 ORDER BY vec_distance_cosine(v.embedding, ?1) ASC,
                          m.updated_at DESC
                 LIMIT ?2",
            )
            .map_err(|e| format!("Failed to prepare vector search statement: {e}"))?;

        let rows = stmt
            .query_map(params![query_bytes, top_k], |row| {
                Ok(VectorSearchResult {
                    file_path: row.get(0)?,
                    chunk_text: row.get(1)?,
                    similarity: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            })
            .map_err(|e| format!("Vector search query error: {e}"))?;

        let results: Vec<VectorSearchResult> = rows.flatten().collect();
        Ok(results)
    })
}

#[derive(serde::Serialize)]
pub struct VectorLinkResult {
    pub source: String,
    pub target: String,
    pub similarity: f64,
}

#[tauri::command]
pub async fn vector_get_semantic_connections(
    state: tauri::State<'_, DbState>,
    threshold: f64,
) -> Result<Vec<VectorLinkResult>, String> {
    with_conn(&state, |conn| {
        // High Performance Optimization for 10k+ note vaults:
        // Group by primary file embedding and sort by top cosine similarity
        let mut stmt = conn
            .prepare(
                "WITH note_heads AS (
                    SELECT MIN(id) as id, file_path
                    FROM embeddings_metadata
                    GROUP BY file_path
                    LIMIT 1200
                 )
                 SELECT 
                    n1.file_path, 
                    n2.file_path, 
                    (1.0 - vec_distance_cosine(v1.embedding, v2.embedding)) as similarity
                 FROM note_heads n1
                 JOIN vec_embeddings v1 ON n1.id = v1.id
                 JOIN note_heads n2 ON n1.id < n2.id
                 JOIN vec_embeddings v2 ON n2.id = v2.id
                 WHERE (1.0 - vec_distance_cosine(v1.embedding, v2.embedding)) >= ?1
                 ORDER BY similarity DESC
                 LIMIT 250",
            )
            .map_err(|e| format!("Failed to prepare semantic connections query: {e}"))?;

        let rows = stmt
            .query_map([threshold], |row| {
                Ok(VectorLinkResult {
                    source: row.get(0)?,
                    target: row.get(1)?,
                    similarity: row.get(2)?,
                })
            })
            .map_err(|e| format!("Semantic connections query error: {e}"))?;

        let mut results = Vec::new();
        for res in rows.flatten() {
            results.push(res);
        }

        Ok(results)
    })
}

#[tauri::command]
pub async fn vector_find_backlinks(
    state: tauri::State<'_, DbState>,
    note_name: String,
) -> Result<Vec<String>, String> {
    with_conn(&state, |conn| {
        let query_str = format!("%[[{}]]%", note_name);
        let mut stmt = conn
            .prepare("SELECT DISTINCT file_path FROM embeddings_metadata WHERE chunk_text LIKE ?1")
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([query_str], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;

        let mut results = Vec::new();
        for path in rows.flatten() {
            results.push(path);
        }

        Ok(results)
    })
}

#[tauri::command]
pub async fn db_delete_note_metadata(
    state: tauri::State<'_, DbState>,
    file_path: String,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        conn.execute("DELETE FROM note_metadata WHERE file_path = ?1", params![file_path]).ok();
        conn.execute("DELETE FROM note_links WHERE source_path = ?1", params![file_path]).ok();
        Ok(())
    })
}

#[tauri::command]
pub async fn db_clear_all_metadata(
    state: tauri::State<'_, DbState>,
) -> Result<(), String> {
    with_conn_mut(&state, |conn| {
        let _ = conn.execute("DELETE FROM note_metadata", []);
        let _ = conn.execute("DELETE FROM ai_suggestions", []);
        let _ = conn.execute("DELETE FROM vec_embeddings", []);
        let _ = conn.execute("DELETE FROM embeddings_metadata", []);
        let _ = conn.execute("DELETE FROM fts_chunks", []);
        Ok(())
    })
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct DbNoteMetadata {
    pub file_path: String,
    pub tags: String,
    pub links: String,
    pub storage: String,
    pub updated_at: i64,
}

#[tauri::command]
pub async fn db_save_note_metadata(
    state: tauri::State<'_, DbState>,
    file_path: String,
    tags: String,
    links: String,
    storage: Option<String>,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        let storage_val = storage.unwrap_or_else(|| "active".to_string());
        conn.execute(
            "INSERT OR REPLACE INTO note_metadata (file_path, tags, links, storage, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![file_path, tags, links, storage_val, now],
        )
        .map_err(|e| format!("Failed to save note metadata: {e}"))?;
        Ok(())
    })
}

#[tauri::command]
pub async fn db_get_note_metadata(
    state: tauri::State<'_, DbState>,
    file_path: String,
) -> Result<Option<DbNoteMetadata>, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn
            .prepare("SELECT file_path, tags, links, storage, updated_at FROM note_metadata WHERE file_path = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map([&file_path], |row| {
                Ok(DbNoteMetadata {
                    file_path: row.get(0)?,
                    tags: row.get(1)?,
                    links: row.get(2)?,
                    storage: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        if let Some(r) = rows.next() {
            Ok(Some(r.map_err(|e| e.to_string())?))
        } else {
            Ok(None)
        }
    })
}

#[tauri::command]
pub async fn db_get_all_note_metadata(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<DbNoteMetadata>, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn
            .prepare("SELECT file_path, tags, links, storage, updated_at FROM note_metadata")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(DbNoteMetadata {
                    file_path: row.get(0)?,
                    tags: row.get(1)?,
                    links: row.get(2)?,
                    storage: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut results = Vec::new();
        for r in rows.flatten() {
            results.push(r);
        }
        Ok(results)
    })
}

#[tauri::command]
pub async fn db_save_ai_suggestions(
    state: tauri::State<'_, DbState>,
    file_path: String,
    tags: String,
    links: String,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        conn.execute(
            "INSERT OR REPLACE INTO ai_suggestions (file_path, tags, links, updated_at) VALUES (?1, ?2, ?3, ?4)",
            params![file_path, tags, links, now],
        )
        .map_err(|e| format!("Failed to save AI suggestions: {e}"))?;
        Ok(())
    })
}

#[tauri::command]
pub async fn db_get_ai_suggestions(
    state: tauri::State<'_, DbState>,
    file_path: String,
) -> Result<Option<DbNoteMetadata>, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn
            .prepare("SELECT file_path, tags, links, 'active', updated_at FROM ai_suggestions WHERE file_path = ?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt
            .query_map([&file_path], |row| {
                Ok(DbNoteMetadata {
                    file_path: row.get(0)?,
                    tags: row.get(1)?,
                    links: row.get(2)?,
                    storage: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        if let Some(r) = rows.next() {
            Ok(Some(r.map_err(|e| e.to_string())?))
        } else {
            Ok(None)
        }
    })
}

#[tauri::command]
pub async fn db_get_all_ai_suggestions(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<DbNoteMetadata>, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn
            .prepare("SELECT file_path, tags, links, 'active', updated_at FROM ai_suggestions")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(DbNoteMetadata {
                    file_path: row.get(0)?,
                    tags: row.get(1)?,
                    links: row.get(2)?,
                    storage: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;
        let mut results = Vec::new();
        for r in rows.flatten() {
            results.push(r);
        }
        Ok(results)
    })
}

#[tauri::command]
pub async fn db_sync_note_links(
    state: tauri::State<'_, DbState>,
    source_path: String,
    links: Vec<String>,
) -> Result<(), String> {
    with_conn_mut(&state, |conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM note_links WHERE source_path = ?1", params![&source_path])
            .map_err(|e| e.to_string())?;
        for link in links {
            let clean = link.trim().trim_end_matches(".md").to_string();
            if !clean.is_empty() {
                tx.execute(
                    "INSERT OR IGNORE INTO note_links (source_path, target_name) VALUES (?1, ?2)",
                    params![&source_path, &clean],
                )
                .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    })
}

#[tauri::command]
pub async fn db_get_backlinks(
    state: tauri::State<'_, DbState>,
    target_note_name: String,
    target_rel_path: Option<String>,
    include_trash: Option<bool>,
) -> Result<Vec<String>, String> {
    with_conn(&state, |conn| {
        let clean_target = target_note_name.trim().trim_end_matches(".md").trim_end_matches(".excalidraw").to_lowercase();
        let clean_rel = target_rel_path.unwrap_or_default().trim().trim_end_matches(".md").trim_end_matches(".excalidraw").to_lowercase();
        let inc_trash = include_trash.unwrap_or(false);

        let mut query = String::from(
            "SELECT DISTINCT nl.source_path 
             FROM note_links nl
             LEFT JOIN note_metadata nm ON LOWER(nl.source_path) = LOWER(nm.file_path)
             WHERE (LOWER(nl.target_name) = ?1 OR (?2 != '' AND LOWER(nl.target_name) = ?2))"
        );

        if !inc_trash {
            query.push_str(" AND (nm.storage IS NULL OR nm.storage != 'deleted') AND LOWER(nl.source_path) NOT LIKE '%/trash/%' AND LOWER(nl.source_path) NOT LIKE '%/.deleted/%'");
        }

        let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![clean_target, clean_rel], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;

        let mut results = Vec::new();
        for r in rows.flatten() {
            results.push(r);
        }
        Ok(results)
    })
}

#[tauri::command]
pub async fn db_get_backlink_file_paths(
    state: tauri::State<'_, DbState>,
    target_note_name: String,
    target_rel_path: Option<String>,
    include_trash: Option<bool>,
) -> Result<Vec<String>, String> {
    db_get_backlinks(state, target_note_name, target_rel_path, include_trash).await
}

pub fn insert_note_version(
    state: &DbState,
    file_path: &str,
    patch: &str,
    checksum: &str,
) -> Result<(), String> {
    with_conn(state, |conn| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        conn.execute(
            "INSERT INTO note_versions (file_path, patch, checksum, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![file_path, patch, checksum, now],
        )
        .map_err(|e| format!("Failed to insert note version: {e}"))?;
        Ok(())
    })
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct DbFsrsState {
    #[serde(rename = "cardId")]
    pub card_id: String,
    #[serde(rename = "notePath")]
    pub note_path: String,
    pub question: String,
    pub answer: String,
    pub stability: f64,
    pub difficulty: f64,
    #[serde(rename = "dueDate")]
    pub due_date: String,
    pub state: i32,
    pub repetition: i32,
    pub interval: i32,
    #[serde(rename = "lastReview")]
    pub last_review: Option<String>,
}

#[tauri::command]
pub async fn db_save_fsrs_state(
    state: tauri::State<'_, DbState>,
    card_id: String,
    note_path: String,
    question: String,
    answer: String,
    stability: f64,
    difficulty: f64,
    due_date: String,
    card_state: i32,
    repetition: i32,
    interval: i32,
    last_review: Option<String>,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as i64;
        conn.execute(
            "INSERT INTO fsrs_states (
                card_id, note_path, question, answer, stability, difficulty, due_date, state, repetition, interval, last_review, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(card_id) DO UPDATE SET
                note_path = excluded.note_path,
                question = excluded.question,
                answer = excluded.answer,
                stability = excluded.stability,
                difficulty = excluded.difficulty,
                due_date = excluded.due_date,
                state = excluded.state,
                repetition = excluded.repetition,
                interval = excluded.interval,
                last_review = excluded.last_review,
                updated_at = excluded.updated_at;",
            params![
                card_id,
                note_path,
                question,
                answer,
                stability,
                difficulty,
                due_date,
                card_state,
                repetition,
                interval,
                last_review,
                now,
            ],
        )
        .map_err(|e| format!("Failed to save FSRS state: {e}"))?;
        Ok(())
    })
}

#[tauri::command]
pub async fn db_get_fsrs_states(
    state: tauri::State<'_, DbState>,
) -> Result<Vec<DbFsrsState>, String> {
    with_conn(&state, |conn| {
        let mut stmt = conn
            .prepare(
                "SELECT card_id, note_path, question, answer, stability, difficulty, due_date, state, repetition, interval, last_review FROM fsrs_states",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(DbFsrsState {
                    card_id: row.get(0)?,
                    note_path: row.get(1)?,
                    question: row.get(2)?,
                    answer: row.get(3)?,
                    stability: row.get(4)?,
                    difficulty: row.get(5)?,
                    due_date: row.get(6)?,
                    state: row.get(7)?,
                    repetition: row.get(8)?,
                    interval: row.get(9)?,
                    last_review: row.get(10)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut results = Vec::new();
        for r in rows.flatten() {
            results.push(r);
        }
        Ok(results)
    })
}


