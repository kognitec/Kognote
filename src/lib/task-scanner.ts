import { invokeIPC } from "./ipc";
import { FileEntry } from "../contexts/VaultContext";
import { ensureAndSyncFrontmatter, getZonedDateParts } from "./frontmatter";

export interface ScannedTask {
  id: string;
  notePath: string;
  noteName: string;
  content: string;
  completed: boolean;
  lineNumber: number; // 0-indexed line number in the note
  dueDate?: string; // YYYY-MM-DD
  dueTime?: string; // HH:MM
  rawDueDate?: string; // Original raw ISO UTC string if present
  tags: string[];
  priority: "high" | "medium" | "low" | "none";
}

export interface ScannedDateReference {
  id: string;
  notePath: string;
  noteName: string;
  date: string; // YYYY-MM-DD
  context: string; // Surrounding text/line snippet
}

export interface ScanOptions {
  includeArchived?: boolean;
  includeTrash?: boolean;
}

export function isArchivedPath(path: string): boolean {
  const norm = path.toLowerCase().replace(/\\/g, "/");
  return norm.includes("/archived/") || norm.includes("/archive/") || norm.endsWith("/archived") || norm.endsWith("/archive");
}

export function isTrashPath(path: string): boolean {
  const norm = path.toLowerCase().replace(/\\/g, "/");
  return norm.includes("/trash/") || norm.includes("/.deleted/") || norm.endsWith("/trash") || norm.endsWith("/.deleted");
}

export function isTemplatePath(path: string): boolean {
  const norm = path.toLowerCase().replace(/\\/g, "/");
  return norm.includes("/templates/") || norm.includes("/template/") || norm.endsWith("/templates") || norm.endsWith("/template");
}

export function getAllMarkdownFiles(entries: FileEntry[], options?: ScanOptions): FileEntry[] {
  let list: FileEntry[] = [];
  for (const entry of entries) {
    if (!options?.includeArchived && isArchivedPath(entry.path)) continue;
    if (!options?.includeTrash && isTrashPath(entry.path)) continue;
    if (isTemplatePath(entry.path)) continue;

    if (entry.is_dir) {
      if (entry.children) {
        list = [...list, ...getAllMarkdownFiles(entry.children, options)];
      }
    } else if (entry.name.toLowerCase().endsWith(".md")) {
      list.push(entry);
    }
  }
  return list;
}

/**
 * Scans all Markdown notes in the vault for checklists and date mentions.
 * Uses high-speed native multi-threaded Rust parallel scanner with JS fallback.
 */
