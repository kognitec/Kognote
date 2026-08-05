import React, { useState, useEffect, useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useVault, FileEntry, ATTACHMENTS_FOLDER } from "../contexts/VaultContext";
import { useSync } from "../contexts/SyncContext";
import { searchEngine } from "../lib/search-engine";
import { invokeIPC } from "../lib/ipc";
import { setDragState, getDragState, clearDragState } from "../lib/drag-state";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getFileIcon } from "../lib/file-icons";
import { isValidTagToken } from "../lib/tag-utils";
import {
  Folder,
  FileText,
  Plus,
  FolderPlus,
  Trash2,
  Edit,
  ChevronRight,
  Search,
  Lock,
  Check,
  X,
  Tag,
  Calendar,
  Paperclip,
  Globe,
  Image as ImageIcon,
  ExternalLink,
  ArrowUpDown,
  Filter,
  Bookmark,
  RotateCcw,
} from "lucide-react";

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif"];
const isImageFile = (name: string) => IMAGE_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));

type SortOption =
  | "name_asc"
  | "name_desc"
  | "modified_desc"
  | "modified_asc"
  | "created_desc"
  | "created_asc";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "name_asc", label: "File name (A to Z)" },
  { value: "name_desc", label: "File name (Z to A)" },
  { value: "modified_desc", label: "Modified time (new to old)" },
  { value: "modified_asc", label: "Modified time (old to new)" },
  { value: "created_desc", label: "Created time (new to old)" },
  { value: "created_asc", label: "Created time (old to new)" },
];

export interface FlatTreeItem {
  item: FileEntry;
  depth: number;
}

interface TreeItemProps {
  item: FileEntry;
  depth: number;
  isOpen: boolean;
  onToggleFolder: (path: string) => void;
}

