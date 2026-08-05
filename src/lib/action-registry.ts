import { invokeIPC } from "./ipc";
import { searchEngine } from "./search-engine";
import { DELETED_FOLDER } from "./vault-constants";

export interface ActionPayload {
  action: string;
  args: any;
  description: string;
}

export interface ActionHistoryRecord {
  id: string;
  action: string;
  targetPath: string;
  previousState: string | null;
  newState: string | null;
  timestamp: number;
}

async function resolveNotePath(nameOrPath: string, vaultPath: string): Promise<string> {
  if (!nameOrPath) return "";
  const separator = vaultPath.includes("\\") ? "\\" : "/";
  if (nameOrPath.includes("/") || nameOrPath.includes("\\")) {
    return nameOrPath;
  }
  const cleanName = nameOrPath.endsWith(".md") ? nameOrPath : `${nameOrPath}.md`;
  const rootCandidate = `${vaultPath}${separator}${cleanName}`;
  const exists = await invokeIPC("fs_exists", { path: rootCandidate }).catch(() => false);
  if (exists) return rootCandidate;

  try {
    const allMeta = await searchEngine.getAllNoteMetadata();
    const match = allMeta.find((m) => {
      const fileName = m.file_path.split(/[\/\\]/).pop() || "";
      return fileName.toLowerCase() === cleanName.toLowerCase();
    });
    if (match) return match.file_path;
  } catch {}

  return rootCandidate;
}

class ActionRegistry {
  private history: ActionHistoryRecord[] = [];

