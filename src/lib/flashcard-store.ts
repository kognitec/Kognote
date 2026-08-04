import { invokeIPC } from "./ipc";
import { writeTextFile, readTextFile, exists, mkdir } from "@tauri-apps/plugin-fs";
import { parseFlashcards, Flashcard } from "./flashcard-parser";
import { FileEntry } from "../contexts/VaultContext";
import { ScanOptions, isArchivedPath, isTrashPath, isTemplatePath } from "./task-scanner";
import { parseFrontmatter, ensureAndSyncFrontmatter } from "./frontmatter";

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
  public noteMetaMap: Map<string, { dueDate?: string; priority?: string }> = new Map();

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

      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const dd = String(now.getDate()).padStart(2, "0");
      const today = `${yyyy}-${mm}-${dd}`;
      history[today] = (history[today] || 0) + count;

      const jsonStr = JSON.stringify({ progress, history }, null, 2);
      await writeTextFile(progressFilePath, jsonStr);
    } catch (err) {
      console.error("Failed to log flashcard session history:", err);
    }
  }

  // Update card content directly inside the source markdown file
  async updateFlashcardInNote(card: Flashcard, newFront: string, newBack: string): Promise<boolean> {
    if (!card.filePath) return false;
    try {
      const content = await invokeIPC("read_note", { path: card.filePath }) as string;
      if (!content) return false;

      const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern1 = new RegExp(`@flashcards?\\s*\\(\\s*${escapeRegex(card.front)}\\s*::\\s*${escapeRegex(card.back)}\\s*\\)`, "i");

      const newText = `@flashcard (${newFront.trim()} :: ${newBack.trim()})`;
      let updatedContent = content;

      if (pattern1.test(content)) {
        updatedContent = content.replace(pattern1, newText);
      } else {
        const patternFront = new RegExp(`@flashcards?\\s*\\(\\s*${escapeRegex(card.front)}\\s*::[\\s\\S]*?\\)`, "i");
        if (patternFront.test(content)) {
          updatedContent = content.replace(patternFront, newText);
        }
      }

      if (updatedContent !== content) {
        const syncedContent = ensureAndSyncFrontmatter(updatedContent, { forceUpdateTimestamp: true }).fullContent;
        await invokeIPC("write_note", { path: card.filePath, content: syncedContent });
        window.dispatchEvent(new CustomEvent("reload-active-file", { detail: { path: card.filePath } }));
        window.dispatchEvent(new CustomEvent("vault-file-changed", { detail: { path: card.filePath } }));
        return true;
      }
    } catch (err) {
      console.error("Failed to update flashcard in note:", err);
    }
    return false;
  }

  // Remove card syntax line directly from the source markdown file
  async deleteFlashcardFromNote(card: Flashcard): Promise<boolean> {
    if (!card.filePath) return false;
    try {
      const content = await invokeIPC("read_note", { path: card.filePath }) as string;
      if (!content) return false;

      const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const pattern1 = new RegExp(`[\\t ]*@flashcards?\\s*\\(\\s*${escapeRegex(card.front)}\\s*::\\s*${escapeRegex(card.back)}\\s*\\)[\\t ]*\\r?\\n?`, "i");

      let updatedContent = content;
      if (pattern1.test(content)) {
        updatedContent = content.replace(pattern1, "");
      } else {
        const patternFront = new RegExp(`[\\t ]*@flashcards?\\s*\\(\\s*${escapeRegex(card.front)}\\s*::[\\s\\S]*?\\)[\\t ]*\\r?\\n?`, "i");
        if (patternFront.test(content)) {
          updatedContent = content.replace(patternFront, "");
        }
      }

      if (updatedContent !== content) {
        const syncedContent = ensureAndSyncFrontmatter(updatedContent, { forceUpdateTimestamp: true }).fullContent;
        await invokeIPC("write_note", { path: card.filePath, content: syncedContent });
        window.dispatchEvent(new CustomEvent("reload-active-file", { detail: { path: card.filePath } }));
        window.dispatchEvent(new CustomEvent("vault-file-changed", { detail: { path: card.filePath } }));
        return true;
      }
    } catch (err) {
      console.error("Failed to delete flashcard from note:", err);
    }
    return false;
  }

  // Helper to flatten recursive FileEntry list into a flat list of absolute file paths
  private flattenFiles(items: FileEntry[], options?: ScanOptions): string[] {
    let flat: string[] = [];
    for (const item of items) {
      if (!options?.includeArchived && isArchivedPath(item.path)) continue;
      if (!options?.includeTrash && isTrashPath(item.path)) continue;
      if (isTemplatePath(item.path)) continue;

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

  // Replace or append flashcard lines in a target note file
  async replaceOrAppendFlashcardsInNote(
    filePath: string,
    newCards: { front: string; back: string }[],
    mode: "replace" | "append"
  ): Promise<boolean> {
    if (!filePath || newCards.length === 0) return false;
    try {
      let content = (await invokeIPC("read_note", { path: filePath })) as string;
      if (typeof content !== "string") content = "";

      if (mode === "replace") {
        // Strip out existing @flashcard (...) lines
        content = content
          .replace(/[\t ]*@flashcards?\s*\([\s\S]*?::[\s\S]*?\)\r?\n?/gi, "")
          .trimEnd();
      }

      const formattedNewCards = newCards
        .map((c) => `@flashcard (${c.front.trim()} :: ${c.back.trim()})`)
        .join("\n");

      const hasContent = content.trim().length > 0;
      const updatedContent = hasContent
        ? `${content.trimEnd()}\n\n${formattedNewCards}\n`
        : `${formattedNewCards}\n`;

      const syncedContent = ensureAndSyncFrontmatter(updatedContent, { forceUpdateTimestamp: true }).fullContent;
      await invokeIPC("write_note", { path: filePath, content: syncedContent });
      window.dispatchEvent(new CustomEvent("reload-active-file", { detail: { path: filePath } }));
      window.dispatchEvent(new CustomEvent("vault-file-changed", { detail: { path: filePath } }));
      return true;
    } catch (err) {
      console.error("Failed to replace or append flashcards in note:", err);
      return false;
    }
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
          if (/type:\s*["']?template["']?/i.test(content) || isTemplatePath(filePath)) continue;

          // Parse frontmatter due date & priority if present
          const parsedFm = parseFrontmatter(content);
          let noteDueDate: string | undefined = undefined;
          if (parsedFm.fields.due) {
            const clean = parsedFm.fields.due.trim().replace(/^@/, "");
            if (/^\d{4}-\d{2}-\d{2}/.test(clean)) {
              noteDueDate = clean.substring(0, 10);
            }
          }
          const notePriority = parsedFm.fields.priority && parsedFm.fields.priority !== "none" ? parsedFm.fields.priority : undefined;

          this.noteMetaMap.set(filePath, { dueDate: noteDueDate, priority: notePriority });

          const cards = parseFlashcards(content, filePath);
          
          // Merge historical progress metadata if it exists
          for (const card of cards) {
            card.noteDueDate = noteDueDate;
            card.notePriority = notePriority;
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
