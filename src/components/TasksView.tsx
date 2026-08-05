import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useVault } from "../contexts/VaultContext";
import { useSettings } from "../contexts/SettingsContext";
import { useSync } from "../contexts/SyncContext";
import { isModKey } from "../lib/keyboard-utils";
import { 
  toggleTaskInNote, 
  updateTaskPriorityInNote,
  ScannedTask,
  getAllMarkdownFiles,
  isArchivedPath,
  isTrashPath
} from "../lib/task-scanner";

import { DAILY_NOTES_FOLDER } from "../contexts/VaultContext";
import { ensureAndSyncFrontmatter, getZonedDateParts } from "../lib/frontmatter";
import { 
  CheckSquare, 
  Calendar, 
  Hash, 
  Search, 
  Check, 
  Plus, 
  FileText,
  Edit,
  X,
  Layers,
  ArrowUpDown,
  Trash2,
  RefreshCw,
  Sparkles,
  Inbox,
  AlertCircle,
  AlertTriangle,
  Info,
  MinusCircle,
  Tag,
  CheckCircle2,
  ChevronDown,
  CalendarDays,
  Columns,
  LayoutGrid
} from "lucide-react";
import { invokeIPC } from "../lib/ipc";
import { searchEngine } from "../lib/search-engine";

// Helper for local date string formatting
function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
function addDays(date: Date, days: number): Date {
  const d = new Date(date); d.setDate(d.getDate()+days); return d;
}

/** Returns a friendly label for a YYYY-MM-DD date string. */
function formatDueDate(dateStr: string, todayStr: string, tomorrowStr: string): string {
  if (!dateStr) return "";
  const cleanDateStr = dateStr.trim().split(/[ T]/)[0];
  if (cleanDateStr === todayStr) return "Today";
  if (cleanDateStr === tomorrowStr) return "Tomorrow";
  
  const parts = cleanDateStr.split("-").map(Number);
  if (parts.length < 3) return cleanDateStr;
  const [y, m, d] = parts;
  if (!y || isNaN(y) || !m || isNaN(m) || !d || isNaN(d)) return cleanDateStr;

  const date = new Date(y, m - 1, d);
  if (isNaN(date.getTime())) return cleanDateStr;

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = date.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return `${monthNames[date.getMonth()]} ${d}`;
  if (diffDays <= 6) return `${dayNames[date.getDay()]}, ${monthNames[date.getMonth()]} ${d}`;
  return `${monthNames[date.getMonth()]} ${d}, ${y}`;
}