  /**
   * Central Action Bus: Executes vault actions for both UI user interactions
   * and AI Copilot tool executions. Automatically records rollback state.
   */
  async executeAction(
    actionName: string,
    args: any,
    vaultPath: string
  ): Promise<{ success: boolean; message: string; recordId?: string }> {
    const targetName = (args.name || args.oldName || args.noteName || args.path || "").toString().toLowerCase();
    const PROTECTED_FILES = ["agents.md", ".kognote"];
    if (PROTECTED_FILES.some((p) => targetName.endsWith(p) || targetName.includes(`/${p}`) || targetName.includes(`\\${p}`))) {
      return { success: false, message: `Access denied: Target "${targetName}" is a protected system file and cannot be modified.` };
    }

    const separator = vaultPath.includes("\\") ? "\\" : "/";

    try {
      switch (actionName) {
        case "create_note": {
          const name = args.name;
          if (!name) return { success: false, message: "Note name is required." };
          const cleanName = name.endsWith(".md") ? name : `${name}.md`;
          const path = args.path || `${vaultPath}${separator}${cleanName}`;
          const rawInitial = args.content || `# ${name.replace(/\.md$/, "")}\n`;
          const { ensureAndSyncFrontmatter } = await import("./frontmatter");
          const { fullContent: initialContent } = ensureAndSyncFrontmatter(rawInitial, {
            noteName: name.replace(/\.md$/, "")
          });

          await invokeIPC("write_note", { path, content: initialContent });
          await searchEngine.indexFile(path, initialContent).catch(() => {});

          const record: ActionHistoryRecord = {
            id: Math.random().toString(36).substring(7),
            action: "create_note",
            targetPath: path,
            previousState: null,
            newState: initialContent,
            timestamp: Date.now(),
          };
          this.history.push(record);

          window.dispatchEvent(new CustomEvent("reload-active-file", { detail: { path } }));
          return { success: true, message: `Created note **${cleanName}**`, recordId: record.id };
        }

        case "write_note":
        case "append_note": {
          const name = args.name || args.noteName;
          if (!name && !args.path) return { success: false, message: "Note name or path is required." };
          const path = args.path || (await resolveNotePath(name, vaultPath));
          const cleanName = path.split(/[\/\\]/).pop() || name;

          let previousContent: string | null = null;
          try {
            previousContent = await invokeIPC("read_note", { path });
          } catch {}

          let newContent = args.content || "";
          if (actionName === "append_note" && previousContent) {
            newContent = `${previousContent}\n\n${newContent}`;
          }

          await invokeIPC("write_note", { path, content: newContent });
          await searchEngine.indexFile(path, newContent).catch(() => {});

          const record: ActionHistoryRecord = {
            id: Math.random().toString(36).substring(7),
            action: actionName,
            targetPath: path,
            previousState: previousContent,
            newState: newContent,
            timestamp: Date.now(),
          };
          this.history.push(record);

          window.dispatchEvent(new CustomEvent("reload-active-file", { detail: { path } }));
          return {
            success: true,
            message: `${actionName === "append_note" ? "Appended to" : "Updated"} **${cleanName}**`,
            recordId: record.id,
          };
        }

        case "delete_note": {
          const name = args.name || args.noteName;
          if (!name && !args.path) return { success: false, message: "Note name or path is required." };
          const path = args.path || (await resolveNotePath(name, vaultPath));
          const cleanName = path.split(/[\/\\]/).pop() || name;

          let currentContent: string | null = null;
          try {
            currentContent = await invokeIPC("read_note", { path });
          } catch {}

          if (currentContent && path.endsWith(".md")) {
            const { ensureAndSyncFrontmatter } = await import("./frontmatter");
            const { fullContent: deletedContent } = ensureAndSyncFrontmatter(currentContent, {
              storage: "deleted",
              bookmarked: "no",
              forceUpdateTimestamp: true,
            });
            await invokeIPC("write_note", { path, content: deletedContent }).catch(() => {});
          }

          const trashDir = `${vaultPath}${separator}${DELETED_FOLDER}`;
          const trashPath = `${trashDir}${separator}${cleanName}`;

          const folderExists = await invokeIPC("fs_exists", { path: trashDir }).catch(() => false);
          if (!folderExists) {
            await invokeIPC("create_folder", { path: trashDir });
          }

          await invokeIPC("rename_note", { oldPath: path, newPath: trashPath });

          const record: ActionHistoryRecord = {
            id: Math.random().toString(36).substring(7),
            action: "delete_note",
            targetPath: path,
            previousState: currentContent,
            newState: null,
            timestamp: Date.now(),
          };
          this.history.push(record);

          return { success: true, message: `Moved **${cleanName}** to Trash`, recordId: record.id };
        }

        case "set_task_status": {
          const noteName = args.noteName || args.name;
          const taskText = args.taskText;
          const completed = args.completed === true;
          if (!noteName || !taskText) return { success: false, message: "noteName and taskText are required." };

          const path = args.path || (await resolveNotePath(noteName, vaultPath));
          const cleanName = path.split(/[\/\\]/).pop() || noteName;

          const currentContent = (await invokeIPC("read_note", { path })) as string;
          const lines = currentContent.split("\n");

          const cleanForMatch = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
          const targetClean = cleanForMatch(taskText);

          let updated = false;
          const newLines = lines.map((line) => {
            const match = line.match(/^(\s*)[-*]\s*\[([ xX])\]\s*(.*)$/);
            if (match && cleanForMatch(match[3]).includes(targetClean)) {
              updated = true;
              return `${match[1]}- [${completed ? "x" : " "}] ${match[3]}`;
            }
            return line;
          });

          if (!updated) {
            return { success: false, message: `Task "${taskText}" not found in **${noteName}**` };
          }

          const newContent = newLines.join("\n");
          await invokeIPC("write_note", { path, content: newContent });
          await searchEngine.indexFile(path, newContent).catch(() => {});

          const record: ActionHistoryRecord = {
            id: Math.random().toString(36).substring(7),
            action: "set_task_status",
            targetPath: path,
            previousState: currentContent,
            newState: newContent,
            timestamp: Date.now(),
          };
          this.history.push(record);

          window.dispatchEvent(new CustomEvent("reload-active-file", { detail: { path } }));
          return {
            success: true,
            message: `Marked task as ${completed ? "Completed" : "Pending"} in **${cleanName}**`,
            recordId: record.id,
          };
        }

        case "set_board_card": {
          const name = args.name || args.noteName;
          if (!name && !args.path) return { success: false, message: "Note name or path is required." };
          const path = args.path || (await resolveNotePath(name, vaultPath));
          const cleanName = path.split(/[\/\\]/).pop() || name;

          let previousContent = "";
          try {
            previousContent = (await invokeIPC("read_note", { path })) as string;
          } catch {}

          const { ensureAndSyncFrontmatter } = await import("./frontmatter");
          const { fullContent: newContent } = ensureAndSyncFrontmatter(previousContent, {
            status: args.status,
            priority: args.priority,
            due: args.due,
            forceUpdateTimestamp: true,
          });

          await invokeIPC("write_note", { path, content: newContent });
          await searchEngine.indexFile(path, newContent).catch(() => {});

          const record: ActionHistoryRecord = {
            id: Math.random().toString(36).substring(7),
            action: "set_board_card",
            targetPath: path,
            previousState: previousContent,
            newState: newContent,
            timestamp: Date.now(),
          };
          this.history.push(record);

          window.dispatchEvent(new CustomEvent("reload-active-file", { detail: { path } }));
          return {
            success: true,
            message: `Updated Kanban status (${args.status || "unchanged"}) and priority (${args.priority || "unchanged"}) for **${cleanName}**`,
            recordId: record.id,
          };
        }

        case "add_task": {
          const noteName = args.noteName || args.name || "Tasks";
          const taskText = args.text || args.taskText;
          if (!taskText) return { success: false, message: "Task text is required." };

          const path = args.path || (await resolveNotePath(noteName, vaultPath));
          const cleanName = path.split(/[\/\\]/).pop() || noteName;

          let currentContent = "";
          try {
            currentContent = (await invokeIPC("read_note", { path })) as string;
          } catch {
            currentContent = `# ${cleanName.replace(/\.md$/, "")}\n\n`;
          }

          let prioritySuffix = "";
          if (args.priority === "high" || args.priority === "!!!") prioritySuffix = " !!!";
          else if (args.priority === "medium" || args.priority === "!!") prioritySuffix = " !!";
          else if (args.priority === "low" || args.priority === "!") prioritySuffix = " !";

          const dateSuffix = args.date || args.due ? ` @${args.date || args.due}` : "";
          const tagSuffix = args.tag ? ` #${args.tag.replace(/^#/, "")}` : "";

          const taskLine = `- [ ] ${taskText}${dateSuffix}${prioritySuffix}${tagSuffix}`;
          const newContent = `${currentContent.trim()}\n${taskLine}\n`;

          await invokeIPC("write_note", { path, content: newContent });
          await searchEngine.indexFile(path, newContent).catch(() => {});

          const record: ActionHistoryRecord = {
            id: Math.random().toString(36).substring(7),
            action: "add_task",
            targetPath: path,
            previousState: currentContent,
            newState: newContent,
            timestamp: Date.now(),
          };
          this.history.push(record);

          window.dispatchEvent(new CustomEvent("reload-active-file", { detail: { path } }));
          return {
            success: true,
            message: `Added task "${taskText}" to **${cleanName}**`,
            recordId: record.id,
          };
        }

        case "replace_block": {
          const name = args.name || args.noteName;
          const path = args.path || (name ? await resolveNotePath(name, vaultPath) : null);
          const searchText = args.search_text || args.searchText;
          const replaceText = args.replace_text || args.replaceText;

          if (!path) return { success: false, message: "Target file path or name is required." };
          if (searchText === undefined || replaceText === undefined) {
            return { success: false, message: "search_text and replace_text are required." };
          }

          let currentContent = "";
          try {
            currentContent = (await invokeIPC("read_note", { path })) as string;
          } catch {
            return { success: false, message: `Could not read file at path: ${path}` };
          }

          if (!currentContent.includes(searchText)) {
            return { success: false, message: `Target text block to replace was not found in note.` };
          }

          const { ensureAndSyncFrontmatter } = await import("./frontmatter");
          const rawNewContent = currentContent.split(searchText).join(replaceText);
          const { fullContent: newContent } = ensureAndSyncFrontmatter(rawNewContent, { forceUpdateTimestamp: true });

          await invokeIPC("write_note", { path, content: newContent });
          await searchEngine.indexFile(path, newContent).catch(() => {});

          const record: ActionHistoryRecord = {
            id: Math.random().toString(36).substring(7),
            action: "replace_block",
            targetPath: path,
            previousState: currentContent,
            newState: newContent,
            timestamp: Date.now(),
          };
          this.history.push(record);

          window.dispatchEvent(new CustomEvent("reload-active-file", { detail: { path } }));
          return {
            success: true,
            message: `Successfully replaced block in **${path.split(separator).pop()}**`,
            recordId: record.id,
          };
        }

        case "rename_note": {
          const oldName = args.oldName || args.name;
          const newName = args.newName;
          if (!oldName || !newName) return { success: false, message: "oldName and newName are required." };

          const oldPath = await resolveNotePath(oldName, vaultPath);
          const oldFileName = oldPath.split(/[\/\\]/).pop() || oldName;
          const parentDir = oldPath.substring(0, Math.max(oldPath.lastIndexOf("/"), oldPath.lastIndexOf("\\")));

          const cleanNew = newName.endsWith(".md") ? newName : `${newName}.md`;
          const newPath = `${parentDir || vaultPath}${separator}${cleanNew}`;

          await invokeIPC("rename_note", { oldPath, newPath });

          const record: ActionHistoryRecord = {
            id: Math.random().toString(36).substring(7),
            action: "rename_note",
            targetPath: newPath,
            previousState: oldPath,
            newState: newPath,
            timestamp: Date.now(),
          };
          this.history.push(record);

          window.dispatchEvent(new CustomEvent("reload-active-file", { detail: { path: newPath } }));
          return { success: true, message: `Renamed **${oldFileName}** to **${cleanNew}**`, recordId: record.id };
        }

        default:
          return { success: false, message: `Unknown action: ${actionName}` };
      }
    } catch (err: any) {
      console.error(`ActionRegistry execution error [${actionName}]:`, err);
      return { success: false, message: `Execution failed: ${err.message || String(err)}` };
    }
  }

