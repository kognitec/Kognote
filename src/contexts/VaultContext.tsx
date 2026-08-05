import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { invokeIPC } from "../lib/ipc";
import { listen } from "@tauri-apps/api/event";
import { useSettings } from "./SettingsContext";
import { open, message, confirm } from "@tauri-apps/plugin-dialog";
import { FileEntry, NoteCachedData, ScannedTask, BoardCard } from "../types/note";
import { searchEngine } from "../lib/search-engine";
import {
  DAILY_NOTES_FOLDER,
  ATTACHMENTS_FOLDER,
  CLIPPINGS_FOLDER,
  ARCHIVED_FOLDER,
  DELETED_FOLDER,
  TEMPLATES_FOLDER,
  PROTECTED_FOLDERS,
} from "../lib/vault-constants";
import { ensureAndSyncFrontmatter, parseFrontmatter, stringifyFrontmatter, getCurrentIsoTimestamp, getZonedDateParts } from "../lib/frontmatter";
import { isArchivedPath, isTrashPath } from "../lib/task-scanner";
import { getShortestUniquePath, replaceWikilinksOutsideCode } from "../lib/wikilink-utils";
import { embeddingQueue } from "../lib/embedding-queue";
import { DEFAULT_AGENTS_MD } from "../constants/defaultAgents";
import { ONBOARDING_NOTES } from "../constants/onboardingNotes";
import { BUILTIN_TEMPLATES, LEGACY_DEPRECATED_TEMPLATES } from "../lib/templates";

import { store } from "./SettingsContext";

// Re-export types (non-component exports are OK in a context file when they are type-only).
export type { FileEntry, ScannedTask, ScannedDateReference, BoardCard, NoteCachedData } from "../types/note";

const flattenFiles = (entries: FileEntry[]): Map<string, FileEntry> => {
  const map = new Map<string, FileEntry>();
  const traverse = (items: FileEntry[]) => {
    for (const item of items) {
      if (!item.is_dir) {
        map.set(item.path, item);
        const norm = item.path.replace(/\\/g, "/");
        map.set(norm, item);
      } else if (item.children) {
        traverse(item.children);
      }
    }
  };
  traverse(entries);
  return map;
};

// Rest of constants...
export {
  DAILY_NOTES_FOLDER,
  ATTACHMENTS_FOLDER,
  CANVAS_FOLDER,
  CLIPPINGS_FOLDER,
  ARCHIVED_FOLDER,
  DELETED_FOLDER,
  TEMPLATES_FOLDER,
  PROTECTED_FOLDERS,
} from "../lib/vault-constants";

/** Cross-platform path separator */
const sep = (basePath: string) => basePath.includes("\\") ? "\\" : "/";

/** Join path segments with the correct cross-platform separator */
const pathJoin = (...parts: string[]): string => {
  if (parts.length === 0) return "";
  const s = sep(parts[0]);
  return parts.join(s).replace(new RegExp(`[/\\\\]{2,}`, "g"), s);
};

/** Returns true if the path's final segment matches a protected folder name */
const isProtectedFolder = (path: string): boolean => {
  const normalized = path.replace(/\\/g, "/");
  const name = normalized.split("/").pop() || "";
  return PROTECTED_FOLDERS.some((p) => p.toLowerCase() === name.toLowerCase());
};

interface VaultContextType {
  files: FileEntry[];
  activeFile: FileEntry | null;
  openFiles: FileEntry[];
  setOpenFiles: React.Dispatch<React.SetStateAction<FileEntry[]>>;
  setActiveFile: (file: FileEntry | null) => void;
  openFile: (file: FileEntry) => void;
  closeFile: (path: string) => void;
  refreshFiles: () => Promise<void>;
  createFile: (parentDir: string | null, name: string) => Promise<string>;
  createDirectory: (parentDir: string | null, name: string) => Promise<string>;
  deleteFileOrDirectory: (path: string) => Promise<void>;
  renameFileOrDirectory: (oldPath: string, newPath: string) => Promise<void>;
  openNoteByName: (name: string) => void;
  /** Opens (or creates) the daily note for the given YYYY-MM-DD date inside Daily Notes/ */
  openDailyNote: (dateStr: string) => void;
  /** Returns the FileEntry for a daily note date if it exists, else null */
  getDailyNoteFile: (dateStr: string) => FileEntry | null;
  activeView: "editor" | "canvas" | "flashcards" | "graph" | "calendar" | "tasks" | "board";
  setActiveView: (view: "editor" | "canvas" | "flashcards" | "graph" | "calendar" | "tasks" | "board") => void;
  /** Returns true if the given path is a protected system folder */
  isProtectedFolder: (path: string) => boolean;
  /** The vault's absolute path */
  vaultPath: string | null;
  /** The vault's Attachments folder absolute path */
  attachmentsFolderPath: string | null;
  createFileModal: { isOpen: boolean; parentDir: string | null };
  setCreateFileModal: React.Dispatch<React.SetStateAction<{ isOpen: boolean; parentDir: string | null }>>;
  previewAttachment: { path: string; name: string } | null;
  setPreviewAttachment: (file: { path: string; name: string } | null) => void;
  importAttachment: (targetDir: string) => Promise<void>;

  // Note Storage Lifecycle & Templates
  bookmarkNote: (path: string) => Promise<void>;
  archiveNote: (path: string) => Promise<void>;
  deleteNoteToTrash: (path: string) => Promise<void>;
  restoreNote: (path: string) => Promise<void>;
  restoreAllTrash: () => Promise<void>;
  emptyTrash: () => Promise<void>;
  saveAsTemplate: (path: string, templateName: string) => Promise<string>;
  getTemplates: () => Promise<{ name: string; path: string; content: string; type: string }[]>;

  // High-performance shared note parsing cache
  noteCache: Record<string, NoteCachedData>;
  updateNoteCache: (path: string, content: string) => void;
  isScanLoading: boolean;
  triggerNotesScan: () => Promise<void>;
  deepReindex: () => Promise<void>;
}

const VaultContext = createContext<VaultContextType | undefined>(undefined);

