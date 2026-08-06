import React, { useEffect, useRef, useState, useCallback } from "react";
import { useVault, FileEntry } from "../contexts/VaultContext";
import { useSettings } from "../contexts/SettingsContext";
import { useSync } from "../contexts/SyncContext";
import { searchEngine } from "../lib/search-engine";
import { invokeIPC } from "../lib/ipc";
import { isArchivedPath, isTrashPath } from "../lib/task-scanner";
import {
  Folder,
  Tag,
  Waypoints,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Search,
  Sliders,
  Layers,
  EyeOff,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Pin,
  PinOff,
  Focus,
  X,
  FileText,
  Hash,
  Link2,
  GitBranch,
  BarChart3,
  Calendar,
  Bookmark,
  Sparkles,
  Palette,
  Globe,
  Paperclip,
  Save,
  RotateCcw,
  Check,
} from "lucide-react";

interface Node {
  id: string;
  label: string;
  type: "note" | "folder" | "tag-in-notes" | "url" | "attachment";
  subType?: "standard" | "daily";
  path?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  degree: number;
  pinned: boolean;
  bookmarked?: boolean;
  tasksTotal?: number;
  tasksCompleted?: number;
  highestPriority?: "high" | "medium" | "low" | "none";
  boardStatus?: "Backlog" | "Todo" | "In Progress" | "In Review" | "Done" | "none";
}

interface Link {
  source: string;
  target: string;
  type: "folder" | "tag-in-notes" | "backlink" | "url" | "attachment" | "semantic";
  similarity?: number;
}

interface FilterItem {
  id: "folders" | "tags" | "backlinks" | "urls" | "attachments" | "orphans" | "dailyNotes" | "bookmarks" | "semanticLinks";
  label: string;
  checked: boolean;
  color: string;
}

interface ContextMenu {
  x: number;
  y: number;
  node: Node;
}

interface TooltipInfo {
  node: Node;
  screenX: number;
  screenY: number;
  connections: number;
}

const DEFAULT_FILTERS: FilterItem[] = [
  { id: "tags", label: "Tags", checked: true, color: "text-slate-400/50" },
  { id: "dailyNotes", label: "Daily Notes", checked: true, color: "text-[#38bdf8]" },
  { id: "backlinks", label: "Backlinks", checked: true, color: "text-[#22d3ee]" },
  { id: "urls", label: "URLs", checked: true, color: "text-[#f43f5e]" },
  { id: "attachments", label: "Attachments", checked: true, color: "text-[#a855f7]" },
  { id: "folders", label: "Folders", checked: true, color: "text-[#fbbf24]" },
  { id: "orphans", label: "Show Orphans", checked: true, color: "text-[#d946ef]" },
  { id: "bookmarks", label: "Bookmarks Only", checked: false, color: "text-[#f59e0b]" },
];

const getInitialGraphSettings = () => {
  try {
    const saved = localStorage.getItem("kognote_graph_settings");
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error("Failed to parse saved graph settings:", e);
  }
  return null;
};