  /**
   * Rollback Stack: Reverts the most recent action executed by user or AI Copilot.
   */
  async undoLastAction(): Promise<{ success: boolean; message: string }> {
    if (this.history.length === 0) {
      return { success: false, message: "No actions to undo." };
    }

    const last = this.history.pop()!;
    try {
      const sep = last.targetPath.includes("\\") ? "\\" : "/";
      const lastSepIndex = Math.max(last.targetPath.lastIndexOf("/"), last.targetPath.lastIndexOf("\\"));
      const parentDir = lastSepIndex !== -1 ? last.targetPath.substring(0, lastSepIndex) : "";
      const fileName = last.targetPath.split(/[\/\\]/).pop() || "";

      if (last.action === "create_note") {
        const trashDir = `${parentDir}${sep}Trash`;
        const trashPath = `${trashDir}${sep}${fileName}`;
        await invokeIPC("rename_note", { oldPath: last.targetPath, newPath: trashPath }).catch(() => {});
        return { success: true, message: `Undid creation of **${fileName}** (moved to Trash)` };
      } else if (last.previousState !== null) {
        await invokeIPC("write_note", { path: last.targetPath, content: last.previousState });
        await searchEngine.indexFile(last.targetPath, last.previousState).catch(() => {});
        window.dispatchEvent(new CustomEvent("reload-active-file", { detail: { path: last.targetPath } }));
        return { success: true, message: `Reverted changes to **${fileName}**` };
      }
      return { success: true, message: "Undid action successfully." };
    } catch (err: any) {
      return { success: false, message: `Failed to undo action: ${err.message}` };
    }
  }
}

export const actionRegistry = new ActionRegistry();
