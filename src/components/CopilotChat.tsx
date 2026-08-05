import React, { useState, useEffect, useRef, useCallback } from "react";
import { useVault, FileEntry } from "../contexts/VaultContext";
import { useSettings } from "../contexts/SettingsContext";
import { aiService } from "../lib/local-ai";
import { invokeIPC } from "../lib/ipc";
import { parseDiffBlocks, applyDiffBlocks } from "../lib/diff-applier";
import { StreamActionBuffer } from "../lib/stream-action-buffer";
import { actionRegistry } from "../lib/action-registry";
import { DEFAULT_AGENTS_MD } from "../constants/defaultAgents";
import { classifyIntent } from "../lib/intent-router";
import { searchEngine } from "../lib/search-engine";
import { embeddingQueue } from "../lib/embedding-queue";
import { 
  Paperclip, 
  Mic,
  X, 
  Sparkles,
  FileText,
  Copy,
  Check,
  CornerDownLeft,
  SquarePen,
  AlertTriangle,
  Zap,
  Hash,
  AtSign,
  CheckCircle,
  Tag as TagIcon,
  Package,
  Layers,
  ChevronDown,
  ExternalLink,
  Pin,
  SendHorizontal,
  Navigation,
  Target,
  CheckSquare,
  BookOpen,
  Undo2,
  History,
  Plus,
  Trash2,
  Search,
  MessageSquare,
  Square
} from "lucide-react";
import { message } from "@tauri-apps/plugin-dialog";
import aiStaticIcon from "../assets/ai-static.png";
import aiAnimatedGif from "../assets/ai-animated.gif";
import { MarkdownRenderer } from "./chat/MarkdownRenderer";

export interface ContextChip {
  id: string;
  label: string;
  type: "file" | "tag" | "excalidraw";
  path?: string;
  tag?: string;
}

export interface PendingActionCard {
  id: string;
  action: string;
  args: any;
  description: string;
  rawTag: string;
  status: "pending" | "approved" | "dismissed";
}

export interface ChatThread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  conversationHistory: { role: "user" | "assistant"; content: string }[];
}

export interface ChatMessage {
  id: string;
  sender: "user" | "copilot" | "system";
  text: string;
  timestamp: Date;
  referenceFile?: { name: string; path: string };
  pendingAction?: PendingActionCard;
  isEditApplied?: boolean;
  diffResult?: { original: string; updated: string; file: string };
  isEditing?: boolean;
}

interface ParsedAction {
  action: string;
  args: any;
  rawTag: string;
}

function parseActions(text: string): ParsedAction[] {
  const actions: ParsedAction[] = [];
  let index = 0;
  
  while (true) {
    const actionIndex = text.indexOf("[ACTION:", index);
    if (actionIndex === -1) break;
    
    const commaIndex = text.indexOf(",", actionIndex);
    if (commaIndex === -1) {
      index = actionIndex + 8;
      continue;
    }
    
    const actionName = text.substring(actionIndex + 8, commaIndex).trim();
    const startBraceIndex = text.indexOf("{", commaIndex);
    if (startBraceIndex === -1) {
      index = commaIndex + 1;
      continue;
    }
    
    let depth = 0;
    let inString = false;
    let escape = false;
    let endBraceIndex = -1;
    
    for (let i = startBraceIndex; i < text.length; i++) {
      const char = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (char === "\\") {
        escape = true;
        continue;
      }
      if (char === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (char === "{") {
          depth++;
        } else if (char === "}") {
          depth--;
          if (depth === 0) {
            endBraceIndex = i;
            break;
          }
        }
      }
    }
    
    if (endBraceIndex === -1) {
      index = startBraceIndex + 1;
      continue;
    }
    
    const jsonStr = text.substring(startBraceIndex, endBraceIndex + 1);
    const closeBracketIndex = text.indexOf("]", endBraceIndex);
    const rawTag = text.substring(actionIndex, closeBracketIndex !== -1 ? closeBracketIndex + 1 : endBraceIndex + 1);
    
    try {
      const cleanJson = jsonStr
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/```json/gi, "")
        .replace(/```/g, "");
      const args = JSON.parse(cleanJson);
      actions.push({
        action: actionName,
        args,
        rawTag
      });
    } catch (e) {
      console.warn("Failed to parse action JSON:", jsonStr, e);
      actions.push({
        action: actionName,
        args: null,
        rawTag
      });
    }
    
    index = endBraceIndex + 1;
  }
  
  // Bare JSON Fallback Parser: Catch raw JSON tool calls if standard [ACTION: ...] wrapper is missing
  if (actions.length === 0) {
    const jsonMatch = text.match(/\{[\s\S]*?"action"\s*:\s*"([^"]+)"[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const rawJson = jsonMatch[0];
        const parsed = JSON.parse(rawJson);
        if (parsed && parsed.action) {
          actions.push({
            action: parsed.action,
            args: parsed.args || parsed.arguments || {},
            rawTag: rawJson
          });
        }
      } catch (e) {
        console.warn("Failed to parse bare JSON tool call:", e);
      }
    }
  }

  return actions;
}

const DESTRUCTIVE_ACTIONS = new Set(["delete_note", "rename_note"]);

export interface CustomSkill {
  id: string;
  key: string;
  label: string;
  prompt: string;
  createdAt?: number;
}

interface CopilotChatProps {
  onClose?: () => void;
  isDetached?: boolean;
  onToggleDetach?: () => void;
  onOpenSettings?: () => void;
}