export const TasksView: React.FC = () => {
  const { files, noteCache, openNoteByName, refreshFiles, triggerNotesScan, updateNoteCache } = useVault();
  const { vaultPath, includeArchivedInScans, userTimezone } = useSettings();

  // Compute tasks list from central note cache respecting archive & trash scan settings
  const tasks = useMemo<ScannedTask[]>(() => {
    return Object.values(noteCache)
      .flatMap((data) => data.tasks)
      .filter((t) => {
        const isArchived = isArchivedPath(t.notePath) || noteCache[t.notePath]?.meta?.storage === "archived";
        const isDeleted = isTrashPath(t.notePath) || noteCache[t.notePath]?.meta?.storage === "deleted";

        if (!includeArchivedInScans && isArchived) return false;
        if (isDeleted) return false;
        return true;
      });
  }, [noteCache, includeArchivedInScans]);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"pending" | "completed" | "due">("pending");
  const [loading, setLoading] = useState(false);

  // Grouping & Sorting
  const [groupBy, setGroupBy] = useState<"none" | "note" | "dueDate" | "priority">("none");
  const [sortBy, setSortBy] = useState<"dueDate" | "priority" | "noteName">("priority");

  // Collapsed status of note groups
  const [collapsedGroups, setCollapsedGroups] = useState<{ [key: string]: boolean }>({});

  // Batch selection
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);

  // Task Editing state
  const [editingTask, setEditingTask] = useState<ScannedTask | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editPriority, setEditPriority] = useState<"high" | "medium" | "low" | "none">("none");

  // All markdown files for target note selection
  const allNotes = useMemo(() => {
    return getAllMarkdownFiles(files).sort((a, b) => a.name.localeCompare(b.name));
  }, [files]);

  // Quick-Add form state
  const [isNotePickerOpen, setIsNotePickerOpen] = useState(false);
  const [pickerSearchQuery, setPickerSearchQuery] = useState("");
  const [newTaskText, setNewTaskText] = useState("");
  const [newTaskDate, setNewTaskDate] = useState("");
  const [newTaskTime, setNewTaskTime] = useState("");
  const [newTaskTag, setNewTaskTag] = useState("");
  const [newTaskPriority, setNewTaskPriority] = useState<"high" | "medium" | "low" | "none">("none");

  const { registerSyncHandler, unregisterSyncHandler } = useSync();

  const todayStr = toLocalDateStr(new Date());
  const tomorrowStr = toLocalDateStr(addDays(new Date(), 1));

  const refreshTasks = useCallback(async () => {
    await triggerNotesScan();
  }, [triggerNotesScan]);

  // Register as global sync step and scan on mount
  useEffect(() => {
    triggerNotesScan();
    registerSyncHandler("tasks-scan", refreshTasks, "Sync tasks & to-dos");
    return () => unregisterSyncHandler("tasks-scan");
  }, [registerSyncHandler, unregisterSyncHandler, refreshTasks, triggerNotesScan]);

  const [viewLayout, setViewLayout] = useState<"list" | "kanban">("list");
  const [focusedTaskIndex, setFocusedTaskIndex] = useState<number>(0);

  // Task toggler
  const handleToggle = async (task: ScannedTask) => {
    try {
      const updatedContent = await toggleTaskInNote(task);
      if (updatedContent) {
        updateNoteCache(task.notePath, updatedContent);
        await searchEngine.indexFile(task.notePath, updatedContent).catch(() => {});
      }
    } catch (e) {
      alert("Failed to update task status in markdown file.");
    }
  };



  // Priority quick-cycle on pill click
  const handlePriorityCycle = async (task: ScannedTask, e: React.MouseEvent) => {
    e.stopPropagation();
    const nextMap: Record<string, "high" | "medium" | "low" | "none"> = {
      none: "low",
      low: "medium",
      medium: "high",
      high: "none",
    };
    const nextPriority = nextMap[task.priority || "none"];
    try {
      const updatedContent = await updateTaskPriorityInNote(task, nextPriority);
      if (updatedContent) {
        updateNoteCache(task.notePath, updatedContent);
        await searchEngine.indexFile(task.notePath, updatedContent).catch(() => {});
      }
    } catch (err) {
      console.error("Failed to update priority:", err);
    }
  };


  // Quick Add Trigger
  const handleQuickAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskText.trim()) return;
    setPickerSearchQuery("");
    setIsNotePickerOpen(true);
  };

  const executeQuickAdd = async (destPath: string) => {
    if (!newTaskText.trim()) return;

    let taskToken = "";
    if (newTaskPriority === "high") taskToken = "!!!";
    else if (newTaskPriority === "medium") taskToken = "!!";
    else if (newTaskPriority === "low") taskToken = "!";

    let formattedText = newTaskText
      .replace(/@task(!*)/gi, "")
      .replace(/(?:\b|\s|^)!{1,3}(?:\b|\s|$)/g, " ")
      .trim();

    if (taskToken) {
      formattedText += ` ${taskToken}`;
    }

    let taskLine = `- [ ] ${formattedText}`;
    if (newTaskDate) {
      taskLine += ` @${newTaskDate}`;
      if (newTaskTime) taskLine += ` ${newTaskTime}`;
    } else if (newTaskTime) {
      taskLine += ` @${todayStr} ${newTaskTime}`;
    }

    if (newTaskTag) {
      const cleanTag = newTaskTag.startsWith("#") ? newTaskTag : `#${newTaskTag}`;
      taskLine += ` ${cleanTag}`;
    }

    try {
      let finalPath = destPath;
      if (destPath === "daily") {
        const separator = vaultPath?.includes("\\") ? "\\" : "/";
        const dailyNotesFolderPath = `${vaultPath}${separator}${DAILY_NOTES_FOLDER}`;
        finalPath = `${dailyNotesFolderPath}${separator}${todayStr}.md`;

        const folderExists = await invokeIPC("fs_exists", { path: dailyNotesFolderPath }).catch(() => false);
        if (!folderExists) {
          await invokeIPC("create_folder", { path: dailyNotesFolderPath });
        }
      }

      let fileContent = "";
      const fileExists = await invokeIPC("fs_exists", { path: finalPath }).catch(() => false);
      if (fileExists) {
        fileContent = ((await invokeIPC("read_note", {
          path: finalPath,
        })) as string) || "";
      }

      const separatorNewline = fileContent ? "\n" : "";
      const rawNewContent = `${fileContent}${separatorNewline}${taskLine}`;
      const { fullContent: updatedContent } = ensureAndSyncFrontmatter(rawNewContent, {
        forceUpdateTimestamp: true,
      });

      await invokeIPC("write_note", {
        path: finalPath,
        content: updatedContent,
      });

      updateNoteCache(finalPath, updatedContent);
      searchEngine.indexFile(finalPath, updatedContent).catch(() => {});

      setNewTaskText("");
      setNewTaskDate("");
      setNewTaskTime("");
      setNewTaskTag("");
      setNewTaskPriority("none");
      setIsNotePickerOpen(false);

      await refreshFiles();
      await refreshTasks();
    } catch (err: any) {
      console.error("Quick log task failed:", err);
      alert("Failed to log task: " + (err.message || err));
    }
  };

  // Edit task setup
  const startEdit = (task: ScannedTask) => {
    setEditingTask(task);
    setEditContent(task.content);
    setEditDate(task.dueDate || "");
    setEditTime((task as any).dueTime || "");
    setEditTags(task.tags.map(t => `#${t}`).join(" "));
    setEditPriority(task.priority || "none");
  };

  const saveTaskEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTask) return;

    try {
      const fileContent = (await invokeIPC("read_note", {
        path: editingTask.notePath,
      })) as string;

      const lines = fileContent.split(/\r?\n/);
      let targetIndex = editingTask.lineNumber;

      const checkboxRegex = /^\s*[-*]\s*\[([ xX])\]\s+(.+)$/;
      const cleanForMatching = (str: string) => str.toLowerCase().replace(/@task(!*)/gi, "").replace(/(?:@due:?|@|due:\s*)?20\d{2}[-/]\d{2}[-/]\d{2}(?:T[^\s]+|[ T]\d{2}:\d{2})?/gi, "").replace(/#([a-zA-Z0-9_\-\/]+)/g, "").replace(/\s+/g, " ").trim();

      const isValidLine = (idx: number): boolean => {
        if (idx < 0 || idx >= lines.length) return false;
        const m = lines[idx].match(checkboxRegex);
        if (!m) return false;
        const cleanedLine = cleanForMatching(m[2]);
        const cleanedTask = cleanForMatching(editingTask.content);
        if (!cleanedTask) return true;
        return cleanedLine.includes(cleanedTask) || cleanedTask.includes(cleanedLine);
      };

      if (!isValidLine(targetIndex)) {
        const foundIdx = lines.findIndex((l) => {
          const m = l.match(checkboxRegex);
          if (!m) return false;
          const cleanedLine = cleanForMatching(m[2]);
          const cleanedTask = cleanForMatching(editingTask.content);
          if (!cleanedTask) return false;
          return cleanedLine.includes(cleanedTask) || cleanedTask.includes(cleanedLine);
        });
        if (foundIdx !== -1) {
          targetIndex = foundIdx;
        }
      }

      if (targetIndex < 0 || targetIndex >= lines.length) return;
      const line = lines[targetIndex];

      const indentMatch = line.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : "";
      
      let cleanEditContent = editContent
        .replace(/@task(!*)/gi, "")
        .replace(/(?:\b|\s|^)!{1,3}(?:\b|\s|$)/g, " ")
        .trim();
      let taskToken = "";
      if (editPriority === "high") taskToken = "!!!";
      else if (editPriority === "medium") taskToken = "!!";
      else if (editPriority === "low") taskToken = "!";

      if (taskToken) {
        cleanEditContent += ` ${taskToken}`;
      }

      let newLine = `${indent}- [${editingTask.completed ? "x" : " "}] ${cleanEditContent}`;
      if (editDate) {
        newLine += ` @${editDate}`;
        if (editTime) newLine += ` ${editTime}`;
      }
      
      const tagsArray = editTags
        .split(/\s+/)
        .map(t => t.trim())
        .filter(t => t.length > 0)
        .map(t => t.startsWith("#") ? t : `#${t}`);
        
      if (tagsArray.length > 0) newLine += " " + tagsArray.join(" ");

      lines[targetIndex] = newLine;
      const rawContent = lines.join("\n");
      const { fullContent: updatedContent } = ensureAndSyncFrontmatter(rawContent, {
        forceUpdateTimestamp: true,
      });

      await invokeIPC("write_note", {
        path: editingTask.notePath,
        content: updatedContent,
      });

      updateNoteCache(editingTask.notePath, updatedContent);
      searchEngine.indexFile(editingTask.notePath, updatedContent).catch(() => {});
      setEditingTask(null);
    } catch (err: any) {
      console.error("Failed to save task edit:", err);
      alert("Failed to save task changes: " + err.message);
    }
  };

  // ⚡ Roll forward pending tasks from old daily notes to today's daily note
  const handleRollForward = async () => {
    if (!vaultPath) return;
    setLoading(true);
    try {
      const allMdFiles = getAllMarkdownFiles(files);
      const dailyNoteRegex = /^(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\.md$/;
      
      const oldDailyNotes = allMdFiles.filter((f: any) => {
        const isDaily = f.path.replace(/\\/g, "/").includes(`/${DAILY_NOTES_FOLDER}/`);
        const matchesFormat = dailyNoteRegex.test(f.name);
        const isBeforeToday = f.name.replace(".md", "") < todayStr;
        return isDaily && matchesFormat && isBeforeToday;
      });

      let rolledCount = 0;
      const newTasksLines: string[] = [];

      for (const note of oldDailyNotes) {
        const content = await invokeIPC("read_note", { path: note.path }) as string;
        if (!content) continue;

        const lines = content.split(/\r?\n/);
        let updated = false;
        const checkboxRegex = /^(\s*[-*]\s*\[)( )(\]\s+.+)$/;

        for (let idx = 0; idx < lines.length; idx++) {
          const line = lines[idx];
          const match = line.match(checkboxRegex);
          if (match) {
            const taskContent = match[3];
            newTasksLines.push(`- [ ] ${taskContent.trim()}`);
            // Bujo style migrated task bullet: [>]
            lines[idx] = line.replace(/([-*]\s*\[)( )(\])/, "$1>$3");
            updated = true;
            rolledCount++;
          }
        }

        if (updated) {
          await invokeIPC("write_note", {
            path: note.path,
            content: lines.join("\n"),
          });
        }
      }

      if (rolledCount > 0 && newTasksLines.length > 0) {
        const separator = vaultPath.includes("\\") ? "\\" : "/";
        const dailyNotesFolderPath = `${vaultPath}${separator}${DAILY_NOTES_FOLDER}`;
        const todayNotePath = `${dailyNotesFolderPath}${separator}${todayStr}.md`;

        let todayContent = "";
        const exists = await invokeIPC("fs_exists", { path: todayNotePath });
        if (exists) {
          todayContent = await invokeIPC("read_note", { path: todayNotePath }) as string;
        } else {
          const folderExists = await invokeIPC("fs_exists", { path: dailyNotesFolderPath }).catch(() => false);
          if (!folderExists) {
            await invokeIPC("create_folder", { path: dailyNotesFolderPath });
          }
        }

        const spacer = todayContent ? "\n" : "";
        const updatedTodayContent = `${todayContent}${spacer}${newTasksLines.join("\n")}`;

        await invokeIPC("write_note", {
          path: todayNotePath,
          content: updatedTodayContent,
        });

        alert(`Successfully rolled forward ${rolledCount} pending task(s) to today's daily note (${todayStr}.md).`);
        await refreshFiles();
        await refreshTasks();
      } else {
        alert("No pending daily note tasks found to roll forward.");
      }
    } catch (e) {
      console.error("Roll forward failed:", e);
      alert("Failed to roll forward tasks.");
    } finally {
      setLoading(false);
    }
  };

  // Due Date Grouping
  const getDueDateGroup = (dueDate?: string): string => {
    if (!dueDate) return "No Due Date";
    if (dueDate < todayStr) return "Overdue";
    if (dueDate === todayStr) return "Today";
    if (dueDate === tomorrowStr) return "Tomorrow";
    return "Upcoming";
  };

  // Filter Tasks
  const getFilteredTasks = () => {
    return tasks.filter((t: ScannedTask) => {
      // 1. Status Filter
      if (activeTab === "pending" && t.completed) return false;
      if (activeTab === "completed" && !t.completed) return false;
      if (activeTab === "due" && (t.completed || !t.dueDate)) return false;

      // 2. Search Query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesContent = t.content.toLowerCase().includes(query);
        const matchesNote = t.noteName.toLowerCase().includes(query);
        if (!matchesContent && !matchesNote) return false;
      }

      // 3. Tag Filter
      if (selectedTag) {
        if (!t.tags.includes(selectedTag)) return false;
      }

      return true;
    });
  };

  // Sort Tasks
  const getSortedTasks = (list: ScannedTask[]) => {
    return [...list].sort((a, b) => {
      if (sortBy === "dueDate") {
        return (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31");
      }
      if (sortBy === "priority") {
        const pMap: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 };
        return (pMap[a.priority || "none"] ?? 3) - (pMap[b.priority || "none"] ?? 3);
      }
      return a.noteName.localeCompare(b.noteName);
    });
  };

  // Group Tasks
  const getGroupedTasks = (list: ScannedTask[]) => {
    const sorted = getSortedTasks(list);
    const groups: { [key: string]: ScannedTask[] } = {};

    if (groupBy === "none") {
      groups["All Tasks"] = sorted;
    } else if (groupBy === "note") {
      sorted.forEach(t => {
        if (!groups[t.noteName]) groups[t.noteName] = [];
        groups[t.noteName].push(t);
      });
    } else if (groupBy === "priority") {
      groups["🔥 High Priority (!!!)"] = [];
      groups["⚡ Medium Priority (!!)"] = [];
      groups["💤 Low Priority (!)"] = [];
      groups["⚪ Normal Priority (None)"] = [];
      sorted.forEach(t => {
        const p = t.priority || "none";
        if (p === "high") groups["🔥 High Priority (!!!)"].push(t);
        else if (p === "medium") groups["⚡ Medium Priority (!!)"].push(t);
        else if (p === "low") groups["💤 Low Priority (!)"].push(t);
        else groups["⚪ Normal Priority (None)"].push(t);
      });
      // Delete empty categories
      Object.keys(groups).forEach(k => {
        if (groups[k].length === 0) delete groups[k];
      });
    } else if (groupBy === "dueDate") {
      groups["⚠️ Overdue"] = [];
      groups["📅 Today"] = [];
      groups["🌅 Tomorrow"] = [];
      groups["🗓️ Upcoming"] = [];
      groups["📂 No Due Date"] = [];
      sorted.forEach(t => {
        const g = getDueDateGroup(t.dueDate);
        if (g === "Overdue") groups["⚠️ Overdue"].push(t);
        else if (g === "Today") groups["📅 Today"].push(t);
        else if (g === "Tomorrow") groups["🌅 Tomorrow"].push(t);
        else if (g === "Upcoming") groups["🗓️ Upcoming"].push(t);
        else groups["📂 No Due Date"].push(t);
      });
      // Delete empty
      Object.keys(groups).forEach(k => {
        if (groups[k].length === 0) delete groups[k];
      });
    }

    return Object.entries(groups);
  };

  // Tags aggregation
  const getAllTags = () => {
    const tagsMap: { [key: string]: number } = {};
    tasks.forEach((t: ScannedTask) => {
      t.tags.forEach((tag: string) => {
        tagsMap[tag] = (tagsMap[tag] || 0) + 1;
      });
    });
    return Object.entries(tagsMap);
  };

  // Bulk Operations
  const handleBatchToggle = async (complete: boolean) => {
    setLoading(true);
    for (const taskId of selectedTaskIds) {
      const task = tasks.find((t: ScannedTask) => t.id === taskId);
      if (task && task.completed !== complete) {
        try {
          await toggleTaskInNote(task);
        } catch (e) {
          console.error("Batch toggle error:", e);
        }
      }
    }
    setSelectedTaskIds([]);
    await refreshFiles();
    await refreshTasks();
    setLoading(false);
  };

  const handleBatchDelete = async () => {
    if (!confirm(`Are you sure you want to delete the ${selectedTaskIds.length} selected tasks from their respective notes?`)) return;
    setLoading(true);
    const tasksByNote: { [path: string]: ScannedTask[] } = {};
    for (const taskId of selectedTaskIds) {
      const task = tasks.find((t: ScannedTask) => t.id === taskId);
      if (task) {
        if (!tasksByNote[task.notePath]) tasksByNote[task.notePath] = [];
        tasksByNote[task.notePath].push(task);
      }
    }

    for (const [notePath, noteTasks] of Object.entries(tasksByNote)) {
      try {
        const text = await invokeIPC("read_note", { path: notePath }) as string;
        if (!text) continue;
        const lines = text.split(/\r?\n/);
        const sortedTasks = [...noteTasks].sort((a,b) => b.lineNumber - a.lineNumber);
        for (const t of sortedTasks) {
          if (t.lineNumber < lines.length) {
            lines.splice(t.lineNumber, 1);
          }
        }
        await invokeIPC("write_note", {
          path: notePath,
          content: lines.join("\n"),
        });
      } catch (err) {
        console.error(`Failed to delete tasks:`, err);
      }
    }
    setSelectedTaskIds([]);
    await refreshFiles();
    await refreshTasks();
    setLoading(false);
  };

  const toggleSelectAll = (filteredList: ScannedTask[]) => {
    const listIds = filteredList.map(t => t.id);
    const allSelected = listIds.every(id => selectedTaskIds.includes(id));
    if (allSelected) {
      setSelectedTaskIds(prev => prev.filter(id => !listIds.includes(id)));
    } else {
      setSelectedTaskIds(prev => Array.from(new Set([...prev, ...listIds])));
    }
  };

  const filteredTasks = getFilteredTasks();
  const groupedTasks = getGroupedTasks(filteredTasks);
  const flatVisualTasks = useMemo(() => groupedTasks.flatMap(([_, list]) => list), [groupedTasks]);
  const allTags = getAllTags();

  // Keyboard navigation & selection shortcuts listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const tag = activeEl?.tagName?.toLowerCase();
      const isInputActive = tag === "input" || tag === "textarea" || tag === "select" || (activeEl as HTMLElement)?.isContentEditable;
      
      if (isInputActive || editingTask || isNotePickerOpen) {
        return;
      }

      const list = flatVisualTasks;
      if (list.length === 0) return;

      if (e.key === "ArrowDown" || e.key === "j" || e.key === "ArrowRight") {
        e.preventDefault();
        setFocusedTaskIndex((prev) => Math.min(prev + 1, list.length - 1));
      } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "ArrowLeft") {
        e.preventDefault();
        setFocusedTaskIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === " " || e.key === "x") {
        e.preventDefault();
        const task = list[focusedTaskIndex];
        if (task) {
          setSelectedTaskIds((prev) =>
            prev.includes(task.id) ? prev.filter((id) => id !== task.id) : [...prev, task.id]
          );
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        const task = list[focusedTaskIndex];
        if (task) {
          handleToggle(task);
        }
      } else if (isModKey(e) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelectedTaskIds(list.map((t) => t.id));
      } else if (e.key === "Escape") {
        e.preventDefault();
        setSelectedTaskIds([]);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedTaskIds.length > 0) {
          e.preventDefault();
          handleBatchDelete();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [flatVisualTasks, focusedTaskIndex, selectedTaskIds, editingTask, isNotePickerOpen]);

  // Statistics counters
  const totalCount = tasks.length;
  const completedCount = tasks.filter((t: ScannedTask) => t.completed).length;
  const pendingCount = totalCount - completedCount;
  const percentComplete = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  
  const overdueCount = tasks.filter((t: ScannedTask) => !t.completed && t.dueDate && t.dueDate < todayStr).length;
  const dueTodayCount = tasks.filter((t: ScannedTask) => !t.completed && t.dueDate === todayStr).length;
  const dueWeekCount = tasks.filter((t: ScannedTask) => {
    if (t.completed || !t.dueDate) return false;
    const limit = toLocalDateStr(addDays(new Date(), 7));
    return t.dueDate >= todayStr && t.dueDate <= limit;
  }).length;

  return (
    <div className="flex h-full w-full bg-background text-foreground select-none overflow-hidden">
      
      {/* ══ SIDEBAR ═══════════════════════════════════════════════════════════ */}
      <div className="w-72 border-r border-card-border bg-sidebar flex flex-col shrink-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-6 p-4">
          
          {/* Header title */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-emerald-500 dark:text-emerald-400 tracking-widest uppercase flex items-center gap-1.5">
                <CheckSquare className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" /> Task Board
              </span>
              {loading && <RefreshCw className="h-3.5 w-3.5 text-indigo-400 animate-spin" />}
            </div>
            <p className="text-[9.5px] text-slate-500 mt-1 leading-normal">
              Scans checklists (`- [ ]`) across notes in real-time ({(() => {
                try {
                  const targetTz = userTimezone === "auto" ? Intl.DateTimeFormat().resolvedOptions().timeZone : userTimezone;
                  const now = new Date();
                  const parts = new Intl.DateTimeFormat("en-US", { timeZone: targetTz, timeZoneName: "shortOffset" }).formatToParts(now);
                  const tzPart = parts.find(p => p.type === "timeZoneName")?.value || "";
                  let offset = tzPart.replace(/^GMT/, "UTC");
                  if (offset === "UTC") offset = "UTC+00:00";
                  return `${targetTz} - ${offset}`;
                } catch {
                  return userTimezone === "auto" ? "System Timezone" : userTimezone;
                }
              })()}).
            </p>
          </div>

          {/* 📈 Stats & Progress Circle */}
          <div className="flex items-center gap-4 bg-card/40 border border-card-border/60 rounded-xl p-3 shadow-md">
            <div className="relative shrink-0 flex items-center justify-center">
              <svg className="w-14 h-14 transform -rotate-90">
                <circle cx="28" cy="28" r="24" className="stroke-slate-800" strokeWidth="3" fill="transparent" />
                <circle cx="28" cy="28" r="24" className="stroke-indigo-500 transition-all duration-500" strokeWidth="3" fill="transparent"
                  strokeDasharray={2 * Math.PI * 24} strokeDashoffset={2 * Math.PI * 24 * (1 - percentComplete / 100)} />
              </svg>
              <span className="absolute text-[10px] font-extrabold text-foreground">{percentComplete}%</span>
            </div>
            <div className="flex-1 min-w-0 flex flex-col gap-0.5">
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">Overall progress</span>
              <span className="text-xs font-bold text-foreground">{completedCount} of {totalCount} done</span>
              <span className="text-[9.5px] text-slate-500 italic">{pendingCount} remaining</span>
            </div>
          </div>

          {/* Quick Filters Grid */}
          <div className="grid grid-cols-3 gap-1.5">
            <button onClick={() => { setActiveTab("due"); setSelectedTag(null); setSearchQuery(""); }}
              className="flex flex-col items-center bg-card hover:bg-card-hover border border-card-border rounded-lg py-2 transition-colors cursor-pointer">
              <span className="text-[14px] font-extrabold text-red-500 dark:text-red-400">{overdueCount}</span>
              <span className="text-[8px] text-slate-500 font-bold uppercase mt-0.5">Overdue</span>
            </button>
            <button onClick={() => { setActiveTab("pending"); setSelectedTag(null); setSearchQuery(todayStr); }}
              className="flex flex-col items-center bg-card hover:bg-card-hover border border-card-border rounded-lg py-2 transition-colors cursor-pointer">
              <span className="text-[14px] font-extrabold text-amber-500 dark:text-amber-400">{dueTodayCount}</span>
              <span className="text-[8px] text-slate-500 font-bold uppercase mt-0.5">Today</span>
            </button>
            <button onClick={() => { setActiveTab("pending"); setSelectedTag(null); setSearchQuery(""); }}
              className="flex flex-col items-center bg-card hover:bg-card-hover border border-card-border rounded-lg py-2 transition-colors cursor-pointer">
              <span className="text-[14px] font-extrabold text-indigo-500 dark:text-indigo-400">{dueWeekCount}</span>
              <span className="text-[8px] text-slate-500 font-bold uppercase mt-0.5">7 Days</span>
            </button>
          </div>

          {/* ⚡ Roll forward tasks */}
          <div className="flex flex-col gap-2 bg-card border border-card-border rounded-xl p-3 shadow-xs">
            <span className="text-[9px] font-extrabold text-slate-600 dark:text-slate-400 uppercase tracking-widest flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-amber-500 dark:text-amber-400" /> Daily Note Rollover
            </span>
            <p className="text-[9.5px] text-slate-600 dark:text-slate-400 leading-normal font-medium">
              Find pending tasks in older daily notes and move them to today's daily note.
            </p>
            <button
              onClick={handleRollForward}
              disabled={loading}
              className="mt-1 flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 py-1.5 text-[10px] font-bold text-white transition-colors cursor-pointer shadow-sm"
            >
              <Sparkles className="h-3 w-3" />
              <span>Roll Forward Tasks</span>
            </button>
          </div>

          {/* Quick Add Form */}
          <div className="flex flex-col gap-3 border-t border-card-border/70 pt-4">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
              Quick Log Task
            </span>
            <form onSubmit={handleQuickAdd} className="flex flex-col gap-2.5">
              <input
                type="text"
                required
                placeholder="Task description..."
                value={newTaskText}
                onChange={(e) => setNewTaskText(e.target.value)}
                className="rounded-lg bg-background p-2 text-xs text-foreground border border-card-border focus:outline-none focus:border-indigo-500/50 placeholder-slate-400 transition-colors"
              />
              <div className="grid grid-cols-2 gap-1.5">
                <input
                  type="date"
                  value={newTaskDate}
                  onChange={(e) => setNewTaskDate(e.target.value)}
                  className="rounded-lg bg-background p-1.5 text-[10px] text-foreground border border-card-border focus:outline-none focus:border-indigo-500/50 cursor-pointer"
                  title="Due Date"
                />
                <input
                  type="time"
                  value={newTaskTime}
                  onChange={(e) => setNewTaskTime(e.target.value)}
                  className="rounded-lg bg-background p-1.5 text-[10px] text-foreground border border-card-border focus:outline-none focus:border-indigo-500/50 cursor-pointer"
                  title="Due Time"
                />
                <input
                  type="text"
                  placeholder="#tag"
                  value={newTaskTag}
                  onChange={(e) => setNewTaskTag(e.target.value)}
                  className="rounded-lg bg-background p-1.5 text-[10px] text-foreground border border-card-border focus:outline-none focus:border-indigo-500/50 placeholder-slate-400"
                />
                <select
                  value={newTaskPriority}
                  onChange={(e) => setNewTaskPriority(e.target.value as any)}
                  className="rounded-lg bg-background p-1.5 text-[10px] text-slate-700 dark:text-slate-300 border border-card-border focus:outline-none focus:border-indigo-500/50 cursor-pointer"
                >
                  <option value="none">Priority: None</option>
                  <option value="low">! Low</option>
                  <option value="medium">!! Med</option>
                  <option value="high">!!! High</option>
                </select>
              </div>

              <button
                type="submit"
                className="flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 py-2 text-xs font-bold text-white transition-all cursor-pointer shadow shadow-indigo-600/30 active:scale-98"
              >
                <Plus className="h-3.5 w-3.5" />
                Add to Note
              </button>
            </form>
          </div>

          {/* Tags list */}
          <div className="flex flex-col gap-2 border-t border-card-border/70 pt-4">
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
              Tags Filter
            </span>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setSelectedTag(null)}
                className={`px-2 py-0.5 rounded-md text-[10.5px] font-semibold border transition-colors cursor-pointer ${
                  !selectedTag
                    ? "bg-indigo-600 border-indigo-500 text-white"
                    : "bg-card border-card-border text-slate-400 hover:text-slate-200"
                }`}
              >
                All Tags
              </button>
              {allTags.map(([tag, count]) => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                  className={`px-2 py-0.5 rounded-md text-[10.5px] font-semibold border transition-colors flex items-center gap-1 cursor-pointer ${
                    selectedTag === tag
                      ? "bg-indigo-600 border-indigo-500 text-white"
                      : "bg-card border-card-border text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <Hash className="h-2.5 w-2.5" />
                  {tag} <span className="opacity-60 text-[9px]">({count})</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ══ MAIN DISPLAY AREA ═══════════════════════════════════════════════ */}
      <div className="flex-1 h-full flex flex-col bg-background overflow-hidden min-w-0">
        
        {/* ── Toolbar ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 border-b border-card-border px-5 py-3 shrink-0 bg-sidebar backdrop-blur-sm">
          {/* Row 1: Tabs & Layout View Switcher */}
          <div className="flex items-center justify-between gap-3 min-w-0 w-full">
            {/* Tabs */}
            <div className="flex items-center gap-0.5 bg-card p-0.5 rounded-lg border border-card-border shrink-0">
              {["pending", "completed", "due"].map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setActiveTab(tab as any); setSelectedTaskIds([]); }}
                  className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all cursor-pointer capitalize whitespace-nowrap ${
                    activeTab === tab ? "bg-indigo-600 text-white shadow shadow-indigo-600/30" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                  }`}
                >
                  {tab === "due" ? "due soon" : tab}
                </button>
              ))}
            </div>

            {/* Layout Mode Switcher (List vs Kanban Board) */}
            <div className="flex items-center gap-0.5 bg-card p-0.5 rounded-lg border border-card-border shrink-0">
              <button
                type="button"
                onClick={() => setViewLayout("list")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                  viewLayout === "list" ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 shadow-sm" : "text-slate-500 hover:text-slate-300"
                }`}
                title="List View Layout"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
                <span>List</span>
              </button>
              <button
                type="button"
                onClick={() => setViewLayout("kanban")}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-all cursor-pointer ${
                  viewLayout === "kanban" ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 shadow-sm" : "text-slate-500 hover:text-slate-300"
                }`}
                title="Kanban Board View Layout"
              >
                <Columns className="h-3.5 w-3.5" />
                <span>Kanban</span>
              </button>
            </div>
          </div>

          {/* Row 2: Dropdowns, Select All, and Search (Left-aligned, wrapping naturally) */}
          <div className="flex flex-wrap items-center gap-3.5 w-full">
            {/* Group By selector */}
            <div className="flex items-center gap-1.5 text-slate-500">
              <Layers className="h-3.5 w-3.5 text-slate-500 shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Group:</span>
              <div className="relative flex items-center">
                <select
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as any)}
                  className="appearance-none bg-card border border-card-border hover:border-slate-400 dark:hover:border-slate-800 rounded-md pl-2.5 pr-8 py-1 text-slate-700 dark:text-slate-200 text-xs font-semibold focus:outline-none focus:border-indigo-500/50 cursor-pointer transition-colors"
                >
                  <option value="none">Flat List</option>
                  <option value="note">By Note Name</option>
                  <option value="dueDate">By Due Date</option>
                  <option value="priority">By Priority</option>
                </select>
                <ChevronDown className="h-3 w-3 text-slate-500 absolute right-2.5 pointer-events-none" />
              </div>
            </div>

            {/* Sort By selector */}
            <div className="flex items-center gap-1.5 text-slate-500 border-l border-card-border/70 pl-3.5">
              <ArrowUpDown className="h-3.5 w-3.5 text-slate-500 shrink-0" />
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sort:</span>
              <div className="relative flex items-center">
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="appearance-none bg-card border border-card-border hover:border-slate-400 dark:hover:border-slate-800 rounded-md pl-2.5 pr-8 py-1 text-slate-700 dark:text-slate-200 text-xs font-semibold focus:outline-none focus:border-indigo-500/50 cursor-pointer transition-colors"
                >
                  <option value="priority">Priority First</option>
                  <option value="dueDate">Due Date</option>
                  <option value="noteName">Note Name</option>
                </select>
                <ChevronDown className="h-3 w-3 text-slate-500 absolute right-2.5 pointer-events-none" />
              </div>
            </div>

            {/* Select All / Deselect All */}
            {filteredTasks.length > 0 && (
              <div className="flex items-center border-l border-card-border/70 pl-3.5">
                <button
                  onClick={() => toggleSelectAll(filteredTasks)}
                  className="text-[11px] font-bold text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1 rounded-lg border border-indigo-500/20 hover:border-indigo-500/30 transition-all cursor-pointer whitespace-nowrap shrink-0"
                >
                  {filteredTasks.every((t: ScannedTask) => selectedTaskIds.includes(t.id)) ? "Deselect All" : "Select All"}
                </button>
              </div>
            )}

            {/* Keyboard Shortcuts Hint Pill */}
            <div className="hidden lg:flex items-center gap-1.5 border-l border-card-border/70 pl-3.5 text-[10px] font-semibold text-slate-500 select-none">
              <span className="bg-sidebar border border-card-border px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400 font-mono">↑↓ / jk</span>
              <span>Navigate</span>
              <span className="bg-sidebar border border-card-border px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400 font-mono ml-1.5">Space / X</span>
              <span>Select</span>
              <span className="bg-sidebar border border-card-border px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400 font-mono ml-1.5">Enter</span>
              <span>Done</span>
            </div>

            {/* Search (Flexible width, floats to right on larger screens, stacks on narrow screens) */}
            <div className="relative flex-1 max-w-xs min-w-35 sm:ml-auto">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg bg-card pl-8 pr-8 py-1 text-xs text-foreground border border-card-border focus:outline-none focus:border-indigo-500/50 transition-colors placeholder-slate-400"
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Tasks View Body (Kanban vs List) ───────────────────────────── */}
        {viewLayout === "kanban" ? (
          <div className="flex-1 overflow-x-auto overflow-y-hidden custom-scrollbar p-5 flex gap-4 items-start min-h-0 h-full">
            {groupedTasks.map(([groupName, groupList]) => (
              <div key={groupName} className="w-80 shrink-0 bg-sidebar border border-card-border rounded-2xl flex flex-col h-full max-h-full overflow-hidden shadow-xl min-h-0">
                {/* Column Header */}
                <div className="p-3 border-b border-card-border flex items-center justify-between bg-card shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground">{groupName}</span>
                    <span className="text-[10px] text-slate-700 dark:text-slate-300 font-extrabold bg-slate-200 dark:bg-slate-800/60 px-2 py-0.5 rounded-full">
                      {groupList.length}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => toggleSelectAll(groupList)}
                    className="text-[9.5px] font-bold text-indigo-400 hover:text-indigo-300 cursor-pointer"
                  >
                    Select
                  </button>
                </div>

                {/* Column Card Stream */}
                <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5 custom-scrollbar min-h-0">
                  {groupList.map((task) => {
                    const globalIndex = flatVisualTasks.indexOf(task);
                    const isFocused = focusedTaskIndex === globalIndex;
                    const isSelected = selectedTaskIds.includes(task.id);
                    const priorityVal = task.priority || "none";
                    const cleanDisplayContent = task.content
                      .replace(/(?:@due:?|@|due:\s*)?20\d{2}[-/]\d{2}[-/]\d{2}(?:T[^\s]+|[ T]\d{2}:\d{2})?/gi, "")
                      .replace(/(?:^|\s|\\)#([a-zA-Z0-9_\-\/]+)/g, "")
                      .replace(/@task(!*)/gi, "")
                      .replace(/(?:^|\s)!(?=\s|$)/g, "")
                      .replace(/\s+/g, " ")
                      .trim();

                    const priorityColors = {
                      high: "border-l-3 border-l-rose-500",
                      medium: "border-l-3 border-l-amber-500",
                      low: "border-l-3 border-l-cyan-400",
                      none: "border-l-3 border-l-slate-700/80"
                    };

                    return (
                      <div
                        key={task.id}
                        onClick={(e) => {
                          setFocusedTaskIndex(globalIndex);
                          if (e.metaKey || e.ctrlKey || e.shiftKey) {
                            setSelectedTaskIds(prev => prev.includes(task.id) ? prev.filter(id => id !== task.id) : [...prev, task.id]);
                          } else {
                            setSelectedTaskIds(prev => prev.includes(task.id) ? prev.filter(id => id !== task.id) : [task.id]);
                          }
                        }}
                        className={`shrink-0 p-3.5 rounded-xl border flex flex-col gap-2.5 transition-all duration-200 cursor-pointer group/card select-none relative overflow-hidden ${
                          task.completed
                            ? "bg-card/40 border-card-border/60 opacity-55 hover:opacity-80"
                            : isSelected
                            ? "bg-indigo-600/15 border-indigo-500/60 shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-500/40"
                            : isFocused
                            ? "bg-card-hover border-indigo-500/50 ring-1 ring-indigo-500/40"
                            : priorityVal === "high"
                            ? "bg-card border-card-border hover:border-rose-500/40"
                            : priorityVal === "medium"
                            ? "bg-card border-card-border hover:border-amber-500/40"
                            : priorityVal === "low"
                            ? "bg-card border-card-border hover:border-cyan-500/40"
                            : "bg-card border-card-border hover:border-indigo-500/30 hover:bg-card-hover"
                        }
                        ${priorityColors[priorityVal]}
                        `}
                      >
                        {/* ══ UPPER SECTION: Task Text, Checkbox, Edit & Tags ══ */}
                        <div className="flex flex-col gap-2">
                          <div className="flex items-start justify-between gap-2.5">
                            <div className="flex items-start gap-2.5 min-w-0 flex-1">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleToggle(task); }}
                                className={`flex h-4.5 w-4.5 shrink-0 mt-0.5 cursor-pointer items-center justify-center rounded-md border transition-all duration-200 ${
                                  task.completed
                                    ? "bg-linear-to-br from-indigo-500 to-indigo-600 border-indigo-400 text-white shadow-sm shadow-indigo-500/40"
                                    : "border-slate-600/80 hover:border-indigo-400 bg-slate-900/60 hover:scale-105 text-transparent"
                                }`}
                                title="Toggle completion status"
                              >
                                <Check className="h-3 w-3 stroke-[2.5]" />
                              </button>
                              <span className={`text-[12.5px] font-bold leading-snug tracking-wide line-clamp-3 ${task.completed ? "line-through text-slate-400" : "text-foreground group-hover/card:text-indigo-600 dark:group-hover/card:text-white"}`}>
                                {cleanDisplayContent || "Untitled task"}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => startEdit(task)}
                              className="opacity-0 group-hover/card:opacity-100 text-slate-400 hover:text-white p-1 rounded-md bg-slate-800/60 hover:bg-indigo-600 cursor-pointer transition-all shrink-0"
                              title="Edit task"
                            >
                              <Edit className="h-3 w-3" />
                            </button>
                          </div>

                          {/* Tags in Upper Section */}
                          {task.tags.length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap pl-7">
                              {task.tags.map(tag => (
                                <span
                                  key={tag}
                                  onClick={(e) => { e.stopPropagation(); setSelectedTag(tag); }}
                                  className="text-[8.5px] font-extrabold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 hover:border-indigo-400/40 px-2 py-0.5 rounded-full transition-colors cursor-pointer"
                                >
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* ══ LOWER SECTION: Note Name, Date & Priority ══ */}
                        <div className="flex flex-col gap-2 pt-2.5 border-t border-card-border/60 text-[9.5px]">
                          {/* Note Name Link Pill */}
                          <div className="flex items-center min-w-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openNoteByName(task.noteName);
                                setTimeout(() => {
                                  window.dispatchEvent(new CustomEvent("scroll-to-line", { detail: { lineNumber: task.lineNumber } }));
                                }, 150);
                              }}
                              className="flex items-center gap-1.5 text-[9.5px] font-extrabold text-indigo-700 dark:text-indigo-300 hover:text-indigo-900 dark:hover:text-white bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-600/30 border border-indigo-200 dark:border-indigo-500/30 px-2 py-0.5 rounded-md truncate max-w-full transition-all cursor-pointer"
                              title={`Open note: ${task.noteName} (Line ${task.lineNumber + 1})`}
                            >
                              <FileText className="h-3 w-3 text-indigo-500 dark:text-indigo-400 shrink-0" />
                              <span className="truncate">{task.noteName}</span>
                            </button>
                          </div>

                          {/* Date & Priority Bar */}
                          <div className="flex items-center justify-between gap-1.5 flex-wrap">
                            {/* Priority Badge Pill */}
                            <button
                              type="button"
                              onClick={(e) => handlePriorityCycle(task, e)}
                              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold border cursor-pointer select-none transition-all duration-150 ${
                                priorityVal === "high"
                                  ? "bg-rose-500/15 border-rose-500/30 text-rose-700 dark:text-rose-400 hover:bg-rose-500/25"
                                  : priorityVal === "medium"
                                  ? "bg-amber-500/15 border-amber-500/30 text-amber-800 dark:text-amber-300 hover:bg-amber-500/25"
                                  : priorityVal === "low"
                                  ? "bg-cyan-500/15 border-cyan-500/30 text-cyan-800 dark:text-cyan-300 hover:bg-cyan-500/25"
                                  : "bg-slate-100 dark:bg-slate-800/40 border-slate-300 dark:border-slate-700/50 text-slate-700 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-400"
                              }`}
                              title="Click to cycle priority"
                            >
                              {priorityVal === "high" && <><AlertTriangle className="h-2.5 w-2.5 text-rose-600 dark:text-rose-400 shrink-0" /><span>High</span></>}
                              {priorityVal === "medium" && <><AlertCircle className="h-2.5 w-2.5 text-amber-600 dark:text-amber-400 shrink-0" /><span>Med</span></>}
                              {priorityVal === "low" && <><Info className="h-2.5 w-2.5 text-cyan-600 dark:text-cyan-400 shrink-0" /><span>Low</span></>}
                              {priorityVal === "none" && <><MinusCircle className="h-2.5 w-2.5 text-slate-500 dark:text-slate-600 shrink-0" /><span>Priority</span></>}
                            </button>

                            {/* Due Date Pill */}
                            {task.dueDate && (() => {
                              const targetRaw = task.rawDueDate || (task.dueTime ? `${task.dueDate}T${task.dueTime}:00` : task.dueDate);
                              const { dateStr, timeStr } = getZonedDateParts(targetRaw, userTimezone);

                              const isOverdue = dateStr < todayStr && !task.completed;
                              const isToday = dateStr === todayStr;
                              const isTomorrow = dateStr === tomorrowStr;
                              const friendlyDate = formatDueDate(dateStr, todayStr, tomorrowStr);
                              const timeDisplay = timeStr ? ` ${timeStr}` : (task.dueTime ? ` ${task.dueTime}` : "");

                              return (
                                <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border flex items-center gap-1 select-none transition-all ${
                                  isOverdue
                                    ? "text-rose-700 dark:text-rose-300 bg-rose-500/15 border-rose-500/30"
                                    : isToday
                                    ? "text-amber-800 dark:text-amber-300 bg-amber-500/15 border-amber-500/30"
                                    : isTomorrow
                                    ? "text-sky-800 dark:text-sky-300 bg-sky-500/15 border-sky-500/30"
                                    : "text-indigo-700 dark:text-indigo-300 bg-indigo-500/15 border-indigo-500/30"
                                }`}>
                                  <Calendar className="h-2.5 w-2.5 shrink-0 opacity-80" />
                                  <span>{friendlyDate}{timeDisplay}</span>
                                </span>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* ── Tasks Group List ────────────────────────────────────────────── */
          <div className="flex-1 overflow-y-auto custom-scrollbar p-5 flex flex-col gap-4">
            
            {groupedTasks.map(([groupName, groupList]) => {
            const isCollapsed = collapsedGroups[groupName];
            const allGroupSelected = groupList.every(t => selectedTaskIds.includes(t.id));
            if (groupList.length === 0) return null;

            return (
              <div key={groupName} className="flex flex-col gap-2">
                
                {/* Collapsible Header */}
                <div className="flex items-center justify-between border-b border-card-border/50 pb-1 cursor-pointer select-none"
                  onClick={() => setCollapsedGroups(prev => ({ ...prev, [groupName]: !isCollapsed }))}>
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] font-extrabold uppercase tracking-widest text-slate-400 ${isCollapsed ? "opacity-60" : ""}`}>
                      {groupName} <span className="text-[10px] text-slate-600 font-bold ml-1">({groupList.length})</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {groupBy !== "none" && (
                      <button
                        onClick={e => { e.stopPropagation(); toggleSelectAll(groupList); }}
                        className="text-[9px] font-bold text-slate-500 hover:text-indigo-400 bg-slate-900 border border-card-border px-1.5 py-0.5 rounded cursor-pointer"
                      >
                        {allGroupSelected ? "Deselect Group" : "Select Group"}
                      </button>
                    )}
                    <span className="text-[10px] text-slate-600 font-bold">{isCollapsed ? "[+]" : "[-]"}</span>
                  </div>
                </div>

                {/* Group Content */}
                {!isCollapsed && (
                  <div className="flex flex-col gap-1.5 animate-slide-down">
                    {groupList.map(task => {
                      const globalIndex = flatVisualTasks.indexOf(task);
                      const isFocused = focusedTaskIndex === globalIndex;
                      const isSelected = selectedTaskIds.includes(task.id);
                      const priorityVal = task.priority || "none";
                      const priorityColors = {
                        high: "border-l-2 border-l-rose-500",
                        medium: "border-l-2 border-l-amber-500",
                        low: "border-l-2 border-l-teal-400",
                        none: "border-l-2 border-l-slate-700"
                      };

                      const cleanDisplayContent = task.content
                        .replace(/(?:@due:?|@|due:\s*)?20\d{2}[-/]\d{2}[-/]\d{2}(?:T[^\s]+|[ T]\d{2}:\d{2})?/gi, "")
                        .replace(/(?:^|\s|\\)#([a-zA-Z0-9_\-\/]+)/g, "")
                        .replace(/@task(!*)/gi, "")
                        .replace(/(?:^|\s)!(?=\s|$)/g, "")
                        .replace(/\s+/g, " ")
                        .trim();

                      return (
                        <div
                          key={task.id}
                          onClick={(e) => {
                            setFocusedTaskIndex(globalIndex);
                            if (e.metaKey || e.ctrlKey || e.shiftKey) {
                              setSelectedTaskIds(prev => prev.includes(task.id) ? prev.filter(id => id !== task.id) : [...prev, task.id]);
                            } else {
                              setSelectedTaskIds(prev => prev.includes(task.id) ? prev.filter(id => id !== task.id) : [task.id]);
                            }
                          }}
                          className={`group/task p-3 rounded-xl border flex flex-col gap-2 transition-all duration-200 relative overflow-hidden text-xs cursor-pointer select-none
                            ${task.completed
                              ? "bg-card/40 border-card-border opacity-55 hover:opacity-80"
                              : isSelected
                              ? "bg-indigo-600/15 border-indigo-500/60 shadow-lg shadow-indigo-500/10 ring-1 ring-indigo-500/40"
                              : isFocused
                              ? "bg-card-hover border-indigo-500/50 ring-1 ring-indigo-500/40"
                              : priorityVal === "high"
                              ? "bg-card border-card-border hover:border-rose-500/40"
                              : priorityVal === "medium"
                              ? "bg-card border-card-border hover:border-amber-500/40"
                              : priorityVal === "low"
                              ? "bg-card border-card-border hover:border-cyan-500/40"
                              : "bg-card border-card-border hover:border-indigo-500/30 hover:bg-card-hover"
                            }
                            ${priorityColors[priorityVal]}
                          `}
                        >
                          {/* ── Line 1: Task Checkbox, Text & Inline Tags ───────────────── */}
                          <div className="flex items-center justify-between gap-3 min-w-0">
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              {/* Checkbox Ring */}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleToggle(task); }}
                                className={`flex h-4.5 w-4.5 shrink-0 cursor-pointer items-center justify-center rounded-md border transition-all duration-200 ${
                                  task.completed
                                    ? "bg-linear-to-br from-indigo-500 to-indigo-600 border-indigo-400 text-white shadow-sm shadow-indigo-500/40"
                                    : "border-slate-400 dark:border-slate-600 bg-card hover:border-indigo-400 hover:scale-105 text-transparent"
                                }`}
                                title="Toggle completion status (Enter)"
                              >
                                <Check className="h-3 w-3 stroke-[2.5]" />
                              </button>

                              {/* Task Content Text */}
                              <span
                                className={`text-[12.5px] font-bold truncate leading-snug tracking-wide ${
                                  task.completed ? "line-through text-slate-400" : "text-foreground group-hover/task:text-indigo-600 dark:group-hover/task:text-white"
                                }`}
                                title={cleanDisplayContent || "Untitled task"}
                              >
                                {cleanDisplayContent || "Untitled task"}
                              </span>
                            </div>

                            {/* Tags on Line 1 */}
                            {task.tags.length > 0 && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                {task.tags.map(tag => (
                                  <span
                                    key={tag}
                                    onClick={(e) => { e.stopPropagation(); setSelectedTag(tag); }}
                                    className="text-[9px] font-extrabold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 hover:border-indigo-400/40 px-2 py-0.5 rounded-full transition-colors cursor-pointer"
                                  >
                                    #{tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* ── Line 2: Priority, Due Date, Note Source & Edit Action ───── */}
                          <div className="flex items-center justify-between gap-2 border-t border-card-border/60 pt-2 text-[9.5px]">
                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                              {/* Priority Badge Pill */}
                              <div
                                onClick={(e) => handlePriorityCycle(task, e)}
                                className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold border cursor-pointer select-none transition-all duration-150 ${
                                  priorityVal === "high"
                                    ? "bg-rose-500/15 border-rose-500/30 text-rose-700 dark:text-rose-400 hover:bg-rose-500/25"
                                    : priorityVal === "medium"
                                    ? "bg-amber-500/15 border-amber-500/30 text-amber-800 dark:text-amber-300 hover:bg-amber-500/25"
                                    : priorityVal === "low"
                                    ? "bg-cyan-500/15 border-cyan-500/30 text-cyan-800 dark:text-cyan-300 hover:bg-cyan-500/25"
                                    : "bg-slate-100 dark:bg-slate-800/40 border-slate-300 dark:border-slate-700/50 text-slate-700 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-400"
                                }`}
                                title="Click to cycle priority (None → Low → Med → High)"
                              >
                                {priorityVal === "high" && <><AlertTriangle className="h-2.5 w-2.5 text-rose-600 dark:text-rose-400 shrink-0" /><span>High</span></>}
                                {priorityVal === "medium" && <><AlertCircle className="h-2.5 w-2.5 text-amber-600 dark:text-amber-400 shrink-0" /><span>Med</span></>}
                                {priorityVal === "low" && <><Info className="h-2.5 w-2.5 text-cyan-600 dark:text-cyan-400 shrink-0" /><span>Low</span></>}
                                {priorityVal === "none" && <><MinusCircle className="h-2.5 w-2.5 text-slate-500 dark:text-slate-600 shrink-0" /><span>Priority</span></>}
                              </div>

                              {/* Due Date Pill */}
                              {task.dueDate && (() => {
                                const targetRaw = task.rawDueDate || (task.dueTime ? `${task.dueDate}T${task.dueTime}:00` : task.dueDate);
                                const { dateStr, timeStr } = getZonedDateParts(targetRaw, userTimezone);

                                const isOverdue = dateStr < todayStr && !task.completed;
                                const isToday = dateStr === todayStr;
                                const isTomorrow = dateStr === tomorrowStr;
                                const friendlyDate = formatDueDate(dateStr, todayStr, tomorrowStr);
                                const timeDisplay = timeStr ? ` ${timeStr}` : (task.dueTime ? ` ${task.dueTime}` : "");

                                return (
                                  <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded-full border flex items-center gap-1 select-none transition-all ${
                                    isOverdue
                                      ? "text-rose-700 dark:text-rose-300 bg-rose-500/15 border-rose-500/30"
                                      : isToday
                                      ? "text-amber-800 dark:text-amber-300 bg-amber-500/15 border-amber-500/30"
                                      : isTomorrow
                                      ? "text-sky-800 dark:text-sky-300 bg-sky-500/15 border-sky-500/30"
                                      : "text-indigo-700 dark:text-indigo-300 bg-indigo-500/15 border-indigo-500/30"
                                  }`}>
                                    <Calendar className="h-2.5 w-2.5 shrink-0 opacity-80" />
                                    <span>{friendlyDate}{timeDisplay}</span>
                                  </span>
                                );
                              })()}

                              {/* Note Source Link Pill */}
                              <button
                                type="button"
                                onClick={() => {
                                  openNoteByName(task.noteName);
                                  setTimeout(() => {
                                    window.dispatchEvent(new CustomEvent("scroll-to-line", { detail: { lineNumber: task.lineNumber } }));
                                  }, 150);
                                }}
                                className="flex items-center gap-1 text-[9.5px] font-extrabold text-indigo-700 dark:text-indigo-300 hover:text-indigo-900 dark:hover:text-white bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-600/30 border border-indigo-200 dark:border-indigo-500/30 px-2 py-0.5 rounded-md max-w-xs sm:max-w-md md:max-w-lg lg:max-w-2xl truncate transition-all cursor-pointer"
                                title={`Open note: ${task.noteName} (Line ${task.lineNumber + 1})`}
                              >
                                <FileText className="h-2.5 w-2.5 text-indigo-500 dark:text-indigo-400 shrink-0" />
                                <span className="truncate">{task.noteName}</span>
                              </button>
                            </div>

                            {/* Edit Action Button */}
                            <button
                              type="button"
                              onClick={() => startEdit(task)}
                              className="opacity-0 group-hover/task:opacity-100 p-1 rounded-md bg-slate-200 dark:bg-slate-800/60 hover:bg-indigo-600 hover:text-white text-slate-600 dark:text-slate-400 transition-all cursor-pointer shrink-0"
                              title="Edit task"
                            >
                              <Edit className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {filteredTasks.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-slate-600 gap-2">
              <Inbox className="h-12 w-12 text-slate-800" />
              <span className="text-xs italic font-semibold">No checklist items found for active filters</span>
            </div>
          )}
        </div>
        )}

        {/* ══ BATCH ACTIONS DRAWER ════════════════════════════════════════════ */}
        {selectedTaskIds.length > 0 && (
          <div className="border-t border-card-border bg-card p-4 flex items-center justify-between shadow-2xl relative z-30 animate-slide-up shrink-0">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-indigo-500 dark:text-indigo-400" />
              <span className="text-xs font-bold text-foreground">{selectedTaskIds.length} tasks selected</span>
              <button onClick={() => setSelectedTaskIds([])} className="text-[10px] font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer">
                Cancel
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleBatchToggle(true)}
                className="flex items-center gap-1 bg-[#10b981]/15 hover:bg-[#10b981]/25 border border-[#10b981]/20 rounded-lg px-3 py-1.5 text-xs font-bold text-[#10b981] transition-colors cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" />
                <span>Mark Completed</span>
              </button>
              <button
                onClick={() => handleBatchToggle(false)}
                className="flex items-center gap-1 bg-[#fbbf24]/15 hover:bg-[#fbbf24]/25 border border-[#fbbf24]/20 rounded-lg px-3 py-1.5 text-xs font-bold text-[#fbbf24] transition-colors cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Mark Pending</span>
              </button>
              <button
                onClick={handleBatchDelete}
                className="flex items-center gap-1 bg-red-500/15 hover:bg-red-500/25 border border-red-500/20 rounded-lg px-3 py-1.5 text-xs font-bold text-red-400 transition-colors cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Delete</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ══ EDIT MODAL POPUP OVERLAY ═══════════════════════════════════════════ */}
      {editingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 animate-fade-in">
          <div className="w-105 rounded-2xl border border-card-border bg-card p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-card-border/50 pb-2.5">
              <span className="text-xs font-extrabold text-foreground uppercase tracking-widest flex items-center gap-1.5">
                <Edit className="h-4 w-4 text-indigo-500 dark:text-indigo-400" /> Edit Task
              </span>
              <button onClick={() => setEditingTask(null)} className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={saveTaskEdit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Task Content
                </label>
                <input
                  type="text"
                  required
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="rounded-lg bg-background p-2.5 text-xs text-foreground border border-card-border focus:outline-none focus:border-indigo-500/50 w-full transition-colors"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <CalendarDays className="h-3 w-3 text-slate-500" /> Due Date
                  </label>
                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="rounded-lg bg-background p-2 text-xs text-foreground border border-card-border focus:outline-none focus:border-indigo-500/50 w-full"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <Calendar className="h-3 w-3 text-slate-500" /> Time
                  </label>
                  <input
                    type="time"
                    value={editTime}
                    onChange={(e) => setEditTime(e.target.value)}
                    className="rounded-lg bg-background p-2 text-xs text-foreground border border-card-border focus:outline-none focus:border-indigo-500/50 w-full"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                    <Tag className="h-3 w-3 text-slate-500" /> Tags
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. #work"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    className="rounded-lg bg-background p-2 text-xs text-foreground border border-card-border focus:outline-none focus:border-indigo-500/50 w-full placeholder-slate-400"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  Task Priority
                </label>
                <select
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value as any)}
                  className="rounded-lg bg-background p-2 text-xs text-slate-700 dark:text-slate-200 border border-card-border focus:outline-none focus:border-indigo-500/50 w-full cursor-pointer"
                >
                  <option value="high">High Priority (!!!)</option>
                  <option value="medium">Medium Priority (!!)</option>
                  <option value="low">Low Priority (!)</option>
                  <option value="none">None / Normal</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-card-border/50 mt-2">
                <button
                  type="button"
                  onClick={() => setEditingTask(null)}
                  className="flex-1 rounded-lg bg-slate-800 py-2 text-xs font-bold text-slate-400 hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-indigo-600 py-2 text-xs font-bold text-white hover:bg-indigo-500 transition-colors shadow-md shadow-indigo-600/30 cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── NOTE PICKER MODAL FOR QUICK LOG TASK ───────────────────────── */}
      {isNotePickerOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-[#0b0c11] border border-card-border rounded-2xl w-full max-w-md shadow-2xl flex flex-col overflow-hidden animate-scale-up">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-4 border-b border-card-border bg-[#0e1017]">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-slate-200">Select Target Note</h3>
              </div>
              <button
                onClick={() => setIsNotePickerOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-[#1a1d29] transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-3 border-b border-card-border/70 bg-[#07080c]">
              <div className="relative flex items-center">
                <Search className="absolute left-3 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  autoFocus
                  placeholder="Search destination note..."
                  value={pickerSearchQuery}
                  onChange={(e) => setPickerSearchQuery(e.target.value)}
                  className="w-full bg-card border border-card-border rounded-xl pl-9 pr-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/50 transition-colors placeholder-slate-600"
                />
              </div>
            </div>

            {/* Note Options List */}
            <div className="max-h-72 overflow-y-auto custom-scrollbar p-2.5 flex flex-col gap-1.5">
              {/* Daily Note Option */}
              <button
                onClick={() => executeQuickAdd("daily")}
                className="flex items-center justify-between p-3 rounded-xl bg-indigo-950/40 hover:bg-indigo-600/25 border border-indigo-500/30 text-left transition-all group cursor-pointer"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 shrink-0">
                    <Calendar className="h-4 w-4" />
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs font-bold text-slate-200 group-hover:text-white truncate">
                      Today's Daily Note
                    </span>
                    <span className="text-[9.5px] text-slate-400 font-mono mt-0.5">
                      {todayStr}.md
                    </span>
                  </div>
                </div>
                <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-2.5 py-0.5 rounded-full border border-indigo-500/20 shrink-0">
                  Default
                </span>
              </button>

              {/* Vault Notes */}
              {allNotes
                .filter((n) => n.name.toLowerCase().includes(pickerSearchQuery.toLowerCase()))
                .map((n) => (
                  <button
                    key={n.path}
                    onClick={() => executeQuickAdd(n.path)}
                    className="flex items-center justify-between p-2.5 rounded-xl hover:bg-[#151722] border border-transparent hover:border-card-border text-left transition-all group cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileText className="h-4 w-4 text-slate-400 group-hover:text-indigo-400 shrink-0 transition-colors" />
                      <span className="text-xs font-semibold text-slate-300 group-hover:text-slate-100 truncate">
                        {n.name}
                      </span>
                    </div>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