export const FileTree: React.FC = () => {
  const {
    files,
    vaultPath,
    createDirectory,
    deleteFileOrDirectory,
    openFile,
    openDailyNote,
    setCreateFileModal,
    noteCache,
    attachmentsFolderPath,
    importAttachment,
    previewAttachment,
    setPreviewAttachment,
  } = useVault();
  const { registerSyncHandler, unregisterSyncHandler } = useSync();
  const [filter, setFilter] = useState("");
  const [fileTypeFilter, setFileTypeFilter] = useState<"all" | "md" | "canvas" | "templates" | "clippings">("all");
  const [isCreatingDir, setIsCreatingDir] = useState(false);
  const [newName, setNewName] = useState("");

  // Sort & Filter Dropdown State
  const [sortOption, setSortOption] = useState<SortOption>(() => {
    return (localStorage.getItem("vault_sort_option") as SortOption) || "name_asc";
  });
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const sortDropdownRef = useRef<HTMLDivElement>(null);

  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const filterDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setIsSortDropdownOpen(false);
      }
      if (filterDropdownRef.current && !filterDropdownRef.current.contains(e.target as Node)) {
        setIsFilterDropdownOpen(false);
      }
    };
    if (isSortDropdownOpen || isFilterDropdownOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [isSortDropdownOpen, isFilterDropdownOpen]);

  const changeSortOption = (opt: SortOption) => {
    setSortOption(opt);
    localStorage.setItem("vault_sort_option", opt);
  };

  const vaultFolderName = useMemo(() => {
    if (!vaultPath) return "Vault";
    const parts = vaultPath.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts[parts.length - 1] || "Vault";
  }, [vaultPath]);

  const vaultTooltip = useMemo(() => {
    return vaultPath
      ? `Vault: ${vaultFolderName}\nPath: ${vaultPath}`
      : "Vault Notes Directory";
  }, [vaultPath, vaultFolderName]);

  // Tab State
  const [activeTab, setActiveTab] = useState<"files" | "tags" | "attachments" | "urls">("files");

  // Tag Tab State
  const [tagsList, setTagsList] = useState<{ name: string; type: "manual" | "ai"; count: number }[]>([]);
  const [tagNotesMap, setTagNotesMap] = useState<Record<string, { type: "manual" | "ai"; notes: FileEntry[] }>>({});
  const [selectedTag, setSelectedTag] = useState<{ name: string; type: "manual" | "ai" } | null>(null);
  const [tagSearch, setTagSearch] = useState("");

  // Attachments Tab State
  const [attachmentsList, setAttachmentsList] = useState<FileEntry[]>([]);
  const [attachmentNotesMap, setAttachmentNotesMap] = useState<Record<string, FileEntry[]>>({});

  // URLs Tab State
  const [urlsList, setUrlsList] = useState<{ url: string; notes: FileEntry[] }[]>([]);
  const [isScanning, setIsScanning] = useState<boolean>(false);

  // Sidebar Layout State
  const [isStarredOpen, setIsStarredOpen] = useState(true);
  const [isFooterExpanded, setIsFooterExpanded] = useState(false);

  // Traverse helper to walk vault recursively
  const traverseFiles = (entries: FileEntry[], callback: (entry: FileEntry) => void) => {
    entries.forEach((entry) => {
      const normalizedPath = entry.path.replace(/\\/g, "/");
      if (normalizedPath.includes("/Daily Logs/") || normalizedPath.endsWith("/Daily Logs")) {
        return;
      }
      callback(entry);
      if (entry.is_dir && entry.children) {
        traverseFiles(entry.children, callback);
      }
    });
  };

  // Scan all vault files for tags, attachments, and URLs
  const scanVaultData = async () => {
    if (!files || files.length === 0) return;
    setIsScanning(true);

    const tagsMap: Record<string, FileEntry[]> = {};
    const aiTagsMap: Record<string, FileEntry[]> = {};
    const attachments: FileEntry[] = [];
    const attachmentNotes: Record<string, FileEntry[]> = {};
    const urlsMap: Record<string, FileEntry[]> = {};
    const mdFiles: FileEntry[] = [];

    // Only collect image attachments from the Attachments/ protected folder
    const collectAttachments = (entries: FileEntry[]) => {
      entries.forEach((entry) => {
        if (entry.is_dir) {
          const isAttachmentsFolder = entry.name.toLowerCase() === ATTACHMENTS_FOLDER.toLowerCase();
          if (isAttachmentsFolder && entry.children) {
            entry.children.forEach((child) => {
              if (!child.is_dir && isImageFile(child.name)) {
                attachments.push(child);
                attachmentNotes[child.name] = [];
              }
            });
          } else if (entry.children) {
            collectAttachments(entry.children);
          }
        }
      });
    };
    collectAttachments(files);

    // Collect all markdown and note files for scanning tags/URLs/attachment references
    traverseFiles(files, (entry) => {
      if (entry.is_dir) return;
      if (entry.name.toLowerCase().endsWith(".md") || entry.name.toLowerCase().endsWith(".excalidraw")) {
        mdFiles.push(entry);
      }
    });

    setAttachmentsList(attachments);

    for (const note of mdFiles) {
      if (note.name.toLowerCase().endsWith(".excalidraw")) {
        continue;
      }
      try {
        const cached = noteCache[note.path];
        if (!cached) continue;

        // 1. Use pre-parsed tags from cache
        (cached.tags || []).forEach((tag) => {
          const t = tag.toLowerCase();
          if (isValidTagToken(t)) {
            if (!tagsMap[t]) tagsMap[t] = [];
            if (!tagsMap[t].some((n) => n.path === note.path)) {
              tagsMap[t].push(note);
            }
          }
        });

        // 2. Use pre-parsed URLs from cache
        (cached.urls || []).forEach((url) => {
          const cleanUrl = url.trim();
          if (!urlsMap[cleanUrl]) {
            urlsMap[cleanUrl] = [];
          }
          if (!urlsMap[cleanUrl].some((n) => n.path === note.path)) {
            urlsMap[cleanUrl].push(note);
          }
        });

        // 3. Find which attachments this note references
        if (cached.content) {
          for (const att of attachments) {
            if (cached.content.includes(att.name)) {
              if (!attachmentNotes[att.name]) attachmentNotes[att.name] = [];
              if (!attachmentNotes[att.name].some((n) => n.path === note.path)) {
                attachmentNotes[att.name].push(note);
              }
            }
          }
        }

        // 4. Scan AI suggestions directly from the note file contents
        if (cached.content) {
          try {
            const startMarker = "<!-- AI Generated Content:";
            const endMarker = "-->";
            const startIdx = cached.content.indexOf(startMarker);

            if (startIdx !== -1) {
              const endIdx = cached.content.indexOf(endMarker, startIdx);
              if (endIdx !== -1) {
                const aiText = cached.content.substring(startIdx + startMarker.length, endIdx);

                let parsedAiTags: string[] = [];
                let parsedAiLinks: string[] = [];

                // Parse tags
                const tagsLineMatch = aiText.match(/AI Tags:\s*([^|]*)/i);
                if (tagsLineMatch) {
                  const tagsText = tagsLineMatch[1];
                  const tagsFound = tagsText.match(/#([a-zA-Z0-9_\-\/]+)/g);
                  if (tagsFound) {
                    parsedAiTags = tagsFound.map((t: string) => t.substring(1));
                  }
                }

                // Parse backlinks
                const linksLineMatch = aiText.match(/AI Backlinks:\s*([^|]*)/i);
                const activeBacklinksText = linksLineMatch ? linksLineMatch[1] : aiText;
                const linksFound = activeBacklinksText.matchAll(/(?:\\?\[){2}(.*?)(?:\\?\]){2}/g);
                for (const m of linksFound) {
                  const linkName = m[1].replace(/\\/g, "").trim();
                  if (linkName && linkName !== "None") {
                    parsedAiLinks.push(linkName);
                  }
                }

                // Sync/update SQLite database suggestions cache
                await searchEngine.saveAiSuggestions(note.path, parsedAiTags, parsedAiLinks);

                // Register tags to sidebar Tags list
                parsedAiTags.forEach((tag) => {
                  const cleanTag = tag.toLowerCase().trim();
                  const alreadyManualInNote = tagsMap[cleanTag]?.some((n) => n.path === note.path);
                  if (cleanTag && cleanTag !== "flashcard" && !alreadyManualInNote) {
                    if (!aiTagsMap[cleanTag]) {
                      aiTagsMap[cleanTag] = [];
                    }
                    if (!aiTagsMap[cleanTag].some((n) => n.path === note.path)) {
                      aiTagsMap[cleanTag].push(note);
                    }
                  }
                });
              }
            }
          } catch (e) {
            console.warn("Failed to parse/save AI suggestions during file scan:", note.path, e);
          }
        }
      } catch (err) {
        console.error(`Failed to scan note tags/urls: ${note.path}`, err);
      }
    }

    const unifiedTagsMap: Record<string, { type: "manual" | "ai"; notes: FileEntry[] }> = {};
    const formattedTags: { name: string; type: "manual" | "ai"; count: number }[] = [];

    // Add manual tags
    Object.entries(tagsMap).forEach(([name, notes]) => {
      unifiedTagsMap[name + "-manual"] = { type: "manual", notes };
      formattedTags.push({ name, type: "manual", count: notes.length });
    });

    // Add AI tags
    Object.entries(aiTagsMap).forEach(([name, notes]) => {
      unifiedTagsMap[name + "-ai"] = { type: "ai", notes };
      formattedTags.push({ name, type: "ai", count: notes.length });
    });

    formattedTags.sort((a, b) => b.count - a.count);

    setTagsList(formattedTags);
    setTagNotesMap(unifiedTagsMap);
    setAttachmentNotesMap(attachmentNotes);

    const formattedUrls = Object.entries(urlsMap).map(([url, notes]) => ({
      url,
      notes,
    })).sort((a, b) => b.notes.length - a.notes.length);

    setUrlsList(formattedUrls);
    setIsScanning(false);
  };

  useEffect(() => {
    scanVaultData();
  }, [noteCache]);

  useEffect(() => {
    registerSyncHandler("vault-file-tree", async () => { await scanVaultData(); }, "Re-index Vault Files & Tags");
    return () => unregisterSyncHandler("vault-file-tree");
  }, [registerSyncHandler, unregisterSyncHandler]);

  useEffect(() => {
    const handleSelectTagEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ tag: string; type: "manual" | "ai" }>;
      if (customEvent.detail && customEvent.detail.tag) {
        setActiveTab("tags");
        setSelectedTag({
          name: customEvent.detail.tag,
          type: customEvent.detail.type || "manual"
        });
      }
    };
    window.addEventListener("kognote-select-tag", handleSelectTagEvent);
    return () => {
      window.removeEventListener("kognote-select-tag", handleSelectTagEvent);
    };
  }, []);

  const handleDeleteTag = async (tagName: string, type: "manual" | "ai") => {
    const confirmMessage = type === "manual"
      ? `Are you sure you want to delete all instances of manual tag #${tagName} from all notes?`
      : `Are you sure you want to remove AI suggested tag #${tagName} from all note suggestions?`;

    const confirmDelete = window.confirm(confirmMessage);
    if (!confirmDelete) return;

    try {
      const tagKey = `${tagName}-${type}`;
      const targetNotes = tagNotesMap[tagKey]?.notes || [];

      if (type === "manual") {
        for (const note of targetNotes) {
          const fileContent = (await invokeIPC("read_note", {
            path: note.path,
          })) as string;

          const regex = new RegExp(`(?:^|\\s)#${tagName}\\b`, "gi");
          const updatedContent = fileContent.replace(regex, (match) => {
            return match.startsWith(" ") ? " " : "";
          });

          await invokeIPC("write_note", {
            path: note.path,
            content: updatedContent,
          });

          searchEngine.indexFile(note.path, updatedContent);
        }
        alert(`Successfully deleted manual tag #${tagName} from all notes.`);
      } else {
        // AI tag deletion: delete from local suggestions cache
        for (const note of targetNotes) {
          const cached = await searchEngine.getAiSuggestions(note.path);
          if (cached) {
            const updatedTags = cached.tags.filter(t => t.toLowerCase() !== tagName.toLowerCase());
            await searchEngine.saveAiSuggestions(note.path, updatedTags, cached.links);
          }
        }
        alert(`Successfully removed AI tag #${tagName} from suggested list.`);
      }

      await scanVaultData();
    } catch (e: any) {
      console.error("Failed to delete tag instances:", e);
      alert("Error deleting tag: " + e.message);
    }
  };

  const handleTagSelect = (tag: string, type: "manual" | "ai") => {
    setSelectedTag({ name: tag, type });
  };

  // Daily note action — always creates/opens inside Daily Notes/ folder
  const handleDailyNote = () => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    openDailyNote(`${yyyy}-${mm}-${dd}`);
  };

  const handleCreateDir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await createDirectory(null, newName);
      setNewName("");
      setIsCreatingDir(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddAttachment = async () => {
    if (attachmentsFolderPath) {
      await importAttachment(attachmentsFolderPath);
      await scanVaultData();
    }
  };

  // Extract template files directly without folder wrapper
  const getTemplateFiles = (items: FileEntry[]): FileEntry[] => {
    let list: FileEntry[] = [];
    for (const item of items) {
      if (item.is_dir) {
        if (item.children) {
          list = [...list, ...getTemplateFiles(item.children)];
        }
      } else {
        const norm = item.path.replace(/\\/g, "/").toLowerCase();
        const cacheType = noteCache[item.path]?.meta?.type?.toLowerCase();
        const isTpl = norm.includes("/templates/") || norm.includes("/template/") || cacheType === "template";
        const matchesSearch = !filter || item.name.toLowerCase().includes(filter.toLowerCase());
        if (isTpl && matchesSearch && item.name.endsWith(".md")) {
          list.push(item);
        }
      }
    }
    return list;
  };

  // Filter items recursively (excludes protected Attachments folder & Templates folder from main tree)
  const filterTree = (items: FileEntry[]): FileEntry[] => {
    return items
      .filter((item) => {
        if (item.is_dir && item.name.toLowerCase() === ATTACHMENTS_FOLDER.toLowerCase()) return false;
        // In All/Notes/Canvas mode, exclude Templates folder and template files from main tree view
        const norm = item.path.replace(/\\/g, "/").toLowerCase();
        const cacheType = noteCache[item.path]?.meta?.type?.toLowerCase();
        const isTpl = item.name.toLowerCase() === "templates" || norm.includes("/templates/") || norm.includes("/template/") || cacheType === "template";
        if (isTpl) return false;
        return true;
      })
      .map((item) => {
        if (item.is_dir) {
          const filteredChildren = item.children ? filterTree(item.children) : [];
          const matchesName = item.name.toLowerCase().includes(filter.toLowerCase());
          const matchesType = fileTypeFilter === "all" || (fileTypeFilter === "md" && filteredChildren.length > 0);
          if (filteredChildren.length > 0 || (matchesName && matchesType)) {
            return { ...item, children: filteredChildren };
          }
          return null;
        } else {
          const matchesName = item.name.toLowerCase().includes(filter.toLowerCase());
          const isMd = item.name.endsWith(".md");
          const isCanvas = item.name.endsWith(".excalidraw");
          let matchesType = true;
          if (fileTypeFilter === "md") matchesType = isMd;
          else if (fileTypeFilter === "canvas") matchesType = isCanvas;

          return matchesName && matchesType ? item : null;
        }
      })
      .filter((item): item is FileEntry => item !== null);
  };

  // Helper to determine system folder sorting weight at root level (Archived & Trash pin to bottom)
  const getSystemFolderWeight = (entry: FileEntry): number => {
    if (!entry.is_dir) return 0;
    const nameLower = entry.name.toLowerCase();
    if (nameLower === "archived" || nameLower === "archived notes" || nameLower === "archive") return 1;
    if (nameLower === "trash" || nameLower === "deleted notes" || nameLower === "deleted" || nameLower === "trash notes") return 2;
    return 0;
  };

  // Sort items recursively
  const sortTree = (items: FileEntry[], option: SortOption, isRoot = true): FileEntry[] => {
    const sorted = [...items];

    // Sort children recursively first
    sorted.forEach((item) => {
      if (item.is_dir && item.children) {
        item.children = sortTree(item.children, option, false);
      }
    });

    sorted.sort((a, b) => {
      // Pin Archived and Trash to bottom at root level
      if (isRoot) {
        const weightA = getSystemFolderWeight(a);
        const weightB = getSystemFolderWeight(b);
        if (weightA !== weightB) {
          return weightA - weightB;
        }
      }
      // Keep directories grouped at the top
      if (a.is_dir !== b.is_dir) {
        return a.is_dir ? -1 : 1;
      }
      switch (option) {
        case "name_asc":
          return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
        case "name_desc":
          return b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: "base" });
        case "modified_desc":
          return (b.modified_at || 0) - (a.modified_at || 0);
        case "modified_asc":
          return (a.modified_at || 0) - (b.modified_at || 0);
        case "created_desc":
          return (b.created_at || 0) - (a.created_at || 0);
        case "created_asc":
          return (a.created_at || 0) - (b.created_at || 0);
        default:
          return 0;
      }
    });
    return sorted;
  };

  const starredNotes = useMemo(() => {
    const results: FileEntry[] = [];
    const gatherStarred = (entries: FileEntry[]) => {
      entries.forEach((e) => {
        if (e.is_dir && e.children) {
          gatherStarred(e.children);
        } else if (!e.is_dir && e.name.endsWith(".md")) {
          const pathLower = e.path.replace(/\\/g, "/").toLowerCase();
          const cache = noteCache[e.path] || Object.values(noteCache).find(c => c.path === e.path || c.path.replace(/\\/g, "/").toLowerCase() === pathLower);
          const isBookmarked = cache?.meta?.bookmarked?.toLowerCase() === "yes" || cache?.meta?.storage?.toLowerCase() === "bookmarked";
          const isArchivedOrDeleted = pathLower.includes("/archived/") || pathLower.includes("/trash/") || cache?.meta?.storage === "archived" || cache?.meta?.storage === "deleted";
          if (isBookmarked && !isArchivedOrDeleted) {
            results.push(e);
          }
        }
      });
    };
    gatherStarred(files);
    return results;
  }, [files, noteCache]);

  const vaultStats = useMemo(() => {
    let mdCount = 0;
    let canvasCount = 0;
    let activeNotes = 0;
    let archivedCount = 0;
    let trashCount = 0;
    let templatesCount = 0;

    const countEntries = (entries: FileEntry[]) => {
      entries.forEach((e) => {
        if (e.is_dir && e.children) {
          countEntries(e.children);
        } else if (!e.is_dir) {
          if (e.name.endsWith(".md")) {
            mdCount++;
          } else if (e.name.endsWith(".excalidraw")) {
            canvasCount++;
          }

          if (e.name.endsWith(".md") || e.name.endsWith(".excalidraw")) {
            const pathLower = e.path.replace(/\\/g, "/").toLowerCase();
            const cache = noteCache[e.path] || Object.values(noteCache).find(c => c.path === e.path || c.path.replace(/\\/g, "/").toLowerCase() === pathLower);
            const storage = cache?.meta?.storage?.toLowerCase();

            if (pathLower.includes("/trash/") || storage === "deleted") {
              trashCount++;
            } else if (pathLower.includes("/archived/") || storage === "archived") {
              archivedCount++;
            } else if (pathLower.includes("/templates/")) {
              templatesCount++;
            } else {
              activeNotes++;
            }
          }
        }
      });
    };
    countEntries(files);
    return {
      mdCount,
      canvasCount,
      totalNotes: mdCount + canvasCount,
      activeNotes,
      bookmarkedCount: starredNotes.length,
      archivedCount,
      trashCount,
      templatesCount,
    };
  }, [files, noteCache, starredNotes]);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());

  const toggleFolder = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const getClippingFiles = (items: FileEntry[]): FileEntry[] => {
    let list: FileEntry[] = [];
    for (const item of items) {
      if (item.is_dir) {
        if (item.children) {
          list = [...list, ...getClippingFiles(item.children)];
        }
      } else {
        const norm = item.path.replace(/\\/g, "/").toLowerCase();
        const cacheType = noteCache[item.path]?.meta?.type?.toLowerCase();
        const isClipping = norm.includes("/clippings/") || norm.includes("/clipping/") || cacheType === "clipping" || cacheType === "clippings";
        const matchesSearch = !filter || item.name.toLowerCase().includes(filter.toLowerCase());
        if (isClipping && matchesSearch && (item.name.endsWith(".md") || item.name.endsWith(".excalidraw"))) {
          list.push(item);
        }
      }
    }
    return list;
  };

  const filteredFiles = useMemo(() => {
    if (fileTypeFilter === "templates") {
      return sortTree(getTemplateFiles(files), sortOption, false);
    }
    if (fileTypeFilter === "clippings") {
      return sortTree(getClippingFiles(files), sortOption, false);
    }
    return sortTree(filterTree(files), sortOption);
  }, [files, fileTypeFilter, filter, sortOption, noteCache]);

  const flatVisibleFiles = useMemo(() => {
    const flat: FlatTreeItem[] = [];
    const isFiltering = filter.trim().length > 0;

    const walk = (entries: FileEntry[], depth: number) => {
      for (const entry of entries) {
        flat.push({ item: entry, depth });
        if (entry.is_dir && entry.children && entry.children.length > 0) {
          if (isFiltering || expandedPaths.has(entry.path)) {
            walk(entry.children, depth + 1);
          }
        }
      }
    };

    walk(filteredFiles, 0);
    return flat;
  }, [filteredFiles, expandedPaths, filter]);

  return (
    <div className="flex h-full flex-col bg-sidebar border-r border-card-border text-foreground">
      {/* Sleek Segmented Control Sidebar Navigation Tabs */}
      <div className="p-2 border-b border-card-border bg-sidebar">
        <div className="grid grid-cols-4 p-0.5 rounded-lg bg-card border border-card-border text-[10px] font-bold">
          <button
            onClick={() => setActiveTab("files")}
            className={`flex items-center justify-center gap-1 py-1.5 rounded-md transition-all duration-200 cursor-pointer ${activeTab === "files"
                ? "bg-indigo-600 text-white shadow-xs border border-indigo-500/40"
                : "text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5 border border-transparent"
              }`}
            title="Folder & file vault explorer"
          >
            <Folder className="h-3.5 w-3.5" />
            <span>Folder</span>
          </button>
          <button
            onClick={() => setActiveTab("tags")}
            className={`flex items-center justify-center gap-1 py-1.5 rounded-md transition-all duration-200 cursor-pointer ${activeTab === "tags"
                ? "dark:bg-[#1d2030] bg-white text-purple-600 dark:text-purple-400 shadow-xs border border-purple-500/40"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-300/40 dark:hover:bg-[#161825]/50 border border-transparent"
              }`}
            title="Tags index browser"
          >
            <Tag className="h-3.5 w-3.5" />
            <span>Tags</span>
          </button>
          <button
            onClick={() => setActiveTab("attachments")}
            className={`flex items-center justify-center gap-1 py-1.5 rounded-md transition-all duration-200 cursor-pointer ${activeTab === "attachments"
                ? "dark:bg-[#1d2030] bg-white text-emerald-600 dark:text-emerald-400 shadow-xs border border-emerald-500/40"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-300/40 dark:hover:bg-[#161825]/50 border border-transparent"
              }`}
            title="Vault media attachments"
          >
            <Paperclip className="h-3.5 w-3.5" />
            <span>Attach</span>
          </button>
          <button
            onClick={() => setActiveTab("urls")}
            className={`flex items-center justify-center gap-1 py-1.5 rounded-md transition-all duration-200 cursor-pointer ${activeTab === "urls"
                ? "dark:bg-[#1d2030] bg-white text-indigo-600 dark:text-indigo-400 shadow-xs border border-indigo-500/40"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-300/40 dark:hover:bg-[#161825]/50 border border-transparent"
              }`}
            title="Extracted web URLs"
          >
            <Globe className="h-3.5 w-3.5" />
            <span>URLs</span>
          </button>
        </div>
      </div>

      {/* Tab Contents: FILES */}
      {activeTab === "files" && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="p-2 border-b border-card-border bg-sidebar/50">
            <div className="relative mb-1.5">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 dark:text-slate-500 pointer-events-none" />
              <input
                type="text"
                placeholder="Filter files..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setFilter("");
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                className="w-full rounded-md bg-card pl-8 pr-7 py-1 text-xs text-foreground placeholder-slate-400 dark:placeholder-slate-500 border border-card-border focus:outline-none focus:border-indigo-500/80 transition-all shadow-2xs"
              />
              {filter ? (
                <button
                  onClick={() => setFilter("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-foreground p-0.5 rounded cursor-pointer"
                  title="Clear filter (Esc)"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[8.5px] font-mono text-slate-400 bg-sidebar px-1 py-0.2 rounded border border-card-border pointer-events-none select-none">
                  Ctrl+K
                </span>
              )}
            </div>

            <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 tracking-wider">
              <span
                className="flex items-center gap-1.5 cursor-help hover:text-indigo-400 transition-colors"
                title={vaultTooltip}
              >
                VAULT NOTES
                {(filter || fileTypeFilter !== "all") && (
                  <span className="text-[9.5px] font-mono font-normal text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.2 rounded-full">
                    {flatVisibleFiles.length}
                  </span>
                )}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDailyNote}
                  className="p-1 rounded-sm hover:bg-[#1a1d29] hover:text-slate-300 transition-colors"
                  title="Daily Note (Today)"
                >
                  <Calendar className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setCreateFileModal({ isOpen: true, parentDir: null })}
                  className="p-1 rounded-sm hover:bg-[#1a1d29] hover:text-slate-300 transition-colors"
                  title="New File"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setIsCreatingDir(true)}
                  className="p-1 rounded-sm hover:bg-[#1a1d29] hover:text-slate-300 transition-colors"
                  title="New Folder"
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                </button>
                <div className="relative" ref={filterDropdownRef}>
                  <button
                    onClick={() => setIsFilterDropdownOpen(!isFilterDropdownOpen)}
                    className={`p-1 rounded-sm hover:bg-[#1a1d29] transition-colors cursor-pointer relative ${
                      isFilterDropdownOpen || fileTypeFilter !== "all"
                        ? "bg-[#1a1d29] text-indigo-400 font-bold"
                        : "text-slate-500 hover:text-slate-300"
                    }`}
                    title="Filter View by File Type (Notes, Canvas, Templates, Clippings)"
                  >
                    <Filter className="h-3.5 w-3.5" />
                    {fileTypeFilter !== "all" && (
                      <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-indigo-500 ring-1 ring-background" />
                    )}
                  </button>
                  {isFilterDropdownOpen && (
                    <div className="absolute right-0 mt-1.5 w-52 bg-card border border-card-border rounded-md shadow-2xl py-1 z-50 text-[11px] font-normal normal-case animate-in fade-in zoom-in-95 duration-100">
                      <div className="px-3 py-1 text-[9.5px] font-bold uppercase tracking-wider text-slate-400 border-b border-card-border/60 mb-0.5">
                        Filter File Types
                      </div>
                      {[
                        { value: "all", label: "All Files" },
                        { value: "md", label: "Notes Only (.md)" },
                        { value: "canvas", label: "Canvas Drawings (.excalidraw)" },
                        { value: "templates", label: "Templates" },
                        { value: "clippings", label: "Clippings" },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => {
                            setFileTypeFilter(opt.value as any);
                            setIsFilterDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 hover:bg-card-hover transition-colors flex items-center justify-between cursor-pointer ${
                            fileTypeFilter === opt.value
                              ? "text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-500/10"
                              : "text-slate-700 dark:text-slate-300 hover:text-foreground"
                          }`}
                        >
                          <span>{opt.label}</span>
                          {fileTypeFilter === opt.value && <Check className="h-3 w-3 text-indigo-500" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="relative" ref={sortDropdownRef}>
                  <button
                    onClick={() => setIsSortDropdownOpen(!isSortDropdownOpen)}
                    className={`p-1 rounded-sm hover:bg-[#1a1d29] transition-colors cursor-pointer ${isSortDropdownOpen ? "bg-[#1a1d29] text-[#d946ef]" : "text-slate-500 hover:text-slate-300"
                      }`}
                    title="Sort Files"
                  >
                    <ArrowUpDown className="h-3.5 w-3.5" />
                  </button>
                  {isSortDropdownOpen && (
                    <div className="absolute right-0 mt-1.5 w-52 bg-card border border-card-border rounded-md shadow-2xl py-1 z-50 text-[11px] font-normal normal-case">
                      {SORT_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => {
                            changeSortOption(opt.value);
                            setIsSortDropdownOpen(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 hover:bg-card-hover transition-colors flex items-center justify-between cursor-pointer ${sortOption === opt.value ? "text-indigo-600 dark:text-indigo-400 font-bold" : "text-slate-700 dark:text-slate-300 hover:text-foreground"
                            }`}
                        >
                          <span>{opt.label}</span>
                          {sortOption === opt.value && <Check className="h-3 w-3" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {isCreatingDir && (
              <form onSubmit={handleCreateDir} className="mt-2 flex items-center gap-1">
                <input
                  type="text"
                  autoFocus
                  placeholder="folder name..."
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="flex-1 rounded-sm bg-card px-2 py-1 text-xs border border-indigo-600 focus:outline-hidden text-foreground"
                />
                <button type="submit" className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded-sm">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreatingDir(false)}
                  className="p-1 text-red-500 hover:bg-red-500/10 rounded-sm"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </form>
            )}
          </div>

          {/* Starred / Bookmarked Notes Quick Access */}
          {starredNotes.length > 0 && (
            <div className="px-3 py-1 border-b border-card-border bg-sidebar/40">
              <button
                onClick={() => setIsStarredOpen((prev) => !prev)}
                className="flex items-center justify-between w-full text-[10px] font-semibold text-amber-600/90 dark:text-amber-500/90 tracking-wider uppercase py-0.5 cursor-pointer select-none group"
              >
                <div className="flex items-center gap-1.5">
                  <Bookmark className="h-3 w-3 fill-amber-500 text-amber-500 shrink-0" />
                  <span>Bookmarks ({starredNotes.length})</span>
                </div>
                <ChevronRight
                  className={`h-3 w-3 transform transition-transform duration-200 text-amber-600/70 group-hover:text-amber-500 ${isStarredOpen ? "rotate-90" : ""
                    }`}
                />
              </button>
              {isStarredOpen && (
                <div className="space-y-0.5 mt-0.5 pb-0.5 animate-fade-in">
                  {starredNotes.map((note: FileEntry) => (
                    <button
                      key={note.path}
                      onClick={() => openFile(note)}
                      draggable
                      onDragStart={(e) => {
                        setDragState("file", note);
                        e.dataTransfer.setData("application/kognote-file", JSON.stringify(note));
                        e.dataTransfer.setData("text/plain", note.path);
                        e.dataTransfer.effectAllowed = "all";
                      }}
                      onDragEnd={() => {
                        clearDragState();
                      }}
                      className="flex items-center gap-1.5 w-full px-2 py-0.5 rounded-md text-[11.5px] text-slate-700 dark:text-slate-300 hover:bg-card-hover hover:text-foreground transition-colors text-left truncate cursor-pointer group"
                    >
                      {getFileIcon(note, noteCache, { className: "h-3.5 w-3.5 shrink-0 text-amber-500" })}
                      <span className="truncate" title={note.name.replace(/\.md$/, "")}>{note.name.replace(/\.md$/, "")}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Files Tree */}
          {filteredFiles.length > 0 ? (
            <VirtualFileList
              flatItems={flatVisibleFiles}
              expandedPaths={expandedPaths}
              onToggleFolder={toggleFolder}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-xs text-slate-600">
              <span>No files matching filter</span>
            </div>
          )}
        </div>
      )}

      {/* Tab Contents: TAGS */}
      {activeTab === "tags" && (
        <div className="flex-1 flex flex-col overflow-hidden p-3 gap-3">
          <div className="flex items-center justify-between shrink-0">
            <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase flex items-center gap-1">
              <Tag className="h-3 w-3 text-[#94a3b8]/60" /> Connections & Tags
            </span>
          </div>

          {/* Search (no type filter) */}
          {!selectedTag && (
            <div className="flex flex-col gap-2 shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search tags..."
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  className="w-full rounded-md bg-card pl-8 pr-3 py-1 text-xs text-slate-200 border border-card-border focus:outline-none focus:border-indigo-500/50"
                />
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto flex flex-col gap-2">
            {isScanning && tagsList.length === 0 ? (
              <span className="text-[10px] text-slate-500 italic">Scanning vault tags...</span>
            ) : selectedTag ? (
              (() => {
                const selectedKey = `${selectedTag.name}-${selectedTag.type}`;
                const notes = tagNotesMap[selectedKey]?.notes || [];

                return (
                  <div className="flex flex-col gap-2.5 animate-fade-in">
                    <button
                      onClick={() => setSelectedTag(null)}
                      className="text-[10px] text-slate-400 font-bold hover:underline text-left flex items-center gap-0.5 cursor-pointer"
                    >
                      &larr; Back to all tags
                    </button>
                    <div className={`rounded-lg border p-2.5 flex flex-col gap-2 bg-card ${selectedTag.type === "manual" ? "border-card-border" : "border-amber-500/20"
                      }`}>
                      <div className="flex items-center justify-between border-b border-card-border pb-1.5">
                        <span className={`text-xs font-bold ${selectedTag.type === "manual" ? "text-slate-800 dark:text-slate-200" : "text-amber-600 dark:text-amber-400"
                          }`}>
                          #{selectedTag.name} {selectedTag.type === "ai" && <span className="text-[9px] opacity-60">(AI)</span>}
                        </span>
                        <button
                          onClick={() => {
                            handleDeleteTag(selectedTag.name, selectedTag.type);
                            setSelectedTag(null);
                          }}
                          className="text-slate-500 hover:text-red-400 transition-colors p-0.5 rounded cursor-pointer"
                          title="Delete tag"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="flex flex-col gap-1.5 mt-1">
                        {notes.map((note) => (
                          <button
                            key={note.path}
                            onClick={() => openFile(note)}
                            className="flex items-center gap-1.5 rounded-lg border border-card-border bg-card p-2 text-left text-xs text-slate-700 dark:text-slate-300 hover:border-purple-500/50 hover:text-slate-900 dark:hover:text-slate-100 transition-colors cursor-pointer w-full"
                          >
                            <FileText className="h-3 w-3 text-[#d946ef]/80 shrink-0" />
                            <span className="truncate">{note.name}</span>
                          </button>
                        ))}
                        {notes.length === 0 && (
                          <span className="text-[9px] text-slate-500 italic">No notes linked</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : (() => {
              const filteredTags = tagsList.filter((tag) => {
                const matchesSearch = tag.name.toLowerCase().includes(tagSearch.toLowerCase());
                return matchesSearch;
              });

              if (filteredTags.length === 0) {
                return (
                  <span className="text-[10px] text-slate-600 leading-normal">
                    No matching tags found.
                  </span>
                );
              }

              return filteredTags.map((tag) => (
                <div
                  key={`${tag.name}-${tag.type}`}
                  draggable
                  onDragStart={(e) => {
                    setDragState("tag", tag.name);
                    e.dataTransfer.setData("application/kognote-tag", tag.name);
                    e.dataTransfer.setData("text/plain", `#${tag.name}`);
                    e.dataTransfer.effectAllowed = "all";
                  }}
                  onDragEnd={() => {
                    clearDragState();
                  }}
                  className={`flex items-center justify-between rounded-lg border bg-card px-3 py-2 text-xs transition-all cursor-grab active:cursor-grabbing ${tag.type === "manual"
                      ? "border-card-border hover:border-indigo-500/50 hover:bg-card-hover"
                      : "border-card-border hover:border-amber-500/50 hover:bg-amber-500/5"
                    }`}
                >
                  <button
                    onClick={() => handleTagSelect(tag.name, tag.type)}
                    className={`flex-1 text-left font-semibold cursor-pointer truncate ${tag.type === "manual"
                        ? "text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
                        : "text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300"
                      }`}
                  >
                    #{tag.name} {tag.type === "ai" && <span className="text-[9px] opacity-50 font-normal">(AI)</span>}
                  </button>
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${tag.type === "manual"
                        ? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700/50"
                        : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                      }`}>
                      {tag.count} {tag.count === 1 ? "note" : "notes"}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTag(tag.name, tag.type);
                      }}
                      className="text-slate-500 hover:text-red-400 p-0.5 rounded transition-colors cursor-pointer"
                      title="Delete tag"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* Tab Contents: ATTACHMENTS */}
      {activeTab === "attachments" && (
        <div className="flex-1 flex flex-col overflow-hidden p-3 gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase flex items-center gap-1">
              <Paperclip className="h-3.5 w-3.5 text-emerald-400" /> Attachments ({attachmentsList.length})
            </span>
            <button
              onClick={handleAddAttachment}
              className="p-1 rounded-md text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-all cursor-pointer"
              title="Import Attachment"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto flex flex-col gap-3">
            {attachmentsList.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                <Paperclip className="h-8 w-8 text-slate-700" />
                <span className="text-[10px] text-slate-600 leading-normal">
                  No attachments yet.<br />Images dragged or pasted into notes<br />will appear here.
                </span>
              </div>
            ) : (
              attachmentsList.map((item) => {
                const isImg = isImageFile(item.name);
                const imgSrc = isImg ? convertFileSrc(item.path) : null;
                const usedIn = attachmentNotesMap[item.name] || [];
                return (
                  <div
                    key={item.path}
                    draggable
                    onDragStart={(e) => {
                      setDragState("file", item);
                      e.dataTransfer.setData("application/kognote-file", JSON.stringify({
                        name: item.name,
                        path: item.path,
                        is_dir: false,
                        is_attachment: true
                      }));
                      e.dataTransfer.setData("text/plain", item.path);
                      e.dataTransfer.effectAllowed = "all";
                    }}
                    onDragEnd={() => {
                      clearDragState();
                    }}
                    className="flex flex-col gap-2 rounded-xl border border-card-border bg-card p-3 hover:border-emerald-500/50 hover:bg-card-hover transition-all group cursor-grab active:cursor-grabbing shadow-xs hover:shadow-md"
                  >
                    {/* Thumbnail row */}
                    <div className="flex items-center gap-3">
                      {isImg && imgSrc ? (
                        <button
                          onClick={() => setPreviewAttachment({ path: item.path, name: item.name })}
                          className="shrink-0 rounded-lg overflow-hidden border border-card-border hover:border-emerald-500/50 transition-all"
                          title="Preview image"
                        >
                          <img
                            src={imgSrc}
                            alt={item.name}
                            className="w-16 h-16 object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        </button>
                      ) : (
                        <div className="shrink-0 w-16 h-16 rounded-lg border border-card-border bg-sidebar flex items-center justify-center">
                          <Paperclip className="h-6 w-6 text-emerald-400/50" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <button
                          onClick={() => setPreviewAttachment({ path: item.path, name: item.name })}
                          className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 truncate block w-full text-left cursor-pointer"
                          title={item.path}
                        >
                          {item.name}
                        </button>
                        <span className="text-[9px] text-slate-500 dark:text-slate-400 block mt-0.5">
                          {isImg ? "Image" : "File"}
                        </span>
                        {/* Used in notes */}
                        {usedIn.length > 0 && (
                          <div className="mt-1">
                            <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Used in:</span>
                            <div className="flex flex-col gap-0.5 mt-0.5">
                              {usedIn.slice(0, 3).map((note) => (
                                <button
                                  key={note.path}
                                  onClick={() => openFile(note)}
                                  className="flex items-center gap-1 text-[9px] text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:underline text-left cursor-pointer"
                                >
                                  <FileText className="h-2 w-2 text-[#d946ef]/60 shrink-0" />
                                  <span className="truncate">{note.name.replace(/\.md$/, "")}</span>
                                </button>
                              ))}
                              {usedIn.length > 3 && (
                                <span className="text-[9px] text-slate-500 dark:text-slate-400">+{usedIn.length - 3} more</span>
                              )}
                            </div>
                          </div>
                        )}
                        {usedIn.length === 0 && (
                          <span className="text-[9px] text-slate-500 dark:text-slate-400 mt-1 block italic">Not referenced in any note</span>
                        )}
                      </div>
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (confirm(`Delete attachment "${item.name}"?`)) {
                            try {
                              await deleteFileOrDirectory(item.path);
                              await scanVaultData();
                            } catch (err: any) {
                              alert("Failed to delete: " + err.message);
                            }
                          }
                        }}
                        className="text-slate-400 hover:text-red-500 dark:hover:text-red-400 p-1 rounded transition-colors cursor-pointer opacity-0 group-hover:opacity-100 shrink-0"
                        title="Delete Attachment"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* In-app Image Preview Modal */}
      {previewAttachment && (
        <div
          className="fixed inset-0 z-300 flex items-center justify-center bg-black/85 backdrop-blur-md animate-fade-in"
          onClick={() => setPreviewAttachment(null)}
        >
          <div
            className="relative max-w-[90vw] max-h-[90vh] rounded-2xl overflow-hidden border border-card-border shadow-2xl bg-sidebar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-card-border bg-card">
              <div className="flex items-center gap-2">
                {isImageFile(previewAttachment.name) ? (
                  <ImageIcon className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Paperclip className="h-4 w-4 text-emerald-400" />
                )}
                <span className="text-xs font-semibold text-slate-200">{previewAttachment.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    invokeIPC("open_with_default", { path: previewAttachment.path }).catch(console.error);
                  }}
                  className="p-1.5 rounded-md text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors cursor-pointer"
                  title="Open with default app"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setPreviewAttachment(null)}
                  className="p-1.5 rounded-md text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            {isImageFile(previewAttachment.name) ? (
              <img
                src={convertFileSrc(previewAttachment.path)}
                alt={previewAttachment.name}
                className="max-w-[85vw] max-h-[80vh] object-contain p-4"
              />
            ) : (
              <div className="p-8 text-center text-slate-500 text-xs">
                <Paperclip className="h-12 w-12 mx-auto mb-3 text-emerald-400/40" />
                <p>Preview not available for this file type.</p>
                <button
                  onClick={() => {
                    invokeIPC("open_with_default", { path: previewAttachment.path }).catch(console.error);
                  }}
                  className="text-emerald-400 underline mt-2 inline-block cursor-pointer"
                >
                  Open with default app
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab Contents: URLs */}
      {activeTab === "urls" && (
        <div className="flex-1 flex flex-col overflow-hidden p-3 gap-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 tracking-wider uppercase flex items-center gap-1">
              <Globe className="h-3.5 w-3.5 text-indigo-400" /> Extracted URLs ({urlsList.length})
            </span>
          </div>

          <div className="flex-1 overflow-y-auto flex flex-col gap-2">
            {isScanning && urlsList.length === 0 ? (
              <span className="text-[10px] text-slate-500 italic">Scanning URLs in notes...</span>
            ) : urlsList.length === 0 ? (
              <span className="text-[10px] text-slate-600 leading-normal">
                No external URLs found in your notes.
              </span>
            ) : (
              urlsList.map((item) => (
                <div
                  key={item.url}
                  className="flex flex-col gap-1.5 rounded-lg border border-card-border bg-card p-2.5"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <Globe className="h-3 w-3 text-indigo-400 shrink-0" />
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-indigo-400 hover:underline font-semibold truncate hover:text-indigo-300 cursor-pointer"
                      title={item.url}
                    >
                      {item.url}
                    </a>
                  </div>
                  <div className="flex flex-col gap-1 pl-5">
                    <span className="text-[8px] font-bold text-slate-600 uppercase tracking-wider">
                      Found in:
                    </span>
                    {item.notes.map((note) => (
                      <button
                        key={note.path}
                        onClick={() => openFile(note)}
                        className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 hover:underline text-left cursor-pointer w-full"
                      >
                        <FileText className="h-2.5 w-2.5 text-slate-500" />
                        <span className="truncate">{note.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Sleek Vault Info Footer Bar */}
      <div className="shrink-0 border-t border-card-border bg-sidebar backdrop-blur-md select-none text-[10px] font-sans">
        {/* Expanded Details Popover Drawer */}
        {isFooterExpanded && (
          <div className="p-2.5 border-b border-card-border bg-card space-y-1.5 animate-fade-in">
            <div className="flex items-center justify-between text-[9px] font-bold text-slate-500 uppercase tracking-wider">
              <span>Vault Storage Breakdown</span>
              {isScanning && <span className="text-[#d946ef] animate-pulse">RE-INDEXING...</span>}
            </div>
            <div className="grid grid-cols-2 gap-1.5 text-slate-700 dark:text-slate-300 font-medium">
              <div className="flex items-center justify-between px-2 py-1 rounded dark:bg-[#151724] bg-white border dark:border-card-border border-slate-300">
                <span className="text-slate-500 dark:text-slate-400">Notes (.md)</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">{vaultStats.mdCount}</span>
              </div>
              <div className="flex items-center justify-between px-2 py-1 rounded dark:bg-[#151724] bg-white border dark:border-card-border border-slate-300">
                <span className="text-slate-500 dark:text-slate-400">Canvas (.excalidraw)</span>
                <span className="font-semibold text-purple-600 dark:text-purple-400">{vaultStats.canvasCount}</span>
              </div>
              <div className="flex items-center justify-between px-2 py-1 rounded dark:bg-[#151724] bg-white border dark:border-card-border border-slate-300">
                <span className="text-slate-500 dark:text-slate-400">Bookmarked</span>
                <span className="font-semibold text-amber-600 dark:text-amber-500">{vaultStats.bookmarkedCount}</span>
              </div>
              <div className="flex items-center justify-between px-2 py-1 rounded dark:bg-[#151724] bg-white border dark:border-card-border border-slate-300">
                <span className="text-slate-500 dark:text-slate-400">Archived</span>
                <span className="font-semibold text-sky-600 dark:text-sky-400">{vaultStats.archivedCount}</span>
              </div>
              <div className="flex items-center justify-between px-2 py-1 rounded dark:bg-[#151724] bg-white border dark:border-card-border border-slate-300 col-span-2">
                <span className="text-slate-500 dark:text-slate-400">Trash</span>
                <span className="font-semibold text-rose-600 dark:text-rose-400">{vaultStats.trashCount}</span>
              </div>
            </div>
          </div>
        )}

        {/* Compact Single-Line Footer Status Bar */}
        <div className="flex items-center justify-between px-3 py-1.5 text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-1.5 truncate">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400 shrink-0" />
            <span className="font-semibold text-slate-700 dark:text-slate-300 truncate">
              {vaultStats.mdCount} {vaultStats.mdCount === 1 ? "Note" : "Notes"}
            </span>
            <span className="text-slate-400 dark:text-slate-600">·</span>
            <span className="text-purple-600 dark:text-purple-400 font-medium truncate">
              {vaultStats.canvasCount} {vaultStats.canvasCount === 1 ? "Canvas" : "Canvas"}
            </span>
          </div>

          <button
            onClick={() => setIsFooterExpanded((prev) => !prev)}
            className="flex items-center gap-0.5 text-[9px] text-slate-500 hover:text-indigo-300 transition-colors cursor-pointer shrink-0 ml-1 font-semibold"
            title="Toggle Vault Details"
          >
            <span>{isFooterExpanded ? "Hide" : "Details"}</span>
            <ChevronRight className={`h-3 w-3 transform transition-transform ${isFooterExpanded ? "-rotate-90" : "rotate-90"}`} />
          </button>
        </div>
      </div>
    </div>
  );
};

const VirtualFileList: React.FC<{
  flatItems: FlatTreeItem[];
  expandedPaths: Set<string>;
  onToggleFolder: (path: string) => void;
}> = ({ flatItems, expandedPaths, onToggleFolder }) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 30,
    overscan: 10,
  });

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto py-1 px-1 custom-scrollbar">
      <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const { item, depth } = flatItems[virtualRow.index];
          const isOpen = expandedPaths.has(item.path);
          return (
            <div
              key={item.path}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <TreeItem
                item={item}
                depth={depth}
                isOpen={isOpen}
                onToggleFolder={onToggleFolder}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

const TreeItem: React.FC<TreeItemProps> = ({ item, depth, isOpen, onToggleFolder }) => {
  const {
    activeFile,
    openFile,
    createDirectory,
    renameFileOrDirectory,
    deleteFileOrDirectory,
    isProtectedFolder: isProtected,
    setCreateFileModal,
    importAttachment,
    noteCache,
    restoreNote,
    restoreAllTrash,
    emptyTrash
  } = useVault();
  const [isCreatingSubDir, setIsCreatingSubDir] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [inputVal, setInputVal] = useState("");

  const folderNoteCount = useMemo(() => {
    if (!item.is_dir || !item.children) return 0;
    let count = 0;
    const walk = (entries: FileEntry[]) => {
      entries.forEach((child) => {
        if (child.is_dir && child.children) {
          walk(child.children);
        } else if (!child.is_dir) {
          count++;
        }
      });
    };
    walk(item.children);
    return count;
  }, [item]);

  const isActive = activeFile?.path === item.path;
  const isSystemFolder = item.is_dir && isProtected(item.path);
  const [isDragOverFolder, setIsDragOverFolder] = useState(false);

  const pathLower = item.path.replace(/\\/g, "/").toLowerCase();
  const isTrashFolder = item.is_dir && (item.name.toLowerCase() === "trash" || item.name.toLowerCase() === ".deleted");
  const isInTrash = pathLower.includes("/trash/") || pathLower.includes("/.deleted/") || noteCache[item.path]?.meta?.storage === "deleted";

  const getDisplayName = (name: string): string => {
    if (isSystemFolder) {
      const lower = name.toLowerCase();
      if (lower === "canvas") return "Canvas";
      if (lower === "attachments") return "Attachments";
      if (lower === "clippings") return "Clippings";
      if (lower === "daily notes") return "Daily Notes";
      if (lower === "templates") return "Templates";
      if (lower === "archived") return "Archived";
      if (lower === "trash") return "Trash";
    }
    let clean = name.replace(/^!\[\[/, "").replace(/\]\]$/, "");
    return clean.replace(/\.excalidraw$/i, "").replace(/\.md$/i, "");
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (item.is_dir) {
      onToggleFolder(item.path);
    } else {
      openFile(item);
    }
  };

  const handleCreateSubDir = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim()) return;
    try {
      await createDirectory(item.path, inputVal);
      setInputVal("");
      setIsCreatingSubDir(false);
      if (!isOpen) {
        onToggleFolder(item.path);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRename = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim()) return;
    try {
      const parent = item.path.substring(0, item.path.lastIndexOf(item.path.includes("\\") ? "\\" : "/"));
      const newPath = `${parent}${parent.includes("\\") ? "\\" : "/"}${inputVal}`;
      await renameFileOrDirectory(item.path, newPath);
      setIsRenaming(false);
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteFileOrDirectory(item.path);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="select-none text-xs">
      {/* Node Row */}
      {isRenaming ? (
        <form
          onSubmit={handleRename}
          className="flex items-center gap-1 px-2 py-1"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <input
            type="text"
            autoFocus
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            className="flex-1 rounded-sm bg-[#1a1d29] px-2 py-0.5 text-xs border border-indigo-600 focus:outline-hidden text-slate-200"
          />
          <button type="submit" className="p-0.5 text-emerald-500 hover:bg-emerald-500/10 rounded-sm">
            <Check className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setIsRenaming(false)}
            className="p-0.5 text-red-500 hover:bg-red-500/10 rounded-sm"
          >
            <X className="h-3 w-3" />
          </button>
        </form>
      ) : (
        <div
          onClick={handleToggle}
          draggable={true}
          onDragStart={(e) => {
            setDragState("file", item);
            e.dataTransfer.setData("application/kognote-file", JSON.stringify(item));
            e.dataTransfer.setData("text/plain", item.path);
            e.dataTransfer.effectAllowed = "all";
          }}
          onDragEnd={() => {
            clearDragState();
          }}
          onDragOver={(e) => {
            if (item.is_dir) {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer) {
                e.dataTransfer.dropEffect = "move";
              }
            }
          }}
          onDragEnter={(e) => {
            if (item.is_dir) {
              e.preventDefault();
              e.stopPropagation();
              setIsDragOverFolder(true);
            }
          }}
          onDragLeave={(e) => {
            if (item.is_dir) {
              e.preventDefault();
              e.stopPropagation();
              setIsDragOverFolder(false);
            }
          }}
          onDrop={async (e) => {
            if (!item.is_dir) return;
            e.preventDefault();
            e.stopPropagation();
            setIsDragOverFolder(false);

            let sourcePath = "";
            const draggedItem = getDragState("file");
            if (draggedItem && draggedItem.path) {
              sourcePath = draggedItem.path;
            }
            if (!sourcePath) {
              const rawPayload = e.dataTransfer.getData("application/kognote-file");
              if (rawPayload) {
                try {
                  const parsed = JSON.parse(rawPayload);
                  sourcePath = parsed.path || "";
                } catch (_) { }
              }
            }
            if (!sourcePath) {
              sourcePath = e.dataTransfer.getData("text/plain");
            }
            if (!sourcePath || sourcePath === item.path) return;

            const fileName = sourcePath.split(/[/\\]/).pop() || "";
            if (!fileName) return;
            const s = item.path.includes("\\") ? "\\" : "/";
            const newPath = `${item.path.replace(/[/\\]+$/, "")}${s}${fileName}`;
            if (newPath === sourcePath) return;

            try {
              await renameFileOrDirectory(sourcePath, newPath);
            } catch (err) {
              console.error("Failed to move item via drag and drop:", err);
            } finally {
              clearDragState();
            }
          }}
          style={{ paddingLeft: `${depth * 7 + 4}px` }}
          className={`group flex items-center justify-between py-0.5 px-1.5 rounded-md mx-0.5 my-px cursor-pointer transition-all duration-150 text-[11px] ${isDragOverFolder
              ? "bg-indigo-600/30 border border-indigo-500 text-white shadow-xs"
              : isActive
                ? item.name.endsWith(".excalidraw")
                  ? "bg-purple-500/15 text-purple-950 dark:text-purple-200 font-bold border-l-2 border-purple-500 shadow-2xs"
                  : "bg-indigo-500/15 text-indigo-950 dark:text-indigo-200 font-bold border-l-2 border-indigo-500 shadow-2xs"
                : "hover:bg-card-hover text-slate-700 dark:text-slate-300 hover:text-foreground"
            }`}
        >
          <div className="flex items-center gap-1.5 truncate">
            {item.is_dir ? (
              <span className="text-slate-400 shrink-0">
                <ChevronRight
                  className={`h-3 w-3 transform transition-transform duration-150 ${isOpen ? "rotate-90 text-indigo-500 dark:text-indigo-400" : ""}`}
                />
              </span>
            ) : null}

            {getFileIcon(item, noteCache, { className: "h-3.5 w-3.5 shrink-0", isOpenFolder: isOpen })}

            <span className="truncate" title={getDisplayName(item.name)}>
              {getDisplayName(item.name)}
            </span>

            {item.is_dir && (
              <span className="text-[9px] font-mono font-medium text-slate-500 bg-sidebar px-1.5 py-0.2 rounded-full border border-card-border shrink-0 ml-0.5" title={`${folderNoteCount} items`}>
                {folderNoteCount}
              </span>
            )}


            {isSystemFolder && (
              <span title="Protected system folder" className="shrink-0 flex items-center">
                <Lock className="h-2.5 w-2.5 text-[#fbbf24]/70" />
              </span>
            )}
          </div>

          {/* Action Hover Buttons */}
          <div className="hidden group-hover:flex items-center gap-1.5 shrink-0 opacity-80 hover:opacity-100">
            {isTrashFolder ? (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    restoreAllTrash();
                  }}
                  className="p-0.5 text-emerald-400 hover:text-emerald-300"
                  title="Restore All Trashed Files"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    emptyTrash();
                  }}
                  className="p-0.5 text-rose-400 hover:text-rose-300"
                  title="Clean Trash (Permanently Delete All)"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            ) : item.is_dir && item.name.toLowerCase() !== "daily logs" ? (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (item.name.toLowerCase() === "attachments") {
                      importAttachment(item.path);
                    } else {
                      setCreateFileModal({ isOpen: true, parentDir: item.path });
                    }
                  }}
                  className="p-0.5 hover:text-slate-100"
                  title={item.name.toLowerCase() === "attachments" ? "Import Attachment File" : "New File"}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                {!isProtected(item.path) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsCreatingSubDir(true);
                      setInputVal("");
                    }}
                    className="p-0.5 hover:text-slate-100"
                    title="New Folder"
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                  </button>
                )}
              </>
            ) : null}

            {(!isSystemFolder || isInTrash) && !item.is_dir && (
              <>
                {isInTrash ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      restoreNote(item.path);
                    }}
                    className="p-0.5 text-emerald-400 hover:text-emerald-300"
                    title="Restore File"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setInputVal(item.name);
                      setIsRenaming(true);
                    }}
                    className="p-0.5 hover:text-slate-100"
                    title="Rename"
                  >
                    <Edit className="h-3.5 w-3.5" />
                  </button>
                )}
                <button onClick={handleDelete} className="p-0.5 hover:text-red-400" title={isInTrash ? "Permanently Delete" : "Move to Trash (24h)"}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Inline Forms for creating children */}

      {isCreatingSubDir && (
        <form
          onSubmit={handleCreateSubDir}
          className="flex items-center gap-1 py-1"
          style={{ paddingLeft: `${(depth + 1) * 12 + 8}px` }}
        >
          <input
            type="text"
            autoFocus
            placeholder="folder name..."
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            className="flex-1 rounded-sm bg-[#1a1d29] px-2 py-0.5 text-xs border border-indigo-600 focus:outline-hidden text-slate-200"
          />
          <button type="submit" className="p-0.5 text-emerald-500 hover:bg-emerald-500/10 rounded-sm">
            <Check className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => setIsCreatingSubDir(false)}
            className="p-0.5 text-red-500 hover:bg-red-500/10 rounded-sm"
          >
            <X className="h-3 w-3" />
          </button>
        </form>
      )}


    </div>
  );
};
