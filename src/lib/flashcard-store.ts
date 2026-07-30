import { invokeIPC } from "./ipc";
import { writeTextFile, readTextFile, exists, mkdir } from "@tauri-apps/plugin-fs";
import { parseFlashcards, Flashcard } from "./flashcard-parser";
import { FileEntry } from "../contexts/VaultContext";
import { ScanOptions, isArchivedPath, isTrashPath } from "./task-scanner";

interface ProgressItem {
  interval: number;
  repetition: number;
  efactor: number;
  nextReviewDate: string;
  stability?: number;
  difficulty?: number;
  state?: number;
}

export class FlashcardStore {
  private vaultPath: string = "";

  setVaultPath(path: string) {
    this.vaultPath = path;
  }

  private getPaths() {
    const separator = this.vaultPath.includes("\\") ? "\\" : "/";
    const metaFolder = `${this.vaultPath}${separator}.vault-meta`;
    const progressFilePath = `${metaFolder}${separator}flashcards.json`;
    return { metaFolder, progressFilePath };
  }

  // Load progress history map from native SQLite database
  async loadProgress(): Promise<Record<string, ProgressItem>> {
    try {
      const rows = await invokeIPC("db_get_fsrs_states", {}) as any[];
      const map: Record<string, ProgressItem> = {};
      (rows || []).forEach(r => {
        map[r.cardId] = {
          interval: r.interval,
          repetition: r.repetition,
          efactor: 2.5,
          nextReviewDate: r.dueDate,
          stability: r.stability,
          difficulty: r.difficulty,
          state: r.state,
        };
      });
      return map;
    } catch (err) {
      console.error("Failed to load flashcard progress from SQLite:", err);
      return {};
    }
  }

  // Load study history log
  async loadHistory(): Promise<Record<string, number>> {
    if (!this.vaultPath) return {};
    const { progressFilePath } = this.getPaths();

    try {
      const fileExists = await exists(progressFilePath);
      if (!fileExists) return {};

      const jsonStr = await readTextFile(progressFilePath);
      if (!jsonStr) return {};

      const parsed = JSON.parse(jsonStr);
      return parsed.history || {};
    } catch (err) {
      console.error("Failed to load flashcard history:", err);
      return {};
    }
  }

  // Save progress history map directly to native SQLite database
  async saveProgress(progress: Record<string, ProgressItem>, cards?: Flashcard[]) {
    try {
      for (const [cardId, item] of Object.entries(progress)) {
        const cardObj = cards?.find(c => c.id === cardId);
        await invokeIPC("db_save_fsrs_state", {
          cardId,
          notePath: cardObj?.filePath || "",
          question: cardObj?.front || "",
          answer: cardObj?.back || "",
          stability: item.stability || 0.0,
          difficulty: item.difficulty || 0.0,
          dueDate: item.nextReviewDate,
          cardState: item.state || 0,
          repetition: item.repetition || 0,
          interval: item.interval || 0,
          lastReview: new Date().toISOString(),
        });
      }
    } catch (err) {
      console.error("Failed to save flashcard progress to SQLite:", err);
    }
  }

  // Accumulate studied cards in log history for today
  async logSession(count: number) {
    if (!this.vaultPath || count <= 0) return;
    const { metaFolder, progressFilePath } = this.getPaths();

    try {
      const folderExists = await exists(metaFolder);
      if (!folderExists) {
        await mkdir(metaFolder);
      }

      let progress: Record<string, ProgressItem> = {};
      let history: Record<string, number> = {};

      const fileExists = await exists(progressFilePath);
      if (fileExists) {
        const jsonStr = await readTextFile(progressFilePath);
        if (jsonStr) {
          const parsed = JSON.parse(jsonStr);
          progress = parsed.progress || {};
          history = parsed.history || {};
        }
      }

      const today = new Date().toISOString().split("T")[0];
      history[today] = (history[today] || 0) + count;

      const jsonStr = JSON.stringify({ progress, history }, null, 2);
      await writeTextFile(progressFilePath, jsonStr);
    } catch (err) {
      console.error("Failed to log flashcard session history:", err);
    }
  }

  // Helper to flatten recursive FileEntry list into a flat list of absolute file paths
  private flattenFiles(items: FileEntry[], options?: ScanOptions): string[] {
    let flat: string[] = [];
    for (const item of items) {
      if (!options?.includeArchived && isArchivedPath(item.path)) continue;
      if (!options?.includeTrash && isTrashPath(item.path)) continue;

      if (item.is_dir) {
        if (item.children) {
          flat = flat.concat(this.flattenFiles(item.children, options));
        }
      } else if (item.name.endsWith(".md")) {
        flat.push(item.path);
      }
    }
    return flat;
  }

  // Scans all files, parses flashcards, and merges progress history
  async syncFlashcards(files: FileEntry[], options?: ScanOptions): Promise<Flashcard[]> {
    if (!this.vaultPath) return [];

    try {
      const progressMap = await this.loadProgress();
      const filePaths = this.flattenFiles(files, options);
      const allCards: Flashcard[] = [];

      for (const filePath of filePaths) {
        try {
          const content = await invokeIPC("read_note", {
            path: filePath,
          }) as string;

          if (!content) continue;
          if (!options?.includeArchived && /storage:\s*["']?archived["']?/i.test(content)) continue;
          if (!options?.includeTrash && /storage:\s*["']?deleted["']?/i.test(content)) continue;

          const cards = parseFlashcards(content, filePath);
          
          // Merge historical progress metadata if it exists
          for (const card of cards) {
            const history = progressMap[card.id];
            if (history) {
              card.interval = history.interval;
              card.repetition = history.repetition;
              card.efactor = history.efactor;
              card.nextReviewDate = history.nextReviewDate;
              card.stability = history.stability;
              card.difficulty = history.difficulty;
              card.state = history.state;
            }
            allCards.push(card);
          }
        } catch (err) {
          // Skip unreadable / locked files
          console.warn(`Flashcard sync skipped file: ${filePath}`, err);
        }
      }

      return allCards;
    } catch (err) {
      console.error("Failed to sync flashcards vault:", err);
      return [];
    }
  }
}

export const flashcardStore = new FlashcardStore();
