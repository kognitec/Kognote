import React, { useState, useRef, useEffect, useMemo } from "react";
import { 
  Sliders, 
  ChevronDown, 
  ChevronRight, 
  Calendar, 
  Clock, 
  User, 
  Link2, 
  Check,
  FileText,
  Bookmark,
  LayoutTemplate,
  Scissors,
  CircleDashed,
  Circle,
  Eye,
  CheckCircle2,
  Archive,
  Inbox,
  AlertTriangle,
  AlertCircle,
  Info,
  MinusCircle,
  Folder,
  Trash2
} from "lucide-react";
import { parseFrontmatter, ensureAndSyncFrontmatter } from "../../lib/frontmatter";
import { useVault } from "../../contexts/VaultContext";
import { getFileIcon } from "../../lib/file-icons";

interface MetadataBarProps {
  content: string;
  onUpdateContent: (newContent: string) => void;
  onBookmarkNote?: () => void;
  onArchiveNote?: () => void;
  onDeleteNote?: () => void;
  onRestoreNote?: () => void;
  incomingLinks?: string[];
  outgoingLinks?: string[];
  onOpenNote?: (noteName: string) => void;
}

export const MetadataBar: React.FC<MetadataBarProps> = ({
  content,
  onUpdateContent,
  onBookmarkNote,
  onArchiveNote,
  onDeleteNote,
  onRestoreNote,
  incomingLinks = [],
  outgoingLinks = [],
  onOpenNote
}) => {
  const { activeFile, noteCache, openNoteByName } = useVault();
  const handleOpenNote = onOpenNote || openNoteByName;
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);
  
  // Popover menus state for interactive multi-option picking
  const [openDropdown, setOpenDropdown] = useState<"status" | "priority" | "due" | "storage" | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown popovers on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const parsed = useMemo(() => parseFrontmatter(content), [content]);
  const fields = parsed.fields;

  const currentType = (fields.type || "note").toLowerCase();
  const currentStatus = (fields.status || "none").toLowerCase();
  const currentPriority = (fields.priority || "none").toLowerCase();
  const currentDue = fields.due || "";
  const currentStorage = (fields.storage || "active").toLowerCase();
  const currentBookmarked = fields.bookmarked === "yes" || fields.storage === "bookmarked" ? "yes" : "no";

  const [dueDatePart, dueTimePart] = useMemo(() => {
    if (!currentDue) return ["", ""];
    const match = currentDue.trim().match(/^(20\d{2}[-/]\d{2}[-/]\d{2})(?:[T\s]+([01]\d|2[0-3]):([0-5]\d))?/);
    if (!match) return ["", ""];
    const date = match[1].replace(/\//g, "-");
    const time = match[2] && match[3] ? `${match[2]}:${match[3]}` : "";
    return [date, time];
  }, [currentDue]);

  const handleUpdateFrontmatter = (
    updates: {
      type?: string;
      status?: string;
      priority?: string;
      due?: string;
      storage?: string;
      bookmarked?: string;
    },
    closeDropdown = true
  ) => {
    if (updates.storage === "archived" || updates.storage === "deleted") {
      updates.bookmarked = "no";
    }

    const nextType = updates.type !== undefined ? updates.type : currentType;
    const nextStatus = updates.status !== undefined ? updates.status : currentStatus;
    const nextPriority = updates.priority !== undefined ? updates.priority : currentPriority;
    const nextDue = updates.due !== undefined ? updates.due : currentDue;
    const nextStorage = updates.storage !== undefined ? updates.storage : currentStorage;
    const nextBookmarked = updates.bookmarked !== undefined ? updates.bookmarked : currentBookmarked;

    if (updates.storage !== undefined) {
      if (nextStorage === "archived" && onArchiveNote) onArchiveNote();
      else if (nextStorage === "deleted" && onDeleteNote) onDeleteNote();
      else if (nextStorage === "active" && onRestoreNote) onRestoreNote();
      if (closeDropdown) setOpenDropdown(null);
      return;
    }

    if (updates.bookmarked !== undefined) {
      if (onBookmarkNote) onBookmarkNote();
      if (closeDropdown) setOpenDropdown(null);
      return;
    }

    const { fullContent } = ensureAndSyncFrontmatter(content, {
      type: nextType,
      status: nextStatus,
      priority: nextPriority,
      due: nextDue,
      bookmarked: nextBookmarked,
      updater: "user",
      forceUpdateTimestamp: true
    });

    onUpdateContent(fullContent);
    if (closeDropdown) {
      setOpenDropdown(null);
    }
  };

  const getTypeIcon = (t: string) => {
    switch (t.toLowerCase()) {
      case "daily":
        return <Calendar className="h-3.5 w-3.5 text-indigo-400 shrink-0" />;
      case "template":
        return <LayoutTemplate className="h-3.5 w-3.5 text-purple-400 shrink-0" />;
      case "clipping":
        return <Scissors className="h-3.5 w-3.5 text-cyan-400 shrink-0" />;
      default:
        return <FileText className="h-3.5 w-3.5 text-[#d946ef] shrink-0" />;
    }
  };

  const getStatusIcon = (st: string) => {
    switch (st.toLowerCase()) {
      case "done":
        return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
      case "in-progress":
      case "inprogress":
        return <Clock className="h-3.5 w-3.5 text-cyan-400 shrink-0" />;
      case "in-review":
      case "inreview":
        return <Eye className="h-3.5 w-3.5 text-purple-400 shrink-0" />;
      case "todo":
        return <Circle className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
      case "backlog":
        return <Inbox className="h-3.5 w-3.5 text-slate-400 shrink-0" />;
      default:
        return <CircleDashed className="h-3.5 w-3.5 text-slate-500 shrink-0" />;
    }
  };

  const getPriorityIcon = (p: string) => {
    switch (p.toLowerCase()) {
      case "high":
        return <AlertTriangle className="h-3.5 w-3.5 text-rose-400 shrink-0" />;
      case "medium":
        return <AlertCircle className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
      case "low":
        return <Info className="h-3.5 w-3.5 text-sky-400 shrink-0" />;
      default:
        return <MinusCircle className="h-3.5 w-3.5 text-slate-500 shrink-0" />;
    }
  };

  const getStorageIcon = (st: string) => {
    switch (st.toLowerCase()) {
      case "archived":
        return <Archive className="h-3.5 w-3.5 text-sky-400 shrink-0" />;
      case "deleted":
        return <Trash2 className="h-3.5 w-3.5 text-rose-400 shrink-0" />;
      default:
        return <Folder className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
    }
  };

  return (
    <div className="w-full bg-[#0a0c14] border-b border-[#1f2335]/80 px-4 py-1.5 text-xs font-mono select-none flex flex-col shrink-0 relative z-10 backdrop-blur-md shadow-sm">
      
      <div className="flex items-center justify-between gap-2 relative" ref={dropdownRef}>
        
        <div className="flex items-center gap-2 flex-wrap relative">
          
          <Sliders className="h-3.5 w-3.5 text-indigo-400 shrink-0" />

          <div
            className="flex items-center px-2 py-1 rounded-lg bg-[#141624] border border-[#1f2335] cursor-default shadow-xs"
            title={`Note Type: ${currentType === "daily" ? "Daily Note" : currentType.charAt(0).toUpperCase() + currentType.slice(1)}`}
          >
            {activeFile ? getFileIcon(activeFile, noteCache, { className: "h-3.5 w-3.5 shrink-0" }) : getTypeIcon(currentType)}
          </div>

          <span className="text-slate-700 font-sans">·</span>

          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpenDropdown(openDropdown === "status" ? null : "status");
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#141624] border border-[#1f2335] hover:border-purple-500/50 hover:bg-[#1a1d2e] transition-all cursor-pointer shadow-xs"
              title={`Status: ${currentStatus.toUpperCase()} (Click to change)`}
            >
              {getStatusIcon(currentStatus)}
              <ChevronDown className="h-2.5 w-2.5 text-slate-500" />
            </button>

            {openDropdown === "status" && (
              <div className="absolute left-0 top-full mt-1.5 z-[200] w-44 bg-[#121422] border border-[#24283b] rounded-xl p-1 shadow-2xl backdrop-blur-xl text-xs animate-in fade-in duration-150">
                <div className="px-2 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider">Board Status</div>
                {[
                  { value: "none", label: "None" },
                  { value: "backlog", label: "Backlog" },
                  { value: "todo", label: "Todo" },
                  { value: "in-progress", label: "In Progress" },
                  { value: "in-review", label: "In Review" },
                  { value: "done", label: "Done" },
                ].map((st) => (
                  <button
                    key={st.value}
                    type="button"
                    onClick={() => handleUpdateFrontmatter({ status: st.value })}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between text-xs font-semibold cursor-pointer ${
                      currentStatus === st.value ? "bg-indigo-600/30 text-indigo-300 font-extrabold" : "hover:bg-[#1a1d2e] text-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {getStatusIcon(st.value)}
                      <span>{st.label}</span>
                    </div>
                    {currentStatus === st.value && <Check className="h-3 w-3 text-indigo-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="text-slate-700 font-sans">·</span>

          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpenDropdown(openDropdown === "priority" ? null : "priority");
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#141624] border border-[#1f2335] hover:border-amber-500/50 hover:bg-[#1a1d2e] transition-all cursor-pointer shadow-xs"
              title={`Priority: ${currentPriority.toUpperCase()} (Click to change)`}
            >
              {getPriorityIcon(currentPriority)}
              <ChevronDown className="h-2.5 w-2.5 text-slate-500" />
            </button>

            {openDropdown === "priority" && (
              <div className="absolute left-0 top-full mt-1.5 z-[200] w-36 bg-[#121422] border border-[#24283b] rounded-xl p-1 shadow-2xl backdrop-blur-xl text-xs animate-in fade-in duration-150">
                <div className="px-2 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider">Set Priority</div>
                {[
                  { value: "high", label: "High" },
                  { value: "medium", label: "Medium" },
                  { value: "low", label: "Low" },
                  { value: "none", label: "None" },
                ].map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => handleUpdateFrontmatter({ priority: p.value })}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between text-xs font-semibold cursor-pointer ${
                      currentPriority === p.value ? "bg-indigo-600/30 text-indigo-300 font-extrabold" : "hover:bg-[#1a1d2e] text-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {getPriorityIcon(p.value)}
                      <span>{p.label}</span>
                    </div>
                    {currentPriority === p.value && <Check className="h-3 w-3 text-indigo-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="text-slate-700 font-sans">·</span>

          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpenDropdown(openDropdown === "due" ? null : "due");
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#141624] border border-[#1f2335] hover:border-emerald-500/50 hover:bg-[#1a1d2e] transition-all cursor-pointer shadow-xs"
              title={`Due Date: ${currentDue || "None"} (Click to set/clear)`}
            >
              <Calendar className={`h-3.5 w-3.5 ${currentDue ? "text-emerald-400" : "text-slate-500"}`} />
              <ChevronDown className="h-2.5 w-2.5 text-slate-500" />
            </button>

            {openDropdown === "due" && (
              <div className="absolute left-0 top-full mt-1.5 z-[200] p-3 bg-[#121422] border border-[#24283b] rounded-xl shadow-2xl backdrop-blur-xl text-xs flex flex-col gap-2.5 w-60 animate-in fade-in duration-150">
                <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Select Due Date & Time</div>
                
                <div className="flex flex-col gap-1">
                  <label className="text-[9.5px] font-semibold text-slate-400">Date</label>
                  <input
                    type="date"
                    value={dueDatePart}
                    onChange={(e) => {
                      const newDate = e.target.value;
                      if (!newDate) {
                        handleUpdateFrontmatter({ due: "" }, false);
                      } else {
                        const newDue = dueTimePart ? `${newDate} ${dueTimePart}` : newDate;
                        handleUpdateFrontmatter({ due: newDue }, false);
                      }
                    }}
                    className="bg-[#1a1d2d] border border-[#2a2e45] rounded-lg px-2.5 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-indigo-500 cursor-pointer"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[9.5px] font-semibold text-slate-400">Time (Optional)</label>
                    {dueTimePart && (
                      <button
                        type="button"
                        onClick={() => handleUpdateFrontmatter({ due: dueDatePart }, false)}
                        className="text-[9px] text-slate-400 hover:text-slate-200 cursor-pointer"
                      >
                        Clear Time
                      </button>
                    )}
                  </div>
                  <input
                    type="time"
                    value={dueTimePart}
                    onChange={(e) => {
                      const newTime = e.target.value;
                      const date = dueDatePart || new Date().toISOString().split("T")[0];
                      if (!newTime) {
                        handleUpdateFrontmatter({ due: date }, false);
                      } else {
                        handleUpdateFrontmatter({ due: `${date} ${newTime}` }, false);
                      }
                    }}
                    className="bg-[#1a1d2d] border border-[#2a2e45] rounded-lg px-2.5 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-indigo-500 cursor-pointer"
                  />
                </div>

                {currentDue && (
                  <div className="flex items-center justify-between pt-2 border-t border-[#1f2335]">
                    <span className="text-[9.5px] font-mono text-slate-400 truncate max-w-[120px]">
                      {currentDue}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleUpdateFrontmatter({ due: "" }, true)}
                      className="text-[10px] text-rose-400 hover:text-rose-300 font-semibold cursor-pointer"
                    >
                      Clear Due Date
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <span className="text-slate-700 font-sans">·</span>



          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpenDropdown(openDropdown === "storage" ? null : "storage");
              }}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#141624] border border-[#1f2335] hover:border-sky-500/50 hover:bg-[#1a1d2e] transition-all cursor-pointer shadow-xs"
              title={`Storage State: ${currentStorage.toUpperCase()} (Click to change)`}
            >
              {getStorageIcon(currentStorage)}
              <ChevronDown className="h-2.5 w-2.5 text-slate-500" />
            </button>

            {openDropdown === "storage" && (
              <div className="absolute left-0 top-full mt-1.5 z-[200] w-40 bg-[#121422] border border-[#24283b] rounded-xl p-1 shadow-2xl backdrop-blur-xl text-xs animate-in fade-in duration-150">
                <div className="px-2 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider">Storage State</div>
                {[
                  { value: "active", label: "Active" },
                  { value: "archived", label: "Archived" },
                  { value: "deleted", label: "Deleted" },
                ].map((st) => (
                  <button
                    key={st.value}
                    type="button"
                    onClick={() => handleUpdateFrontmatter({ storage: st.value })}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between text-xs font-semibold cursor-pointer ${
                      currentStorage === st.value ? "bg-indigo-600/30 text-indigo-300 font-extrabold" : "hover:bg-[#1a1d2e] text-slate-300"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {getStorageIcon(st.value)}
                      <span>{st.label}</span>
                    </div>
                    {currentStorage === st.value && <Check className="h-3 w-3 text-indigo-400" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          <span className="text-slate-700 font-sans">·</span>

          <button
            type="button"
            onClick={() => handleUpdateFrontmatter({ bookmarked: currentBookmarked === "yes" ? "no" : "yes" })}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#141624] border border-[#1f2335] hover:border-amber-500/50 hover:bg-[#1a1d2e] transition-all cursor-pointer shadow-xs"
            title={currentBookmarked === "yes" ? "Bookmarked: YES (Click to remove bookmark)" : "Bookmarked: NO (Click to bookmark note)"}
          >
            {currentBookmarked === "yes" ? (
              <Bookmark className="h-3.5 w-3.5 text-amber-400 fill-amber-400/30" />
            ) : (
              <Bookmark className="h-3.5 w-3.5 text-slate-500 hover:text-amber-400/70" />
            )}
          </button>

        </div>

        <button
          type="button"
          onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
          className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-indigo-300 transition-colors cursor-pointer shrink-0 ml-3 group"
          title="Toggle Note Details & Metadata Inspector"
        >
          <span>Details</span>
          <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-200 ${isDetailsExpanded ? "rotate-90 text-indigo-400" : "text-slate-500 group-hover:text-indigo-300"}`} />
        </button>

      </div>

      {/* Expanded Read-Only & Auto-Calculated Details Panel */}
      {isDetailsExpanded && (
        <div className="mt-2.5 pt-2.5 border-t border-[#1f2335] grid grid-cols-1 sm:grid-cols-3 gap-2 text-[10px] animate-in fade-in duration-200">
          
          <div className="bg-[#0e101b] border border-[#1f2335] p-2 rounded-lg flex flex-col">
            <span className="text-slate-500 flex items-center gap-1 font-sans text-[9px] uppercase tracking-wider mb-0.5">
              <Clock className="h-2.5 w-2.5 text-indigo-400" /> Created Timestamp
            </span>
            <span className="text-slate-200 font-mono font-bold truncate">
              {fields.created || "Not recorded"}
            </span>
          </div>

          <div className="bg-[#0e101b] border border-[#1f2335] p-2 rounded-lg flex flex-col">
            <span className="text-slate-500 flex items-center gap-1 font-sans text-[9px] uppercase tracking-wider mb-0.5">
              <Clock className="h-2.5 w-2.5 text-cyan-400" /> Updated Timestamp
            </span>
            <span className="text-slate-200 font-mono font-bold truncate">
              {fields.updated || "Not recorded"}
            </span>
          </div>

          <div className="bg-[#0e101b] border border-[#1f2335] p-2 rounded-lg flex flex-col">
            <span className="text-slate-500 flex items-center gap-1 font-sans text-[9px] uppercase tracking-wider mb-0.5">
              <User className="h-2.5 w-2.5 text-amber-400" /> Author / Updater
            </span>
            <span className="text-slate-200 font-mono font-bold truncate">
              Creator: {fields.created_by || "user"} | Updater: {fields.updated_by || "user"}
            </span>
          </div>

          {/* Backlinks & Connections Inspector */}
          {(incomingLinks.length > 0 || outgoingLinks.length > 0 || (fields.mentions && fields.mentions.length > 0)) && (
            <div className="col-span-1 sm:col-span-3 bg-[#0e101b] border border-[#1f2335] p-2.5 rounded-lg flex flex-col gap-2 mt-1">
              {/* Incoming Backlinks */}
              {incomingLinks.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-slate-400 flex items-center gap-1 font-sans text-[9px] font-bold uppercase tracking-wider">
                    <Link2 className="h-3 w-3 text-sky-400" /> Incoming Backlinks ({incomingLinks.length})
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {incomingLinks.map((m, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleOpenNote(m)}
                        className="bg-sky-950/80 border border-sky-500/30 text-sky-300 hover:bg-sky-500/20 hover:text-white px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer"
                        title={`Open [[${m}]]`}
                      >
                        [[{m}]]
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Outgoing Links */}
              {outgoingLinks.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-slate-400 flex items-center gap-1 font-sans text-[9px] font-bold uppercase tracking-wider">
                    <Link2 className="h-3 w-3 text-cyan-400" /> Outgoing Links ({outgoingLinks.length})
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {outgoingLinks.map((m, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleOpenNote(m)}
                        className="bg-cyan-950/80 border border-cyan-500/30 text-cyan-200 hover:bg-cyan-500/20 hover:text-white px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer"
                        title={`Open [[${m}]]`}
                      >
                        [[{m}]]
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      )}

    </div>
  );
};