export const GraphView: React.FC = () => {
  const { files, noteCache, openFile, activeFile } = useVault();
  const { includeArchivedInScans } = useSettings();
  const { registerSyncHandler, unregisterSyncHandler } = useSync();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const initialSettings = getInitialGraphSettings();

  const [filters, setFilters] = useState<FilterItem[]>(initialSettings?.filters || DEFAULT_FILTERS);
  const [isConnectionFiltersOpen, setIsConnectionFiltersOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [colorScheme, setColorScheme] = useState<"category" | "priority" | "status">(initialSettings?.colorScheme || "category");

  // Semantic AI Settings
  const [isSemanticEnabled, setIsSemanticEnabled] = useState(initialSettings?.isSemanticEnabled ?? true);
  const [semanticThreshold, setSemanticThreshold] = useState(initialSettings?.semanticThreshold ?? 0.55);
  const [maxSemanticLinksPerNote, setMaxSemanticLinksPerNote] = useState(initialSettings?.maxSemanticLinksPerNote ?? 5);

  // Physics customization
  const [repulsion, setRepulsion] = useState(initialSettings?.repulsion ?? 2200);
  const [linkDistance, setLinkDistance] = useState(initialSettings?.linkDistance ?? 180);
  const [linkStrength, setLinkStrength] = useState(initialSettings?.linkStrength ?? 0.35);
  const [gravity, setGravity] = useState(initialSettings?.gravity ?? 0.05);
  const [collisionRadius, setCollisionRadius] = useState(initialSettings?.collisionRadius ?? 28);
  const [linkThickness, setLinkThickness] = useState(initialSettings?.linkThickness ?? 1.2);

  const [isSaveSuccess, setIsSaveSuccess] = useState(false);

  const handleSaveSettings = () => {
    const settingsToSave = {
      filters,
      colorScheme,
      isSemanticEnabled,
      semanticThreshold,
      maxSemanticLinksPerNote,
      repulsion,
      linkDistance,
      linkStrength,
      gravity,
      collisionRadius,
      linkThickness,
    };
    localStorage.setItem("kognote_graph_settings", JSON.stringify(settingsToSave));
    setIsSaveSuccess(true);
    setTimeout(() => setIsSaveSuccess(false), 2000);
  };

  const handleResetDefaults = () => {
    localStorage.removeItem("kognote_graph_settings");
    setFilters(DEFAULT_FILTERS);
    setColorScheme("category");
    setIsSemanticEnabled(true);
    setSemanticThreshold(0.55);
    setMaxSemanticLinksPerNote(5);
    setRepulsion(2200);
    setLinkDistance(180);
    setLinkStrength(0.35);
    setGravity(0.05);
    setCollisionRadius(28);
    setLinkThickness(1.2);
    alphaRef.current = 1.0;
  };

  // States
  const [nodes, setNodes] = useState<Node[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [_isLoading, setIsLoading] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<Node | null>(null);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [pinnedNodes, setPinnedNodes] = useState<Set<string>>(new Set());

  // Stats
  const [stats, setStats] = useState({
    notes: 0,
    daily: 0,
    folders: 0,
    tags: 0,
    urls: 0,
    attachments: 0,
    links: 0,
    orphans: 0,
    bookmarked: 0,
    tasksTotal: 0
  });

  // Interaction & transform refs
  const dragNodeRef = useRef<Node | null>(null);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1.0);
  const targetPanRef = useRef({ x: 0, y: 0 });
  const targetZoomRef = useRef(1.0);
  const alphaRef = useRef(1.0);
  const isPanInitializedRef = useRef(false);
  const frameRef = useRef<number>(0);
  const isLoopRunningRef = useRef(false);
  const runSimulationRef = useRef<(() => void) | null>(null);

  const wakeUpSimulation = useCallback((boostAlpha = 0.15) => {
    alphaRef.current = Math.max(alphaRef.current, boostAlpha);
    if (!isLoopRunningRef.current && runSimulationRef.current) {
      isLoopRunningRef.current = true;
      frameRef.current = requestAnimationFrame(runSimulationRef.current);
    }
  }, []);

  // Sync state to refs for animation loop
  const filtersRef = useRef(filters);
  const searchQueryRef = useRef(searchQuery);
  const colorSchemeRef = useRef(colorScheme);
  const hoveredNodeRef = useRef(hoveredNode);
  const focusedNodeIdRef = useRef(focusedNodeId);
  const pinnedNodesRef = useRef(pinnedNodes);
  const visibleNodesRef = useRef<Node[]>([]);
  const linksRef = useRef<Link[]>([]);

  const repulsionRef = useRef(repulsion);
  const linkStrengthRef = useRef(linkStrength);
  const gravityRef = useRef(gravity);
  const linkDistanceRef = useRef(linkDistance);
  const collisionRadiusRef = useRef(collisionRadius);
  const linkThicknessRef = useRef(linkThickness);
  const semanticThresholdRef = useRef(semanticThreshold);
  const maxSemanticLinksPerNoteRef = useRef(maxSemanticLinksPerNote);
  const isSemanticEnabledRef = useRef(isSemanticEnabled);

  useEffect(() => { filtersRef.current = filters; wakeUpSimulation(1.0); }, [filters, wakeUpSimulation]);
  useEffect(() => { searchQueryRef.current = searchQuery; wakeUpSimulation(0.3); }, [searchQuery, wakeUpSimulation]);
  useEffect(() => { colorSchemeRef.current = colorScheme; wakeUpSimulation(0.2); }, [colorScheme, wakeUpSimulation]);
  useEffect(() => { hoveredNodeRef.current = hoveredNode; wakeUpSimulation(0.2); }, [hoveredNode, wakeUpSimulation]);
  useEffect(() => { focusedNodeIdRef.current = focusedNodeId; wakeUpSimulation(1.0); }, [focusedNodeId, wakeUpSimulation]);
  useEffect(() => { pinnedNodesRef.current = pinnedNodes; wakeUpSimulation(0.2); }, [pinnedNodes, wakeUpSimulation]);

  useEffect(() => { repulsionRef.current = repulsion; wakeUpSimulation(1.0); }, [repulsion, wakeUpSimulation]);
  useEffect(() => { linkStrengthRef.current = linkStrength; wakeUpSimulation(1.0); }, [linkStrength, wakeUpSimulation]);
  useEffect(() => { gravityRef.current = gravity; wakeUpSimulation(1.0); }, [gravity, wakeUpSimulation]);
  useEffect(() => { linkDistanceRef.current = linkDistance; wakeUpSimulation(1.0); }, [linkDistance, wakeUpSimulation]);
  useEffect(() => { collisionRadiusRef.current = collisionRadius; wakeUpSimulation(1.0); }, [collisionRadius, wakeUpSimulation]);
  useEffect(() => { linkThicknessRef.current = linkThickness; wakeUpSimulation(0.2); }, [linkThickness, wakeUpSimulation]);
  useEffect(() => { isSemanticEnabledRef.current = isSemanticEnabled; wakeUpSimulation(1.0); }, [isSemanticEnabled, wakeUpSimulation]);
  useEffect(() => { semanticThresholdRef.current = semanticThreshold; wakeUpSimulation(1.0); }, [semanticThreshold, wakeUpSimulation]);
  useEffect(() => { maxSemanticLinksPerNoteRef.current = maxSemanticLinksPerNote; wakeUpSimulation(1.0); }, [maxSemanticLinksPerNote, wakeUpSimulation]);
  useEffect(() => { linksRef.current = links; wakeUpSimulation(0.3); }, [links, wakeUpSimulation]);

  // Drag reordering using inline filter drag handlers below
  const moveItem = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= filters.length) return;
    const updated = [...filters];
    [updated[index], updated[targetIndex]] = [updated[targetIndex], updated[index]];
    setFilters(updated);
    alphaRef.current = 1.0;
  };

  const getFilterIcon = (id: string) => {
    switch (id) {
      case "folders": return <Folder className="h-3.5 w-3.5 text-[#fbbf24]" />;
      case "tags": return <Tag className="h-3.5 w-3.5 text-[#94a3b8]/50" />;
      case "backlinks": return <Layers className="h-3.5 w-3.5 text-[#22d3ee]" />;
      case "semanticLinks": return <Sparkles className="h-3.5 w-3.5 text-[#818cf8]" />;
      case "urls": return <Globe className="h-3.5 w-3.5 text-[#f43f5e]" />;
      case "attachments": return <Paperclip className="h-3.5 w-3.5 text-[#a855f7]" />;
      case "orphans": return <EyeOff className="h-3.5 w-3.5 text-[#d946ef]" />;
      case "dailyNotes": return <Calendar className="h-3.5 w-3.5 text-[#38bdf8]" />;
      case "bookmarks": return <Bookmark className="h-3.5 w-3.5 text-[#f59e0b] fill-[#f59e0b]" />;
      default: return null;
    }
  };

  // Node Color Resolver
  const getNodeColor = useCallback((node: Node, scheme: "category" | "priority" | "status"): string => {
    if (node.type === "folder") return "#fbbf24";
    if (node.type === "tag-in-notes") return "rgba(148, 163, 184, 0.65)";
    if (node.type === "url") return "#f43f5e";
    if (node.type === "attachment") return "#a855f7";

    if (scheme === "priority") {
      const p = (node.highestPriority || "none").toLowerCase();
      if (p === "high") return "#ef4444";   // Red / High Priority
      if (p === "medium") return "#f59e0b"; // Amber / Medium Priority
      if (p === "low") return "#3b82f6";    // Blue / Low Priority
      return "#64748b"; // Neutral slate for no priority
    }

    if (scheme === "status") {
      const s = (node.boardStatus || "none").toLowerCase().replace(/_/g, "-").replace(/\s+/g, "-");
      if (s === "done") return "#10b981";                            // Emerald Green
      if (s === "in-progress" || s === "progress") return "#6366f1"; // Indigo Blue
      if (s === "in-review" || s === "review") return "#a855f7";      // Purple
      if (s === "todo") return "#f59e0b";                            // Amber Yellow
      if (s === "backlog") return "#64748b";                         // Slate Gray
      return "#475569"; // Slate dark fallback
    }

    // Default: By Category
    if (node.subType === "daily") return "#38bdf8"; // Sky Blue
    return "#d946ef"; // Fuchsia
  }, []);

  // Weighted Radial Centrality: Calculates continuous target radius for soft attractor physics
  const calculateTargetRadius = useCallback((
    node: Node,
    activeLinks: Link[],
    filterSeq: FilterItem[],
    baseDistance: number
  ): number => {
    let score = 0;

    filterSeq.forEach((filter, index) => {
      if (!filter.checked) return;
      let isMatch = false;

      if (filter.id === "folders" && node.type === "folder") isMatch = true;
      else if (filter.id === "tags" && node.type === "tag-in-notes") isMatch = true;
      else if (filter.id === "dailyNotes" && node.subType === "daily") isMatch = true;
      else if (filter.id === "bookmarks" && node.bookmarked) isMatch = true;
      else if (node.type === "note") {
        if (filter.id === "folders" && activeLinks.some(l => l.type === "folder" && (l.source === node.id || l.target === node.id))) isMatch = true;
        if (filter.id === "tags" && activeLinks.some(l => l.type === "tag-in-notes" && (l.source === node.id || l.target === node.id))) isMatch = true;
        if (filter.id === "backlinks" && activeLinks.some(l => l.type === "backlink" && (l.source === node.id || l.target === node.id))) isMatch = true;
      }

      if (isMatch) {
        score += 100 / (index + 1);
      }
    });

    // Factor in structural degree centrality (connected hub nodes float toward center)
    score += Math.min(node.degree * 5, 50);

    const maxScore = 150;
    const proximity = Math.min(score / maxScore, 1.0);

    const minR = 30; // Core hub radius
    const maxR = Math.max(baseDistance * 3.2, 420); // Outer boundary

    return minR + (maxR - minR) * (1.0 - proximity);
  }, []);

  // File tree traversal
  const traverseFiles = (
    items: FileEntry[],
    parentPath: string | null,
    folderNodes: Record<string, string>,
    extractedNodes: Node[],
    extractedLinks: Link[],
    scannedTags: Record<string, string[]>
  ) => {
    const currentParentId = parentPath ? folderNodes[parentPath] : null;

    for (const item of items) {
      const nameLower = item.name.toLowerCase();
      const pathLower = item.path.replace(/\\/g, "/").toLowerCase();

      if (item.is_dir) {
        if (!includeArchivedInScans && isArchivedPath(item.path)) continue;
        if (isTrashPath(item.path)) continue;
        if (nameLower === "templates" || pathLower.includes("/templates/") || pathLower.endsWith("/templates")) continue;
        if (nameLower === "attachments" || nameLower === "assets" || pathLower.includes("/attachments/") || pathLower.includes("/assets/")) continue;

        const folderId = `folder:${item.path}`;
        folderNodes[item.path] = folderId;
        extractedNodes.push({
          id: folderId,
          label: item.name,
          type: "folder",
          x: (Math.random() - 0.5) * 350,
          y: (Math.random() - 0.5) * 350,
          vx: 0, vy: 0,
          radius: 9,
          color: "#fbbf24",
          degree: 0,
          pinned: false,
        });
        if (currentParentId) {
          extractedLinks.push({ source: currentParentId, target: folderId, type: "folder" });
        }
        if (item.children) {
          traverseFiles(item.children, item.path, folderNodes, extractedNodes, extractedLinks, scannedTags);
        }
      } else if (item.name.endsWith(".md")) {
        const isArchived = isArchivedPath(item.path) || noteCache[item.path]?.meta?.storage === "archived";
        const isDeleted = isTrashPath(item.path) || noteCache[item.path]?.meta?.storage === "deleted";

        if (!includeArchivedInScans && isArchived) continue;
        if (isDeleted) continue;
        if (pathLower.includes("/templates/") || noteCache[item.path]?.meta?.type === "template") continue;
        if (pathLower.includes("/attachments/") || pathLower.includes("/assets/")) continue;

        let subType: "standard" | "daily" = "standard";
        if (pathLower.includes("/daily notes/")) subType = "daily";

        const normPath = item.path.replace(/\\/g, "/");
        const cached = noteCache[item.path] || noteCache[normPath];
        if (cached?.meta?.type === "daily") subType = "daily";

        const bookmarked = cached?.meta?.bookmarked === "yes";

        // Determine note priority from frontmatter metadata OR tasks
        const tasks = cached?.tasks || [];
        let highestPriority: "high" | "medium" | "low" | "none" = "none";
        const metaPriority = (cached?.meta?.priority || "none").toLowerCase();
        if (["high", "medium", "low"].includes(metaPriority)) {
          highestPriority = metaPriority as any;
        } else {
          if (tasks.some(t => t.priority === "high")) highestPriority = "high";
          else if (tasks.some(t => t.priority === "medium")) highestPriority = "medium";
          else if (tasks.some(t => t.priority === "low")) highestPriority = "low";
        }

        const rawBoardStatus = (cached?.boardCard?.status || cached?.meta?.status || "none")
          .toString()
          .toLowerCase()
          .replace(/_/g, "-")
          .replace(/\s+/g, "-");

        const noteId = `note:${item.path}`;
        extractedNodes.push({
          id: noteId,
          label: item.name.replace(/\.md$/, ""),
          type: "note",
          subType,
          path: item.path,
          x: (Math.random() - 0.5) * 350,
          y: (Math.random() - 0.5) * 350,
          vx: 0, vy: 0,
          radius: 7,
          color: subType === "daily" ? "#38bdf8" : "#d946ef",
          degree: 0,
          pinned: false,
          bookmarked,
          tasksTotal: tasks.length,
          tasksCompleted: tasks.filter(t => t.completed).length,
          highestPriority,
          boardStatus: rawBoardStatus as any
        });

        if (currentParentId) {
          extractedLinks.push({ source: currentParentId, target: noteId, type: "folder" });
        }
      }
    }
  };

  const loadGraphData = async () => {
    setIsLoading(true);
    alphaRef.current = 1.0;
    try {
      const folderNodes: Record<string, string> = {};
      const extractedNodes: Node[] = [];
      const extractedLinks: Link[] = [];
      const scannedTags: Record<string, string[]> = {};
      const scannedUrls: Record<string, string[]> = {};
      const scannedAttachments: Record<string, string[]> = {};

      traverseFiles(files, null, folderNodes, extractedNodes, extractedLinks, scannedTags);
      const notes = extractedNodes.filter((n) => n.type === "note");

      await Promise.all(
        notes.map(async (note) => {
          if (!note.path) return;
          try {
            const normPath = note.path.replace(/\\/g, "/");
            const cached = noteCache[note.path] || noteCache[normPath];
            let text = cached?.content;
            if (!text) {
              text = (await invokeIPC("read_note", {
                path: note.path,
              }).catch(() => "")) as string;
            }
            if (!text) return;

            // Extract tags
            const tagMatches = text.match(/(?:^|\s|\\)#([a-zA-Z0-9_\-\/]+)/g) || [];
            for (const tag of tagMatches) {
              const match = tag.trim().match(/#([a-zA-Z0-9_\-\/]+)/);
              if (!match) continue;
              const cleanTag = match[1].toLowerCase();
              if (cleanTag === "flashcard" || !isNaN(Number(cleanTag))) continue;
              if (!scannedTags[cleanTag]) scannedTags[cleanTag] = [];
              if (!scannedTags[cleanTag].includes(note.id)) scannedTags[cleanTag].push(note.id);
            }

            // Extract URLs
            const urlMatches = text.match(/https?:\/\/[^\s\)\]\>\"']+/g) || [];
            for (const rawUrl of urlMatches) {
              const cleanUrl = rawUrl.replace(/[\.\,\)\]]+$/, "");
              if (!cleanUrl) continue;
              if (!scannedUrls[cleanUrl]) scannedUrls[cleanUrl] = [];
              if (!scannedUrls[cleanUrl].includes(note.id)) scannedUrls[cleanUrl].push(note.id);
            }

            // Extract Attachments (e.g. [[image.png]], ![[photo.jpg]], [file.pdf](path))
            const attRegex = /(?:!\[\[|\[\[|!\[.*?\]\(|\[.*?\]\()(.*?\.(?:png|jpg|jpeg|gif|svg|webp|pdf|mp4|webm|mp3|wav|zip|doc|docx))(?:\s*\|.*?)?(?:\]\]|\))/gi;
            let attMatch;
            while ((attMatch = attRegex.exec(text)) !== null) {
              let attPath = attMatch[1].trim();
              if (!attPath) continue;
              const attName = attPath.split("/").pop() || attPath;
              if (!scannedAttachments[attName]) scannedAttachments[attName] = [];
              if (!scannedAttachments[attName].includes(note.id)) scannedAttachments[attName].push(note.id);
            }

            // Extract Wiki Backlinks
            const wikiLinksRegex2 = /(?:\\?\[){2}(.*?)(?:\\?\]){2}/g;
            let linkMatch;
            while ((linkMatch = wikiLinksRegex2.exec(text)) !== null) {
              let targetName = linkMatch[1].replace(/\\/g, "").trim();
              if (targetName.includes("|")) targetName = targetName.split("|")[0].trim();
              const targetLower = targetName.toLowerCase();
              const targetNode = notes.find((n) => n.label.toLowerCase() === targetLower);
              if (targetNode) {
                extractedLinks.push({ source: note.id, target: targetNode.id, type: "backlink" });
              }
            }
          } catch (e) {
            console.warn("Failed to parse note for graph:", note.path, e);
          }
        })
      );

      try {
        const allMetadata = await searchEngine.getAllNoteMetadata();
        for (const meta of allMetadata) {
          const noteId = `note:${meta.file_path}`;
          if (!extractedNodes.some(n => n.id === noteId)) continue;
          for (const tag of meta.tags) {
            const cleanTag = tag.toLowerCase();
            if (cleanTag === "flashcard" || !isNaN(Number(cleanTag))) continue;
            if (!scannedTags[cleanTag]) scannedTags[cleanTag] = [];
            if (!scannedTags[cleanTag].includes(noteId)) scannedTags[cleanTag].push(noteId);
          }
        }
      } catch (err) {
        console.error("Failed to load metadata for graph tags:", err);
      }

      // Create tag nodes
      Object.entries(scannedTags).forEach(([tag, noteIds]) => {
        const tagId = `tag-in-notes:${tag}`;
        extractedNodes.push({
          id: tagId,
          label: `#${tag}`,
          type: "tag-in-notes",
          x: (Math.random() - 0.5) * 350,
          y: (Math.random() - 0.5) * 350,
          vx: 0, vy: 0,
          radius: 5.5,
          color: "rgba(148, 163, 184, 0.65)",
          degree: 0,
          pinned: false,
        });
        for (const noteId of noteIds) {
          extractedLinks.push({ source: tagId, target: noteId, type: "tag-in-notes" });
        }
      });

      // Create URL nodes
      Object.entries(scannedUrls).forEach(([url, noteIds]) => {
        const urlId = `url:${url}`;
        let label = url.replace(/^https?:\/\/(www\.)?/, "");
        if (label.length > 26) label = label.slice(0, 23) + "...";

        extractedNodes.push({
          id: urlId,
          label,
          type: "url",
          path: url,
          x: (Math.random() - 0.5) * 350,
          y: (Math.random() - 0.5) * 350,
          vx: 0, vy: 0,
          radius: 5.5,
          color: "#f43f5e",
          degree: 0,
          pinned: false,
        });
        for (const noteId of noteIds) {
          extractedLinks.push({ source: noteId, target: urlId, type: "url" });
        }
      });

      // Create Attachment nodes
      Object.entries(scannedAttachments).forEach(([attName, noteIds]) => {
        const attId = `attachment:${attName}`;
        extractedNodes.push({
          id: attId,
          label: attName,
          type: "attachment",
          path: attName,
          x: (Math.random() - 0.5) * 350,
          y: (Math.random() - 0.5) * 350,
          vx: 0, vy: 0,
          radius: 6,
          color: "#a855f7",
          degree: 0,
          pinned: false,
        });
        for (const noteId of noteIds) {
          extractedLinks.push({ source: noteId, target: attId, type: "attachment" });
        }
      });

      // Fetch semantic AI vector connections if enabled
      if (isSemanticEnabledRef.current) {
        try {
          const rawSemanticLinks = await searchEngine.getSemanticConnections(semanticThresholdRef.current);
          const semanticCounts: Record<string, number> = {};
          const noteNodes = extractedNodes.filter(n => n.type === "note");

          for (const simLink of rawSemanticLinks) {
            const rawSrc = simLink.source.replace(/\\/g, "/").toLowerCase();
            const rawTgt = simLink.target.replace(/\\/g, "/").toLowerCase();
            const srcName = rawSrc.split("/").pop()?.replace(/\.md$/, "") || "";
            const tgtName = rawTgt.split("/").pop()?.replace(/\.md$/, "") || "";

            const srcNode = noteNodes.find(n => {
              if (!n.path) return false;
              const p = n.path.replace(/\\/g, "/").toLowerCase();
              return p === rawSrc || p.endsWith("/" + rawSrc) || rawSrc.endsWith("/" + p) || n.label.toLowerCase() === srcName;
            });

            const tgtNode = noteNodes.find(n => {
              if (!n.path) return false;
              const p = n.path.replace(/\\/g, "/").toLowerCase();
              return p === rawTgt || p.endsWith("/" + rawTgt) || rawTgt.endsWith("/" + p) || n.label.toLowerCase() === tgtName;
            });

            if (srcNode && tgtNode && srcNode.id !== tgtNode.id) {
              const srcCount = semanticCounts[srcNode.id] || 0;
              const tgtCount = semanticCounts[tgtNode.id] || 0;

              if (srcCount < maxSemanticLinksPerNoteRef.current && tgtCount < maxSemanticLinksPerNoteRef.current) {
                const existing = extractedLinks.some(l =>
                  (l.source === srcNode.id && l.target === tgtNode.id) ||
                  (l.source === tgtNode.id && l.target === srcNode.id)
                );
                if (!existing) {
                  extractedLinks.push({
                    source: srcNode.id,
                    target: tgtNode.id,
                    type: "semantic",
                    similarity: simLink.similarity,
                  });
                  semanticCounts[srcNode.id] = srcCount + 1;
                  semanticCounts[tgtNode.id] = tgtCount + 1;
                }
              }
            }
          }
        } catch (err) {
          console.error("Failed to query semantic links:", err);
        }
      }

      // Compute degree for each node
      const degreeCounter: Record<string, number> = {};
      extractedLinks.forEach(l => {
        degreeCounter[l.source] = (degreeCounter[l.source] || 0) + 1;
        degreeCounter[l.target] = (degreeCounter[l.target] || 0) + 1;
      });
      extractedNodes.forEach(n => {
        n.degree = degreeCounter[n.id] || 0;
        if (n.type === "note") {
          n.radius = Math.min(7 + n.degree * 0.8, 18);
        } else if (n.type === "folder") {
          n.radius = Math.min(9 + n.degree * 0.5, 16);
        } else {
          n.radius = Math.min(5.5 + n.degree * 0.4, 12);
        }
      });

      // Compute stats
      const noteNodes = extractedNodes.filter(n => n.type === "note");
      const folderNds = extractedNodes.filter(n => n.type === "folder");
      const tagNds = extractedNodes.filter(n => n.type === "tag-in-notes");
      const backlinkCount = extractedLinks.filter(l => l.type === "backlink").length;

      const dailyCount = noteNodes.filter(n => n.subType === "daily").length;
      const urlCount = extractedNodes.filter(n => n.type === "url").length;
      const attCount = extractedNodes.filter(n => n.type === "attachment").length;
      const bkmkCount = noteNodes.filter(n => n.bookmarked).length;

      let totalTasks = 0;
      noteNodes.forEach(n => { totalTasks += n.tasksTotal || 0; });

      const degMap: Record<string, number> = {};
      noteNodes.forEach(n => degMap[n.id] = 0);
      extractedLinks.forEach(l => {
        if (degMap[l.source] !== undefined) degMap[l.source]++;
        if (degMap[l.target] !== undefined) degMap[l.target]++;
      });
      const orphanCount = noteNodes.filter(n => degMap[n.id] === 0).length;

      setStats({
        notes: noteNodes.length,
        daily: dailyCount,
        folders: folderNds.length,
        tags: tagNds.length,
        urls: urlCount,
        attachments: attCount,
        links: backlinkCount,
        orphans: orphanCount,
        bookmarked: bkmkCount,
        tasksTotal: totalTasks
      });

      // Top 500 Hub Node Capping for 10k+ notes scalability
      let finalNodes = extractedNodes;
      let finalLinks = extractedLinks;

      if (extractedNodes.length > 500) {
        // Calculate degree for node prioritization
        const degreeMap: Record<string, number> = {};
        extractedLinks.forEach((l) => {
          degreeMap[l.source] = (degreeMap[l.source] || 0) + 1;
          degreeMap[l.target] = (degreeMap[l.target] || 0) + 1;
        });

        // Sort by connection count descending
        const sorted = [...extractedNodes].sort((a, b) => (degreeMap[b.id] || 0) - (degreeMap[a.id] || 0));
        const hubSet = new Set(sorted.slice(0, 500).map((n) => n.id));

        // Always include active file if open
        if (activeFile?.path) {
          hubSet.add(activeFile.path);
        }

        finalNodes = extractedNodes.filter((n) => hubSet.has(n.id));
        finalLinks = extractedLinks.filter((l) => hubSet.has(l.source) && hubSet.has(l.target));
      }

      // Restore position cache
      setNodes((prevNodes) => {
        const pinnedSet = pinnedNodesRef.current;
        return finalNodes.map(newNode => {
          const existing = prevNodes.find(n => n.id === newNode.id);
          if (existing) {
            return {
              ...newNode,
              x: existing.x,
              y: existing.y,
              vx: existing.vx,
              vy: existing.vy,
              pinned: pinnedSet.has(newNode.id),
            };
          }
          return { ...newNode, pinned: pinnedSet.has(newNode.id) };
        });
      });

      setLinks(finalLinks);
      // Soft alpha decay on scan sync instead of hard reset to prevent canvas jitter
      if (!hasAutoCenteredRef.current) {
        alphaRef.current = 1.0;
      } else {
        alphaRef.current = Math.max(alphaRef.current, 0.25);
      }
    } catch (err) {
      console.error("Failed to compile graph:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { loadGraphData(); }, [files, noteCache, isSemanticEnabled, semanticThreshold, maxSemanticLinksPerNote]);

  useEffect(() => {
    registerSyncHandler("graph-reload", loadGraphData, "Reload graph");
    return () => unregisterSyncHandler("graph-reload");
  }, [registerSyncHandler, unregisterSyncHandler, files, noteCache]);

  const autoFitAndCenter = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    if (width <= 0 || height <= 0) return;

    const visibleNodes = visibleNodesRef.current.length > 0 ? visibleNodesRef.current : nodes;
    if (visibleNodes.length === 0) {
      targetZoomRef.current = 1.0;
      targetPanRef.current = { x: width / 2, y: height / 2 };
      panRef.current = { x: width / 2, y: height / 2 };
      return;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    visibleNodes.forEach(n => {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    });

    const graphW = (maxX - minX) || 100;
    const graphH = (maxY - minY) || 100;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const padding = 100;
    const availableW = Math.max(width - padding * 2, 200);
    const availableH = Math.max(height - padding * 2, 200);

    const fitZoom = Math.min(availableW / graphW, availableH / graphH);
    const clampedZoom = Math.min(Math.max(fitZoom, 0.35), 1.5);

    targetZoomRef.current = clampedZoom;
    const newPan = {
      x: width / 2 - centerX * clampedZoom,
      y: height / 2 - centerY * clampedZoom,
    };
    targetPanRef.current = newPan;
    panRef.current = newPan;
  }, [nodes]);

  // Automatically fit and center graph when nodes are initialized or updated
  const hasAutoCenteredRef = useRef(false);
  useEffect(() => {
    if (nodes.length > 0 && !hasAutoCenteredRef.current) {
      hasAutoCenteredRef.current = true;
      const timer = setTimeout(() => {
        autoFitAndCenter();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [nodes, autoFitAndCenter]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !canvas.parentElement) return;
    const parent = canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          canvas.width = width * dpr;
          canvas.height = height * dpr;
          if (!isPanInitializedRef.current) {
            panRef.current = { x: width / 2, y: height / 2 };
            isPanInitializedRef.current = true;
          }
          alphaRef.current = 1.0;
        }
      }
    });
    resizeObserver.observe(parent);
    return () => resizeObserver.disconnect();
  }, []);

  // Draw arrow head helper
  const drawArrow = (
    ctx: CanvasRenderingContext2D,
    fromX: number, fromY: number,
    toX: number, toY: number,
    toRadius: number,
    color: string
  ) => {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const arrowTip = { x: toX - ux * (toRadius + 2), y: toY - uy * (toRadius + 2) };
    const arrowSize = 5;
    const angle = Math.atan2(dy, dx);
    ctx.save();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(arrowTip.x, arrowTip.y);
    ctx.lineTo(arrowTip.x - arrowSize * Math.cos(angle - Math.PI / 7), arrowTip.y - arrowSize * Math.sin(angle - Math.PI / 7));
    ctx.lineTo(arrowTip.x - arrowSize * Math.cos(angle + Math.PI / 7), arrowTip.y - arrowSize * Math.sin(angle + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  // Main simulation & render loop
  useEffect(() => {
    if (nodes.length === 0) return;
    let isMounted = true;
    const canvas = canvasRef.current;
    const minimapCanvas = minimapCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const runSimulation = () => {
      runSimulationRef.current = runSimulation;
      if (!isMounted) return;
      const dpr = window.devicePixelRatio || 1;
      const logicalWidth = canvas.width / dpr;
      const logicalHeight = canvas.height / dpr;

      // 60 FPS Smooth Inertial Interpolation (silk-smooth gradual zoom & pan)
      if (Math.abs(targetZoomRef.current - zoomRef.current) > 0.0001) {
        zoomRef.current += (targetZoomRef.current - zoomRef.current) * 0.18;
      } else {
        zoomRef.current = targetZoomRef.current;
      }

      if (
        Math.abs(targetPanRef.current.x - panRef.current.x) > 0.01 ||
        Math.abs(targetPanRef.current.y - panRef.current.y) > 0.01
      ) {
        panRef.current.x += (targetPanRef.current.x - panRef.current.x) * 0.18;
        panRef.current.y += (targetPanRef.current.y - panRef.current.y) * 0.18;
      } else {
        panRef.current.x = targetPanRef.current.x;
        panRef.current.y = targetPanRef.current.y;
      }

      alphaRef.current = alphaRef.current * (visibleNodesRef.current.length > 300 ? 0.95 : 0.982);
      if (alphaRef.current < 0.001) alphaRef.current = 0;
      const alpha = alphaRef.current;

      const isFoldersChecked = filtersRef.current.find(f => f.id === "folders")?.checked ?? true;
      const isTagsChecked = filtersRef.current.find(f => f.id === "tags")?.checked ?? true;
      const isBacklinksChecked = filtersRef.current.find(f => f.id === "backlinks")?.checked ?? true;
      const isUrlsChecked = filtersRef.current.find(f => f.id === "urls")?.checked ?? true;
      const isAttachmentsChecked = filtersRef.current.find(f => f.id === "attachments")?.checked ?? true;
      const isOrphansChecked = filtersRef.current.find(f => f.id === "orphans")?.checked ?? true;
      const isDailyChecked = filtersRef.current.find(f => f.id === "dailyNotes")?.checked ?? true;
      const isBookmarksChecked = filtersRef.current.find(f => f.id === "bookmarks")?.checked ?? false;

      const focusId = focusedNodeIdRef.current;

      const activeLinks = linksRef.current.filter(link => {
        if (link.type === "folder" && !isFoldersChecked) return false;
        if (link.type === "tag-in-notes" && !isTagsChecked) return false;
        if (link.type === "backlink" && !isBacklinksChecked) return false;
        if (link.type === "url" && !isUrlsChecked) return false;
        if (link.type === "attachment" && !isAttachmentsChecked) return false;
        return true;
      });

      let visibleNodes = nodes.filter(n => {
        if (n.type === "folder" && !isFoldersChecked) return false;
        if (n.type === "tag-in-notes" && !isTagsChecked) return false;
        if (n.type === "url" && !isUrlsChecked) return false;
        if (n.type === "attachment" && !isAttachmentsChecked) return false;
        if (n.type === "note") {
          if (n.subType === "daily" && !isDailyChecked) return false;
          if (isBookmarksChecked && !n.bookmarked) return false;
        }
        return true;
      });

      // Degree map for orphan filtering
      const degreeMap: Record<string, number> = {};
      visibleNodes.forEach(n => degreeMap[n.id] = 0);
      const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
      activeLinks.forEach(l => {
        if (visibleNodeIds.has(l.source) && visibleNodeIds.has(l.target)) {
          degreeMap[l.source]++;
          degreeMap[l.target]++;
        }
      });

      visibleNodes = visibleNodes.filter(n => {
        if (!isOrphansChecked && n.type === "note" && degreeMap[n.id] === 0) return false;
        return true;
      });

      // Focus mode: only show focused node and immediate neighbors
      let finalVisibleNodes = visibleNodes;
      if (focusId) {
        const neighborIds = new Set<string>([focusId]);
        activeLinks.forEach(l => {
          if (l.source === focusId) neighborIds.add(l.target);
          if (l.target === focusId) neighborIds.add(l.source);
        });
        finalVisibleNodes = visibleNodes.filter(n => neighborIds.has(n.id));
      }

      // Max Physics Node Cap for 20k+ note vaults (preserves 60fps smooth simulation)
      if (finalVisibleNodes.length > 800 && !searchQueryRef.current) {
        const degreeMap = new Map<string, number>();
        activeLinks.forEach(l => {
          degreeMap.set(l.source, (degreeMap.get(l.source) || 0) + 1);
          degreeMap.set(l.target, (degreeMap.get(l.target) || 0) + 1);
        });
        finalVisibleNodes = [...finalVisibleNodes]
          .sort((a, b) => (degreeMap.get(b.id) || 0) - (degreeMap.get(a.id) || 0))
          .slice(0, 800);
      }

      const finalVisibleNodeIds = new Set(finalVisibleNodes.map(n => n.id));
      visibleNodesRef.current = finalVisibleNodes;

      // Alpha-Threshold Trigger: Auto-fit exact settled bounds when physics alpha decays past 0.38
      if (!hasAutoCenteredRef.current && alpha < 0.38 && finalVisibleNodes.length > 0) {
        hasAutoCenteredRef.current = true;
        autoFitAndCenter();
      }

      // Repulsion Force with Distance Cutoff Optimization (O(N) for distant pairs)
      const charge = -repulsionRef.current;
      const numNodes = finalVisibleNodes.length;
      for (let i = 0; i < numNodes; i++) {
        const n1 = finalVisibleNodes[i];
        if (n1.pinned || pinnedNodesRef.current.has(n1.id)) continue;
        for (let j = i + 1; j < numNodes; j++) {
          const n2 = finalVisibleNodes[j];
          const dx = n2.x - n1.x;
          const dy = n2.y - n1.y;

          // Manhattan distance pre-filter to skip Math.sqrt on distant node pairs
          if (Math.abs(dx) > 600 || Math.abs(dy) > 600) continue;
          const distSq = dx * dx + dy * dy;
          if (distSq > 360000) continue;

          const dist = Math.sqrt(distSq) || 1;
          const clampedDist = Math.max(dist, 22);
          let force = (charge / (clampedDist * clampedDist)) * 1.6 * alpha;
          const maxForce = 2.0;
          force = Math.max(force, -maxForce);
          const factor = force / dist;
          n1.vx += dx * factor;
          n1.vy += dy * factor;
          n2.vx -= dx * factor;
          n2.vy -= dy * factor;
        }
      }

      // Asymmetric Collision Anti-Overlap Force (AABB Text Label Protection)
      const minCollisionPad = collisionRadiusRef.current;
      if (minCollisionPad > 0) {
        for (let i = 0; i < numNodes; i++) {
          const n1 = finalVisibleNodes[i];
          const n1LabelW = n1.label ? n1.label.length * 5.5 : 0;
          for (let j = i + 1; j < numNodes; j++) {
            const n2 = finalVisibleNodes[j];
            const n2LabelW = n2.label ? n2.label.length * 5.5 : 0;

            const dx = n2.x - n1.x;
            const dy = n2.y - n1.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;

            // Expand horizontal padding bound to protect rectangular text pills from overlapping
            const extraPadX = Math.max(n1LabelW, n2LabelW) * 0.40;
            const minXDist = n1.radius + n2.radius + minCollisionPad + extraPadX;
            const minYDist = n1.radius + n2.radius + minCollisionPad;

            const normX = dx / minXDist;
            const normY = dy / minYDist;
            const ellipseDist = Math.sqrt(normX * normX + normY * normY);

            if (ellipseDist < 1.0) {
              const overlap = (1.0 - ellipseDist) * 0.5 * alpha;
              const factor = overlap / dist;
              if (!n1.pinned && !pinnedNodesRef.current.has(n1.id)) {
                n1.vx -= dx * factor * 1.4;
                n1.vy -= dy * factor;
              }
              if (!n2.pinned && !pinnedNodesRef.current.has(n2.id)) {
                n2.vx += dx * factor * 1.4;
                n2.vy += dy * factor;
              }
            }
          }
        }
      }

      // Spring / Attraction Force
      const springStrength = linkStrengthRef.current;
      const baseDistance = linkDistanceRef.current;
      for (const link of activeLinks) {
        if (!finalVisibleNodeIds.has(link.source) || !finalVisibleNodeIds.has(link.target)) continue;
        const sourceNode = finalVisibleNodes.find(n => n.id === link.source);
        const targetNode = finalVisibleNodes.find(n => n.id === link.target);
        if (sourceNode && targetNode) {
          const dx = targetNode.x - sourceNode.x;
          const dy = targetNode.y - sourceNode.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          let targetDist = baseDistance;
          if (link.type === "tag-in-notes") targetDist = baseDistance * 1.25;
          if (link.type === "folder") targetDist = baseDistance * 0.85;
          if (link.type === "semantic" && link.similarity) {
            targetDist = baseDistance * (1.3 - link.similarity * 0.6);
          }
          const force = (dist - targetDist) * springStrength * 0.12 * alpha;
          const factor = force / dist;
          if (!sourceNode.pinned && !pinnedNodesRef.current.has(sourceNode.id)) {
            sourceNode.vx += dx * factor;
            sourceNode.vy += dy * factor;
          }
          if (!targetNode.pinned && !pinnedNodesRef.current.has(targetNode.id)) {
            targetNode.vx -= dx * factor;
            targetNode.vy -= dy * factor;
          }
        }
      }

      // Soft Weighted Radial Centrality Attractor Force (Harmonic Attractor)
      const kRing = 0.025; // Soft spring coefficient so link spring forces dominate without jitter
      for (const node of finalVisibleNodes) {
        if (node === dragNodeRef.current || node.pinned || pinnedNodesRef.current.has(node.id)) continue;

        const targetRadius = calculateTargetRadius(node, activeLinks, filtersRef.current, linkDistanceRef.current);
        const currentRadius = Math.sqrt(node.x * node.x + node.y * node.y) || 1;
        const radiusDelta = currentRadius - targetRadius;

        // Apply force along radial vector toward target radius
        const force = radiusDelta * kRing * alpha;
        const factor = force / currentRadius;
        node.vx -= node.x * factor;
        node.vy -= node.y * factor;
      }

      // Smooth Central Gravity & Coordinate Updates
      const friction = 0.84;
      const gForce = gravityRef.current;
      for (const node of finalVisibleNodes) {
        if (node === dragNodeRef.current || node.pinned || pinnedNodesRef.current.has(node.id)) {
          if (node !== dragNodeRef.current) { node.vx = 0; node.vy = 0; }
          continue;
        }
        node.vx += -node.x * gForce * 0.12 * alpha;
        node.vy += -node.y * gForce * 0.12 * alpha;
        node.vx *= friction;
        node.vy *= friction;
        node.x += node.vx;
        node.y += node.vy;
      }

      // ===== DRAW =====
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.scale(dpr, dpr);

      // Background gradient
      const isDark = document.documentElement.classList.contains("dark");
      const bgGrad = ctx.createRadialGradient(logicalWidth / 2, logicalHeight / 2, 0, logicalWidth / 2, logicalHeight / 2, logicalWidth * 0.8);
      if (isDark) {
        bgGrad.addColorStop(0, "#0a0b10");
        bgGrad.addColorStop(1, "#06070a");
      } else {
        bgGrad.addColorStop(0, "#ffffff");
        bgGrad.addColorStop(1, "#f1f5f9");
      }
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, logicalWidth, logicalHeight);

      // Grid
      ctx.save();
      const gridSpacing = 50;
      const zoom = zoomRef.current;
      const pan = panRef.current;
      const startX = Math.floor((-pan.x / zoom) / gridSpacing) * gridSpacing;
      const startY = Math.floor((-pan.y / zoom) / gridSpacing) * gridSpacing;
      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);
      ctx.strokeStyle = isDark ? "rgba(30, 35, 53, 0.4)" : "rgba(203, 213, 225, 0.6)";
      ctx.lineWidth = 0.5;
      const ext = 800;
      for (let x = startX - ext; x < startX + logicalWidth / zoom + ext; x += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(x, -startY - ext);
        ctx.lineTo(x, startY + logicalHeight / zoom + ext);
        ctx.stroke();
      }
      for (let y = startY - ext; y < startY + logicalHeight / zoom + ext; y += gridSpacing) {
        ctx.beginPath();
        ctx.moveTo(-startX - ext, y);
        ctx.lineTo(startX + logicalWidth / zoom + ext, y);
        ctx.stroke();
      }
      ctx.restore();

      // Graph elements in viewport transform
      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);

      // Highlight computation
      const highlightedIds = new Set<string>();
      const searchMatchedIds = new Set<string>();

      if (searchQueryRef.current) {
        finalVisibleNodes.forEach(n => {
          if (n.label.toLowerCase().includes(searchQueryRef.current.toLowerCase())) {
            searchMatchedIds.add(n.id);
            highlightedIds.add(n.id);
            activeLinks.forEach(l => {
              if (l.source === n.id) highlightedIds.add(l.target);
              if (l.target === n.id) highlightedIds.add(l.source);
            });
          }
        });
      }

      if (hoveredNodeRef.current) {
        highlightedIds.add(hoveredNodeRef.current.id);
        activeLinks.forEach(l => {
          if (l.source === hoveredNodeRef.current!.id) highlightedIds.add(l.target);
          if (l.target === hoveredNodeRef.current!.id) highlightedIds.add(l.source);
        });
      }

      const hasActiveHighlight = hoveredNodeRef.current !== null || searchQueryRef.current.length > 0;

      const vpMinX = -pan.x / zoom - 60;
      const vpMaxX = (-pan.x + logicalWidth) / zoom + 60;
      const vpMinY = -pan.y / zoom - 60;
      const vpMaxY = (-pan.y + logicalHeight) / zoom + 60;

      // Draw connection lines
      for (const link of activeLinks) {
        if (!finalVisibleNodeIds.has(link.source) || !finalVisibleNodeIds.has(link.target)) continue;
        const sourceNode = finalVisibleNodes.find(n => n.id === link.source);
        const targetNode = finalVisibleNodes.find(n => n.id === link.target);
        if (!sourceNode || !targetNode) continue;

        // Viewport culling for lines
        const inVpSource = sourceNode.x >= vpMinX && sourceNode.x <= vpMaxX && sourceNode.y >= vpMinY && sourceNode.y <= vpMaxY;
        const inVpTarget = targetNode.x >= vpMinX && targetNode.x <= vpMaxX && targetNode.y >= vpMinY && targetNode.y <= vpMaxY;
        if (!inVpSource && !inVpTarget) continue;

        const isHighlighted = hasActiveHighlight
          && highlightedIds.has(sourceNode.id) && highlightedIds.has(targetNode.id)
          && (hoveredNodeRef.current
            ? (sourceNode.id === hoveredNodeRef.current.id || targetNode.id === hoveredNodeRef.current.id)
            : true);
        const isFaded = hasActiveHighlight && !isHighlighted;

        let lineColor: string;
        if (link.type === "folder") {
          lineColor = isHighlighted ? "rgba(251, 191, 36, 0.85)" : isFaded ? "rgba(251, 191, 36, 0.03)" : "rgba(251, 191, 36, 0.18)";
        } else if (link.type === "tag-in-notes") {
          lineColor = isHighlighted ? "rgba(148, 163, 184, 0.75)" : isFaded ? "rgba(148, 163, 184, 0.03)" : "rgba(148, 163, 184, 0.18)";
        } else if (link.type === "url") {
          lineColor = isHighlighted ? "rgba(244, 63, 94, 0.85)" : isFaded ? "rgba(244, 63, 94, 0.03)" : "rgba(244, 63, 94, 0.2)";
        } else if (link.type === "attachment") {
          lineColor = isHighlighted ? "rgba(168, 85, 247, 0.85)" : isFaded ? "rgba(168, 85, 247, 0.03)" : "rgba(168, 85, 247, 0.2)";
        } else if (link.type === "semantic") {
          const sim = link.similarity || 0.5;
          const alpha = Math.min(0.95, Math.max(0.18, sim * 0.85));
          lineColor = isHighlighted ? "rgba(129, 140, 248, 0.95)" : isFaded ? "rgba(129, 140, 248, 0.04)" : `rgba(129, 140, 248, ${alpha.toFixed(2)})`;
        } else {
          lineColor = isHighlighted ? "rgba(34, 211, 238, 0.9)" : isFaded ? "rgba(34, 211, 238, 0.03)" : "rgba(34, 211, 238, 0.22)";
        }

        ctx.beginPath();
        ctx.moveTo(sourceNode.x, sourceNode.y);
        ctx.lineTo(targetNode.x, targetNode.y);
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = isHighlighted
          ? linkThicknessRef.current * 2.0
          : link.type === "semantic" && link.similarity
            ? linkThicknessRef.current * (0.6 + link.similarity * 0.8)
            : linkThicknessRef.current;
        if (link.type === "semantic") {
          ctx.setLineDash([5, 4]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        if (link.type === "backlink" && isHighlighted) {
          drawArrow(ctx, sourceNode.x, sourceNode.y, targetNode.x, targetNode.y, targetNode.radius, lineColor);
        }
      }

      // Draw Nodes
      for (const node of finalVisibleNodes) {
        // Viewport culling for nodes
        if (node.x < vpMinX || node.x > vpMaxX || node.y < vpMinY || node.y > vpMaxY) {
          continue;
        }
        const isHovered = hoveredNodeRef.current && node.id === hoveredNodeRef.current.id;
        const isNeighbour = hoveredNodeRef.current && highlightedIds.has(node.id) && !isHovered;
        const isSearchMatch = searchMatchedIds.has(node.id);
        const isHighlight = highlightedIds.has(node.id);
        const isFaded = hasActiveHighlight && !isHighlight;
        const isPinned = node.pinned || pinnedNodesRef.current.has(node.id);
        const isFocused = focusedNodeIdRef.current === node.id;

        const effectiveColor = getNodeColor(node, colorSchemeRef.current);

        // Outer glow for hovered/matched/focused/bookmarked nodes
        if (isHovered || isSearchMatch || isFocused || isPinned || node.bookmarked) {
          const glowRadius = node.radius + (isFocused ? 14 : isHovered ? 12 : 8);
          const glow = ctx.createRadialGradient(node.x, node.y, node.radius * 0.5, node.x, node.y, glowRadius);
          if (isSearchMatch) {
            glow.addColorStop(0, "rgba(239, 68, 68, 0.35)");
            glow.addColorStop(1, "rgba(239, 68, 68, 0)");
          } else if (isFocused) {
            glow.addColorStop(0, "rgba(99, 102, 241, 0.45)");
            glow.addColorStop(1, "rgba(99, 102, 241, 0)");
          } else if (node.bookmarked) {
            glow.addColorStop(0, "rgba(245, 158, 11, 0.4)");
            glow.addColorStop(1, "rgba(245, 158, 11, 0)");
          } else if (isPinned) {
            glow.addColorStop(0, "rgba(251, 191, 36, 0.3)");
            glow.addColorStop(1, "rgba(251, 191, 36, 0)");
          } else {
            glow.addColorStop(0, "rgba(255, 255, 255, 0.18)");
            glow.addColorStop(1, "rgba(255, 255, 255, 0)");
          }
          ctx.beginPath();
          ctx.arc(node.x, node.y, glowRadius, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
        }

        // Inner gradient fill
        const nodeGrad = ctx.createRadialGradient(
          node.x - node.radius * 0.3, node.y - node.radius * 0.3, 0,
          node.x, node.y, node.radius
        );
        if (!isFaded) {
          nodeGrad.addColorStop(0, effectiveColor.startsWith("rgba") ? effectiveColor : effectiveColor + "ff");
          nodeGrad.addColorStop(0.6, effectiveColor);
          nodeGrad.addColorStop(1, effectiveColor.startsWith("rgba") ? effectiveColor.replace(/[\d.]+\)$/, "0.3)") : effectiveColor + "88");
        } else {
          nodeGrad.addColorStop(0, "rgba(71, 85, 105, 0.25)");
          nodeGrad.addColorStop(1, "rgba(71, 85, 105, 0.1)");
        }

        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = nodeGrad;
        ctx.fill();

        // Node border with A11y Line Dash Patterns for Board Status Mode
        ctx.save();
        if (colorSchemeRef.current === "status" && node.boardStatus && node.boardStatus !== "none") {
          if (node.boardStatus === "In Progress") ctx.setLineDash([4, 3]);
          else if (node.boardStatus === "In Review") ctx.setLineDash([2, 2]);
          else if (node.boardStatus === "Backlog") ctx.setLineDash([1, 2]);
          else ctx.setLineDash([]);
        } else {
          ctx.setLineDash([]);
        }

        if (isHovered || isSearchMatch || isFocused) {
          ctx.strokeStyle = isSearchMatch ? "#ef4444" : isFocused ? "#6366f1" : "#ffffff";
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (node.bookmarked) {
          ctx.strokeStyle = "rgba(245, 158, 11, 0.9)";
          ctx.lineWidth = 1.6;
          ctx.stroke();
        } else if (isNeighbour) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
          ctx.lineWidth = 1.2;
          ctx.stroke();
        } else if (isPinned) {
          ctx.strokeStyle = "rgba(251, 191, 36, 0.8)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else if (!isFaded) {
          ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
          ctx.lineWidth = 0.8;
          ctx.stroke();
        }
        ctx.restore();

        // Accessibility Priority Badges for Task Priority Color Mode
        if (colorSchemeRef.current === "priority" && node.highestPriority && node.highestPriority !== "none" && !isFaded) {
          ctx.save();
          ctx.fillStyle = "#ffffff";
          ctx.font = `bold ${Math.max(7, node.radius * 0.75)}px Inter, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          const pBadge = node.highestPriority === "high" ? "!!!" : node.highestPriority === "medium" ? "!!" : "!";
          ctx.fillText(pBadge, node.x, node.y + 0.5);
          ctx.restore();
        }

        // Bookmark indicator ribbon badge
        if (node.bookmarked) {
          ctx.save();
          const bx = node.x + node.radius * 0.65;
          const by = node.y - node.radius * 0.75;
          const bw = Math.max(6.5, node.radius * 0.55);
          const bh = Math.max(8.5, node.radius * 0.75);

          ctx.fillStyle = "#f59e0b";
          ctx.beginPath();
          ctx.moveTo(bx - bw / 2, by - bh / 2);
          ctx.lineTo(bx + bw / 2, by - bh / 2);
          ctx.lineTo(bx + bw / 2, by + bh / 2);
          ctx.lineTo(bx, by + bh / 4);
          ctx.lineTo(bx - bw / 2, by + bh / 2);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }



        // Pin indicator dot
        if (isPinned && !node.bookmarked) {
          ctx.beginPath();
          ctx.arc(node.x + node.radius * 0.65, node.y - node.radius * 0.65, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = "#fbbf24";
          ctx.fill();
        }

        // Label visibility
        const shouldShowLabel =
          node.type === "folder" ||
          node.type === "tag-in-notes" ||
          isHovered ||
          isNeighbour ||
          isSearchMatch ||
          isFocused ||
          finalVisibleNodes.length < 24;

        if (shouldShowLabel) {
          ctx.font = isHovered || isSearchMatch || isFocused
            ? "bold 10.5px Inter, system-ui, sans-serif"
            : "500 9px Inter, system-ui, sans-serif";
          ctx.textAlign = "center";

          const labelW = ctx.measureText(node.label).width;

          // Crisp rounded backdrop pill behind label
          ctx.save();
          ctx.fillStyle = isDark ? "rgba(6, 7, 10, 0.75)" : "rgba(255, 255, 255, 0.85)";
          ctx.strokeStyle = isDark ? "rgba(30, 35, 53, 0.5)" : "rgba(203, 213, 225, 0.8)";
          ctx.lineWidth = 0.5;
          const pillX = node.x - labelW / 2 - 4;
          const pillY = node.y - node.radius - 18;
          const pillW = labelW + 8;
          const pillH = 13;
          const r = 3;
          ctx.beginPath();
          ctx.moveTo(pillX + r, pillY);
          ctx.lineTo(pillX + pillW - r, pillY);
          ctx.quadraticCurveTo(pillX + pillW, pillY, pillX + pillW, pillY + r);
          ctx.lineTo(pillX + pillW, pillY + pillH - r);
          ctx.quadraticCurveTo(pillX + pillW, pillY + pillH, pillX + pillW - r, pillY + pillH);
          ctx.lineTo(pillX + r, pillY + pillH);
          ctx.quadraticCurveTo(pillX, pillY + pillH, pillX, pillY + pillH - r);
          ctx.lineTo(pillX, pillY + r);
          ctx.quadraticCurveTo(pillX, pillY, pillX + r, pillY);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();

          ctx.fillStyle = isFaded
            ? "rgba(148, 163, 184, 0.25)"
            : node.type === "folder"
              ? "#fbbf24"
              : node.type === "tag-in-notes"
                ? (isDark ? "rgba(148, 163, 184, 0.9)" : "#475569")
                : node.type === "url"
                  ? "#f43f5e"
                  : node.type === "attachment"
                    ? "#a855f7"
                    : isSearchMatch
                      ? "#f87171"
                      : isFocused
                        ? "#a5b4fc"
                        : (isDark ? "#cbd5e1" : "#1e293b");

          ctx.fillText(node.label, node.x, node.y - node.radius - 8);
        }
      }

      ctx.restore(); // viewport transform
      ctx.restore(); // dpr scale

      // Draw minimap
      if (minimapCanvas) {
        const mCtx = minimapCanvas.getContext("2d");
        if (mCtx && finalVisibleNodes.length > 0) {
          const mW = minimapCanvas.width;
          const mH = minimapCanvas.height;
          mCtx.clearRect(0, 0, mW, mH);

          mCtx.fillStyle = isDark ? "rgba(11, 12, 16, 0.92)" : "rgba(241, 245, 249, 0.92)";
          mCtx.fillRect(0, 0, mW, mH);
          mCtx.strokeStyle = isDark ? "rgba(30, 35, 53, 0.8)" : "rgba(203, 213, 225, 0.8)";
          mCtx.lineWidth = 1;
          mCtx.strokeRect(0, 0, mW, mH);

          // Compute bounding box of all nodes
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          finalVisibleNodes.forEach(n => {
            if (n.x < minX) minX = n.x;
            if (n.x > maxX) maxX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.y > maxY) maxY = n.y;
          });
          const padding = 20;
          const bW = (maxX - minX) || 100;
          const bH = (maxY - minY) || 100;
          const scaleX = (mW - padding * 2) / bW;
          const scaleY = (mH - padding * 2) / bH;
          const mmScale = Math.min(scaleX, scaleY);

          finalVisibleNodes.forEach(n => {
            const mx = (n.x - minX) * mmScale + padding;
            const my = (n.y - minY) * mmScale + padding;
            mCtx.beginPath();
            mCtx.arc(mx, my, Math.max(1.5, n.radius * mmScale * 0.5), 0, Math.PI * 2);
            mCtx.fillStyle = getNodeColor(n, colorSchemeRef.current);
            mCtx.fill();
          });

          // Viewport indicator
          const viewLeft = (-pan.x / zoom - minX) * mmScale + padding;
          const viewTop = (-pan.y / zoom - minY) * mmScale + padding;
          const viewW = (logicalWidth / zoom) * mmScale;
          const viewH = (logicalHeight / zoom) * mmScale;
          mCtx.strokeStyle = "rgba(99, 102, 241, 0.7)";
          mCtx.lineWidth = 1;
          mCtx.strokeRect(viewLeft, viewTop, viewW, viewH);
        }
      }

      const isPanAnimating =
        Math.abs(targetPanRef.current.x - panRef.current.x) > 0.05 ||
        Math.abs(targetPanRef.current.y - panRef.current.y) > 0.05;
      const isZoomAnimating = Math.abs(targetZoomRef.current - zoomRef.current) > 0.0005;
      const isDragging = dragNodeRef.current !== null || isPanningRef.current;
      const isSimulating = alphaRef.current > 0.001 || isPanAnimating || isZoomAnimating || isDragging;

      if (isSimulating && isMounted) {
        frameRef.current = requestAnimationFrame(runSimulation);
      } else {
        isLoopRunningRef.current = false;
      }
    };

    isLoopRunningRef.current = true;
    frameRef.current = requestAnimationFrame(runSimulation);
    return () => {
      isMounted = false;
      isLoopRunningRef.current = false;
      cancelAnimationFrame(frameRef.current);
    };
  }, [nodes, links, getNodeColor]);

  // Coordinate utils
  const getVirtualCoords = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left - targetPanRef.current.x) / targetZoomRef.current;
    const y = (clientY - rect.top - targetPanRef.current.y) / targetZoomRef.current;
    return { x, y };
  };

  const findNodeAt = (x: number, y: number) => {
    for (const node of visibleNodesRef.current) {
      const dist = Math.sqrt((node.x - x) ** 2 + (node.y - y) ** 2);
      if (dist <= node.radius + 8) return node;
    }
    return null;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (contextMenu) return;
    if (isPanningRef.current) {
      const newPan = {
        x: e.clientX - panStartRef.current.x,
        y: e.clientY - panStartRef.current.y,
      };
      targetPanRef.current = newPan;
      panRef.current = newPan;
      wakeUpSimulation(0.1);
      return;
    }
    const { x, y } = getVirtualCoords(e.clientX, e.clientY);
    if (dragNodeRef.current) {
      dragNodeRef.current.x = x;
      dragNodeRef.current.y = y;
      dragNodeRef.current.vx = 0;
      dragNodeRef.current.vy = 0;
      wakeUpSimulation(0.2);
      return;
    }
    const found = findNodeAt(x, y);
    setHoveredNode(found);

    if (found) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const screenX = (found.x * zoomRef.current + panRef.current.x) + rect.left;
      const screenY = (found.y * zoomRef.current + panRef.current.y) + rect.top;
      const conns = linksRef.current.filter(l => l.source === found.id || l.target === found.id).length;
      setTooltip({ node: found, screenX, screenY, connections: conns });
    } else {
      setTooltip(null);
    }
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (contextMenu) { setContextMenu(null); return; }
    const { x, y } = getVirtualCoords(e.clientX, e.clientY);
    const clicked = findNodeAt(x, y);
    if (clicked) {
      dragNodeRef.current = clicked;
      wakeUpSimulation(0.25);
    } else {
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX - targetPanRef.current.x, y: e.clientY - targetPanRef.current.y };
      wakeUpSimulation(0.25);
    }
  };

  const handleMouseUp = () => {
    if (dragNodeRef.current) {
      dragNodeRef.current.vx = 0;
      dragNodeRef.current.vy = 0;
      dragNodeRef.current = null;
    }
    if (isPanningRef.current) {
      targetPanRef.current = { ...panRef.current };
      isPanningRef.current = false;
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getVirtualCoords(e.clientX, e.clientY);
    const node = findNodeAt(x, y);
    if (node) {
      if (node.type === "note" && node.path) {
        const fileName = node.path.replace(/\\/g, "/").split("/").pop() || node.label;
        openFile({ name: fileName, path: node.path, is_dir: false });
      } else if (node.type === "url" && node.path) {
        window.open(node.path, "_blank");
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const { x, y } = getVirtualCoords(e.clientX, e.clientY);
    const node = findNodeAt(x, y);
    if (node) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      setContextMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, node });
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Silk-smooth, gradual exponential scale factor based on trackpad/mouse deltaY
    const delta = Math.max(-100, Math.min(100, e.deltaY));
    const zoomFactor = Math.pow(0.9982, delta);

    const oldZoom = targetZoomRef.current;
    const newZoom = Math.min(Math.max(oldZoom * zoomFactor, 0.1), 5.0);

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const virtualMouseX = (mouseX - targetPanRef.current.x) / oldZoom;
    const virtualMouseY = (mouseY - targetPanRef.current.y) / oldZoom;

    targetZoomRef.current = newZoom;
    targetPanRef.current = {
      x: mouseX - virtualMouseX * newZoom,
      y: mouseY - virtualMouseY * newZoom,
    };
    wakeUpSimulation(0.15);
  };

  const resetZoom = () => {
    autoFitAndCenter();
  };

  const adjustZoom = (amount: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const oldZoom = targetZoomRef.current;
    const newZoom = Math.min(Math.max(oldZoom * (1 + amount * 0.35), 0.1), 5.0);
    const dpr = window.devicePixelRatio || 1;
    const centerX = (canvas.width / dpr) / 2;
    const centerY = (canvas.height / dpr) / 2;
    const virtualCenterX = (centerX - targetPanRef.current.x) / oldZoom;
    const virtualCenterY = (centerY - targetPanRef.current.y) / oldZoom;
    targetZoomRef.current = newZoom;
    targetPanRef.current = {
      x: centerX - virtualCenterX * newZoom,
      y: centerY - virtualCenterY * newZoom,
    };
  };

  const focusOnNode = useCallback((node: Node) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cx = (canvas.width / dpr) / 2;
    const cy = (canvas.height / dpr) / 2;
    targetZoomRef.current = 1.4;
    targetPanRef.current = {
      x: cx - node.x * 1.4,
      y: cy - node.y * 1.4,
    };
  }, []);

  const togglePinNode = useCallback((node: Node) => {
    setPinnedNodes(prev => {
      const next = new Set(prev);
      if (next.has(node.id)) {
        next.delete(node.id);
        node.pinned = false;
      } else {
        next.add(node.id);
        node.pinned = true;
      }
      return next;
    });
  }, []);

  // Physics Preset Applicator
  const applyPreset = (preset: "galaxy" | "web" | "tree" | "cluster") => {
    alphaRef.current = 1.0;
    if (preset === "galaxy") {
      setRepulsion(2200); setLinkDistance(180); setLinkStrength(0.35); setGravity(0.05); setCollisionRadius(28);
    } else if (preset === "web") {
      setRepulsion(1200); setLinkDistance(100); setLinkStrength(0.60); setGravity(0.10); setCollisionRadius(18);
    } else if (preset === "tree") {
      setRepulsion(3500); setLinkDistance(250); setLinkStrength(0.25); setGravity(0.03); setCollisionRadius(35);
    } else if (preset === "cluster") {
      setRepulsion(4200); setLinkDistance(320); setLinkStrength(0.15); setGravity(0.02); setCollisionRadius(40);
    }
  };

  return (
    <div
      className="flex h-full w-full dark:bg-[#08090d] bg-slate-100 text-slate-800 dark:text-slate-200 select-none relative"
      onClick={() => setContextMenu(null)}
    >
      {/* Sidebar */}
      <div className="w-72 border-r dark:border-[#1e2335] border-slate-200 dark:bg-sidebar/95 bg-slate-50/95 backdrop-blur-md p-4 flex flex-col gap-4 shrink-0 overflow-y-auto z-10 custom-scrollbar">
        {/* Header */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold text-sky-500 dark:text-sky-400 tracking-widest uppercase flex items-center gap-1.5">
              <Waypoints className="h-3.5 w-3.5 text-sky-500 dark:text-sky-400" /> Knowledge Graph
            </span>
            {/* Action Buttons: Save & Reset */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={handleSaveSettings}
                title="Save all graph selections & settings"
                className="flex items-center gap-1 px-2 py-0.5 text-[9.5px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded transition-all cursor-pointer active:scale-95"
              >
                {isSaveSuccess ? <Check className="h-3 w-3 text-emerald-500" /> : <Save className="h-3 w-3" />}
                <span>{isSaveSuccess ? "Saved!" : "Save"}</span>
              </button>
              <button
                onClick={handleResetDefaults}
                title="Reset all graph settings to defaults"
                className="flex items-center gap-1 px-2 py-0.5 text-[9.5px] font-semibold text-slate-600 dark:text-slate-400 bg-slate-500/10 hover:bg-slate-500/20 border border-slate-500/30 rounded transition-all cursor-pointer active:scale-95"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Reset</span>
              </button>
            </div>
          </div>
          <p className="text-[9.5px] text-slate-500 dark:text-slate-400 leading-relaxed">
            Drag nodes to reposition · Scroll to zoom · Double-click to open
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-1.5">
          <div className="bg-card border border-card-border shadow-xs rounded-lg p-1.5 flex flex-col">
            <span className="text-[8.5px] text-slate-500 uppercase tracking-widest flex items-center gap-1"><FileText className="h-2.5 w-2.5" />Notes</span>
            <span className="text-sm font-extrabold text-foreground mt-0.5">{stats.notes}</span>
          </div>
          <div className="bg-card border border-card-border shadow-xs rounded-lg p-1.5 flex flex-col">
            <span className="text-[8.5px] text-slate-500 uppercase tracking-widest flex items-center gap-1"><Link2 className="h-2.5 w-2.5" />Links</span>
            <span className="text-sm font-extrabold text-cyan-600 dark:text-cyan-400 mt-0.5">{stats.links}</span>
          </div>
          <div className="bg-card border border-card-border shadow-xs rounded-lg p-1.5 flex flex-col">
            <span className="text-[8.5px] text-slate-500 uppercase tracking-widest flex items-center gap-1"><Hash className="h-2.5 w-2.5" />Tags</span>
            <span className="text-sm font-extrabold text-slate-600 dark:text-slate-400 mt-0.5">{stats.tags}</span>
          </div>
          <div className="bg-card border border-card-border shadow-xs rounded-lg p-1.5 flex flex-col">
            <span className="text-[8.5px] text-slate-500 uppercase tracking-widest flex items-center gap-1"><Calendar className="h-2.5 w-2.5 text-sky-400" />Daily</span>
            <span className="text-sm font-extrabold text-sky-600 dark:text-sky-400 mt-0.5">{stats.daily}</span>
          </div>
          <div className="bg-card border border-card-border shadow-xs rounded-lg p-1.5 flex flex-col">
            <span className="text-[8.5px] text-slate-500 uppercase tracking-widest flex items-center gap-1"><Bookmark className="h-2.5 w-2.5 text-amber-400 shrink-0" />Bookmark</span>
            <span className="text-sm font-extrabold text-amber-600 dark:text-amber-400 mt-0.5">{stats.bookmarked}</span>
          </div>
          <div className="bg-card border border-card-border shadow-xs rounded-lg p-1.5 flex flex-col">
            <span className="text-[8.5px] text-slate-500 uppercase tracking-widest flex items-center gap-1"><GitBranch className="h-2.5 w-2.5 text-fuchsia-400" />Orphans</span>
            <span className="text-sm font-extrabold text-fuchsia-600 dark:text-fuchsia-400 mt-0.5">{stats.orphans}</span>
          </div>
        </div>

        {/* Search */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
            <Search className="h-3 w-3 text-slate-500 dark:text-slate-400" /> Search & Focus
          </span>
          <div className="relative">
            <input
              type="text"
              placeholder="Search notes, tags..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-md dark:bg-card bg-white px-2.5 py-1.5 pr-7 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 border dark:border-[#1e2335] border-slate-300 focus:outline-none focus:border-indigo-500/50 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Color Scheme Selector */}
        <div className="flex flex-col gap-1.5 border-t border-card-border pt-3">
          <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
            <Palette className="h-3.5 w-3.5 text-indigo-400" /> Color Mode
          </span>
          <div className="grid grid-cols-3 gap-1 bg-card p-1 rounded-lg border border-card-border">
            {[
              { id: "category", label: "Category" },
              { id: "priority", label: "Priority" },
              { id: "status", label: "Status" },
            ].map(m => (
              <button
                key={m.id}
                onClick={() => setColorScheme(m.id as any)}
                className={`py-1 text-[10px] font-bold rounded-md transition-all cursor-pointer ${colorScheme === m.id
                    ? "bg-indigo-600 text-white shadow shadow-indigo-600/30"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                  }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {/* Focus mode indicator */}
        {focusedNodeId && (
          <div className="flex items-center justify-between gap-2 bg-indigo-500/10 border border-indigo-500/30 rounded-lg px-2.5 py-2">
            <span className="text-[10px] text-indigo-600 dark:text-indigo-400 truncate flex items-center gap-1.5">
              <Focus className="h-3 w-3 shrink-0" />
              <span className="truncate">{nodes.find(n => n.id === focusedNodeId)?.label ?? "Focus"}</span>
            </span>
            <button
              onClick={() => setFocusedNodeId(null)}
              className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200 shrink-0"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        {/* Connection Filters */}
        <div className="flex flex-col gap-2 border-t border-card-border pt-3">
          <div
            onClick={() => setIsConnectionFiltersOpen(!isConnectionFiltersOpen)}
            className="flex items-center justify-between cursor-pointer select-none group"
          >
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5 group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors">
              <Layers className="h-3.5 w-3.5 text-slate-500" /> Connection Filters
            </span>
            <button
              type="button"
              className="text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors p-0.5 cursor-pointer"
            >
              {isConnectionFiltersOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>

          {isConnectionFiltersOpen && (
            <div className="flex flex-col gap-0.5 bg-card rounded-lg border border-card-border p-1">
              {filters.map((filter, index) => (
                <div
                  key={filter.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", String(index));
                    e.dataTransfer.effectAllowed = "all";
                  }}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer) {
                      e.dataTransfer.dropEffect = "move";
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const fromIndex = parseInt(e.dataTransfer.getData("text/plain"), 10);
                    if (isNaN(fromIndex) || fromIndex === index) return;
                    setFilters((prev) => {
                      const updated = [...prev];
                      const [moved] = updated.splice(fromIndex, 1);
                      updated.splice(index, 0, moved);
                      return updated;
                    });
                    alphaRef.current = 1.0;
                  }}
                  className="flex items-center justify-between p-1.5 rounded-md hover:bg-card-hover transition-colors group cursor-grab active:cursor-grabbing border border-transparent hover:border-card-border"
                >
                  <div className="flex items-center gap-2 select-none min-w-0 flex-1">
                    <GripVertical className="h-3.5 w-3.5 text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300 cursor-grab shrink-0" />
                    <input
                      type="checkbox"
                      checked={filter.checked}
                      onChange={(e) => {
                        const updated = filters.map(f => f.id === filter.id ? { ...f, checked: e.target.checked } : f);
                        setFilters(updated);
                        alphaRef.current = 1.0;
                      }}
                      className="accent-indigo-600 h-3.5 w-3.5 rounded-sm shrink-0 cursor-pointer"
                    />
                    <span className="flex items-center gap-1.5 text-[11px] text-foreground font-medium min-w-0 truncate">
                      {getFilterIcon(filter.id)}
                      <span className="truncate">{filter.label}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button disabled={index === 0} onClick={() => moveItem(index, "up")} className="p-0.5 rounded text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-30 disabled:pointer-events-none cursor-pointer">
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button disabled={index === filters.length - 1} onClick={() => moveItem(index, "down")} className="p-0.5 rounded text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 disabled:opacity-30 disabled:pointer-events-none cursor-pointer">
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Semantic AI Connections Settings Card */}
        <div className={`flex flex-col gap-2.5 pt-3 bg-indigo-500/5 dark:bg-indigo-500/10 p-2.5 rounded-xl border border-indigo-500/20 transition-all ${
          isSemanticEnabled ? "" : "opacity-60"
        }`}>
          <div className="flex items-center justify-between">
            <span className="text-[9.5px] font-bold text-indigo-500 dark:text-indigo-400 tracking-wider uppercase flex items-center gap-1.5 select-none">
              <Sparkles className="h-3.5 w-3.5 text-indigo-400" /> Semantic AI Controls
            </span>
            {/* Toggle Switch */}
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isSemanticEnabled}
                onChange={(e) => {
                  setIsSemanticEnabled(e.target.checked);
                  alphaRef.current = 1.0;
                }}
                className="sr-only peer"
              />
              <div className="w-7 h-4 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>

          <div className={`flex flex-col gap-2.5 transition-opacity ${isSemanticEnabled ? "" : "pointer-events-none opacity-50"}`}>
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex justify-between text-[10px] text-slate-500 font-medium">
                <span>Similarity Threshold</span>
                <span className="font-mono text-indigo-400 font-bold">{Math.round(semanticThreshold * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.45"
                max="0.95"
                step="0.05"
                disabled={!isSemanticEnabled}
                value={semanticThreshold}
                onChange={(e) => {
                  setSemanticThreshold(parseFloat(e.target.value));
                  alphaRef.current = 1.0;
                }}
                className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 disabled:cursor-not-allowed"
              />
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex justify-between text-[10px] text-slate-500 font-medium">
                <span>Max Links Per Note</span>
                <span className="font-mono text-indigo-400 font-bold">{maxSemanticLinksPerNote}</span>
              </div>
              <input
                type="range"
                min="1"
                max="10"
                step="1"
                disabled={!isSemanticEnabled}
                value={maxSemanticLinksPerNote}
                onChange={(e) => {
                  setMaxSemanticLinksPerNote(parseInt(e.target.value, 10));
                  alphaRef.current = 1.0;
                }}
                className="w-full h-1 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 disabled:cursor-not-allowed"
              />
            </div>
          </div>
        </div>

        {/* Physics Presets & Sliders */}
        <div className="flex flex-col gap-3 border-t dark:border-[#1e2335]/70 border-slate-300 pt-3">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-bold text-slate-500 dark:text-slate-600 uppercase tracking-widest flex items-center gap-1.5">
              <Sliders className="h-3.5 w-3.5 text-slate-500" /> Physics Engine
            </span>
            <button
              onClick={() => applyPreset("galaxy")}
              className="flex items-center gap-1 text-[9.5px] text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
            >
              <Sparkles className="h-3 w-3" /> Reset
            </button>
          </div>

          {/* Preset Buttons */}
          <div className="grid grid-cols-4 gap-1">
            {[
              { id: "galaxy", label: "Galaxy" },
              { id: "web", label: "Web" },
              { id: "tree", label: "Tree" },
              { id: "cluster", label: "Cluster" },
            ].map(p => (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id as any)}
                className="py-1 rounded bg-card border border-card-border hover:border-indigo-500/50 text-[9.5px] font-semibold text-slate-400 hover:text-slate-200 transition-all cursor-pointer"
              >
                {p.label}
              </button>
            ))}
          </div>

          {[
            { label: "Repulsion", value: repulsion, min: 200, max: 6000, step: 50, set: setRepulsion },
            { label: "Link Distance", value: linkDistance, min: 40, max: 450, step: 5, set: setLinkDistance },
            { label: "Link Strength", value: linkStrength, min: 0.01, max: 1.00, step: 0.01, set: setLinkStrength },
            { label: "Gravity", value: gravity, min: 0.001, max: 0.300, step: 0.005, set: setGravity },
            { label: "Collision Padding", value: collisionRadius, min: 0, max: 80, step: 2, set: setCollisionRadius },
            { label: "Connector Thickness", value: linkThickness, min: 0.5, max: 5.2, step: 0.1, set: setLinkThickness },
          ].map(({ label, value, min, max, step, set }) => (
            <div key={label} className="flex flex-col gap-1">
              <div className="flex justify-between text-[10px]">
                <span className="text-slate-600 dark:text-slate-400 font-medium">{label}</span>
                <span className="text-slate-500 tabular-nums">{typeof value === 'number' && value < 1 ? value.toFixed(3) : value}</span>
              </div>
              <input
                type="range" min={min} max={max} step={step} value={value}
                onChange={(e) => set(Number(e.target.value) as any)}
                className="accent-indigo-500 h-1 bg-[#1b1c26] rounded-full cursor-pointer"
              />
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="border-t border-[#1e2335]/70 pt-3 flex flex-col gap-2">
          <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5 text-slate-500" /> Interactive Legend ({colorScheme.toUpperCase()})
          </span>
          <div className="flex flex-col gap-1.5 text-[10.5px] text-slate-400">
            {colorScheme === "priority" ? (
              <>
                <span className="flex items-center gap-2 cursor-pointer hover:text-slate-200">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#ef4444] shrink-0" />High Priority
                </span>
                <span className="flex items-center gap-2 cursor-pointer hover:text-slate-200">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b] shrink-0" />Medium Priority
                </span>
                <span className="flex items-center gap-2 cursor-pointer hover:text-slate-200">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#3b82f6] shrink-0" />Low Priority
                </span>
                <span className="flex items-center gap-2 cursor-pointer hover:text-slate-200">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#64748b] shrink-0" />No Priority
                </span>
              </>
            ) : colorScheme === "status" ? (
              <>
                <span className="flex items-center gap-2 cursor-pointer hover:text-slate-200">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#10b981] shrink-0" />Done
                </span>
                <span className="flex items-center gap-2 cursor-pointer hover:text-slate-200">
                  <span className="h-2.5 w-2.5 rounded-full bg-accent-primary shrink-0" />In Progress
                </span>
                <span className="flex items-center gap-2 cursor-pointer hover:text-slate-200">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#a855f7] shrink-0" />In Review
                </span>
                <span className="flex items-center gap-2 cursor-pointer hover:text-slate-200">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#f59e0b] shrink-0" />Todo
                </span>
                <span className="flex items-center gap-2 cursor-pointer hover:text-slate-200">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#64748b] shrink-0" />Backlog
                </span>
              </>
            ) : (
              <>
                <span className="flex items-center gap-2 cursor-pointer hover:text-slate-200" onClick={() => setSearchQuery("")}>
                  <span className="h-2.5 w-2.5 rounded-full bg-[#d946ef] shrink-0" />Standard Notes ({stats.notes - stats.daily})
                </span>
                <span className="flex items-center gap-2 cursor-pointer hover:text-slate-200" onClick={() => setSearchQuery("daily")}>
                  <span className="h-2.5 w-2.5 rounded-full bg-[#38bdf8] shrink-0" />Daily Notes ({stats.daily})
                </span>
                <span className="flex items-center gap-2 cursor-pointer hover:text-slate-200">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#fbbf24] shrink-0" />Folders ({stats.folders})
                </span>
                <span className="flex items-center gap-2 cursor-pointer hover:text-slate-200">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#94a3b8]/50 shrink-0" />Tags ({stats.tags})
                </span>
                <span className="flex items-center gap-2 cursor-pointer hover:text-slate-200">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#f43f5e] shrink-0" />URLs ({stats.urls})
                </span>
                <span className="flex items-center gap-2 cursor-pointer hover:text-slate-200">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#a855f7] shrink-0" />Attachments ({stats.attachments})
                </span>
              </>
            )}
            <span className="flex items-center gap-2 pt-1 border-t border-[#1e2335]/50">
              <span className="h-0.5 w-4 bg-[#22d3ee] shrink-0" />Backlinks (→ directed) ({stats.links})
            </span>
            <span className="flex items-center gap-2">
              <Bookmark className="h-3 w-3 text-amber-400 fill-amber-400 shrink-0" />Bookmarked Notes ({stats.bookmarked})
            </span>
          </div>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="flex-1 h-full relative overflow-hidden bg-[#06070a]">
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          onContextMenu={handleContextMenu}
          onWheel={handleWheel}
          onMouseLeave={() => { setHoveredNode(null); setTooltip(null); }}
          className="w-full h-full cursor-grab active:cursor-grabbing"
        />

        {/* Minimap */}
        <div className="absolute bottom-16 right-4 z-10 rounded-lg overflow-hidden border border-[#1e2335]/80 shadow-xl">
          <canvas
            ref={minimapCanvasRef}
            width={140}
            height={100}
            className="block"
          />
        </div>

        {/* Zoom Controls */}
        <div className="absolute bottom-4 right-4 z-10 flex items-center gap-1 rounded-lg bg-card/90 border border-[#1e2335] p-1.5 shadow-xl backdrop-blur-md">
          <button onClick={() => adjustZoom(0.15)} className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors" title="Zoom In">
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => adjustZoom(-0.15)} className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors" title="Zoom Out">
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <div className="w-px h-4 bg-slate-800" />
          <button onClick={resetZoom} className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors" title="Center & Reset">
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Enhanced Tooltip */}
        {tooltip && (
          <div
            className="pointer-events-none absolute z-20 bg-white/95 dark:bg-[#0f1117]/95 border border-slate-200/90 dark:border-[#1e2335] rounded-xl shadow-2xl p-3 min-w-42.5 backdrop-blur-md transition-colors"
            style={{ left: Math.min(tooltip.screenX - (canvasRef.current?.getBoundingClientRect().left ?? 0) + 14, (canvasRef.current?.clientWidth ?? 300) - 190), top: Math.max((tooltip.screenY - (canvasRef.current?.getBoundingClientRect().top ?? 0)) - 90, 10) }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate max-w-35">{tooltip.node.label}</div>
              {tooltip.node.bookmarked && <Bookmark className="h-3 w-3 text-amber-500 dark:text-amber-400 fill-amber-500 dark:fill-amber-400 shrink-0" />}
            </div>

            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className="h-2 w-2 rounded-full shrink-0" style={{ background: getNodeColor(tooltip.node, colorScheme) }} />
              <span className="text-[10px] text-slate-600 dark:text-slate-400 capitalize font-medium">
                {tooltip.node.subType ? tooltip.node.subType : tooltip.node.type.replace("tag-in-notes", "Tag")}
              </span>
              {tooltip.node.highestPriority && tooltip.node.highestPriority !== "none" && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase border ${
                  tooltip.node.highestPriority === "high"
                    ? "bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/20"
                    : tooltip.node.highestPriority === "medium"
                    ? "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/20"
                    : "bg-sky-50 dark:bg-sky-500/10 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-500/20"
                }`}>
                  {tooltip.node.highestPriority} priority
                </span>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 text-[10px] text-slate-500 dark:text-slate-400 mt-2 border-t border-slate-200/80 dark:border-[#1e2335]/60 pt-1.5">
              <span>{tooltip.connections} link{tooltip.connections !== 1 ? "s" : ""}</span>
              {tooltip.node.tasksTotal !== undefined && tooltip.node.tasksTotal > 0 && (
                <span className="text-indigo-600 dark:text-indigo-400 font-semibold">{tooltip.node.tasksCompleted}/{tooltip.node.tasksTotal} tasks</span>
              )}
            </div>

            {tooltip.node.type === "note" && <div className="text-[9px] text-slate-400 dark:text-slate-600 mt-1 italic">Double-click to open note</div>}
          </div>
        )}

        {/* Context Menu */}
        {contextMenu && (
          <div
            className="absolute z-30 bg-white/98 dark:bg-[#0f1117]/98 border border-slate-200/90 dark:border-[#1e2335] rounded-xl shadow-2xl py-1 min-w-45 backdrop-blur-xl transition-colors"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-slate-200/80 dark:border-[#1e2335]/60">
              <div className="text-[11px] font-semibold text-slate-800 dark:text-slate-200 truncate max-w-40">{contextMenu.node.label}</div>
              <div className="text-[9.5px] text-slate-500 capitalize">{contextMenu.node.type.replace("tag-in-notes", "Tag")}</div>
            </div>
            {contextMenu.node.type === "note" && (
              <button
                className="w-full text-left px-3 py-2 text-[11px] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1a1c28] flex items-center gap-2 transition-colors cursor-pointer"
                onClick={() => {
                  const n = contextMenu.node;
                  if (n.path) {
                    const fileName = n.path.replace(/\\/g, "/").split("/").pop() || n.label;
                    openFile({ name: fileName, path: n.path, is_dir: false });
                  }
                  setContextMenu(null);
                }}
              >
                <FileText className="h-3.5 w-3.5 text-fuchsia-600 dark:text-fuchsia-400" /> Open Note
              </button>
            )}
            <button
              className="w-full text-left px-3 py-2 text-[11px] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1a1c28] flex items-center gap-2 transition-colors cursor-pointer"
              onClick={() => {
                setFocusedNodeId(prev => prev === contextMenu.node.id ? null : contextMenu.node.id);
                focusOnNode(contextMenu.node);
                setContextMenu(null);
              }}
            >
              <Focus className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              {focusedNodeId === contextMenu.node.id ? "Exit Focus Mode" : "Focus on Node"}
            </button>
            <button
              className="w-full text-left px-3 py-2 text-[11px] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1a1c28] flex items-center gap-2 transition-colors cursor-pointer"
              onClick={() => {
                togglePinNode(contextMenu.node);
                setContextMenu(null);
              }}
            >
              {pinnedNodes.has(contextMenu.node.id) ? (
                <><PinOff className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" /> Unpin Node</>
              ) : (
                <><Pin className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" /> Pin Node</>
              )}
            </button>
            <button
              className="w-full text-left px-3 py-2 text-[11px] text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#1a1c28] flex items-center gap-2 transition-colors cursor-pointer"
              onClick={() => {
                setSearchQuery(contextMenu.node.label);
                setContextMenu(null);
              }}
            >
              <Search className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" /> Search Similar
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
