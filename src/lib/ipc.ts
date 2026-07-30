import { invoke } from "@tauri-apps/api/core";
import { FileEntry } from "../contexts/VaultContext";

// Type definitions for all Rust IPC commands in Kognote
export interface IPCCommands {
  list_vault_files: {
    args: { vaultPath: string };
    response: FileEntry[];
  };
  read_note: {
    args: { path: string; passphrase?: string };
    response: string;
  };
  write_note: {
    args: { path: string; content: string; passphrase?: string };
    response: void;
  };
  create_note: {
    args: { path: string };
    response: void;
  };
  create_folder: {
    args: { path: string };
    response: void;
  };
  delete_note: {
    args: { path: string };
    response: void;
  };
  purge_expired_trash: {
    args: { vaultPath: string; maxAgeHours?: number; maxAgeDays?: number };
    response: number;
  };
  scan_vault_delta: {
    args: {
      vaultPath: string;
      knownMtimes: Record<string, number>;
    };
    response: {
      updated: Array<{
        path: string;
        name: string;
        modified_at: number;
        content: string;
        metadata: {
          tags: string[];
          links: string[];
          urls: string[];
          tasks: Array<{
            id: string;
            content: string;
            completed: boolean;
            lineNumber: number;
            dueDate?: string;
            tags: string[];
          }>;
          dateRefs: Array<{
            date: string;
            context: string;
          }>;
          boardStatus?: string;
          boardPriority?: string;
          snippet: string;
          wordCount: number;
        };
      }>;
      deleted_paths: string[];
      total_files: number;
    };
  };
  rename_note: {
    args: { oldPath: string; newPath: string };
    response: void;
  };
  check_passphrase: {
    args: { path: string; passphrase: string };
    response: boolean;
  };
  fetch_ical: {
    args: { url: string };
    response: string;
  };
  fs_exists: {
    args: { path: string };
    response: boolean;
  };
  fs_mkdir: {
    args: { path: string };
    response: void;
  };
  fs_write: {
    args: { path: string; content: string };
    response: void;
  };
  fs_read: {
    args: { path: string };
    response: string;
  };
  fs_write_base64: {
    args: { path: string; data: string };
    response: void;
  };
  fs_copy: {
    args: { src: string; dest: string };
    response: void;
  };
  reveal_in_finder: {
    args: { path: string };
    response: void;
  };
  open_with_default: {
    args: { path: string };
    response: void;
  };
  watch_vault: {
    args: { vaultPath: string };
    response: void;
  };
  unwatch_vault: {
    args: Record<string, never>;
    response: void;
  };
  sync_note_blocks: {
    args: { filePath: string; content: string };
    response: string;
  };
  update_block_status: {
    args: { blockId: string; status: string };
    response: void;
  };
  run_block_query: {
    args: { query: string };
    response: any[];
  };
  db_save_fsrs_state: {
    args: {
      cardId: string;
      notePath: string;
      question: string;
      answer: string;
      stability: number;
      difficulty: number;
      dueDate: string;
      cardState: number;
      repetition: number;
      interval: number;
      lastReview?: string;
    };
    response: void;
  };
  db_get_fsrs_states: {
    args: Record<string, never>;
    response: any[];
  };
  db_get_pending_ai_suggestions: {
    args: { notePath?: string };
    response: any[];
  };
  db_update_ai_suggestion_status: {
    args: { id: string; status: string };
    response: void;
  };
  llm_check_connection: {
    args: Record<string, never>;
    response: boolean;
  };
}

/**
 * Strongly typed wrapper around Tauri's invoke API.
 * Catches typos and incorrect argument types at compile time.
 */
export async function invokeIPC<K extends keyof IPCCommands>(
  command: K,
  args: IPCCommands[K]["args"]
): Promise<IPCCommands[K]["response"]> {
  try {
    return await invoke<IPCCommands[K]["response"]>(command, args);
  } catch (err: any) {
    console.error(`IPC Command '${command}' failed:`, err);
    throw err;
  }
}
