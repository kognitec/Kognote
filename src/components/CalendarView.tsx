import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useVault } from "../contexts/VaultContext";
import { useSettings } from "../contexts/SettingsContext";
import { useSync } from "../contexts/SyncContext";
import { useTheme } from "../contexts/ThemeContext";
import { LazyStore } from "@tauri-apps/plugin-store";
import { invokeIPC } from "../lib/ipc";
import { ScannedTask, toggleTaskInNote, isArchivedPath, isTrashPath } from "../lib/task-scanner";
import { getFileIcon } from "../lib/file-icons";
import { getZonedDateParts } from "../lib/frontmatter";
import { FileEntry, NoteCachedData } from "../types/note";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalendarIcon,
  Trash2,
  FileText,
  Clock,
  MapPin,
  Link2,
  ExternalLink,
  LayoutGrid,
  Rows3,
  Square,
  Columns3,
  X,
  Eye,
  EyeOff,
  CheckSquare,
  BookOpen,
  Sparkles,
  AlarmClock,
  AlertTriangle,
  Inbox,
  Circle,
  CheckCircle2,
  CircleDashed,
  Calendar,
  LayoutTemplate,
  Scissors,
  Filter
} from "lucide-react";

// ─── Store ───────────────────────────────────────────────────────────────────
const calendarStore = new LazyStore(".calendar.json");

// ─── Types ───────────────────────────────────────────────────────────────────
type CalendarViewMode = "month" | "week" | "3day" | "day";
type CategoryFilter = "all" | "tasks" | "due-notes" | "local" | "external";

interface CalendarFeed {
  id: string;
  name: string;
  url: string;
  color: string;
  visible: boolean;
}

interface CalendarEvent {
  id: string;
  calendarId: string;
  summary: string;
  description?: string;
  location?: string;
  date: string;       // YYYY-MM-DD
  startTime?: string; // HH:MM
  endTime?: string;   // HH:MM
  color?: string;     // override for local events
  priority?: "high" | "medium" | "low" | "none";
  status?: string;
  completed?: boolean;
  notePath?: string;
  noteName?: string;
  lineNumber?: number;
}

interface PositionedCalendarEvent extends CalendarEvent {
  top: number;
  height: number;
  leftPercent: number;
  widthPercent: number;
  columnIndex: number;
  totalColumns: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DAY_NAMES_SHORT = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const DAY_NAMES_FULL  = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 64; // px per hour in time grid
const LOCAL_COLORS = ["#6366f1","#ec4899","#10b981","#f59e0b","#06b6d4","#ef4444","#8b5cf6","#f97316"];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function toLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
}
function addDays(date: Date, days: number): Date {
  const d = new Date(date); d.setDate(d.getDate()+days); return d;
}
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0,0,0,0);
  return d;
}
function formatHour(h: number): string {
  if (h === 0)  return "12 AM";
  if (h < 12)   return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h-12} PM`;
}
function formatTime12(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const ampm = h < 12 ? "AM" : "PM";
  const h12 = h === 0 ? 12 : h > 12 ? h-12 : h;
  return `${h12}:${String(m).padStart(2,"0")} ${ampm}`;
}

function getBoardStatusIcon(status?: string, size = "h-3 w-3") {
  switch ((status || "").toLowerCase()) {
    case "backlog":
      return <Inbox className={`${size} text-slate-400 shrink-0`} />;
    case "todo":
      return <Circle className={`${size} text-indigo-400 shrink-0`} />;
    case "in-progress":
    case "inprogress":
    case "in progress":
      return <Clock className={`${size} text-amber-400 shrink-0`} />;
    case "in-review":
    case "inreview":
    case "in review":
      return <Eye className={`${size} text-purple-400 shrink-0`} />;
    case "done":
      return <CheckCircle2 className={`${size} text-emerald-400 shrink-0`} />;
    default:
      return <CircleDashed className={`${size} text-slate-500 shrink-0`} />;
  }
}

function getPriorityHighlightColor(priority?: string, fallback = "#64748b"): string {
  switch (priority) {
    case "high":   return "#ef4444";
    case "medium": return "#f59e0b";
    case "low":    return "#38bdf8";
    case "none":   return "#64748b";
    default:       return fallback;
  }
}

function getEventColor(evt: CalendarEvent, feeds: CalendarFeed[]): string {
  if (evt.color) return evt.color;
  if (evt.priority === "high") return "#ef4444";
  if (evt.priority === "medium") return "#f59e0b";
  if (evt.priority === "low") return "#38bdf8";
  if (!evt.priority || evt.priority === "none") return "#64748b";
  if (evt.calendarId === "tasks") return "#64748b";
  if (evt.calendarId === "due-notes") return "#64748b";
  if (evt.calendarId === "local") return "#a855f7";
  const feed = feeds.find(f => f.id === evt.calendarId);
  return feed ? feed.color : "#64748b";
}

function getTextColorForCalendarEvent(colorHex: string, isDark: boolean): string | undefined {
  if (isDark) return undefined;

  // In light mode, darken the text color by ~30% for crisp, vivid readability on light pastel backgrounds
  const hex = colorHex.replace("#", "");
  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    const darkR = Math.max(0, Math.floor(r * 0.70));
    const darkG = Math.max(0, Math.floor(g * 0.70));
    const darkB = Math.max(0, Math.floor(b * 0.70));

    const toHex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${toHex(darkR)}${toHex(darkG)}${toHex(darkB)}`;
  }
  return colorHex;
}

function getNoteIcon(evt: CalendarEvent, noteCache: Record<string, NoteCachedData>, sizeClass = "h-3.5 w-3.5 shrink-0") {
  if (evt.notePath) {
    const fileEntry: FileEntry = {
      name: (evt.noteName || "note") + ".md",
      path: evt.notePath,
      is_dir: false,
    };
    return getFileIcon(fileEntry, noteCache, { className: sizeClass });
  }

  const nameLower = (evt.noteName || "").toLowerCase();
  if (nameLower.includes("daily") || /^\d{4}-\d{2}-\d{2}$/.test(evt.noteName || "")) {
    return <Calendar className={`${sizeClass} text-indigo-400`} />;
  }
  if (nameLower.includes("template")) {
    return <LayoutTemplate className={`${sizeClass} text-purple-400`} />;
  }
  if (nameLower.includes("clipping")) {
    return <Scissors className={`${sizeClass} text-cyan-400`} />;
  }
  return <FileText className={`${sizeClass} text-[#d946ef]`} />;
}

function getCategoryIcon(calId: string, size = "h-3 w-3") {
  switch (calId) {
    case "tasks":     return <CheckSquare className={`${size} text-indigo-400`} />;
    case "due-notes": return <FileText className={`${size} text-[#d946ef]`} />;
    case "local":     return <CalendarIcon className={`${size} text-fuchsia-400`} />;
    default:          return <BookOpen className={`${size} text-cyan-400`} />;
  }
}

function parseHoursMinutes(t?: string): [number, number] {
  if (!t || typeof t !== "string") return [8, 0];
  const match = t.trim().match(/^([0-1]?\d|2[0-3]):([0-5]\d)/);
  if (!match) return [8, 0];
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (isNaN(h) || isNaN(m)) return [8, 0];
  return [h, m];
}

function getEventTop(t?: string): number {
  const [h, m] = parseHoursMinutes(t);
  return (h + m / 60) * HOUR_HEIGHT;
}

function getEventHeight(s?: string, e?: string): number {
  if (!e) return HOUR_HEIGHT * 0.75;
  const [sh, sm] = parseHoursMinutes(s);
  const [eh, em] = parseHoursMinutes(e);
  const startHours = sh + sm / 60;
  const endHours = eh + em / 60;
  const diffHours = endHours - startHours;
  if (isNaN(diffHours) || diffHours <= 0) return HOUR_HEIGHT * 0.75;
  return Math.max(diffHours * HOUR_HEIGHT, 24);
}

/**
 * Calculates non-clashing side-by-side layout positions for overlapping time grid events
 */
