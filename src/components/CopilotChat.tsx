import React, { useState, useEffect, useRef, useCallback } from "react";
import { useVault, FileEntry } from "../contexts/VaultContext";
import { useSettings } from "../contexts/SettingsContext";
import { aiService } from "../lib/local-ai";
import { invokeIPC } from "../lib/ipc";
import { parseDiffBlocks, applyDiffBlocks } from "../lib/diff-applier";
import { StreamActionBuffer } from "../lib/stream-action-buffer";
import { actionRegistry } from "../lib/action-registry";
import { DEFAULT_AGENTS_MD } from "../constants/defaultAgents";
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
  Code2,
  Package,
  Layers,
  ChevronDown,
  ExternalLink,
  Pin,
  SendHorizontal,
  Navigation,
  Target,
  CheckSquare,
  Repeat,
  BookOpen,
  Undo2,
  History,
  Plus,
  Trash2,
  Search,
  MessageSquare
} from "lucide-react";
import { message } from "@tauri-apps/plugin-dialog";
import aiStaticIcon from "../assets/ai-static.png";
import aiAnimatedGif from "../assets/ai-animated.gif";

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
  
  return actions;
}

const DESTRUCTIVE_ACTIONS = new Set(["delete_note", "write_note", "rename_note"]);

interface CopilotChatProps {
  onClose?: () => void;
  isDetached?: boolean;
  onToggleDetach?: () => void;
}

