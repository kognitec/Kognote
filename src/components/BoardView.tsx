import React, { useState, useMemo } from "react";
import { useVault, FileEntry } from "../contexts/VaultContext";
import { useSettings } from "../contexts/SettingsContext";
import { useSync } from "../contexts/SyncContext";
import { searchEngine } from "../lib/search-engine";
import { invokeIPC } from "../lib/ipc";
import { setDragState, getDragState, clearDragState } from "../lib/drag-state";
import {
  Columns,
  Plus,
  Circle,
  Archive,
  Inbox,
  Clock,
  CheckCircle2,
  X,
  Search,
  Tag,
  ArrowUpDown,
  ChevronDown,
  FileText,
  GripVertical,
  Eye,
  Calendar,
  LayoutTemplate,
  Scissors,
  Bookmark,
  Filter,
  Trash2
} from "lucide-react";
import { ensureAndSyncFrontmatter, formatTimestampForDisplay } from "../lib/frontmatter";

interface BoardCard {
  file: FileEntry;
  title: string;
  snippet: string;
  tags: string[];
  status: "Backlog" | "Todo" | "In Progress" | "In Review" | "Done";
  todoTasks: number;
  completedTasks: number;
  wordCount: number;
  dueDate?: string;
  type?: string;
  storage?: "active" | "archived" | "deleted";
  bookmarked?: boolean;
  isEncrypted?: boolean;
  priority: "high" | "medium" | "low" | "none";
}

const COLUMNS: { name: "Backlog" | "Todo" | "In Progress" | "In Review" | "Done"; label: string; color: string; hoverBg: string; borderGlow: string; icon: any }[] = [
  {
    name: "Backlog",
    label: "Backlog",
    color: "text-slate-500",
    hoverBg: "hover:bg-slate-500/5",
    borderGlow: "border-slate-500/30",
    icon: Inbox
  },
  {
    name: "Todo",
    label: "Todo",
    color: "text-indigo-400",
    hoverBg: "hover:bg-indigo-500/5",
    borderGlow: "border-indigo-500/30",
    icon: Circle
  },
  {
    name: "In Progress",
    label: "In Progress",
    color: "text-amber-400",
    hoverBg: "hover:bg-amber-500/5",
    borderGlow: "border-amber-500/30",
    icon: Clock
  },
  {
    name: "In Review",
    label: "In Review",
    color: "text-purple-400",
    hoverBg: "hover:bg-purple-500/5",
    borderGlow: "border-purple-500/30",
    icon: Eye
  },
  {
    name: "Done",
    label: "Done",
    color: "text-emerald-400",
    hoverBg: "hover:bg-emerald-500/5",
    borderGlow: "border-emerald-500/30",
    icon: CheckCircle2
  }
];

const getRelativeTime = (timestamp?: number) => {
  if (!timestamp) return "Recently";
  const ms = timestamp < 1e11 ? timestamp * 1000 : timestamp;
  const diff = Date.now() - ms;

  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "Just now";

  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;

  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;

  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
};

const getTypeIcon = (t?: string) => {
  switch ((t || "note").toLowerCase()) {
    case "daily":
      return <span title="Daily Note"><Calendar className="h-3 w-3 text-indigo-400 shrink-0" /></span>;
    case "template":
      return <span title="Template"><LayoutTemplate className="h-3 w-3 text-purple-400 shrink-0" /></span>;
    case "clipping":
      return <span title="Web Clipping"><Scissors className="h-3 w-3 text-cyan-400 shrink-0" /></span>;
    default:
      return <span title="Note"><FileText className="h-3 w-3 text-[#d946ef] shrink-0" /></span>;
  }
};