export async function scanVaultForTasksAndDates(
  entries: FileEntry[],
  options?: ScanOptions
): Promise<{ tasks: ScannedTask[]; dateRefs: ScannedDateReference[] }> {
  // Try native Rust parallel vault scanner first (100x faster for 20,000 notes)
  if (entries.length > 0) {
    let rootPath = entries[0]?.path || "";
    // Derive top-level vault root folder path
    const slashIdx = Math.max(rootPath.indexOf("/"), rootPath.indexOf("\\"));
    if (slashIdx > 0) {
      // Find root directory path
      const dirPath = rootPath.replace(/\\/g, "/");
      const parts = dirPath.split("/").filter(Boolean);
      if (parts.length > 1) {
        // Reconstruct root directory path
        const rootVaultDir = rootPath.startsWith("/") ? "/" + parts[0] : parts[0] + (rootPath.includes(":\\") ? ":\\" : "/");
        try {
          const res = (await invokeIPC("scan_vault_tasks", { vaultPath: rootVaultDir })) as unknown as {
            tasks: ScannedTask[];
            dateRefs: ScannedDateReference[];
          };
          if (res && Array.isArray(res.tasks) && Array.isArray(res.dateRefs)) {
            return res;
          }
        } catch (_e) {
          // Fallback to JS loop if native command is unavailable
        }
      }
    }
  }

  const mdFiles = getAllMarkdownFiles(entries, options);
  const tasks: ScannedTask[] = [];
  const dateRefs: ScannedDateReference[] = [];

  // Match both "- [ ]" and "* [ ]" bullet styles (Milkdown uses asterisk)
  const checkboxRegex = /^\s*[-*]\s*\[([ xX])\]\s+(.+)$/;
  const tagRegex = /(?:^|\s|\\)#([a-zA-Z0-9_\-\/]+)/g;

  for (const file of mdFiles) {
    try {
      const text = await invokeIPC("read_note", {
        path: file.path,
      });

      // Frontmatter storage & type state checks
      if (!options?.includeArchived && /storage:\s*["']?archived["']?/i.test(text)) continue;
      if (!options?.includeTrash && /storage:\s*["']?deleted["']?/i.test(text)) continue;
      if (/type:\s*["']?template["']?/i.test(text) || isTemplatePath(file.path)) continue;

      if (!text) continue;

      // Extract frontmatter due: YYYY-MM-DD for Kanban board cards & notes
      const frontmatterMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      if (frontmatterMatch) {
        const yamlText = frontmatterMatch[1];
        const dueMatch = yamlText.match(/^due:\s*["']?([^"\r\n]+)["']?/m);
        if (dueMatch && dueMatch[1]) {
          const val = dueMatch[1].trim();
          let stdDate = "";
          const d = new Date(val);
          if (!isNaN(d.getTime())) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, "0");
            const day = String(d.getDate()).padStart(2, "0");
            stdDate = `${y}-${m}-${day}`;
          } else {
            const mDate = val.match(/^(20\d{2}[-/]\d{2}[-/]\d{2})/);
            if (mDate) stdDate = mDate[1].replace(/\//g, "-");
          }
          if (stdDate) {
            dateRefs.push({
              id: `${file.path}:frontmatter:${stdDate}`,
              notePath: file.path,
              noteName: file.name.replace(/\.md$/, ""),
              date: stdDate,
              context: `Kanban Due: ${file.name.replace(/\.md$/, "")}`,
            });
          }
        }
      }

      const lines = text.split(/\r?\n/);
      for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];

        // 1. Check for checklists (Tasks)
        const match = line.match(checkboxRegex);
        if (match) {
          const completed = match[1].toLowerCase() === "x";
          const rawContent = match[2];

          // Extract tags from task line (e.g. #work, #in-progress, #dept/tech)
          const tags: string[] = [];
          const tagMatches = rawContent.match(tagRegex);
          if (tagMatches) {
            tagMatches.forEach((t) => {
              const hashIdx = t.indexOf("#");
              if (hashIdx !== -1) {
                const tagVal = t.substring(hashIdx + 1).toLowerCase();
                if (!tags.includes(tagVal)) tags.push(tagVal);
              }
            });
          }

          // Extract date & optional time from task line (e.g. @2026-07-15, @2026-08-01T09:30:00.000Z, @2026-07-15 14:30)
          let dueDate: string | undefined = undefined;
          let dueTime: string | undefined = undefined;
          let rawDueDate: string | undefined = undefined;
          const isoMatch = line.match(/(?:@due:?|@|due:\s*)?(20\d{2}[-/]\d{2}[-/]\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/i);
          if (isoMatch && isoMatch[1]) {
            rawDueDate = isoMatch[1];
            const { dateStr, timeStr } = getZonedDateParts(rawDueDate);
            dueDate = dateStr;
            dueTime = timeStr;
          } else {
            const dateTimeRegex = /(?:@due:?|@|due:\s*)?(20\d{2}[-/](?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01]))(?:[ T]([01]\d|2[0-3]):([0-5]\d))?/i;
            const dtMatch = line.match(dateTimeRegex);
            if (dtMatch && dtMatch[1]) {
              dueDate = dtMatch[1].replace(/\//g, "-");
              if (dtMatch[2] && dtMatch[3]) {
                dueTime = `${dtMatch[2]}:${dtMatch[3]}`;
              }
            }
          }

          // Extract task priority: !!! = high, !! = medium, ! = low, none = no priority
          let priority: "high" | "medium" | "low" | "none" = "none";
          if (/@task!!!|(?:\b|\s|^)!!!(?:\b|\s|$)/i.test(rawContent)) {
            priority = "high";
          } else if (/@task!!|(?:\b|\s|^)!!(?:\b|\s|$)/i.test(rawContent)) {
            priority = "medium";
          } else if (/@task!|(?:\b|\s|^)!(?:\b|\s|$)/i.test(rawContent)) {
            priority = "low";
          }

          // Clean up the task content string for display
          let cleanContent = rawContent
            .replace(/<(https?:\/\/[^>]+)>/g, (_, url) => url)
            .replace(/(?:^|\s|\\)#([a-zA-Z0-9_\-\/]+)/g, "")
            .replace(/(?:@due:?|@|due:\s*)?20\d{2}[-/]\d{2}[-/]\d{2}(?:T[^\s]+|[ T]\d{2}:\d{2})?/gi, "")
            .replace(/@task(!*)/gi, "")
            .replace(/(?:\b|\s|^)!{1,3}(?:\b|\s|$)/g, " ")
            .replace(/\s+/g, " ")
            .trim();

          tasks.push({
            id: `${file.path}:${idx}`,
            notePath: file.path,
            noteName: file.name.replace(/\.md$/, ""),
            content: cleanContent || rawContent.trim(),
            completed,
            lineNumber: idx,
            dueDate,
            dueTime,
            rawDueDate,
            tags,
            priority
          });
        } else {
          // 2. Scan regular lines for general date mentions (interconnection)
          const globalDateRegex = /(?:@due:?|@|due:\s*)?(20\d{2}[-/](?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01]))/g;
          let match: RegExpExecArray | null;
          while ((match = globalDateRegex.exec(line)) !== null) {
            if (match[1]) {
              const stdDate = match[1].replace(/\//g, "-");
              dateRefs.push({
                id: `${file.path}:${idx}:${stdDate}`,
                notePath: file.path,
                noteName: file.name.replace(/\.md$/, ""),
                date: stdDate,
                context: line.replace(globalDateRegex, "").trim() || `Mentioned in ${file.name}`,
              });
            }
          }
        }
      }
    } catch (err) {
      // Skip unreadable file
      console.warn(`Skipping task scan for file ${file.path}:`, err);
    }
  }

  return { tasks, dateRefs };
}

function cleanForMatching(str: string): string {
  return str
    .toLowerCase()
    .replace(/@task(!*)/gi, "")
    .replace(/(?:\b|\s|^)!{1,3}(?:\b|\s|$)/g, " ")
    .replace(/(?:@due:?|@|due:\s*)?20\d{2}[-/]\d{2}[-/]\d{2}(?:T[^\s]+|[ T]\d{2}:\d{2})?/gi, "")
    .replace(/#([a-zA-Z0-9_\-\/]+)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Toggles a task's completion status ([ ] <-> [x]) in the markdown file. */
export async function toggleTaskInNote(
  task: ScannedTask,
): Promise<string | void> {
  try {
    const text = await invokeIPC("read_note", {
      path: task.notePath,
    });

    const lines = text.split(/\r?\n/);
    let targetIndex = task.lineNumber;

    const checkboxRegex = /^\s*[-*]\s*\[([ xX])\]\s+(.+)$/;

    // Verify if line at task.lineNumber matches task content
    const isValidLine = (idx: number): boolean => {
      if (idx < 0 || idx >= lines.length) return false;
      const m = lines[idx].match(checkboxRegex);
      if (!m) return false;
      const cleanedLine = cleanForMatching(m[2]);
      const cleanedTask = cleanForMatching(task.content);
      if (!cleanedTask) return true;
      return cleanedLine.includes(cleanedTask) || cleanedTask.includes(cleanedLine);
    };

    if (!isValidLine(targetIndex)) {
      // Line shifted due to editing: search full document for matching task content
      const foundIdx = lines.findIndex((l) => {
        const m = l.match(checkboxRegex);
        if (!m) return false;
        const cleanedLine = cleanForMatching(m[2]);
        const cleanedTask = cleanForMatching(task.content);
        if (!cleanedTask) return false;
        return cleanedLine.includes(cleanedTask) || cleanedTask.includes(cleanedLine);
      });
      if (foundIdx !== -1) {
        targetIndex = foundIdx;
      }
    }

    if (targetIndex >= 0 && targetIndex < lines.length) {
      const line = lines[targetIndex];
      const newStatus = task.completed ? " " : "x";
      const updatedLine = line.replace(/^(\s*[-*]\s*\[)([ xX])(\])/, (_, prefix, _status, suffix) => {
        return `${prefix}${newStatus}${suffix}`;
      });
      lines[targetIndex] = updatedLine;
      const rawContent = lines.join("\n");
      const { fullContent: updatedContent } = ensureAndSyncFrontmatter(rawContent, {
        forceUpdateTimestamp: true,
      });

      await invokeIPC("write_note", {
        path: task.notePath,
        content: updatedContent,
      });

      return updatedContent;
    }
  } catch (err) {
    console.error("Failed to write toggled task status to note:", err);
    throw err;
  }
}

/** Updates a task's priority (none, !, !!, !!!) inside the markdown file. */
export async function updateTaskPriorityInNote(
  task: ScannedTask,
  newPriority: "high" | "medium" | "low" | "none",
): Promise<string | void> {
  try {
    const text = await invokeIPC("read_note", {
      path: task.notePath,
    });

    const lines = text.split(/\r?\n/);
    let targetIndex = task.lineNumber;
    const checkboxRegex = /^\s*[-*]\s*\[([ xX])\]\s+(.+)$/;

    const isValidLine = (idx: number): boolean => {
      if (idx < 0 || idx >= lines.length) return false;
      const m = lines[idx].match(checkboxRegex);
      if (!m) return false;
      const cleanedLine = cleanForMatching(m[2]);
      const cleanedTask = cleanForMatching(task.content);
      if (!cleanedTask) return true;
      return cleanedLine.includes(cleanedTask) || cleanedTask.includes(cleanedLine);
    };

    if (!isValidLine(targetIndex)) {
      const foundIdx = lines.findIndex((l) => {
        const m = l.match(checkboxRegex);
        if (!m) return false;
        const cleanedLine = cleanForMatching(m[2]);
        const cleanedTask = cleanForMatching(task.content);
        if (!cleanedTask) return false;
        return cleanedLine.includes(cleanedTask) || cleanedTask.includes(cleanedLine);
      });
      if (foundIdx !== -1) {
        targetIndex = foundIdx;
      }
    }

    if (targetIndex >= 0 && targetIndex < lines.length) {
      let line = lines[targetIndex];

      let newToken = "";
      if (newPriority === "high") newToken = "!!!";
      else if (newPriority === "medium") newToken = "!!";
      else if (newPriority === "low") newToken = "!";

      // Remove existing legacy @task! or standalone exclamations !, !!, !!!
      if (/@task(!*)/i.test(line)) {
        line = line.replace(/@task(!*)/gi, newToken ? `${newToken}` : "").trim();
      } else if (/(?:\b|\s|^)!{1,3}(?:\b|\s|$)/.test(line)) {
        line = line.replace(/(?:\b|\s|^)!{1,3}(?:\b|\s|$)/, newToken ? ` ${newToken} ` : " ").trim();
      } else if (newToken) {
        line = `${line.trimEnd()} ${newToken}`;
      }

      lines[targetIndex] = line;
      const rawContent = lines.join("\n");
      const { fullContent: updatedContent } = ensureAndSyncFrontmatter(rawContent, {
        forceUpdateTimestamp: true,
      });

      await invokeIPC("write_note", {
        path: task.notePath,
        content: updatedContent,
      });

      return updatedContent;
    }
  } catch (err) {
    console.error("Failed to update task priority in note:", err);
    throw err;
  }
}