export const CopilotChat: React.FC<CopilotChatProps> = ({ onClose, isDetached: externalDetached, onToggleDetach }) => {
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
  const [internalDetached, setInternalDetached] = useState(false);
  const isDetached = externalDetached !== undefined ? externalDetached : internalDetached;
  const toggleDetach = onToggleDetach || (() => setInternalDetached(!internalDetached));

  // Model Menu Popover
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

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

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const WELCOME_TEXT = "Hi! I am **Kognote Copilot**, your local AI workspace agent. I can extract tasks, update Kanban board cards, sync frontmatter, live edit notes, and answer questions across your vault.";

  const separator = vaultPath?.includes("\\") ? "\\" : "/";

  // Skills Registry
  const SKILLS_AND_LOOPS_GROUPS = [
    {
      category: "Skills",
      items: [
        { key: "create_note", label: "Create Structured Note", icon: FileText, prompt: "Create a new note titled \"Project Ideas\" with tags #ideas" },
        { key: "add_task", label: "Create Task Checklist", icon: CheckSquare, prompt: "Add a task checklist item for @task" },
        { key: "set_board_card", label: "Update Kanban Card", icon: Layers, prompt: "Add card to Kanban board column In Progress: " },
        { key: "extract_flashcards", label: "Extract Flashcards", icon: BookOpen, prompt: "Extract flashcards from active note with format (Question :: Answer)" },
        { key: "suggest_links", label: "Suggest Backlinks", icon: Sparkles, prompt: "Analyze active note and suggest wikilink connections across vault." },
        { key: "navigate", label: "Switch App View", icon: Navigation, prompt: "Switch view to calendar" }
      ]
    }
  ];

  const handleAppFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAttachedMediaFile({
        name: file.name,
        type: file.type || "file",
        url: URL.createObjectURL(file),
        rawFile: file,
      });
    }
  };

  const toggleVoiceInput = () => {
    if (isListening) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      message("Speech Recognition is not supported in this environment.", { title: "Voice Error", kind: "error" });
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      recognition.onstart = () => setIsListening(true);
      recognition.onerror = (event: any) => {
        console.error("Speech Recognition Error", event);
        setIsListening(false);
      };
      recognition.onend = () => setIsListening(false);
      recognition.onresult = (event: any) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript) {
          setInputMessage((prev) => (prev ? `${prev} ${transcript}` : transcript));
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
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

      const cleanText = textToInsert.replace(/\[ACTION:.*?\]/g, "").trim();
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

  // Restore or Initialize Chat Threads
  useEffect(() => {
    try {
      const saved = localStorage.getItem("kognote_copilot_chat_threads");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const formattedThreads = parsed.map((t: any) => ({
            ...t,
            messages: (t.messages || []).map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) }))
          }));
          setThreads(formattedThreads);
          const first = formattedThreads[0];
          setActiveThreadId(first.id);
          setMessages(first.messages || []);
          setConversationHistory(first.conversationHistory || []);
          return;
        }
      }
    } catch (e) {
      console.warn("Failed to parse chat threads:", e);
    }

    createNewThread();
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
        localStorage.setItem("kognote_copilot_chat_threads", JSON.stringify(updated.slice(0, 30)));
      } catch {}
      return updated;
    });
  }, [messages, conversationHistory, activeThreadId]);

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

    setMessages((prev) => [...prev, activeMsg]);
    setLoading(true);

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
      contextHeader += `- Active View: ${activeView}\n`;
      if (activeFile) {
        contextHeader += `- Currently Focused Note: ${activeFile.name}\n`;
      }

      // Vault-Wide Scope Context Injection
      if (contextScopeMode === "vault") {
        contextHeader += `\n[ENTIRE VAULT INDEX & NOTE SUMMARIES]:\n`;
        const entries = Object.values(noteCache).slice(0, 80);
        for (const entry of entries) {
          const title = entry.path.split(/[\/\\]/).pop()?.replace(/\.md$/, "") || "";
          const tagsStr = entry.tags?.length ? ` #${entry.tags.join(" #")}` : "";
          const taskCount = entry.tasks?.length ? ` (${entry.tasks.filter(t => !t.completed).length} open tasks)` : "";
          contextHeader += `- Note: [[${title}]]${tagsStr}${taskCount}\n`;
        }
      }

      // Multi-Turn Conversation History (6 Turns)
      if (conversationHistory.length > 0) {
        contextHeader += `\n[RECENT CONVERSATION HISTORY (LAST 6 TURNS)]:\n`;
        const recentTurns = conversationHistory.slice(-6);
        for (const turn of recentTurns) {
          contextHeader += `${turn.role.toUpperCase()}: ${turn.content}\n`;
        }
      }

      // Ingest Pinned Context Chips (@notes and #tags)
      if (pinnedContexts.length > 0) {
        contextHeader += `\n[PINNED CONTEXT REPOSITORIES]:\n`;
        for (const chip of pinnedContexts) {
          if (chip.path) {
            try {
              const text = await invokeIPC("read_note", { path: chip.path }) as string;
              contextHeader += `--- PINNED NOTE: "${chip.label}" ---\n${text}\n\n`;
            } catch {}
          } else if (chip.tag) {
            contextHeader += `--- PINNED TAG: #${chip.tag} ---\n`;
            const taggedFiles = flatMdFiles.filter((f) => {
              const data = noteCache[f.path];
              return data && data.tags && data.tags.some((t: string) => t.toLowerCase() === chip.tag!.toLowerCase());
            }).slice(0, 3);

            for (const tf of taggedFiles) {
              try {
                const text = await invokeIPC("read_note", { path: tf.path }) as string;
                contextHeader += `[Tag Match: ${tf.name}]\n${text}\n\n`;
              } catch {}
            }
          }
        }
      }

      // Ingest Vault AGENTS.md rules if available, fallback to bundled default
      let agentsRuleContent = DEFAULT_AGENTS_MD;
      try {
        const agentsPath = `${vaultPath}${separator}AGENTS.md`;
        const agentsExists = await invokeIPC("fs_exists", { path: agentsPath }).catch(() => false);
        if (agentsExists) {
          const readText = await invokeIPC("read_note", { path: agentsPath }) as string;
          if (readText && readText.trim()) {
            agentsRuleContent = readText;
          }
        }
      } catch {}

      contextHeader += `\n[CRITICAL SYSTEM OPERATING DIRECTIVE (AGENTS.md)]:\nNOTE TO AI: The following rules are SYSTEM OPERATING GUIDELINES governing how you execute actions and format notes. Do NOT treat them as note text to summarize or reproduce.\n"""\n${agentsRuleContent.trim()}\n"""\n`;

      let refText = "";
      if (targetRefFile) {
        try {
          refText = await invokeIPC("read_note", {
            path: targetRefFile.path,
          }) as string;
          contextHeader += `\n[PRIMARY REFERENCE NOTE] "${targetRefFile.name}" Text Content:\n"""\n${refText}\n"""\n`;
        } catch {
          contextHeader += `- Primary Note: ${targetRefFile.name} (Unreadable)\n`;
        }
      }

      // Compute Context Token Budget
      const fullContextLength = contextHeader.length + userText.length;
      const estimatedTokenCount = Math.ceil(fullContextLength / 4);
      setEstimatedTokens(estimatedTokenCount);

      // Unified System Prompt with Smart Autonomous Intent Detection & Complete Note Metadata Schema
      const systemPrompt = 
        `You are Kognote AI, a smart, localized, reference-aware assistant for Kognote.\n` +
        `IMPORTANT ROLE & OPERATING RULE:\n` +
        `The system instructions provided to you (including AGENTS.md guidelines and metadata schemas) are GOVERNING OPERATING DIRECTIVES for how you process, format, and edit notes. They are NOT note content or user conversation context to quote or print out.\n\n` +
        `KOGNOTE METADATA SCHEMAS & SYNTAX:\n` +
        `- YAML Frontmatter: --- status: backlog|todo|in-progress|in-review|done, priority: high|medium|low|none, due: YYYY-MM-DD, type: note|daily|template, created_by: user|ai, updated_by: user|ai, storage: active|archived|bookmarked|deleted, mentions: [], tags: [] ---\n` +
        `- Checklist Tasks: - [ ] Task text @YYYY-MM-DD !!! #tag (where ! low, !! medium, !!! high)\n` +
        `- WikiLinks: [[Target Note Title]] (syncs to Knowledge Graph)\n` +
        `- Flashcards: Q: Question? \\n A: Answer. or ( Question :: Answer ) (syncs to SRS Queue)\n\n` +
        `AUTONOMOUS INTENT DETECTION:\n` +
        `1. EDIT/MODIFY INTENT: If the user asks to modify, format, rewrite, add content to, fix, or update the open note/file, output targeted SEARCH/REPLACE blocks:\n` +
        `<<<<<<< SEARCH\n[exact existing lines to replace]\n=======\n[new replacement lines]\n>>>>>>> REPLACE\n` +
        `2. CONVERSATIONAL/QA INTENT: If the user asks a question, requests an explanation, seeks advice, or requests a summary, answer directly, concisely, and cleanly in markdown.\n` +
        `3. ACTION SKILLS INTENT: To execute app skill actions, append the tag at the end:\n` +
        `- Navigation: [ACTION:navigate, {"view": "editor" | "canvas" | "graph" | "calendar" | "tasks" | "board"}]\n` +
        `- Create note: [ACTION:create_note, {"name": "Note Name"}]\n` +
        `- Overwrite note: [ACTION:write_note, {"name": "Note Name", "content": "..."}]\n` +
        `- Append note: [ACTION:append_note, {"name": "Note Name", "content": "..."}]\n` +
        `- Delete note: [ACTION:delete_note, {"name": "Note Name"}]\n` +
        `- Rename note: [ACTION:rename_note, {"oldName": "Old", "newName": "New"}]\n` +
        `- Kanban board update: [ACTION:set_board_card, {"name": "Note Name", "status": "backlog" | "todo" | "in-progress" | "in-review" | "done", "priority": "high" | "medium" | "low"}]\n` +
        `- Toggle task status: [ACTION:set_task_status, {"noteName": "Note Name", "taskText": "snippet", "completed": true | false}]\n` +
        `- Add task item: [ACTION:add_task, {"text": "Task description", "noteName": "Target Note", "date": "YYYY-MM-DD", "tag": "work"}]\n` +
        `- Suggest wikilinks: [ACTION:suggest_links, {}]\n\n` +
        `PROTECTED FILES: Never modify AGENTS.md or .kognote/ system files directly via note edits.\n` +
        `CRITICAL DIRECTIVE: Be direct and to the point. Perform EXACTLY what the user asks without adding extra unrequested fluff, commentary, or conversational filler.`;

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

      const aiResponse = await aiService.generateTextStreaming(
        prompt,
        systemPrompt,
        (token) => {
          const { newCleanTokens, completedActions } = actionBuffer.append(token);

          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id === assistantMessageId) {
                return { ...msg, text: msg.text + newCleanTokens };
              }
              return msg;
            })
          );

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
        mediaOptions
      );

      const { finalCleanText, remainingActions } = actionBuffer.flush();

      // Smart Target Note Resolution for AI Block Diffs
      let autoEditApplied = false;
      const diffBlocks = parseDiffBlocks(aiResponse);
      if (diffBlocks.length > 0) {
        let diffTargetFile = targetRefFile;
        let diffTargetText = refText;

        // If targetRefFile is not set, attempt to find matching note from user prompt or AI response
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

        if (diffTargetFile && diffTargetText) {
          const diffRes = applyDiffBlocks(diffTargetText, diffBlocks);
          if (diffRes.appliedCount > 0) {
            await invokeIPC("write_note", {
              path: diffTargetFile.path,
              content: diffRes.updatedContent,
            });

            updateNoteCache(diffTargetFile.path, diffRes.updatedContent);
            refreshFiles();
            triggerNotesScan();
            window.dispatchEvent(new CustomEvent("reload-active-file", { detail: { path: diffTargetFile.path } }));
            autoEditApplied = true;
          }
        }
      }

      const parsedActions = [...parseActions(aiResponse), ...remainingActions];
      const nonDestructiveActions = parsedActions.filter((a) => !DESTRUCTIVE_ACTIONS.has(a.action.toLowerCase()));
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

      const cleanResp = finalCleanText.replace(/<<<<<<< SEARCH[\s\S]*?>>>>>>> REPLACE/g, "").trim();

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
            if (autoEditApplied) {
              fullText = `✏️ **Edit applied to [[${targetRefFile!.name.replace(/\.md$/, "")}]]** successfully!` + (cleanResp ? `\n\n${cleanResp}` : "");
            } else if (actionSummary) {
              fullText = cleanResp ? `${cleanResp}\n\n${actionSummary}` : actionSummary;
            }

            return {
              ...msg,
              text: fullText,
              pendingAction: pendingCard,
              isEditApplied: autoEditApplied,
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
    }

    setLoading(false);
  }, [activeView, activeFile, files, pinnedContexts, contextScopeMode, conversationHistory, attachedMediaFile, noteCache, vaultPath]);

  // Textarea auto-resize
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [inputMessage]);

  // Mention Scanner & Popover Handlers
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputMessage(val);

    const lastAt = val.lastIndexOf("@");
    const lastHash = val.lastIndexOf("#");

    if (lastAt !== -1 && lastAt >= val.length - 20 && (lastAt === 0 || val[lastAt - 1] === " " || val[lastAt - 1] === "\n")) {
      const query = val.slice(lastAt + 1).toLowerCase();
      setMentionPopover({ active: true, trigger: "@", query });
    } else if (lastHash !== -1 && lastHash >= val.length - 20 && (lastHash === 0 || val[lastHash - 1] === " " || val[lastHash - 1] === "\n")) {
      const query = val.slice(lastHash + 1).toLowerCase();
      setMentionPopover({ active: true, trigger: "#", query });
    } else {
      setMentionPopover({ active: false, trigger: "@", query: "" });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (inputMessage.trim() || attachedFile || pinnedContexts.length > 0) {
        submitPrompt(inputMessage.trim(), attachedFile);
        setInputMessage("");
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
    if (!inputMessage.trim() && !attachedFile && pinnedContexts.length === 0) return;
    await submitPrompt(inputMessage.trim(), attachedFile);
    setInputMessage("");
  };

  // Render rich markdown & code blocks with language labels & syntax styles
  const renderMessageText = (text: string) => {
    const lines = text.split("\n");
    let inCodeBlock = false;
    let codeLanguage = "code";
    let codeBlockText = "";

    return lines.map((line, lIdx) => {
      const trimmed = line.trim();

      if (trimmed.startsWith("```")) {
        if (inCodeBlock) {
          inCodeBlock = false;
          const currentCode = codeBlockText;
          const langLabel = codeLanguage;
          codeBlockText = "";
          codeLanguage = "code";
          return (
            <div key={lIdx} className="my-2.5 rounded-xl bg-[#090b12] border border-[#1f2335] overflow-hidden font-mono text-[11px] shadow-lg">
              <div className="flex items-center justify-between px-3 py-1.5 bg-[#121422] border-b border-[#1f2335] text-[9.5px] font-bold text-slate-400 uppercase tracking-wider">
                <span className="flex items-center gap-1.5 text-indigo-400">
                  <Code2 className="h-3.5 w-3.5" />
                  <span>{langLabel}</span>
                </span>
                <button
                  type="button"
                  onClick={() => handleCopyText(currentCode, `code-${lIdx}`)}
                  className="hover:text-slate-100 transition-colors flex items-center gap-1 cursor-pointer bg-slate-800/50 px-2 py-0.5 rounded border border-slate-700/50"
                >
                  <Copy className="h-2.5 w-2.5" />
                  <span>Copy</span>
                </button>
              </div>
              <pre className="p-3.5 text-slate-200 overflow-x-auto whitespace-pre leading-relaxed select-text font-mono">{currentCode}</pre>
            </div>
          );
        } else {
          inCodeBlock = true;
          codeLanguage = trimmed.substring(3).trim() || "code";
          return null;
        }
      }

      if (inCodeBlock) {
        codeBlockText += (codeBlockText ? "\n" : "") + line;
        return null;
      }

      // Markdown Headers
      if (trimmed.startsWith("# ")) {
        return <h1 key={lIdx} className="text-sm font-extrabold text-slate-100 my-2 border-b border-[#1f2335] pb-1">{trimmed.substring(2)}</h1>;
      }
      if (trimmed.startsWith("## ")) {
        return <h2 key={lIdx} className="text-xs font-bold text-indigo-300 my-1.5">{trimmed.substring(3)}</h2>;
      }
      if (trimmed.startsWith("### ")) {
        return <h3 key={lIdx} className="text-xs font-bold text-slate-200 my-1">{trimmed.substring(4)}</h3>;
      }

      // Task Checklist Line
      if (trimmed.startsWith("- [ ]") || trimmed.startsWith("- [x]") || trimmed.startsWith("☑️")) {
        const isDone = trimmed.includes("[x]") || trimmed.includes("☑️");
        const taskText = trimmed.replace(/^-\s*\[[ xX]\]/, "").replace(/^☑️/, "").trim();
        return (
          <div key={lIdx} className="flex items-center gap-2 text-xs text-indigo-300 font-medium my-1 bg-indigo-500/10 px-2.5 py-1 rounded-lg border border-indigo-500/20">
            <CheckCircle className={`h-3.5 w-3.5 ${isDone ? "text-emerald-400" : "text-indigo-400"} shrink-0`} />
            <span className={isDone ? "line-through text-slate-400" : "text-slate-200"}>{taskText}</span>
          </div>
        );
      }

      // Callout Banner (> [!NOTE] / > [!WARNING])
      if (trimmed.startsWith("> ")) {
        return (
          <blockquote key={lIdx} className="my-1.5 pl-3 py-1 border-l-2 border-indigo-500 bg-indigo-500/5 text-slate-300 italic text-xs rounded-r-lg">
            {trimmed.substring(2)}
          </blockquote>
        );
      }

      // Standard Text Paragraph with Inline Wikilinks and Formatting
      return (
        <p key={lIdx} className="text-xs leading-relaxed my-1 select-text">
          {line.split(" ").map((word, wIdx) => {
            if (word.startsWith("[[") && word.endsWith("]]")) {
              const cleanName = word.substring(2, word.length - 2);
              return (
                <button
                  key={wIdx}
                  type="button"
                  onClick={() => openNoteByName(cleanName)}
                  className="text-indigo-400 hover:text-indigo-300 font-bold bg-indigo-500/15 hover:bg-indigo-500/25 px-1.5 py-0.5 rounded-md cursor-pointer mr-1 inline-flex items-center gap-1 transition-colors border border-indigo-500/30"
                >
                  {cleanName}
                </button>
              );
            }
            if (word.startsWith("**") && word.endsWith("**") && word.length > 4) {
              return <strong key={wIdx} className="text-slate-100 font-bold mr-1">{word.substring(2, word.length - 2)}</strong>;
            }
            if (word.startsWith("`") && word.endsWith("`") && word.length > 2) {
              return <code key={wIdx} className="bg-slate-800 text-indigo-300 font-mono text-[11px] px-1 py-0.5 rounded border border-slate-700 mr-1">{word.substring(1, word.length - 1)}</code>;
            }
            return word + " ";
          })}
        </p>
      );
    });
  };

  const activeScopeName = activeFile ? activeFile.name : "Vault All Notes";

  return (
    <div className={`flex flex-col w-full h-full bg-[#08090e]/70 text-slate-200 selection:bg-indigo-600/30 overflow-hidden relative transition-all duration-300 backdrop-blur-md ${isDetached ? "bg-[#090a0f]/90 rounded-2xl border border-indigo-500/40 shadow-2xl" : "rounded-2xl"}`}>
      
      {/* ── CHAT THREAD HISTORY DRAWER OVERLAY ─────────────────────────────────── */}
      {isHistoryDrawerOpen && (
        <div className="absolute inset-0 z-50 bg-[#090a0f]/95 backdrop-blur-md flex flex-col animate-fade-in p-4 overflow-hidden">
          <div className="flex items-center justify-between pb-3 border-b border-[#1f2335]/70 shrink-0">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-indigo-400" />
              <span className="text-xs font-extrabold uppercase tracking-wider text-slate-200">Chat Threads History</span>
              <span className="text-[10px] text-slate-500 font-bold">({threads.length})</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={createNewThread}
                className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 text-white px-2.5 py-1 rounded-lg text-[10.5px] font-bold transition-all cursor-pointer shadow-md shadow-indigo-600/20"
              >
                <Plus className="h-3 w-3" />
                <span>New Chat</span>
              </button>
              <button
                type="button"
                onClick={() => setIsHistoryDrawerOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-200 rounded-md cursor-pointer hover:bg-slate-800/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Search Threads Filter */}
          <div className="my-3 relative shrink-0">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Search chat history..."
              value={threadSearchQuery}
              onChange={(e) => setThreadSearchQuery(e.target.value)}
              className="w-full rounded-xl bg-[#121422] pl-8 pr-3 py-1.5 text-xs text-slate-200 border border-[#24283b] focus:outline-none focus:border-indigo-500/50 placeholder-slate-600"
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
                          ? "bg-indigo-600/15 border-indigo-500/40 text-slate-100 shadow-md"
                          : "bg-[#10121d]/70 border-[#1f2335]/70 text-slate-300 hover:bg-[#161828] hover:border-slate-700/60"
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <MessageSquare className={`h-4 w-4 shrink-0 ${isActive ? "text-indigo-400" : "text-slate-500"}`} />
                        <div className="flex flex-col min-w-0 flex-1">
                          <span className="text-xs font-bold truncate">{t.title}</span>
                          <span className="text-[9.5px] text-slate-500">{dateStr} · {t.messages.length} messages</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => deleteThread(t.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-all cursor-pointer"
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1f2335]/50 bg-[#090a0f]/50 backdrop-blur-md shrink-0 select-none z-20">
        <div className="flex items-center gap-2">
          <img 
            src={loading ? aiAnimatedGif : aiStaticIcon} 
            alt="KogNote AI" 
            className="w-5.5 h-5.5 object-contain shrink-0" 
          />
          
          {/* Clickable AI Model Dropdown Badge */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setModelMenuOpen(!modelMenuOpen)}
              className="flex items-center gap-1 text-[9px] font-extrabold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full uppercase tracking-widest hover:bg-indigo-500/20 transition-colors cursor-pointer"
              title="Click to switch AI Model / Provider"
            >
              <span>{aiProvider === "local" ? (aiLocalModel === "llama3.2" ? "Llama 3.2" : "Qwen 2.5") : aiProvider.toUpperCase()}</span>
              <ChevronDown className="h-2.5 w-2.5" />
            </button>

            {modelMenuOpen && (
              <div className="absolute left-0 top-full mt-1.5 z-[100] w-48 bg-[#121422] border border-[#24283b] rounded-xl p-1 shadow-2xl backdrop-blur-xl text-xs">
                <div className="px-2 py-1 text-[9px] font-bold text-slate-500 uppercase tracking-wider">Select AI Model</div>
                
                <button
                  type="button"
                  onClick={() => { setAiProvider("local"); setAiLocalModel("llama3.2"); setModelMenuOpen(false); }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between cursor-pointer ${aiProvider === "local" && aiLocalModel === "llama3.2" ? "bg-indigo-600/30 text-indigo-300 font-bold" : "hover:bg-[#1a1d2e] text-slate-300"}`}
                >
                  <span>Llama 3.2 (Local)</span>
                  {aiProvider === "local" && aiLocalModel === "llama3.2" && <Check className="h-3 w-3 text-indigo-400" />}
                </button>

                <button
                  type="button"
                  onClick={() => { setAiProvider("local"); setAiLocalModel("qwen3:8b"); setModelMenuOpen(false); }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between cursor-pointer ${aiProvider === "local" && aiLocalModel === "qwen3:8b" ? "bg-indigo-600/30 text-indigo-300 font-bold" : "hover:bg-[#1a1d2e] text-slate-300"}`}
                >
                  <span>Qwen 2.5 (Local)</span>
                  {aiProvider === "local" && aiLocalModel === "qwen3:8b" && <Check className="h-3 w-3 text-indigo-400" />}
                </button>

                <button
                  type="button"
                  onClick={() => { setAiProvider("gemini"); setModelMenuOpen(false); }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between cursor-pointer ${aiProvider === "gemini" ? "bg-indigo-600/30 text-indigo-300 font-bold" : "hover:bg-[#1a1d2e] text-slate-300"}`}
                >
                  <span>Google Gemini</span>
                  {aiProvider === "gemini" && <Check className="h-3 w-3 text-indigo-400" />}
                </button>

                <button
                  type="button"
                  onClick={() => { setAiProvider("openai"); setModelMenuOpen(false); }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between cursor-pointer ${aiProvider === "openai" ? "bg-indigo-600/30 text-indigo-300 font-bold" : "hover:bg-[#1a1d2e] text-slate-300"}`}
                >
                  <span>OpenAI GPT-4o</span>
                  {aiProvider === "openai" && <Check className="h-3 w-3 text-indigo-400" />}
                </button>

                <button
                  type="button"
                  onClick={() => { setAiProvider("anthropic"); setModelMenuOpen(false); }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between cursor-pointer ${aiProvider === "anthropic" ? "bg-indigo-600/30 text-indigo-300 font-bold" : "hover:bg-[#1a1d2e] text-slate-300"}`}
                >
                  <span>Anthropic Claude</span>
                  {aiProvider === "anthropic" && <Check className="h-3 w-3 text-indigo-400" />}
                </button>

                <button
                  type="button"
                  onClick={() => { setAiProvider("api"); setModelMenuOpen(false); }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between cursor-pointer ${aiProvider === "api" ? "bg-indigo-600/30 text-indigo-300 font-bold" : "hover:bg-[#1a1d2e] text-slate-300"}`}
                >
                  <span>Custom API</span>
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
            onClick={toggleDetach}
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
      <div className="flex-1 p-4 overflow-y-auto flex flex-col gap-4 selection:bg-indigo-600/30 z-10 custom-scrollbar">
        
        {/* Empty State: Sleek Hero Welcome & Quick Prompt Cards */}
        {messages.length === 1 && messages[0].id === "welcome" && (
          <div className="my-auto py-4 px-2 flex flex-col items-center justify-center animate-in fade-in duration-500 select-none">
            <div className="w-full max-w-sm flex flex-col items-center text-center">
              
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center mb-3 shadow-lg shadow-indigo-500/10">
                <img src={aiStaticIcon} alt="KogNote AI" className="w-6 h-6 object-contain" />
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
                  className="w-full bg-[#11131c] hover:bg-[#161826] text-slate-200 border border-[#1f2335] hover:border-indigo-500/40 text-xs font-medium px-3.5 py-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between group shadow-xs text-left"
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
                  className="w-full bg-[#11131c] hover:bg-[#161826] text-slate-200 border border-[#1f2335] hover:border-indigo-500/40 text-xs font-medium px-3.5 py-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between group shadow-xs text-left"
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
                  className="w-full bg-[#11131c] hover:bg-[#161826] text-slate-200 border border-[#1f2335] hover:border-indigo-500/40 text-xs font-medium px-3.5 py-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between group shadow-xs text-left"
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
                  className="w-full bg-[#11131c] hover:bg-[#161826] text-slate-200 border border-[#1f2335] hover:border-indigo-500/40 text-xs font-medium px-3.5 py-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between group shadow-xs text-left"
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
        {messages.filter(m => m.id !== "welcome").map((msg) => (
          <div 
            key={msg.id}
            className={`flex flex-col gap-1 max-w-[92%] animate-in fade-in slide-in-from-bottom-2 duration-300 ${
              msg.sender === "user" ? "self-end items-end" : "self-start items-start"
            }`}
          >
            {/* Chat Bubble Card */}
            <div 
              className={`p-3.5 rounded-2xl border transition-all ${
                msg.sender === "user"
                  ? "bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-600 border-indigo-400/40 rounded-tr-xs text-white shadow-lg shadow-indigo-600/20"
                  : msg.sender === "system"
                  ? "bg-red-500/10 border-red-500/30 text-red-300"
                  : "bg-[#11131c] border-[#1f2335] text-slate-200 rounded-tl-xs shadow-sm"
              }`}
            >
              {renderMessageText(msg.text)}

              {/* Applied Edit Confirmation Badge */}
              {msg.isEditApplied && (
                <div className="mt-2.5 pt-2 border-t border-emerald-500/20 flex items-center gap-1.5 text-[10px] text-emerald-400 font-semibold">
                  <CheckCircle className="h-3 w-3 text-emerald-400" />
                  <span>Applied targeted edit directly to open note</span>
                </div>
              )}

              {/* Interactive Action Preview Card for Destructive Actions */}
              {msg.pendingAction && (
                <div className="mt-3 p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-xs text-amber-200 flex flex-col gap-2">
                  <div className="flex items-center gap-1.5 text-amber-400 font-bold">
                    <AlertTriangle className="h-3.5 w-3.5 animate-pulse shrink-0" />
                    <span>Action Requires Confirmation</span>
                  </div>
                  <p className="text-[11px] text-slate-300 font-mono bg-black/40 p-2 rounded-lg border border-white/5">
                    {msg.pendingAction.description}
                  </p>
                  <div className="flex items-center gap-2 justify-end mt-1">
                    <button
                      onClick={() => handleApprovePendingAction(msg.pendingAction!, msg.id)}
                      className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold cursor-pointer transition shadow-md flex items-center gap-1"
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

            {msg.sender === "copilot" && (
              <div className="flex items-center gap-2 mt-1 self-start ml-1 opacity-70 hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleCopyText(msg.text, msg.id)}
                  className="flex items-center gap-1 text-[9px] text-slate-400 hover:text-slate-200 transition-colors p-1 rounded-md hover:bg-slate-800/60"
                  title="Copy response"
                >
                  {copiedId === msg.id ? (
                    <>
                      <Check className="h-2.5 w-2.5 text-emerald-500" />
                      <span className="text-emerald-500 font-medium">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-2.5 w-2.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => handleInsertToNote(msg.text)}
                  className="flex items-center gap-1 text-[9px] text-slate-400 hover:text-indigo-400 transition-colors p-1 rounded-md hover:bg-slate-800/60"
                  title="Insert to open note"
                >
                  <CornerDownLeft className="h-2.5 w-2.5" />
                  <span>Insert to note</span>
                </button>
              </div>
            )}

            {msg.referenceFile && (
              <span className="text-[9px] text-slate-500 flex items-center gap-1 mt-0.5 font-medium">
                <FileText className="h-2.5 w-2.5 text-indigo-400" />
                Reference: {msg.referenceFile.name}
              </span>
            )}
            
            <span className="text-[8px] text-slate-600 font-semibold px-1">
              {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* ── C & D. LINEAR FLOATING COMPOSITE INPUT DOCK ─────────────────────────── */}
      <div className="p-3 shrink-0 relative z-20">
        
        {/* Mention Fuzzy Search Popover (@ and # triggers) */}
        {mentionPopover.active && (
          <div className="absolute left-4 bottom-full mb-2 z-[100] w-64 max-h-48 overflow-y-auto rounded-2xl bg-[#121422] border border-indigo-500/40 p-2 shadow-2xl backdrop-blur-xl animate-fade-in text-xs text-slate-200">
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
        <div className="flex items-center justify-between gap-1.5 px-3 py-1 rounded-full text-[11px] font-medium bg-[#11131c]/60 text-indigo-300 border border-[#1f2335]/60 shadow-xs mb-2 backdrop-blur-md">
          <div className="flex items-center gap-1.5 truncate">
            <Zap className="h-3 w-3 text-amber-400 shrink-0" />
            <span className="truncate max-w-[240px]">
              {contextScopeMode === "none" 
                ? "Scope: Standalone Chat (No Context)" 
                : contextScopeMode === "vault"
                ? "Scope: Entire Vault (All Notes)"
                : (attachedFile ? `Attached: ${attachedFile.name}` : `Active: ${activeScopeName}`)}
            </span>
          </div>
          {estimatedTokens > 0 && contextScopeMode !== "none" && (
            <span className="text-[9px] font-mono text-slate-400 shrink-0 border-l border-[#1f2335]/60 pl-2">
              {estimatedTokens.toLocaleString()} tokens
            </span>
          )}
        </div>

        {/* D. Linear Composite Floating Input Box */}
        <form 
          onSubmit={handleSendMessage}
          className="flex flex-col rounded-2xl bg-[#0d0f17]/65 border border-[#1f2335]/70 focus-within:border-indigo-500/60 p-3 shadow-2xl backdrop-blur-md transition-all"
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
            <div className="flex flex-wrap gap-1.5 items-center pb-2 mb-1 border-b border-[#1f2335]/70">
              {attachedFile && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-[10px] text-indigo-300 font-semibold shadow-xs">
                  <FileText className="h-2.5 w-2.5 text-indigo-400 shrink-0" />
                  <span className="truncate max-w-[140px]">{attachedFile.name}</span>
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
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-[10px] text-emerald-300 font-semibold shadow-xs">
                  <Paperclip className="h-2.5 w-2.5 text-emerald-400 shrink-0" />
                  <span className="truncate max-w-[140px]">{attachedMediaFile.name}</span>
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
                <span key={chip.id} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-indigo-950/80 border border-indigo-500/40 text-[10px] text-indigo-200 font-mono shadow-xs">
                  {chip.type === "tag" ? <Hash className="h-2.5 w-2.5 text-amber-400" /> : <AtSign className="h-2.5 w-2.5 text-indigo-400" />}
                  <span className="truncate max-w-[140px]">{chip.label}</span>
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
            placeholder="Ask KogNote... (or type @ to mention notes, # for tags)"
            className="w-full bg-transparent border-none p-1 text-xs sm:text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-0 resize-none min-h-[42px] max-h-32 leading-relaxed"
          />

          {/* 2. Bottom Section - Inner Tool Utility Bar */}
          <div className="flex items-center justify-between pt-2 border-t border-[#1f2335]/70 relative select-none">
            
            {/* Left Side: Skills & Loops Dropdown Button + Agent Mode Toggle */}
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowSkillsDropdown(!showSkillsDropdown)}
                  className="flex items-center gap-1.5 text-xs text-slate-300 hover:text-white bg-[#141624] hover:bg-[#1c1e30] border border-[#24283b] px-2.5 py-1 rounded-lg transition-colors cursor-pointer font-medium"
                >
                  <Package className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Skills & Loops</span>
                  <ChevronDown className="h-3 w-3 text-slate-400" />
                </button>

                {/* Skills & Loops Dropdown Popover */}
                {showSkillsDropdown && (
                  <div className="absolute left-0 bottom-full mb-2 z-50 w-72 max-h-72 overflow-y-auto rounded-2xl border border-[#24283b] bg-[#11131c] p-2 shadow-2xl animate-fade-in text-xs custom-scrollbar">
                    {SKILLS_AND_LOOPS_GROUPS.map((group) => (
                      <div key={group.category} className="mb-2 last:mb-0">
                        <div className="px-2.5 py-1 text-[9px] font-bold text-indigo-400 uppercase tracking-wider border-b border-[#1f2335]/80 mb-1 flex items-center justify-between">
                          <span>{group.category}</span>
                          {group.category === "Automated Loops" ? <Repeat className="h-3 w-3 text-emerald-400" /> : <Sparkles className="h-3 w-3 text-amber-400" />}
                        </div>
                        {group.items.map((sk) => {
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
                              className="w-full rounded-xl px-2.5 py-2 text-left hover:bg-indigo-600/20 hover:text-indigo-300 transition-colors flex items-center gap-2.5 cursor-pointer group"
                            >
                              <IconComp className="h-3.5 w-3.5 text-indigo-400 group-hover:scale-110 transition-transform shrink-0" />
                              <span className="truncate font-medium text-[11px] text-slate-200">{sk.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Side: Action Group (Context Scope Toggle, Attachment Picker, Voice Mic, Send) */}
            <div className="flex items-center gap-1.5">
              
              {/* Context Scope Toggle Button (Replaces duplicate bottom expand button) */}
              <button
                type="button"
                onClick={() => {
                  const nextMode = contextScopeMode === "active" ? "vault" : (contextScopeMode === "vault" ? "none" : "active");
                  setContextScopeMode(nextMode);
                }}
                className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                  contextScopeMode === "none"
                    ? "text-slate-500 hover:text-slate-300 hover:bg-[#191b29]"
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
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${attachedMediaFile ? "text-emerald-400 bg-emerald-500/15" : "text-slate-400 hover:text-slate-200 hover:bg-[#191b29]"}`}
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
                    : "text-slate-400 hover:text-slate-200 hover:bg-[#191b29]"
                }`}
                title={isListening ? "Stop voice dictation" : "Start voice dictation"}
              >
                <Mic className="h-3.5 w-3.5" />
              </button>

              {/* Circular Send Button */}
              <button
                type="submit"
                disabled={loading || (!inputMessage.trim() && !attachedFile && !attachedMediaFile && pinnedContexts.length === 0)}
                className="w-7 h-7 rounded-full bg-slate-100 text-slate-900 flex items-center justify-center font-bold hover:bg-white disabled:opacity-30 transition-all hover:scale-105 shadow-md shrink-0 cursor-pointer"
                title="Send message"
              >
                <SendHorizontal className="h-3.5 w-3.5 text-slate-900 stroke-[2.5]" />
              </button>
            </div>

          </div>
        </form>

      </div>

    </div>
  );
};
