mod commands;
mod llm;
mod db;
mod watcher;
mod parser;
mod vault_scanner;

use std::sync::Arc;
use tauri::Manager;

use watcher::WatcherState;



use commands::{
    list_vault_files, read_note, write_note, create_note,
    create_folder, delete_note, purge_expired_trash, rename_note, fetch_ical,
    fs_exists, fs_mkdir, fs_write, fs_read, fs_write_base64, fs_copy,
    reveal_in_finder, open_with_default, sweep_orphaned_attachments, parse_note_metadata,
    sync_note_blocks, update_block_status, run_block_query, scan_vault_delta
};

use llm::{
    LlmState,
    llm_list_models,
    llm_get_system_info,
    llm_check_model,
    llm_download_model,
    llm_delete_model,
    llm_ensure_runtime,
    llm_load_model,
    llm_unload_model,
    llm_generate,
    llm_generate_stream,
    llm_current_model,
    llm_check_connection,
};

use db::{
    DbState,
    init_vector_db,
    vector_upsert,
    vector_upsert_batch,
    vector_delete,
    vector_search,
    vector_get_semantic_connections,
    vector_find_backlinks,
    db_save_note_metadata,
    db_get_note_metadata,
    db_get_all_note_metadata,
    db_delete_note_metadata,
    db_clear_all_metadata,
    db_save_ai_suggestions,
    db_get_ai_suggestions,
    db_get_all_ai_suggestions,
    db_sync_note_links,
    db_get_backlinks,
    db_get_backlink_file_paths,
};