export const VaultProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { vaultPath, includeArchivedInScans, includeTrashInScans } = useSettings();
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activeFile, setActiveFileState] = useState<FileEntry | null>(null);
  const [openFiles, setOpenFiles] = useState<FileEntry[]>([]);
  const [activeView, setActiveView] = useState<"editor" | "canvas" | "flashcards" | "graph" | "calendar" | "tasks" | "board">("editor");
  const [attachmentsFolderPath, setAttachmentsFolderPath] = useState<string | null>(null);
  const [createFileModal, setCreateFileModal] = useState<{ isOpen: boolean; parentDir: string | null }>({
    isOpen: false,
    parentDir: null
  });

  const [noteCache, setNoteCache] = useState<Record<string, NoteCachedData>>({});
  const [isScanLoading, setIsScanLoading] = useState(false);
  const noteCacheRef = useRef<Map<string, NoteCachedData>>(new Map());
  // Stable ref that always points at the latest triggerNotesScan — used by the watcher
  // so we don't have to restart the watcher every time scan options change.
  const triggerNotesScanRef = useRef<() => Promise<void>>(() => Promise.resolve());


  const [previewAttachment, setPreviewAttachment] = useState<{ path: string; name: string } | null>(null);

  const filterSystemFiles = (entries: FileEntry[]): FileEntry[] => {
    return entries
      .filter((e) => {
        const lower = e.name.toLowerCase();
        if (lower === "agents.md" || lower.startsWith(".")) return false;
        return true;
      })
      .map((e) => {
        if (e.is_dir && e.children) {
          return { ...e, children: filterSystemFiles(e.children) };
        }
        return e;
      });
  };

  const hasRestoredWorkspaceRef = useRef(false);

  const refreshFiles = useCallback(async () => {
    if (!vaultPath) {
      setFiles([]);
      setAttachmentsFolderPath(null);
      return;
    }
    try {
      const separator = vaultPath.includes("\\") ? "\\" : "/";
      const agentsPath = `${vaultPath}${separator}AGENTS.md`;
      const exists = await invokeIPC("fs_exists", { path: agentsPath }).catch(() => false);
      if (!exists) {
        await invokeIPC("write_note", { path: agentsPath, content: DEFAULT_AGENTS_MD }).catch(() => {});
      }
      const fileList = await invokeIPC("list_vault_files", { vaultPath });
      const filtered = filterSystemFiles(fileList);
      setFiles(filtered);

      if (!hasRestoredWorkspaceRef.current) {
        hasRestoredWorkspaceRef.current = true;
        const fileMap = flattenFiles(filtered);
        const [savedOpenPaths, savedActivePath, savedView] = await Promise.all([
          store.get<string[]>("workspaceOpenFiles"),
          store.get<string>("workspaceActiveFile"),
          store.get<any>("workspaceActiveView"),
        ]);

        if (Array.isArray(savedOpenPaths) && savedOpenPaths.length > 0) {
          const restored = savedOpenPaths.map((p) => fileMap.get(p) || fileMap.get(p.replace(/\\/g, "/"))).filter(Boolean) as FileEntry[];
          if (restored.length > 0) {
            setOpenFiles(restored);
          }
        }
        if (savedActivePath) {
          const active = fileMap.get(savedActivePath) || fileMap.get(savedActivePath.replace(/\\/g, "/"));
          if (active) {
            setActiveFileState(active);
          }
        }
        if (savedView) {
          setActiveView(savedView);
        }
      }
    } catch (err) {
      console.error("Failed to list vault files:", err);
    }
  }, [vaultPath]);

  // Persist workspace layout changes to LazyStore
  useEffect(() => {
    if (!hasRestoredWorkspaceRef.current) return;
    const paths = openFiles.map((f) => f.path);
    store.set("workspaceOpenFiles", paths);
    store.set("workspaceActiveFile", activeFile?.path || null);
    store.set("workspaceActiveView", activeView);
    store.save();
  }, [openFiles, activeFile, activeView]);

  const setActiveFile = useCallback((file: FileEntry | null) => {
    setActiveFileState(file);
    if (file) {
      if (file.name.endsWith(".excalidraw")) {
        setActiveView("canvas");
      } else {
        setActiveView("editor");
      }
    }
  }, []);

  const openFile = useCallback((file: FileEntry) => {
    if (file.is_dir) return;

    const ext = file.name.toLowerCase().split('.').pop() || '';
    const isNoteOrCanvas = ['md', 'excalidraw'].includes(ext);

    if (!isNoteOrCanvas) {
      setPreviewAttachment({ path: file.path, name: file.name });
      return;
    }

    setOpenFiles((prev) => {
      const exists = prev.some((f) => f.path === file.path);
      if (exists) return prev;
      return [...prev, file];
    });
    setActiveFile(file);
    // Route to the correct view based on file type
    if (file.name.endsWith(".excalidraw")) {
      setActiveView("canvas");
    } else {
      setActiveView("editor");
    }
  }, [setActiveFile, setActiveView]);


  const closeFile = useCallback((path: string) => {
    setOpenFiles((prev) => {
      const next = prev.filter((f) => f.path !== path);
      if (activeFile?.path === path) {
        setActiveFile(next.length > 0 ? next[next.length - 1] : null);
      }
      return next;
    });
  }, [activeFile, setActiveFile]);

  /** Auto-append (1), (2)... suffix if path already exists to avoid conflicts */
  const resolveUniqueFilePath = async (rawPath: string): Promise<string> => {
    const exists = await invokeIPC("fs_exists", { path: rawPath }).catch(() => false);
    if (!exists) return rawPath;
    // Split off extension
    const lastDot = rawPath.lastIndexOf(".");
    const base = lastDot !== -1 ? rawPath.slice(0, lastDot) : rawPath;
    const ext = lastDot !== -1 ? rawPath.slice(lastDot) : "";
    let counter = 1;
    while (true) {
      const candidate = `${base} (${counter})${ext}`;
      const candidateExists = await invokeIPC("fs_exists", { path: candidate }).catch(() => false);
      if (!candidateExists) return candidate;
      counter++;
    }
  };

  const resolveUniqueDirectoryPath = async (rawPath: string): Promise<string> => {
    const exists = await invokeIPC("fs_exists", { path: rawPath }).catch(() => false);
    if (!exists) return rawPath;
    let counter = 1;
    while (true) {
      const candidate = `${rawPath} (${counter})`;
      const candidateExists = await invokeIPC("fs_exists", { path: candidate }).catch(() => false);
      if (!candidateExists) return candidate;
      counter++;
    }
  };

  const importAttachment = async (targetDir: string) => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [{
          name: "Image Attachments",
          extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"]
        }]
      });

      if (!selected) return;

      const srcPath = Array.isArray(selected) ? selected[0] : selected;
      const fileName = srcPath.replace(/\\/g, "/").split("/").pop() || "";
      const ext = fileName.toLowerCase().split(".").pop() || "";

      const supportedExtensions = ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif"];
      if (!supportedExtensions.includes(ext)) {
        await message(`Unsupported file type: .${ext}. Only image files (.png, .jpg, .jpeg, .gif, .webp, .svg, .avif) are supported in Attachments.`, {
          title: "Unsupported Type",
          kind: "error"
        });
        return;
      }

      const separator = targetDir.includes("\\") ? "\\" : "/";
      const destPath = `${targetDir}${separator}${fileName}`;

      const resolvedDestPath = await resolveUniqueFilePath(destPath);
      const finalFileName = resolvedDestPath.split(/[\/\\]/).pop() || fileName;

      await invokeIPC("fs_copy", { src: srcPath, dest: resolvedDestPath });
      await refreshFiles();

      openFile({
        name: finalFileName,
        path: resolvedDestPath,
        is_dir: false,
      });

      // No longer logActivity
    } catch (err) {
      console.error("Failed to import attachment:", err);
      await message(`Failed to import attachment: ${err}`, {
        title: "Import Error",
        kind: "error"
      });
    }
  };

  // Refresh files list when vault changes; also auto-create protected folders
  useEffect(() => {
    setActiveFileState(null);
    setOpenFiles([]);

    if (!vaultPath) {
      refreshFiles();
      return;
    }

    // Auto-create all 4 protected system folders if they don't exist
    const ensureProtectedFolders = async () => {
      for (const folderName of PROTECTED_FOLDERS) {
        const folderPath = pathJoin(vaultPath, folderName);
        const exists = await invokeIPC("fs_exists", { path: folderPath }).catch(() => false);
        if (!exists) {
          await invokeIPC("fs_mkdir", { path: folderPath }).catch(console.error);
        }
      }
      // Set the Attachments folder path for use in image paste/drag-drop
      setAttachmentsFolderPath(pathJoin(vaultPath, ATTACHMENTS_FOLDER));
      await refreshFiles();
    };
    ensureProtectedFolders();
  }, [vaultPath, refreshFiles]);

  // Start vault watching and listen to file change events
  useEffect(() => {
    if (!vaultPath) return;

    let active = true;
    let unlistenFn: (() => void) | null = null;

    const setupWatcher = async () => {
      try {
        await invokeIPC("watch_vault", { vaultPath });

        if (!active) {
          await invokeIPC("unwatch_vault", {}).catch(() => { });
          return;
        }

        let debounceTimer: number | null = null;

        unlistenFn = await listen<{ path: string; kind: string }>("vault_file_changed", (event) => {
          console.log(`File change detected: ${event.payload.path} (${event.payload.kind})`);

          if (debounceTimer) window.clearTimeout(debounceTimer);
          debounceTimer = window.setTimeout(() => {
            refreshFiles();
            // Use ref so watcher always invokes the latest scan with current settings
            triggerNotesScanRef.current();
            window.dispatchEvent(new CustomEvent("reload-active-file", { detail: { path: event.payload.path } }));
          }, 300);
        });
      } catch (err) {
        console.error("Failed to setup vault file watcher:", err);
      }
    };

    setupWatcher();

    return () => {
      active = false;
      if (unlistenFn) {
        unlistenFn();
      }
      invokeIPC("unwatch_vault", {}).catch(() => { });
    };
  }, [vaultPath, refreshFiles]);

  // Synchronize activeFile type with activeView type.
  // Rule: excalidraw files belong in canvas; all other files (md, pdf, images, media) belong in editor.
  // If the wrong type is active for the current view, gracefully fall back.
  useEffect(() => {
    if (activeView === "editor") {
      // If somehow a .excalidraw file ended up as the active file in editor view, switch it to canvas
      if (activeFile && activeFile.name.endsWith(".excalidraw")) {
        const lastNonCanvas = [...openFiles].reverse().find((f) => !f.name.endsWith(".excalidraw"));
        setActiveFileState(lastNonCanvas || null);
      }
    } else if (activeView === "canvas") {
      if (activeFile && !activeFile.name.endsWith(".excalidraw")) {
        const lastCanvas = [...openFiles].reverse().find((f) => f.name.endsWith(".excalidraw"));
        setActiveFileState(lastCanvas || null);
      }
    }
  }, [activeView, activeFile, openFiles]);




  // Keep openFiles and activeFile in sync with current files tree (closes deleted files)
  useEffect(() => {
    if (files.length === 0) return;

    const existsInTree = (entries: FileEntry[], path: string): boolean => {
      for (const entry of entries) {
        if (entry.path === path) return true;
        if (entry.is_dir && entry.children) {
          if (existsInTree(entry.children, path)) return true;
        }
      }
      return false;
    };

    setOpenFiles((prev) => {
      const filtered = prev.filter((f) => existsInTree(files, f.path));

      // If the active file was deleted, switch to the last open file or null
      if (activeFile && !existsInTree(files, activeFile.path)) {
        setActiveFileState(filtered.length > 0 ? filtered[filtered.length - 1] : null);
      }

      // If the lists are identical, return the previous state to avoid unnecessary re-renders
      const isIdentical = prev.length === filtered.length &&
        prev.every((f, idx) => f.path === filtered[idx].path && f.name === filtered[idx].name);
      if (isIdentical) return prev;

      return filtered;
    });
  }, [files, activeFile]);

  const createFile = async (parentDir: string | null, name: string): Promise<string> => {
    const parent = parentDir || vaultPath;
    if (!parent) throw new Error("No vault path selected");

    let fileName = name;
    if (!name.endsWith(".md") && !name.endsWith(".excalidraw")) {
      fileName = `${name}.md`;
    }

    const rawPath = pathJoin(parent, fileName);
    const fullPath = await resolveUniqueFilePath(rawPath);

    if (fileName.endsWith(".excalidraw")) {
      const initialCanvasData = JSON.stringify({ elements: [], appState: { theme: "dark" } }, null, 2);
      await invokeIPC("fs_write", { path: fullPath, content: initialCanvasData });
    } else {
      const noteName = fileName.replace(/\.md$/, "");
      const normParent = (parent || "").replace(/\\/g, "/").toLowerCase();
      const isDaily = normParent.includes("daily notes") || noteName.toLowerCase().includes("daily") || /^\d{4}-\d{2}-\d{2}$/.test(noteName);
      const isTemplate = normParent.includes("templates");
      const noteType = isDaily ? "daily" : isTemplate ? "template" : "note";
      const { fullContent } = ensureAndSyncFrontmatter("", {
        noteName,
        type: noteType,
        forceUpdateTimestamp: true,
      });

      await invokeIPC("fs_write", { path: fullPath, content: fullContent });
    }
    await refreshFiles();
    return fullPath;
  };

  const createDirectory = async (parentDir: string | null, name: string): Promise<string> => {
    const parent = parentDir || vaultPath;
    if (!parent) throw new Error("No vault path selected");
    const rawPath = pathJoin(parent, name);
    const fullPath = await resolveUniqueDirectoryPath(rawPath);
    await invokeIPC("create_folder", { path: fullPath });
    await refreshFiles();
    return fullPath;
  };

  const renameFileOrDirectory = async (oldPath: string, newPath: string) => {
    if (isProtectedFolder(oldPath)) {
      await message(`"${oldPath.split(/[\/\\]/).pop()}" is a protected system folder and cannot be renamed.`, {
        title: "Protected Folder",
        kind: "error"
      });
      return;
    }

    await invokeIPC("rename_note", { oldPath, newPath });

    // Update backlinks in all markdown notes
    const oldName = oldPath.replace(/\\/g, "/").split("/").pop()?.replace(/\.(md|excalidraw)$/i, "") || "";
    const newName = newPath.replace(/\\/g, "/").split("/").pop()?.replace(/\.(md|excalidraw)$/i, "") || "";

    if (oldName && newName && oldName !== newName) {
      let updatedCount = 0;
      let targetPaths: string[] = [];

      try {
        targetPaths = await searchEngine.getBacklinkFilePaths(oldName);
      } catch (err) {
        console.warn("Failed to query SQLite backlink paths for rename:", err);
      }

      // If SQLite returned no candidate paths, fallback to noteCache links lookup
      if (!targetPaths || targetPaths.length === 0) {
        const oldLower = oldName.toLowerCase();
        Object.entries(noteCache).forEach(([filePath, cached]) => {
          if (cached.links && cached.links.some((l) => l.toLowerCase() === oldLower)) {
            targetPaths.push(filePath);
          }
        });
      }

      // Final fallback if cache is empty: gather all md files
      if (targetPaths.length === 0) {
        const gatherMdFiles = (entries: FileEntry[]) => {
          entries.forEach((e) => {
            if (e.is_dir && e.children) gatherMdFiles(e.children);
            else if (!e.is_dir && e.name.endsWith(".md")) targetPaths.push(e.path);
          });
        };
        gatherMdFiles(files);
      }

      // Process target paths in parallel chunks of 8 to avoid blocking JS thread
      const CHUNK_SIZE = 8;
      for (let i = 0; i < targetPaths.length; i += CHUNK_SIZE) {
        const chunk = targetPaths.slice(i, i + CHUNK_SIZE);
        await Promise.all(
          chunk.map(async (targetPath) => {
            try {
              const fileContent = (await invokeIPC("read_note", { path: targetPath })) as string;
              const updated = replaceWikilinksOutsideCode(fileContent, oldName, newName);
              if (updated !== fileContent) {
                await invokeIPC("write_note", { path: targetPath, content: updated });
                updatedCount++;
              }
            } catch (e) {
              console.warn("Failed to update backlinks in:", targetPath, e);
            }
          })
        );
      }

      if (updatedCount > 0) {
        window.dispatchEvent(
          new CustomEvent("kognote-toast", {
            detail: { message: `Updated backlinks in ${updatedCount} note${updatedCount > 1 ? "s" : ""}` }
          })
        );
      }
    }

    setOpenFiles((prev) =>
      prev.map((f) => {
        if (f.path === oldPath) {
          const parts = newPath.replace(/\\/g, "/").split("/");
          const name = parts[parts.length - 1];
          return { ...f, path: newPath, name };
        }
        return f;
      })
    );

    if (activeFile?.path === oldPath) {
      const parts = newPath.replace(/\\/g, "/").split("/");
      const name = parts[parts.length - 1];
      setActiveFile({ ...activeFile, path: newPath, name });
    }

    await refreshFiles();
  };

  const openNoteByName = useCallback(
    (name: string) => {
      const cleanTarget = name.trim().replace(/\\/g, "/");
      const nameOnly = cleanTarget.split("/").pop() || cleanTarget;
      const hasSubpath = cleanTarget.includes("/");
      const hasExtension = /\.[a-zA-Z0-9]+$/i.test(nameOnly);

      // Helper to collect all matching FileEntry instances across the vault
      function findAllMatches(items: FileEntry[]): FileEntry[] {
        let results: FileEntry[] = [];
        for (const item of items) {
          if (item.is_dir) {
            if (item.children) {
              results = results.concat(findAllMatches(item.children));
            }
          } else {
            const itemPathLower = item.path.replace(/\\/g, "/").toLowerCase();
            const itemNameLower = item.name.toLowerCase();

            if (hasSubpath) {
              const targetLower = cleanTarget.toLowerCase();
              if (hasExtension) {
                if (itemPathLower.endsWith(targetLower)) {
                  results.push(item);
                }
              } else {
                if (
                  itemPathLower.endsWith(targetLower) ||
                  itemPathLower.endsWith(`${targetLower}.md`)
                ) {
                  results.push(item);
                }
              }
            } else {
              const nameOnlyLower = nameOnly.toLowerCase();
              if (hasExtension) {
                if (itemNameLower === nameOnlyLower) {
                  results.push(item);
                }
              } else {
                if (itemNameLower === `${nameOnlyLower}.md` || itemNameLower === nameOnlyLower) {
                  results.push(item);
                }
              }
            }
          }
        }
        return results;
      }

      const matches = findAllMatches(files);

      if (matches.length > 0) {
        let bestMatch = matches[0];
        if (!hasExtension) {
          const mdMatch = matches.find((m) => m.name.toLowerCase().endsWith(".md"));
          if (mdMatch) bestMatch = mdMatch;
        }

        if (matches.length > 1 && activeFile) {
          const activeDir = activeFile.path.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
          const sameDirMatch = matches.find((m) => {
            const mDir = m.path.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
            return mDir === activeDir && (!hasExtension ? m.name.toLowerCase().endsWith(".md") : true);
          });
          if (sameDirMatch) {
            bestMatch = sameDirMatch;
          }
        }
        openFile(bestMatch);
      } else {
        // Create new note if not found
        const createAndOpen = async () => {
          try {
            const targetName = hasExtension ? nameOnly : `${nameOnly}.md`;
            const newPath = await createFile(null, targetName);
            openFile({
              name: targetName,
              path: newPath,
              is_dir: false,
            });
          } catch (err) {
            console.error("Failed to create linked note:", err);
          }
        };
        createAndOpen();
      }
    },
    [files, activeFile, openFile, createFile]
  );

  /** Returns the FileEntry for a daily note if it already exists (prefers Daily Notes/ folder) */
  const getDailyNoteFile = useCallback((dateStr: string): FileEntry | null => {
    const expectedName = `${dateStr}.md`;
    // Prefer file inside Daily Notes folder first
    const dailyNotesDir = files.find(
      (f) => f.is_dir && f.name.toLowerCase() === DAILY_NOTES_FOLDER.toLowerCase()
    );
    if (dailyNotesDir?.children) {
      const found = dailyNotesDir.children.find(
        (f) => !f.is_dir && f.name.toLowerCase() === expectedName.toLowerCase()
      );
      if (found) return found;
    }
    // Fallback: search whole vault (handles notes already at root before migration)
    const search = (items: FileEntry[]): FileEntry | null => {
      for (const item of items) {
        if (item.is_dir) {
          if (item.children) {
            const found = search(item.children);
            if (found) return found;
          }
        } else if (item.name.toLowerCase() === expectedName.toLowerCase()) {
          return item;
        }
      }
      return null;
    };
    return search(files);
  }, [files]);

  /** Opens (or creates) the daily note for a YYYY-MM-DD date, always inside Daily Notes/ */
  const openDailyNote = useCallback((dateStr: string) => {
    const existing = getDailyNoteFile(dateStr);
    if (existing) {
      openFile(existing);
      return;
    }

    const createAndOpen = async () => {
      if (!vaultPath) return;
      try {
        const separator = vaultPath.includes("\\") ? "\\" : "/";
        const dailyNotesFolderPath = `${vaultPath}${separator}${DAILY_NOTES_FOLDER}`;

        // Ensure the Daily Notes folder exists
        const folderExists = await invokeIPC("fs_exists", { path: dailyNotesFolderPath }).catch(() => false);
        if (!folderExists) {
          await invokeIPC("create_folder", { path: dailyNotesFolderPath });
        }

        // Create note inside Daily Notes/ with type: "daily"
        const fileName = `${dateStr}.md`;
        const fullPath = `${dailyNotesFolderPath}${separator}${fileName}`;
        const { fullContent } = ensureAndSyncFrontmatter("", {
          noteName: dateStr,
          type: "daily",
          forceUpdateTimestamp: true,
        });
        await invokeIPC("fs_write", { path: fullPath, content: fullContent });
        await refreshFiles();

        openFile({
          name: fileName,
          path: fullPath,
          is_dir: false,
        });
      } catch (err) {
        console.error("Failed to create daily note:", err);
      }
    };
    createAndOpen();
  }, [vaultPath, getDailyNoteFile, openFile, refreshFiles]);

  // Traverses entries to build flat list of markdown files
  const getMdFiles = useCallback((entries: FileEntry[], list: FileEntry[]) => {
    entries.forEach(entry => {
      if (!includeArchivedInScans && isArchivedPath(entry.path)) return;
      if (isTrashPath(entry.path)) return;

      if (entry.is_dir) {
        if (entry.children) getMdFiles(entry.children, list);
      } else if (entry.name.toLowerCase().endsWith(".md")) {
        list.push(entry);
      }
    });
  }, [includeArchivedInScans]);

  const scanTimerRef = useRef<number | null>(null);

  const triggerNotesScanInternal = useCallback(async () => {
    if (!vaultPath) return;
    setIsScanLoading(true);

    try {
      const currentCache = noteCacheRef.current;
      const knownMtimes: Record<string, number> = {};
      currentCache.forEach((v, k) => {
        knownMtimes[k] = v.modifiedAt || 0;
      });

      const delta = await invokeIPC("scan_vault_delta", { vaultPath, knownMtimes }).catch((err) => {
        console.error("Delta scan IPC failed:", err);
        return null;
      });

      if (!delta) return;

      const newCache = new Map<string, NoteCachedData>(currentCache);

      // Remove deleted paths
      for (const delPath of delta.deleted_paths) {
        newCache.delete(delPath);
        await searchEngine.execute("DELETE FROM note_metadata WHERE file_path = $1", [delPath]).catch(console.error);
        await searchEngine.execute("DELETE FROM note_links WHERE source_path = $1", [delPath]).catch(console.error);
        await searchEngine.removeFile(delPath).catch(console.error);
      }

      // Process updated files from Rust native parser
      const backgroundChunkItems: Array<{ filePath: string; chunkText: string; modifiedAt: number }> = [];

      for (const item of delta.updated) {
        const fileObj: FileEntry = {
          name: item.name,
          path: item.path,
          is_dir: false,
          modified_at: item.modified_at,
          created_at: item.modified_at,
        };

        const parsedRust = item.metadata;
        const content = item.content;

        if (!includeArchivedInScans && /storage:\s*["']?archived["']?/i.test(content)) continue;
        if (isTrashPath(item.path) || /storage:\s*["']?deleted["']?/i.test(content)) continue;

        // Assemble tasks list
        const tasks = (parsedRust.tasks || []).map((t: any) => {
          const rawTaskContent = t.content || "";
          let priority: "high" | "medium" | "low" | "none" = "none";
          if (/@task!!!|(?:\b|\s|^)!!!(?:\b|\s|$)/i.test(rawTaskContent)) {
            priority = "high";
          } else if (/@task!!|(?:\b|\s|^)!!(?:\b|\s|$)/i.test(rawTaskContent)) {
            priority = "medium";
          } else if (/@task!|(?:\b|\s|^)!(?:\b|\s|$)/i.test(rawTaskContent)) {
            priority = "low";
          }

          let dueDate = t.dueDate || undefined;
          let dueTime = t.dueTime || undefined;
          let rawDueDate = (t as any).rawDueDate || undefined;

          const isoMatch = rawTaskContent.match(/(?:@due:?|@|due:\s*)?(20\d{2}[-/]\d{2}[-/]\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/i);
          if (isoMatch && isoMatch[1]) {
            rawDueDate = isoMatch[1];
            const { dateStr, timeStr } = getZonedDateParts(rawDueDate);
            dueDate = dateStr;
            dueTime = timeStr;
          } else {
            const dtMatch = rawTaskContent.match(/(?:@due:?|@|due:\s*)?(20\d{2}[-/](?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01]))(?:[ T]([01]\d|2[0-3]):([0-5]\d))?/i);
            if (dtMatch && dtMatch[1]) {
              dueDate = dtMatch[1].replace(/\//g, "-");
              if (dtMatch[2] && dtMatch[3]) {
                dueTime = `${dtMatch[2]}:${dtMatch[3]}`;
              }
            }
          }

          let cleanTaskContent = rawTaskContent
            .replace(/(?:^|\s|\\)#([a-zA-Z0-9_\-\/]+)/g, "")
            .replace(/(?:@due:?|@|due:\s*)?20\d{2}[-/]\d{2}[-/]\d{2}(?:T[^\s]+|[ T]\d{2}:\d{2})?/gi, "")
            .replace(/@task(!*)/gi, "")
            .replace(/(?:\b|\s|^)!{1,3}(?:\b|\s|$)/g, " ")
            .replace(/\s+/g, " ")
            .trim();

          return {
            id: `${item.path}:${t.lineNumber}`,
            notePath: item.path,
            noteName: item.name.replace(/\.md$/, ""),
            content: cleanTaskContent || rawTaskContent,
            completed: t.completed,
            lineNumber: t.lineNumber,
            dueDate,
            dueTime,
            tags: t.tags || [],
            priority,
          };
        });

        // Assemble dateRefs list
        const dateRefs = (parsedRust.dateRefs || []).map((d: any, dIdx: number) => ({
          id: `${item.path}:${dIdx}`,
          notePath: item.path,
          noteName: item.name.replace(/\.md$/, ""),
          date: d.date,
          context: d.context,
        }));

        const fm = parseFrontmatter(content);
        const pathLower = item.path.replace(/\\/g, "/").toLowerCase();

        let syncedStorage = fm.fields.storage || "active";
        let syncedBookmarked = fm.fields.bookmarked || "no";

        if (pathLower.includes("/archived/")) {
          syncedStorage = "archived";
          syncedBookmarked = "no";
        } else if (pathLower.includes("/trash/")) {
          syncedStorage = "deleted";
          syncedBookmarked = "no";
        }

        let boardCard = null;
        const rawStatus = (fm.fields.status || parsedRust.boardStatus || "none").toLowerCase();

        if (rawStatus && rawStatus !== "none") {
          let mappedStatus: "Backlog" | "Todo" | "In Progress" | "In Review" | "Done" = "Todo";
          if (rawStatus === "backlog") mappedStatus = "Backlog";
          else if (rawStatus === "todo") mappedStatus = "Todo";
          else if (rawStatus === "in-progress" || rawStatus === "inprogress") mappedStatus = "In Progress";
          else if (rawStatus === "in-review" || rawStatus === "inreview") mappedStatus = "In Review";
          else if (rawStatus === "done") mappedStatus = "Done";

          const priority = (fm.fields.priority || parsedRust.boardPriority || "none").toLowerCase() as any;
          const todoTasks = tasks.filter((t: any) => !t.completed).length;
          const completedTasks = tasks.filter((t: any) => t.completed).length;

          boardCard = {
            file: fileObj,
            title: item.name.replace(/\.md$/, ""),
            snippet: parsedRust.snippet,
            tags: parsedRust.tags,
            status: mappedStatus,
            todoTasks,
            completedTasks,
            wordCount: parsedRust.wordCount,
            dueDate: fm.fields.due || undefined,
            type: fm.fields.type || "note",
            storage: syncedStorage as "active" | "archived" | "deleted",
            bookmarked: syncedBookmarked === "yes",
            priority,
          };
        }

        const parsed: NoteCachedData = {
          path: item.path,
          modifiedAt: item.modified_at,
          tags: parsedRust.tags,
          links: parsedRust.links,
          urls: parsedRust.urls,
          tasks,
          dateRefs,
          boardCard,
          meta: fm.fields as any,
        };

        newCache.set(item.path, parsed);

        const noteStorage = fm.fields.storage || (isTrashPath(item.path) ? "deleted" : isArchivedPath(item.path) ? "archived" : "active");
        await searchEngine.saveNoteMetadata(item.path, parsed.tags, parsed.links, noteStorage).catch(console.error);
        await searchEngine.syncNoteLinks(item.path, parsed.links).catch(console.error);

        // Extract chunks and enqueue in priority embeddingQueue
        const rawBlocks = content.split(/\n\s*\n/).map((b) => b.trim()).filter((b) => b.length > 10);
        for (const block of rawBlocks) {
          if (!block.startsWith("---")) {
            backgroundChunkItems.push({ filePath: item.path, chunkText: block, modifiedAt: item.modified_at });
          }
        }
      }

      if (backgroundChunkItems.length > 0) {
        embeddingQueue.enqueueBackground(backgroundChunkItems);
      }

      // Compute mentions (backlinks) using relational SQL note_links table with Trash isolation & Shortest Unique Path
      const allCachedEntries = Array.from(newCache.values()).map((v) => ({ name: v.path.split(/[\/\\]/).pop() || "", path: v.path }));
      for (const data of newCache.values()) {
        const noteName = data.path.replace(/\\/g, "/").split("/").pop()!.replace(/\.(md|excalidraw)$/i, "");
        const relPath = getShortestUniquePath(data.path, vaultPath, allCachedEntries);
        const isTrashed = isTrashPath(data.path) || data.meta?.storage === "deleted";
        const mentions = await searchEngine.getBacklinks(noteName, relPath, isTrashed).catch(() => []);
        if (data.meta) {
          data.meta = { ...data.meta, mentions };
        }
      }

      noteCacheRef.current = newCache;
      const cacheObj: Record<string, NoteCachedData> = {};
      newCache.forEach((val, key) => {
        cacheObj[key] = val;
      });
      setNoteCache(cacheObj);
    } catch (e) {
      console.error("Incremental note cache scan failed:", e);
    } finally {
      setIsScanLoading(false);
    }
  }, [vaultPath, includeArchivedInScans, includeTrashInScans]);

  const triggerNotesScan = useCallback(async () => {
    if (scanTimerRef.current) {
      window.clearTimeout(scanTimerRef.current);
    }
    return new Promise<void>((resolve) => {
      scanTimerRef.current = window.setTimeout(async () => {
        await triggerNotesScanInternal();
        resolve();
      }, 300);
    });
  }, [triggerNotesScanInternal]);

  // Keep the ref up-to-date so the watcher can always call the latest version
  useEffect(() => {
    triggerNotesScanRef.current = triggerNotesScan;
  }, [triggerNotesScan]);

  // Auto-scan note metadata, board cards, and tasks with debouncing when files are loaded or updated
  useEffect(() => {
    if (files.length === 0) return;
    
    const timer = setTimeout(() => {
      triggerNotesScan();
    }, 1000);

    return () => clearTimeout(timer);
  }, [files, triggerNotesScan]);

  const deepReindex = useCallback(async () => {
    setIsScanLoading(true);
    try {
      noteCacheRef.current = new Map();
      setNoteCache({});
      await searchEngine.init();
      await searchEngine.execute("DELETE FROM note_metadata");
      await searchEngine.execute("DELETE FROM ai_suggestions");
      await invokeIPC("unwatch_vault", {}).catch(() => { });
      if (vaultPath) {
        await invokeIPC("watch_vault", { vaultPath });
      }
      await refreshFiles();
    } catch (err) {
      console.error("Deep reindex failed:", err);
    } finally {
      setIsScanLoading(false);
    }
  }, [refreshFiles, vaultPath]);

  // Auto-initialize special folders (Templates, Archived, Trash) and run Trash auto-purge (24 hours)
  useEffect(() => {
    if (!vaultPath) return;

    const initSpecialFolders = async () => {
      try {
        // Run trash auto-purge (notes > 24 hours old)
        const purgedCount = await invokeIPC("purge_expired_trash", { vaultPath, maxAgeHours: 24 }).catch((e) => {
          console.warn("Trash purge warning:", e);
          return 0;
        });

        if (purgedCount && purgedCount > 0) {
          window.dispatchEvent(
            new CustomEvent("kognote-toast", {
              detail: { message: `Purged ${purgedCount} expired item${purgedCount > 1 ? "s" : ""} from Trash (>24 hrs old)` },
            })
          );
        }

        // Ensure Templates folder exists
        const templatesDir = pathJoin(vaultPath, TEMPLATES_FOLDER);
        const templatesExist = await invokeIPC("fs_exists", { path: templatesDir }).catch(() => false);
        if (!templatesExist) {
          await invokeIPC("fs_mkdir", { path: templatesDir }).catch(() => { });
        }

        // 1. Purge legacy deprecated built-in templates if present
        for (const legacyName of LEGACY_DEPRECATED_TEMPLATES) {
          const legacyPath = pathJoin(templatesDir, legacyName);
          const exists = await invokeIPC("fs_exists", { path: legacyPath }).catch(() => false);
          if (exists) {
            await invokeIPC("delete_note", { path: legacyPath }).catch(() => { });
          }
        }

        // 2. Initialize official bundled templates (Meeting Notes & Weekly Review)
        for (const tpl of BUILTIN_TEMPLATES) {
          const tplPath = pathJoin(templatesDir, `${tpl.name}.md`);
          const exists = await invokeIPC("fs_exists", { path: tplPath }).catch(() => false);
          if (!exists) {
            await invokeIPC("fs_write", { path: tplPath, content: tpl.content }).catch(() => { });
          }
        }

        // Populate bundled onboarding guides & interactive sample note if not present
        for (const note of ONBOARDING_NOTES) {
          const notePath = pathJoin(vaultPath, note.filename);
          const exists = await invokeIPC("fs_exists", { path: notePath }).catch(() => false);
          if (!exists) {
            await invokeIPC("fs_write", { path: notePath, content: note.content }).catch(() => { });
          }
        }
      } catch (e) {
        console.warn("Special folders init warning:", e);
      }
    };

    initSpecialFolders();
  }, [vaultPath]);

  const updateNoteCache = useCallback((path: string, content: string) => {
    const fm = parseFrontmatter(content);
    const fileName = path.replace(/\\/g, "/").split("/").pop() || "";
    const noteName = fileName.replace(/\.md$/, "");

    // 1. Parse checklist tasks
    const lines = content.split(/\r?\n/);
    const tasks: ScannedTask[] = [];
    const dateRefs: { id: string; notePath: string; noteName: string; date: string; context: string }[] = [];
    const dateRegex = /\b(\d{4}[-\/]\d{2}[-\/]\d{2})\b/g;

    lines.forEach((line, idx) => {
      const taskMatch = line.match(/^(\s*)[-*]\s*\[([ xX])\]\s*(.*)$/);
      if (taskMatch) {
        const completed = taskMatch[2].toLowerCase() === "x";
        const rawTaskContent = taskMatch[3].trim();

        // Extract due date and time from task line (@YYYY-MM-DD, @due:YYYY-MM-DD, etc.)
        let dueDate: string | undefined = undefined;
        let dueTime: string | undefined = undefined;
        let rawDueDate: string | undefined = undefined;

        const isoMatch = rawTaskContent.match(/(?:@due:?|@|due:\s*)?(20\d{2}[-/]\d{2}[-/]\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)/i);
        if (isoMatch && isoMatch[1]) {
          rawDueDate = isoMatch[1];
          const { dateStr, timeStr } = getZonedDateParts(rawDueDate);
          dueDate = dateStr;
          dueTime = timeStr;
        } else {
          const dtMatch = rawTaskContent.match(/(?:@due:?|@|due:\s*)?(20\d{2}[-/](?:0[1-9]|1[0-2])[-/](?:0[1-9]|[12]\d|3[01]))(?:[ T]([01]\d|2[0-3]):([0-5]\d))?/i);
          if (dtMatch && dtMatch[1]) {
            dueDate = dtMatch[1].replace(/\//g, "-");
            if (dtMatch[2] && dtMatch[3]) {
              dueTime = `${dtMatch[2]}:${dtMatch[3]}`;
            }
          }
        }

        // Extract inline tags (#tag)
        const tagMatches = rawTaskContent.match(/#([a-zA-Z0-9_\-\/]+)/g) || [];
        const taskTags = tagMatches.map(t => t.substring(1));

        // Extract priority (!, !!, !!!)
        let priority: "high" | "medium" | "low" | "none" = "none";
        if (/@task!!!|(?:\b|\s|^)!!!(?:\b|\s|$)/i.test(rawTaskContent)) {
          priority = "high";
        } else if (/@task!!|(?:\b|\s|^)!!(?:\b|\s|$)/i.test(rawTaskContent)) {
          priority = "medium";
        } else if (/@task!|(?:\b|\s|^)!(?:\b|\s|$)/i.test(rawTaskContent)) {
          priority = "low";
        }

        // Clean task content string (remove exclamations, dates, tags)
        let cleanTaskContent = rawTaskContent
          .replace(/(?:^|\s|\\)#([a-zA-Z0-9_\-\/]+)/g, "")
          .replace(/(?:@due:?|@|due:\s*)?20\d{2}[-/]\d{2}[-/]\d{2}(?:T[^\s]+|[ T]\d{2}:\d{2})?/gi, "")
          .replace(/@task(!*)/gi, "")
          .replace(/(?:\b|\s|^)!{1,3}(?:\b|\s|$)/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        tasks.push({
          id: `${path}:${idx}`,
          notePath: path,
          noteName,
          content: cleanTaskContent || rawTaskContent,
          completed,
          lineNumber: idx,
          dueDate,
          dueTime,
          rawDueDate,
          tags: taskTags,
          priority
        });
      }

      // Date references scan
      let dMatch;
      while ((dMatch = dateRegex.exec(line)) !== null) {
        const dateStr = dMatch[1].replace(/\//g, "-");
        dateRefs.push({
          id: `${path}:${idx}:${dMatch.index}`,
          notePath: path,
          noteName,
          date: dateStr,
          context: line.trim()
        });
      }
    });

    // 2. Parse Tags
    const tagSet = new Set<string>();
    const tagMatches = content.match(/#([a-zA-Z0-9_\-\/]+)/g) || [];
    tagMatches.forEach(t => {
      const clean = t.substring(1).toLowerCase();
      if (clean && isNaN(Number(clean))) tagSet.add(clean);
    });
    const tags = Array.from(tagSet);

    // 3. Parse Wiki-links
    const linkSet = new Set<string>();
    const wikiMatches = content.matchAll(/(?:\\?\[){2}(.*?)(?:\\?\]){2}/g);
    for (const m of wikiMatches) {
      const linkName = m[1].replace(/\\/g, "").trim();
      if (linkName && linkName.toLowerCase() !== "none") {
        linkSet.add(linkName);
      }
    }
    const links = Array.from(linkSet);

    // 4. Parse URLs
    const urlSet = new Set<string>();
    const urlMatches = content.match(/https?:\/\/[^\s\)\>\]]+/g) || [];
    urlMatches.forEach(u => urlSet.add(u));
    const urls = Array.from(urlSet);

    // 5. Board Card computation
    let boardCard: BoardCard | null = null;
    const rawStatus = (fm.fields.status || "none").toLowerCase();
    if (rawStatus && rawStatus !== "none") {
      let mappedStatus: "Backlog" | "Todo" | "In Progress" | "In Review" | "Done" = "Todo";
      if (rawStatus === "backlog") mappedStatus = "Backlog";
      else if (rawStatus === "todo") mappedStatus = "Todo";
      else if (rawStatus === "in-progress" || rawStatus === "inprogress") mappedStatus = "In Progress";
      else if (rawStatus === "in-review" || rawStatus === "inreview") mappedStatus = "In Review";
      else if (rawStatus === "done") mappedStatus = "Done";

      const priority = (fm.fields.priority || "none").toLowerCase() as any;
      const todoTasks = tasks.filter(t => !t.completed).length;
      const completedTasks = tasks.filter(t => t.completed).length;

      const bodyWithoutFm = fm.bodyContent.trim();
      const snippet = bodyWithoutFm.substring(0, 140).replace(/[\r\n]+/g, " ");
      const words = bodyWithoutFm ? bodyWithoutFm.split(/\s+/).filter(Boolean).length : 0;

      const pathLower = path.replace(/\\/g, "/").toLowerCase();
      let syncedStorage = fm.fields.storage || "active";
      if (pathLower.includes("/archived/")) syncedStorage = "archived";
      else if (pathLower.includes("/trash/") || pathLower.includes("/.deleted/")) syncedStorage = "deleted";

      const fileEntry: FileEntry = {
        name: fileName,
        path,
        is_dir: false,
      };

      boardCard = {
        file: fileEntry,
        title: noteName,
        snippet,
        tags,
        status: mappedStatus,
        todoTasks,
        completedTasks,
        wordCount: words,
        dueDate: fm.fields.due || undefined,
        type: fm.fields.type || "note",
        storage: syncedStorage as "active" | "archived" | "deleted",
        bookmarked: fm.fields.bookmarked === "yes",
        priority
      };
    }

    const existingMeta = noteCacheRef.current.get(path)?.meta || {};
    const updated: NoteCachedData = {
      path,
      modifiedAt: Date.now(),
      tags,
      links,
      urls,
      tasks,
      dateRefs,
      boardCard,
      meta: { ...existingMeta, ...fm.fields } as any,
      content,
    };

    noteCacheRef.current.set(path, updated);
    setNoteCache((prev) => ({ ...prev, [path]: updated }));

    // Async sync links to SQLite note_links table for backlink persistence
    searchEngine.syncNoteLinks(path, links).catch(console.error);
  }, []);

  /**
   * Universal helper to move a note between directories (vault root, /Archived/, /Trash/).
   * Atomically updates frontmatter, removes the old file from disk to prevent duplication,
   * overwrites stale target copies, and updates active tab state.
   */
  const moveNoteToDirectory = useCallback(async (
    oldPath: string,
    targetDir: string,
    newStorage: "active" | "archived" | "deleted",
    newBookmarked?: "yes" | "no"
  ): Promise<string> => {
    if (!vaultPath) return oldPath;

    const oldPathNormalized = oldPath.replace(/\\/g, "/");
    const targetDirNormalized = targetDir.replace(/\\/g, "/");

    const lastSlashOld = oldPathNormalized.lastIndexOf("/");
    const oldParentDir = lastSlashOld !== -1 ? oldPathNormalized.substring(0, lastSlashOld) : vaultPath.replace(/\\/g, "/");
    const fileName = lastSlashOld !== -1 ? oldPathNormalized.substring(lastSlashOld + 1) : oldPathNormalized;

    // A file is already in targetDir IF AND ONLY IF its parent directory matches targetDir!
    const isAlreadyInTargetDir = oldParentDir.toLowerCase() === targetDirNormalized.toLowerCase();

    let targetPath = oldPath;
    if (!isAlreadyInTargetDir) {
      targetPath = pathJoin(targetDir, fileName);
    }

    const targetPathNormalized = targetPath.replace(/\\/g, "/");

    if (oldPathNormalized.toLowerCase() !== targetPathNormalized.toLowerCase()) {
      // Delete any stale existing duplicate file at targetPath to avoid collisions
      const existsAtTarget = await invokeIPC("fs_exists", { path: targetPath }).catch(() => false);
      if (existsAtTarget) {
        await invokeIPC("delete_note", { path: targetPath }).catch(() => { });
      }
    }

    if (oldPath.endsWith(".md")) {
      let rawContent = "";
      try {
        rawContent = (await invokeIPC("read_note", { path: oldPath })) as string;
      } catch (err) {
        console.error("Failed to read note during move:", err);
        return oldPath;
      }

      const parsed = parseFrontmatter(rawContent);
      const bookmarkedStatus = newBookmarked !== undefined
        ? newBookmarked
        : (newStorage === "active" ? (parsed.fields.bookmarked || "no") : "no");

      const newHeader = stringifyFrontmatter({
        type: parsed.fields.type || "note",
        status: parsed.fields.status || "none",
        priority: parsed.fields.priority || "none",
        due: parsed.fields.due || "",
        created: parsed.fields.created || getCurrentIsoTimestamp(),
        updated: getCurrentIsoTimestamp(),
        storage: newStorage,
        bookmarked: bookmarkedStatus,
        mentions: parsed.fields.mentions || [],
      });

      const updatedContent = `${newHeader}\n\n${parsed.bodyContent.replace(/^\r?\n+/, "")}`;

      if (oldPathNormalized.toLowerCase() !== targetPathNormalized.toLowerCase()) {
        // Write new file at targetPath FIRST
        await invokeIPC("write_note", { path: targetPath, content: updatedContent });
        // Delete original file at oldPath to guarantee NO duplicate remains!
        await invokeIPC("delete_note", { path: oldPath }).catch((e) => console.warn("Failed to remove old file:", e));
      } else {
        await invokeIPC("write_note", { path: oldPath, content: updatedContent });
      }

      updateNoteCache(targetPath, updatedContent);
    } else {
      if (oldPathNormalized.toLowerCase() !== targetPathNormalized.toLowerCase()) {
        await invokeIPC("fs_copy", { src: oldPath, dest: targetPath });
        await invokeIPC("delete_note", { path: oldPath }).catch(() => { });
      }
    }

    // Reset editor dirty flag to prevent debounced auto-save from writing to oldPath
    window.dispatchEvent(new CustomEvent("kognote-reset-editor-dirty"));

    // Update openFiles and activeFile references cleanly
    setOpenFiles((prev) =>
      prev.map((f) => {
        if (f.path.replace(/\\/g, "/").toLowerCase() === oldPathNormalized.toLowerCase()) {
          const newName = targetPath.replace(/\\/g, "/").split("/").pop() || f.name;
          return { ...f, path: targetPath, name: newName };
        }
        return f;
      })
    );

    if (activeFile && activeFile.path.replace(/\\/g, "/").toLowerCase() === oldPathNormalized.toLowerCase()) {
      const newName = targetPath.replace(/\\/g, "/").split("/").pop() || activeFile.name;
      setActiveFile({ ...activeFile, path: targetPath, name: newName });
    }

    await refreshFiles();
    return targetPath;
  }, [vaultPath, activeFile, setOpenFiles, setActiveFile, updateNoteCache, refreshFiles]);

  const bookmarkNote = useCallback(async (path: string) => {
    if (!vaultPath) return;
    try {
      const rawContent = (await invokeIPC("read_note", { path })) as string;
      const parsed = parseFrontmatter(rawContent);

      const pathLower = path.replace(/\\/g, "/").toLowerCase();
      const archivedDirLower = pathJoin(vaultPath, ARCHIVED_FOLDER).replace(/\\/g, "/").toLowerCase();
      const trashDirLower = pathJoin(vaultPath, DELETED_FOLDER).replace(/\\/g, "/").toLowerCase();

      const isInArchivedFolder = pathLower.startsWith(archivedDirLower + "/") || pathLower === archivedDirLower || pathLower.includes("/archived/");
      const isInTrashFolder = pathLower.startsWith(trashDirLower + "/") || pathLower === trashDirLower || pathLower.includes("/trash/") || pathLower.includes("/.deleted/");
      const isMarkedArchivedOrDeleted = parsed.fields.storage === "archived" || parsed.fields.storage === "deleted";

      const isArchivedOrDeleted = isInArchivedFolder || isInTrashFolder || isMarkedArchivedOrDeleted;

      if (isArchivedOrDeleted) {
        // Bookmarking an archived or deleted note restores it to its proper active home directory (Templates, Daily Notes, Clippings, or Vault Root)
        const noteType = (parsed.fields.type || noteCache[path]?.meta?.type || "").toLowerCase();
        let targetDir = vaultPath;
        if (noteType === "template" || pathLower.includes("/templates/")) {
          targetDir = pathJoin(vaultPath, TEMPLATES_FOLDER);
        } else if (noteType === "daily" || pathLower.includes("/daily notes/")) {
          targetDir = pathJoin(vaultPath, DAILY_NOTES_FOLDER);
        } else if (noteType === "clipping" || pathLower.includes("/clippings/") || pathLower.includes("/web clippings/")) {
          targetDir = pathJoin(vaultPath, CLIPPINGS_FOLDER);
        }

        if (targetDir !== vaultPath) {
          await invokeIPC("fs_mkdir", { path: targetDir }).catch(() => { });
        }

        const newPath = await moveNoteToDirectory(path, targetDir, "active", "yes");
        const fileName = newPath.split(/[\/\\]/).pop()?.replace(/\.md$/, "") || "";
        window.dispatchEvent(new CustomEvent("kognote-toast", { detail: { message: `Restored & Bookmarked "${fileName}"` } }));
      } else {
        // Toggle bookmark in place for active notes
        const isCurrentlyBookmarked = parsed.fields.bookmarked === "yes";
        const newBookmarked = isCurrentlyBookmarked ? "no" : "yes";
        const lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
        const parentDir = lastSlash !== -1 ? path.substring(0, lastSlash) : vaultPath;
        await moveNoteToDirectory(path, parentDir, "active", newBookmarked);
      }
    } catch (e) {
      console.error("Failed to bookmark note:", e);
    }
  }, [vaultPath, noteCache, moveNoteToDirectory]);

  const archiveNote = useCallback(async (path: string) => {
    if (!vaultPath) return;
    try {
      const archivedDir = pathJoin(vaultPath, ARCHIVED_FOLDER);
      const exists = await invokeIPC("fs_exists", { path: archivedDir }).catch(() => false);
      if (!exists) {
        await invokeIPC("fs_mkdir", { path: archivedDir }).catch(() => { });
      }
      await moveNoteToDirectory(path, archivedDir, "archived", "no");
    } catch (e) {
      console.error("Failed to archive note:", e);
    }
  }, [vaultPath, moveNoteToDirectory]);

  const deleteNoteToTrash = useCallback(async (path: string) => {
    if (!vaultPath) return;
    try {
      const trashDir = pathJoin(vaultPath, DELETED_FOLDER);
      const exists = await invokeIPC("fs_exists", { path: trashDir }).catch(() => false);
      if (!exists) {
        await invokeIPC("fs_mkdir", { path: trashDir }).catch(() => { });
      }
      await moveNoteToDirectory(path, trashDir, "deleted", "no");
    } catch (e) {
      console.error("Failed to move note to trash:", e);
    }
  }, [vaultPath, moveNoteToDirectory]);

  const restoreNote = useCallback(async (path: string) => {
    if (!vaultPath) return;
    try {
      const rawContent = (await invokeIPC("read_note", { path }).catch(() => "")) as string;
      const parsed = parseFrontmatter(rawContent);
      const pathLower = path.replace(/\\/g, "/").toLowerCase();
      const noteType = (parsed.fields.type || noteCache[path]?.meta?.type || "").toLowerCase();

      let targetDir = vaultPath;
      if (noteType === "template" || pathLower.includes("/templates/")) {
        targetDir = pathJoin(vaultPath, TEMPLATES_FOLDER);
      } else if (noteType === "daily" || pathLower.includes("/daily notes/")) {
        targetDir = pathJoin(vaultPath, DAILY_NOTES_FOLDER);
      } else if (noteType === "clipping" || pathLower.includes("/clippings/") || pathLower.includes("/web clippings/")) {
        targetDir = pathJoin(vaultPath, CLIPPINGS_FOLDER);
      }

      if (targetDir !== vaultPath) {
        await invokeIPC("fs_mkdir", { path: targetDir }).catch(() => { });
      }

      const newPath = await moveNoteToDirectory(path, targetDir, "active", "no");
      const fileName = newPath.split(/[\/\\]/).pop() || "";
      window.dispatchEvent(new CustomEvent("kognote-toast", { detail: { message: `Restored "${fileName}"` } }));
    } catch (e) {
      console.error("Failed to restore note:", e);
    }
  }, [vaultPath, noteCache, moveNoteToDirectory]);

  const deleteFileOrDirectory = useCallback(async (path: string) => {
    if (!vaultPath) return;

    const fileName = path.split(/[\/\\]/).pop() || "";
    if (isProtectedFolder(path)) {
      await message(`"${fileName}" is a protected system folder and cannot be deleted.`, {
        title: "Protected Folder",
        kind: "error"
      });
      return;
    }

    const cleanPath = path.replace(/\\/g, "/").toLowerCase();
    const trashFolderLower = pathJoin(vaultPath, DELETED_FOLDER).replace(/\\/g, "/").toLowerCase();

    // Check if item is already inside Trash folder or marked storage: deleted
    const isInTrash = cleanPath.includes(`/${DELETED_FOLDER.toLowerCase()}/`) || cleanPath.startsWith(trashFolderLower);
    const cachedData = noteCacheRef.current.get(path) || Object.values(noteCache).find((c) => c.path === path);
    const isMarkedDeleted = cachedData?.meta?.storage === "deleted";

    if (isInTrash || isMarkedDeleted) {
      // Already in Trash -> PERMANENT DELETE (with warning confirm)
      const confirmed = await confirm(
        `Are you sure you want to permanently delete "${fileName}"? This action cannot be undone.`,
        { title: "Permanently Delete", kind: "warning" }
      );
      if (!confirmed) return;

      await invokeIPC("delete_note", { path });
      closeFile(path);
      await refreshFiles();
      window.dispatchEvent(new CustomEvent("kognote-toast", { detail: { message: `Permanently deleted ${fileName}` } }));
    } else {
      // Outside Trash -> MOVE TO TRASH FOLDER
      await deleteNoteToTrash(path);
    }
  }, [vaultPath, closeFile, refreshFiles, isProtectedFolder, noteCache, deleteNoteToTrash]);

  const restoreAllTrash = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const trashDir = pathJoin(vaultPath, DELETED_FOLDER);
      const exists = await invokeIPC("fs_exists", { path: trashDir }).catch(() => false);
      if (!exists) return;

      const trashFiles: FileEntry[] = await invokeIPC("list_vault_files", { vaultPath: trashDir });
      if (!trashFiles || trashFiles.length === 0) {
        window.dispatchEvent(new CustomEvent("kognote-toast", { detail: { message: "Trash is already empty" } }));
        return;
      }

      let count = 0;
      const processRestore = async (entries: FileEntry[]) => {
        for (const entry of entries) {
          if (entry.is_dir && entry.children) {
            await processRestore(entry.children);
          } else {
            await restoreNote(entry.path);
            count++;
          }
        }
      };

      await processRestore(trashFiles);
      await refreshFiles();
      window.dispatchEvent(new CustomEvent("kognote-toast", { detail: { message: `Restored ${count} item${count !== 1 ? "s" : ""} from Trash` } }));
    } catch (e) {
      console.error("Failed to restore all trash:", e);
    }
  }, [vaultPath, restoreNote, refreshFiles]);

  const emptyTrash = useCallback(async () => {
    if (!vaultPath) return;
    try {
      const trashDir = pathJoin(vaultPath, DELETED_FOLDER);
      const exists = await invokeIPC("fs_exists", { path: trashDir }).catch(() => false);
      if (!exists) return;

      const trashFiles: FileEntry[] = await invokeIPC("list_vault_files", { vaultPath: trashDir });
      if (!trashFiles || trashFiles.length === 0) {
        window.dispatchEvent(new CustomEvent("kognote-toast", { detail: { message: "Trash is already empty" } }));
        return;
      }

      const confirmed = await confirm(
        `Are you sure you want to permanently delete all items in Trash? This action cannot be undone.`,
        { title: "Empty Trash", kind: "warning" }
      );
      if (!confirmed) return;

      const processDelete = async (entries: FileEntry[]) => {
        for (const entry of entries) {
          if (entry.is_dir && entry.children) {
            await processDelete(entry.children);
          }
          await invokeIPC("delete_note", { path: entry.path }).catch(() => {});
          closeFile(entry.path);
        }
      };

      await processDelete(trashFiles);
      await refreshFiles();
      window.dispatchEvent(new CustomEvent("kognote-toast", { detail: { message: "Trash emptied successfully" } }));
    } catch (e) {
      console.error("Failed to empty trash:", e);
    }
  }, [vaultPath, closeFile, refreshFiles]);

  const saveAsTemplate = useCallback(async (path: string, templateName: string): Promise<string> => {
    if (!vaultPath) throw new Error("No vault path");
    const templatesDir = pathJoin(vaultPath, TEMPLATES_FOLDER);
    const exists = await invokeIPC("fs_exists", { path: templatesDir }).catch(() => false);
    if (!exists) {
      await invokeIPC("fs_mkdir", { path: templatesDir }).catch(() => { });
    }

    const nameWithExt = templateName.endsWith(".md") ? templateName : `${templateName}.md`;
    const targetPath = pathJoin(templatesDir, nameWithExt);

    const rawContent = (await invokeIPC("read_note", { path })) as string;
    const parsed = parseFrontmatter(rawContent);

    const newHeader = stringifyFrontmatter({
      type: "template",
      status: parsed.fields.status || "none",
      priority: parsed.fields.priority || "medium",
      due: "",
      created: getCurrentIsoTimestamp(),
      updated: getCurrentIsoTimestamp(),
      storage: "active",
      bookmarked: "no",
      mentions: [],
    });

    const templateContent = `${newHeader}\n\n${parsed.bodyContent.replace(/^\r?\n+/, "")}`;
    await invokeIPC("write_note", { path: targetPath, content: templateContent });
    await refreshFiles();
    return targetPath;
  }, [vaultPath, refreshFiles]);

  const getTemplates = useCallback(async () => {
    if (!vaultPath) return [];
    const templatesDir = pathJoin(vaultPath, TEMPLATES_FOLDER);
    const result: { name: string; path: string; content: string; type: string }[] = [];

    try {
      const exists = await invokeIPC("fs_exists", { path: templatesDir }).catch(() => false);
      if (!exists) return [];

      const fileList: FileEntry[] = await invokeIPC("list_vault_files", { vaultPath: templatesDir });
      for (const entry of fileList) {
        if (!entry.is_dir && entry.name.endsWith(".md")) {
          const content = (await invokeIPC("read_note", { path: entry.path }).catch(() => "")) as string;
          const parsed = parseFrontmatter(content);
          const name = entry.name.replace(/\.md$/, "");
          const type = parsed.fields.type || name.toLowerCase().replace(/\s+/g, "-");
          result.push({ name, path: entry.path, content, type });
        }
      }
    } catch (e) {
      console.warn("Failed to list templates:", e);
    }
    return result;
  }, [vaultPath]);

  return (
    <VaultContext.Provider
      value={{
        files,
        vaultPath,
        activeFile,
        openFiles,
        setOpenFiles,
        setActiveFile,
        openFile,
        closeFile,
        refreshFiles,
        createFile,
        createDirectory,
        deleteFileOrDirectory,
        renameFileOrDirectory,
        openNoteByName,
        openDailyNote,
        getDailyNoteFile,
        activeView,
        setActiveView,
        isProtectedFolder,
        attachmentsFolderPath,
        createFileModal,
        setCreateFileModal,
        previewAttachment,
        setPreviewAttachment,
        importAttachment,
        bookmarkNote,
        archiveNote,
        deleteNoteToTrash,
        restoreNote,
        restoreAllTrash,
        emptyTrash,
        saveAsTemplate,
        getTemplates,
        noteCache,
        updateNoteCache,
        isScanLoading,
        triggerNotesScan,
        deepReindex,
      }}
    >
      {children}
    </VaultContext.Provider>
  );
};

export const useVault = () => {
  const context = useContext(VaultContext);
  if (!context) {
    throw new Error("useVault must be used within a VaultProvider");
  }
  return context;
};
