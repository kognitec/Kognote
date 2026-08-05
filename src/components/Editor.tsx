import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { useVault, FileEntry } from "../contexts/VaultContext";
import { useSync } from "../contexts/SyncContext";
import { invokeIPC } from "../lib/ipc";
import { aiService } from "../lib/local-ai";
import {
  Eye, FileCode, MoreVertical, List, Sparkles, Paintbrush,
  ChevronDown, Search, X, Tag, Clock, CheckSquare, FileText, Paperclip,
  Globe, Bookmark, Archive, Trash2, LayoutTemplate, RotateCcw, GraduationCap, RotateCw,
  ArrowUpRight, ArrowDownLeft, Copy, ExternalLink, FolderOpen, CopyCheck,
  Layers, GitMerge
} from "lucide-react";
import { SourceViewer } from "./editor/SourceViewer";
import { WysiwygEditor } from "./editor/WysiwygEditor";
import { MetadataBar } from "./editor/MetadataBar";
import { parseFrontmatter, ensureAndSyncFrontmatter } from "../lib/frontmatter";
import { isTrashPath } from "../lib/task-scanner";
import { parseWikilinksOutsideCode } from "../lib/wikilink-utils";
import { parseFlashcards } from "../lib/flashcard-parser";
import { FloatingAiToolbar, FloatingAiSelection, FloatingAiResult } from "./editor/FloatingAiToolbar";
import { OutlineSidebar } from "./editor/OutlineSidebar";
import { smartFormatLocal } from "../lib/formatter";