#[allow(dead_code)]
fn build_app_menu<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<tauri::menu::Menu<R>, tauri::Error> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};

    let handle = app;

    // File Menu
    let new_note = MenuItemBuilder::with_id("new_note", "New Note")
        .accelerator("CmdOrCtrl+N")
        .build(handle)?;
    let new_daily = MenuItemBuilder::with_id("new_daily", "New Daily Log")
        .accelerator("CmdOrCtrl+Shift+D")
        .build(handle)?;
    let open_vault = MenuItemBuilder::with_id("open_vault", "Open Vault...")
        .accelerator("CmdOrCtrl+O")
        .build(handle)?;
    let save_note = MenuItemBuilder::with_id("save_note", "Save Note")
        .accelerator("CmdOrCtrl+S")
        .build(handle)?;
    let close_note = MenuItemBuilder::with_id("close_note", "Close Note")
        .accelerator("CmdOrCtrl+W")
        .build(handle)?;
    let reveal_note = MenuItemBuilder::with_id("reveal_note", "Reveal in Finder / Explorer")
        .accelerator("CmdOrCtrl+Shift+R")
        .build(handle)?;

    let file_menu = SubmenuBuilder::new(handle, "File")
        .item(&new_note)
        .item(&new_daily)
        .item(&open_vault)
        .separator()
        .item(&save_note)
        .item(&close_note)
        .separator()
        .item(&reveal_note)
        .build()?;

    // Edit Menu
    let open_palette = MenuItemBuilder::with_id("open_palette", "Command Palette...")
        .accelerator("CmdOrCtrl+K")
        .build(handle)?;

    let edit_menu = SubmenuBuilder::new(handle, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&open_palette)
        .build()?;

    // View Menu
    let v_editor = MenuItemBuilder::with_id("view_editor", "Editor")
        .accelerator("CmdOrCtrl+1")
        .build(handle)?;
    let v_canvas = MenuItemBuilder::with_id("view_canvas", "Canvas")
        .accelerator("CmdOrCtrl+2")
        .build(handle)?;
    let v_graph = MenuItemBuilder::with_id("view_graph", "Knowledge Graph")
        .accelerator("CmdOrCtrl+3")
        .build(handle)?;
    let v_calendar = MenuItemBuilder::with_id("view_calendar", "Calendar")
        .accelerator("CmdOrCtrl+4")
        .build(handle)?;
    let v_tasks = MenuItemBuilder::with_id("view_tasks", "Task Manager")
        .accelerator("CmdOrCtrl+5")
        .build(handle)?;
    let v_board = MenuItemBuilder::with_id("view_board", "Kanban Board")
        .accelerator("CmdOrCtrl+6")
        .build(handle)?;
    let v_flashcards = MenuItemBuilder::with_id("view_flashcards", "Flashcard Review")
        .accelerator("CmdOrCtrl+7")
        .build(handle)?;

    let toggle_chat = MenuItemBuilder::with_id("toggle_chat", "Toggle KogNote AI Chat")
        .accelerator("CmdOrCtrl+Shift+C")
        .build(handle)?;
    let toggle_sidebar = MenuItemBuilder::with_id("toggle_sidebar", "Toggle Sidebar")
        .accelerator("CmdOrCtrl+\\")
        .build(handle)?;

    let view_menu = SubmenuBuilder::new(handle, "View")
        .item(&v_editor)
        .item(&v_canvas)
        .item(&v_graph)
        .item(&v_calendar)
        .item(&v_tasks)
        .item(&v_board)
        .item(&v_flashcards)
        .separator()
        .item(&toggle_chat)
        .item(&toggle_sidebar)
        .separator()
        .fullscreen()
        .build()?;

    // Window Menu
    let window_menu = SubmenuBuilder::new(handle, "Window")
        .minimize()
        .maximize()
        .separator()
        .bring_all_to_front()
        .build()?;

    // Help Menu
    let open_docs = MenuItemBuilder::with_id("open_docs", "Kognote Documentation")
        .build(handle)?;
    let open_shortcuts = MenuItemBuilder::with_id("open_shortcuts", "Keyboard Shortcuts")
        .build(handle)?;

    let help_menu = SubmenuBuilder::new(handle, "Help")
        .item(&open_docs)
        .item(&open_shortcuts)
        .build()?;

    #[allow(unused_mut)]
    let mut builder = MenuBuilder::new(handle);

    #[cfg(target_os = "macos")]
    {
        let settings = MenuItemBuilder::with_id("settings", "Preferences...")
            .accelerator("CmdOrCtrl+,")
            .build(handle)?;

        let app_menu = SubmenuBuilder::new(handle, "Kognote")
            .about(None)
            .separator()
            .item(&settings)
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;

        builder = builder.item(&app_menu);
    }

    let menu = builder
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()?;

    Ok(menu)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let llm_state = Arc::new(LlmState::new());
    let db_state = DbState::new();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_stronghold::Builder::new(|password| {
            use sha2::{Sha256, Digest};
            let mut hasher = Sha256::new();
            hasher.update(password.as_bytes());
            let result = hasher.finalize();
            let mut key = [0u8; 32];
            key.copy_from_slice(&result);
            key.to_vec()
        }).build())
        .manage(llm_state)
        .manage(db_state)
        .manage(WatcherState::new())
        .setup(|app| {
            let handle = app.handle();

            #[cfg(target_os = "macos")]
            if let Ok(menu) = build_app_menu(handle) {
                let _ = app.set_menu(menu);
            }

            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                {
                    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
                    let _ = apply_vibrancy(
                        &window,
                        NSVisualEffectMaterial::UnderWindowBackground,
                        Some(NSVisualEffectState::Active),
                        None,
                    );
                }

                #[cfg(target_os = "windows")]
                {
                    use window_vibrancy::{apply_mica, apply_acrylic, apply_blur};
                    if apply_mica(&window, None).is_err() {
                        if apply_acrylic(&window, Some((18, 19, 28, 125))).is_err() {
                            let _ = apply_blur(&window, Some((18, 19, 28, 125)));
                        }
                    }
                }

                #[cfg(target_os = "linux")]
                {
                    // Linux GTK transparency / dark window fallback
                    let _ = window.set_background_color(Some(tauri::Color(9, 10, 15, 255)));
                }

                let _ = window.show();
                let _ = window.set_focus();
            }

            let db_state = handle.state::<DbState>();
            if let Err(err) = db::init_db(handle, &db_state) {
                eprintln!("Failed to initialize vector database: {}", err);
            }

            Ok(())
        })
        .on_menu_event(|app_handle, event| {
            use tauri::Emitter;
            let id = event.id().as_ref();
            let _ = app_handle.emit("menu_action", id);
        })
        .invoke_handler(tauri::generate_handler![
            // File system commands
            list_vault_files,
            read_note,
            write_note,
            create_note,
            create_folder,
            delete_note,
            purge_expired_trash,
            rename_note,
            fetch_ical,
            fs_exists,
            fs_mkdir,
            fs_write,
            fs_read,
            fs_write_base64,
            fs_copy,
            reveal_in_finder,
            open_with_default,
            sweep_orphaned_attachments,
            parse_note_metadata,
            sync_note_blocks,
            update_block_status,
            run_block_query,
            scan_vault_delta,
            vault_scanner::scan_vault_tasks,
            // LLM commands
            llm_list_models,
            llm_get_system_info,
            llm_check_model,
            llm_download_model,
            llm_delete_model,
            llm_ensure_runtime,
            llm_load_model,
            llm_unload_model,
            llm_generate,
            llm_generate_stream,
            llm_current_model,
            llm_check_connection,
            // Vector search & Database commands
            init_vector_db,
            vector_upsert,
            vector_upsert_batch,
            vector_delete,
            vector_search,
            vector_get_semantic_connections,
            vector_find_backlinks,
            db_save_note_metadata,
            db_get_note_metadata,
            db_get_all_note_metadata,
            db_delete_note_metadata,
            db_clear_all_metadata,
            db_save_ai_suggestions,
            db_get_ai_suggestions,
            db_get_all_ai_suggestions,
            db_sync_note_links,
            db_get_backlinks,
            db_get_backlink_file_paths,
            db::db_get_all_backlinks_batch,
            db::db_save_fsrs_state,
            db::db_get_fsrs_states,
            db::db_get_pending_ai_suggestions,
            db::db_update_ai_suggestion_status,
            // Watcher commands
            watcher::watch_vault,
            watcher::unwatch_vault,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                let tauri_state = app_handle.state::<Arc<LlmState>>();
                if let Ok(mut guard) = tauri_state.server_process.lock() {
                    if let Some(mut child) = guard.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                };
                #[cfg(target_os = "windows")]
                {
                    use std::os::windows::process::CommandExt;
                    use std::process::Stdio;
                    let _ = std::process::Command::new("taskkill")
                        .args(&["/F", "/IM", "llama-server.exe"])
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .creation_flags(0x08000000)
                        .status();
                }
            }
            _ => {}
        });
}

