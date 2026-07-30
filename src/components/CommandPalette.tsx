import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useVault, FileEntry } from "../contexts/VaultContext";
import { searchEngine, SearchResult } from "../lib/search-engine";
import { isModKey } from "../lib/keyboard-utils";
import {
  Search,
  Sparkles,
  Terminal,
  CornerDownLeft,
  FilePlus,
  Hash,
  FileText,
  Clock,
  Tag,
  ArrowRight,
  Filter,
  Brain,
} from "lucide-react";
import { getFileIcon } from "../lib/file-icons";

type SearchMode = "all" | "files" | "commands" | "semantic" | "tags";

interface CommandItem {
  id: string;
  name: string;
  desc: string;
  shortcut: string;
  category: "Navigation" | "AI & Formatting" | "Tools" | "Vault";
  action: () => void;
  type: "command";
}

export const CommandPalette: React.FC = () => {
  const { files = [], openFile, openDailyNote, deepReindex, noteCache = {}, createFile } = useVault();

  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeMode, setActiveMode] = useState<SearchMode>("all");
  const [results, setResults] = useState<any[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [recentPaths, setRecentPaths] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const resultsContainerRef = useRef<HTMLDivElement>(null);

  // Load recent files history from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem("kognote_recent_files");
      if (saved) setRecentPaths(JSON.parse(saved));
    } catch {
      // ignore parse errors
    }
  }, []);

  const trackRecentFile = (path: string) => {
    try {
      const updated = [path, ...recentPaths.filter((p) => p !== path)].slice(0, 10);
      setRecentPaths(updated);
      localStorage.setItem("kognote_recent_files", JSON.stringify(updated));
    } catch {
      // ignore storage errors
    }
  };

  // Full command registry
  const COMMANDS: CommandItem[] = useMemo(
    () => [
      // Navigation
      { id: "v-editor", name: "Switch to Notes Editor View", desc: "Open the dual-mode markdown notes editor workspace", shortcut: "/editor", category: "Navigation", action: () => window.dispatchEvent(new CustomEvent("cmd-switch-view", { detail: "editor" })), type: "command" },
      { id: "v-canvas", name: "Switch to Whiteboard Canvas View", desc: "Open visual drawings canvas workspace", shortcut: "/canvas", category: "Navigation", action: () => window.dispatchEvent(new CustomEvent("cmd-switch-view", { detail: "canvas" })), type: "command" },
      { id: "v-graph", name: "Switch to Brain Graph View", desc: "Visualize note connections, tags, and cluster mappings", shortcut: "/graph", category: "Navigation", action: () => window.dispatchEvent(new CustomEvent("cmd-switch-view", { detail: "graph" })), type: "command" },
      { id: "v-flashcards", name: "Switch to SRS Review Deck", desc: "Study flashcards with spaced repetition reviews", shortcut: "/flashcards", category: "Navigation", action: () => window.dispatchEvent(new CustomEvent("cmd-switch-view", { detail: "flashcards" })), type: "command" },
      { id: "v-calendar", name: "Switch to Note Calendar View", desc: "Open journal entries and chronological daily notes", shortcut: "/calendar", category: "Navigation", action: () => window.dispatchEvent(new CustomEvent("cmd-switch-view", { detail: "calendar" })), type: "command" },
      { id: "v-tasks", name: "Switch to Checkbox Tasks View", desc: "View checkboxes list extracted across all notes", shortcut: "/tasks", category: "Navigation", action: () => window.dispatchEvent(new CustomEvent("cmd-switch-view", { detail: "tasks" })), type: "command" },
      { id: "v-board", name: "Switch to Kanban Project Board View", desc: "Manage project kanban task columns", shortcut: "/board", category: "Navigation", action: () => window.dispatchEvent(new CustomEvent("cmd-switch-view", { detail: "board" })), type: "command" },

      // AI & Formatting
      { id: "ai-format", name: "AI Format & Polish Document", desc: "Polishes grammar, styling, and markdown structure using AI", shortcut: "/aiformat", category: "AI & Formatting", action: () => window.dispatchEvent(new CustomEvent("trigger-ai-format")), type: "command" },
      { id: "ai-continue", name: "AI Continue Writing Note", desc: "Appends style-matched text predictions at active cursor", shortcut: "/continue", category: "AI & Formatting", action: () => window.dispatchEvent(new CustomEvent("trigger-continue-writing")), type: "command" },
      { id: "ai-rewrite", name: "AI Rewrite Selected Text Selection", desc: "Polishes highlighted note paragraph inline for clarity", shortcut: "/rewrite", category: "AI & Formatting", action: () => window.dispatchEvent(new CustomEvent("trigger-rewrite")), type: "command" },
      { id: "ai-summarize", name: "AI Summarize Active Note", desc: "Asks Copilot chat to generate a concise summary of active note", shortcut: "/summarize", category: "AI & Formatting", action: () => window.dispatchEvent(new CustomEvent("submit-copilot-prompt", { detail: "Summarize this note" })), type: "command" },
      { id: "ai-explain", name: "AI Explain Text Selection", desc: "Asks Copilot chat to explain the highlighted text block", shortcut: "/explain", category: "AI & Formatting", action: () => window.dispatchEvent(new CustomEvent("submit-copilot-prompt", { detail: "Explain the following text selection" })), type: "command" },
      { id: "ai-suggestlinks", name: "AI Suggest Link Connections", desc: "Scan current note to find & insert related wikilinks", shortcut: "/suggestlinks", category: "AI & Formatting", action: () => window.dispatchEvent(new CustomEvent("trigger-suggest-links")), type: "command" },
      { id: "instant-format", name: "Clean Spacing Formatting (Instant)", desc: "Quickly normalizes Markdown header & list spacing offline", shortcut: "/format", category: "AI & Formatting", action: () => window.dispatchEvent(new CustomEvent("trigger-instant-format")), type: "command" },

      // Tools & System
      { id: "t-settings", name: "Open Settings Dialog Panel", desc: "Configure offline local AI, LLM providers, and preferences", shortcut: "/settings", category: "Tools", action: () => window.dispatchEvent(new CustomEvent("trigger-open-settings")), type: "command" },
      { id: "t-daily", name: "Open Today's Daily Note", desc: "Open or create today's journal entry in Daily Notes/", shortcut: "/daily", category: "Tools", action: () => {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, "0");
        const dd = String(today.getDate()).padStart(2, "0");
        openDailyNote(`${yyyy}-${mm}-${dd}`);
      }, type: "command" },
      { id: "t-sidebar", name: "Toggle Sidebar Panel Navigation", desc: "Hide or show the vault files tree sidebar panel", shortcut: "/sidebar", category: "Tools", action: () => window.dispatchEvent(new CustomEvent("trigger-toggle-sidebar")), type: "command" },
      { id: "t-copilot", name: "Toggle AI Copilot Assistant Chat", desc: "Open or close the sidebar AI assistant Copilot chat panel", shortcut: "/copilot", category: "Tools", action: () => window.dispatchEvent(new CustomEvent("trigger-toggle-chat")), type: "command" },
      { id: "t-semantic", name: "Trigger Semantic Search Query Mode", desc: "Starts typing a vector semantic similarity query (prefix '?')", shortcut: "/semantic", category: "Tools", action: () => {
        setQuery("?");
        setActiveMode("semantic");
      }, type: "command" },
      { id: "t-reindex", name: "Deep Clear Cache & Re-index Vault", desc: "Wipe all note caches & vector database to trigger deep scan", shortcut: "/reindex", category: "Vault", action: () => {
        deepReindex().then(() => {
          window.dispatchEvent(new CustomEvent("kognote-toast", { detail: { message: "Vault deep re-index completed!" } }));
        }).catch(console.error);
      }, type: "command" }
    ],
    [openDailyNote, deepReindex]
  );

  // Keyboard shortcut listener (Cmd+K / Ctrl+K / Esc)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isModKey(e) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen((prev) => !prev);
        setQuery("");
        setActiveMode("all");
        setResults([]);
        setSelectedIndex(0);
      } else if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Focus input on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Flatten directory hierarchy safely
  const getFlatFiles = useCallback((items: FileEntry[] = []): FileEntry[] => {
    let flat: FileEntry[] = [];
    if (!Array.isArray(items)) return flat;
    for (const item of items) {
      if (item.is_dir) {
        if (item.children) flat = flat.concat(getFlatFiles(item.children));
      } else {
        flat.push(item);
      }
    }
    return flat;
  }, []);

  // Sync mode based on query prefix
  useEffect(() => {
    if (!isOpen) return;
    if (query.startsWith("/")) {
      if (activeMode !== "commands") setActiveMode("commands");
    } else if (query.startsWith("?")) {
      if (activeMode !== "semantic") setActiveMode("semantic");
    } else if (query.startsWith("#")) {
      if (activeMode !== "tags") setActiveMode("tags");
    }
  }, [query, activeMode, isOpen]);

  // Search execution (debounced, guarded by isOpen)
  useEffect(() => {
    if (!isOpen) return;

    const flatFiles = getFlatFiles(files);
    const rawQuery = query.trim();
    const lowercaseQuery = rawQuery.toLowerCase();

    let cleanQuery = lowercaseQuery;
    if (cleanQuery.startsWith("/") || cleanQuery.startsWith("?") || cleanQuery.startsWith("#")) {
      cleanQuery = cleanQuery.substring(1).trim();
    }

    // 1. Commands matching
    const matchingCmds = COMMANDS.filter((cmd) =>
      cmd.shortcut.toLowerCase().includes(lowercaseQuery) ||
      cmd.name.toLowerCase().includes(cleanQuery) ||
      cmd.desc.toLowerCase().includes(cleanQuery)
    );

    // 2. Empty Query State
    if (!rawQuery) {
      const recentItems: any[] = [];
      recentPaths.forEach((path) => {
        const file = flatFiles.find((f) => f.path === path);
        if (file) recentItems.push({ ...file, type: "recent" });
      });

      if (recentItems.length < 4) {
        flatFiles.slice(0, 4 - recentItems.length).forEach((f) => {
          if (!recentItems.some((r) => r.path === f.path)) {
            recentItems.push({ ...f, type: "file" });
          }
        });
      }

      setResults([...matchingCmds.slice(0, 4), ...recentItems]);
      setSelectedIndex(0);
      return;
    }

    // 3. Command Mode
    if (activeMode === "commands" || rawQuery.startsWith("/")) {
      setResults(matchingCmds);
      setSelectedIndex(0);
      return;
    }

    // 4. Tag Mode
    if (activeMode === "tags" || rawQuery.startsWith("#")) {
      const tagQuery = cleanQuery;
      const tagsSet = new Set<string>();
      Object.values(noteCache || {}).forEach((note: any) => {
        if (note?.meta?.tags && Array.isArray(note.meta.tags)) {
          note.meta.tags.forEach((t: string) => tagsSet.add(t.toLowerCase()));
        }
        if (note?.content) {
          const matches = note.content.match(/(?:^|\s|\\)#([a-zA-Z0-9_\-\/]+)/g) || [];
          matches.forEach((m: string) => {
            const clean = m.trim().replace(/^#/, "").toLowerCase();
            if (clean && clean !== "flashcard" && isNaN(Number(clean))) tagsSet.add(clean);
          });
        }
      });

      const matchingTags = Array.from(tagsSet)
        .filter((t) => t.includes(tagQuery))
        .map((tag) => ({
          name: `#${tag}`,
          tag,
          type: "tag",
          count: Object.values(noteCache || {}).filter((n: any) => n?.content?.toLowerCase().includes(`#${tag}`)).length,
        }));
      setResults(matchingTags);
      setSelectedIndex(0);
      return;
    }

    // 5. Semantic Vector Search
    if (activeMode === "semantic" || rawQuery.startsWith("?")) {
      if (!cleanQuery) {
        setResults([]);
        return;
      }

      const timer = setTimeout(async () => {
        setIsSearching(true);
        try {
          const rawResults = await searchEngine.search(cleanQuery);
          const mapped = rawResults.map((r: SearchResult) => {
            const parts = r.filePath.replace(/\\/g, "/").split("/");
            const name = parts[parts.length - 1];
            return {
              name,
              path: r.filePath,
              is_dir: false,
              chunkText: r.chunkText,
              similarity: r.similarity,
              type: "semantic",
            };
          });
          setResults(mapped);
        } catch (e) {
          console.error("Semantic search failed:", e);
        } finally {
          setIsSearching(false);
          setSelectedIndex(0);
        }
      }, 180);

      return () => clearTimeout(timer);
    }

    // 6. Standard Full-Text & Filename Search
    const timer = setTimeout(() => {
      setIsSearching(true);

      const fileMatches: any[] = [];
      const contentMatches: any[] = [];

      flatFiles.forEach((file) => {
        const fileNameLower = file.name.toLowerCase();
        const normPath = file.path.replace(/\\/g, "/");
        const cached = noteCache[file.path] || noteCache[normPath];
        const content = cached?.content?.toLowerCase() || "";

        if (fileNameLower.includes(cleanQuery)) {
          fileMatches.push({ ...file, type: "file" });
        } else if (content.includes(cleanQuery)) {
          const idx = content.indexOf(cleanQuery);
          const start = Math.max(0, idx - 40);
          const end = Math.min(content.length, idx + cleanQuery.length + 50);
          const rawText = cached?.content || "";
          const snippet = (start > 0 ? "..." : "") + rawText.slice(start, end).replace(/\n/g, " ") + (end < content.length ? "..." : "");

          contentMatches.push({
            ...file,
            snippet,
            type: "content",
          });
        }
      });

      const exactTitleMatch = flatFiles.some((f) => f.name.replace(/\.md$/, "").toLowerCase() === cleanQuery);
      const createActionItem = !exactTitleMatch && cleanQuery.length > 0 ? [{
        id: "create-note-action",
        name: `Create note "${cleanQuery}"`,
        queryTitle: cleanQuery,
        type: "create-note",
      }] : [];

      let mergedResults: any[] = [];
      if (activeMode === "files") {
        mergedResults = [...createActionItem, ...fileMatches, ...contentMatches];
      } else {
        mergedResults = [
          ...matchingCmds.slice(0, 2),
          ...createActionItem,
          ...fileMatches.slice(0, 6),
          ...contentMatches.slice(0, 4),
        ];
      }

      setResults(mergedResults);
      setSelectedIndex(0);
      setIsSearching(false);
    }, 120);

    return () => clearTimeout(timer);
  }, [query, files, activeMode, COMMANDS, getFlatFiles, recentPaths, noteCache, isOpen]);

  // Keyboard navigation inside modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, results.length));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + results.length) % Math.max(1, results.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (results[selectedIndex]) {
          handleSelect(results[selectedIndex]);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, results, selectedIndex]);

  // Select item action
  const handleSelect = async (item: any) => {
    if (!item) return;

    if (item.type === "command") {
      item.action();
    } else if (item.type === "create-note") {
      try {
        const title = item.queryTitle;
        const newPath = await createFile(null, title);
        openFile({ name: title.endsWith(".md") ? title : `${title}.md`, path: newPath, is_dir: false });
        trackRecentFile(newPath);
      } catch (err) {
        console.error("Failed to create note from command palette:", err);
      }
    } else if (item.type === "tag") {
      window.dispatchEvent(new CustomEvent("kognote-select-tag", { detail: item.tag }));
    } else {
      openFile({
        name: item.name,
        path: item.path,
        is_dir: false,
      });
      if (item.path) trackRecentFile(item.path);
    }
    setIsOpen(false);
  };

  // Scroll active item into view
  useEffect(() => {
    if (!isOpen) return;
    const container = resultsContainerRef.current;
    if (!container) return;
    const activeItem = container.children[selectedIndex] as HTMLElement;
    if (!activeItem) return;

    const containerTop = container.scrollTop;
    const containerBottom = containerTop + container.clientHeight;
    const elemTop = activeItem.offsetTop;
    const elemBottom = elemTop + activeItem.clientHeight;

    if (elemTop < containerTop) {
      container.scrollTop = elemTop;
    } else if (elemBottom > containerBottom) {
      container.scrollTop = elemBottom - container.clientHeight;
    }
  }, [isOpen, selectedIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 pt-[12vh] select-none animate-fade-in">
      <div className="absolute inset-0" onClick={() => setIsOpen(false)} />

      {/* Palette Card */}
      <div className="relative w-full max-w-2xl rounded-xl border border-[#1e2338] bg-[#0c0e17]/95 shadow-2xl overflow-hidden text-slate-200 flex flex-col max-h-[75vh] animate-modal-pop">
        
        {/* Top Input Bar */}
        <div className="flex h-13 items-center gap-3 px-4 border-b border-[#1e2338] bg-[#0f111d]">
          {activeMode === "semantic" || query.startsWith("?") ? (
            <Sparkles className="h-5 w-5 text-indigo-400 animate-pulse shrink-0" />
          ) : activeMode === "commands" || query.startsWith("/") ? (
            <Terminal className="h-5 w-5 text-amber-400 shrink-0" />
          ) : activeMode === "tags" || query.startsWith("#") ? (
            <Tag className="h-5 w-5 text-emerald-400 shrink-0" />
          ) : (
            <Search className="h-5 w-5 text-slate-400 shrink-0" />
          )}

          <input
            ref={inputRef}
            type="text"
            placeholder="Search notes, type '/' for commands, '?' for AI semantic search, '#' for tags..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-sm placeholder-slate-500 focus:outline-none text-slate-100 font-medium"
          />

          {query && (
            <button
              onClick={() => { setQuery(""); setActiveMode("all"); }}
              className="text-xs text-slate-500 hover:text-slate-300 cursor-pointer px-1.5 py-0.5 rounded bg-[#181b2a]"
            >
              Clear
            </button>
          )}

          <div className="rounded-md bg-[#161928] px-2 py-0.5 text-[10px] font-bold text-slate-400 border border-[#232840] shrink-0 font-mono">
            ESC
          </div>
        </div>

        {/* Filter Mode Switcher Bar */}
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[#1a1e30] bg-[#090b12] text-[11px] font-semibold text-slate-400 overflow-x-auto shrink-0">
          <span className="text-[10px] text-slate-600 uppercase tracking-widest px-1 font-bold flex items-center gap-1 shrink-0">
            <Filter className="h-3 w-3" /> Mode:
          </span>
          {[
            { id: "all", label: "All Results", icon: Search },
            { id: "files", label: "Notes", icon: FileText },
            { id: "commands", label: "Commands (/)", icon: Terminal },
            { id: "semantic", label: "AI Vector (?)", icon: Sparkles },
            { id: "tags", label: "Tags (#)", icon: Hash },
          ].map((mode) => {
            const Icon = mode.icon;
            const isActive = activeMode === mode.id;
            return (
              <button
                key={mode.id}
                onClick={() => {
                  setActiveMode(mode.id as SearchMode);
                  if (mode.id === "commands" && !query.startsWith("/")) setQuery("/");
                  else if (mode.id === "semantic" && !query.startsWith("?")) setQuery("?");
                  else if (mode.id === "tags" && !query.startsWith("#")) setQuery("#");
                  else if (mode.id === "all" || mode.id === "files") {
                    if (query.startsWith("/") || query.startsWith("?") || query.startsWith("#")) setQuery("");
                  }
                  inputRef.current?.focus();
                }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? "bg-indigo-600/20 text-indigo-300 border border-indigo-500/40 font-bold"
                    : "hover:bg-[#151828] text-slate-400 hover:text-slate-200 border border-transparent"
                }`}
              >
                <Icon className={`h-3 w-3 ${isActive ? "text-indigo-400" : "text-slate-500"}`} />
                {mode.label}
              </button>
            );
          })}
        </div>

        {/* Results List */}
        <div
          ref={resultsContainerRef}
          className="flex-1 overflow-y-auto p-2 flex flex-col gap-1 min-h-40"
        >
          {isSearching ? (
            <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center gap-2.5">
              <Sparkles className="h-6 w-6 text-indigo-400 animate-spin" />
              <span className="font-medium text-slate-400">Searching notes and AI embeddings...</span>
            </div>
          ) : results.length > 0 ? (
            results.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={(item.id || item.path || item.name || item.shortcut) + idx}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex flex-col gap-1 rounded-lg p-2.5 cursor-pointer border transition-all ${
                    isSelected
                      ? "bg-indigo-600/15 text-slate-100 border-indigo-500/40 shadow-sm"
                      : "hover:bg-[#141624] border-transparent text-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 text-xs font-semibold text-slate-200 min-w-0 flex-1">
                      {item.type === "command" ? (
                        <Terminal className="h-4 w-4 text-amber-400 shrink-0" />
                      ) : item.type === "create-note" ? (
                        <FilePlus className="h-4 w-4 text-indigo-400 shrink-0" />
                      ) : item.type === "tag" ? (
                        <Tag className="h-4 w-4 text-emerald-400 shrink-0" />
                      ) : item.type === "recent" ? (
                        <Clock className="h-4 w-4 text-slate-400 shrink-0" />
                      ) : (
                        getFileIcon(item, noteCache, { className: "h-4 w-4 shrink-0 text-indigo-300" })
                      )}

                      <span className="truncate font-medium text-[13px]">{item.name}</span>
                    </div>

                    {/* Right Badges */}
                    {item.type === "command" ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider hidden sm:inline">
                          {item.category}
                        </span>
                        <span className="text-[9.5px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded font-mono shrink-0">
                          {item.shortcut}
                        </span>
                      </div>
                    ) : item.type === "semantic" ? (
                      <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20 shrink-0">
                        {(item.similarity * 100).toFixed(0)}% AI match
                      </span>
                    ) : item.type === "create-note" ? (
                      <span className="text-[9.5px] font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/30 px-2 py-0.5 rounded-md shrink-0 flex items-center gap-1">
                        Create <ArrowRight className="h-3 w-3" />
                      </span>
                    ) : item.type === "tag" ? (
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full shrink-0">
                        {item.count} notes
                      </span>
                    ) : item.type === "recent" ? (
                      <span className="text-[9.5px] font-semibold text-slate-500 bg-[#161928] px-1.5 py-0.5 rounded border border-[#232840] shrink-0">
                        Recent
                      </span>
                    ) : null}
                  </div>

                  {/* Description / Path / Snippet */}
                  {item.desc && (
                    <p className="text-[11px] text-slate-400 leading-relaxed pl-6 font-normal">
                      {item.desc}
                    </p>
                  )}

                  {item.path && item.type !== "command" && (
                    <p className="text-[10.5px] text-slate-500 pl-6 truncate font-mono">
                      {item.path}
                    </p>
                  )}

                  {item.snippet && (
                    <p className="text-[11px] text-slate-300 leading-relaxed pl-6 border-l-2 border-indigo-500/50 italic bg-indigo-500/5 py-1 px-2 rounded-r mt-0.5">
                      "{item.snippet}"
                    </p>
                  )}

                  {item.chunkText && (
                    <p className="text-[11px] text-slate-300 line-clamp-2 leading-relaxed pl-6 border-l-2 border-indigo-500/50 italic bg-indigo-500/5 py-1 px-2 rounded-r mt-0.5">
                      "{item.chunkText}"
                    </p>
                  )}

                  {isSelected && (
                    <div className="flex justify-end mt-0.5">
                      <span className="flex items-center gap-1 text-[9.5px] font-bold text-indigo-400">
                        {item.type === "command"
                          ? "Run Command"
                          : item.type === "create-note"
                          ? "Create & Open Note"
                          : item.type === "tag"
                          ? "Filter Tag"
                          : "Open Note"}{" "}
                        <CornerDownLeft className="h-3 w-3" />
                      </span>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="py-12 text-center text-xs text-slate-500 flex flex-col items-center gap-2">
              <Search className="h-6 w-6 text-slate-600 stroke-[1.5]" />
              <span className="font-semibold text-slate-400">No matching notes or commands found</span>
              <span className="text-[11px] text-slate-600">Try searching for keywords, typing '/' for commands, or '?' for AI search</span>
            </div>
          )}
        </div>

        {/* Footer Navigation Bar */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[#1e2338] bg-[#090b12] text-[10.5px] text-slate-500 font-medium shrink-0">
          <div className="flex items-center gap-2">
            <Brain className="h-3.5 w-3.5 text-indigo-400" />
            <span>Kognote Global Palette & Vector Search</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <kbd className="rounded bg-[#161928] px-1.5 py-0.5 text-[9.5px] font-mono border border-[#232840] text-slate-400">↑↓</kbd>
              <span>navigate</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="rounded bg-[#161928] px-1.5 py-0.5 text-[9.5px] font-mono border border-[#232840] text-slate-400">↵</kbd>
              <span>run</span>
            </div>
            <div className="flex items-center gap-1">
              <kbd className="rounded bg-[#161928] px-1.5 py-0.5 text-[9.5px] font-mono border border-[#232840] text-slate-400">ESC</kbd>
              <span>close</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