function computeDayEventPositions(dayEvts: CalendarEvent[]): PositionedCalendarEvent[] {
  if (dayEvts.length === 0) return [];

  const items = dayEvts.map(evt => {
    const top = evt.startTime ? getEventTop(evt.startTime) : 8 * HOUR_HEIGHT;
    const height = getEventHeight(evt.startTime || "08:00", evt.endTime);
    return {
      evt,
      top,
      height,
      bottom: top + height
    };
  });

  // Sort chronologically by top start position, then by height
  items.sort((a, b) => a.top - b.top || b.height - a.height);

  // Group into overlapping clusters
  const clusters: typeof items[] = [];
  let currentCluster: typeof items = [];
  let clusterEnd = -1;

  items.forEach(item => {
    if (currentCluster.length === 0) {
      currentCluster.push(item);
      clusterEnd = item.bottom;
    } else if (item.top < clusterEnd) {
      currentCluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.bottom);
    } else {
      clusters.push(currentCluster);
      currentCluster = [item];
      clusterEnd = item.bottom;
    }
  });
  if (currentCluster.length > 0) {
    clusters.push(currentCluster);
  }

  // Allocate side-by-side columns within each cluster
  const result: PositionedCalendarEvent[] = [];

  clusters.forEach(cluster => {
    const columns: typeof items[] = [];

    cluster.forEach(item => {
      let placed = false;
      for (let c = 0; c < columns.length; c++) {
        const lastInCol = columns[c][columns[c].length - 1];
        if (lastInCol.bottom <= item.top) {
          columns[c].push(item);
          (item as any).colIndex = c;
          placed = true;
          break;
        }
      }
      if (!placed) {
        (item as any).colIndex = columns.length;
        columns.push([item]);
      }
    });

    const totalCols = columns.length;

    cluster.forEach(item => {
      const colIdx = (item as any).colIndex || 0;
      const widthPct = 100 / totalCols;
      const leftPct = colIdx * widthPct;

      result.push({
        ...item.evt,
        top: item.top,
        height: item.height,
        leftPercent: leftPct,
        widthPercent: widthPct,
        columnIndex: colIdx,
        totalColumns: totalCols
      });
    });
  });

  return result;
}

