import React, { useState, useEffect, useMemo } from "react";
import { useVault } from "../contexts/VaultContext";
import { useSettings } from "../contexts/SettingsContext";
import { useSync } from "../contexts/SyncContext";
import { flashcardStore } from "../lib/flashcard-store";
import { Flashcard } from "../lib/flashcard-parser";
import { FlashcardReview } from "./FlashcardReview";
import { aiService } from "../lib/local-ai";
import { invokeIPC } from "../lib/ipc";
import { 
  Brain, 
  GraduationCap, 
  Calendar, 
  Award, 
  BookOpen, 
  Play, 
  FileText, 
  Sparkles, 
  Check, 
  Trash2, 
  Search, 
  SlidersHorizontal, 
  RefreshCw, 
  Zap,
  FolderOpen,
  Tag,
  Settings2,
  CalendarDays
} from "lucide-react";

export const FlashcardDashboard: React.FC = () => {
  const { files, activeFile, openFile, setActiveView } = useVault();
  const { vaultPath, includeArchivedInScans } = useSettings();

  const [cards, setCards] = useState<Flashcard[]>([]);
  const [dueCards, setDueCards] = useState<Flashcard[]>([]);
  const [history, setHistory] = useState<Record<string, number>>({});
  const [isSyncing, setIsSyncing] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewFilterCards, setReviewFilterCards] = useState<Flashcard[]>([]);

  // Navigation
  const [activeTab, setActiveTab] = useState<"overview" | "ai-gen" | "manager">("overview");

  // Decks Grouping Mode
  const [deckGrouping, setDeckGrouping] = useState<"folder" | "tag">("folder");

  // Card Manager State
  const [managerSearch, setManagerSearch] = useState("");
  const [managerDeckFilter, setManagerDeckFilter] = useState("all");

  // AI Generator State
  const [aiGenerating, setAiGenerating] = useState(false);
  const [generatedCards, setGeneratedCards] = useState<{ id: string; front: string; back: string; enabled: boolean }[]>([]);
  const [aiSuccessMsg, setAiSuccessMsg] = useState("");

  // Stats
  const [stats, setStats] = useState({
    total: 0,
    due: 0,
    learning: 0,
    mastered: 0,
  });

  const syncDeck = async () => {
    if (!vaultPath) return;
    setIsSyncing(true);
    try {
      flashcardStore.setVaultPath(vaultPath);
      const synced = await flashcardStore.syncFlashcards(files, {
        includeArchived: includeArchivedInScans,
        includeTrash: false,
      });
      const histLog = await flashcardStore.loadHistory();
      
      const today = new Date().toISOString().split("T")[0];
      const due = synced.filter((card) => card.nextReviewDate <= today);

      setCards(synced);
      setDueCards(due);
      setHistory(histLog);

      const total = synced.length;
      const learning = synced.filter((c) => c.repetition < 3 && c.repetition > 0).length;
      const mastered = synced.filter((c) => c.repetition >= 3).length;

      setStats({
        total,
        due: due.length,
        learning,
        mastered,
      });
    } catch (err) {
      console.error("Failed to sync flashcards:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  const { registerSyncHandler, unregisterSyncHandler } = useSync();

  // Sync on mount
  useEffect(() => {
    syncDeck();
  }, [files, vaultPath]);

  // Register as global sync step
  useEffect(() => {
    registerSyncHandler("flashcard-sync", syncDeck, "Sync flashcard deck");
    return () => unregisterSyncHandler("flashcard-sync");
  }, [registerSyncHandler, unregisterSyncHandler, files, vaultPath]);

  // Helpers for extracting relative folder and card tags
  const getFolderDeckName = (filePath: string) => {
    if (!vaultPath) return "Root";
    const relative = filePath.replace(vaultPath, "");
    const parts = relative.split(/[/\\]/).filter(Boolean);
    if (parts.length <= 1) return "Root";
    return parts.slice(0, -1).join("/");
  };

  const getCardTags = (card: Flashcard) => {
    const text = `${card.front} ${card.back}`;
    const matches = text.match(/#\w+/g) || [];
    return Array.from(new Set(matches.map(t => t.toLowerCase()).filter(t => t !== "#flashcard")));
  };

  // Grouped Decks selector computed properties
  const decks = useMemo(() => {
    const deckMap = new Map<string, { name: string; total: number; due: number; cards: Flashcard[] }>();

    cards.forEach((card) => {
      let deckKeys: string[] = [];

      if (deckGrouping === "folder") {
        deckKeys = [getFolderDeckName(card.filePath)];
      } else {
        const tags = getCardTags(card);
        deckKeys = tags.length > 0 ? tags : ["#untagged"];
      }

      deckKeys.forEach((key) => {
        const existing = deckMap.get(key) || { name: key, total: 0, due: 0, cards: [] };
        existing.total += 1;
        const today = new Date().toISOString().split("T")[0];
        if (card.nextReviewDate <= today) {
          existing.due += 1;
        }
        existing.cards.push(card);
        deckMap.set(key, existing);
      });
    });

    return Array.from(deckMap.values()).sort((a, b) => b.due - a.due || a.name.localeCompare(b.name));
  }, [cards, deckGrouping]);

  // Weekly consistency contribution heatmap cells
  const heatmapCells = useMemo(() => {
    const cells = [];
    const today = new Date();
    // Start exactly 12 weeks ago aligned to Sunday
    const startDate = new Date();
    startDate.setDate(today.getDate() - 12 * 7);
    const dayOfWeek = startDate.getDay();
    startDate.setDate(startDate.getDate() - dayOfWeek); // align to Sunday

    for (let i = 0; i < 12 * 7; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const dateStr = d.toISOString().split("T")[0];
      cells.push({
        date: dateStr,
        count: history[dateStr] || 0,
      });
    }
    return cells;
  }, [history]);

  // Launch review session for specific list of cards
  const startReviewSession = (targetCards: Flashcard[]) => {
    const today = new Date().toISOString().split("T")[0];
    const due = targetCards.filter((card) => card.nextReviewDate <= today);
    if (due.length > 0) {
      setReviewFilterCards(due);
      setIsReviewing(true);
    }
  };

  // Generate Flashcards using Local AI
  const handleAiGenerate = async () => {
    if (!activeFile) return;
    setAiGenerating(true);
    setAiSuccessMsg("");
    setGeneratedCards([]);
    try {
      const content = await invokeIPC("read_note", {
        path: activeFile.path,
      }) as string;

      if (!content || content.trim().length < 10) {
        throw new Error("Target note content is too empty or short to generate cards.");
      }

      const systemPrompt = "You are a professional Anki flashcard generator. You analyze the note text and generate flashcards strictly following the format: @flashcard ([Question]::[Answer]).";
      const prompt = `Analyze the following note text and write at least 3-6 clear, high-quality study flashcards in the format:
@flashcard ([Front side question]::[Back side short answer])

CRITICAL RULES:
1. Print ONLY the generated cards, one per line. Do not write markdown titles, code block wrappers, greeting text or numbers.
2. The front should be a clear study question.
3. The back should be the correct answer.

Here is the note:
"""
${content}
"""`;

      const response = await aiService.generateText(prompt, systemPrompt);
      const lines = response.split("\n");
      const parsed: typeof generatedCards = [];
      const regex = /@flashcards?\s*\(([\s\S]*?)::([\s\S]*?)\)/i;
      
      lines.forEach((line) => {
        const match = regex.exec(line);
        if (match && match[1].trim() && match[2].trim()) {
          parsed.push({
            id: Math.random().toString(),
            front: match[1].replace(/^-\s*/, "").replace(/^\[/, "").replace(/\]$/, "").trim(),
            back: match[2].replace(/^\[/, "").replace(/\]$/, "").trim(),
            enabled: true
          });
        }
      });

      if (parsed.length === 0) {
        throw new Error("AI returned response but couldn't parse any cards. Try running again.");
      }

      setGeneratedCards(parsed);
    } catch (err: any) {
      console.error(err);
      alert(`AI Generation Failed: ${err.message || err}`);
    } finally {
      setAiGenerating(false);
    }
  };

  // Add generated cards to note file
  const handleSaveGenerated = async () => {
    if (!activeFile || generatedCards.length === 0) return;
    const enabled = generatedCards.filter(c => c.enabled);
    if (enabled.length === 0) return;

    try {
      const current = await invokeIPC("read_note", {
        path: activeFile.path,
      }) as string;

      const cardLines = enabled.map(c => `\n@flashcard (${c.front}::${c.back})`).join("");
      const updated = current.trim() + "\n\n" + cardLines;

      await invokeIPC("write_note", {
        path: activeFile.path,
        content: updated,
      });

      // Notify editor screen to reload
      window.dispatchEvent(new CustomEvent("reload-active-file", { detail: { path: activeFile.path } }));
      
      setGeneratedCards([]);
      setAiSuccessMsg(`🎉 Successfully appended ${enabled.length} flashcards to "${activeFile.name}"!`);
      syncDeck();
    } catch (err: any) {
      console.error(err);
      alert(`Failed to save generated cards: ${err.message || err}`);
    }
  };

  // Reset Progress of a card
  const handleResetCard = async (cardId: string) => {
    const progressMap = await flashcardStore.loadProgress();
    progressMap[cardId] = {
      interval: 0,
      repetition: 0,
      efactor: 2.5,
      nextReviewDate: new Date().toISOString().split("T")[0]
    };
    await flashcardStore.saveProgress(progressMap, cards);
    await syncDeck();
  };

  // Delete Card Progress
  const handleDeleteCard = async (cardId: string) => {
    const progressMap = await flashcardStore.loadProgress();
    delete progressMap[cardId];
    await flashcardStore.saveProgress(progressMap, cards);
    await syncDeck();
  };

  // Filter manager cards
  const filteredManagerCards = useMemo(() => {
    return cards.filter((card) => {
      const textMatch = 
        card.front.toLowerCase().includes(managerSearch.toLowerCase()) || 
        card.back.toLowerCase().includes(managerSearch.toLowerCase());

      if (managerDeckFilter === "all") return textMatch;
      if (managerDeckFilter === "new") return textMatch && card.interval === 0;
      if (managerDeckFilter === "learning") return textMatch && card.repetition < 3 && card.repetition > 0;
      if (managerDeckFilter === "mastered") return textMatch && card.repetition >= 3;
      return textMatch;
    });
  }, [cards, managerSearch, managerDeckFilter]);

  if (isReviewing) {
    return (
      <FlashcardReview 
        cards={reviewFilterCards} 
        onClose={() => { 
          setIsReviewing(false); 
          syncDeck(); 
        }} 
      />
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-[#090a0f] text-slate-200 select-none animate-fade-in">
      {/* Title Toolbar */}
      <div className="flex h-12 items-center justify-between border-b border-[#1f2335] bg-[#0b0c10] px-4 shrink-0">
        <span className="text-xs font-bold text-slate-300 tracking-wider flex items-center gap-1.5">
          <GraduationCap className="h-4 w-4 text-indigo-400" />
          SPACED REPETITION REVIEW
        </span>

        {/* Premium Tab Navigation */}
        <div className="flex bg-[#161825] p-0.5 rounded-lg border border-slate-800 text-[10px] font-bold">
          <button
            onClick={() => setActiveTab("overview")}
            className={`px-3 py-1 rounded flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "overview"
                ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <CalendarDays className="h-3 w-3" /> Dashboard
          </button>
          <button
            onClick={() => setActiveTab("ai-gen")}
            className={`px-3 py-1 rounded flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "ai-gen"
                ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <Sparkles className="h-3 w-3" /> AI Generator
          </button>
          <button
            onClick={() => setActiveTab("manager")}
            className={`px-3 py-1 rounded flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "manager"
                ? "bg-indigo-600/20 text-indigo-400 border border-indigo-500/30"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            <Settings2 className="h-3 w-3" /> Card Manager
          </button>
        </div>
      </div>

      {/* Main Area */}
      <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
        {isSyncing && cards.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-slate-500 gap-3">
            <Brain className="h-8 w-8 text-indigo-500 animate-spin" />
            <span className="text-xs font-medium">Scanning notes for flashcards...</span>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            
            {/* OVERVIEW TAB */}
            {activeTab === "overview" && (
              <>
                {/* Play Review Hero */}
                <div className="rounded-2xl border border-indigo-500/20 bg-linear-to-br from-indigo-950/20 via-indigo-900/10 to-transparent p-6 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-lg shadow-indigo-950/5">
                  <div className="flex flex-col gap-1.5">
                    <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-indigo-400" /> Ready to Review
                    </h2>
                    <p className="text-xs text-slate-400 leading-relaxed max-w-md">
                      Boost your retention using spatial intervals. There are {stats.due} flashcards waiting for you to review today.
                    </p>
                  </div>

                  <button
                    onClick={() => { setReviewFilterCards(dueCards); setIsReviewing(true); }}
                    disabled={stats.due === 0}
                    className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 font-bold text-xs text-white hover:bg-indigo-500 active:scale-95 disabled:opacity-40 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer shrink-0"
                  >
                    <Play className="h-4 w-4 text-white fill-white shrink-0" />
                    Review All Due ({stats.due})
                  </button>
                </div>

                {/* Statistics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="rounded-xl border border-[#1f2335] bg-[#11131c] p-4 flex items-center gap-4">
                    <div className="h-10 w-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 ring-1 ring-indigo-500/20">
                      <BookOpen className="h-5 w-5" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Total</span>
                      <span className="text-lg font-bold text-slate-200">{stats.total}</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#1f2335] bg-[#11131c] p-4 flex items-center gap-4">
                    <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400 ring-1 ring-amber-500/20">
                      <Calendar className="h-5 w-5" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Due</span>
                      <span className="text-lg font-bold text-slate-200">{stats.due}</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#1f2335] bg-[#11131c] p-4 flex items-center gap-4">
                    <div className="h-10 w-10 rounded-lg bg-pink-500/10 flex items-center justify-center text-pink-400 ring-1 ring-pink-500/20">
                      <Brain className="h-5 w-5" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Learning</span>
                      <span className="text-lg font-bold text-slate-200">{stats.learning}</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#1f2335] bg-[#11131c] p-4 flex items-center gap-4">
                    <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 ring-1 ring-emerald-500/20">
                      <Award className="h-5 w-5" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">Mastered</span>
                      <span className="text-lg font-bold text-slate-200">{stats.mastered}</span>
                    </div>
                  </div>
                </div>

                {/* Heatmap Section */}
                <div className="rounded-xl border border-[#1f2335] bg-[#11131c] p-4 flex flex-col gap-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-500 tracking-wider uppercase flex items-center gap-1.5">
                      <CalendarDays className="h-3.5 w-3.5 text-indigo-400" />
                      Study Consistency Heatmap (Last 12 Weeks)
                    </span>
                  </div>

                  <div className="flex items-end justify-center gap-2 overflow-x-auto py-2">
                    <div className="grid grid-flow-col grid-rows-7 gap-1.5 select-none">
                      {heatmapCells.map((cell, idx) => {
                        let cellBg = "bg-[#161825] border-transparent";
                        if (cell.count > 0 && cell.count <= 5) {
                          cellBg = "bg-indigo-900/60 border-indigo-800/40 text-indigo-300";
                        } else if (cell.count > 5 && cell.count <= 10) {
                          cellBg = "bg-indigo-600/80 border-indigo-500/50 text-indigo-100";
                        } else if (cell.count > 10) {
                          cellBg = "bg-indigo-400 border-indigo-300 text-[#090a0f]";
                        }

                        return (
                          <div
                            key={idx}
                            className={`h-3 w-3 rounded-[3px] border ${cellBg}`}
                            title={`${cell.count} cards reviewed on ${cell.date}`}
                          />
                        );
                      })}
                    </div>
                  </div>
                  
                  {/* Heatmap Legend */}
                  <div className="flex justify-end items-center gap-1.5 text-[9px] text-slate-500 font-medium pr-2">
                    <span>Less</span>
                    <div className="h-2 w-2 rounded-[2px] bg-[#161825]" />
                    <div className="h-2 w-2 rounded-[2px] bg-indigo-900/60" />
                    <div className="h-2 w-2 rounded-[2px] bg-indigo-600/80" />
                    <div className="h-2 w-2 rounded-[2px] bg-indigo-400" />
                    <span>More</span>
                  </div>
                </div>

                {/* Decks Category Grid */}
                <div className="flex flex-col gap-3 mt-2">
                  <div className="flex items-center justify-between border-b border-[#1f2335] pb-2">
                    <h3 className="text-xs font-bold text-slate-400 tracking-wider uppercase">
                      STUDY DECKS ({decks.length})
                    </h3>
                    
                    {/* Toggle Grouping */}
                    <div className="flex bg-[#161825] p-0.5 rounded border border-slate-800 text-[9px] font-bold">
                      <button
                        onClick={() => setDeckGrouping("folder")}
                        className={`px-2 py-0.5 rounded flex items-center gap-1 cursor-pointer ${
                          deckGrouping === "folder" ? "bg-indigo-600/20 text-indigo-400" : "text-slate-500"
                        }`}
                      >
                        <FolderOpen className="h-2.5 w-2.5" /> Folders
                      </button>
                      <button
                        onClick={() => setDeckGrouping("tag")}
                        className={`px-2 py-0.5 rounded flex items-center gap-1 cursor-pointer ${
                          deckGrouping === "tag" ? "bg-indigo-600/20 text-indigo-400" : "text-slate-500"
                        }`}
                      >
                        <Tag className="h-2.5 w-2.5" /> Tags
                      </button>
                    </div>
                  </div>

                  {decks.length === 0 ? (
                    <div className="rounded-xl border border-[#1f2335] bg-[#11131c] p-10 text-center text-slate-500 text-xs">
                      No flashcards found. Create inline or block flashcards with the <code className="text-indigo-400">@flashcard (Question::Answer)</code> syntax.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {decks.map((deck) => (
                        <div 
                          key={deck.name} 
                          className="rounded-xl border border-[#1f2335] bg-[#11131c] p-4 flex items-center justify-between hover:border-slate-700 transition-all group"
                        >
                          <div className="flex flex-col gap-1.5 truncate pr-4">
                            <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5 truncate">
                              {deckGrouping === "folder" ? (
                                <FolderOpen className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                              ) : (
                                <Tag className="h-3.5 w-3.5 text-pink-400 shrink-0" />
                              )}
                              {deck.name}
                            </span>
                            <div className="flex items-center gap-2 text-[10px] text-slate-500">
                              <span>{deck.total} cards</span>
                              <span className="h-1 w-1 rounded-full bg-slate-700" />
                              <span className="text-amber-400 font-semibold">{deck.due} due</span>
                            </div>
                          </div>

                          <button
                            onClick={() => startReviewSession(deck.cards)}
                            disabled={deck.due === 0}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600 hover:text-white disabled:opacity-30 disabled:hover:bg-indigo-600/20 disabled:hover:text-indigo-400 active:scale-95 transition-all cursor-pointer shrink-0"
                            title={`Review ${deck.due} due cards in ${deck.name}`}
                          >
                            <Play className="h-3.5 w-3.5 fill-current" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* AI FLASHCARD GENERATOR TAB */}
            {activeTab === "ai-gen" && (
              <div className="flex flex-col gap-4">
                <div className="rounded-xl border border-[#1f2335] bg-[#11131c] p-5 flex flex-col gap-4">
                  <div className="flex items-start justify-between">
                    <div className="flex flex-col gap-1">
                      <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                        <Sparkles className="h-4.5 w-4.5 text-indigo-400" />
                        AI Spaced Repetition Generator
                      </h3>
                      <p className="text-xs text-slate-400 leading-relaxed max-w-lg">
                        Instantly compile note contents into clean flashcards. Open a note in the editor, and click below to review suggestions.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-lg bg-[#090a0f] border border-slate-800 p-3.5 text-xs text-slate-400">
                    <span className="flex items-center gap-2 truncate">
                      <FileText className="h-4 w-4 text-indigo-400 shrink-0" />
                      Active Note: <span className="font-bold text-slate-200 truncate">{activeFile?.name || "None opened"}</span>
                    </span>

                    <button
                      onClick={handleAiGenerate}
                      disabled={!activeFile || aiGenerating}
                      className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-bold text-[11px] text-white hover:bg-indigo-500 disabled:opacity-40 transition-colors cursor-pointer shrink-0"
                    >
                      {aiGenerating ? (
                        <>
                          <RefreshCw className="h-3 w-3 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Zap className="h-3 w-3" />
                          Generate Cards
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* AI Success message */}
                {aiSuccessMsg && (
                  <div className="rounded-lg bg-emerald-950/20 border border-emerald-900/30 text-emerald-400 p-3.5 text-center text-xs font-semibold">
                    {aiSuccessMsg}
                  </div>
                )}

                {/* Generated list preview */}
                {generatedCards.length > 0 && (
                  <div className="flex flex-col gap-3 animate-slide-up">
                    <div className="flex items-center justify-between border-b border-[#1f2335] pb-2">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                        Generated Flashcards Preview ({generatedCards.length})
                      </span>
                      <button
                        onClick={handleSaveGenerated}
                        className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-[10px] font-bold text-white transition-colors cursor-pointer"
                      >
                        <Check className="h-3 w-3" /> Save & Append to Note
                      </button>
                    </div>

                    <div className="flex flex-col gap-3">
                      {generatedCards.map((card, idx) => (
                        <div key={card.id} className="rounded-xl border border-[#1f2335] bg-[#11131c] p-4 flex gap-3.5 items-start">
                          <input
                            type="checkbox"
                            checked={card.enabled}
                            onChange={(e) => {
                              const updated = [...generatedCards];
                              updated[idx].enabled = e.target.checked;
                              setGeneratedCards(updated);
                            }}
                            className="h-4 w-4 mt-2 rounded border-[#1f2335] bg-[#090a0f] text-indigo-600 focus:ring-indigo-600 focus:ring-offset-[#11131c]"
                          />
                          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                            <div className="flex flex-col gap-1">
                              <span className="text-[9px] font-bold text-slate-500 uppercase">Question (Front)</span>
                              <textarea
                                value={card.front}
                                onChange={(e) => {
                                  const updated = [...generatedCards];
                                  updated[idx].front = e.target.value;
                                  setGeneratedCards(updated);
                                }}
                                className="w-full rounded bg-[#090a0f] border border-slate-800 px-2.5 py-1.5 focus:outline-none focus:border-indigo-500/50 resize-y text-slate-300 font-medium"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <span className="text-[9px] font-bold text-slate-500 uppercase">Answer (Back)</span>
                              <textarea
                                value={card.back}
                                onChange={(e) => {
                                  const updated = [...generatedCards];
                                  updated[idx].back = e.target.value;
                                  setGeneratedCards(updated);
                                }}
                                className="w-full rounded bg-[#090a0f] border border-slate-800 px-2.5 py-1.5 focus:outline-none focus:border-indigo-500/50 resize-y text-slate-300 font-medium"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* CARD MANAGER TAB */}
            {activeTab === "manager" && (
              <div className="flex flex-col gap-4 animate-slide-up">
                
                {/* Search / Filter toolbar */}
                <div className="rounded-xl border border-[#1f2335] bg-[#11131c] p-4 flex flex-col sm:flex-row gap-3 items-center justify-between">
                  <div className="relative w-full sm:max-w-xs">
                    <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
                    <input
                      type="text"
                      value={managerSearch}
                      onChange={(e) => setManagerSearch(e.target.value)}
                      placeholder="Search card content..."
                      className="w-full rounded-lg bg-[#090a0f] border border-slate-800 pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-indigo-500/50 placeholder:text-slate-500"
                    />
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" />
                    <select
                      value={managerDeckFilter}
                      onChange={(e) => setManagerDeckFilter(e.target.value)}
                      className="rounded-lg bg-[#090a0f] border border-slate-800 px-3 py-2 text-xs focus:outline-none focus:border-indigo-500/50 font-semibold"
                    >
                      <option value="all">All Stages</option>
                      <option value="new">New (0d interval)</option>
                      <option value="learning">Learning Stage</option>
                      <option value="mastered">Mastered Stage</option>
                    </select>
                  </div>
                </div>

                {/* Cards List Grid */}
                <div className="flex flex-col gap-3">
                  {filteredManagerCards.length === 0 ? (
                    <div className="rounded-xl border border-[#1f2335] bg-[#11131c] p-10 text-center text-slate-500 text-xs">
                      No matching cards found.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {filteredManagerCards.map((card) => (
                        <div 
                          key={card.id} 
                          className="rounded-xl border border-[#1f2335] bg-[#11131c] p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs hover:border-slate-800 transition-all"
                        >
                          <div className="flex-1 flex flex-col gap-1.5 truncate">
                            <span className="font-semibold text-slate-200 whitespace-normal leading-relaxed">
                              {card.front}
                            </span>
                            <span className="text-[10px] text-slate-500 whitespace-normal leading-relaxed">
                              Answer: {card.back}
                            </span>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[9px] font-bold text-slate-500">
                              <span className="flex items-center gap-1 bg-[#090a0f] px-2 py-0.5 rounded border border-slate-800/50">
                                <FileText className="h-2.5 w-2.5" />
                                {card.filePath.split(/[/\\]/).pop()}
                              </span>
                              <span className="bg-indigo-950/20 text-indigo-400 px-2 py-0.5 rounded border border-indigo-950/40">
                                Reps: {card.repetition}
                              </span>
                              <span className="bg-emerald-950/20 text-emerald-400 px-2 py-0.5 rounded border border-emerald-950/40">
                                Due: {card.nextReviewDate}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                            <button
                              onClick={() => {
                                const file = files.find((f) => f.path === card.filePath);
                                if (file) {
                                  openFile(file);
                                  setActiveView("editor");
                                }
                              }}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-[10px] font-bold text-indigo-300 hover:bg-indigo-500/20 active:scale-95 transition-all cursor-pointer"
                              title="Open source note in Editor"
                            >
                              <FileText className="h-3 w-3" />
                              <span>Open Note</span>
                            </button>
                            <button
                              onClick={() => handleResetCard(card.id)}
                              className="px-2.5 py-1.5 rounded-lg border border-slate-800 bg-[#090a0f] text-[10px] font-bold text-slate-400 hover:text-slate-200 active:scale-95 transition-all cursor-pointer"
                              title="Reset Spaced Repetition Schedule"
                            >
                              Reset
                            </button>
                            <button
                              onClick={() => handleDeleteCard(card.id)}
                              className="p-1.5 rounded-lg border border-red-950/40 bg-red-950/10 text-red-400 hover:bg-red-500 hover:text-white active:scale-95 transition-all cursor-pointer"
                              title="Delete Scheduling Data"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