export const BoardView: React.FC = () => {
  const { noteCache, isScanLoading, triggerNotesScan, openFile, refreshFiles, updateNoteCache } = useVault();
  const { registerSyncHandler, unregisterSyncHandler } = useSync();

  React.useEffect(() => {
    registerSyncHandler("board-refresh", async () => { await triggerNotesScan(); }, "Refresh Kanban Board");
    return () => unregisterSyncHandler("board-refresh");
  }, [registerSyncHandler, unregisterSyncHandler, triggerNotesScan]);

  const { vaultPath, includeArchivedInScans, userTimezone } = useSettings();

  // Board state computed from cache
  const cards = useMemo(() => {
    return Object.values(noteCache)
      .map(data => data.boardCard)
      .filter((card): card is BoardCard => {
        if (!card) return false;
        const normPath = card.file.path.replace(/\\/g, "/").toLowerCase();
        if (!includeArchivedInScans && (card.storage === "archived" || normPath.includes("/archived/"))) return false;
        if (card.storage === "deleted" || normPath.includes("/trash/") || normPath.includes("/.deleted/")) return false;
        if (card.type === "template" || normPath.includes("/templates/")) return false;
        return true;
      });
  }, [noteCache, includeArchivedInScans]);

  const [hoveredCard, setHoveredCard] = useState<{ card: BoardCard; rect: DOMRect } | null>(null);
  const hoverTimerRef = React.useRef<NodeJS.Timeout | null>(null);

  const handleCardMouseEnter = (card: BoardCard, e: React.MouseEvent<HTMLDivElement>) => {
    const targetEl = e.currentTarget;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      const rect = targetEl.getBoundingClientRect();
      setHoveredCard({ card, rect });
    }, 140);
  };

  const handleCardMouseLeave = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setHoveredCard(null);
    }, 80);
  };

  const getCleanNoteSnippet = (card: BoardCard): string => {
    const cached = noteCache[card.file.path];
    const rawText = cached?.content || card.snippet || "";
    if (!rawText) return "";

    const clean = rawText
      .replace(/---[\s\S]*?---/, "")
      .replace(/^#+\s+/gm, "")
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/\[\[(.*?)\]\]/g, "$1")
      .replace(/[`*_~#]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    return clean.slice(0, 600);
  };

  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [draggedCard, setDraggedCard] = useState<BoardCard | null>(null);

  // Filters & Sorting state
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [selectedPriority, setSelectedPriority] = useState<string | null>(null);
  const [selectedStorage, setSelectedStorage] = useState<string | null>(null);

  const [selectedBookmarkedOnly, setSelectedBookmarkedOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"title" | "due" | "tasks" | "modified">("title");

  // Inline Card Creator state
  const [activeCreatorColumn, setActiveCreatorColumn] = useState<string | null>(null);
  const [newCardTitle, setNewCardTitle] = useState("");
  const [newCardPriority, setNewCardPriority] = useState<"high" | "medium" | "low" | "none">("medium");

  // Extract all unique tags across cards for the filter selector
  const allUniqueTags = useMemo(() => {
    const tagsSet = new Set<string>();
    cards.forEach(c => c.tags.forEach(t => tagsSet.add(t.toLowerCase())));
    return Array.from(tagsSet).sort();
  }, [cards]);

  // Drag and Drop helpers
  const handleDragStart = (e: React.DragEvent, card: BoardCard) => {
    setDragState("card", card);
    setDragState("file", card.file);
    e.dataTransfer.setData("application/kognote-card", JSON.stringify(card));
    e.dataTransfer.setData("application/kognote-file", JSON.stringify({ name: card.file.name, path: card.file.path, is_dir: false }));
    e.dataTransfer.setData("text/plain", card.file.path);
    e.dataTransfer.effectAllowed = "all";
    setDraggedCard(card);
  };

  const handleDragEnd = () => {
    setDragOverColumn(null);
    setDraggedCard(null);
    clearDragState();
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDragEnter = (e: React.DragEvent, columnName: string) => {
    e.preventDefault();
    if (dragOverColumn !== columnName) {
      setDragOverColumn(columnName);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent, targetStatus: "Backlog" | "Todo" | "In Progress" | "In Review" | "Done") => {
    e.preventDefault();
    setDragOverColumn(null);

    let filePath = "";
    const draggedStateCard = getDragState<BoardCard>("card") || getDragState<FileEntry>("file");
    if (draggedStateCard) {
      filePath = (draggedStateCard as any).file?.path || (draggedStateCard as any).path || "";
    }
    if (!filePath) {
      filePath = draggedCard?.file.path || "";
    }
    if (!filePath) {
      const rawPayload = e.dataTransfer.getData("application/kognote-file") || e.dataTransfer.getData("application/kognote-card");
      if (rawPayload) {
        try {
          const parsed = JSON.parse(rawPayload);
          filePath = parsed.path || parsed.file?.path || "";
        } catch (_) { }
      }
    }
    if (!filePath) {
      filePath = e.dataTransfer.getData("text/plain") || "";
    }

    setDraggedCard(null);
    clearDragState();
    if (!filePath) return;

    // Only allow markdown files to be dropped onto board columns
    if (!filePath.toLowerCase().endsWith(".md")) {
      return;
    }

    const normPath = filePath.replace(/\\/g, "/").toLowerCase();
    const existingCard = cards.find(c => c.file.path.replace(/\\/g, "/").toLowerCase() === normPath);
    const targetFilePath = existingCard ? existingCard.file.path : filePath;

    if (existingCard && existingCard.status === targetStatus) {
      return;
    }

    await handleStatusChangeByPath(targetFilePath, targetStatus);
  };

  const handleStatusChangeByPath = async (filePath: string, targetStatus: "Backlog" | "Todo" | "In Progress" | "In Review" | "Done") => {
    try {
      const fileContent = (await invokeIPC("read_note", {
        path: filePath,
      })) as string;

      const targetStatusString = targetStatus === "In Progress" ? "in-progress" : targetStatus === "In Review" ? "in-review" : targetStatus.toLowerCase();
      const { fullContent: updatedContent } = ensureAndSyncFrontmatter(fileContent, {
        status: targetStatusString,
        forceUpdateTimestamp: true,
      });

      await invokeIPC("write_note", {
        path: filePath,
        content: updatedContent,
      });

      updateNoteCache(filePath, updatedContent);
      await searchEngine.indexFile(filePath, updatedContent);
      await refreshFiles();
      await triggerNotesScan();
    } catch (e) {
      console.error("Failed to update status:", e);
    }
  };

  const handleStatusChange = async (card: BoardCard, targetStatus: "Backlog" | "Todo" | "In Progress" | "In Review" | "Done") => {
    await handleStatusChangeByPath(card.file.path, targetStatus);
  };

  // Inline Note creation helper
  const handleCreateNoteInline = async (status: "Backlog" | "Todo" | "In Progress" | "In Review" | "Done") => {
    if (!newCardTitle || !newCardTitle.trim()) return;
    const title = newCardTitle.trim();

    // Clear inline states
    setActiveCreatorColumn(null);
    setNewCardTitle("");

    try {
      const statusVal = status === "In Progress" ? "in-progress" : status === "In Review" ? "in-review" : status.toLowerCase();

      // Inherit from active Board filters & selected options (type is strictly "note")
      const notePriority = newCardPriority || (selectedPriority && selectedPriority !== "all" ? selectedPriority : "none");
      const noteStorage = selectedStorage === "archived" ? "archived" : "active";
      const noteBookmarked = selectedBookmarkedOnly ? "yes" : "no";

      const { fullContent: initialContent } = ensureAndSyncFrontmatter(
        "",
        {
          status: statusVal,
          priority: notePriority as any,
          type: "note",
          storage: noteStorage as any,
          bookmarked: noteBookmarked,
          forceUpdateTimestamp: true,
        }
      );

      const parent = vaultPath;
      const fileName = title.endsWith(".md") ? title : `${title}.md`;
      const filePath = `${parent}/${fileName}`;

      await invokeIPC("write_note", {
        path: filePath,
        content: initialContent,
      });

      updateNoteCache(filePath, initialContent);
      await searchEngine.indexFile(filePath, initialContent);
      await refreshFiles();
    } catch (e) {
      console.error("Failed to create note from board:", e);
    }
  };

  const handleRemoveFromBoard = async (e: React.MouseEvent, card: BoardCard) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to remove "${card.title}" from the Board?`)) return;

    try {
      const fileContent = (await invokeIPC("read_note", {
        path: card.file.path,
      })) as string;

      const { fullContent: updatedContent } = ensureAndSyncFrontmatter(fileContent, {
        status: "none",
        forceUpdateTimestamp: true,
      });

      await invokeIPC("write_note", {
        path: card.file.path,
        content: updatedContent,
      });

      updateNoteCache(card.file.path, updatedContent);
      await searchEngine.indexFile(card.file.path, updatedContent);
      refreshFiles();
    } catch (err) {
      console.error("Failed to remove note from board:", err);
    }
  };

  // Filter and sort cards inside columns
  const getFilteredAndSortedCards = (columnName: "Backlog" | "Todo" | "In Progress" | "In Review" | "Done") => {
    let list = cards.filter(c => c.status === columnName);

    // 1. Search Query filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.snippet.toLowerCase().includes(q)
      );
    }

    // 2. Tag selector filter
    if (selectedTag) {
      list = list.filter(c => c.tags.includes(selectedTag));
    }

    // 3. Type selector filter
    if (selectedType) {
      list = list.filter(c => (c.type || "note").toLowerCase() === selectedType.toLowerCase());
    }

    // 4. Priority selector filter
    if (selectedPriority) {
      list = list.filter(c => c.priority.toLowerCase() === selectedPriority.toLowerCase());
    }

    // 5. Storage selector filter
    if (selectedStorage) {
      list = list.filter(c => (c.storage || "active").toLowerCase() === selectedStorage.toLowerCase());
    }

    // 7. Bookmark selector filter
    if (selectedBookmarkedOnly) {
      list = list.filter(c => c.bookmarked === true);
    }

    // 6. Sort options
    return [...list].sort((a, b) => {
      if (sortBy === "title") {
        return a.title.localeCompare(b.title);
      }
      if (sortBy === "due") {
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return String(a.dueDate).localeCompare(String(b.dueDate));
      }
      if (sortBy === "tasks") {
        const aTotal = a.todoTasks + a.completedTasks;
        const bTotal = b.todoTasks + b.completedTasks;
        const aRate = aTotal > 0 ? a.completedTasks / aTotal : 0;
        const bRate = bTotal > 0 ? b.completedTasks / bTotal : 0;
        return bRate - aRate; // higher progress first
      }
      if (sortBy === "modified") {
        const aTime = a.file.modified_at || 0;
        const bTime = b.file.modified_at || 0;
        return bTime - aTime; // newest first
      }
      return 0;
    });
  };

  return (
    <div className="flex flex-col h-full w-full bg-background text-foreground select-none animate-fade-in">

      {/* ── Top Controls Header ────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 border-b border-card-border px-6 py-4 bg-sidebar/50 backdrop-blur-md shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Columns className="h-4.5 w-4.5" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-foreground leading-tight">Vault Board</h1>
              <p className="text-[10px] text-slate-500 font-semibold tracking-wide uppercase">
                Kanban project board from note status
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {isScanLoading && (
              <span className="text-[10px] text-indigo-400 font-semibold tracking-wide animate-pulse">
                SYNCING BOARD...
              </span>
            )}
          </div>
        </div>

        {/* Row 2: Filtering Controls */}
        <div className="flex flex-wrap items-center gap-3 border-t border-card-border/40 pt-3">
          {/* Search box */}
          <div className="relative w-44 sm:w-56 min-w-30 shrink">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search cards..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg bg-card pl-8 pr-8 py-1.5 text-xs text-foreground border border-card-border focus:outline-none focus:border-indigo-500/50 hover:border-slate-400 dark:hover:border-slate-800 transition-colors placeholder-slate-400"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Type Filter */}
          <div className="flex items-center gap-1.5 text-slate-500 border-l border-card-border pl-3 shrink-0">
            <Filter className="h-3.5 w-3.5 text-slate-500 shrink-0" />
            <span className="hidden md:inline text-[10px] font-bold uppercase tracking-wider text-slate-500">Type:</span>
            <div className="relative flex items-center">
              <select
                value={selectedType || ""}
                onChange={(e) => setSelectedType(e.target.value || null)}
                className="appearance-none bg-card border border-card-border hover:border-slate-400 dark:hover:border-slate-800 rounded-md pl-2 pr-7 py-1 text-slate-700 dark:text-slate-200 text-xs font-semibold focus:outline-none focus:border-indigo-500/50 cursor-pointer transition-colors"
              >
                <option value="">All Types</option>
                <option value="note">Note</option>
                <option value="daily">Daily</option>
                <option value="clipping">Clipping</option>
              </select>
              <ChevronDown className="h-3 w-3 text-slate-500 absolute right-2 pointer-events-none" />
            </div>
          </div>

          {/* Priority Filter */}
          <div className="flex items-center gap-1.5 text-slate-500 border-l border-card-border pl-3 shrink-0">
            <span className="hidden md:inline text-[10px] font-bold uppercase tracking-wider text-slate-500">Priority:</span>
            <div className="relative flex items-center">
              <select
                value={selectedPriority || ""}
                onChange={(e) => setSelectedPriority(e.target.value || null)}
                className="appearance-none bg-card border border-card-border hover:border-slate-400 dark:hover:border-slate-800 rounded-md pl-2 pr-7 py-1 text-slate-700 dark:text-slate-200 text-xs font-semibold focus:outline-none focus:border-indigo-500/50 cursor-pointer transition-colors"
              >
                <option value="">All Priorities</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="none">None</option>
              </select>
              <ChevronDown className="h-3 w-3 text-slate-500 absolute right-2 pointer-events-none" />
            </div>
          </div>

          {/* Storage Filter */}
          <div className="flex items-center gap-1.5 text-slate-500 border-l border-card-border pl-3 shrink-0">
            <span className="hidden md:inline text-[10px] font-bold uppercase tracking-wider text-slate-500">Storage:</span>
            <div className="relative flex items-center">
              <select
                value={selectedStorage || ""}
                onChange={(e) => setSelectedStorage(e.target.value || null)}
                className="appearance-none bg-card border border-card-border hover:border-slate-400 dark:hover:border-slate-800 rounded-md pl-2 pr-7 py-1 text-slate-700 dark:text-slate-200 text-xs font-semibold focus:outline-none focus:border-indigo-500/50 cursor-pointer transition-colors"
              >
                <option value="">All Storage</option>
                <option value="active">📂 Active</option>
                <option value="archived">📦 Archived</option>
                <option value="deleted">🗑️ Deleted</option>
              </select>
              <ChevronDown className="h-3 w-3 text-slate-500 absolute right-2 pointer-events-none" />
            </div>
          </div>

          {/* Tag Filter */}
          <div className="flex items-center gap-1.5 text-slate-500 border-l border-card-border pl-3 shrink-0">
            <Tag className="h-3.5 w-3.5 text-slate-500 shrink-0" />
            <span className="hidden md:inline text-[10px] font-bold uppercase tracking-wider text-slate-500">Tag:</span>
            <div className="relative flex items-center">
              <select
                value={selectedTag || ""}
                onChange={(e) => setSelectedTag(e.target.value || null)}
                className="appearance-none bg-card border border-card-border hover:border-slate-400 dark:hover:border-slate-800 rounded-md pl-2 pr-7 py-1 text-slate-700 dark:text-slate-200 text-xs font-semibold focus:outline-none focus:border-indigo-500/50 cursor-pointer transition-colors"
              >
                <option value="">All Tags</option>
                {allUniqueTags.map(tag => (
                  <option key={tag} value={tag}>#{tag}</option>
                ))}
              </select>
              <ChevronDown className="h-3 w-3 text-slate-500 absolute right-2 pointer-events-none" />
            </div>
          </div>

          {/* Bookmarked Only Toggle */}
          <button
            onClick={() => setSelectedBookmarkedOnly(prev => !prev)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold border transition-all cursor-pointer ${selectedBookmarkedOnly
                ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                : "bg-card border-card-border text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-200"
              }`}
          >
            <Bookmark className={`h-3.5 w-3.5 ${selectedBookmarkedOnly ? "fill-amber-400" : ""}`} />
            <span>Bookmarked</span>
          </button>

          {/* Sort By selector */}
          <div className="flex items-center gap-1.5 text-slate-500 border-l border-card-border pl-3 shrink-0">
            <ArrowUpDown className="h-3.5 w-3.5 text-slate-500 shrink-0" />
            <span className="hidden md:inline text-[10px] font-bold uppercase tracking-wider text-slate-500">Sort:</span>
            <div className="relative flex items-center">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="appearance-none bg-card border border-card-border hover:border-slate-400 dark:hover:border-slate-800 rounded-md pl-2 pr-7 py-1 text-slate-700 dark:text-slate-200 text-xs font-semibold focus:outline-none focus:border-indigo-500/50 cursor-pointer transition-colors"
              >
                <option value="title">Card Title</option>
                <option value="due">Due Date</option>
                <option value="tasks">Progress</option>
                <option value="modified">Last Modified</option>
              </select>
              <ChevronDown className="h-3 w-3 text-slate-500 absolute right-2 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Board Columns Grid ─────────────────────────────────────────── */}
      <div className="flex-1 w-full p-6 overflow-x-auto overflow-y-hidden flex gap-5 select-none align-top min-h-0 h-full">
        {COLUMNS.map((col) => {
          const colCards = getFilteredAndSortedCards(col.name);
          const Icon = col.icon;
          const isOver = dragOverColumn === col.name;

          // Calculate aggregate column task metrics
          const totalTasksInCol = colCards.reduce((acc, card) => acc + card.todoTasks + card.completedTasks, 0);
          const completedTasksInCol = colCards.reduce((acc, card) => acc + card.completedTasks, 0);

          return (
            <div
              key={col.name}
              onDragOver={handleDragOver}
              onDragEnter={(e) => handleDragEnter(e, col.name)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, col.name)}
              className={`w-72 flex flex-col h-full max-h-full rounded-xl bg-sidebar border border-card-border hover:border-slate-800/40 transition-all duration-200 shrink-0 select-none overflow-hidden min-h-0 ${isOver
                  ? "border-indigo-500/40 bg-indigo-500/5 shadow-2xl"
                  : ""
                }`}
            >
              {/* Column Header */}
              <div className="flex flex-col shrink-0">
                <div className="flex items-center justify-between px-4 py-3 bg-card border-b border-card-border">
                  <div className="flex items-center gap-2">
                    <Icon className={`h-4 w-4 ${col.color}`} />
                    <span className="text-xs font-bold text-slate-300 leading-none">{col.label}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-sidebar text-slate-500 font-extrabold leading-none">
                      {colCards.length}
                    </span>
                  </div>

                  <button
                    onClick={() => {
                      setActiveCreatorColumn(col.name);
                      setNewCardTitle("");
                      setNewCardPriority((selectedPriority && selectedPriority !== "all" ? selectedPriority : "medium") as any);
                    }}
                    className="p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-slate-800/40 active:scale-95 transition-all cursor-pointer"
                    title={`Create new note in ${col.label}`}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Column Header Progress bar (if tasks exist) */}
                {totalTasksInCol > 0 && (
                  <div className="w-full h-0.5 bg-slate-800/80 overflow-hidden shrink-0">
                    <div
                      style={{ width: `${Math.round((completedTasksInCol / totalTasksInCol) * 100)}%` }}
                      className="h-full bg-indigo-500 transition-all duration-300"
                    />
                  </div>
                )}
              </div>

              {/* Inline Card Creator Form */}
              {activeCreatorColumn === col.name && (
                <div className="p-3 border-b border-card-border/40 shrink-0 bg-black">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleCreateNoteInline(col.name);
                    }}
                    className="flex flex-col gap-2 rounded-lg border border-indigo-500/25 bg-black p-2.5 shadow-2xl"
                  >
                    <input
                      type="text"
                      autoFocus
                      required
                      placeholder="Note title..."
                      value={newCardTitle}
                      onChange={(e) => setNewCardTitle(e.target.value)}
                      className="w-full bg-[#050608] border border-card-border rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/50 placeholder-slate-600 font-semibold"
                    />

                    {/* Active Board Metadata Preview Badges */}
                    <div className="flex flex-wrap items-center gap-1 text-[9.5px] font-mono">
                      <span className="px-1.5 py-0.5 rounded bg-card border border-[#2a2e3d] text-indigo-300 font-bold">
                        Status: {col.label}
                      </span>
                      {selectedTag && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                          #{selectedTag}
                        </span>
                      )}
                      {selectedStorage === "archived" && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-400">
                          Archived
                        </span>
                      )}
                      {selectedBookmarkedOnly && (
                        <span className="px-1.5 py-0.5 rounded bg-yellow-500/10 border border-yellow-500/20 text-yellow-400">
                          Bookmarked
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1">
                      <select
                        value={newCardPriority}
                        onChange={(e) => setNewCardPriority(e.target.value as any)}
                        className="bg-[#050608] border border-card-border rounded px-2 py-1 text-[10px] font-bold text-slate-300 focus:outline-none focus:border-indigo-500/50 cursor-pointer"
                        title="Initial Note Priority"
                      >
                        <option value="medium">⚡ Priority: Medium</option>
                        <option value="high">🔥 Priority: High</option>
                        <option value="low">💤 Priority: Low</option>
                        <option value="none">⚪ Priority: None</option>
                      </select>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveCreatorColumn(null);
                            setNewCardTitle("");
                          }}
                          className="px-2 py-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-[10px] font-bold transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={!newCardTitle.trim()}
                          className="px-2.5 py-1 text-[10.5px] font-bold text-white bg-indigo-600 rounded hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
                        >
                          Create Note
                        </button>
                      </div>
                    </div>
                  </form>
                </div>
              )}

              {/* Card List Container */}
              <div
                className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5 max-h-full select-none min-h-0 custom-scrollbar"
                onDragOver={handleDragOver}
                onDragEnter={(e) => handleDragEnter(e, col.name)}
                onDrop={(e) => handleDrop(e, col.name)}
              >
                {colCards.map((card) => {
                  const hasTasks = card.todoTasks + card.completedTasks > 0;
                  const percent = hasTasks
                    ? Math.round((card.completedTasks / (card.todoTasks + card.completedTasks)) * 100)
                    : 0;

                  return (
                    <div
                      key={card.file.path}
                      draggable
                      onDragStart={(e) => handleDragStart(e, card)}
                      onDragEnd={handleDragEnd}
                      onDragOver={handleDragOver}
                      onDragEnter={(e) => handleDragEnter(e, col.name)}
                      onDrop={(e) => handleDrop(e, col.name)}
                      onClick={() => openFile(card.file)}
                      onMouseEnter={(e) => handleCardMouseEnter(card, e)}
                      onMouseLeave={handleCardMouseLeave}
                      className={`shrink-0 group flex flex-col gap-2.5 rounded-xl border p-3.5 transition-all duration-300 cursor-pointer relative glass-card overflow-hidden w-full bg-card text-foreground ${card.priority === "high"
                          ? "border-red-500/30 hover:border-red-500/50"
                          : card.priority === "medium"
                            ? "border-amber-500/30 hover:border-amber-500/50"
                            : "border-card-border"
                        }`}
                    >
                      {/* Priority, Drag Handle, Note Type, Bookmark, Lock & Last Modified Date */}
                      <div className="flex flex-wrap items-center justify-between gap-y-1.5 gap-x-2 text-[9px] font-bold leading-none select-none w-full">
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0 max-w-full">
                          <GripVertical className="h-3 w-3 text-slate-500/70 group-hover:text-indigo-400/80 cursor-grab active:cursor-grabbing transition-colors shrink-0" />

                          {/* Note Type Icon */}
                          {getTypeIcon(card.type)}

                          {/* Bookmark Icon */}
                          {card.bookmarked && (
                            <span title="Bookmarked Note"><Bookmark className="h-3 w-3 text-amber-400 fill-amber-400/30 shrink-0" /></span>
                          )}



                          {/* Storage State Badge */}
                          {card.storage && card.storage !== "active" && (
                            <>
                              {card.storage === "archived" && (
                                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-extrabold tracking-wider uppercase bg-sky-500/10 text-sky-400 border border-sky-500/15 shrink-0" title="Archived Storage">
                                  <Archive className="h-2.5 w-2.5" />
                                  archived
                                </span>
                              )}
                              {card.storage === "deleted" && (
                                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-extrabold tracking-wider uppercase bg-rose-500/10 text-rose-400 border border-rose-500/15 shrink-0" title="Deleted Storage">
                                  <Trash2 className="h-2.5 w-2.5" />
                                  trash
                                </span>
                              )}
                            </>
                          )}

                          {card.priority !== "none" && (
                            <>
                              {card.priority === "high" && (
                                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-extrabold tracking-wider uppercase bg-rose-500/10 text-rose-400 border border-rose-500/15 shrink-0">
                                  <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0" />
                                  {card.priority}
                                </span>
                              )}
                              {card.priority === "medium" && (
                                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-extrabold tracking-wider uppercase bg-amber-500/10 text-amber-400 border border-amber-500/15 shrink-0">
                                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                                  {card.priority}
                                </span>
                              )}
                              {card.priority === "low" && (
                                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-extrabold tracking-wider uppercase bg-slate-500/10 text-slate-400 border border-slate-500/15 shrink-0">
                                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400 shrink-0" />
                                  {card.priority}
                                </span>
                              )}
                            </>
                          )}
                        </div>

                        {/* Relative Modified Time / Hover Action Controls */}
                        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
                          <span className="text-slate-500 font-semibold group-hover:hidden">
                            {getRelativeTime(card.file.modified_at)}
                          </span>

                          <div className="hidden group-hover:flex items-center gap-1.5 transition-opacity">
                            {/* Quick mover status selector */}
                            <div className="relative flex items-center">
                              <select
                                value={card.status}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => handleStatusChange(card, e.target.value as any)}
                                className="appearance-none bg-[#1c1e2d] border border-[#2d3149] hover:border-indigo-500/50 rounded pl-1.5 pr-4 py-0.5 text-slate-400 hover:text-slate-200 text-[9px] font-bold focus:outline-none cursor-pointer transition-all max-w-23.75 truncate"
                              >
                                <option value="Backlog">Backlog</option>
                                <option value="Todo">Todo</option>
                                <option value="In Progress">In Progress</option>
                                <option value="In Review">In Review</option>
                                <option value="Done">Done</option>
                              </select>
                              <ChevronDown className="h-2.5 w-2.5 text-slate-500 absolute right-1 pointer-events-none" />
                            </div>

                            {/* Delete Card */}
                            <button
                              onClick={(e) => handleRemoveFromBoard(e, card)}
                              className="p-0.5 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                              title="Remove card from board"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Full-Width Note Title */}
                      <div className="w-full select-none pt-0.5">
                        <span
                          className="text-xs font-bold text-foreground leading-snug group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors line-clamp-2 wrap-break-word block"
                        >
                          {card.title}
                        </span>
                      </div>

                      {/* Note Tags Body Section (Replaces content snippet) */}
                      <div className="min-h-5.5 flex flex-wrap items-center gap-1 select-none py-0.5">
                        {card.tags && card.tags.length > 0 ? (
                          card.tags.map((t) => (
                            <span
                              key={t}
                              className="text-[9px] px-1.5 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 font-bold hover:text-indigo-200 transition-colors"
                            >
                              #{t}
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-slate-600/70 italic select-none">No tags</span>
                        )}
                      </div>

                      {/* Info Row (Due date & task counts) */}
                      <div className="flex items-center justify-between border-t border-card-border/70 pt-2 select-none">
                        <div className="flex items-center gap-1.5">
                          <Calendar className={`h-3 w-3 ${card.dueDate ? "text-indigo-400" : "text-slate-600/70"}`} />
                          <span className={`text-[9px] font-bold tracking-wide uppercase ${card.dueDate ? "text-slate-300" : "text-slate-600"}`}>
                            {card.dueDate ? `Due: ${formatTimestampForDisplay(card.dueDate, userTimezone)}` : "No due date"}
                          </span>
                        </div>

                        {hasTasks && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[9px] font-extrabold text-emerald-500 dark:text-emerald-400">
                              {card.completedTasks}/{card.todoTasks + card.completedTasks}
                            </span>
                            <div className="w-10 h-1 rounded-full bg-slate-800 dark:bg-slate-900 overflow-hidden">
                              <div
                                style={{ width: `${percent}%` }}
                                className="h-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] transition-all duration-300"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {colCards.length === 0 && (
                  <div className="flex flex-col items-center justify-center gap-1.5 py-12 text-slate-600 border border-dashed border-card-border/70 rounded-xl select-none">
                    <span className="text-[10px] italic">No cards</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── 🎴 Rich Note Preview Hover Popover Card ────────────────────────────── */}
      {hoveredCard && (() => {
        const { card, rect } = hoveredCard;
        const snippet = getCleanNoteSnippet(card);
        const totalTasks = card.todoTasks + card.completedTasks;

        const popoverWidth = 264;  // Slimmer vertical card width (w-66 / 264px)
        const popoverHeight = 320; // Estimated height for boundary check

        // Align top-right corner of popover near bottom-right corner of the hovered board card
        let left = rect.right - popoverWidth;
        let top = rect.bottom + 6;

        // Horizontal boundary checks
        if (left < 12) {
          left = 12;
        } else if (left + popoverWidth > window.innerWidth - 12) {
          left = window.innerWidth - popoverWidth - 12;
        }

        // Vertical boundary checks to prevent cut-off
        if (rect.bottom + popoverHeight > window.innerHeight - 12) {
          const topAbove = rect.top - popoverHeight - 6;
          if (topAbove >= 12) {
            top = topAbove;
          } else {
            top = Math.max(12, window.innerHeight - popoverHeight - 12);
          }
        }

        return (
          <div
            style={{ left: `${left}px`, top: `${top}px` }}
            onMouseEnter={() => { if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current); }}
            onMouseLeave={handleCardMouseLeave}
            className="fixed z-50 w-66 p-3 rounded-xl bg-white/95 dark:bg-[#121420]/95 backdrop-blur-md border border-slate-300 dark:border-slate-800 shadow-2xl flex flex-col gap-2 text-xs text-slate-900 dark:text-slate-100 animate-fade-in pointer-events-auto max-h-85"
          >
            {/* Header: Note Name + Type Badge */}
            <div className="flex items-start justify-between gap-1.5 border-b border-slate-200 dark:border-slate-800/80 pb-1.5 shrink-0">
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <span className="font-extrabold text-[11.5px] text-slate-900 dark:text-slate-100 truncate leading-snug">
                  {card.title}
                </span>
                <span className="text-[9px] text-slate-500 font-mono truncate">
                  {card.file.path.replace(/\\/g, "/").split("/").slice(-2).join("/")}
                </span>
              </div>
              <span className="px-1.5 py-0.5 rounded-full text-[8px] font-extrabold uppercase tracking-wider bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20 shrink-0">
                {card.type || "Note"}
              </span>
            </div>

            {/* Note Body Content - Vertical scrollable list with expanded text */}
            <div className="flex-1 overflow-y-auto custom-scrollbar pr-0.5 max-h-48">
              {snippet ? (
                <p className="text-[10.5px] text-slate-600 dark:text-slate-300 leading-relaxed font-sans select-none whitespace-pre-wrap">
                  {snippet}
                </p>
              ) : (
                <span className="text-[10px] text-slate-400 italic">No body content</span>
              )}
            </div>

            {/* Footer Metadata */}
            <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800/80 pt-1.5 text-[9px] text-slate-500 font-medium shrink-0">
              <div className="flex items-center gap-1 overflow-hidden">
                {card.tags && card.tags.length > 0 ? (
                  card.tags.slice(0, 2).map((t) => (
                    <span key={t} className="text-[8px] font-bold px-1 py-0.5 rounded bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20">
                      #{t}
                    </span>
                  ))
                ) : (
                  <span className="text-[8.5px]">No tags</span>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {totalTasks > 0 && (
                  <span className="font-extrabold text-emerald-600 dark:text-emerald-400 text-[8.5px]">
                    ☑️ {card.completedTasks}/{totalTasks}
                  </span>
                )}
                {card.priority !== "none" && (
                  <span className="uppercase font-bold text-[8px] px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                    {card.priority}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