// ─── Component ───────────────────────────────────────────────────────────────
export const CalendarView: React.FC = () => {
  const { openNoteByName, openDailyNote, getDailyNoteFile, noteCache, activeView, refreshFiles } = useVault();
  const { includeArchivedInScans, userTimezone } = useSettings();
  const { registerSyncHandler, unregisterSyncHandler } = useSync();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [viewMode, setViewMode] = useState<CalendarViewMode>("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDayStr, setSelectedDayStr] = useState<string | null>(null);
  const [activeCategoryFilter, setActiveCategoryFilter] = useState<CategoryFilter>("all");

  const [feeds, setFeeds] = useState<CalendarFeed[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [scannedTasks, setScannedTasks] = useState<ScannedTask[]>([]);
  const [localEvents, setLocalEvents] = useState<CalendarEvent[]>([]);
  const [externalEvents, setExternalEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);

  // Modals
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [activeDetailEvent, setActiveDetailEvent] = useState<CalendarEvent | null>(null);

  // Link modal state
  const [feedName, setFeedName] = useState("");
  const [feedUrl, setFeedUrl] = useState("");
  const [feedColor, setFeedColor] = useState("#6366f1");

  // Event modal state
  const [eventSummary, setEventSummary] = useState("");
  const [eventDesc, setEventDesc] = useState("");
  const [eventLoc, setEventLoc] = useState("");
  const [eventStartTime, setEventStartTime] = useState("");
  const [eventEndTime, setEventEndTime] = useState("");
  const [eventColor, setEventColor] = useState("#6366f1");

  const timeGridRef = useRef<HTMLDivElement>(null);
  const todayStr = toLocalDateStr(new Date());

  // Scroll time grid to ~8 AM on view change
  useEffect(() => {
    if (viewMode !== "month" && timeGridRef.current) {
      setTimeout(() => { if (timeGridRef.current) timeGridRef.current.scrollTop = 8 * HOUR_HEIGHT; }, 60);
    }
  }, [viewMode]);

  // Keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isLinkModalOpen || isEventModalOpen) {
        if (e.key === "Escape") { setIsLinkModalOpen(false); setIsEventModalOpen(false); }
        return;
      }
      if (e.key === "ArrowLeft") navigate(-1);
      if (e.key === "ArrowRight") navigate(1);
      if (e.key === "t" || e.key === "T") navigateToday();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewMode, isLinkModalOpen, isEventModalOpen]);

  // ── Rebuild Events Engine ──────────────────────────────────────────────────
  const rebuildAllEvents = useCallback((
    localList: CalendarEvent[],
    externalList: CalendarEvent[],
    cacheData: typeof noteCache
  ) => {
    const all: CalendarEvent[] = [...localList, ...externalList];

    // 1. Gather Tasks from NoteCache respecting archive & trash scan settings
    const tasks = Object.values(cacheData)
      .flatMap(data => data.tasks || [])
      .filter((t) => {
        const isArchived = isArchivedPath(t.notePath) || cacheData[t.notePath]?.meta?.storage === "archived";
        const isDeleted = isTrashPath(t.notePath) || cacheData[t.notePath]?.meta?.storage === "deleted";

        if (!includeArchivedInScans && isArchived) return false;
        if (isDeleted) return false;
        if (t.notePath.toLowerCase().includes("/templates/") || cacheData[t.notePath]?.meta?.type === "template") return false;
        return true;
      });

    setScannedTasks(tasks);

    tasks.forEach(t => {
      const targetRaw = t.rawDueDate || (t.dueTime ? `${t.dueDate}T${t.dueTime}:00` : t.dueDate);
      const { dateStr: taskDate, timeStr: taskTime } = getZonedDateParts(targetRaw, userTimezone);

      const cleanTitle = (t.content || "")
        .replace(/(?:@due:?|@|due:\s*)?20\d{2}[-/]\d{2}[-/]\d{2}(?:T[^\s]+|[ T]\d{2}:\d{2})?/gi, "")
        .replace(/(?:^|\s|\\)#([a-zA-Z0-9_\-\/]+)/g, "")
        .replace(/@task(!*)/gi, "")
        .replace(/(?:\b|\s|^)!{1,3}(?:\b|\s|$)/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (taskDate) {
        all.push({
          id: t.id,
          calendarId: "tasks",
          summary: `${t.completed ? "✅" : "☑️"} ${cleanTitle || t.content}`,
          description: `Task in note: ${t.noteName}\nLine: ${t.lineNumber + 1}`,
          date: taskDate,
          startTime: taskTime,
          priority: t.priority,
          completed: t.completed,
          notePath: t.notePath,
          noteName: t.noteName,
          lineNumber: t.lineNumber
        });
      }
    });

    // 2. Gather Notes with `due` Frontmatter Metadata
    Object.entries(cacheData).forEach(([path, data]) => {
      if (!includeArchivedInScans && (data.meta?.storage === "archived" || isArchivedPath(path))) return;
      if (data.meta?.storage === "deleted" || isTrashPath(path)) return;
      if (data.meta?.type === "template" || path.toLowerCase().includes("/templates/")) return;

      const fm = data.meta;
      if (fm && fm.due) {
        const rawDue = String(fm.due).trim();
        if (rawDue) {
          const { dateStr: dueDate, timeStr: dueTime } = getZonedDateParts(rawDue, userTimezone);

          if (dueDate) {
            const noteName = path.replace(/\\/g, "/").split("/").pop()?.replace(/\.md$/, "") || "";
            const priority = (fm.priority || "none").toLowerCase() as any;
            const status = (fm.status || "none").toLowerCase();
            const completed = status === "done";

            all.push({
              id: `due-note:${path}`,
              calendarId: "due-notes",
              summary: noteName,
              description: `Due Note: ${noteName}\nPriority: ${priority}\nStatus: ${status}`,
              date: dueDate,
              startTime: dueTime,
              priority: priority,
              status: status,
              completed: completed,
              notePath: path,
              noteName: noteName
            });
          }
        }
      }
    });

    setEvents(all);
  }, [includeArchivedInScans, userTimezone]);

  // Initial load when view becomes active
  useEffect(() => {
    if (activeView === "calendar") {
      loadCalendarSettings();
    }
  }, [activeView]);

  // Re-scan and rebuild events list when noteCache or userTimezone updates
  useEffect(() => {
    if (activeView === "calendar") {
      rebuildAllEvents(localEvents, externalEvents, noteCache);
    }
  }, [noteCache, localEvents, externalEvents, activeView, userTimezone, rebuildAllEvents]);

  useEffect(() => {
    registerSyncHandler("calendar-sync", async () => {
      const savedLocal = (await calendarStore.get<CalendarEvent[]>("local_events")) || [];
      setLocalEvents(savedLocal);
      await fetchExternalFeeds(feeds);
    }, "Sync calendar events");
    return () => unregisterSyncHandler("calendar-sync");
  }, [registerSyncHandler, unregisterSyncHandler, feeds]);

  const loadCalendarSettings = async () => {
    try {
      const savedFeeds = (await calendarStore.get<CalendarFeed[]>("feeds")) || [];
      const migratedFeeds = savedFeeds.map(f => ({ ...f, visible: f.visible !== false }));
      setFeeds(migratedFeeds);
      const savedLocalEvents = (await calendarStore.get<CalendarEvent[]>("local_events")) || [];
      setLocalEvents(savedLocalEvents);
      await fetchExternalFeeds(migratedFeeds);
    } catch (e) {
      console.error("Failed to load calendar settings:", e);
    }
  };

  const parseICS = (icsText: string, calendarId: string): CalendarEvent[] => {
    const parsedEvents: CalendarEvent[] = [];
    const eventBlocks = icsText.split("BEGIN:VEVENT");
    eventBlocks.shift();
    for (const block of eventBlocks) {
      const lines = block.split(/\r?\n/);
      let summary = "Untitled Event", description = "", location = "", dateStr = "", startTime = "", endTime = "";
      for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();
        while (i + 1 < lines.length && (lines[i+1].startsWith(" ") || lines[i+1].startsWith("\t"))) { line += lines[i+1].substring(1); i++; }
        if (line.startsWith("SUMMARY:"))     summary     = line.substring(8).replace(/\\,/g,",").replace(/\\;/g,";");
        else if (line.startsWith("DESCRIPTION:")) description = line.substring(12).replace(/\\n/g,"\n").replace(/\\,/g,",");
        else if (line.startsWith("LOCATION:"))    location    = line.substring(9).replace(/\\,/g,",");
        else if (line.startsWith("DTSTART")) {
          const val = line.substring(line.indexOf(":")+1);
          if (val.length >= 8) {
            dateStr = `${val.substring(0,4)}-${val.substring(4,6)}-${val.substring(6,8)}`;
            if (val.includes("T") && val.length >= 13) startTime = `${val.substring(9,11)}:${val.substring(11,13)}`;
          }
        } else if (line.startsWith("DTEND")) {
          const val = line.substring(line.indexOf(":")+1);
          if (val.includes("T") && val.length >= 13) endTime = `${val.substring(9,11)}:${val.substring(11,13)}`;
        }
      }
      if (dateStr) parsedEvents.push({ id: Math.random().toString(36).substring(2,9), calendarId, summary, description, location, date: dateStr, startTime: startTime || undefined, endTime: endTime || undefined });
    }
    return parsedEvents;
  };

  const fetchExternalFeeds = async (feedsList: CalendarFeed[], forceRefresh: boolean = false) => {
    setLoading(true);
    let allExternal: CalendarEvent[] = [];
    const now = Date.now();
    const TTL = 60 * 60 * 1000; // 1 hour TTL

    try {
      const cachedTime = (await calendarStore.get<number>("ical_cache_time")) || 0;
      const cachedEvents = (await calendarStore.get<CalendarEvent[]>("ical_cache_events")) || [];

      if (!forceRefresh && now - cachedTime < TTL && cachedEvents.length > 0) {
        setExternalEvents(cachedEvents);
        setLoading(false);
        return;
      }
    } catch {}

    for (const feed of feedsList) {
      if (!feed.visible) continue;
      try {
        const icsText = await invokeIPC("fetch_ical", { url: feed.url });
        if (icsText) allExternal = [...allExternal, ...parseICS(icsText, feed.id)];
      } catch (err) { console.error(`Failed to fetch iCal: ${feed.name}`, err); }
    }

    setExternalEvents(allExternal);
    try {
      await calendarStore.set("ical_cache_time", now);
      await calendarStore.set("ical_cache_events", allExternal);
      await calendarStore.save();
    } catch {}

    setLoading(false);
  };

  const handleToggleTask = async (eventId: string, currentCompleted: boolean) => {
    const task = scannedTasks.find(t => t.id === eventId);
    if (!task) return;
    const target = !currentCompleted;
    try {
      await toggleTaskInNote(task);
      const update = (evts: CalendarEvent[]) =>
        evts.map(e => e.id === eventId && e.calendarId === "tasks"
          ? { ...e, completed: target, summary: `${target ? "✅" : "☑️"} ${task.content}` }
          : e);
      setEvents(update);
      refreshFiles();
    } catch (err) { console.error("Failed to toggle task:", err); }
  };

  const handleLinkCalendar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedName.trim() || !feedUrl.trim()) return;
    const newFeed: CalendarFeed = { id: Math.random().toString(36).substring(2,9), name: feedName, url: feedUrl, color: feedColor, visible: true };
    const updatedFeeds = [...feeds, newFeed];
    setFeeds(updatedFeeds);
    await calendarStore.set("feeds", updatedFeeds);
    await calendarStore.save();
    setFeedName(""); setFeedUrl(""); setIsLinkModalOpen(false);
    await fetchExternalFeeds(updatedFeeds);
  };

  const handleDeleteCalendar = async (feedId: string) => {
    const updatedFeeds = feeds.filter(f => f.id !== feedId);
    setFeeds(updatedFeeds);
    await calendarStore.set("feeds", updatedFeeds);
    await calendarStore.save();
    setExternalEvents(prev => prev.filter(e => e.calendarId !== feedId));
  };

  const handleToggleFeedVisibility = async (feedId: string) => {
    const updatedFeeds = feeds.map(f => f.id === feedId ? { ...f, visible: !f.visible } : f);
    setFeeds(updatedFeeds);
    await calendarStore.set("feeds", updatedFeeds);
    await calendarStore.save();
    await fetchExternalFeeds(updatedFeeds);
  };

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventSummary.trim() || !selectedDayStr) return;
    const newEvent: CalendarEvent = {
      id: Math.random().toString(36).substring(2,9),
      calendarId: "local", summary: eventSummary,
      description: eventDesc || undefined,
      location: eventLoc || undefined,
      date: selectedDayStr,
      startTime: eventStartTime || undefined,
      endTime: eventEndTime || undefined,
      color: eventColor,
    };
    const savedLocal = (await calendarStore.get<CalendarEvent[]>("local_events")) || [];
    const updatedLocal = [...savedLocal, newEvent];
    await calendarStore.set("local_events", updatedLocal);
    await calendarStore.save();
    setLocalEvents(updatedLocal);
    setEventSummary(""); setEventDesc(""); setEventLoc(""); setEventStartTime(""); setEventEndTime("");
    setIsEventModalOpen(false);
  };

  const handleDeleteEvent = async (eventId: string) => {
    const savedLocal = (await calendarStore.get<CalendarEvent[]>("local_events")) || [];
    const updatedLocal = savedLocal.filter(e => e.id !== eventId);
    await calendarStore.set("local_events", updatedLocal);
    await calendarStore.save();
    setLocalEvents(updatedLocal);
  };

  const triggerRefresh = useCallback(async () => {
    await fetchExternalFeeds(feeds);
  }, [feeds]);

  useEffect(() => {
    registerSyncHandler("calendar-refresh", async () => { await triggerRefresh(); }, "Sync Calendar & iCal Feeds");
    return () => unregisterSyncHandler("calendar-refresh");
  }, [registerSyncHandler, unregisterSyncHandler, triggerRefresh]);

  const hasDailyNote = (dateStr: string) => getDailyNoteFile(dateStr) !== null;

  const handleDayClick = (dateStr: string) => {
    setSelectedDayStr(dateStr);
  };

  // ── Navigation ──────────────────────────────────────────────────────────────
  const navigate = useCallback((dir: -1 | 1) => {
    setCurrentDate(d => {
      const next = new Date(d);
      if (viewMode === "month") next.setMonth(next.getMonth() + dir);
      else if (viewMode === "week") next.setDate(next.getDate() + dir * 7);
      else if (viewMode === "3day") next.setDate(next.getDate() + dir * 3);
      else next.setDate(next.getDate() + dir);
      return next;
    });
  }, [viewMode]);

  const navigateToday = () => setCurrentDate(new Date());

  const getHeaderLabel = (): string => {
    if (viewMode === "month") return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    if (viewMode === "day") {
      const dayIdx = (currentDate.getDay() + 6) % 7;
      return `${DAY_NAMES_FULL[dayIdx]}, ${currentDate.getDate()} ${MONTH_SHORT[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
    }
    const start = viewMode === "week" ? getWeekStart(currentDate) : currentDate;
    const end = addDays(start, viewMode === "week" ? 6 : 2);
    return `${start.getDate()} ${MONTH_SHORT[start.getMonth()]} – ${end.getDate()} ${MONTH_SHORT[end.getMonth()]} ${end.getFullYear()}`;
  };

  // ── Grid & Filtered Events ──────────────────────────────────────────────────
  const filteredEvents = useMemo(() => {
    if (activeCategoryFilter === "all") return events;
    if (activeCategoryFilter === "tasks") return events.filter(e => e.calendarId === "tasks");
    if (activeCategoryFilter === "due-notes") return events.filter(e => e.calendarId === "due-notes");
    if (activeCategoryFilter === "local") return events.filter(e => e.calendarId === "local");
    if (activeCategoryFilter === "external") return events.filter(e => e.calendarId !== "tasks" && e.calendarId !== "due-notes" && e.calendarId !== "local");
    return events;
  }, [events, activeCategoryFilter]);

  const getMonthDays = () => {
    const year = currentDate.getFullYear(), month = currentDate.getMonth();
    const firstDayRaw = new Date(year, month, 1).getDay();
    const firstDayIndex = (firstDayRaw + 6) % 7;
    const totalDays = new Date(year, month + 1, 0).getDate();
    const prevTotal = new Date(year, month, 0).getDate();
    const days: { date: Date; isCurrentMonth: boolean }[] = [];
    for (let i = firstDayIndex - 1; i >= 0; i--) days.push({ date: new Date(year, month-1, prevTotal-i), isCurrentMonth: false });
    for (let i = 1; i <= totalDays; i++) days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) days.push({ date: new Date(year, month+1, i), isCurrentMonth: false });
    return days;
  };

  const getMiniCalDays = (year: number, month: number) => {
    const firstDayRaw = new Date(year, month, 1).getDay();
    const firstDayIndex = (firstDayRaw + 6) % 7;
    const totalDays = new Date(year, month + 1, 0).getDate();
    const prevTotal = new Date(year, month, 0).getDate();
    const days: { date: Date; isCurrentMonth: boolean }[] = [];
    for (let i = firstDayIndex - 1; i >= 0; i--) days.push({ date: new Date(year, month-1, prevTotal-i), isCurrentMonth: false });
    for (let i = 1; i <= totalDays; i++) days.push({ date: new Date(year, month, i), isCurrentMonth: true });
    const remaining = 35 - days.length;
    for (let i = 1; i <= remaining; i++) days.push({ date: new Date(year, month+1, i), isCurrentMonth: false });
    return days;
  };

  const getViewDays = (): Date[] => {
    if (viewMode === "day") return [currentDate];
    if (viewMode === "3day") return [0,1,2].map(i => addDays(currentDate, i));
    const start = getWeekStart(currentDate);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  };

  const now = new Date();
  const nowTop = (now.getHours() + now.getMinutes()/60) * HOUR_HEIGHT;

  // ── Categorized Agenda Items for Sidebar ──────────────────────────────────
  const agendaTimeline = useMemo(() => {
    const overdueList: CalendarEvent[] = [];
    const todayList: CalendarEvent[] = [];
    const tomorrowList: CalendarEvent[] = [];
    const upcomingList: CalendarEvent[] = [];

    const tomStr = toLocalDateStr(addDays(new Date(), 1));

    filteredEvents.forEach(e => {
      if (e.date < todayStr && !e.completed) {
        overdueList.push(e);
      } else if (e.date === todayStr) {
        todayList.push(e);
      } else if (e.date === tomStr) {
        tomorrowList.push(e);
      } else if (e.date > tomStr) {
        upcomingList.push(e);
      }
    });

    const sortFn = (a: CalendarEvent, b: CalendarEvent) =>
      (a.date + (a.startTime || "00:00")).localeCompare(b.date + (b.startTime || "00:00"));

    return {
      overdue: overdueList.sort(sortFn),
      today: todayList.sort(sortFn),
      tomorrow: tomorrowList.sort(sortFn),
      upcoming: upcomingList.sort(sortFn)
    };
  }, [filteredEvents, todayStr]);

  const VIEW_MODES: { key: CalendarViewMode; label: string; icon: React.ReactNode }[] = [
    { key: "day",   label: "Day",   icon: <Square className="h-3 w-3" /> },
    { key: "3day",  label: "3D",    icon: <Columns3 className="h-3 w-3" /> },
    { key: "week",  label: "Week",  icon: <Rows3 className="h-3 w-3" /> },
    { key: "month", label: "Month", icon: <LayoutGrid className="h-3 w-3" /> },
  ];

  const miniYear  = currentDate.getFullYear();
  const miniMonth = currentDate.getMonth();
  const miniDays  = getMiniCalDays(miniYear, miniMonth);

  // ─── Event Pill Component ────────────────────────────────────────────────
  const EventPill = ({ evt, compact = false }: { evt: CalendarEvent; compact?: boolean }) => {
    const isTask = evt.calendarId === "tasks";
    const isDueNote = evt.calendarId === "due-notes";
    const completed = evt.completed || (isTask && evt.summary.startsWith("✅"));
    const label = isTask ? evt.summary.replace(/^([✅☑️]\s*)?/, "") : evt.summary;

    const highlightColor = getPriorityHighlightColor(evt.priority, getEventColor(evt, feeds));

    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          setActiveDetailEvent(evt);
        }}
        className={`flex items-center gap-1 rounded-md px-1.5 ${compact ? "py-0.5" : "py-1"} text-[9.5px] font-semibold truncate cursor-pointer hover:opacity-90 transition-all border-l-2 shadow-sm ${
          evt.priority === "high" ? "bg-rose-500/15 border-rose-500 text-rose-300" :
          evt.priority === "medium" ? "bg-amber-500/15 border-amber-500 text-amber-300" :
          evt.priority === "low" ? "bg-sky-500/15 border-sky-400 text-sky-300" :
          "bg-slate-500/15 border-slate-500 text-slate-300"
        }`}
        style={{
          background: highlightColor + "20",
          borderLeftColor: highlightColor,
          color: getTextColorForCalendarEvent(highlightColor, isDark) ?? (evt.priority && evt.priority !== "none" ? undefined : "#cbd5e1")
        }}
        title={evt.summary}
      >
        {isTask ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleToggleTask(evt.id, !!completed);
            }}
            className="shrink-0 cursor-pointer"
          >
            {completed ? <CheckSquare className="h-3 w-3 text-emerald-500 dark:text-emerald-400" /> : <Square className="h-3 w-3 text-slate-500 dark:text-slate-400" />}
          </button>
        ) : isDueNote ? (
          getNoteIcon(evt, noteCache, "h-3 w-3 shrink-0")
        ) : null}

        {/* For notes: show the board status icon. For tasks: highlight color indicates priority */}
        {isDueNote && getBoardStatusIcon(evt.status, "h-2.5 w-2.5 shrink-0")}
        
        <span className={`truncate ${completed ? "line-through opacity-60" : ""}`} style={{ color: getTextColorForCalendarEvent(highlightColor, isDark) }}>{label}</span>
        {evt.startTime && !compact && <span className="ml-auto shrink-0 font-mono text-[8.5px] opacity-75">{formatTime12(evt.startTime)}</span>}
      </div>
    );
  };

  // ─── Sidebar Event Item Component ─────────────────────────────────────────
  const SidebarEventItem = ({ evt }: { evt: CalendarEvent }) => {
    const isTask = evt.calendarId === "tasks";
    const isDueNote = evt.calendarId === "due-notes";
    const completed = evt.completed || (isTask && evt.summary.startsWith("✅"));
    const label = isTask ? evt.summary.replace(/^([✅☑️]\s*)?/, "") : evt.summary;
    const highlightColor = getPriorityHighlightColor(evt.priority, getEventColor(evt, feeds));

    return (
      <div className="flex items-start gap-2 group py-2 border-b border-card-border/60 last:border-0 hover:bg-card-hover px-2 rounded-lg transition-colors">
        <span className="h-2 w-2 rounded-full mt-1.5 shrink-0" style={{ background: highlightColor }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            {isTask ? (
              <label className="flex items-center gap-1.5 cursor-pointer min-w-0">
                <input
                  type="checkbox"
                  checked={!!completed}
                  onChange={() => handleToggleTask(evt.id, !!completed)}
                  className="h-3.5 w-3.5 rounded accent-indigo-500 cursor-pointer shrink-0"
                />
                <span className={`text-[11px] font-semibold leading-snug truncate ${completed ? "line-through text-slate-400 dark:text-slate-500" : "text-slate-800 dark:text-slate-200"}`}>
                  {label}
                </span>
              </label>
            ) : isDueNote ? (
              <button
                onClick={() => evt.noteName && openNoteByName(evt.noteName)}
                className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-800 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-300 leading-snug truncate text-left cursor-pointer min-w-0"
              >
                {getNoteIcon(evt, noteCache, "h-3.5 w-3.5 shrink-0")}
                <span className={`truncate ${completed ? "line-through opacity-60 text-slate-400" : ""}`}>{evt.noteName}</span>
              </button>
            ) : (
              <span className={`text-[11px] font-semibold text-slate-800 dark:text-slate-200 leading-snug truncate ${completed ? "line-through opacity-60" : ""}`}>{label}</span>
            )}

            <div className="flex items-center gap-1 shrink-0">
              {/* For Notes: Show Board Status Badge & Icon */}
              {isDueNote && (
                <span className="flex items-center gap-1 text-[8.5px] font-extrabold uppercase px-1.5 py-0.5 rounded border border-card-border bg-card">
                  {getBoardStatusIcon(evt.status, "h-2.5 w-2.5")}
                  <span className="text-slate-300 capitalize">{evt.status || "none"}</span>
                </span>
              )}

              {(isTask || isDueNote || evt.noteName) && (
                <button
                  onClick={() => {
                    const name = evt.noteName || (isTask ? scannedTasks.find(t => t.id === evt.id)?.noteName : undefined);
                    if (name) openNoteByName(name);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-slate-500 hover:text-indigo-400 rounded cursor-pointer transition-opacity"
                  title="Open Note"
                >
                  <ExternalLink className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 mt-1 text-[9.5px] text-slate-400 font-mono">
            {evt.date && <span className="text-slate-500">{evt.date}</span>}
            {evt.startTime && (
              <span className="flex items-center gap-1 text-slate-400">
                <Clock className="h-2.5 w-2.5 text-indigo-400" />
                {formatTime12(evt.startTime)}{evt.endTime ? `–${formatTime12(evt.endTime)}` : ""}
              </span>
            )}
            {evt.location && (
              <span className="flex items-center gap-1 text-slate-400 truncate">
                <MapPin className="h-2.5 w-2.5 text-indigo-400" />
                {evt.location}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ════════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex h-full w-full bg-background text-slate-200 select-none overflow-hidden font-sans">

      {/* ══ SIDEBAR ═══════════════════════════════════════════════════════════ */}
      <div className="w-72 border-r border-card-border bg-sidebar flex flex-col shrink-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-0">

          {/* Header */}
          <div className="px-4 pt-4 pb-3 border-b border-card-border/60">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] font-extrabold text-indigo-400 tracking-widest uppercase flex items-center gap-1.5">
                <CalendarIcon className="h-3.5 w-3.5" /> Calendar
              </span>
              {loading && <span className="text-[9px] text-indigo-400 animate-pulse font-semibold">SYNCING...</span>}
            </div>
          </div>

          {/* ── Mini Calendar ─────────────────────────────────────────────── */}
          <div className="px-3 py-3 border-b border-card-border/60">
            <div className="flex items-center justify-between mb-2">
              <button onClick={() => setCurrentDate(d => { const n = new Date(d); n.setMonth(n.getMonth()-1); return n; })} className="p-1 rounded-md hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">
                <ChevronLeft className="h-3 w-3" />
              </button>
              <span className="text-[10px] font-bold text-slate-300 tracking-wide">
                {MONTH_SHORT[miniMonth]} {miniYear}
              </span>
              <button onClick={() => setCurrentDate(d => { const n = new Date(d); n.setMonth(n.getMonth()+1); return n; })} className="p-1 rounded-md hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-colors cursor-pointer">
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
            <div className="grid grid-cols-7 mb-1">
              {["M","T","W","T","F","S","S"].map((d,i) => (
                <div key={i} className="text-center text-[8.5px] font-bold text-slate-600 uppercase">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-0.5">
              {miniDays.map((day, idx) => {
                const ds = toLocalDateStr(day.date);
                const isToday = ds === todayStr;
                const isSelected = ds === selectedDayStr;
                const dayEvts = events.filter(e => e.date === ds);
                const hasHighPrio = dayEvts.some(e => e.priority === "high");
                const hasEvts = dayEvts.length > 0;
                return (
                  <button
                    key={idx}
                    onClick={() => { handleDayClick(ds); setCurrentDate(day.date); }}
                    onDoubleClick={() => openDailyNote(ds)}
                    className={`relative flex flex-col items-center justify-center rounded-md h-6 w-full text-[9.5px] font-semibold transition-all cursor-pointer
                      ${!day.isCurrentMonth ? "text-slate-700" : isSelected ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/40" : isToday ? "text-indigo-400 font-extrabold" : "text-slate-400 hover:text-slate-200 hover:bg-[#1a1d28]"}
                    `}
                  >
                    {isToday && !isSelected && <span className="absolute inset-0 rounded-md border border-indigo-500/50" />}
                    {day.date.getDate()}
                    {hasEvts && !isSelected && (
                      <span className={`absolute bottom-0.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full ${hasHighPrio ? "bg-rose-500" : "bg-indigo-400 opacity-70"}`} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Category Filters & Source Toggles ─────────────────────────── */}
          <div className="px-3 py-2.5 border-b border-card-border/60 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-extrabold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                <Filter className="h-2.5 w-2.5 text-indigo-400" /> Category Filter
              </span>
              <span className="text-[9px] font-mono text-slate-500">{filteredEvents.length} items</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {(["all", "tasks", "due-notes", "local", "external"] as CategoryFilter[]).map(cat => (
                <button
                  key={cat}
                  onClick={() => setActiveCategoryFilter(cat)}
                  className={`px-2 py-0.5 rounded text-[9.5px] font-bold transition-all cursor-pointer border capitalize ${
                    activeCategoryFilter === cat
                      ? "bg-indigo-600 border-indigo-500 text-white shadow-sm"
                      : "bg-card border-card-border text-slate-400 hover:text-slate-200 hover:border-slate-700"
                  }`}
                >
                  {cat.replace("-", " ")}
                </button>
              ))}
            </div>
          </div>

          {/* ── Agenda & Timeline Section ─────────────────────────────────── */}
          <div className="flex-1 px-3 py-3 flex flex-col gap-3 overflow-y-auto min-h-0 custom-scrollbar">
            <div className="flex items-center justify-between">
              <span className="text-[9.5px] font-extrabold text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                <Sparkles className="h-3 w-3 text-amber-400" /> Agenda Timeline
              </span>
              {selectedDayStr && (
                <button
                  onClick={() => setIsEventModalOpen(true)}
                  className="flex items-center gap-1 text-[9px] font-bold text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer bg-indigo-500/10 px-1.5 py-0.5 rounded"
                >
                  <Plus className="h-2.5 w-2.5" /> Add Event
                </button>
              )}
            </div>

            {/* Overdue Section */}
            {agendaTimeline.overdue.length > 0 && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-2 flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-rose-400 text-[10px] font-extrabold uppercase tracking-wider pb-1 border-b border-rose-500/20">
                  <AlertTriangle className="h-3 w-3" /> Overdue ({agendaTimeline.overdue.length})
                </div>
                <div className="flex flex-col">
                  {agendaTimeline.overdue.map(evt => <SidebarEventItem key={evt.id} evt={evt} />)}
                </div>
              </div>
            )}

            {/* Today Section */}
            <div>
              <div className="flex items-center justify-between text-[10px] font-extrabold text-fuchsia-400 uppercase tracking-wider mb-1">
                <span>Today ({agendaTimeline.today.length})</span>
                {hasDailyNote(todayStr) && (
                  <button
                    onClick={() => openDailyNote(todayStr)}
                    className="text-[9px] text-fuchsia-400 hover:text-fuchsia-300 flex items-center gap-0.5 cursor-pointer"
                  >
                    <FileText className="h-2.5 w-2.5" /> Daily Note
                  </button>
                )}
              </div>
              {agendaTimeline.today.length === 0 ? (
                <div className="text-[9.5px] text-slate-600 italic px-1">No events scheduled today</div>
              ) : (
                <div className="flex flex-col">
                  {agendaTimeline.today.map(evt => <SidebarEventItem key={evt.id} evt={evt} />)}
                </div>
              )}
            </div>

            {/* Tomorrow Section */}
            <div>
              <div className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1">
                Tomorrow ({agendaTimeline.tomorrow.length})
              </div>
              {agendaTimeline.tomorrow.length === 0 ? (
                <div className="text-[9.5px] text-slate-600 italic px-1">No events tomorrow</div>
              ) : (
                <div className="flex flex-col">
                  {agendaTimeline.tomorrow.map(evt => <SidebarEventItem key={evt.id} evt={evt} />)}
                </div>
              )}
            </div>

            {/* Upcoming Section */}
            {agendaTimeline.upcoming.length > 0 && (
              <div>
                <div className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider mb-1">
                  Upcoming ({agendaTimeline.upcoming.length})
                </div>
                <div className="flex flex-col">
                  {agendaTimeline.upcoming.slice(0, 10).map(evt => <SidebarEventItem key={evt.id} evt={evt} />)}
                </div>
              </div>
            )}
          </div>

          {/* ── My Calendars / Feeds ──────────────────────────────────────── */}
          <div className="px-3 py-3 border-t border-card-border/60 bg-sidebar">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Calendars & Feeds</span>
              <button onClick={() => setIsLinkModalOpen(true)} className="p-1 rounded-md hover:bg-card-hover text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 transition-colors cursor-pointer" title="Add iCal Feed">
                <Plus className="h-3 w-3" />
              </button>
            </div>
            <div className="flex flex-col gap-1 text-[10.5px]">
              <div className="flex items-center gap-2 px-2 py-1 rounded bg-card border border-card-border">
                <span className="h-2 w-2 rounded-full bg-indigo-500 shrink-0" />
                <span className="text-slate-700 dark:text-slate-200 flex-1 font-medium">Note Tasks</span>
                {getCategoryIcon("tasks", "h-2.5 w-2.5")}
              </div>
              <div className="flex items-center gap-2 px-2 py-1 rounded bg-card border border-card-border">
                <span className="h-2 w-2 rounded-full bg-[#d946ef] shrink-0" />
                <span className="text-slate-700 dark:text-slate-200 flex-1 font-medium">Due Notes</span>
                {getCategoryIcon("due-notes", "h-2.5 w-2.5")}
              </div>
              {feeds.map(feed => (
                <div key={feed.id} className="flex items-center gap-2 px-2 py-1 rounded bg-card border border-card-border group">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: feed.color }} />
                  <span className="text-slate-700 dark:text-slate-200 flex-1 truncate font-medium">{feed.name}</span>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button onClick={() => handleToggleFeedVisibility(feed.id)} className="p-0.5 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded cursor-pointer" title={feed.visible ? "Hide" : "Show"}>
                      {feed.visible ? <Eye className="h-2.5 w-2.5" /> : <EyeOff className="h-2.5 w-2.5 text-slate-600" />}
                    </button>
                    <button onClick={() => handleDeleteCalendar(feed.id)} className="p-0.5 text-slate-500 hover:text-red-500 rounded cursor-pointer">
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ══ MAIN CALENDAR VIEW ════════════════════════════════════════════════ */}
      <div className="flex-1 h-full flex flex-col min-w-0">

        {/* ── Toolbar ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-card-border px-5 py-2.5 shrink-0 bg-sidebar backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-0.5 bg-card p-0.5 rounded-lg border border-card-border">
              <button onClick={() => navigate(-1)} className="p-1.5 hover:bg-card-hover text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 rounded-md transition-colors cursor-pointer" title="Previous (←)">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button onClick={navigateToday} className="px-2.5 py-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 text-xs font-bold rounded-md hover:bg-card-hover transition-colors cursor-pointer" title="Today (T)">
                Today
              </button>
              <button onClick={() => navigate(1)} className="p-1.5 hover:bg-card-hover text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 rounded-md transition-colors cursor-pointer" title="Next (→)">
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
            <h1 className="text-sm font-extrabold tracking-tight text-foreground min-w-50">
              {getHeaderLabel()}
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => selectedDayStr && setIsEventModalOpen(true)}
              title={selectedDayStr ? `Add event on ${selectedDayStr}` : "Click a day first to add an event"}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer select-none ${
                selectedDayStr
                  ? "bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30"
                  : "bg-card border border-card-border text-slate-400 cursor-default"
              }`}
            >
              <Plus className="h-3.5 w-3.5" />
              Add Event
            </button>

            <div className="flex items-center gap-0.5 bg-card p-0.5 rounded-lg border border-card-border">
              {VIEW_MODES.map(vm => (
                <button
                  key={vm.key}
                  onClick={() => setViewMode(vm.key)}
                  className={`flex items-center gap-1 px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                    viewMode === vm.key
                      ? "bg-indigo-600 text-white shadow-sm"
                      : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-card-hover"
                  }`}
                >
                  {vm.icon}
                  {vm.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Month Grid View ─────────────────────────────────────────────── */}
        {viewMode === "month" && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="grid grid-cols-7 border-b border-card-border bg-sidebar shrink-0">
              {DAY_NAMES_SHORT.map((d, i) => (
                <div key={i} className="py-2 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  {d}
                </div>
              ))}
            </div>
            <div className="flex-1 grid grid-cols-7 grid-rows-6 border-b border-card-border bg-background">
              {getMonthDays().map((day, idx) => {
                const ds = toLocalDateStr(day.date);
                const isToday = ds === todayStr;
                const isSelected = ds === selectedDayStr;
                const dayEvts = filteredEvents.filter(e => e.date === ds);
                const dailyFile = getDailyNoteFile(ds);
                const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;

                // Sort day events: completed tasks/notes last, active ordered by start time
                const sortedDayEvts = [...dayEvts].sort((a, b) => {
                  if (a.completed !== b.completed) return a.completed ? 1 : -1;
                  const timeA = a.startTime || "00:00";
                  const timeB = b.startTime || "00:00";
                  return timeA.localeCompare(timeB);
                });

                return (
                  <div
                    key={idx}
                    onClick={() => handleDayClick(ds)}
                    onDoubleClick={() => openDailyNote(ds)}
                    className={`group relative flex flex-col p-1.5 border-r border-b border-card-border overflow-hidden transition-colors cursor-pointer ${
                      !day.isCurrentMonth
                        ? "bg-card/40 text-slate-400"
                        : isSelected
                        ? "bg-indigo-600/20 text-foreground ring-1 ring-inset ring-indigo-500/50"
                        : isWeekend
                        ? "bg-sidebar"
                        : "bg-background hover:bg-card-hover"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className={`inline-flex items-center justify-center text-[11px] font-extrabold h-5 w-5 rounded-full transition-all ${
                          isToday
                            ? "bg-fuchsia-600 text-white font-extrabold shadow-md shadow-fuchsia-600/40"
                            : isSelected
                            ? "bg-indigo-600 text-white"
                            : !day.isCurrentMonth
                            ? "text-slate-400 dark:text-slate-600"
                            : "text-foreground font-bold"
                        }`}
                      >
                        {day.date.getDate()}
                      </span>
                      {dailyFile && (
                        <span title="Daily Note Exists" className="h-1.5 w-1.5 rounded-full bg-fuchsia-400" />
                      )}
                    </div>

                    {/* Day Events Stack */}
                    <div className="flex-1 flex flex-col gap-1 overflow-y-auto custom-scrollbar">
                      {sortedDayEvts.slice(0, 4).map(evt => (
                        <EventPill key={evt.id} evt={evt} compact />
                      ))}
                      {sortedDayEvts.length > 4 && (
                        <span className="text-[8.5px] font-bold text-indigo-400 pl-1">
                          +{sortedDayEvts.length - 4} more
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Time Grid View (Week / 3Day / Day) ───────────────────────────── */}
        {viewMode !== "month" && (
          <div ref={timeGridRef} className="flex-1 overflow-y-auto custom-scrollbar flex flex-col bg-background">
            <div className="flex border-b border-card-border bg-sidebar sticky top-0 z-20 shrink-0 shadow-xs">
              <div className="w-14 border-r border-card-border shrink-0 flex items-center justify-center text-[9px] font-bold text-slate-500 uppercase tracking-widest px-1">
                All-day
              </div>
              {getViewDays().map((day, idx) => {
                const ds = toLocalDateStr(day);
                const isToday = ds === todayStr;
                const dayIdx = (day.getDay() + 6) % 7;
                const allDayEvts = filteredEvents.filter(e => e.date === ds && !e.startTime);

                return (
                  <div key={idx} className="flex-1 py-2 px-1 text-center border-r border-card-border last:border-r-0 flex flex-col gap-1 min-w-0">
                    <div>
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                        {DAY_NAMES_SHORT[dayIdx]}
                      </span>
                      <span className={`inline-flex items-center justify-center text-xs font-extrabold h-6 w-6 rounded-full mt-0.5 ${
                        isToday ? "bg-fuchsia-600 text-white shadow-md shadow-fuchsia-600/40" : "text-foreground font-bold"
                      }`}>
                        {day.getDate()}
                      </span>
                    </div>

                    {/* All-Day Events Banner (Date-Only Notes & Tasks) */}
                    {allDayEvts.length > 0 && (
                      <div className="flex flex-col gap-1 mt-1 max-h-24 overflow-y-auto custom-scrollbar text-left">
                        {allDayEvts.map(evt => {
                          const color = getPriorityHighlightColor(evt.priority, getEventColor(evt, feeds));
                          const isTask = evt.calendarId === "tasks";
                          const isDueNote = evt.calendarId === "due-notes";
                          const completed = evt.completed;

                          return (
                            <div
                              key={evt.id}
                              onClick={() => setActiveDetailEvent(evt)}
                              style={{
                                borderColor: color,
                                backgroundColor: color + "25"
                              }}
                              className="rounded-md border-l-3 px-1.5 py-1 shadow-xs hover:brightness-125 transition-all text-[10px] font-semibold flex items-center gap-1.5 cursor-pointer truncate"
                            >
                              {isTask ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleTask(evt.id, !!completed);
                                  }}
                                  className="shrink-0 cursor-pointer"
                                >
                                  {completed ? <CheckSquare className="h-3 w-3 text-emerald-400" /> : <Square className="h-3 w-3 text-slate-400" />}
                                </button>
                              ) : isDueNote ? (
                                getNoteIcon(evt, noteCache, "h-3 w-3 shrink-0")
                              ) : null}

                              {isDueNote && getBoardStatusIcon(evt.status, "h-2.5 w-2.5 shrink-0")}

                              <span className={`truncate ${completed ? "line-through opacity-60" : ""}`} style={{ color: getTextColorForCalendarEvent(color, isDark) ?? color }}>
                                {isTask ? evt.summary.replace(/^([✅☑️]\s*)?/, "") : evt.summary}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Time Grid Rows */}
            <div className="relative flex flex-1">
              {/* Time Column */}
              <div className="w-14 border-r border-card-border bg-sidebar shrink-0">
                {HOURS.map(h => (
                  <div key={h} className="h-16 text-right pr-2 pt-1 text-[9.5px] font-mono font-semibold text-slate-500 border-b border-card-border/60">
                    {formatHour(h)}
                  </div>
                ))}
              </div>

              {/* Day Time Columns */}
              <div className="flex-1 flex relative">
                {getViewDays().map((day, idx) => {
                  const ds = toLocalDateStr(day);
                  const isToday = ds === todayStr;
                  const dayTimeEvts = filteredEvents.filter(e => e.date === ds && !!e.startTime);
                  const positionedEvts = computeDayEventPositions(dayTimeEvts);

                  return (
                    <div key={idx} className="flex-1 border-r border-card-border/60 relative min-w-0">
                      {HOURS.map(h => (
                        <div key={h} className="h-16 border-b border-card-border/60" />
                      ))}

                      {/* Current Time Indicator Line */}
                      {isToday && (
                        <div
                          className="absolute left-0 right-0 z-20 border-t-2 border-fuchsia-500 pointer-events-none flex items-center"
                          style={{ top: `${nowTop}px` }}
                        >
                          <span className="h-2 w-2 rounded-full bg-fuchsia-500 -ml-1" />
                        </div>
                      )}

                      {/* Rendered Non-Clashing Time Grid Events */}
                      {positionedEvts.map(evt => {
                        const color = getPriorityHighlightColor(evt.priority, getEventColor(evt, feeds));
                        const isTask = evt.calendarId === "tasks";
                        const isDueNote = evt.calendarId === "due-notes";
                        const completed = evt.completed;

                        return (
                          <div
                            key={evt.id}
                            onClick={() => setActiveDetailEvent(evt)}
                            style={{
                              top: `${evt.top}px`,
                              height: `${evt.height}px`,
                              left: `calc(${evt.leftPercent}% + 2px)`,
                              width: `calc(${evt.widthPercent}% - 4px)`,
                              borderColor: color,
                              backgroundColor: color + "20"
                            }}
                            className="absolute z-10 rounded-lg border-l-4 p-1.5 shadow-md overflow-hidden cursor-pointer hover:z-30 hover:brightness-125 transition-all text-xs flex flex-col justify-between"
                          >
                            <div className="flex items-center gap-1 min-w-0">
                              {isTask ? (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleTask(evt.id, !!completed);
                                  }}
                                  className="shrink-0 cursor-pointer"
                                >
                                  {completed ? <CheckSquare className="h-3 w-3 text-emerald-400" /> : <Square className="h-3 w-3 text-slate-400" />}
                                </button>
                              ) : isDueNote ? (
                                getNoteIcon(evt, noteCache, "h-3 w-3 shrink-0")
                              ) : null}

                              {isDueNote && getBoardStatusIcon(evt.status, "h-2.5 w-2.5 shrink-0")}

                              <span className={`font-extrabold truncate text-[10.5px] ${completed ? "line-through opacity-60" : ""}`} style={{ color: getTextColorForCalendarEvent(color, isDark) ?? color }}>
                                {isTask ? evt.summary.replace(/^([✅☑️]\s*)?/, "") : evt.summary}
                              </span>
                            </div>

                            {evt.startTime && (
                              <div className="text-[9px] font-mono text-slate-400 mt-0.5 truncate">
                                {formatTime12(evt.startTime)}{evt.endTime ? `–${formatTime12(evt.endTime)}` : ""}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ══ ADD FEED MODAL ════════════════════════════════════════════════════ */}
      {isLinkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm" onClick={() => setIsLinkModalOpen(false)}>
          <div className="w-105 rounded-2xl border border-card-border bg-card p-6 shadow-2xl text-foreground" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-extrabold text-foreground flex items-center gap-2">
                <Link2 className="h-4 w-4 text-indigo-400" /> Link iCal / Google Calendar
              </h3>
              <button onClick={() => setIsLinkModalOpen(false)} className="p-1 rounded-lg text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-card-hover cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-[10.5px] text-slate-500 mb-5">
              Paste a public or secret iCal (.ics) URL from Google Calendar, Outlook, or Apple Calendar.
            </p>
            <form onSubmit={handleLinkCalendar} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Calendar Name</label>
                <input type="text" required autoFocus placeholder="e.g. Work Calendar" value={feedName} onChange={e => setFeedName(e.target.value)}
                  className="rounded-lg bg-background p-2.5 text-xs text-foreground border border-card-border focus:outline-none focus:border-indigo-500/50 transition-colors placeholder-slate-400" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">iCal Feed URL</label>
                <input type="url" required placeholder="https://calendar.google.com/calendar/ical/..." value={feedUrl} onChange={e => setFeedUrl(e.target.value)}
                  className="rounded-lg bg-background p-2.5 text-xs text-foreground border border-card-border focus:outline-none focus:border-indigo-500/50 transition-colors placeholder-slate-400" />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Color</label>
                <div className="flex items-center gap-2">
                  {LOCAL_COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setFeedColor(c)}
                      className={`h-6 w-6 rounded-full border-2 transition-all cursor-pointer shrink-0 ${feedColor === c ? "border-indigo-600 scale-125 shadow-md" : "border-transparent hover:border-slate-400"}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button type="button" onClick={() => setIsLinkModalOpen(false)} className="flex-1 rounded-lg bg-sidebar border border-card-border py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-card-hover transition-colors cursor-pointer">
                  Cancel
                </button>
                <button type="submit" className="flex-1 rounded-lg bg-indigo-600 py-2 text-xs font-bold text-white hover:bg-indigo-500 transition-colors shadow-md shadow-indigo-600/30 cursor-pointer">
                  Save Feed
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ ADD EVENT MODAL ═══════════════════════════════════════════════════ */}
      {isEventModalOpen && selectedDayStr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm" onClick={() => setIsEventModalOpen(false)}>
          <div className="w-105 rounded-2xl border border-card-border bg-card p-6 shadow-2xl text-foreground" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-extrabold text-foreground flex items-center gap-2">
                <AlarmClock className="h-4 w-4 text-indigo-400" /> New Event
              </h3>
              <button onClick={() => setIsEventModalOpen(false)} className="p-1 rounded-lg text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-card-hover cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="text-[10.5px] text-slate-500 mb-5">
              Adding event for <span className="text-indigo-500 dark:text-indigo-400 font-semibold">{selectedDayStr}</span>
            </p>
            <form onSubmit={handleAddEvent} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Event Title</label>
                <input type="text" required autoFocus placeholder="e.g. Design Review" value={eventSummary} onChange={e => setEventSummary(e.target.value)}
                  className="rounded-lg bg-background p-2.5 text-xs text-foreground border border-card-border focus:outline-none focus:border-indigo-500/50 transition-colors placeholder-slate-400" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1"><Clock className="h-3 w-3" /> Start Time</label>
                  <input type="time" value={eventStartTime} onChange={e => setEventStartTime(e.target.value)}
                    className="rounded-lg bg-background p-2.5 text-xs text-foreground border border-card-border focus:outline-none focus:border-indigo-500/50 transition-colors" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1"><Clock className="h-3 w-3" /> End Time</label>
                  <input type="time" value={eventEndTime} onChange={e => setEventEndTime(e.target.value)}
                    className="rounded-lg bg-background p-2.5 text-xs text-foreground border border-card-border focus:outline-none focus:border-indigo-500/50 transition-colors" />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1"><MapPin className="h-3 w-3" /> Location</label>
                <input type="text" placeholder="e.g. Room 204 or Online" value={eventLoc} onChange={e => setEventLoc(e.target.value)}
                  className="rounded-lg bg-background p-2.5 text-xs text-foreground border border-card-border focus:outline-none focus:border-indigo-500/50 transition-colors placeholder-slate-400" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Notes</label>
                <textarea placeholder="Optional description..." value={eventDesc} onChange={e => setEventDesc(e.target.value)} rows={2}
                  className="rounded-lg bg-background p-2.5 text-xs text-foreground border border-card-border focus:outline-none focus:border-indigo-500/50 transition-colors resize-none placeholder-slate-400" />
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Color</label>
                <div className="flex items-center gap-2">
                  {LOCAL_COLORS.map(c => (
                    <button key={c} type="button" onClick={() => setEventColor(c)}
                      className={`h-6 w-6 rounded-full border-2 transition-all cursor-pointer shrink-0 ${eventColor === c ? "border-indigo-600 scale-125 shadow-md" : "border-transparent hover:border-slate-400"}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button type="button" onClick={() => setIsEventModalOpen(false)} className="flex-1 rounded-lg bg-sidebar border border-card-border py-2 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-card-hover transition-colors cursor-pointer">
                  Cancel
                </button>
                <button type="submit" className="flex-1 rounded-lg bg-indigo-600 py-2 text-xs font-bold text-white hover:bg-indigo-500 transition-colors shadow-md shadow-indigo-600/30 cursor-pointer">
                  Create Event
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ EVENT DETAIL MODAL ═══════════════════════════════════════════════ */}
      {activeDetailEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm animate-fade-in" onClick={() => setActiveDetailEvent(null)}>
          <div className="w-105 rounded-2xl border border-card-border bg-card p-6 shadow-2xl flex flex-col gap-4 text-xs text-foreground" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border" style={{ color: getPriorityHighlightColor(activeDetailEvent.priority, getEventColor(activeDetailEvent, feeds)), borderColor: getPriorityHighlightColor(activeDetailEvent.priority, getEventColor(activeDetailEvent, feeds)) + "40", backgroundColor: getPriorityHighlightColor(activeDetailEvent.priority, getEventColor(activeDetailEvent, feeds)) + "15" }}>
                {activeDetailEvent.calendarId === "tasks" ? "Note Task" : activeDetailEvent.calendarId === "due-notes" ? "Due Note" : activeDetailEvent.calendarId === "local" ? "Local Event" : "Calendar Feed"}
              </span>
              <button onClick={() => setActiveDetailEvent(null)} className="p-1 rounded-lg text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-card-hover cursor-pointer">
                <X className="h-4 w-4" />
              </button>
            </div>

            <h3 className="text-sm font-extrabold text-foreground leading-snug">
              {activeDetailEvent.summary}
            </h3>

            <div className="flex flex-col gap-2 bg-background p-3 rounded-xl border border-card-border text-foreground">
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                <Clock className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400 shrink-0" />
                <span>{activeDetailEvent.date} {activeDetailEvent.startTime ? `@ ${formatTime12(activeDetailEvent.startTime)}` : ""}</span>
              </div>

              {activeDetailEvent.location && (
                <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 text-[11px]">
                  <MapPin className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400 shrink-0" />
                  <span>{activeDetailEvent.location}</span>
                </div>
              )}

              {activeDetailEvent.description && (
                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed pt-1 border-t border-card-border">
                  {activeDetailEvent.description}
                </p>
              )}
            </div>

            {/* Note & Task Quick Actions */}
            <div className="flex items-center justify-between pt-2">
              {(activeDetailEvent.noteName || activeDetailEvent.calendarId === "tasks" || activeDetailEvent.calendarId === "due-notes") && (() => {
                const scannedTask = scannedTasks.find(st => st.id === activeDetailEvent.id);
                const noteName = activeDetailEvent.noteName || (activeDetailEvent.calendarId === "tasks" ? scannedTask?.noteName : undefined);
                if (noteName) {
                  return (
                    <button
                      onClick={() => {
                        openNoteByName(noteName, {
                          scrollToLine: scannedTask?.lineNumber,
                          highlightText: scannedTask?.content || activeDetailEvent.summary
                        });
                        setActiveDetailEvent(null);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition cursor-pointer shadow-md"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Open Note [[{noteName}]]
                    </button>
                  );
                }
                return null;
              })()}

              {activeDetailEvent.calendarId === "local" && (
                <button
                  onClick={() => {
                    handleDeleteEvent(activeDetailEvent.id);
                    setActiveDetailEvent(null);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600/20 border border-red-500/40 hover:bg-red-600/30 text-red-600 dark:text-red-300 font-bold text-xs transition cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete Event
                </button>
              )}

              <button
                onClick={() => setActiveDetailEvent(null)}
                className="px-4 py-1.5 rounded-lg bg-sidebar border border-card-border hover:bg-card-hover text-slate-700 dark:text-slate-300 font-bold text-xs transition cursor-pointer ml-auto"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
