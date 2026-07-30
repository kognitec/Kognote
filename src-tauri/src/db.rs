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
    let conn = Connection::open(&db_path)
        .map_err(|e| format!("Failed to open vector database: {e}"))?;

    // 2. Enable foreign keys
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

    // 4. Create virtual table for sqlite-vec
    // Use sqlite-vec specific virtual table creation syntax
    conn.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
            id INTEGER PRIMARY KEY,
            embedding float[384]
        );",
        [],
    )
    .map_err(|e| format!("Failed to create vec_embeddings virtual table: {e}"))?;

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

    // 13. Create pending_ai_suggestions table for non-destructive AI suggestions
    conn.execute(
        "CREATE TABLE IF NOT EXISTS pending_ai_suggestions (
            id TEXT PRIMARY KEY,
            note_path TEXT NOT NULL,
            original_block_text TEXT NOT NULL,
            suggested_task_text TEXT NOT NULL,
            extracted_due_date TEXT,
            created_at INTEGER NOT NULL,
            status TEXT CHECK(status IN ('pending', 'accepted', 'dismissed')) DEFAULT 'pending'
        );",
        [],
    )
    .map_err(|e| format!("Failed to create pending_ai_suggestions table: {e}"))?;

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

#[tauri::command]
pub async fn vector_upsert(
    state: tauri::State<'_, DbState>,
    file_path: String,
    chunk_text: String,
    embedding: Vec<f32>,
) -> Result<(), String> {
    if embedding.len() != 384 {
        return Err(format!("Embedding must be exactly 384 dimensions, got {}", embedding.len()));
    }

    with_conn(&state, |conn| {
        // Insert metadata
        let updated_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        conn.execute(
            "INSERT INTO embeddings_metadata (file_path, chunk_text, updated_at) VALUES (?1, ?2, ?3)",
            params![file_path, chunk_text, updated_at],
        )
        .map_err(|e| format!("Upsert metadata error: {e}"))?;

        let row_id = conn.last_insert_rowid();

        // Convert f32 slice to bytes for blob injection
        let bytes = f32_slice_to_bytes(&embedding);

        // Insert into the virtual table
        conn.execute(
            "INSERT INTO vec_embeddings (id, embedding) VALUES (?1, ?2)",
            params![row_id, bytes],
        )
        .map_err(|e| format!("Upsert virtual embedding error: {e}"))?;

        // Insert into FTS5 table
        conn.execute(
            "INSERT INTO fts_chunks (rowid, file_path, chunk_text) VALUES (?1, ?2, ?3)",
            params![row_id, file_path, chunk_text],
        )
        .map_err(|e| format!("Upsert FTS index error: {e}"))?;

        Ok(())
    })
}