export const Editor: React.FC = () => {
  const {
    activeFile,
    openNoteByName,
    files,
    refreshFiles,
    noteCache,
    updateNoteCache,
    bookmarkNote,
    archiveNote,
    deleteNoteToTrash,
    deleteFileOrDirectory,
    restoreNote,
    saveAsTemplate,
  } = useVault();
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templateInputName, setTemplateInputName] = useState("");
  const isLogFile = activeFile ? activeFile.path.replace(/\\/g, "/").includes("/Daily Logs/") : false;

  const currentPathLower = activeFile ? activeFile.path.replace(/\\/g, "/").toLowerCase() : "";
  const activeCachedData = activeFile ? noteCache[activeFile.path] : undefined;

  const isArchivedNote = currentPathLower.includes("/archived/") || activeCachedData?.meta?.storage === "archived";
  const isDeletedNote = currentPathLower.includes("/trash/") || currentPathLower.includes("/.deleted/") || activeCachedData?.meta?.storage === "deleted";
  const isActiveNote = !isArchivedNote && !isDeletedNote;
  const isBookmarkedNote = activeCachedData?.meta?.bookmarked?.toLowerCase() === "yes" || activeCachedData?.meta?.storage === "bookmarked";
  const crepeRef = useRef<Crepe | null>(null);

  const [content, setContent] = useState<string>("");
  const [metadataContent, setMetadataContent] = useState<string>("");
  const saveTimeoutRef = useRef<number | null>(null);
  const prevFilePathRef = useRef<string | null>(null);
  const latestContentRef = useRef<string>("");
  const isDirtyRef = useRef<boolean>(false);
  const originalContentRef = useRef<string>("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving">("saved");

  // Mode state: "preview" (Sole editing WYSIWYG) vs "source" (Read-only Markdown inspector)
  const [editMode, setEditMode] = useState<"preview" | "source">("preview");

  // Floating AI Selection states
  const [floatingSelection, setFloatingSelection] = useState<FloatingAiSelection | null>(null);
  const [floatingResult, setFloatingResult] = useState<FloatingAiResult | null>(null);
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);

  useEffect(() => {
    const handleClearFloating = () => {
      setFloatingSelection(null);
      setFloatingResult(null);
    };
    window.addEventListener("clear-floating-ai-selection", handleClearFloating);
    return () => window.removeEventListener("clear-floating-ai-selection", handleClearFloating);
  }, []);

  const { registerSyncHandler, unregisterSyncHandler } = useSync();

  const [isMoreOptionsOpen, setIsMoreOptionsOpen] = useState<boolean>(false);
  const moreOptionsRef = useRef<HTMLDivElement>(null);

  // Merge modal states
  const [showMergeModal, setShowMergeModal] = useState<boolean>(false);
  const [mergeType, setMergeType] = useState<"standard" | "ai">("standard");
  const [mergeSearchQuery, setMergeSearchQuery] = useState<string>("");
  const [isMerging, setIsMerging] = useState<boolean>(false);

  // Find & Replace states & refs
  const [showFindReplace, setShowFindReplace] = useState<boolean>(false);
  const [findText, setFindText] = useState<string>("");
  const [replaceText, setReplaceText] = useState<string>("");
  const [findMatchIndex, setFindMatchIndex] = useState<number>(0);
  const [findMatchesCount, setFindMatchesCount] = useState<number>(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);

  // Outline state
  const [isOutlineOpen, setIsOutlineOpen] = useState<boolean>(false);
  const [showFormatDropdown, setShowFormatDropdown] = useState<boolean>(false);
  const [isFormatting, setIsFormatting] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Global Keyboard Shortcuts (Cmd+F / Ctrl+F for Find, Cmd+H / Ctrl+H for Replace)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!activeFile) return;

      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      const keyLower = e.key.toLowerCase();

      if (isCmdOrCtrl && keyLower === "f") {
        e.preventDefault();
        setShowFindReplace(true);
        setTimeout(() => findInputRef.current?.focus(), 50);
      } else if (isCmdOrCtrl && keyLower === "h") {
        e.preventDefault();
        setShowFindReplace(true);
        setTimeout(() => replaceInputRef.current?.focus(), 50);
      } else if (e.key === "Escape" && showFindReplace) {
        setShowFindReplace(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeFile, showFindReplace]);

  // Note Action Handlers
  const handleCopyWikiLink = async () => {
    if (!activeFile) return;
    const wikiLink = `[[${activeFile.name.replace(/\.md$/, "")}]]`;
    try {
      await navigator.clipboard.writeText(wikiLink);
      setToastMessage(`Copied ${wikiLink} to clipboard`);
      setTimeout(() => setToastMessage(null), 2500);
    } catch (err) {
      console.error("Failed to copy WikiLink:", err);
    }
  };

  const handleCopyPath = async () => {
    if (!activeFile) return;
    try {
      await navigator.clipboard.writeText(activeFile.path);
      setToastMessage("Copied note path to clipboard");
      setTimeout(() => setToastMessage(null), 2500);
    } catch (err) {
      console.error("Failed to copy path:", err);
    }
  };

  const handleRevealInFinder = async () => {
    if (!activeFile) return;
    try {
      await invokeIPC("reveal_in_finder", { path: activeFile.path });
    } catch (err) {
      console.error("Failed to reveal file:", err);
    }
  };

  const handleOpenWithDefault = async () => {
    if (!activeFile) return;
    try {
      await invokeIPC("open_with_default", { path: activeFile.path });
    } catch (err) {
      console.error("Failed to open file in default app:", err);
    }
  };

  const handleDuplicateNote = async () => {
    if (!activeFile) return;
    const dirPath = activeFile.path.substring(0, Math.max(activeFile.path.lastIndexOf("/"), activeFile.path.lastIndexOf("\\")));
    const baseName = activeFile.name.replace(/\.md$/, "");
    const newName = `${baseName} (Copy).md`;
    const newPath = dirPath ? `${dirPath}/${newName}` : newName;
    try {
      await invokeIPC("write_note", { path: newPath, content });
      await refreshFiles();
      setToastMessage(`Duplicated note as "${newName}"`);
      setTimeout(() => setToastMessage(null), 2500);
    } catch (err) {
      console.error("Failed to duplicate note:", err);
    }
  };

  // Click outside listener for dropdowns
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (isMoreOptionsOpen && moreOptionsRef.current && !moreOptionsRef.current.contains(e.target as Node)) {
        setIsMoreOptionsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isMoreOptionsOpen]);

  // Memoized headings for Document Outline
  const queryHeadings = useMemo(() => {
    const headingItems: { level: number; text: string; lineNumber: number }[] = [];
    const lines = content.split("\n");
    lines.forEach((line, index) => {
      if (line.trim().startsWith("<!--") || line.trim().endsWith("-->")) return;
      const match = line.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        headingItems.push({
          level: match[1].length,
          text: match[2].trim(),
          lineNumber: index
        });
      }
    });
    return headingItems;
  }, [content]);

  const handleOutlineJump = (headingText: string) => {
    const container = document.getElementById("editor-workspace-container");
    if (!container) return;

    if (editMode === "preview") {
      const headings = Array.from(container.querySelectorAll("h1, h2, h3, h4, h5, h6"));
      const targetEl = headings.find(h => {
        const cleanHText = h.textContent?.trim() || "";
        return cleanHText.includes(headingText) || headingText.includes(cleanHText);
      });
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } else {
      const cmLines = Array.from(container.querySelectorAll(".cm-line"));
      const targetLine = cmLines.find(line => {
        const lineText = line.textContent || "";
        return lineText.includes(headingText);
      });
      if (targetLine) {
        targetLine.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  };

  // Immediate save flush for file switching or unmount
  const flushSaveImmediately = useCallback(async (contentToSave: string, filePath: string) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (!isDirtyRef.current || contentToSave === originalContentRef.current) {
      setSaveStatus("saved");
      return;
    }

    setSaveStatus("saving");
    try {
      const fileName = filePath.substring(Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")) + 1);
      const noteName = fileName.replace(/\.md$/, "");
      const { fullContent: syncedContent } = ensureAndSyncFrontmatter(contentToSave, {
        noteName,
        forceUpdateTimestamp: true,
      });

      await invokeIPC("write_note", {
        path: filePath,
        content: syncedContent,
      });

      // SQLite Block & FTS Dual-Sync
      await invokeIPC("sync_note_blocks", {
        filePath,
        content: syncedContent,
      }).catch((e) => console.warn("Background block sync warning:", e));

      originalContentRef.current = syncedContent;
      latestContentRef.current = syncedContent;
      setContent(syncedContent);
      isDirtyRef.current = false;
      setSaveStatus("saved");
      updateNoteCache(filePath, syncedContent);
      refreshFiles();
    } catch (err) {
      console.error("Failed to save note:", err);
      setSaveStatus("saved");
    }
  }, [refreshFiles, updateNoteCache]);

  // Listen for reset dirty signal (e.g. before note move/restore/bookmark)
  useEffect(() => {
    const handleResetDirty = () => {
      isDirtyRef.current = false;
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
    };
    window.addEventListener("kognote-reset-editor-dirty", handleResetDirty);
    return () => window.removeEventListener("kognote-reset-editor-dirty", handleResetDirty);
  }, []);

  // Load Note Content on File Selection
  useEffect(() => {
    let isCancelled = false;

    // Reset floating AI toolbar when switching active notes
    if (aiActionAbortControllerRef.current) {
      aiActionAbortControllerRef.current.abort();
      aiActionAbortControllerRef.current = null;
    }
    setFloatingSelection(null);
    setFloatingResult(null);
    setIsAiLoading(false);

    if (prevFilePathRef.current && prevFilePathRef.current !== activeFile?.path && isDirtyRef.current) {
      flushSaveImmediately(latestContentRef.current, prevFilePathRef.current);
    }
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    if (!activeFile) {
      setContent("");
      setMetadataContent("");
      latestContentRef.current = "";
      originalContentRef.current = "";
      isDirtyRef.current = false;
      prevFilePathRef.current = null;
      return;
    }

    prevFilePathRef.current = activeFile.path;

    const loadNoteContent = async () => {
      try {
        const rawContent = (await invokeIPC("read_note", {
          path: activeFile.path,
        })) as string;

        const noteName = activeFile.name.replace(/\.md$/, "");
        const { fullContent } = ensureAndSyncFrontmatter(rawContent, {
          noteName,
        });

        if (isCancelled) return;

        setContent(fullContent);
        setMetadataContent(fullContent);
        latestContentRef.current = fullContent;
        originalContentRef.current = fullContent;
        isDirtyRef.current = false;
        setSaveStatus("saved");
      } catch (err: any) {
        if (isCancelled) return;
        console.error("Failed to read note:", err);
      }
    };

    loadNoteContent();

    return () => {
      isCancelled = true;
    };
  }, [activeFile, flushSaveImmediately]);

  // Listen for real-time external disk changes / AI edit commands to update open active file
  useEffect(() => {
    const handleReload = (e: CustomEvent<{ path?: string }>) => {
      const activeClean = activeFile?.path.replace(/\\/g, "/").toLowerCase();
      const targetClean = e.detail?.path?.replace(/\\/g, "/").toLowerCase();

      if (activeFile && (!targetClean || activeClean === targetClean)) {
        invokeIPC("read_note", {
          path: activeFile.path,
        })
          .then((rawContent) => {
            const noteName = activeFile.name.replace(/\.md$/, "");
            const { fullContent } = ensureAndSyncFrontmatter(rawContent as string, {
              noteName,
            });
            setContent(fullContent);
            latestContentRef.current = fullContent;
            originalContentRef.current = fullContent;
            isDirtyRef.current = false;
            setSaveStatus("saved");
          })
          .catch(console.error);
      }
    };
    window.addEventListener("reload-active-file", handleReload as EventListener);
    return () => window.removeEventListener("reload-active-file", handleReload as EventListener);
  }, [activeFile]);

  // Listen for scroll-to-line event from TasksView / CalendarView / search
  useEffect(() => {
    const handleScrollToLine = (e: CustomEvent<{ lineNumber: number }>) => {
      const lineNum = e.detail?.lineNumber;
      if (typeof lineNum !== "number") return;

      const container = document.getElementById("editor-workspace-container");
      if (!container) return;

      const lines = container.querySelectorAll(".cm-line, [data-line]");
      if (lines[lineNum]) {
        lines[lineNum].scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        const estTop = lineNum * 24;
        container.scrollTo({ top: estTop, behavior: "smooth" });
      }
    };

    window.addEventListener("scroll-to-line", handleScrollToLine as EventListener);
    return () => window.removeEventListener("scroll-to-line", handleScrollToLine as EventListener);
  }, []);

  // Register with SyncContext for vault sync
  useEffect(() => {
    registerSyncHandler(
      "editor-save",
      async () => {
        if (activeFile && isDirtyRef.current) {
          await flushSaveImmediately(latestContentRef.current, activeFile.path);
        }
      },
      "Save Active Note"
    );

    return () => {
      unregisterSyncHandler("editor-save");
      if (prevFilePathRef.current && isDirtyRef.current) {
        flushSaveImmediately(latestContentRef.current, prevFilePathRef.current);
      }
    };
  }, [registerSyncHandler, unregisterSyncHandler, activeFile, flushSaveImmediately]);

  // Handle typing content changes with debounced auto-save
  const handleContentChangeTyping = (newVal: string, filePath: string) => {
    setContent(newVal);
    latestContentRef.current = newVal;

    if (newVal === originalContentRef.current) {
      isDirtyRef.current = false;
      setSaveStatus("saved");
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      return;
    }

    isDirtyRef.current = true;
    setSaveStatus("saving");

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(async () => {
      if (!isDirtyRef.current) return;
      try {
        const fileName = filePath.substring(Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\")) + 1);
        const noteName = fileName.replace(/\.md$/, "");
        const { fullContent: syncedContent } = ensureAndSyncFrontmatter(newVal, {
          noteName,
          forceUpdateTimestamp: true,
        });

        await invokeIPC("write_note", {
          path: filePath,
          content: syncedContent,
        });

        // Dual-sync to SQLite blocks
        await invokeIPC("sync_note_blocks", {
          filePath,
          content: syncedContent,
        }).catch(() => { });

        originalContentRef.current = syncedContent;
        latestContentRef.current = syncedContent;
        setMetadataContent(syncedContent);
        isDirtyRef.current = false;
        setSaveStatus("saved");
        updateNoteCache(filePath, syncedContent);
        refreshFiles();
      } catch (err) {
        console.error("Auto-save failed:", err);
        setSaveStatus("saved");
      }
    }, 800);
  };



  const aiActionAbortControllerRef = useRef<AbortController | null>(null);

  const handleCloseFloatingAi = useCallback(() => {
    if (aiActionAbortControllerRef.current) {
      aiActionAbortControllerRef.current.abort();
      aiActionAbortControllerRef.current = null;
    }
    setFloatingResult(null);
    setFloatingSelection(null);
    setIsAiLoading(false);
  }, []);

  // AI Selection Action execution with Live Streaming & Abort Support
  const handleExecuteAiAction = async (
    action: "rewrite" | "explain" | "summarize" | "fix" | "expand" | "shorten" | "flashcard" | "tasks" | "tone" | "custom",
    customInstruction?: string
  ) => {
    if (!floatingSelection || !floatingSelection.text) return;
    const currentSel = floatingSelection;
    const coords = currentSel.coords;

    if (aiActionAbortControllerRef.current) {
      aiActionAbortControllerRef.current.abort();
      aiActionAbortControllerRef.current = null;
    }

    const abortCtrl = new AbortController();
    aiActionAbortControllerRef.current = abortCtrl;

    setIsAiLoading(true);
    setFloatingResult({
      originalText: currentSel.text,
      aiResultText: "",
      actionType: action === "tone" ? (customInstruction || "Tone") : action,
      coords,
    });

    try {
      let prompt = "";
      let systemPrompt = "";

      if (action === "rewrite") {
        prompt = `Rewrite and improve the following text:\n\n${currentSel.text}`;
        systemPrompt = "You are an expert editor. Rewrite the text for maximum clarity, tone, and readability. Keep the core meaning. Output ONLY the rewritten text without markdown code block fences or explanations.";
      } else if (action === "explain") {
        prompt = `Explain the following concept or text clearly:\n\n${currentSel.text}`;
        systemPrompt = "You are a clear and concise teacher. Explain the text in simple, intuitive terms. Output ONLY the clear explanation.";
      } else if (action === "summarize") {
        prompt = `Summarize the key points of the following text:\n\n${currentSel.text}`;
        systemPrompt = "You are a note summarizer. Provide a concise bullet point summary of the text. Output ONLY markdown bullet points.";
      } else if (action === "fix") {
        prompt = `Fix grammar, spelling, and Markdown formatting for:\n\n${currentSel.text}`;
        systemPrompt = "You are a Markdown formatting assistant. Fix grammar, spelling, and structure. Output ONLY the polished text.";
      } else if (action === "expand") {
        prompt = `Expand and elaborate on the following text with rich detail and context:\n\n${currentSel.text}`;
        systemPrompt = "You are an expert technical writer. Expand the text cleanly with deeper context and examples while maintaining accuracy. Output ONLY the expanded markdown text.";
      } else if (action === "shorten") {
        prompt = `Shorten and condense the following text while preserving essential information:\n\n${currentSel.text}`;
        systemPrompt = "You are a concise editor. Reduce the length of the text while retaining all critical facts. Output ONLY the condensed markdown text.";
      } else if (action === "flashcard") {
        prompt = `Create spaced-repetition flashcards from the following text:\n\n${currentSel.text}`;
        systemPrompt = "You are a study assistant. Generate spaced repetition flashcards in the format:\n@flashcard (Question :: Answer)\nCreate 2-4 high quality cards. Output ONLY the flashcard lines.";
      } else if (action === "tasks") {
        prompt = `Extract all actionable tasks and to-dos from the following text:\n\n${currentSel.text}`;
        systemPrompt = "You are a productivity assistant. Extract actionable to-dos as markdown task checkboxes (- [ ] Task description). Output ONLY the task list.";
      } else if (action === "tone" && customInstruction) {
        prompt = `Rewrite the following text in a ${customInstruction} tone:\n\n${currentSel.text}`;
        systemPrompt = `You are an expert communicator. Rewrite the text using a ${customInstruction} tone. Keep the core meaning intact. Output ONLY the rewritten markdown text.`;
      } else if (action === "custom" && customInstruction) {
        prompt = `Context:\n${currentSel.text}\n\nTask: ${customInstruction}`;
        systemPrompt = "You are Kognote AI assistant. Provide helpful, accurate responses. Output clean markdown.";
      }

      let accumulated = "";
      const finalResult = await aiService.generateStream(
        prompt,
        (token: string) => {
          accumulated += token;
          setFloatingResult({
            originalText: currentSel.text,
            aiResultText: accumulated,
            actionType: action === "tone" ? (customInstruction || "Tone") : action,
            coords,
          });
        },
        systemPrompt,
        { abortSignal: abortCtrl.signal }
      );

      if (finalResult) {
        setFloatingResult({
          originalText: currentSel.text,
          aiResultText: finalResult,
          actionType: action === "tone" ? (customInstruction || "Tone") : action,
          coords,
        });
      }
    } catch (err: any) {
      if (err?.name === "AbortError" || abortCtrl.signal.aborted) {
        return;
      }
      console.error("AI action failed:", err);
      setFloatingResult({
        originalText: currentSel.text,
        aiResultText: `Error: ${err.message || "Failed to generate AI output"}`,
        actionType: action === "tone" ? (customInstruction || "Tone") : action,
        coords,
      });
    } finally {
      setIsAiLoading(false);
      if (aiActionAbortControllerRef.current === abortCtrl) {
        aiActionAbortControllerRef.current = null;
      }
    }
  };

  // Replace selected text in Milkdown Crepe
  const handleReplaceSelection = (newText: string) => {
    const crepe = crepeRef.current;
    if (!crepe) return;

    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state, dispatch } = view;
      const { from, to } = state.selection;
      if (from !== to) {
        dispatch(state.tr.replaceWith(from, to, state.schema.text(newText)));
      } else {
        dispatch(state.tr.insertText(newText, from));
      }
    });

    setFloatingResult(null);
    setFloatingSelection(null);
  };

  // Insert AI output below selection
  const handleInsertBelow = (newText: string) => {
    const crepe = crepeRef.current;
    if (!crepe) return;

    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state, dispatch } = view;
      const { to } = state.selection;
      dispatch(state.tr.insertText(`\n\n${newText}\n\n`, to));
    });

    setFloatingResult(null);
    setFloatingSelection(null);
  };

  // Clean Formatting action (Instant, Deterministic, 100% Data-Safe)
  const handleFastFormat = () => {
    if (!activeFile) return;
    setIsFormatting(true);
    try {
      const cleaned = smartFormatLocal(content);
      handleContentChangeTyping(cleaned, activeFile.path);
      setToastMessage("Cleaned formatting!");
      setTimeout(() => setToastMessage(null), 2500);
    } catch (e) {
      console.error("Fast format failed:", e);
    } finally {
      setIsFormatting(false);
      setShowFormatDropdown(false);
    }
  };

  // AI Format & Polish action (AI-assisted polish, preserving dates, tasks & metadata)
  const handleAiFormat = async () => {
    if (!activeFile) return;
    setIsFormatting(true);
    try {
      const formatted = await aiService.formatMarkdown(content);
      handleContentChangeTyping(formatted, activeFile.path);
      setToastMessage("AI Format & Polish complete!");
      setTimeout(() => setToastMessage(null), 2500);
    } catch (e: any) {
      console.error("AI format failed:", e);
      setToastMessage(`AI Format failed: ${e.message || "Error"}`);
      setTimeout(() => setToastMessage(null), 3000);
    } finally {
      setIsFormatting(false);
      setShowFormatDropdown(false);
    }
  };

  // AI Suggest Links action
  const handleSuggestLinks = async () => {
    if (!activeFile || !content) return;
    setIsFormatting(true);
    try {
      const allNoteTitles = Object.keys(noteCache).map((path) => {
        const parts = path.replace(/\\/g, "/").split("/");
        return parts[parts.length - 1].replace(/\.md$/, "");
      });
      const suggestions = await aiService.suggestLinks(content, allNoteTitles);
      if (suggestions.length === 0) {
        setToastMessage("No new wikilink connections suggested.");
      } else {
        let updated = content;
        let count = 0;
        for (const s of suggestions) {
          if (s.originalText && s.linkTarget && updated.includes(s.originalText)) {
            updated = updated.replace(s.originalText, `[[${s.linkTarget}]]`);
            count++;
          }
        }
        if (count > 0) {
          handleContentChangeTyping(updated, activeFile.path);
          setToastMessage(`Inserted ${count} AI wikilink connection(s)!`);
        } else {
          setToastMessage("No new wikilinks inserted.");
        }
      }
      setTimeout(() => setToastMessage(null), 3000);
    } catch (e: any) {
      console.error("Suggest links failed:", e);
      setToastMessage("Suggest links failed.");
      setTimeout(() => setToastMessage(null), 3000);
    } finally {
      setIsFormatting(false);
    }
  };

  // AI Continue Writing action
  const handleContinueWriting = async () => {
    if (!activeFile || !content) return;
    setIsFormatting(true);
    try {
      const prompt = `Continue writing naturally from where the following text leaves off:\n\n${content.slice(-2000)}`;
      const sysPrompt = "You are a creative co-writer. Continue the text seamlessly matching tone and style. Output ONLY the appended text.";
      const continuation = await aiService.generateText(prompt, sysPrompt);
      if (continuation) {
        const updated = `${content}\n\n${continuation.trim()}`;
        handleContentChangeTyping(updated, activeFile.path);
        setToastMessage("AI continued writing!");
        setTimeout(() => setToastMessage(null), 2500);
      }
    } catch (e: any) {
      console.error("AI continue failed:", e);
      setToastMessage("AI continue writing failed.");
      setTimeout(() => setToastMessage(null), 3000);
    } finally {
      setIsFormatting(false);
    }
  };

  // AI Rewrite Note action
  const handleRewriteNote = async () => {
    if (!activeFile || !content) return;
    setIsFormatting(true);
    try {
      const prompt = `Rewrite and polish the following note content for clarity and elegance:\n\n${content}`;
      const sysPrompt = "You are an expert technical editor. Polish the text maintaining Markdown structure. Output ONLY the rewritten text.";
      const rewritten = await aiService.generateText(prompt, sysPrompt);
      if (rewritten) {
        handleContentChangeTyping(rewritten.trim(), activeFile.path);
        setToastMessage("AI rewritten note!");
        setTimeout(() => setToastMessage(null), 2500);
      }
    } catch (e: any) {
      console.error("AI rewrite failed:", e);
      setToastMessage("AI rewrite note failed.");
      setTimeout(() => setToastMessage(null), 3000);
    } finally {
      setIsFormatting(false);
    }
  };

  // Register command palette event listeners
  useEffect(() => {
    const onAiFormat = () => handleAiFormat();
    const onInstantFormat = () => handleFastFormat();
    const onSuggestLinks = () => handleSuggestLinks();
    const onContinueWriting = () => handleContinueWriting();
    const onRewrite = () => handleRewriteNote();

    window.addEventListener("trigger-ai-format", onAiFormat);
    window.addEventListener("trigger-instant-format", onInstantFormat);
    window.addEventListener("trigger-suggest-links", onSuggestLinks);
    window.addEventListener("trigger-continue-writing", onContinueWriting);
    window.addEventListener("trigger-rewrite", onRewrite);

    return () => {
      window.removeEventListener("trigger-ai-format", onAiFormat);
      window.removeEventListener("trigger-instant-format", onInstantFormat);
      window.removeEventListener("trigger-suggest-links", onSuggestLinks);
      window.removeEventListener("trigger-continue-writing", onContinueWriting);
      window.removeEventListener("trigger-rewrite", onRewrite);
    };
  }, [content, activeFile, handleAiFormat, handleFastFormat]);

  // Merge Notes action
  const getMarkdownNotesList = useCallback(() => {
    const list: FileEntry[] = [];
    const walk = (entries: FileEntry[]) => {
      entries.forEach((e) => {
        if (e.is_dir && e.children) walk(e.children);
        else if (!e.is_dir && e.name.endsWith(".md") && e.path !== activeFile?.path) {
          list.push(e);
        }
      });
    };
    walk(files);
    return list;
  }, [files, activeFile]);

  const handleMergeNote = async (targetFile: FileEntry) => {
    if (!activeFile) return;
    setIsMerging(true);
    try {
      const otherContent = (await invokeIPC("read_note", {
        path: targetFile.path,
      })) as string;

      const merged = `${content.trimEnd()}\n\n---\n# Merged: ${targetFile.name.replace(/\.md$/, "")}\n\n${otherContent}`;
      handleContentChangeTyping(merged, activeFile.path);
      setShowMergeModal(false);
      setToastMessage(`Merged with ${targetFile.name}`);
      setTimeout(() => setToastMessage(null), 2500);
    } catch (err) {
      console.error("Merge failed:", err);
    } finally {
      setIsMerging(false);
    }
  };

  const handleMergeNoteAi = async (targetFile: FileEntry) => {
    if (!activeFile) return;
    setIsMerging(true);
    try {
      const otherContent = (await invokeIPC("read_note", {
        path: targetFile.path,
      })) as string;

      const mergedAi = await aiService.chat(
        "Synthesize and combine these two markdown notes cleanly. Remove duplicates, organize headings logically, and return clean markdown.",
        `NOTE 1:\n${content}\n\nNOTE 2:\n${otherContent}`
      );

      handleContentChangeTyping(mergedAi, activeFile.path);
      setShowMergeModal(false);
      setToastMessage(`Intelligently merged with ${targetFile.name}`);
      setTimeout(() => setToastMessage(null), 2500);
    } catch (err) {
      console.error("AI Merge failed:", err);
    } finally {
      setIsMerging(false);
    }
  };

  // Find & Replace matches search
  useEffect(() => {
    if (!findText) {
      setFindMatchesCount(0);
      setFindMatchIndex(0);
      return;
    }

    const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const matches = content.match(regex);
    if (matches) {
      setFindMatchesCount(matches.length);
      setFindMatchIndex(1);
    } else {
      setFindMatchesCount(0);
      setFindMatchIndex(0);
    }
  }, [findText, content]);

  const handleFindNext = () => {
    if (findMatchesCount > 0) {
      setFindMatchIndex((prev) => (prev % findMatchesCount) + 1);
    }
  };

  const handleFindPrev = () => {
    if (findMatchesCount > 0) {
      setFindMatchIndex((prev) => (prev - 2 + findMatchesCount) % findMatchesCount + 1);
    }
  };

  const handleReplaceNext = () => {
    if (!activeFile || !findText || findMatchesCount === 0) return;
    const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const updated = content.replace(regex, replaceText);
    handleContentChangeTyping(updated, activeFile.path);
  };

  const handleReplaceAll = () => {
    if (!activeFile || !findText || findMatchesCount === 0) return;
    const regex = new RegExp(findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const updated = content.replace(regex, replaceText);
    handleContentChangeTyping(updated, activeFile.path);
  };

  if (!activeFile) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-background text-slate-500 select-none">
        <Sparkles className="h-10 w-10 text-indigo-500/50 mb-3 animate-pulse" />
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">No Note Selected</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs text-center leading-relaxed">
          Select a note from the file tree sidebar or create a new note to start writing.
        </p>
      </div>
    );
  }

  // Active note cached metadata & name
  const cachedMeta = noteCache[activeFile.path] || { tags: [], links: [] };

  const isActiveInTrash = useMemo(() => {
    if (!activeFile) return false;
    return isTrashPath(activeFile.path) || cachedMeta.meta?.storage === "deleted";
  }, [activeFile, cachedMeta.meta?.storage]);

  // Extract [[links]] directly from active note content in real time (excluding code blocks and spans)
  const activeLinksFromContent = useMemo(() => {
    return parseWikilinksOutsideCode(content);
  }, [content]);

  // Extract #tags directly from active note content in real time
  const activeTagsFromContent = useMemo(() => {
    const tags: string[] = [];
    const tagRegex = /(?:^|\s)#([a-zA-Z0-9_\-\/]+)/g;
    let match;
    while ((match = tagRegex.exec(content)) !== null) {
      const t = match[1].trim();
      if (t && !tags.includes(t)) {
        tags.push(t);
      }
    }
    return tags;
  }, [content]);

  const allTags = useMemo(() => {
    const metaTags = cachedMeta.tags || [];
    return Array.from(new Set([...metaTags, ...activeTagsFromContent]));
  }, [cachedMeta.tags, activeTagsFromContent]);

  // Segregated outgoing links vs incoming backlinks (using indexed SQLite mentions + Trash isolation)
  const { outgoingLinks, incomingLinks } = useMemo(() => {
    if (!activeFile) return { outgoingLinks: [], incomingLinks: [] };
    const meta = noteCache[activeFile.path] || { links: [] };

    // Outgoing links: filter out trashed target notes if active file is not in trash
    const rawOutgoing = Array.from(new Set([...(meta.links || []), ...activeLinksFromContent]));
    const outgoing = rawOutgoing.filter((linkTarget) => {
      if (isActiveInTrash) return true;
      const matchingCache = Object.values(noteCache).find(
        (c) => c.path.split(/[\/\\]/).pop()?.replace(/\.(md|excalidraw)$/i, "").toLowerCase() === linkTarget.toLowerCase()
      );
      if (matchingCache) {
        if (isTrashPath(matchingCache.path) || matchingCache.meta?.storage === "deleted") {
          return false;
        }
      }
      return true;
    });

    // Incoming backlinks: combine in-memory noteCache scan + indexed SQLite mentions
    const activeBaseName = activeFile.name.replace(/\.(md|excalidraw)$/i, "").toLowerCase();
    const activeNormPath = activeFile.path.replace(/\\/g, "/").toLowerCase();

    const memoryIncoming: string[] = [];
    Object.values(noteCache).forEach((cachedNote) => {
      if (cachedNote.path === activeFile.path) return;
      if (!isActiveInTrash) {
        if (isTrashPath(cachedNote.path) || cachedNote.meta?.storage === "deleted") {
          return;
        }
      }

      const hasLinkToActive = (cachedNote.links || []).some((linkTarget) => {
        const cleanTarget = linkTarget.trim().replace(/\\/g, "").replace(/\.(md|excalidraw)$/i, "").toLowerCase();
        const targetBaseName = cleanTarget.split("/").pop() || "";
        return targetBaseName === activeBaseName || cleanTarget === activeNormPath;
      });

      if (hasLinkToActive) {
        const sourceName = cachedNote.path.split(/[\/\\]/).pop()?.replace(/\.(md|excalidraw)$/i, "") || "";
        if (sourceName && !memoryIncoming.includes(sourceName)) {
          memoryIncoming.push(sourceName);
        }
      }
    });

    const rawIncoming: string[] = Array.from(new Set([...memoryIncoming, ...(meta.meta?.mentions || [])]));
    const incoming = rawIncoming.filter((sourceName) => {
      if (isActiveInTrash) return true;
      const matchingCache = Object.values(noteCache).find(
        (c) => c.path.split(/[\/\\]/).pop()?.replace(/\.(md|excalidraw)$/i, "").toLowerCase() === sourceName.toLowerCase()
      );
      if (matchingCache) {
        if (isTrashPath(matchingCache.path) || matchingCache.meta?.storage === "deleted") {
          return false;
        }
      }
      return true;
    });

    return {
      outgoingLinks: outgoing,
      incomingLinks: incoming,
    };
  }, [activeFile, noteCache, activeLinksFromContent, isActiveInTrash]);

  // Real-time Note Telemetry Statistics (excludes YAML frontmatter metadata)
  const noteStats = useMemo(() => {
    const parsed = parseFrontmatter(content);
    const bodyContent = parsed.bodyContent;
    const bodyText = bodyContent.trim();
    if (!bodyText) {
      return {
        wordCount: 0,
        charCount: 0,
        readTimeMinutes: 0,
        completedTotalChecklists: 0,
        totalChecklists: 0,
        completedTaskSectionChecklists: 0,
        totalTaskSectionChecklists: 0,
        taskPercent: 0,
        flashcardCount: 0,
        attachmentCount: 0,
        webLinkCount: 0
      };
    }

    const charCount = bodyContent.length;
    const words = bodyText.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const readTimeMinutes = wordCount > 0 ? Math.ceil(wordCount / 200) : 0;

    // Extract all checklist lines: [-] [ ] or [-] [x] or [*] [ ] or [*] [x]
    const checklistLines = bodyContent.split(/\r?\n/).filter(line => /^\s*[-*]\s*\[([ xX])\]/.test(line));
    const totalChecklists = checklistLines.length;
    const completedTotalChecklists = checklistLines.filter(line => /^\s*[-*]\s*\[[xX]\]/.test(line)).length;

    // Extract task-section checklist lines containing @task
    const taskSectionLines = checklistLines.filter(line => /@task\b/i.test(line));
    const totalTaskSectionChecklists = taskSectionLines.length;
    const completedTaskSectionChecklists = taskSectionLines.filter(line => /^\s*[-*]\s*\[[xX]\]/.test(line)).length;

    const taskPercent = totalChecklists > 0 ? Math.round((completedTotalChecklists / totalChecklists) * 100) : 0;

    // Flashcards count
    const flashcards = parseFlashcards(bodyContent, activeFile ? activeFile.path : "");
    const flashcardCount = flashcards.length;

    // Attachments match ![alt](url) or ![[attachment]] or [name](attachments/...)
    const attachmentMatches = bodyContent.match(/!\[.*?\]\(.*?\)|!\[\[.*?\]\]|\[.*?\]\((?:.*?\/)?attachments\/.*?\)/gi) || [];
    const attachmentCount = attachmentMatches.length;

    // External web links match [text](http...) or http...
    const webLinkMatches = bodyContent.match(/\[[^\]]+\]\(https?:\/\/[^\s)\x22\x27<]+\)|(?:^|\s)https?:\/\/[^\s)\x22\x27<]+/gi) || [];
    const webLinkCount = webLinkMatches.length;

    return {
      wordCount,
      charCount,
      readTimeMinutes,
      completedTotalChecklists,
      totalChecklists,
      completedTaskSectionChecklists,
      totalTaskSectionChecklists,
      taskPercent,
      flashcardCount,
      attachmentCount,
      webLinkCount
    };
  }, [content, activeFile]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background relative">
      <div className="flex-1 flex flex-col h-full overflow-hidden border-r border-card-border">

        {/* Editor Info Bar & Mode Switcher Header */}
        <div id="editor-info-bar" className="flex h-10 items-center justify-between border-b border-card-border bg-sidebar px-4 shrink-0 select-none relative z-30">
          {/* Left: Outline Toggle & Note Title */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsOutlineOpen((prev) => !prev)}
              className={`p-1.5 rounded hover:bg-[#1a1d29] transition-colors cursor-pointer ${isOutlineOpen ? "text-[#d946ef] bg-[#d946ef]/10 border border-[#d946ef]/20" : "text-slate-500 hover:text-slate-300"
                }`}
              title="Toggle Document Outline"
            >
              <List className="h-4 w-4" />
            </button>
            <span className="text-[11px] text-slate-300 font-bold truncate max-w-xs">
              {activeFile.name.replace(/\.md$/, "")}
            </span>

            <div className="flex items-center gap-1.5 ml-2">
              <button
                onClick={() => {
                  if (activeFile) {
                    window.dispatchEvent(new CustomEvent("reload-active-file", { detail: { path: activeFile.path } }));
                  }
                }}
                className="p-1 rounded text-slate-500 hover:text-indigo-400 hover:bg-[#161825] transition-colors cursor-pointer flex items-center justify-center"
                title="Refresh active note from disk"
              >
                <RotateCw className="h-3 w-3" />
              </button>
              <span className="text-[9px] text-slate-600 font-medium">
                {saveStatus === "saving" ? "Saving..." : "Saved"}
              </span>
            </div>
          </div>

          {/* Right: Mode Switcher (Preview vs Source), Format, Menu */}
          <div className="flex items-center gap-3">
            {!isLogFile && (
              <>
                {/* Simplified Mode Switcher: Preview (Sole Editor) vs Source (Read-only Markdown) */}
                <div className="flex items-center gap-0.5 bg-card border border-card-border rounded-lg p-0.5">
                  <button
                    onClick={() => setEditMode("preview")}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-bold cursor-pointer transition-all ${editMode === "preview"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-card-hover"
                      }`}
                    title="Interactive Rich WYSIWYG Editor"
                  >
                    <Eye className="h-3 w-3" />
                    <span>Preview</span>
                  </button>
                  <button
                    onClick={() => setEditMode("source")}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-bold cursor-pointer transition-all ${editMode === "source"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-card-hover"
                      }`}
                    title="Read-Only Raw Markdown Syntax View"
                  >
                    <FileCode className="h-3 w-3" />
                    <span>Source</span>
                  </button>
                </div>

                {/* Smart Format Dropdown */}
                <div className="relative">
                  <button
                    onClick={() => setShowFormatDropdown((prev) => !prev)}
                    disabled={isFormatting}
                    className="flex items-center gap-1 rounded-md bg-card border border-card-border px-2.5 py-1 text-[10px] font-bold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-card-hover transition-colors cursor-pointer"
                  >
                    <Paintbrush className={`h-3 w-3 ${isFormatting ? "animate-spin" : "text-indigo-400"}`} />
                    {isFormatting ? "Formatting..." : "Format"}
                    <ChevronDown className="h-3 w-3 text-slate-500" />
                  </button>

                  {showFormatDropdown && (
                    <div className="absolute right-0 top-7 z-200 w-44 rounded-lg border border-card-border bg-card p-1 shadow-xl text-foreground animate-fade-in">
                      <button
                        onClick={handleFastFormat}
                        className="w-full rounded-md px-2.5 py-1.5 text-left text-[10px] font-semibold hover:bg-card-hover hover:text-indigo-500 dark:hover:text-indigo-300 transition-colors cursor-pointer"
                      >
                        Clean Formatting
                      </button>
                      <button
                        onClick={handleAiFormat}
                        className="w-full rounded-md px-2.5 py-1.5 text-left text-[10px] font-semibold hover:bg-card-hover hover:text-indigo-500 dark:hover:text-indigo-300 transition-colors cursor-pointer"
                      >
                        AI Format &amp; Polish
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* Three-Dot Options Dropdown */}
            <div className="relative" ref={moreOptionsRef}>
              <button
                onClick={() => setIsMoreOptionsOpen((prev) => !prev)}
                className="p-1 rounded hover:bg-[#1a1d29] transition-colors cursor-pointer text-slate-400 hover:text-slate-200"
                title="Note options"
              >
                <MoreVertical className="h-4 w-4" />
              </button>
              {isMoreOptionsOpen && (
                <div className="absolute right-0 top-7 z-250 w-56 rounded-xl border border-card-border bg-card p-1.5 shadow-2xl animate-fade-in text-foreground text-[11px] space-y-0.5">
                  {!isLogFile && (
                    <>
                      <button
                        onClick={() => {
                          setMergeType("standard");
                          setShowMergeModal(true);
                          setIsMoreOptionsOpen(false);
                        }}
                        className="w-full rounded-lg px-2.5 py-1.5 text-left font-medium hover:bg-indigo-600/20 hover:text-indigo-300 transition-colors cursor-pointer flex items-center justify-between"
                      >
                        <span className="flex items-center gap-2">
                          <GitMerge className="h-3.5 w-3.5 text-indigo-400" />
                          <span>Merge with...</span>
                        </span>
                      </button>
                      <button
                        onClick={() => {
                          setMergeType("ai");
                          setShowMergeModal(true);
                          setIsMoreOptionsOpen(false);
                        }}
                        className="w-full rounded-lg px-2.5 py-1.5 text-left font-medium hover:bg-purple-600/20 hover:text-purple-300 transition-colors cursor-pointer flex items-center justify-between"
                      >
                        <span className="flex items-center gap-2">
                          <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                          <span>Merge using AI...</span>
                        </span>
                      </button>
                      <div className="h-px bg-card-border my-1" />
                    </>
                  )}

                  {/* Find & Replace */}
                  <button
                    onClick={() => {
                      setShowFindReplace(true);
                      setIsMoreOptionsOpen(false);
                      setTimeout(() => findInputRef.current?.focus(), 50);
                    }}
                    className="w-full rounded-lg px-2.5 py-1.5 text-left font-medium hover:bg-card-hover hover:text-indigo-500 dark:hover:text-indigo-300 transition-colors cursor-pointer flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <Search className="h-3.5 w-3.5 text-sky-400" />
                      <span>Find &amp; Replace</span>
                    </span>
                    <span className="text-[9px] font-mono text-slate-500 bg-sidebar px-1.5 py-0.5 rounded border border-card-border">⌘F</span>
                  </button>

                  {/* Export to PDF */}
                  <button
                    onClick={() => {
                      window.print();
                      setIsMoreOptionsOpen(false);
                    }}
                    className="w-full rounded-lg px-2.5 py-1.5 text-left font-medium hover:bg-card-hover hover:text-indigo-500 dark:hover:text-indigo-300 transition-colors cursor-pointer flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Export to PDF</span>
                    </span>
                    <span className="text-[9px] font-mono text-slate-500 bg-sidebar px-1.5 py-0.5 rounded border border-card-border">⌘P</span>
                  </button>

                  <div className="h-px bg-card-border my-1" />

                  {/* Copy WikiLink */}
                  <button
                    onClick={() => {
                      handleCopyWikiLink();
                      setIsMoreOptionsOpen(false);
                    }}
                    className="w-full rounded-lg px-2.5 py-1.5 text-left font-medium hover:bg-indigo-600/20 hover:text-indigo-300 transition-colors cursor-pointer flex items-center gap-2"
                  >
                    <Copy className="h-3.5 w-3.5 text-indigo-400" />
                    <span>Copy WikiLink [[Note]]</span>
                  </button>

                  {/* Copy File Path */}
                  <button
                    onClick={() => {
                      handleCopyPath();
                      setIsMoreOptionsOpen(false);
                    }}
                    className="w-full rounded-lg px-2.5 py-1.5 text-left font-medium hover:bg-indigo-600/20 hover:text-indigo-300 transition-colors cursor-pointer flex items-center gap-2"
                  >
                    <CopyCheck className="h-3.5 w-3.5 text-indigo-400" />
                    <span>Copy Note Path</span>
                  </button>

                  {/* Reveal in Finder / Explorer */}
                  <button
                    onClick={() => {
                      handleRevealInFinder();
                      setIsMoreOptionsOpen(false);
                    }}
                    className="w-full rounded-lg px-2.5 py-1.5 text-left font-medium hover:bg-indigo-600/20 hover:text-indigo-300 transition-colors cursor-pointer flex items-center justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <FolderOpen className="h-3.5 w-3.5 text-amber-400" />
                      <span>Reveal in Finder / Explorer</span>
                    </span>
                    <span className="text-[9px] font-mono text-slate-500 bg-sidebar px-1.5 py-0.5 rounded border border-card-border">⌘⇧R</span>
                  </button>

                  {/* Open with Default External Editor */}
                  <button
                    onClick={() => {
                      handleOpenWithDefault();
                      setIsMoreOptionsOpen(false);
                    }}
                    className="w-full rounded-lg px-2.5 py-1.5 text-left font-medium hover:bg-indigo-600/20 hover:text-indigo-300 transition-colors cursor-pointer flex items-center gap-2"
                  >
                    <ExternalLink className="h-3.5 w-3.5 text-sky-400" />
                    <span>Open in External App</span>
                  </button>

                  {/* Duplicate Note */}
                  <button
                    onClick={() => {
                      handleDuplicateNote();
                      setIsMoreOptionsOpen(false);
                    }}
                    className="w-full rounded-lg px-2.5 py-1.5 text-left font-medium hover:bg-indigo-600/20 hover:text-indigo-300 transition-colors cursor-pointer flex items-center gap-2"
                  >
                    <Layers className="h-3.5 w-3.5 text-purple-400" />
                    <span>Duplicate Note</span>
                  </button>

                  <div className="h-px bg-card-border my-1" />

                  {/* Bookmark Option */}
                  <button
                    onClick={() => {
                      if (activeFile) bookmarkNote(activeFile.path);
                      setIsMoreOptionsOpen(false);
                    }}
                    className="w-full rounded-lg px-2.5 py-1.5 text-left font-medium hover:bg-amber-500/20 hover:text-amber-300 transition-colors cursor-pointer flex items-center gap-2"
                  >
                    <Bookmark className={`h-3.5 w-3.5 text-amber-400 ${isBookmarkedNote ? "fill-amber-400" : ""}`} />
                    <span>{isBookmarkedNote ? "Remove Bookmark" : "Bookmark Note"}</span>
                  </button>

                  {/* Save as Template (Visible for Active & Archived notes) */}
                  {!isDeletedNote && (
                    <button
                      onClick={() => {
                        if (activeFile) {
                          setTemplateInputName(activeFile.name.replace(/\.md$/, ""));
                          setShowTemplateModal(true);
                        }
                        setIsMoreOptionsOpen(false);
                      }}
                      className="w-full rounded-lg px-2.5 py-1.5 text-left font-medium hover:bg-indigo-600/20 hover:text-indigo-300 transition-colors cursor-pointer flex items-center gap-2"
                    >
                      <LayoutTemplate className="h-3.5 w-3.5 text-indigo-400" />
                      <span>Save as Template...</span>
                    </button>
                  )}

                  {/* Restore Note (Only visible if Archived or Trashed) */}
                  {(isArchivedNote || isDeletedNote) && (
                    <button
                      onClick={() => {
                        if (activeFile) restoreNote(activeFile.path);
                        setIsMoreOptionsOpen(false);
                      }}
                      className="w-full rounded-lg px-2.5 py-1.5 text-left font-medium hover:bg-emerald-500/20 hover:text-emerald-300 transition-colors cursor-pointer flex items-center gap-2"
                    >
                      <RotateCcw className="h-3.5 w-3.5 text-emerald-400" />
                      <span>Restore Note</span>
                    </button>
                  )}

                  {/* Archive Note (Only visible if Active) */}
                  {isActiveNote && (
                    <button
                      onClick={() => {
                        if (activeFile) archiveNote(activeFile.path);
                        setIsMoreOptionsOpen(false);
                      }}
                      className="w-full rounded-lg px-2.5 py-1.5 text-left font-medium hover:bg-sky-500/20 hover:text-sky-300 transition-colors cursor-pointer flex items-center gap-2"
                    >
                      <Archive className="h-3.5 w-3.5 text-sky-400" />
                      <span>Archive Note</span>
                    </button>
                  )}

                  {/* Move to Trash / Permanently Delete */}
                  <button
                    onClick={() => {
                      if (activeFile) deleteFileOrDirectory(activeFile.path);
                      setIsMoreOptionsOpen(false);
                    }}
                    className="w-full rounded-lg px-2.5 py-1.5 text-left font-medium hover:bg-rose-500/20 hover:text-rose-300 transition-colors cursor-pointer flex items-center gap-2"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                    <span>{isDeletedNote ? "Permanently Delete" : "Move to Trash (24h)"}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Persistent Interactive Metadata Options & Details Strip (Attached directly below top toolbar) */}
        {activeFile && (
          <MetadataBar
            content={metadataContent || content}
            onUpdateContent={(newVal) => handleContentChangeTyping(newVal, activeFile.path)}
            onBookmarkNote={() => activeFile && bookmarkNote(activeFile.path)}
            onArchiveNote={() => activeFile && archiveNote(activeFile.path)}
            onDeleteNote={() => activeFile && deleteNoteToTrash(activeFile.path)}
            onRestoreNote={() => activeFile && restoreNote(activeFile.path)}
            incomingLinks={incomingLinks}
            outgoingLinks={outgoingLinks}
            onOpenNote={openNoteByName}
          />
        )}

        {/* Find & Replace Panel */}
        {showFindReplace && (
          <div className="flex flex-col gap-2 border-b border-card-border bg-[#0c0d15] p-3 shrink-0 animate-fade-in text-xs">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
                <input
                  ref={findInputRef}
                  type="text"
                  placeholder="Find text..."
                  value={findText}
                  onChange={(e) => setFindText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (e.shiftKey) handleFindPrev();
                      else handleFindNext();
                    } else if (e.key === "Escape") {
                      setShowFindReplace(false);
                    }
                  }}
                  className="w-full rounded-md border border-card-border bg-[#161825] py-1.5 pl-8 pr-20 text-[11px] text-slate-200 placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                  autoFocus
                />
                {findText && (
                  <span className="absolute right-2.5 top-2 text-[9px] text-slate-500 font-bold select-none">
                    {findMatchesCount > 0 ? `${findMatchIndex} of ${findMatchesCount}` : "0 matches"}
                  </span>
                )}
              </div>
              <button
                onClick={handleFindPrev}
                disabled={!findText || findMatchesCount === 0}
                className="px-2.5 py-1.5 rounded-md bg-[#161825] border border-slate-800 text-[10px] font-bold text-slate-400 hover:text-slate-200 disabled:opacity-40 cursor-pointer"
              >
                Previous
              </button>
              <button
                onClick={handleFindNext}
                disabled={!findText || findMatchesCount === 0}
                className="px-2.5 py-1.5 rounded-md bg-[#161825] border border-slate-800 text-[10px] font-bold text-slate-400 hover:text-slate-200 disabled:opacity-40 cursor-pointer"
              >
                Next
              </button>
              <button
                onClick={() => {
                  setShowFindReplace(false);
                  setFindText("");
                  setReplaceText("");
                }}
                className="p-1 rounded text-slate-500 hover:text-slate-300 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!isLogFile && (
              <div className="flex items-center gap-2">
                <input
                  ref={replaceInputRef}
                  type="text"
                  placeholder="Replace with..."
                  value={replaceText}
                  onChange={(e) => setReplaceText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (e.metaKey || e.ctrlKey) handleReplaceAll();
                      else handleReplaceNext();
                    } else if (e.key === "Escape") {
                      setShowFindReplace(false);
                    }
                  }}
                  className="flex-1 rounded-md border border-card-border bg-[#161825] py-1.5 px-3 text-[11px] text-slate-200 placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
                />
                <button
                  onClick={handleReplaceNext}
                  disabled={!findText || findMatchesCount === 0}
                  className="px-2.5 py-1.5 rounded-md bg-indigo-600/20 border border-indigo-500/30 text-[10px] font-bold text-indigo-300 hover:bg-indigo-600/30 disabled:opacity-40 cursor-pointer"
                >
                  Replace
                </button>
                <button
                  onClick={handleReplaceAll}
                  disabled={!findText || findMatchesCount === 0}
                  className="px-2.5 py-1.5 rounded-md bg-indigo-600 border border-indigo-500 text-[10px] font-bold text-slate-100 hover:bg-indigo-500 disabled:opacity-40 cursor-pointer"
                >
                  Replace All
                </button>
              </div>
            )}
          </div>
        )}

        {/* Main Editor Pane: Preview (WYSIWYG) vs Source (Read-only CodeMirror) */}
        <div id="editor-workspace-container" className="flex-1 overflow-hidden relative flex bg-background">
          {editMode === "preview" ? (
            <div className="flex-1 h-full overflow-hidden relative">
              <WysiwygEditor
                key={activeFile.path}
                content={content}
                onChange={(val) => handleContentChangeTyping(val, activeFile.path)}
                onEditorReady={(crepe) => {
                  crepeRef.current = crepe;
                }}
                onSelectionChange={(text, coords) => {
                  if (!text || !coords) {
                    // Don't clear the toolbar while AI is processing or a result card is showing —
                    // pressing Enter in the custom input causes a selectionchange that would
                    // otherwise close the toolbar before the response arrives.
                    if (!isAiLoading && !floatingResult) {
                      setFloatingSelection(null);
                    }
                  } else {
                    setFloatingSelection({ text, coords });
                  }
                }}
              />
            </div>
          ) : (
            <div className="flex-1 h-full overflow-hidden relative">
              <SourceViewer
                content={content}
                onChange={(val) => handleContentChangeTyping(val, activeFile.path)}
                onBlur={(val) => flushSaveImmediately(val, activeFile.path)}
              />
            </div>
          )}

          {/* Collapsible Document Outline Sidebar */}
          <OutlineSidebar
            headings={queryHeadings}
            isOpen={isOutlineOpen}
            onClose={() => setIsOutlineOpen(false)}
            onJumpToHeading={handleOutlineJump}
          />
        </div>

        {/* Bottom Status Bar: Partitioned into 3 Sections (TAGS, INCOMING, OUTGOING) */}
        <div className="h-7 border-t border-card-border bg-sidebar grid grid-cols-3 text-[10px] text-slate-400 shrink-0 select-none w-full">
          {/* Section 1: TAGS BAR */}
          <div className="flex items-center gap-1.5 px-3 border-r border-card-border overflow-x-auto scrollbar-none h-full">
            <span className="text-[8.5px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 shrink-0">
              <Tag className="h-2.5 w-2.5 text-indigo-400" />
              TAGS:
            </span>
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
              {allTags.length > 0 ? (
                allTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => {
                      const event = new CustomEvent("kognote-select-tag", { detail: { tag } });
                      window.dispatchEvent(event);
                    }}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-600 dark:text-indigo-300 font-semibold hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-600/30 dark:hover:text-indigo-200 transition-colors cursor-pointer shrink-0"
                  >
                    #{tag}
                  </button>
                ))
              ) : (
                <span className="text-[9px] text-slate-500 italic">No tags</span>
              )}
            </div>
          </div>

          {/* Section 2: INCOMING BACKLINKS */}
          <div className="flex items-center gap-1.5 px-3 border-r border-card-border overflow-x-auto scrollbar-none h-full">
            <span className="text-[8.5px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 shrink-0">
              <ArrowDownLeft className="h-2.5 w-2.5 text-sky-400" />
              INCOMING:
            </span>
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none flex-1">
              {incomingLinks.length > 0 ? (
                incomingLinks.map((linkTarget) => (
                  <button
                    key={linkTarget}
                    onClick={() => openNoteByName(linkTarget)}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 text-sky-600 dark:text-sky-300 font-semibold hover:bg-sky-500 hover:text-white dark:hover:bg-sky-500/20 dark:hover:text-sky-200 transition-colors cursor-pointer shrink-0 flex items-center gap-0.5"
                    title={`Incoming backlink from [[${linkTarget}]]`}
                  >
                    <span>[[{linkTarget}]]</span>
                  </button>
                ))
              ) : (
                <span className="text-[9px] text-slate-500 italic">No incoming</span>
              )}
            </div>
          </div>

          {/* Section 3: OUTGOING LINKS */}
          <div className="flex items-center gap-1.5 px-3 overflow-x-auto scrollbar-none h-full relative">
            <span className="text-[8.5px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 shrink-0">
              <ArrowUpRight className="h-2.5 w-2.5 text-cyan-400" />
              OUTGOING:
            </span>
            <div className="flex items-center gap-1 overflow-x-auto scrollbar-none flex-1">
              {outgoingLinks.length > 0 ? (
                outgoingLinks.map((linkTarget) => (
                  <button
                    key={linkTarget}
                    onClick={() => openNoteByName(linkTarget)}
                    className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-600/15 border border-cyan-400/30 text-cyan-600 dark:text-cyan-200 font-semibold hover:bg-cyan-600 hover:text-white dark:hover:bg-cyan-600/25 dark:hover:text-cyan-200 transition-colors cursor-pointer shrink-0 flex items-center gap-0.5"
                    title={`Outgoing link to [[${linkTarget}]]`}
                  >
                    <span>[[{linkTarget}]]</span>
                  </button>
                ))
              ) : (
                <span className="text-[9px] text-slate-500 italic">No outgoing</span>
              )}
            </div>

            {toastMessage && (
              <span className="text-[9px] text-indigo-400 font-semibold animate-pulse shrink-0 ml-auto pl-2">
                {toastMessage}
              </span>
            )}
          </div>
        </div>

        {/* Secondary Telemetry & Note Stats Bar */}
        <div className="h-7 border-t border-card-border bg-sidebar px-4 flex items-center justify-between text-[10px] text-slate-500 shrink-0 select-none font-mono">
          {/* Left Side: Tasks, Flashcards, Attachments & Web Links */}
          <div className="flex items-center gap-4">
            {/* Task Completion */}
            {noteStats.totalChecklists > 0 ? (
              <div className="flex items-center gap-1.5" title="Completed/Total [Completed @task/Total @task] checklists">
                <CheckSquare className="h-3 w-3 text-emerald-500 dark:text-emerald-400 shrink-0" />
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                  {noteStats.completedTotalChecklists}/{noteStats.totalChecklists}
                </span> <span className="text-slate-600 dark:text-slate-400">tasks</span>
                <span className="text-slate-500 dark:text-slate-500">({noteStats.taskPercent}%)</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-600 italic" title="No tasks in note">
                <CheckSquare className="h-3 w-3 text-slate-400 dark:text-slate-600 shrink-0" />
                <span>0 tasks</span>
              </div>
            )}

            {/* Flashcards Count */}
            {noteStats.flashcardCount > 0 ? (
              <div className="flex items-center gap-1.5" title="Flashcards in this note">
                <GraduationCap className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
                <span className="text-amber-600 dark:text-amber-300 font-semibold">{noteStats.flashcardCount}</span>
                <span className="text-slate-600 dark:text-slate-400">{noteStats.flashcardCount === 1 ? "flashcard" : "flashcards"}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-600 italic" title="No flashcards in note">
                <GraduationCap className="h-3.5 w-3.5 text-slate-400 dark:text-slate-600 shrink-0" />
                <span>0 flashcards</span>
              </div>
            )}

            {/* Attachment Count */}
            {noteStats.attachmentCount > 0 ? (
              <div className="flex items-center gap-1.5" title="Embedded attachments & images">
                <Paperclip className="h-3 w-3 text-emerald-500 dark:text-emerald-400 shrink-0" />
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{noteStats.attachmentCount}</span>
                <span className="text-slate-600 dark:text-slate-400">{noteStats.attachmentCount === 1 ? "attachment" : "attachments"}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-600 italic" title="No attachments in note">
                <Paperclip className="h-3 w-3 text-slate-400 dark:text-slate-600 shrink-0" />
                <span>0 attachments</span>
              </div>
            )}

            {/* Web Links Count */}
            {noteStats.webLinkCount > 0 ? (
              <div className="flex items-center gap-1.5" title="External web links in note">
                <Globe className="h-3 w-3 text-cyan-500 dark:text-cyan-400 shrink-0" />
                <span className="text-cyan-600 dark:text-cyan-300 font-semibold">{noteStats.webLinkCount}</span>
                <span className="text-slate-600 dark:text-slate-400">{noteStats.webLinkCount === 1 ? "web link" : "web links"}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-600 italic" title="No external web links in note">
                <Globe className="h-3 w-3 text-slate-400 dark:text-slate-600 shrink-0" />
                <span>0 web links</span>
              </div>
            )}
          </div>

          {/* Complete Right Side: Word Count, Char Count, Read Time */}
          <div className="flex items-center gap-4 pr-28">
            {/* Words & Characters */}
            <div className="flex items-center gap-1.5" title="Word & Character count">
              <FileText className="h-3 w-3 text-slate-500" />
              <span className="text-slate-300 font-semibold">{noteStats.wordCount}</span> words
              <span className="text-slate-600">·</span>
              <span className="text-slate-300 font-semibold">{noteStats.charCount}</span> chars
            </div>

            {/* Estimated Read Time */}
            <div className="flex items-center gap-1.5" title="Estimated reading time">
              <Clock className="h-3 w-3 text-indigo-400/80" />
              <span className="text-indigo-300/90">{noteStats.readTimeMinutes < 1 ? "< 1 min read" : `~${noteStats.readTimeMinutes} min read`}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Floating AI Toolbar for Text Selections */}
      <FloatingAiToolbar
        selection={floatingSelection}
        result={floatingResult}
        onExecuteAi={handleExecuteAiAction}
        onReplaceSelection={handleReplaceSelection}
        onInsertBelow={handleInsertBelow}
        onClose={handleCloseFloatingAi}
        isAiLoading={isAiLoading}
      />

      {/* Merge Notes Modal */}
      {showMergeModal && (
        <div className="absolute inset-0 z-110 flex items-center justify-center bg-black/60 backdrop-blur-xs animate-fade-in" onMouseDown={(e) => e.stopPropagation()}>
          <div className="w-full max-w-md rounded-xl bg-card border border-card-border p-5 shadow-2xl flex flex-col max-h-[80%]">
            <div className="flex items-center justify-between pb-3 border-b border-card-border mb-4">
              <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-400 animate-pulse" />
                {mergeType === "ai" ? "Merge Notes using AI" : "Merge Notes"}
              </h3>
              <button
                onClick={() => setShowMergeModal(false)}
                className="p-1 rounded text-slate-500 hover:text-slate-300 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-[10px] text-slate-500 mb-3 leading-relaxed">
              {mergeType === "ai"
                ? "Select a note to combine with the current one. The AI will intelligently merge their sections and synthesize concepts."
                : "Select a note to append to the end of the current note."}
            </p>

            <input
              type="text"
              placeholder="Search notes..."
              value={mergeSearchQuery}
              onChange={(e) => setMergeSearchQuery(e.target.value)}
              className="w-full rounded-md border border-card-border bg-[#161825] py-1.5 px-3 mb-3 text-[11px] text-slate-200 placeholder-slate-600 focus:border-indigo-500 focus:outline-none"
            />

            {(() => {
              const allNotes = getMarkdownNotesList().filter((f) => f.name.toLowerCase().includes(mergeSearchQuery.toLowerCase()));
              return (
                <div className="flex-1 overflow-y-auto min-h-37.5 max-h-70 border border-card-border rounded-lg bg-sidebar p-1 space-y-0.5">
                  {allNotes.map((f) => (
                    <button
                      key={f.path}
                      onClick={() => {
                        if (mergeType === "ai") handleMergeNoteAi(f);
                        else handleMergeNote(f);
                      }}
                      disabled={isMerging}
                      className="w-full rounded-md px-3 py-2 text-left text-[11px] font-semibold text-slate-300 hover:bg-[#161825] hover:text-indigo-400 transition-colors flex items-center justify-between group cursor-pointer disabled:opacity-50"
                    >
                      <span className="truncate">{f.name.replace(/\.md$/, "")}</span>
                    </button>
                  ))}
                  {allNotes.length === 0 && (
                    <div className="text-center py-8 text-[10px] text-slate-600 italic">No notes found</div>
                  )}
                </div>
              );
            })()}

            {isMerging && (
              <div className="flex items-center gap-2 mt-4 text-[10px] text-indigo-400 font-bold justify-center">
                <Sparkles className="h-3.5 w-3.5 animate-spin" />
                {mergeType === "ai" ? "AI is merging contents..." : "Merging files..."}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Save as Template Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-120 flex items-center justify-center bg-black/60 backdrop-blur-xs select-none">
          <div className="w-full max-w-sm rounded-2xl border border-card-border bg-[#0d0e17] p-5 shadow-2xl text-slate-200">
            <h3 className="text-sm font-extrabold uppercase tracking-wider text-slate-100 mb-1 flex items-center gap-2">
              <LayoutTemplate className="h-4 w-4 text-indigo-400" />
              Save Note as Template
            </h3>
            <p className="text-[11px] text-slate-500 mb-4">
              Templates are saved in <span className="text-indigo-400 font-mono">Templates/</span> and can be reused anytime when creating a new note.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!activeFile || !templateInputName.trim()) return;
                try {
                  await saveAsTemplate(activeFile.path, templateInputName.trim());
                  setShowTemplateModal(false);
                  alert(`Successfully saved template "${templateInputName.trim()}"!`);
                } catch (err) {
                  alert(`Failed to save template: ${err}`);
                }
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  Template Name
                </label>
                <input
                  type="text"
                  autoFocus
                  value={templateInputName}
                  onChange={(e) => setTemplateInputName(e.target.value)}
                  placeholder="e.g. Sprint Review"
                  className="w-full rounded-xl border border-card-border bg-[#141624] px-3.5 py-2 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowTemplateModal(false)}
                  className="rounded-xl px-3 py-1.5 text-xs text-slate-400 hover:bg-[#1a1d29]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!templateInputName.trim()}
                  className="rounded-xl bg-indigo-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-indigo-500 disabled:opacity-50 cursor-pointer"
                >
                  Save Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