export const CopilotChat: React.FC<CopilotChatProps> = ({ onClose, isDetached: externalDetached, onToggleDetach, onOpenSettings }) => {
  const { userTimezone } = useSettings();
  const { 
    files, 
    activeFile, 
    openNoteByName, 
    activeView, 
    setActiveView, 
    refreshFiles, 
    noteCache, 
    triggerNotesScan, 
    updateNoteCache 
  } = useVault();

  const { vaultPath, aiLocalModel, aiProvider, setAiProvider, setAiLocalModel } = useSettings();

  const [inputMessage, setInputMessage] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);

  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [internalDetached, setInternalDetached] = useState(false);
  const isDetached = externalDetached !== undefined ? externalDetached : internalDetached;
  
  const handleDetachClick = async () => {
    const isStandalone = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "ai-chat";
    if (isStandalone) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const { emit } = await import("@tauri-apps/api/event");
        await emit("open-docked-ai-chat", {});
        await getCurrentWindow().close();
        return;
      } catch (err) {
        console.error("Failed to re-attach standalone window:", err);
      }
    }
    if (onToggleDetach) {
      onToggleDetach();
    } else {
      setInternalDetached(!internalDetached);
    }
  };

  // Model Menu Popover & Status Tracking
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [localModelsList, setLocalModelsList] = useState<any[]>([]);
  const [sysInfo, setSysInfo] = useState<any | null>(null);

  useEffect(() => {
    async function checkModelsStatus() {
      try {
        const list = await aiService.listModels();
        setLocalModelsList(list);
        const info = await aiService.getSystemInfo().catch(() => null);
        if (info) setSysInfo(info);
      } catch {}
    }
    checkModelsStatus();
  }, [aiProvider, aiLocalModel]);

  // Context Scope Toggle Mode ("active" | "vault" | "none")
  const [contextScopeMode, setContextScopeMode] = useState<"active" | "vault" | "none">("active");

  // App Attachment File Input and Media Context
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachedMediaFile, setAttachedMediaFile] = useState<{ name: string; type: string; url: string; rawFile: File } | null>(null);

  // Multi-Turn Conversation Memory (6 turns)
  const [conversationHistory, setConversationHistory] = useState<{ role: "user" | "assistant"; content: string }[]>([]);

  // Multi-Thread Chat Management
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState<boolean>(false);
  const [threadSearchQuery, setThreadSearchQuery] = useState<string>("");

  // Voice Dictation Speech Recognition
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const baseInputRef = useRef<string>("");

  // Attachment and Context Pins
  const [attachedFile, setAttachedFile] = useState<{ name: string; path: string } | null>(null);
  const [pinnedContexts, setPinnedContexts] = useState<ContextChip[]>([]);
  const [showSkillsDropdown, setShowSkillsDropdown] = useState(false);

  // Context token count inspector
  const [estimatedTokens, setEstimatedTokens] = useState<number>(0);

  // Mention Popover (@ and # triggers)
  const [mentionPopover, setMentionPopover] = useState<{
    active: boolean;
    trigger: "@" | "#";
    query: string;
  }>({ active: false, trigger: "@", query: "" });

  // Custom AI Skills Management & Persistence
  const [customSkills, setCustomSkills] = useState<CustomSkill[]>([]);
  const [showCreateSkillModal, setShowCreateSkillModal] = useState(false);
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillKey, setNewSkillKey] = useState("");
  const [newSkillPrompt, setNewSkillPrompt] = useState("");

  // Slash Menu (/ trigger)
  const [showSlashMenu, setShowSlashMenu] = useState<{ active: boolean; query: string }>({ active: false, query: "" });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const agentsCacheRef = useRef<{ path: string; content: string; mtime: number } | null>(null);
  const pinnedCacheRef = useRef<Map<string, { content: string; mtime: number }>>(new Map());

  const WELCOME_TEXT = "Hi! I am **Kognote Copilot**, your local AI workspace agent. I can extract tasks, update Kanban board cards, sync frontmatter, live edit notes, and answer questions across your vault.";

  const separator = vaultPath?.includes("\\") ? "\\" : "/";

  const BUILTIN_SKILLS = [
  { key: "create_note", label: "Create Structured Note", icon: FileText, prompt: "Create a new note titled \"Project Ideas\" with tags #ideas" },
  { key: "add_task", label: "Create Task Checklist", icon: CheckSquare, prompt: "Add a task checklist item for @task" },
  { key: "set_board_card", label: "Update Kanban Card", icon: Layers, prompt: "Add card to Kanban board column In Progress: " },
  { key: "extract_flashcards", label: "Extract Flashcards", icon: BookOpen, prompt: "Extract flashcards from active note with format (Question :: Answer)" },
  { key: "suggest_links", label: "Suggest Backlinks", icon: Sparkles, prompt: "Analyze active note and suggest wikilink connections across vault." },
  { key: "navigate", label: "Switch App View", icon: Navigation, prompt: "Switch view to calendar" }
];

  const handleAppFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (attachedMediaFile?.url) {
        URL.revokeObjectURL(attachedMediaFile.url);
      }
      setAttachedMediaFile({
        name: file.name,
        type: file.type || "file",
        url: URL.createObjectURL(file),
        rawFile: file,
      });
    }
  };

  // Voice Dictation Speech Recognition (Native OS Speech API Integration)
  const toggleVoiceInput = () => {
    if (isListening) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      message(
        "Speech Recognition engine is not available natively in this WebKit window.\n\n" +
        "Tip for Windows: Press Win + H to activate Windows System Voice Typing anywhere.\n" +
        "Tip for Mac: Press Fn key twice or F5 to activate macOS System Dictation.",
        { title: "System Voice Typing Available", kind: "info" }
      );
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";

      // Lock base input text so interim results don't duplicate existing text
      baseInputRef.current = inputMessage;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onerror = (event: any) => {
        console.warn("Speech Recognition Error:", event.error);
        setIsListening(false);
        if (event.error !== "no-speech" && event.error !== "aborted") {
          message(
            `Voice dictation note: ${event.error || "Permission required"}.\n\n` +
            `You can also use Win + H (Windows) or Fn key twice (Mac) for OS system voice dictation directly into the chat input!`,
            { title: "Voice Transcription", kind: "info" }
          );
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.onresult = (event: any) => {
        let finalTranscript = "";
        let interimTranscript = "";

        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) {
            finalTranscript += res[0].transcript + " ";
          } else {
            interimTranscript += res[0].transcript;
          }
        }

        const accumulatedText = (finalTranscript + interimTranscript).trim();
        if (accumulatedText) {
          const base = baseInputRef.current;
          const newCombined = base ? `${base} ${accumulatedText}` : accumulatedText;
          setInputMessage(newCombined);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      console.error("Failed to start speech recognition:", err);
      setIsListening(false);
    }
  };

  // Flatten markdown and canvas files for attachments / @ mentions
  const flatMdFiles = React.useMemo(() => {
    const list: { name: string; path: string; isCanvas: boolean }[] = [];
    const scan = (entries: FileEntry[]) => {
      entries.forEach((e) => {
        if (e.is_dir) {
          if (e.children) scan(e.children);
        } else {
          const isMd = e.name.toLowerCase().endsWith(".md");
          const isCanvas = e.name.toLowerCase().endsWith(".excalidraw");
          if (isMd || isCanvas) {
            list.push({ name: e.name, path: e.path, isCanvas });
          }
        }
      });
    };
    scan(files);
    return list;
  }, [files]);

  // Extract all unique vault tags for # mention popover
  const vaultTags = React.useMemo(() => {
    const tagsSet = new Set<string>();
    Object.values(noteCache).forEach((data: any) => {
      if (data && data.tags) {
        data.tags.forEach((t: string) => tagsSet.add(t.toLowerCase()));
      }
    });
    return Array.from(tagsSet);
  }, [noteCache]);

  const createNewThread = () => {
    const newId = "thread_" + Date.now();
    const welcomeMsg: ChatMessage = {
      id: "welcome_" + Date.now(),
      sender: "copilot",
      text: WELCOME_TEXT,
      timestamp: new Date()
    };
    const newThread: ChatThread = {
      id: newId,
      title: "New Chat",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [welcomeMsg],
      conversationHistory: []
    };

    setThreads((prev) => [newThread, ...prev]);
    setActiveThreadId(newId);
    setMessages([welcomeMsg]);
    setConversationHistory([]);
    setIsHistoryDrawerOpen(false);
  };

  const switchThread = (threadId: string) => {
    const target = threads.find((t) => t.id === threadId);
    if (target) {
      setActiveThreadId(threadId);
      setMessages(target.messages || []);
      setConversationHistory(target.conversationHistory || []);
      setIsHistoryDrawerOpen(false);
    }
  };

  const deleteThread = (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const remaining = threads.filter((t) => t.id !== threadId);
    setThreads(remaining);
    if (activeThreadId === threadId) {
      if (remaining.length > 0) {
        const first = remaining[0];
        setActiveThreadId(first.id);
        setMessages(first.messages || []);
        setConversationHistory(first.conversationHistory || []);
      } else {
        createNewThread();
      }
    }
  };

  const handleNewChat = () => {
    createNewThread();
  };

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text.replace(/\[ACTION:.*?\]/g, "").trim());
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleInsertToNote = async (textToInsert: string) => {
    if (!activeFile) {
      await message("No note is currently open to insert content into.", {
        title: "No Open Note",
        kind: "warning"
      });
      return;
    }

    if (activeFile.path.replace(/\\/g, "/").includes("/Daily Logs/")) {
      await message("Daily Logs are protected and cannot be edited.", {
        title: "Protected Note",
        kind: "error"
      });
      return;
    }

    try {
      const path = activeFile.path;
      const currentContent = await invokeIPC("read_note", {
        path
      }) as string;

      let cleanText = textToInsert
        .replace(/\[ACTION:[^\]]*\]/gi, "")
        .replace(/<<<<<<< SEARCH[\s\S]*?>>>>>>> REPLACE/gi, "")
        .trim();

      const outerFenceRegex = /^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i;
      if (outerFenceRegex.test(cleanText)) {
        cleanText = cleanText.replace(outerFenceRegex, "$1").trim();
      }
      cleanText = cleanText
        .replace(/^```(?:markdown|md|text)?\s*\n?/i, "")
        .replace(/\n?```$/, "")
        .trim();

      const updatedContent = currentContent 
        ? `${currentContent}\n\n${cleanText}`
        : cleanText;

      await invokeIPC("write_note", {
        path,
        content: updatedContent
      });

      updateNoteCache(path, updatedContent);
      refreshFiles();

      window.dispatchEvent(new CustomEvent("reload-active-file", { detail: { path } }));
      
      await message(`Successfully appended response to "${activeFile.name.replace(/\.md$/, "")}"!`, {
        title: "Content Inserted",
        kind: "info"
      });
    } catch (err: any) {
      console.error(err);
      await message(`Failed to insert content: ${err.message || err}`, {
        title: "Insert Error",
        kind: "error"
      });
    }
  };

  const handleUndoAction = async () => {
    const res = await actionRegistry.undoLastAction();
    if (res.success) {
      refreshFiles();
      triggerNotesScan();
      await message(res.message, { title: "Action Undone", kind: "info" });
    } else {
      await message(res.message, { title: "Undo", kind: "warning" });
    }
  };

  // Persistent Custom Skills Loading & Storage (localStorage + Vault File Sync)
  useEffect(() => {
    async function loadSkills() {
      try {
        let loadedSkills: CustomSkill[] = [];
        if (vaultPath) {
          const sep = vaultPath.includes("\\") ? "\\" : "/";
          const skillsFilePath = `${vaultPath}${sep}.kognote${sep}skills.json`;
          try {
            const exists = await invokeIPC("fs_exists", { path: skillsFilePath }).catch(() => false);
            if (exists) {
              const fileData = (await invokeIPC("read_note", { path: skillsFilePath })) as string;
              if (fileData) {
                const parsed = JSON.parse(fileData);
                if (Array.isArray(parsed)) loadedSkills = parsed;
              }
            }
          } catch {}
        }

        if (loadedSkills.length === 0) {
          const saved = localStorage.getItem("kognote_custom_skills");
          if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) loadedSkills = parsed;
          }
        }

        if (loadedSkills.length > 0) {
          setCustomSkills(loadedSkills);
        }
      } catch (e) {
        console.warn("Failed to load custom skills:", e);
      }
    }
    loadSkills();
  }, [vaultPath]);

  const saveSkillsToStorageAndVault = async (updatedSkills: CustomSkill[]) => {
    setCustomSkills(updatedSkills);
    try {
      localStorage.setItem("kognote_custom_skills", JSON.stringify(updatedSkills));
    } catch {}

    if (vaultPath) {
      try {
        const sep = vaultPath.includes("\\") ? "\\" : "/";
        const kognoteDir = `${vaultPath}${sep}.kognote`;
        const skillsFilePath = `${kognoteDir}${sep}skills.json`;
        const dirExists = await invokeIPC("fs_exists", { path: kognoteDir }).catch(() => false);
        if (!dirExists) {
          await invokeIPC("create_folder", { path: kognoteDir }).catch(() => {});
        }
        await invokeIPC("write_note", {
          path: skillsFilePath,
          content: JSON.stringify(updatedSkills, null, 2),
        }).catch(() => {});
      } catch (err) {
        console.warn("Failed to write skills.json to vault:", err);
      }
    }
  };

  const handleSaveCustomSkill = () => {
    if (!newSkillName.trim() || !newSkillPrompt.trim()) return;
    const cleanKey = (newSkillKey.trim() || newSkillName.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_")).replace(/^[\/]/, "");

    const newSkill: CustomSkill = {
      id: "skill_" + Date.now(),
      key: cleanKey,
      label: newSkillName.trim(),
      prompt: newSkillPrompt.trim(),
      createdAt: Date.now()
    };

    const updated = [newSkill, ...customSkills];
    saveSkillsToStorageAndVault(updated);

    setNewSkillName("");
    setNewSkillKey("");
    setNewSkillPrompt("");
    setShowCreateSkillModal(false);
  };

  const handleDeleteCustomSkill = (skillId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = customSkills.filter((s) => s.id !== skillId);
    saveSkillsToStorageAndVault(updated);
  };

  // Restore or Initialize Chat Threads (Fresh thread if opened >2 mins after last close)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("kognote_copilot_chat_threads");
      const lastClosed = localStorage.getItem("kognote_copilot_last_closed");
      const now = Date.now();
      const isFreshOpen = !lastClosed || (now - parseInt(lastClosed, 10) > 120000); // 2 minute threshold

      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const formattedThreads = parsed.map((t: any) => ({
            ...t,
            messages: (t.messages || []).map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
          }));
          setThreads(formattedThreads);

          if (!isFreshOpen) {
            // Re-opened within 2 minutes: preserve active chat thread
            const first = formattedThreads[0];
            setActiveThreadId(first.id);
            setMessages(first.messages || []);
            setConversationHistory(first.conversationHistory || []);
            return;
          }
        }
      }
    } catch (e) {
      console.warn("Failed to parse chat threads:", e);
    }

    // Fresh open (>2 minutes or fresh start): start a clean new thread!
    createNewThread();

    return () => {
      // Record timestamp when panel is closed/unmounted
      try {
        localStorage.setItem("kognote_copilot_last_closed", Date.now().toString());
      } catch {}
    };
  }, []);

  // Sync Current Thread State & Persist
  useEffect(() => {
    if (!activeThreadId || threads.length === 0) return;
    setThreads((prev) => {
      const updated = prev.map((t) => {
        if (t.id === activeThreadId) {
          let title = t.title;
          if (title === "New Chat" && messages.length > 1) {
            const userMsg = messages.find((m) => m.sender === "user");
            if (userMsg?.text) {
              title = userMsg.text.slice(0, 32).trim() + (userMsg.text.length > 32 ? "..." : "");
            }
          }
          return {
            ...t,
            title,
            updatedAt: Date.now(),
            messages,
            conversationHistory,
          };
        }
        return t;
      });

      try {
        const sanitized = updated.map((t) => ({
          ...t,
          conversationHistory: (t.conversationHistory || []).slice(-12),
        }));
        localStorage.setItem("kognote_copilot_chat_threads", JSON.stringify(sanitized.slice(0, 30)));
      } catch {}
      return updated;
    });
  }, [messages, conversationHistory, activeThreadId]);

  // Smart Auto-Scroll to Bottom during stream unless user manually scrolled up
  useEffect(() => {
    if (!userScrolledUp) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, loading, userScrolledUp]);

  // Reactive Token Count Estimation
  useEffect(() => {
    let charLen = inputMessage.length;
    if (contextScopeMode === "active" && activeFile) {
      const cached = noteCache[activeFile.path];
      if (cached) charLen += 1200;
    } else if (contextScopeMode === "vault") {
      charLen += Object.keys(noteCache).length * 80;
    }
    charLen += pinnedContexts.length * 500;
    setEstimatedTokens(Math.ceil(charLen / 4));
  }, [inputMessage, pinnedContexts, contextScopeMode, activeFile, noteCache]);

  // Agentic Skill Execution Engine
  const executeSkill = async (action: string, args: any): Promise<string> => {
    try {
      if (action === "navigate") {
        const targetView = args.view;
        const validViews = ["editor", "canvas", "graph", "calendar", "tasks", "board", "flashcards"];
        if (validViews.includes(targetView)) {
          setActiveView(targetView as any);
          return `🔄 Switched view to **${targetView.toUpperCase()}**!`;
        }
        return `⚠️ Unknown view: ${targetView}. Valid views are editor, canvas, graph, calendar, tasks, board.`;
      } 
      
      else if (action === "read_note") {
        const name = args.name;
        if (!name) return "⚠️ Note name is required.";
        const targetFile = flatMdFiles.find(f => f.name.toLowerCase() === name.toLowerCase() || f.name.toLowerCase() === `${name.toLowerCase()}.md`);
        if (!targetFile) return `⚠️ Note "${name}" not found in vault.`;
        
        const content = await invokeIPC("read_note", { path: targetFile.path }) as string;
        return `📖 Content of **${targetFile.name}**:\n\n${content.slice(0, 800)}${content.length > 800 ? "..." : ""}`;
      } 

      else if (action === "suggest_links") {
        window.dispatchEvent(new CustomEvent("trigger-suggest-links"));
        return `🔗 Triggered link suggestions for the active note!`;
      }

      // Delegate all note writes/creations/deletions/task toggles to actionRegistry
      const res = await actionRegistry.executeAction(action, args, vaultPath || "");
      if (res.success) {
        refreshFiles();
        triggerNotesScan();
        return res.message;
      }
      return `⚠️ Action ${action} failed: ${res.message}`;
    } catch (err: any) {
      console.error(err);
      return `❌ Skill execution failed: ${err.message || err}`;
    }
  };

  // Execute Destructive Pending Action Card Approval
  const handleApprovePendingAction = async (card: PendingActionCard, msgId: string) => {
    try {
      const feedback = await executeSkill(card.action.toLowerCase(), card.args);
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id === msgId) {
            return {
              ...m,
              text: `${m.text}\n\n✅ Action Executed: ${feedback}`,
              pendingAction: undefined,
            };
          }
          return m;
        })
      );
      if (activeFile) {
        window.dispatchEvent(new CustomEvent("reload-active-file", { detail: { path: activeFile.path } }));
      }
    } catch (e: any) {
      await message(`Action failed: ${e.message || e}`, { title: "Action Error", kind: "error" });
    }
  };

  const handleDismissPendingAction = (msgId: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id === msgId) {
          return {
            ...m,
            text: `${m.text}\n\n❌ Action Cancelled.`,
            pendingAction: undefined,
          };
        }
        return m;
      })
    );
  };

  // Submit Prompt with Autonomous Smart Intent Detection
  const submitPrompt = useCallback(async (userText: string, fileContext: { name: string; path: string } | null = null) => {
    if (!userText.trim() && !fileContext && pinnedContexts.length === 0 && !attachedMediaFile) return;

    const targetRefFile = fileContext || activeFile || null;

    const activeMsg: ChatMessage = {
      id: Math.random().toString(),
      sender: "user",
      text: userText || `Shared attachment: ${attachedMediaFile?.name || targetRefFile?.name}`,
      timestamp: new Date(),
      referenceFile: targetRefFile || undefined
    };

    setMessages((prev) => [...prev.filter((m) => !m.id.startsWith("welcome")), activeMsg]);
    setLoading(true);
    embeddingQueue.pause();

    try {
      // Media attachment base64 reading
      let mediaOptions: { imageBase64?: string; imageMimeType?: string } | undefined = undefined;
      if (attachedMediaFile?.rawFile) {
        try {
          const b64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve((reader.result as string).split(",")[1] || "");
            reader.onerror = reject;
            reader.readAsDataURL(attachedMediaFile.rawFile);
          });
          mediaOptions = {
            imageBase64: b64,
            imageMimeType: attachedMediaFile.type || "image/jpeg",
          };
        } catch (err) {
          console.warn("Failed to read attached media file:", err);
        }
      }

      // 1. Workspace Context Assembly
      let contextHeader = `Kognote Workspace Context:\n`;
      contextHeader += `- Current ISO Timestamp: ${new Date().toISOString()}\n`;
      contextHeader += `- User Configured Timezone: ${userTimezone}\n`;
      contextHeader += `- Active View: ${activeView}\n`;
      contextHeader += `- Selected Context Scope Mode: ${contextScopeMode}\n`;
      if (activeFile) {
        contextHeader += `- Currently Focused Note: ${activeFile.name}\n`;
      }

      // 2. Scope-Specific Context Assembly (Dynamic Token-Budget Allocation RAG)
      const tokenBudget = aiProvider === "local" ? 3000 : 16000;

      if (contextScopeMode === "vault") {
        contextHeader += `\n[ENTIRE VAULT VECTOR RAG CONTEXT (Time-Weighted & Dynamic Budget Matches)]:\n`;
        try {
          const searchResults = await searchEngine.hybridRrfSearchWithBudget(userText, tokenBudget);
          if (searchResults && searchResults.length > 0) {
            for (let idx = 0; idx < searchResults.length; idx++) {
              const res = searchResults[idx];
              const noteName = res.filePath.split(/[\/\\]/).pop()?.replace(/\.md$/i, "") || res.filePath;
              const dateStr = res.updatedAt ? new Date(res.updatedAt).toISOString().split("T")[0] : "Recent";
              contextHeader += `--- Match ${idx + 1} (From Note: [[${noteName}]], Last Edited: ${dateStr}) ---\n${res.chunkText}\n\n`;
            }
          } else {
            // Fallback note summary index if vector search returns 0
            const entries = Object.values(noteCache).slice(0, 30);
            for (const entry of entries) {
              const title = entry.path.split(/[\/\\]/).pop()?.replace(/\.md$/, "") || "";
              contextHeader += `- Note: [[${title}]]\n`;
            }
          }
        } catch (err) {
          console.warn("Vault RAG search error:", err);
        }
      } else if (contextScopeMode === "none") {
        // NO CONTEXT / PURE READ-ONLY QA MODE: Extract database facts only, no note editing
        contextHeader += `\n[DATABASE REFERENCE FACTS (READ-ONLY QA MODE)]:\n`;
        try {
          const searchResults = await searchEngine.hybridRrfSearchWithBudget(userText, Math.min(tokenBudget, 2000));
          if (searchResults && searchResults.length > 0) {
            for (let idx = 0; idx < searchResults.length; idx++) {
              const res = searchResults[idx];
              const noteName = res.filePath.split(/[\/\\]/).pop()?.replace(/\.md$/i, "") || res.filePath;
              const dateStr = res.updatedAt ? new Date(res.updatedAt).toISOString().split("T")[0] : "Recent";
              contextHeader += `--- Database Fact ${idx + 1} (From Note: [[${noteName}]], Last Edited: ${dateStr}): ---\n${res.chunkText}\n\n`;
            }
          }
        } catch (err) {
          console.warn("Database QA search error:", err);
        }
      }

      // 3. Isolated Turn History (strictly for active thread)
      if (conversationHistory.length > 0) {
        contextHeader += `\n[CURRENT CHAT CONVERSATION HISTORY (LAST 6 TURNS)]:\n`;
        const recentTurns = conversationHistory.slice(-6);
        for (const turn of recentTurns) {
          contextHeader += `${turn.role.toUpperCase()}: ${turn.content}\n`;
        }
      }

      // 4. Ingest Pinned Context Chips (@notes and #tags) with caching
      if (pinnedContexts.length > 0) {
        contextHeader += `\n[PINNED CONTEXT REPOSITORIES]:\n`;
        const nowMs = Date.now();
        for (const chip of pinnedContexts) {
          if (chip.path) {
            try {
              const cached = pinnedCacheRef.current.get(chip.path);
              let text = cached && (nowMs - cached.mtime < 30000) ? cached.content : "";
              if (!text) {
                text = (await invokeIPC("read_note", { path: chip.path })) as string;
                pinnedCacheRef.current.set(chip.path, { content: text, mtime: nowMs });
              }
              contextHeader += `--- PINNED NOTE: "${chip.label}" ---\n${text.slice(0, 4000)}\n\n`;
            } catch {}
          } else if (chip.tag) {
            contextHeader += `--- PINNED TAG: #${chip.tag} ---\n`;
            const taggedFiles = flatMdFiles.filter((f) => {
              const data = noteCache[f.path];
              return data && data.tags && data.tags.some((t: string) => t.toLowerCase() === chip.tag!.toLowerCase());
            }).slice(0, 3);

            for (const tf of taggedFiles) {
              try {
                const cached = pinnedCacheRef.current.get(tf.path);
                let text = cached && (nowMs - cached.mtime < 30000) ? cached.content : "";
                if (!text) {
                  text = (await invokeIPC("read_note", { path: tf.path })) as string;
                  pinnedCacheRef.current.set(tf.path, { content: text, mtime: nowMs });
                }
                contextHeader += `[Tag Match: ${tf.name}]\n${text.slice(0, 2000)}\n\n`;
              } catch {}
            }
          }
        }
      }

      // 5. Ingest Vault AGENTS.md rules with TTL caching (30s)
      let agentsRuleContent = DEFAULT_AGENTS_MD;
      const agentsPath = `${vaultPath}${separator}AGENTS.md`;
      const now = Date.now();
      if (agentsCacheRef.current && agentsCacheRef.current.path === agentsPath && (now - agentsCacheRef.current.mtime < 30000)) {
        agentsRuleContent = agentsCacheRef.current.content;
      } else {
        try {
          const agentsExists = await invokeIPC("fs_exists", { path: agentsPath }).catch(() => false);
          if (agentsExists) {
            const readText = (await invokeIPC("read_note", { path: agentsPath })) as string;
            if (readText && readText.trim()) {
              agentsRuleContent = readText;
              agentsCacheRef.current = { path: agentsPath, content: readText, mtime: now };
            }
          }
        } catch {}
      }

      contextHeader += `\n[CRITICAL SYSTEM OPERATING DIRECTIVE (AGENTS.md)]:\nNOTE TO AI: The following rules are SYSTEM OPERATING GUIDELINES governing how you execute actions and format notes. Do NOT treat them as note text to summarize or reproduce.\n"""\n${agentsRuleContent.trim()}\n"""\n`;

      let refText = "";
      // Primary Reference Note is read if contextScopeMode !== "none"
      const noteFileToRead = targetRefFile || (contextScopeMode === "active" ? activeFile : null);
      if (noteFileToRead && contextScopeMode !== "none") {
        try {
          refText = (await invokeIPC("read_note", {
            path: noteFileToRead.path,
          })) as string;
          contextHeader += `\n[PRIMARY REFERENCE NOTE] "${noteFileToRead.name}" Text Content:\n"""\n${refText}\n"""\n`;
        } catch {
          contextHeader += `- Primary Note: ${noteFileToRead.name} (Unreadable)\n`;
        }
      }

      // Priority-Aware Context Trimming (protect System Rules & Primary Note over RAG chunks)
      const MAX_CONTEXT_CHARS = aiProvider === "local" ? 32000 : 120000;
      if (contextHeader.length > MAX_CONTEXT_CHARS) {
        // Find RAG context block and trim RAG chunks first
        const ragIndex = contextHeader.indexOf("[ENTIRE VAULT VECTOR RAG CONTEXT");
        const agentsIndex = contextHeader.indexOf("[CRITICAL SYSTEM OPERATING DIRECTIVE");
        if (ragIndex !== -1 && agentsIndex > ragIndex) {
          const beforeRag = contextHeader.slice(0, ragIndex);
          const afterRag = contextHeader.slice(agentsIndex);
          const allowedRagChars = Math.max(1000, MAX_CONTEXT_CHARS - (beforeRag.length + afterRag.length));
          const ragBlock = contextHeader.slice(ragIndex, agentsIndex).slice(0, allowedRagChars);
          contextHeader = `${beforeRag}${ragBlock}\n[...RAG context trimmed for length...]\n\n${afterRag}`;
        } else {
          contextHeader = contextHeader.slice(0, MAX_CONTEXT_CHARS) + "\n\n[Context trimmed to fit model token limit]\n";
        }
      }

      // Compute Context Token Budget
      const fullContextLength = contextHeader.length + userText.length;
      const estimatedTokenCount = Math.ceil(fullContextLength / 4);
      setEstimatedTokens(estimatedTokenCount);

      // Run Pre-Flight Intent Gateway Classification with recent conversation history context
      const recentHistory = messages.slice(-3).map((m) => m.text);
      const intentResult = await classifyIntent(userText, targetRefFile?.name, pinnedContexts.length, recentHistory);

      let intentDirective = "";
      if (contextScopeMode === "none") {
        intentDirective =
          `[ROUTED INTENT: NO CONTEXT / PURE READ-ONLY QA MODE]\n` +
          `The user selected NO CONTEXT mode. You MUST answer the user's prompt directly, accurately, and concisely based on retrieved database facts.\n` +
          `CRITICAL: Do NOT output search/replace blocks or attempt to edit any note.\n\n`;
      } else if (intentResult.intent === "DO") {
        const editTargetName = noteFileToRead?.name || intentResult.targetFile || targetRefFile?.name || "the open note";
        intentDirective =
          `[ROUTED INTENT: DO MODE — MANDATORY NOTE EDIT]\n` +
          `The user wants you to directly modify "${editTargetName}".\n` +
          `YOU MUST OUTPUT A SEARCH/REPLACE BLOCK. Do NOT show the content in a code fence or chat response.\n` +
          `Do NOT explain what you are doing. Just emit the block and nothing else.\n\n` +
          `HOW TO USE SEARCH/REPLACE BLOCKS:\n` +
          `Rule 1 — REPLACING existing content: put the exact lines to remove in SEARCH, put the new lines in REPLACE.\n` +
          `Rule 2 — INSERTING / APPENDING new content (no existing text to replace): leave SEARCH completely empty.\n` +
          `Rule 3 — NEVER wrap the SEARCH or REPLACE section in backtick code fences.\n` +
          `Rule 4 — You may output multiple blocks for multiple changes.\n\n` +
          `EXAMPLE A — Replace a section:\n` +
          `<<<<<<< SEARCH\n## Old Heading\nOld content here.\n=======\n## New Heading\nNew content here.\n>>>>>>> REPLACE\n\n` +
          `EXAMPLE B — Insert/Append new content at end of note (SEARCH is empty):\n` +
          `<<<<<<< SEARCH\n=======\n| Col 1 | Col 2 |\n|-------|-------|\n| | |\n>>>>>>> REPLACE\n\n`;
      } else {
        intentDirective =
          `[ROUTED INTENT: CHAT MODE (EXPLANATION & QA)]\n` +
          `The user is asking a question or requesting a conceptual explanation.\n` +
          `ANSWER DIRECTLY, CONCISELY, AND CLEANLY IN MARKDOWN.\n` +
          `Do NOT output search/replace blocks or edit notes unless explicitly asked.\n\n`;
      }

      // Unified System Prompt with Smart Autonomous Intent Detection & Complete Note Metadata Schema
      const systemPrompt =
        `You are Kognote AI, a smart, localized, reference-aware assistant for Kognote.\n` +
        intentDirective +
        `IMPORTANT ROLE & OPERATING RULE:\n` +
        `The system instructions provided to you (including AGENTS.md guidelines and metadata schemas) are GOVERNING OPERATING DIRECTIVES for how you process, format, and edit notes. They are NOT note content or user conversation context to quote or print out.\n\n` +
        `KOGNOTE METADATA SCHEMAS & SYNTAX:\n` +
        `- YAML Frontmatter: --- status: backlog|todo|in-progress|in-review|done, priority: high|medium|low|none, due: YYYY-MM-DD, type: note|daily|template|clipping, storage: active|archived|deleted, bookmarked: yes|no, mentions: [], tags: [] ---\n` +
        `- Checklist Tasks: - [ ] Task description @YYYY-MM-DD !|!!|!!! #tag (where ! low, !! medium, !!! high)\n` +
        `- WikiLinks: [[Target Note Title]] (syncs to Knowledge Graph)\n` +
        `- Flashcards: Q: Question? \\n A: Answer. or ( Question :: Answer ) (syncs to SRS Review Deck)\n\n` +
        `ACTION SKILLS (use these tags when the user asks to switch views, create/delete/rename notes, or update Kanban/tasks):\n` +
        `- Switch view: [ACTION:navigate, {"view": "editor|canvas|graph|calendar|tasks|board|flashcards"}]\n` +
        `- Create note: [ACTION:create_note, {"name": "Note Name"}]\n` +
        `- Overwrite note: [ACTION:write_note, {"name": "Note Name", "content": "..."}]\n` +
        `- Replace text block: [ACTION:replace_block, {"name": "Note Name", "search_text": "old text", "replace_text": "new text"}]\n` +
        `- Append note: [ACTION:append_note, {"name": "Note Name", "content": "..."}]\n` +
        `- Delete note: [ACTION:delete_note, {"name": "Note Name"}]\n` +
        `- Rename note: [ACTION:rename_note, {"oldName": "Old Title", "newName": "New Title"}]\n` +
        `- Kanban board update: [ACTION:set_board_card, {"name": "Note Name", "status": "backlog|todo|in-progress|in-review|done", "priority": "high|medium|low|none"}]\n` +
        `- Toggle task status: [ACTION:set_task_status, {"noteName": "Note Name", "taskText": "snippet", "completed": true}]\n` +
        `- Add task item: [ACTION:add_task, {"text": "Task description", "noteName": "Target Note", "date": "YYYY-MM-DD", "tag": "work"}]\n` +
        `- Suggest wikilinks: [ACTION:suggest_links, {}]\n\n` +
        `PROTECTED FILES: Never modify AGENTS.md, Daily Logs/, or .kognote/ system files.\n` +
        `CRITICAL OUTPUT FORMAT DIRECTIVE: Never wrap your overall text output or lists inside markdown code blocks (e.g. \`\`\`markdown ... \`\`\`). Output clean, raw Markdown text directly so it renders visually with interactive wikilinks and rich text formatting.\n` +
        `CRITICAL DIRECTIVE: Be direct and to the point. Perform EXACTLY what the user asks.`;

      const prompt = `${contextHeader}\nUser Directive: ${userText || "Understand this note contents."}`;

      const assistantMessageId = Math.random().toString();
      const responseMsgPlaceholder: ChatMessage = {
        id: assistantMessageId,
        sender: "copilot",
        text: "",
        timestamp: new Date(),
        referenceFile: targetRefFile || undefined
      };
      setMessages((prev) => [...prev, responseMsgPlaceholder]);

      // Stateful Stream Token Buffer Initialization
      const actionBuffer = new StreamActionBuffer();
      let capturedPendingCard: PendingActionCard | undefined = undefined;

      const abortCtrl = new AbortController();
      abortControllerRef.current = abortCtrl;

      // 60fps Debounced Token Streaming Buffer
      let pendingTokens = "";
      let animationFrameId: number | null = null;

      const flushTokens = () => {
        if (pendingTokens) {
          const chunk = pendingTokens;
          pendingTokens = "";
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id === assistantMessageId) {
                const combined = msg.text + chunk;
                if (combined.includes("<<<<<<< SEARCH")) {
                  return { ...msg, text: "✏️ *Applying targeted edit to note...*" };
                }
                return { ...msg, text: combined };
              }
              return msg;
            })
          );
        }
        animationFrameId = null;
      };

      const aiResponse = await aiService.generateTextStreaming(
        prompt,
        systemPrompt,
        (token) => {
          const { newCleanTokens, completedActions } = actionBuffer.append(token);

          if (newCleanTokens) {
            pendingTokens += newCleanTokens;
            if (!animationFrameId) {
              animationFrameId = requestAnimationFrame(flushTokens);
            }
          }

          for (const act of completedActions) {
            if (DESTRUCTIVE_ACTIONS.has(act.action.toLowerCase())) {
              capturedPendingCard = {
                id: Math.random().toString(),
                action: act.action.toLowerCase(),
                args: act.args,
                description: `Destructive action detected: ${act.action} (${JSON.stringify(act.args)})`,
                rawTag: act.rawTag,
                status: "pending",
              };
            }
          }
        },
        { ...mediaOptions, abortSignal: abortCtrl.signal }
      );

      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        flushTokens();
      }

      const { finalCleanText, remainingActions } = actionBuffer.flush();

      // Smart Target Note Resolution for AI Block Diffs
      let autoEditApplied = false;
      let diffData: { original: string; updated: string; file: string } | undefined = undefined;
      let diffTargetFile: { name: string; path: string } | null = noteFileToRead || targetRefFile || null;
      let diffTargetText = refText;
      const diffBlocks = parseDiffBlocks(aiResponse);

      if (diffBlocks.length > 0) {
        // Fallback 1: Try to find a note mentioned by name in the prompt or response
        if (!diffTargetFile || !diffTargetText) {
          const mentionedFile = flatMdFiles.find((f) => {
            const clean = f.name.replace(/\.md$/i, "").toLowerCase();
            return userText.toLowerCase().includes(clean) || aiResponse.toLowerCase().includes(clean);
          });
          if (mentionedFile) {
            try {
              diffTargetFile = mentionedFile;
              diffTargetText = (await invokeIPC("read_note", { path: mentionedFile.path })) as string;
            } catch {}
          }
        }

        // Fallback 2: Use activeFile ONLY if contextScopeMode is "active" or explicitly referenced
        if (!diffTargetFile && activeFile && contextScopeMode === "active") {
          try {
            diffTargetFile = activeFile;
            diffTargetText = (await invokeIPC("read_note", { path: activeFile.path })) as string;
          } catch {}
        }

        if (diffTargetFile && diffTargetText) {
          const diffRes = applyDiffBlocks(diffTargetText, diffBlocks);
          if (diffRes.appliedCount > 0) {
            await invokeIPC("write_note", {
              path: diffTargetFile.path,
              content: diffRes.updatedContent,
            });

            diffData = {
              original: diffTargetText,
              updated: diffRes.updatedContent,
              file: diffTargetFile.name,
            };

            updateNoteCache(diffTargetFile.path, diffRes.updatedContent);
            refreshFiles();
            triggerNotesScan();
            window.dispatchEvent(new CustomEvent("reload-active-file", { detail: { path: diffTargetFile.path } }));
            autoEditApplied = true;
          }
        }
      }

      const writeActions = new Set(["write_note", "append_note", "replace_block"]);
      const parsedActions = [...parseActions(aiResponse), ...remainingActions];
      const nonDestructiveActions = parsedActions.filter((a) => {
        const actName = a.action.toLowerCase();
        if (DESTRUCTIVE_ACTIONS.has(actName)) return false;
        // Mutual exclusion: if search/replace diff block was applied, skip redundant write actions
        if (autoEditApplied && writeActions.has(actName)) return false;
        return true;
      });
      const destructiveActions = parsedActions.filter((a) => DESTRUCTIVE_ACTIONS.has(a.action.toLowerCase()));

      let skillFeedbacks: string[] = [];
      for (const act of nonDestructiveActions) {
        if (act.args) {
          try {
            const feedback = await executeSkill(act.action.toLowerCase(), act.args);
            skillFeedbacks.push(feedback);
          } catch (e) {}
        }
      }

      let pendingCard: PendingActionCard | undefined = capturedPendingCard;
      if (!pendingCard && destructiveActions.length > 0) {
        const act = destructiveActions[0];
        pendingCard = {
          id: Math.random().toString(),
          action: act.action.toLowerCase(),
          args: act.args,
          description: `Requires Approval: ${act.action} on ${JSON.stringify(act.args)}`,
          rawTag: act.rawTag,
          status: "pending",
        };
      }

      // Thoroughly sanitize response: strip residual diff blocks, partial diff tags, and empty code fences
      let cleanResp = finalCleanText
        .replace(/<<<<<<< SEARCH[\s\S]*?>>>>>>> REPLACE/gi, "")
        .replace(/<<<<<<< SEARCH[\s\S]*/gi, "")
        .replace(/```(?:markdown|md|code|text)?\s*\n?```/gi, "")
        .replace(/```(?:markdown|md|code|text)?\s*$/gi, "")
        .trim();

      const outerFenceRegex = /^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i;
      if (outerFenceRegex.test(cleanResp)) {
        cleanResp = cleanResp.replace(outerFenceRegex, "$1").trim();
      }

      setConversationHistory((prev) => [
        ...prev.slice(-10),
        { role: "user", content: userText || "Analyze context" },
        { role: "assistant", content: cleanResp || finalCleanText }
      ]);

      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === assistantMessageId) {
            const actionSummary = skillFeedbacks.length > 0 ? skillFeedbacks.join("\n") : "";

            let fullText = cleanResp;
            if (autoEditApplied && diffTargetFile) {
              const noteName = diffTargetFile.name.replace(/\.md$/i, "");
              fullText = `✏️ **Edit applied to [[${noteName}]]** successfully!` + (cleanResp ? `\n\n${cleanResp}` : "");
            } else if (diffBlocks.length > 0 && !autoEditApplied) {
              const suggestedContent = diffBlocks.map((b) => b.replace).filter(Boolean).join("\n\n");
              fullText = `✏️ **Suggested edits for note**:\n\n${suggestedContent}`;
            } else if (actionSummary) {
              fullText = cleanResp ? `${cleanResp}\n\n${actionSummary}` : actionSummary;
            }

            return {
              ...msg,
              text: fullText,
              pendingAction: pendingCard,
              isEditApplied: autoEditApplied,
              diffResult: diffData,
            };
          }
          return msg;
        })
      );
    } catch (err: any) {
      console.error(err);
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(),
          sender: "system",
          text: `Error connecting to local AI model: ${err.message || err}. Ensure local model is booted in Settings → AI.`,
          timestamp: new Date()
        }
      ]);
    } finally {
      setLoading(false);
      embeddingQueue.resume();
    }
  }, [activeView, activeFile, files, pinnedContexts, contextScopeMode, conversationHistory, attachedMediaFile, noteCache, vaultPath, userTimezone, aiProvider, flatMdFiles]);

  const clearAttachments = () => {
    setInputMessage("");
    setAttachedFile(null);
    if (attachedMediaFile?.url) {
      URL.revokeObjectURL(attachedMediaFile.url);
    }
    setAttachedMediaFile(null);
  };

  // Handle external prompt dispatches (Command Palette, AI Summarize, Ask AI)
  useEffect(() => {
    const handleCopilotPrompt = (e: CustomEvent) => {
      const prompt = e.detail;
      if (typeof prompt === "string" && prompt.trim()) {
        createNewThread();
        const cleanPrompt = prompt.trim();
        setTimeout(() => {
          submitPrompt(cleanPrompt, activeFile);
        }, 50);
      }
    };

    window.addEventListener("submit-copilot-prompt", handleCopilotPrompt as EventListener);
    return () => {
      window.removeEventListener("submit-copilot-prompt", handleCopilotPrompt as EventListener);
    };
  }, [submitPrompt, activeFile, createNewThread]);

  // Textarea auto-resize
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [inputMessage]);

  // Mention Scanner & Popover Handlers
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputMessage(val);

    const lastAt = val.lastIndexOf("@");
    const lastHash = val.lastIndexOf("#");
    const lastSlash = val.lastIndexOf("/");

    const isValidMentionQuery = (idx: number) => {
      if (idx === -1 || idx < val.length - 20) return false;
      const charBefore = idx > 0 ? val[idx - 1] : " ";
      if (charBefore !== " " && charBefore !== "\n" && charBefore !== "(" && charBefore !== "[") return false;
      const query = val.slice(idx + 1);
      return !query.includes(" ") && !query.includes("\n") && !query.includes("@") && !query.includes("#");
    };

    if (isValidMentionQuery(lastSlash) && (lastSlash === 0 || val[lastSlash - 1] === " " || val[lastSlash - 1] === "\n")) {
      const query = val.slice(lastSlash + 1).toLowerCase();
      setShowSlashMenu({ active: true, query });
      setMentionPopover({ active: false, trigger: "@", query: "" });
    } else if (isValidMentionQuery(lastAt)) {
      const query = val.slice(lastAt + 1).toLowerCase();
      setMentionPopover({ active: true, trigger: "@", query });
      setShowSlashMenu({ active: false, query: "" });
    } else if (isValidMentionQuery(lastHash)) {
      const query = val.slice(lastHash + 1).toLowerCase();
      setMentionPopover({ active: true, trigger: "#", query });
      setShowSlashMenu({ active: false, query: "" });
    } else {
      setMentionPopover({ active: false, trigger: "@", query: "" });
      setShowSlashMenu({ active: false, query: "" });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (inputMessage.trim() || attachedFile || pinnedContexts.length > 0 || attachedMediaFile) {
        submitPrompt(inputMessage.trim(), attachedFile);
        clearAttachments();
      }
    }
  };

  const handleSelectMention = (item: { label: string; path?: string; tag?: string; type: "file" | "tag" | "excalidraw" }) => {
    setPinnedContexts((prev) => [...prev, { id: Math.random().toString(), label: item.label, type: item.type, path: item.path, tag: item.tag }]);
    
    const lastIdx = Math.max(inputMessage.lastIndexOf("@"), inputMessage.lastIndexOf("#"));
    if (lastIdx !== -1) {
      setInputMessage(inputMessage.slice(0, lastIdx).trim());
    }
    setMentionPopover({ active: false, trigger: "@", query: "" });
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputMessage.trim() && !attachedFile && pinnedContexts.length === 0 && !attachedMediaFile) return;
    await submitPrompt(inputMessage.trim(), attachedFile);
    clearAttachments();
  };

  // Helper to parse thinking steps (<think>...</think> or ▶ thinking tags)
  const parseThinkingAndResponse = (text: string) => {
    let thinkingContent = "";
    let mainResponse = text;

    const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/i);
    if (thinkMatch) {
      thinkingContent = thinkMatch[1].trim();
      mainResponse = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    } else if (text.includes("▶ Thinking") || text.includes("▶ Executing") || text.includes("▶")) {
      const lines = text.split("\n");
      const thinkLines: string[] = [];
      const respLines: string[] = [];
      lines.forEach((l) => {
        if (l.trim().startsWith("▶") || l.toLowerCase().includes("executing skill")) {
          thinkLines.push(l);
        } else {
          respLines.push(l);
        }
      });
      if (thinkLines.length > 0) {
        thinkingContent = thinkLines.join("\n");
        mainResponse = respLines.join("\n").trim();
      }
    }

    return { thinkingContent, mainResponse };
  };

  // Render rich markdown & code blocks with language labels & syntax styles
  const renderMessageText = (text: string) => {
    return <MarkdownRenderer content={text} openNoteByName={openNoteByName} />;
  };

  const activeScopeName = activeFile ? activeFile.name : "Vault All Notes";

  return (
    <div className="flex flex-col w-full h-full text-foreground selection:bg-indigo-600/30 overflow-hidden relative transition-all duration-300 backdrop-blur-xl bg-sidebar/90 rounded-2xl">
      
      {/* ── CHAT THREAD HISTORY DRAWER OVERLAY ─────────────────────────────────── */}
      {isHistoryDrawerOpen && (
        <div className="absolute inset-0 z-50 bg-card backdrop-blur-md flex flex-col animate-fade-in p-3.5 overflow-hidden text-foreground">
          <div className="flex items-center justify-between pb-2.5 border-b border-card-border/70 shrink-0 gap-2">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <History className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-800 dark:text-slate-200 truncate">
                History <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">({threads.length})</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={createNewThread}
                className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all cursor-pointer shadow-md shadow-indigo-600/20"
              >
                <Plus className="h-3 w-3" />
                <span>New Chat</span>
              </button>
              <button
                type="button"
                onClick={() => setIsHistoryDrawerOpen(false)}
                className="p-1 text-slate-500 hover:text-foreground rounded-md cursor-pointer hover:bg-card-hover"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Search Threads Filter */}
          <div className="my-3 relative shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search chat history..."
              value={threadSearchQuery}
              onChange={(e) => setThreadSearchQuery(e.target.value)}
              className="w-full rounded-xl bg-sidebar pl-8 pr-3 py-1.5 text-xs text-foreground border border-card-border focus:outline-none focus:border-indigo-500/50 placeholder-slate-400 font-medium"
            />
          </div>

          {/* Threads List */}
          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-2 pr-1">
            {threads.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-slate-500 text-xs">
                <MessageSquare className="h-8 w-8 mb-2 opacity-30 text-indigo-400" />
                <span>No saved chat threads yet</span>
              </div>
            ) : (
              threads
                .filter((t) => !threadSearchQuery || t.title.toLowerCase().includes(threadSearchQuery.toLowerCase()))
                .map((t) => {
                  const isActive = t.id === activeThreadId;
                  const dateStr = new Date(t.updatedAt).toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
                  return (
                    <div
                      key={t.id}
                      onClick={() => switchThread(t.id)}
                      className={`group p-3 rounded-xl border flex items-center justify-between gap-3 transition-all cursor-pointer ${
                        isActive
                          ? "bg-indigo-600/15 border-indigo-500/40 text-indigo-950 dark:text-indigo-100 font-bold shadow-md shadow-indigo-500/5"
                          : "bg-sidebar/50 border-card-border text-foreground hover:bg-card-hover hover:border-indigo-500/30"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <MessageSquare className={`h-4 w-4 shrink-0 ${isActive ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400"}`} />
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-xs font-bold truncate text-foreground">{t.title}</span>
                          <span className="text-[9.5px] text-slate-500 dark:text-slate-400">{dateStr} · {t.messages.length} messages</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => deleteThread(t.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 rounded-md transition-all cursor-pointer"
                        title="Delete Thread"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })
            )}
          </div>
        </div>
      )}

      {/* ── A. LINEAR COMPACT HEADER BAR ────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-card-border/50 bg-background/50 backdrop-blur-md shrink-0 select-none z-20">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className="w-5 h-5 rounded-full bg-black flex items-center justify-center p-0.5 shrink-0 shadow-xs ring-1 ring-white/10">
            <img 
              src={loading ? aiAnimatedGif : aiStaticIcon} 
              alt="KogNote AI" 
              className="w-3.5 h-3.5 object-contain" 
            />
          </div>
          
          {/* Clickable AI Model Dropdown Badge */}
          <div className="relative min-w-0">
            <button
              type="button"
              onClick={() => setModelMenuOpen(!modelMenuOpen)}
              className="flex items-center gap-1 text-[9px] font-extrabold text-indigo-500 dark:text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full uppercase tracking-wider hover:bg-indigo-500/20 transition-colors cursor-pointer max-w-[130px] sm:max-w-[150px]"
              title="Click to switch AI Model / Provider"
            >
              <span className="truncate">
                {aiProvider === "local"
                  ? (localModelsList.find(m => m.id === aiLocalModel)?.display_name || aiLocalModel)
                  : aiProvider.toUpperCase()}
              </span>
              <ChevronDown className="h-2.5 w-2.5 shrink-0" />
            </button>

            {modelMenuOpen && (
              <div className="absolute left-0 top-full mt-1 z-100 w-56 sm:w-60 max-h-64 overflow-y-auto custom-scrollbar bg-card border border-card-border rounded-xl p-1.5 shadow-2xl backdrop-blur-xl text-xs space-y-0.5">
                <div className="px-2 py-0.5 text-[9px] font-bold text-slate-500 uppercase tracking-wider">Local AI Models (Offline)</div>
                
                {[
                  { id: "qwen2.5-coder-1.5b", name: "Qwen 2.5 Coder (1.5B)", desc: "Ultra Fast CPU" },
                  { id: "qwen2.5-coder-3b", name: "Qwen 2.5 Coder (3B)", desc: "Balanced Default" },
                  { id: "qwen2.5-coder-7b", name: "Qwen 2.5 Coder (7B)", desc: "Apple Silicon & 16GB+" },
                ].map((m) => {
                  const status = localModelsList.find(item => item.id === m.id);
                  const isDownloaded = status?.downloaded;
                  const isSelected = aiProvider === "local" && aiLocalModel === m.id;

                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { setAiProvider("local"); setAiLocalModel(m.id); setModelMenuOpen(false); }}
                      className={`w-full text-left px-2 py-1 rounded-lg flex items-center justify-between cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-indigo-600/20 text-indigo-500 dark:text-indigo-300 font-bold border border-indigo-500/30"
                          : "hover:bg-card-hover text-slate-700 dark:text-slate-300"
                      }`}
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="flex items-center gap-1 font-bold text-[11px] truncate">
                          {m.name}
                          {isDownloaded && (
                            <span className="text-[7.5px] text-emerald-500 dark:text-emerald-400 bg-emerald-500/10 px-1 py-0.2 rounded font-extrabold shrink-0">
                              READY
                            </span>
                          )}
                        </span>
                        <span className="text-[9px] text-slate-500 truncate">{m.desc}</span>
                      </div>
                      {isSelected && <Check className="h-3 w-3 text-indigo-500 dark:text-indigo-400 shrink-0 ml-1" />}
                    </button>
                  );
                })}

                <div className="px-2 py-1 text-[9px] text-slate-600 dark:text-slate-400 leading-tight border-t border-card-border pt-1 mt-0.5">
                  ⚡ <strong>Auto Memory:</strong> Boots on demand, unloads when idle.
                </div>

                <div className="pt-1 border-t border-card-border px-2 py-0.5 text-[9px] font-bold text-slate-500 uppercase tracking-wider">Cloud AI Providers</div>

                <button
                  type="button"
                  onClick={() => { setAiProvider("gemini"); setModelMenuOpen(false); }}
                  className={`w-full text-left px-2 py-1 rounded-lg flex items-center justify-between cursor-pointer text-[11px] ${aiProvider === "gemini" ? "bg-indigo-600/20 text-indigo-500 dark:text-indigo-300 font-bold border border-indigo-500/30" : "hover:bg-card-hover text-slate-700 dark:text-slate-300"}`}
                >
                  <span>Google Gemini</span>
                  {aiProvider === "gemini" && <Check className="h-3 w-3 text-indigo-500 dark:text-indigo-400" />}
                </button>

                <button
                  type="button"
                  onClick={() => { setAiProvider("openai"); setModelMenuOpen(false); }}
                  className={`w-full text-left px-2 py-1 rounded-lg flex items-center justify-between cursor-pointer text-[11px] ${aiProvider === "openai" ? "bg-indigo-600/20 text-indigo-500 dark:text-indigo-300 font-bold border border-indigo-500/30" : "hover:bg-card-hover text-slate-700 dark:text-slate-300"}`}
                >
                  <span>OpenAI GPT-4o</span>
                  {aiProvider === "openai" && <Check className="h-3 w-3 text-indigo-400" />}
                </button>

                <button
                  type="button"
                  onClick={() => { setAiProvider("anthropic"); setModelMenuOpen(false); }}
                  className={`w-full text-left px-2 py-1 rounded-lg flex items-center justify-between cursor-pointer text-[11px] ${aiProvider === "anthropic" ? "bg-indigo-600/20 text-indigo-500 dark:text-indigo-300 font-bold border border-indigo-500/30" : "hover:bg-card-hover text-slate-700 dark:text-slate-300"}`}
                >
                  <span>Anthropic Claude</span>
                  {aiProvider === "anthropic" && <Check className="h-3 w-3 text-indigo-400" />}
                </button>

                <button
                  type="button"
                  onClick={() => { setAiProvider("api"); setModelMenuOpen(false); }}
                  className={`w-full text-left px-2 py-1 rounded-lg flex items-center justify-between cursor-pointer text-[11px] ${aiProvider === "api" ? "bg-indigo-600/20 text-indigo-500 dark:text-indigo-300 font-bold border border-indigo-500/30" : "hover:bg-card-hover text-slate-700 dark:text-slate-300"}`}
                >
                  <span>Custom API Endpoint</span>
                  {aiProvider === "api" && <Check className="h-3 w-3 text-indigo-400" />}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Top-Right Window Controls (Undo action, Detach panel, clean chat, close button) */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleUndoAction}
            className="p-1 text-slate-400 hover:text-indigo-300 hover:bg-[#1a1d2d] rounded-md transition-colors cursor-pointer"
            title="Undo Last AI/User Note Action"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={() => setIsHistoryDrawerOpen(!isHistoryDrawerOpen)}
            className={`p-1 rounded-md transition-colors cursor-pointer ${
              isHistoryDrawerOpen ? "text-indigo-400 bg-indigo-500/20" : "text-slate-400 hover:text-slate-200 hover:bg-[#1a1d2d]"
            }`}
            title="Chat Threads History Drawer"
          >
            <History className="h-3.5 w-3.5" />
          </button>

          <button
            onClick={handleNewChat}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-[#1a1d2d] rounded-md transition-colors cursor-pointer"
            title="Clean New Chat"
          >
            <SquarePen className="h-3.5 w-3.5" />
          </button>

          {/* Detach / Attach Window Toggle Button */}
          <button
            type="button"
            onClick={handleDetachClick}
            className={`p-1 rounded-md transition-all cursor-pointer ${
              isDetached 
                ? "text-indigo-300 bg-indigo-500/20 border border-indigo-500/30 hover:bg-indigo-500/30" 
                : "text-slate-400 hover:text-slate-200 hover:bg-[#1a1d2d]"
            }`}
            title={isDetached ? "Attach Panel to App Window" : "Detach Panel into Independent Floating Window"}
          >
            {isDetached ? <Pin className="h-3.5 w-3.5 text-indigo-400" /> : <ExternalLink className="h-3.5 w-3.5" />}
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-200 hover:bg-[#1a1d2d] rounded-md transition-colors cursor-pointer"
              title="Close Panel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* ── B. MESSAGES LOG & EMPTY STATE KOGNOTE AI CHEATSHEET ───────────────────── */}
      <div 
        ref={messagesContainerRef}
        onScroll={(e) => {
          const target = e.currentTarget;
          const isAtBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 60;
          setUserScrolledUp(!isAtBottom);
        }}
        className="flex-1 p-4 overflow-y-auto flex flex-col gap-4 selection:bg-indigo-600/30 z-10 custom-scrollbar relative"
      >
        {/* Floating Scroll to Bottom Pill when user scrolls up */}
        {userScrolledUp && (
          <button
            type="button"
            onClick={() => {
              setUserScrolledUp(false);
              messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
            }}
            className="sticky bottom-2 self-center z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-600/90 hover:bg-indigo-500 text-white text-[11px] font-bold shadow-xl border border-indigo-400/40 backdrop-blur-md cursor-pointer animate-bounce"
          >
            <ChevronDown className="h-3.5 w-3.5" />
            <span>Scroll to latest</span>
          </button>
        )}
        
        {/* Local AI Not Ready Guidance Banner (Only shown if NO local models are downloaded) */}
        {aiProvider === "local" && !localModelsList.some((m) => m.downloaded) && (
          <div className="p-4 rounded-xl bg-card border border-amber-500/30 text-xs flex flex-col gap-2.5 shadow-xl shrink-0">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4.5 w-4.5 text-amber-400 shrink-0" />
              <span className="font-bold text-slate-100 text-sm">Local AI Model Required</span>
            </div>
            <p className="text-slate-300 leading-relaxed text-[11.5px]">
              You are currently in <strong>Local Offline AI</strong> mode. To enable fast AI assistant actions, search, and note summaries, please download and boot a model for your system.
            </p>
            {sysInfo && (
              <div className="p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-[11px] font-medium flex flex-col gap-1">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span>CPU: {sysInfo.cpu_cores} Cores | RAM: {sysInfo.total_ram_gb.toFixed(1)} GB</span>
                  <span className="font-bold text-emerald-300">GPU: {sysInfo.gpu_name}</span>
                </div>
                <div className="text-[10.5px] text-indigo-200 pt-0.5 border-t border-indigo-500/20">
                  ✨ <strong>Recommended: {sysInfo.recommended_model_id}</strong> — {sysInfo.recommendation_reason || "Best match for your system"}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {onOpenSettings && (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md transition cursor-pointer"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Open AI Settings & Download Model</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Empty State: Sleek Hero Welcome & Quick Prompt Cards */}
        {messages.length === 1 && messages[0].id === "welcome" && (
          <div className="my-auto py-4 px-2 flex flex-col items-center justify-center animate-in fade-in duration-500 select-none">
            <div className="w-full max-w-sm flex flex-col items-center text-center">
              
              <div className="w-12 h-12 rounded-full bg-black flex items-center justify-center p-2 mb-3 shadow-lg ring-1 ring-white/10">
                <img src={aiStaticIcon} alt="KogNote AI" className="w-7 h-7 object-contain" />
              </div>

              <h3 className="text-sm font-bold text-slate-100 mb-1 tracking-tight">
                How can I help with your notes?
              </h3>

              <p className="text-[11px] text-slate-400 leading-relaxed mb-5 max-w-xs">
                Ask questions, update Kanban cards, manage tasks, or edit notes using AI actions.
              </p>

              {/* Refined Sleek Quick Action Cards */}
              <div className="w-full flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => submitPrompt('Create a new note titled "Project Strategy" with tags #project', attachedFile)}
                  className="w-full bg-card hover:bg-[#161826] text-slate-200 border border-card-border hover:border-indigo-500/40 text-xs font-medium px-3.5 py-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between group shadow-xs text-left"
                >
                  <div className="flex items-center gap-2.5">
                    <FileText className="h-4 w-4 text-indigo-400 shrink-0" />
                    <span>Create a structured note</span>
                  </div>
                  <Sparkles className="h-3 w-3 text-slate-500 group-hover:text-indigo-400 transition-colors" />
                </button>

                <button
                  type="button"
                  onClick={() => submitPrompt('Extract pending task items from active note', attachedFile)}
                  className="w-full bg-card hover:bg-[#161826] text-slate-200 border border-card-border hover:border-indigo-500/40 text-xs font-medium px-3.5 py-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between group shadow-xs text-left"
                >
                  <div className="flex items-center gap-2.5">
                    <CheckSquare className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span>Extract & summarize tasks</span>
                  </div>
                  <Sparkles className="h-3 w-3 text-slate-500 group-hover:text-emerald-400 transition-colors" />
                </button>

                <button
                  type="button"
                  onClick={() => submitPrompt('Extract flashcards from active note with format (Q :: A)', attachedFile)}
                  className="w-full bg-card hover:bg-[#161826] text-slate-200 border border-card-border hover:border-indigo-500/40 text-xs font-medium px-3.5 py-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between group shadow-xs text-left"
                >
                  <div className="flex items-center gap-2.5">
                    <BookOpen className="h-4 w-4 text-amber-400 shrink-0" />
                    <span>Generate flashcards</span>
                  </div>
                  <Sparkles className="h-3 w-3 text-slate-500 group-hover:text-amber-400 transition-colors" />
                </button>

                <button
                  type="button"
                  onClick={() => submitPrompt('Suggest wikilink connections for active note across vault', attachedFile)}
                  className="w-full bg-card hover:bg-[#161826] text-slate-200 border border-card-border hover:border-indigo-500/40 text-xs font-medium px-3.5 py-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between group shadow-xs text-left"
                >
                  <div className="flex items-center gap-2.5">
                    <Sparkles className="h-4 w-4 text-purple-400 shrink-0" />
                    <span>Suggest backlink connections</span>
                  </div>
                  <Sparkles className="h-3 w-3 text-slate-500 group-hover:text-purple-400 transition-colors" />
                </button>
              </div>

            </div>
          </div>
        )}

        {/* Render Active Conversation Messages */}
        {messages.filter(m => m.id !== "welcome").map((msg) => {
          if (msg.sender === "user") {
            return (
              <div 
                key={msg.id}
                className="w-full animate-in fade-in slide-in-from-bottom-1 duration-200 group relative"
              >
                <div className="w-full bg-indigo-500/10 dark:bg-indigo-500/15 border border-indigo-500/30 dark:border-indigo-500/40 text-foreground dark:text-slate-100 rounded-xl p-2.5 px-3 text-[11px] leading-relaxed font-medium select-text relative shadow-xs">
                  {msg.isEditing ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const editedText = (e.currentTarget.elements.namedItem("editedPrompt") as HTMLInputElement)?.value;
                        if (editedText && editedText.trim()) {
                          const msgIdx = messages.findIndex((m) => m.id === msg.id);
                          if (msgIdx !== -1) {
                            setMessages((prev) => prev.slice(0, msgIdx));
                            submitPrompt(editedText.trim(), attachedFile);
                          }
                        }
                      }}
                      className="flex flex-col gap-2"
                    >
                      <textarea
                        name="editedPrompt"
                        defaultValue={msg.text}
                        autoFocus
                        rows={2}
                        className="w-full bg-sidebar border border-indigo-500/50 rounded-xl p-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <button type="submit" className="px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold cursor-pointer transition shadow-xs">
                          Resubmit
                        </button>
                        <button
                          type="button"
                          onClick={() => setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, isEditing: false } : m))}
                          className="px-3 py-1 rounded-lg bg-sidebar border border-card-border hover:bg-card-hover text-foreground text-[11px] font-medium cursor-pointer transition"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <span className="whitespace-pre-wrap leading-relaxed pr-6 block">{msg.text}</span>
                      <button
                        type="button"
                        onClick={() => setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, isEditing: true } : m))}
                        className="opacity-0 group-hover:opacity-100 transition-opacity absolute top-2.5 right-2.5 p-1 rounded-md bg-indigo-500/15 hover:bg-indigo-500/30 text-indigo-500 dark:text-indigo-300 cursor-pointer"
                        title="Edit prompt & regenerate"
                      >
                        <SquarePen className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          }

          // Copilot AI Message Rendering (Full width, no header, bottom bar has Copy, Insert & Time)
          return (
            <div 
              key={msg.id}
              className="w-full flex flex-col gap-1.5 animate-in fade-in slide-in-from-bottom-1 duration-200 group py-1"
            >
              <div className="w-full text-slate-200 text-xs leading-relaxed">
                {(() => {
                  const { thinkingContent, mainResponse } = parseThinkingAndResponse(msg.text);
                  return (
                    <>
                      {thinkingContent && (
                        <details className="mb-2.5 rounded-xl border border-white/8 bg-[#080912] p-2 text-xs group/acc">
                          <summary className="cursor-pointer font-semibold text-[10px] text-indigo-400 uppercase tracking-wider flex items-center justify-between p-0.5 select-none">
                            <span className="flex items-center gap-1.5">
                              <Sparkles className="h-3 w-3 text-indigo-400 animate-pulse" />
                              <span>Thinking & Reasoning</span>
                            </span>
                            <ChevronDown className="h-3 w-3 group-open/acc:rotate-180 transition-transform text-indigo-400" />
                          </summary>
                          <div className="mt-1.5 p-2 rounded-lg bg-black/40 text-[11px] text-slate-300 font-mono leading-relaxed max-h-48 overflow-y-auto custom-scrollbar border border-white/5">
                            {renderMessageText(thinkingContent)}
                          </div>
                        </details>
                      )}
                      {renderMessageText(mainResponse || (thinkingContent ? "Completed execution." : msg.text))}
                    </>
                  );
                })()}

                {/* Applied Edit Confirmation Badge */}
                {msg.isEditApplied && (
                  <div className="mt-2 text-[10.5px] text-emerald-400/90 font-medium flex items-center gap-1.5">
                    <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Applied targeted edit directly to open note</span>
                  </div>
                )}

                {/* Interactive Confirmation Card for Destructive Actions */}
                {msg.pendingAction && (
                  <div className="mt-2.5 p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 text-xs text-amber-200 flex flex-col gap-2">
                    <div className="flex items-center gap-1.5 text-amber-400 font-bold">
                      <AlertTriangle className="h-3.5 w-3.5 animate-pulse shrink-0" />
                      <span>Action Requires Confirmation</span>
                    </div>
                    <p className="text-[11px] text-slate-300 font-mono bg-black/40 p-2 rounded-lg border border-white/5">
                      {msg.pendingAction.description}
                    </p>
                    <div className="flex items-center gap-2 justify-end mt-0.5">
                      <button
                        onClick={() => handleApprovePendingAction(msg.pendingAction!, msg.id)}
                        className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold cursor-pointer transition shadow-sm flex items-center gap-1"
                      >
                        <CheckCircle className="h-3 w-3" />
                        Approve Action
                      </button>
                      <button
                        onClick={() => handleDismissPendingAction(msg.id)}
                        className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold cursor-pointer transition"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Action Footer with Copy, Insert to Note, and Timestamp */}
              {!msg.id.startsWith("welcome") && (
                <div className="flex items-center justify-between w-full mt-1 pt-0.5">
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => handleCopyText(msg.text, msg.id)}
                      className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200 transition-colors py-0.5 px-1.5 rounded hover:bg-white/6 cursor-pointer"
                      title="Copy response"
                    >
                      {copiedId === msg.id ? (
                        <>
                          <Check className="h-3 w-3 text-emerald-400" />
                          <span className="text-emerald-400 font-medium">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleInsertToNote(msg.text)}
                      className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-indigo-300 transition-colors py-0.5 px-1.5 rounded hover:bg-white/6 cursor-pointer"
                      title="Insert to active note"
                    >
                      <CornerDownLeft className="h-3 w-3" />
                      <span>Insert to note</span>
                    </button>
                  </div>

                  <span className="text-[10px] text-slate-500 font-normal select-none">
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              )}
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* ── C & D. LINEAR FLOATING COMPOSITE INPUT DOCK ─────────────────────────── */}
      <div className="p-3 shrink-0 relative z-20">
        
        {/* Slash Commands Popover (/ trigger for Quick Commands & AI Skills) */}
        {showSlashMenu.active && (
          <div className="absolute left-4 bottom-full mb-2 z-100 w-80 max-h-64 overflow-y-auto rounded-2xl bg-[#121422] border border-indigo-500/40 p-2 shadow-2xl backdrop-blur-xl animate-fade-in text-xs text-slate-200 custom-scrollbar space-y-2">
            {/* Quick Commands Group */}
            <div>
              <div className="px-2 py-1 border-b border-slate-800/80 mb-1 flex items-center gap-1.5 text-[9px] font-bold text-amber-400 uppercase tracking-wider">
                <Zap className="h-3 w-3" />
                <span>Quick Commands</span>
              </div>
              {[
                { key: "active", label: "Switch Scope: Active Note Context", action: () => setContextScopeMode("active") },
                { key: "vault", label: "Switch Scope: Entire Vault (Vector RAG)", action: () => setContextScopeMode("vault") },
                { key: "none", label: "Switch Scope: Standalone Chat (No Context)", action: () => setContextScopeMode("none") },
                { key: "clear", label: "Start Fresh Chat Thread", action: () => createNewThread() },
                { key: "newskill", label: "+ Create Custom AI Skill", action: () => setShowCreateSkillModal(true) },
              ]
                .filter((act) => !showSlashMenu.query || act.key.toLowerCase().includes(showSlashMenu.query) || act.label.toLowerCase().includes(showSlashMenu.query))
                .map((act) => (
                  <button
                    key={act.key}
                    type="button"
                    onClick={() => {
                      act.action();
                      setShowSlashMenu({ active: false, query: "" });
                      setInputMessage("");
                      if (textareaRef.current) textareaRef.current.focus();
                    }}
                    className="w-full rounded-xl px-2.5 py-1.5 text-left hover:bg-amber-500/15 hover:text-amber-300 transition-colors truncate flex items-center justify-between cursor-pointer group"
                  >
                    <span className="font-semibold text-[11px] truncate">{act.label}</span>
                    <span className="text-[9px] text-slate-500 font-mono">/{act.key}</span>
                  </button>
                ))}
            </div>

            {/* AI Skills Group */}
            <div>
              <div className="px-2 py-1 border-b border-slate-800/80 mb-1 flex items-center gap-1.5 text-[9px] font-bold text-indigo-400 uppercase tracking-wider">
                <Package className="h-3 w-3" />
                <span>AI Skills ({BUILTIN_SKILLS.length + customSkills.length})</span>
              </div>
              {[
                ...BUILTIN_SKILLS,
                ...customSkills.map((c) => ({
                  key: c.key,
                  label: c.label,
                  icon: Sparkles,
                  prompt: c.prompt,
                  isCustom: true,
                  id: c.id
                }))
              ]
                .filter((sk) => !showSlashMenu.query || sk.key.toLowerCase().includes(showSlashMenu.query) || sk.label.toLowerCase().includes(showSlashMenu.query))
                .map((sk) => {
                  const Icon = sk.icon || Sparkles;
                  return (
                    <button
                      key={(sk as any).id || sk.key}
                      type="button"
                      onClick={() => {
                        setInputMessage(sk.prompt);
                        setShowSlashMenu({ active: false, query: "" });
                        if (textareaRef.current) textareaRef.current.focus();
                      }}
                      className="w-full rounded-xl px-2.5 py-1.5 text-left hover:bg-indigo-600/20 hover:text-indigo-300 transition-colors truncate flex items-center justify-between cursor-pointer group"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className="h-3.5 w-3.5 text-indigo-400 group-hover:scale-110 transition-transform shrink-0" />
                        <span className="font-semibold text-[11px] truncate">{sk.label}</span>
                      </div>
                      <span className="text-[9px] text-slate-500 font-mono">/{sk.key}</span>
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        {/* Mention Fuzzy Search Popover (@ and # triggers) */}
        {mentionPopover.active && (
          <div className="absolute left-4 bottom-full mb-2 z-100 w-64 max-h-48 overflow-y-auto rounded-2xl bg-[#121422] border border-indigo-500/40 p-2 shadow-2xl backdrop-blur-xl animate-fade-in text-xs text-slate-200">
            <div className="px-2 py-1 border-b border-slate-800/80 mb-1 flex items-center gap-1.5 text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
              {mentionPopover.trigger === "@" ? <AtSign className="h-3 w-3" /> : <Hash className="h-3 w-3" />}
              <span>Pin Context {mentionPopover.trigger === "@" ? "Note" : "Tag"}</span>
            </div>
            
            {mentionPopover.trigger === "@" ? (
              flatMdFiles
                .filter((f) => f.name.toLowerCase().includes(mentionPopover.query))
                .slice(0, 8)
                .map((f) => (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => handleSelectMention({ label: f.name, path: f.path, type: f.isCanvas ? "excalidraw" : "file" })}
                    className="w-full rounded-xl px-2.5 py-1.5 text-left hover:bg-indigo-600/20 hover:text-indigo-300 transition-colors truncate flex items-center gap-2 cursor-pointer"
                  >
                    <FileText className="h-3 w-3 text-indigo-400 shrink-0" />
                    <span className="truncate">{f.name}</span>
                  </button>
                ))
            ) : (
              vaultTags
                .filter((t) => t.includes(mentionPopover.query))
                .slice(0, 8)
                .map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleSelectMention({ label: `#${tag}`, tag, type: "tag" })}
                    className="w-full rounded-xl px-2.5 py-1.5 text-left hover:bg-indigo-600/20 hover:text-indigo-300 transition-colors truncate flex items-center gap-2 cursor-pointer"
                  >
                    <TagIcon className="h-3 w-3 text-amber-400 shrink-0" />
                    <span className="truncate">#{tag}</span>
                  </button>
                ))
            )}
          </div>
        )}

        {/* C. Active Context Scope Pill */}
        <div className="flex items-center justify-between gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-card/60 text-indigo-500 dark:text-indigo-300 border border-card-border/60 shadow-xs mb-1.5 backdrop-blur-md">
          <div className="flex items-center gap-1.5 truncate">
            <Zap className="h-3 w-3 text-amber-400 shrink-0" />
            <span className="truncate max-w-52">
              {contextScopeMode === "none" 
                ? "Scope: Standalone Chat (No Context)" 
                : contextScopeMode === "vault"
                ? "Scope: Entire Vault (All Notes)"
                : (attachedFile ? `Attached: ${attachedFile.name}` : `Active: ${activeScopeName}`)}
            </span>
          </div>
          {estimatedTokens > 0 && contextScopeMode !== "none" && (
            <span className="text-[8.5px] font-mono text-slate-400 shrink-0 border-l border-card-border/60 pl-1.5">
              {estimatedTokens.toLocaleString()} tokens
            </span>
          )}
        </div>

        {/* D. Linear Composite Floating Input Box */}
        <form 
          onSubmit={handleSendMessage}
          className="flex flex-col rounded-2xl bg-card border border-card-border focus-within:border-indigo-500/60 p-2.5 shadow-lg backdrop-blur-md transition-all"
        >
          {/* Hidden File Input for App Media/File Attachments */}
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleAppFileChange} 
            accept="image/*,video/*,audio/*,.pdf" 
            className="hidden" 
          />

          {/* Pinned Context Chips Container inside input box */}
          {(pinnedContexts.length > 0 || attachedFile || attachedMediaFile) && (
            <div className="flex flex-wrap gap-1 items-center pb-1.5 mb-1 border-b border-card-border/70">
              {attachedFile && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/15 border border-indigo-500/30 text-[9.5px] text-indigo-500 dark:text-indigo-300 font-semibold shadow-xs">
                  <FileText className="h-2.5 w-2.5 text-indigo-400 shrink-0" />
                  <span className="truncate max-w-32">{attachedFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachedFile(null)}
                    className="hover:text-rose-400 cursor-pointer ml-0.5"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              )}

              {attachedMediaFile && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-[9.5px] text-emerald-500 dark:text-emerald-300 font-semibold shadow-xs">
                  <Paperclip className="h-2.5 w-2.5 text-emerald-400 shrink-0" />
                  <span className="truncate max-w-32">{attachedMediaFile.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachedMediaFile(null)}
                    className="hover:text-rose-400 cursor-pointer ml-0.5"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              )}

              {pinnedContexts.map((chip) => (
                <span key={chip.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-950/80 border border-indigo-500/40 text-[9.5px] text-indigo-200 font-mono shadow-xs">
                  {chip.type === "tag" ? <Hash className="h-2.5 w-2.5 text-amber-400" /> : <AtSign className="h-2.5 w-2.5 text-indigo-400" />}
                  <span className="truncate max-w-32">{chip.label}</span>
                  <button
                    type="button"
                    onClick={() => setPinnedContexts((prev) => prev.filter((c) => c.id !== chip.id))}
                    className="hover:text-rose-400 cursor-pointer ml-0.5"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* 1. Top Section - Borderless Textarea */}
          <textarea
            ref={textareaRef}
            value={inputMessage}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Ask KogNote... (or type / for skills, @ for notes, # for tags)"
            className="w-full bg-transparent border-none p-1 text-xs text-foreground placeholder:text-slate-400 focus:outline-none focus:ring-0 resize-none min-h-[32px] max-h-28 leading-relaxed"
          />

          {/* 2. Bottom Section - Inner Tool Utility Bar */}
          <div className="flex items-center justify-between pt-1.5 border-t border-card-border/70 relative select-none">
            
            {/* Left Side: Skills Dropdown Button */}
            <div className="flex items-center gap-1">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowSkillsDropdown(!showSkillsDropdown)}
                  className="flex items-center gap-1 text-[10.5px] text-slate-700 dark:text-slate-300 hover:text-foreground bg-sidebar border border-card-border hover:bg-card-hover px-2 py-0.5 rounded-md transition-colors cursor-pointer font-medium"
                >
                  <Package className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Skills</span>
                  <ChevronDown className="h-3 w-3 text-slate-400" />
                </button>

                {/* Skills Dropdown Popover */}
                {showSkillsDropdown && (
                  <div className="absolute left-0 bottom-full mb-2 z-50 w-72 max-h-80 overflow-y-auto rounded-2xl border border-card-border bg-card p-2 shadow-2xl animate-fade-in text-xs custom-scrollbar space-y-2">
                    <div className="flex items-center justify-between px-2 py-1 border-b border-card-border/80">
                      <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">AI Skills Library</span>
                      <button
                        type="button"
                        onClick={() => {
                          setShowSkillsDropdown(false);
                          setShowCreateSkillModal(true);
                        }}
                        className="text-[10px] font-bold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 bg-indigo-500/10 hover:bg-indigo-500/20 px-2 py-0.5 rounded-md cursor-pointer transition"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Create Skill</span>
                      </button>
                    </div>

                    {/* Built-in Skills */}
                    <div>
                      <div className="px-2 py-0.5 text-[9px] font-bold text-slate-500 uppercase tracking-wider">Built-in Skills</div>
                      {BUILTIN_SKILLS.map((sk) => {
                        const IconComp = sk.icon;
                        return (
                          <button
                            key={sk.key}
                            type="button"
                            onClick={() => {
                              setInputMessage(sk.prompt);
                              setShowSkillsDropdown(false);
                              if (textareaRef.current) textareaRef.current.focus();
                            }}
                            className="w-full rounded-xl px-2.5 py-1.5 text-left hover:bg-card-hover hover:text-indigo-400 transition-colors flex items-center gap-2.5 cursor-pointer group"
                          >
                            <IconComp className="h-3.5 w-3.5 text-indigo-400 group-hover:scale-110 transition-transform shrink-0" />
                            <span className="truncate font-medium text-[11px] text-foreground">{sk.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Custom Skills */}
                    {customSkills.length > 0 && (
                      <div className="border-t border-card-border/60 pt-1">
                        <div className="px-2 py-0.5 text-[9px] font-bold text-amber-400 uppercase tracking-wider">Custom Skills</div>
                        {customSkills.map((sk) => (
                          <div
                            key={sk.id}
                            onClick={() => {
                              setInputMessage(sk.prompt);
                              setShowSkillsDropdown(false);
                              if (textareaRef.current) textareaRef.current.focus();
                            }}
                            className="w-full rounded-xl px-2.5 py-1.5 text-left hover:bg-card-hover hover:text-indigo-400 transition-colors flex items-center justify-between cursor-pointer group"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Sparkles className="h-3.5 w-3.5 text-amber-400 group-hover:scale-110 transition-transform shrink-0" />
                              <span className="truncate font-medium text-[11px] text-foreground">{sk.label}</span>
                            </div>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteCustomSkill(sk.id, e)}
                              className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-all cursor-pointer"
                              title="Delete Skill"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Right Side: Action Group (Context Scope Toggle, Attachment Picker, Voice Mic, Send) */}
            <div className="flex items-center gap-1.5">
              
              {/* Context Scope Toggle Button */}
              <button
                type="button"
                onClick={() => {
                  const nextMode = contextScopeMode === "active" ? "vault" : (contextScopeMode === "vault" ? "none" : "active");
                  setContextScopeMode(nextMode);
                }}
                className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                  contextScopeMode === "none"
                    ? "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-card-hover"
                    : contextScopeMode === "vault"
                    ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/30"
                    : "text-indigo-400 bg-indigo-500/10 border border-indigo-500/30"
                }`}
                title={`Context Scope: ${contextScopeMode === "active" ? "Active Note Context" : contextScopeMode === "vault" ? "Entire Vault Notes Context" : "No Context (Standalone Chat)"}`}
              >
                <Target className="h-3.5 w-3.5" />
              </button>

              {/* Media File Attachment Button */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${attachedMediaFile ? "text-emerald-400 bg-emerald-500/15" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-card-hover"}`}
                title="Attach image, video, audio, or PDF file"
              >
                <Paperclip className="h-3.5 w-3.5" />
              </button>

              {/* Voice Dictate Mic Button */}
              <button
                type="button"
                onClick={toggleVoiceInput}
                className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                  isListening 
                    ? "bg-rose-600/30 text-rose-400 border border-rose-500/50 animate-pulse" 
                    : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-card-hover"
                }`}
                title={isListening ? "Stop voice dictation" : "Start voice dictation"}
              >
                <Mic className="h-3.5 w-3.5" />
              </button>

              {/* Stop Generation Button / Send Button */}
              {loading ? (
                <button
                  type="button"
                  onClick={() => {
                    if (abortControllerRef.current) {
                      abortControllerRef.current.abort();
                    }
                    setLoading(false);
                  }}
                  className="w-7 h-7 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center font-bold transition-all hover:scale-105 shadow-md shadow-rose-600/40 shrink-0 cursor-pointer animate-pulse"
                  title="Stop LLM inference immediately"
                >
                  <Square className="h-3 w-3 fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!inputMessage.trim() && !attachedFile && !attachedMediaFile && pinnedContexts.length === 0}
                  className="w-7 h-7 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center font-bold disabled:opacity-30 transition-all hover:scale-105 shadow-md shadow-indigo-600/30 shrink-0 cursor-pointer"
                  title="Send message"
                >
                  <SendHorizontal className="h-3.5 w-3.5 text-white stroke-[2.5]" />
                </button>
              )}
            </div>

          </div>
        </form>

      </div>

      {/* Create Custom Skill Modal */}
      {showCreateSkillModal && (
        <div className="fixed inset-0 z-300 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-[#121424] border border-indigo-500/40 rounded-2xl w-full max-w-md p-5 shadow-2xl flex flex-col gap-4 text-slate-200">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2 text-indigo-400 font-bold text-sm">
                <Sparkles className="h-4 w-4" />
                <span>Create Custom AI Skill</span>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateSkillModal(false)}
                className="text-slate-400 hover:text-white p-1 rounded-md cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">Skill Name</label>
                <input
                  type="text"
                  placeholder="e.g. Code Summarizer"
                  value={newSkillName}
                  onChange={(e) => setNewSkillName(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">Slash Key / Shortcut (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. code_summary (triggered via /code_summary)"
                  value={newSkillKey}
                  onChange={(e) => setNewSkillKey(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 font-mono text-[11px]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-400 mb-1">Prompt Template Instructions</label>
                <textarea
                  rows={3}
                  placeholder="e.g. Analyze the active note and extract a bulleted summary of key decisions, open questions, and next steps."
                  value={newSkillPrompt}
                  onChange={(e) => setNewSkillPrompt(e.target.value)}
                  className="w-full bg-black/50 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500 resize-none leading-relaxed"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => setShowCreateSkillModal(false)}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCustomSkill}
                disabled={!newSkillName.trim() || !newSkillPrompt.trim()}
                className="px-4 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold disabled:opacity-40 cursor-pointer transition shadow-md shadow-indigo-600/30"
              >
                Save Skill
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