#[tauri::command]
pub async fn vector_delete(
    state: tauri::State<'_, DbState>,
    file_path: String,
) -> Result<(), String> {
    with_conn(&state, |conn| {
        // Find all metadata IDs matching the file path
        let mut stmt = conn
            .prepare("SELECT id FROM embeddings_metadata WHERE file_path = ?1")
            .map_err(|e| e.to_string())?;

        let ids: Vec<i64> = stmt
            .query_map([&file_path], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();

        // Delete from all tables
        for id in ids {
            conn.execute("DELETE FROM vec_embeddings WHERE id = ?1", [id])
                .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM embeddings_metadata WHERE id = ?1", [id])
                .map_err(|e| e.to_string())?;
            conn.execute("DELETE FROM fts_chunks WHERE rowid = ?1", [id])
                .map_err(|e| e.to_string())?;
        }

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
}

#[derive(Clone)]
struct HybridResult {
    file_path: String,
    chunk_text: String,
    rrf_score: f64,
    similarity: f64,
}

#[tauri::command]
pub async fn vector_search(
    state: tauri::State<'_, DbState>,
    query_text: String,
    query_embedding: Vec<f32>,
    top_k: u32,
) -> Result<Vec<VectorSearchResult>, String> {
    if query_embedding.len() != 384 {
        return Err(format!("Query embedding must be 384 dimensions, got {}", query_embedding.len()));
    }

    with_conn(&state, |conn| {
        let query_bytes = f32_slice_to_bytes(&query_embedding);

        // 1. Get Vector Search results
        let mut vector_stmt = conn
            .prepare(
                "SELECT 
                    m.id,
                    m.file_path, 
                    m.chunk_text, 
                    (1.0 - vec_distance_cosine(v.embedding, ?1)) as similarity
                 FROM vec_embeddings v
                 JOIN embeddings_metadata m ON v.id = m.id
                 ORDER BY vec_distance_cosine(v.embedding, ?1) ASC
                 LIMIT 50",
            )
            .map_err(|e| format!("Failed to prepare vector search statement: {e}"))?;

        let vector_rows = vector_stmt
            .query_map(params![query_bytes], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, f64>(3)?,
                ))
            })
            .map_err(|e| format!("Vector search query error: {e}"))?;

        let mut results_map: std::collections::HashMap<i64, HybridResult> = std::collections::HashMap::new();

        let mut rank = 1;
        for row in vector_rows.flatten() {
            let (id, file_path, chunk_text, similarity) = row;
            let score = 1.0 / (60.0 + rank as f64);
            results_map.insert(
                id,
                HybridResult {
                    file_path,
                    chunk_text,
                    rrf_score: score,
                    similarity,
                },
            );
            rank += 1;
        }

        // 2. Get FTS5 search results
        let clean_query = query_text
            .chars()
            .map(|c| if c.is_alphanumeric() || c.is_whitespace() { c } else { ' ' })
            .collect::<String>();
        let words: Vec<&str> = clean_query.split_whitespace().collect();
        
        if !words.is_empty() {
            let fts_query = words.join(" OR ");
            let fts_stmt = conn
                .prepare(
                    "SELECT 
                        rowid,
                        file_path, 
                        chunk_text
                     FROM fts_chunks
                     WHERE fts_chunks MATCH ?1
                     LIMIT 50",
                );
            if let Ok(mut stmt) = fts_stmt {
                if let Ok(fts_rows) = stmt.query_map([fts_query], |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                }) {
                    let mut fts_rank = 1;
                    for row in fts_rows.flatten() {
                        let (id, file_path, chunk_text) = row;
                        let score = 1.0 / (60.0 + fts_rank as f64);
                        if let Some(res) = results_map.get_mut(&id) {
                            res.rrf_score += score;
                        } else {
                            results_map.insert(
                                id,
                                HybridResult {
                                    file_path,
                                    chunk_text,
                                    rrf_score: score,
                                    similarity: 0.7, // default base similarity if only found in FTS
                                },
                            );
                        }
                        fts_rank += 1;
                    }
                }
            }
        }

        // 3. Sort results by RRF score
        let mut sorted_results: Vec<HybridResult> = results_map.into_values().collect();
        sorted_results.sort_by(|a, b| b.rrf_score.partial_cmp(&a.rrf_score).unwrap_or(std::cmp::Ordering::Equal));

        // 4. Map to VectorSearchResult
        let final_results: Vec<VectorSearchResult> = sorted_results
            .into_iter()
            .take(top_k as usize)
            .map(|r| VectorSearchResult {
                file_path: r.file_path,
                chunk_text: r.chunk_text,
                similarity: r.similarity,
            })
            .collect();

        Ok(final_results)
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
        let mut stmt = conn
            .prepare(
                "SELECT 
                    m1.file_path, 
                    m2.file_path, 
                    MAX(1.0 - vec_distance_cosine(v1.embedding, v2.embedding)) as similarity
                 FROM vec_embeddings v1
                 JOIN vec_embeddings v2 ON v1.id < v2.id
                 JOIN embeddings_metadata m1 ON v1.id = m1.id
                 JOIN embeddings_metadata m2 ON v2.id = m2.id
                 WHERE m1.file_path < m2.file_path
                 GROUP BY m1.file_path, m2.file_path
                 HAVING similarity >= ?1",
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


