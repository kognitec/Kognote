import React, { useState, useEffect, useMemo, useRef } from "react";
import { useVault, FileEntry } from "../contexts/VaultContext";
import { useSettings } from "../contexts/SettingsContext";
import { useSync } from "../contexts/SyncContext";
import { flashcardStore } from "../lib/flashcard-store";
import { Flashcard } from "../lib/flashcard-parser";
import { parseFrontmatter } from "../lib/frontmatter";
import { aiService } from "../lib/local-ai";
import { invokeIPC } from "../lib/ipc";
import { isModKey } from "../lib/keyboard-utils";
import { computeFSRS } from "../lib/fsrs";
import confetti from "canvas-confetti";
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
  Flame,
  Activity,
  FolderOpen,
  Tag,
  Settings2,
  CalendarDays,
  Edit3,
  X,
  TrendingUp,
  BarChart3,
  Clock,
  Target,
  Filter,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  RotateCw,
  Volume2,
  Undo2
} from "lucide-react";

interface FlashcardReviewProps {
  cards: Flashcard[];
  onClose: () => void;
}

const FlashcardReview: React.FC<FlashcardReviewProps> = ({ cards, onClose }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [reviewDone, setReviewDone] = useState(false);
  const [sessionCards, setSessionCards] = useState<Flashcard[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [historyStack, setHistoryStack] = useState<{ index: number; cardState: Flashcard }[]>([]);

  // Edit Card Modal State
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");

  const reviewedCountRef = useRef(0);

  // Initialize session cards prioritized by note target due dates
  useEffect(() => {
    const sorted = [...cards].sort((a, b) => {
      if (a.noteDueDate && b.noteDueDate) {
        return a.noteDueDate.localeCompare(b.noteDueDate);
      }
      if (a.noteDueDate) return -1;
      if (b.noteDueDate) return 1;
      return 0;
    });
    setSessionCards(sorted);
  }, [cards]);

  const activeCard = sessionCards[currentIndex];

  const speakText = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    if (isSpeaking) {
      setIsSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleUndoRating = async () => {
    if (historyStack.length === 0) return;
    const last = historyStack[historyStack.length - 1];
    setHistoryStack((prev) => prev.slice(0, -1));

    const updated = [...sessionCards];
    updated[last.index] = last.cardState;
    setSessionCards(updated);
    setCurrentIndex(last.index);
    setIsFlipped(false);
    setReviewDone(false);

    const progressMap = await flashcardStore.loadProgress();
    progressMap[last.cardState.id] = {
      interval: last.cardState.interval,
      repetition: last.cardState.repetition,
      efactor: last.cardState.efactor,
      nextReviewDate: last.cardState.nextReviewDate,
      stability: last.cardState.stability,
      difficulty: last.cardState.difficulty,
      state: last.cardState.state,
    };
    await flashcardStore.saveProgress(progressMap, updated);
  };

  // Live save edited card back to source markdown file
  const handleSaveCardEdit = async () => {
    if (!editingCard || !editFront.trim() || !editBack.trim()) return;
    const success = await flashcardStore.updateFlashcardInNote(editingCard, editFront, editBack);
    if (success) {
      const updated = [...sessionCards];
      updated[currentIndex] = {
        ...editingCard,
        front: editFront.trim(),
        back: editBack.trim(),
      };
      setSessionCards(updated);
    }
    setEditingCard(null);
  };

  // Delete card live from source markdown file
  const handleDeleteCardInReview = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!activeCard) return;
    if (!confirm("Are you sure you want to delete this flashcard from its source note?")) return;

    await flashcardStore.deleteFlashcardFromNote(activeCard);
    const updated = sessionCards.filter((_, idx) => idx !== currentIndex);
    setSessionCards(updated);
    setIsFlipped(false);

    if (updated.length === 0) {
      setReviewDone(true);
    } else if (currentIndex >= updated.length) {
      setCurrentIndex(updated.length - 1);
    }
  };

  const getIntervalString = (grade: number): string => {
    if (!activeCard) return "";
    const nextState = computeFSRS(
      {
        interval: activeCard.interval,
        repetition: activeCard.repetition,
        efactor: activeCard.efactor,
        nextReviewDate: activeCard.nextReviewDate,
        stability: activeCard.stability,
        difficulty: activeCard.difficulty,
        state: activeCard.state,
      },
      grade
    );
    const days = nextState.interval;
    if (days < 30) return `${days}d`;
    const months = Math.round(days / 30);
    return `${months}mo`;
  };

  const handleFlip = () => {
    setIsFlipped((prev) => !prev);
  };

  const handleGrade = async (grade: number) => {
    if (!activeCard) return;

    setHistoryStack((prev) => [...prev, { index: currentIndex, cardState: { ...activeCard } }]);
    reviewedCountRef.current += 1;

    // Calculate updated card schedule using FSRS
    const nextState = computeFSRS(
      {
        interval: activeCard.interval,
        repetition: activeCard.repetition,
        efactor: activeCard.efactor,
        nextReviewDate: activeCard.nextReviewDate,
        stability: activeCard.stability,
        difficulty: activeCard.difficulty,
        state: activeCard.state,
      },
      grade
    );

    // Save progress to local vault file
    const progressMap = await flashcardStore.loadProgress();
    progressMap[activeCard.id] = {
      interval: nextState.interval,
      repetition: nextState.repetition,
      efactor: nextState.efactor,
      nextReviewDate: nextState.nextReviewDate,
      stability: nextState.stability,
      difficulty: nextState.difficulty,
      state: nextState.state,
    };
    await flashcardStore.saveProgress(progressMap, sessionCards);

    // Update active card local state
    const updatedCards = [...sessionCards];
    updatedCards[currentIndex] = {
      ...activeCard,
      ...nextState,
    };
    setSessionCards(updatedCards);

    // Transition state
    setIsFlipped(false);
    
    // Proceed to next card or complete session
    setTimeout(async () => {
      if (currentIndex + 1 < sessionCards.length) {
        setCurrentIndex((prev) => prev + 1);
      } else {
        // Log the session completion count accurately
        try {
          await flashcardStore.logSession(reviewedCountRef.current);
        } catch (e) {
          console.error("Failed to log session counts:", e);
        }

        // Complete review, fire confetti!
        confetti({
          particleCount: 150,
          spread: 80,
          origin: { y: 0.6 },
          colors: ["#6366f1", "#ec4899", "#10b981"],
        });
        setReviewDone(true);
      }
    }, 150);
  };

  // Allow spacebar key to flip and number keys (1-4) to grade
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (reviewDone || !activeCard) return;

      if (e.key === "u" || (e.key === "z" && isModKey(e))) {
        e.preventDefault();
        handleUndoRating();
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        handleFlip();
      } else if (isFlipped) {
        if (e.key === "1") handleGrade(0); // Again
        else if (e.key === "2") handleGrade(2); // Hard
        else if (e.key === "3") handleGrade(3); // Good
        else if (e.key === "4") handleGrade(5); // Easy
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFlipped, currentIndex, sessionCards, reviewDone, historyStack]);

  const handleExit = async () => {
    if (reviewedCountRef.current > 0) {
      try {
        await flashcardStore.logSession(reviewedCountRef.current);
      } catch (e) {
        console.error("Failed to log session counts on exit:", e);
      }
    }
    onClose();
  };

  if (sessionCards.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background text-slate-500 gap-4">
        <span>No cards due for review!</span>
        <button
          onClick={handleExit}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 font-semibold text-xs text-white hover:bg-indigo-500 cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" /> Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-background text-slate-200 select-none animate-fade-in">
      {/* Header toolbar */}
      <div className="flex h-12 items-center justify-between border-b border-card-border bg-sidebar px-4">
        <button
          onClick={handleExit}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" /> Exit Review
        </button>

        {!reviewDone && (
          <span className="text-[10px] font-bold text-slate-500 tracking-wider uppercase">
            Card {currentIndex + 1} of {sessionCards.length}
          </span>
        )}

        <div className="flex items-center gap-2">
          {historyStack.length > 0 && !reviewDone && (
            <button
              onClick={handleUndoRating}
              className="flex items-center gap-1 text-[11px] font-bold text-amber-400 bg-amber-500/10 hover:bg-amber-500/20 px-2.5 py-1 rounded-lg border border-amber-500/30 transition-all cursor-pointer"
              title="Undo last card rating (Cmd+Z or U)"
            >
              <Undo2 className="h-3.5 w-3.5" />
              <span>Undo</span>
            </button>
          )}
        </div>
      </div>

      {/* Main container */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        {reviewDone ? (
          <div className="max-w-sm rounded-2xl border border-card-border bg-card p-8 text-center shadow-2xl animate-fade-in">
            <CheckCircle2 className="mx-auto h-16 w-16 text-emerald-500 mb-4 animate-scale-up" />
            <h2 className="text-xl font-bold text-slate-200 mb-2">Review Complete!</h2>
            <p className="text-xs text-slate-500 leading-relaxed mb-6">
              You've cleared all scheduled cards for today. Spaced repetition will notify you when cards are ready for review.
            </p>
            <button
              onClick={handleExit}
              className="w-full rounded-xl bg-indigo-600 py-3 font-semibold text-xs text-white hover:bg-indigo-500 transition-all active:scale-95 shadow-lg shadow-indigo-600/30 cursor-pointer"
            >
              Back to Dashboard
            </button>
          </div>
        ) : (
          <div className="w-full max-w-lg flex flex-col items-center gap-8">
            
            {/* Progress bar */}
            <div className="w-full bg-card h-1.5 rounded-full overflow-hidden border border-card-border">
              <div
                style={{ width: `${((currentIndex) / sessionCards.length) * 100}%` }}
                className="bg-indigo-600 h-full rounded-full transition-all duration-300"
              />
            </div>

            {/* 3D Card Flipping Card */}
            <div
              onClick={handleFlip}
              className="w-full h-80 perspective-1000 cursor-pointer group"
            >
              <div
                className={`relative w-full h-full transform-style-3d duration-500 rounded-2xl border border-card-border shadow-xl ${
                  isFlipped ? "rotate-y-180" : ""
                }`}
              >
                {/* Front Side */}
                <div className="absolute inset-0 backface-hidden bg-card p-6 flex flex-col items-center justify-center rounded-2xl">
                  <span className="absolute top-4 left-4 text-[9px] font-bold text-slate-600 uppercase tracking-widest">
                    Question / Front
                  </span>
                  
                  <div className="absolute top-4 right-4 flex items-center gap-1.5">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingCard(activeCard);
                        setEditFront(activeCard.front);
                        setEditBack(activeCard.back);
                      }}
                      className="p-1.5 rounded-md border text-slate-500 hover:text-indigo-300 hover:bg-indigo-500/20 border-slate-800 transition-colors cursor-pointer"
                      title="Edit flashcard in note"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={handleDeleteCardInReview}
                      className="p-1.5 rounded-md border text-slate-500 hover:text-rose-400 hover:bg-rose-500/20 border-slate-800 transition-colors cursor-pointer"
                      title="Delete flashcard from note"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={(e) => speakText(activeCard.front, e)}
                      className={`p-1.5 rounded-md border transition-colors cursor-pointer ${
                        isSpeaking ? "text-indigo-400 bg-indigo-500/20 border-indigo-500/40" : "text-slate-500 hover:text-slate-200 hover:bg-slate-800 border-slate-800"
                      }`}
                      title="Listen to question (Text-to-Speech)"
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                    </button>
                    {activeCard.noteDueDate && (
                      <span className="text-[9px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 flex items-center gap-1" title={`Source note deadline: ${activeCard.noteDueDate}`}>
                        <Target className="h-2.5 w-2.5" />
                        Due: {activeCard.noteDueDate}
                      </span>
                    )}
                    <span className="text-[9px] font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 max-w-30 truncate" title={activeCard.filePath.split(/[/\\]/).pop()}>
                      {activeCard.filePath.split(/[/\\]/).pop()?.replace(/\.md$/, "")}
                    </span>
                  </div>

                  <p className="text-base text-center leading-relaxed font-semibold max-w-sm overflow-y-auto whitespace-pre-wrap select-text">
                    {activeCard.front}
                  </p>
                  <span className="absolute bottom-4 text-[10px] text-slate-500 flex items-center gap-1.5 font-medium group">
                    Click card or press Space to reveal <RotateCw className="h-3 w-3 transition-transform duration-300 group-hover:rotate-180" />
                  </span>
                </div>

                {/* Back Side */}
                <div className="absolute inset-0 backface-hidden rotate-y-180 bg-card border border-card-border p-6 flex flex-col items-center justify-center rounded-2xl shadow-xl">
                  <span className="absolute top-4 left-4 text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                    Answer / Back
                  </span>
                  
                  <div className="absolute top-4 right-4 flex items-center gap-2">
                    <button
                      onClick={(e) => speakText(activeCard.back, e)}
                      className={`p-1.5 rounded-md border transition-colors cursor-pointer ${
                        isSpeaking ? "text-indigo-500 bg-indigo-500/20 border-indigo-500/40" : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-card-hover border-card-border"
                      }`}
                      title="Listen to answer (Text-to-Speech)"
                    >
                      <Volume2 className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-[9px] font-bold text-indigo-500 dark:text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20 max-w-35 truncate" title={activeCard.filePath.split(/[/\\]/).pop()}>
                      {activeCard.filePath.split(/[/\\]/).pop()?.replace(/\.md$/, "")}
                    </span>
                  </div>

                  <p className="text-base text-center leading-relaxed font-semibold max-w-sm overflow-y-auto whitespace-pre-wrap text-indigo-600 dark:text-indigo-200 select-text">
                    {activeCard.back}
                  </p>
                  <span className="absolute bottom-4 text-[10px] text-slate-500 flex items-center gap-1.5 font-medium">
                    Click card to flip back
                  </span>
                </div>
              </div>
            </div>

            {/* Controller Action buttons */}
            <div className="w-full flex flex-col gap-3">
              {!isFlipped ? (
                <button
                  onClick={handleFlip}
                  className="w-full rounded-xl bg-indigo-600 py-3.5 font-semibold text-xs text-white hover:bg-indigo-500 active:scale-98 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
                >
                  Show Answer (Space)
                </button>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  <button
                    onClick={() => handleGrade(0)}
                    className="flex flex-col items-center gap-1 rounded-xl bg-red-500/10 py-2.5 text-xs font-bold text-red-400 border border-red-500/20 hover:bg-red-500/20 active:scale-95 transition-all cursor-pointer relative group/btn"
                  >
                    <span className="flex items-center gap-1">
                      <span>Again</span>
                      <kbd className="text-[8px] bg-red-500/20 px-1 py-0.2 rounded font-mono">1</kbd>
                    </span>
                    <span className="text-[9px] font-medium text-red-500/70">{getIntervalString(0)}</span>
                  </button>
                  <button
                    onClick={() => handleGrade(2)}
                    className="flex flex-col items-center gap-1 rounded-xl bg-amber-500/10 py-2.5 text-xs font-bold text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 active:scale-95 transition-all cursor-pointer relative group/btn"
                  >
                    <span className="flex items-center gap-1">
                      <span>Hard</span>
                      <kbd className="text-[8px] bg-amber-500/20 px-1 py-0.2 rounded font-mono">2</kbd>
                    </span>
                    <span className="text-[9px] font-medium text-amber-500/70">{getIntervalString(2)}</span>
                  </button>
                  <button
                    onClick={() => handleGrade(3)}
                    className="flex flex-col items-center gap-1 rounded-xl bg-indigo-500/10 py-2.5 text-xs font-bold text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20 active:scale-95 transition-all cursor-pointer relative group/btn"
                  >
                    <span className="flex items-center gap-1">
                      <span>Good</span>
                      <kbd className="text-[8px] bg-indigo-500/20 px-1 py-0.2 rounded font-mono">3</kbd>
                    </span>
                    <span className="text-[9px] font-medium text-indigo-500/70">{getIntervalString(3)}</span>
                  </button>
                  <button
                    onClick={() => handleGrade(5)}
                    className="flex flex-col items-center gap-1 rounded-xl bg-emerald-500/10 py-2.5 text-xs font-bold text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 active:scale-95 transition-all cursor-pointer relative group/btn"
                  >
                    <span className="flex items-center gap-1">
                      <span>Easy</span>
                      <kbd className="text-[8px] bg-emerald-500/20 px-1 py-0.2 rounded font-mono">4</kbd>
                    </span>
                    <span className="text-[9px] font-medium text-emerald-500/70">{getIntervalString(5)}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Edit Card Modal Overlay */}
      {editingCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-fade-in">
          <div className="w-full max-w-md rounded-2xl border border-card-border bg-card p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-card-border pb-3">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <Edit3 className="h-4 w-4 text-indigo-400" />
                Edit Flashcard (Live Sync to Note)
              </span>
              <button
                onClick={() => setEditingCard(null)}
                className="text-slate-500 hover:text-slate-300 p-1 rounded-md transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-3 text-xs">
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Question (Front)</span>
                <textarea
                  value={editFront}
                  onChange={(e) => setEditFront(e.target.value)}
                  className="w-full rounded-xl bg-background border border-slate-800 p-3 text-slate-200 text-xs focus:outline-none focus:border-indigo-500/50 resize-y font-medium min-h-17.5"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Answer (Back)</span>
                <textarea
                  value={editBack}
                  onChange={(e) => setEditBack(e.target.value)}
                  className="w-full rounded-xl bg-background border border-slate-800 p-3 text-slate-200 text-xs focus:outline-none focus:border-indigo-500/50 resize-y font-medium min-h-17.5"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-card-border">
              <button
                onClick={() => setEditingCard(null)}
                className="px-4 py-2 rounded-lg border border-slate-800 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCardEdit}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" /> Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const formatUserFriendlyDate = (dateStr?: string) => {
  if (!dateStr) return "";
  const parts = dateStr.split("-");
  if (parts.length === 3) {
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const d = parseInt(parts[2], 10);
    const dt = new Date(y, m, d);
    if (!isNaN(dt.getTime())) {
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    }
  }
  return dateStr;
};

export const FlashcardDashboard: React.FC = () => {
  const { files, activeFile, openFile, setActiveView, noteCache } = useVault();
  const { vaultPath, includeArchivedInScans } = useSettings();

  const [cards, setCards] = useState<Flashcard[]>([]);
  const [history, setHistory] = useState<Record<string, number>>({});
  const [isSyncing, setIsSyncing] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewFilterCards, setReviewFilterCards] = useState<Flashcard[]>([]);

  // Navigation
  const [activeTab, setActiveTab] = useState<"overview" | "ai-gen" | "manager">("overview");

  // Decks Grouping Mode (folder | tag | note | deadline)
  const [deckGrouping, setDeckGrouping] = useState<"folder" | "tag" | "note" | "deadline">("folder");

  // Edit Card Modal State
  const [editingCard, setEditingCard] = useState<Flashcard | null>(null);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");

  // Card Manager State
  const [managerSearch, setManagerSearch] = useState("");
  const [managerDeckFilter, setManagerDeckFilter] = useState("all");

  // AI Generator Target Note & Multi-Note Selectors
  const [aiSelectedFile, setAiSelectedFile] = useState<FileEntry | null>(null);
  const [selectedAiNotes, setSelectedAiNotes] = useState<string[]>([]);
  const [aiNoteSearch, setAiNoteSearch] = useState("");
  const [aiFilterCategory, setAiFilterCategory] = useState<"all" | "due" | "high" | "medium" | "low">("all");

  // Conflict Modal for existing flashcards in note (Replace vs. Append)
  const [saveConflictModal, setSaveConflictModal] = useState<{
    targetFile: FileEntry;
    cardsToSave: { front: string; back: string }[];
    existingCount: number;
  } | null>(null);

  // AI Generation Failure Error Modal
  const [aiErrorModal, setAiErrorModal] = useState<{ title: string; reason: string } | null>(null);
  const previewSectionRef = useRef<HTMLDivElement>(null);

  // Flatten all markdown notes from vault files
  const allNoteFiles = useMemo(() => {
    const flatten = (items: FileEntry[]): FileEntry[] => {
      let result: FileEntry[] = [];
      for (const item of items) {
        if (item.is_dir && item.children) {
          result = result.concat(flatten(item.children));
        } else if (item.name.endsWith(".md")) {
          result.push(item);
        }
      }
      return result;
    };
    return flatten(files).sort((a, b) => a.name.localeCompare(b.name));
  }, [files]);

  // Filtered notes based on search text and filter category dropdown
  const filteredNoteFiles = useMemo(() => {
    return allNoteFiles.filter((f) => {
      if (aiNoteSearch && !f.name.toLowerCase().includes(aiNoteSearch.toLowerCase())) {
        return false;
      }
      const meta = flashcardStore.noteMetaMap.get(f.path) || {};
      if (aiFilterCategory === "due" && !meta.dueDate) return false;
      if (aiFilterCategory === "high" && meta.priority !== "high") return false;
      if (aiFilterCategory === "medium" && meta.priority !== "medium") return false;
      if (aiFilterCategory === "low" && meta.priority !== "low") return false;
      return true;
    });
  }, [allNoteFiles, aiNoteSearch, aiFilterCategory]);

  // Resolve target note: explicitly selected note || active open note || first available note
  const targetAiFile = useMemo(() => {
    if (aiSelectedFile) return aiSelectedFile;
    if (activeFile) return activeFile;
    return allNoteFiles[0] || null;
  }, [aiSelectedFile, activeFile, allNoteFiles]);

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

  // Grouped Decks selector computed properties (Folders, Tags & Notes)
  const decks = useMemo(() => {
    const deckMap = new Map<string, { name: string; total: number; due: number; cards: Flashcard[] }>();

    cards.forEach((card) => {
      let deckKeys: string[] = [];

      if (deckGrouping === "folder") {
        deckKeys = [getFolderDeckName(card.filePath)];
      } else if (deckGrouping === "note") {
        const noteName = card.filePath.split(/[/\\]/).pop()?.replace(/\.md$/, "") || "Untitled Note";
        deckKeys = [noteName];
      } else if (deckGrouping === "deadline") {
        if (!card.noteDueDate) {
          deckKeys = ["📁 No Deadline Target"];
        } else {
          const today = new Date().setHours(0, 0, 0, 0);
          const target = new Date(card.noteDueDate).setHours(0, 0, 0, 0);
          const diffDays = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
          if (diffDays <= 0) {
            deckKeys = ["🎯 Overdue / Today"];
          } else if (diffDays <= 7) {
            deckKeys = [`⏳ Due Next 7 Days (${card.noteDueDate})`];
          } else {
            deckKeys = [`📅 Future Targets (${card.noteDueDate})`];
          }
        }
      } else {
        const tags = getCardTags(card);
        deckKeys = tags.length > 0 ? tags : ["#untagged"];
      }

      deckKeys.forEach((key) => {
        const existing = deckMap.get(key) || { name: key, total: 0, due: 0, cards: [] };
        existing.total += 1;
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const dd = String(now.getDate()).padStart(2, "0");
        const today = `${yyyy}-${mm}-${dd}`;
        if (card.nextReviewDate <= today) {
          existing.due += 1;
        }
        existing.cards.push(card);
        deckMap.set(key, existing);
      });
    });

    return Array.from(deckMap.values()).sort((a, b) => b.due - a.due || a.name.localeCompare(b.name));
  }, [cards, deckGrouping]);

  // Multi-category activity tracker per day for 84 days (12 weeks)
  const activityData = useMemo(() => {
    const counts: Record<string, { flashcards: number; noteEdits: number; tasksCompleted: number; boardDone: number; total: number }> = {};

    const getOrInit = (dateStr: string) => {
      if (!counts[dateStr]) {
        counts[dateStr] = { flashcards: 0, noteEdits: 0, tasksCompleted: 0, boardDone: 0, total: 0 };
      }
      return counts[dateStr];
    };

    // 1. Flashcard reviews history
    Object.entries(history).forEach(([dateStr, count]) => {
      if (count > 0) {
        const item = getOrInit(dateStr);
        item.flashcards += count;
        item.total += count;
      }
    });

    // 2. Note updates, task completions & board status from noteCache
    if (noteCache) {
      Object.values(noteCache).forEach((note) => {
        if (note.modifiedAt) {
          let mtime = Number(note.modifiedAt);
          if (!isNaN(mtime) && mtime > 0) {
            if (mtime < 1e11) {
              mtime = mtime * 1000;
            }
            const d = new Date(mtime);
            if (!isNaN(d.getTime())) {
              const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
              const item = getOrInit(dateStr);

              // Note edit/creation
              item.noteEdits += 1;
              item.total += 1;

              // Completed tasks
              if (Array.isArray(note.tasks)) {
                const completedCount = note.tasks.filter((t) => t.completed).length;
                if (completedCount > 0) {
                  item.tasksCompleted += completedCount;
                  item.total += completedCount;
                }
              }

              // Board status Done
              if (note.boardCard && note.boardCard.status === "Done") {
                item.boardDone += 1;
                item.total += 1;
              }
            }
          }
        }
      });
    }

    return counts;
  }, [history, noteCache]);

  const { heatmapCells, monthsHeader, streakStats } = useMemo(() => {
    const cells: Array<{
      date: string;
      formattedDate: string;
      flashcards: number;
      noteEdits: number;
      tasksCompleted: number;
      boardDone: number;
      total: number;
      isToday: boolean;
      dayOfWeek: number;
      weekIndex: number;
    }> = [];

    const now = new Date();
    const yyyyNow = now.getFullYear();
    const mmNow = String(now.getMonth() + 1).padStart(2, "0");
    const ddNow = String(now.getDate()).padStart(2, "0");
    const todayStr = `${yyyyNow}-${mmNow}-${ddNow}`;

    // Align to current week's Sunday, 11 weeks ago (84 days total)
    const currentSunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    const startDate = new Date(currentSunday.getFullYear(), currentSunday.getMonth(), currentSunday.getDate() - 77);

    // 12-week month header calculation
    const monthLabels: Array<{ name: string; weekIndex: number; spanWeeks: number }> = [];
    for (let w = 0; w < 12; w++) {
      const sundayDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + w * 7);
      const mName = sundayDate.toLocaleDateString("en-US", { month: "short" });
      const lastLabel = monthLabels[monthLabels.length - 1];
      if (lastLabel && lastLabel.name === mName) {
        lastLabel.spanWeeks += 1;
      } else {
        monthLabels.push({ name: mName, weekIndex: w, spanWeeks: 1 });
      }
    }

    for (let i = 0; i < 84; i++) {
      const d = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const dateStr = `${yyyy}-${mm}-${dd}`;
      const isToday = dateStr === todayStr;

      const act = activityData[dateStr] || { flashcards: 0, noteEdits: 0, tasksCompleted: 0, boardDone: 0, total: 0 };
      const dayNum = d.getDay();
      const weekIndex = Math.floor(i / 7);

      const formattedDate = d.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });

      cells.push({
        date: dateStr,
        formattedDate,
        flashcards: act.flashcards,
        noteEdits: act.noteEdits,
        tasksCompleted: act.tasksCompleted,
        boardDone: act.boardDone,
        total: act.total,
        isToday,
        dayOfWeek: dayNum,
        weekIndex,
      });
    }

    // Streak calculations
    const sortedCells = [...cells].sort((a, b) => a.date.localeCompare(b.date));
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    let activeDaysCount = 0;
    let totalActivityCount = 0;

    let streakBroken = false;
    const todayIndex = sortedCells.findIndex((c) => c.isToday);
    const startIndex = todayIndex >= 0 ? todayIndex : sortedCells.length - 1;

    for (let i = startIndex; i >= 0; i--) {
      const cell = sortedCells[i];
      if (cell.total > 0) {
        if (!streakBroken) currentStreak++;
      } else {
        if (i === todayIndex) {
          continue; // today might be in progress
        }
        streakBroken = true;
      }
    }

    sortedCells.forEach((c) => {
      if (c.total > 0) {
        activeDaysCount++;
        totalActivityCount += c.total;
        tempStreak++;
        if (tempStreak > longestStreak) longestStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
    });

    return {
      heatmapCells: cells,
      monthsHeader: monthLabels,
      streakStats: {
        currentStreak,
        longestStreak,
        activeDaysCount,
        totalActivityCount,
      },
    };
  }, [activityData]);

  // Forecast analytics metrics
  const forecastStats = useMemo(() => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const todayStr = `${yyyy}-${mm}-${dd}`;

    const tom = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tomStr = `${tom.getFullYear()}-${String(tom.getMonth() + 1).padStart(2, "0")}-${String(tom.getDate()).padStart(2, "0")}`;

    const in7 = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7);
    const in7Str = `${in7.getFullYear()}-${String(in7.getMonth() + 1).padStart(2, "0")}-${String(in7.getDate()).padStart(2, "0")}`;

    const dueTomorrow = cards.filter(c => c.nextReviewDate === tomStr).length;
    const dueIn7Days = cards.filter(c => c.nextReviewDate > todayStr && c.nextReviewDate <= in7Str).length;
    const retentionRate = cards.length > 0 ? Math.round((stats.mastered / cards.length) * 100) : 100;

    return { dueTomorrow, dueIn7Days, retentionRate };
  }, [cards, stats]);

  // Launch review session for specific list of cards (reviews due cards, or falls back to all cards for practice)
  const startReviewSession = (targetCards: Flashcard[]) => {
    if (!targetCards || targetCards.length === 0) return;
    const today = new Date().toISOString().split("T")[0];
    const due = targetCards.filter((card) => card.nextReviewDate <= today);
    const toReview = due.length > 0 ? due : targetCards;
    setReviewFilterCards(toReview);
    setIsReviewing(true);
  };

  // Generate Flashcards using Local AI
  const handleAiGenerate = async () => {
    if (!targetAiFile) return;
    setAiGenerating(true);
    setAiSuccessMsg("");
    setGeneratedCards([]);
    try {
      const rawContent = (await invokeIPC("read_note", {
        path: targetAiFile.path,
      })) as string;

      // Extract body content excluding YAML frontmatter metadata
      const parsedFm = parseFrontmatter(rawContent || "");
      const noteBody = (parsedFm.bodyContent || "").trim();

      if (!noteBody || noteBody.length < 10) {
        throw new Error("Target note body content is too empty or short to generate cards.");
      }

      const systemPrompt = "You are an expert Anki study flashcard generator. Your sole job is to analyze note text and output flashcards strictly in the format: @flashcard (Question :: Answer).";
      const prompt = `Analyze the note body text below and generate 3 to 6 high-quality, concise study flashcards.

OUTPUT FORMAT REQUIREMENTS:
- Every line MUST follow this exact format:
  @flashcard (Question :: Answer)
- Do NOT output square brackets around questions or answers.
- Do NOT include markdown headers, code block fences (\`\`\`), or intro/outro conversational text.
- Clean up any raw WikiLink syntax (convert [[Term]] to Term).

FEW-SHOT EXAMPLES:

Example Input:
"Photosynthesis is a process used by plants to convert light energy into chemical energy stored in glucose."

Example Output:
@flashcard (What is photosynthesis? :: A process used by plants to convert light energy into chemical energy stored in glucose.)
@flashcard (What molecule stores the chemical energy produced in photosynthesis? :: Glucose.)

Now analyze this note body text:
"""
${noteBody}
"""`;

      const response = await aiService.generateText(prompt, systemPrompt);

      // Strip markdown code fences if outputted by local LLM
      const cleanResponse = (response || "")
        .replace(/```[a-z]*\r?\n?/gi, "")
        .replace(/```/g, "")
        .trim();

      const lines = cleanResponse.split("\n");
      const parsed: typeof generatedCards = [];
      
      // Primary: @flashcard (Q :: A) or @flashcard [Q :: A]
      const regexPrimary = /@flashcards?\s*[\(\[]([\s\S]*?)::([\s\S]*?)[\)\]]/i;
      // Fallback: (Q :: A) or [Q :: A] without @flashcard prefix
      const regexFallback = /[\(\[]([\s\S]*?)::([\s\S]*?)[\)\]]/i;

      lines.forEach((line) => {
        const match = regexPrimary.exec(line) || regexFallback.exec(line);
        if (match && match[1].trim() && match[2].trim()) {
          const front = match[1]
            .replace(/^-\s*/, "")
            .replace(/^\[+/, "")
            .replace(/\]+$/, "")
            .trim();
          const back = match[2]
            .replace(/^\[+/, "")
            .replace(/\]+$/, "")
            .trim();

          if (front && back) {
            parsed.push({
              id: Math.random().toString(),
              front,
              back,
              enabled: true,
            });
          }
        }
      });

      if (parsed.length === 0) {
        throw new Error("AI returned a response, but could not parse any valid flashcards in '@flashcard (Question :: Answer)' syntax. Try running generation again.");
      }

      setGeneratedCards(parsed);

      // Smoothly scroll down to the generated flashcards preview section
      setTimeout(() => {
        previewSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err: any) {
      console.error("AI Generation Error:", err);
      const reasonMsg = err?.message || (typeof err === "string" ? err : JSON.stringify(err)) || "An unexpected error occurred while communicating with the AI service.";
      setAiErrorModal({
        title: "AI Generation Failed",
        reason: reasonMsg,
      });
    } finally {
      setAiGenerating(false);
    }
  };

  // Execute save with chosen mode ("replace" or "append")
  const executeSaveGenerated = async (
    targetFile: FileEntry,
    cardsToSave: { front: string; back: string }[],
    mode: "replace" | "append"
  ) => {
    try {
      const success = await flashcardStore.replaceOrAppendFlashcardsInNote(
        targetFile.path,
        cardsToSave,
        mode
      );

      if (success) {
        setGeneratedCards([]);
        setSaveConflictModal(null);
        setAiSuccessMsg(
          `🎉 Successfully ${mode === "replace" ? "replaced and updated" : "appended"} ${
            cardsToSave.length
          } flashcards in "${targetFile.name}"!`
        );
        await syncDeck();
      }
    } catch (err: any) {
      console.error(err);
      alert(`Failed to save generated cards: ${err.message || err}`);
    }
  };

  // Add generated cards to note file
  const handleSaveGenerated = async () => {
    if (!targetAiFile || generatedCards.length === 0) return;
    const enabled = generatedCards.filter((c) => c.enabled);
    if (enabled.length === 0) return;

    try {
      const current = (await invokeIPC("read_note", {
        path: targetAiFile.path,
      })) as string;

      // Check if file already contains existing flashcards
      const existingCardsInNote = cards.filter((c) => c.filePath === targetAiFile.path);
      const hasCardSyntaxInText = /@flashcards?\s*\(/i.test(current || "");

      if (existingCardsInNote.length > 0 || hasCardSyntaxInText) {
        setSaveConflictModal({
          targetFile: targetAiFile,
          cardsToSave: enabled.map((c) => ({ front: c.front, back: c.back })),
          existingCount: existingCardsInNote.length || 1,
        });
        return;
      }

      await executeSaveGenerated(
        targetAiFile,
        enabled.map((c) => ({ front: c.front, back: c.back })),
        "append"
      );
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

  // Live save edited card back to source markdown file
  const handleSaveCardEdit = async () => {
    if (!editingCard || !editFront.trim() || !editBack.trim()) return;
    const success = await flashcardStore.updateFlashcardInNote(editingCard, editFront, editBack);
    if (success) {
      await syncDeck();
    }
    setEditingCard(null);
  };

  // Live delete flashcard line directly from source note
  const handleDeleteCardFromNote = async (card: Flashcard) => {
    if (!confirm(`Are you sure you want to delete this flashcard from "${card.filePath.split(/[/\\]/).pop()}"?`)) return;
    await flashcardStore.deleteFlashcardFromNote(card);
    const progressMap = await flashcardStore.loadProgress();
    delete progressMap[card.id];
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
        onClose={async () => { 
          setIsReviewing(false); 
          await syncDeck(); 
        }} 
      />
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-background text-slate-200 select-none animate-fade-in">
      {/* Title Toolbar */}
      <div className="flex h-12 items-center justify-between border-b border-card-border bg-sidebar px-4 shrink-0">
        <span className="text-xs font-bold text-amber-500 dark:text-amber-400 tracking-wider flex items-center gap-1.5">
          <GraduationCap className="h-4 w-4 text-amber-500 dark:text-amber-400" />
          SPACED REPETITION REVIEW
        </span>

        {/* Premium Tab Navigation */}
        <div className="flex bg-card p-0.5 rounded-lg border border-card-border shadow-xs text-[10px] font-bold">
          <button
            onClick={() => setActiveTab("overview")}
            className={`px-3 py-1 rounded flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "overview"
                ? "bg-indigo-600/20 text-indigo-500 dark:text-indigo-400 border border-indigo-500/30 font-extrabold"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <CalendarDays className="h-3 w-3" /> Dashboard
          </button>
          <button
            onClick={() => setActiveTab("ai-gen")}
            className={`px-3 py-1 rounded flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "ai-gen"
                ? "bg-indigo-600/20 text-indigo-500 dark:text-indigo-400 border border-indigo-500/30 font-extrabold"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
            }`}
          >
            <Sparkles className="h-3 w-3" /> AI Generator
          </button>
          <button
            onClick={() => setActiveTab("manager")}
            className={`px-3 py-1 rounded flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "manager"
                ? "bg-indigo-600/20 text-indigo-500 dark:text-indigo-400 border border-indigo-500/30 font-extrabold"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
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
                <div className="rounded-2xl border border-indigo-500/25 dark:border-indigo-500/20 bg-linear-to-br from-indigo-500/10 via-indigo-500/5 to-transparent dark:from-indigo-950/30 dark:via-indigo-900/15 dark:to-transparent p-6 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-sm dark:shadow-lg dark:shadow-indigo-950/10">
                  <div className="flex flex-col gap-1.5">
                    <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-400" /> Ready to Review
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed max-w-md">
                      Boost your retention using spatial intervals. There are {stats.due} flashcards waiting for you to review today.
                    </p>
                  </div>

                  <button
                    onClick={() => {
                      const today = new Date().toISOString().split("T")[0];
                      const due = cards.filter((card) => card.nextReviewDate <= today);
                      const toReview = due.length > 0 ? due : cards;
                      setReviewFilterCards(toReview);
                      setIsReviewing(true);
                    }}
                    disabled={cards.length === 0}
                    className="flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 font-bold text-xs text-white hover:bg-indigo-500 active:scale-95 disabled:opacity-40 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer shrink-0"
                  >
                    <Play className="h-4 w-4 text-white fill-white shrink-0" />
                    {stats.due > 0 ? `Review All Due (${stats.due})` : `Practice All Cards (${cards.length})`}
                  </button>
                </div>

                {/* Statistics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
                  <div className="rounded-xl border border-card-border bg-card p-3.5 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 ring-1 ring-indigo-500/20 shrink-0">
                      <BookOpen className="h-4.5 w-4.5" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Total</span>
                      <span className="text-base font-bold text-slate-800 dark:text-slate-200">{stats.total}</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-card-border bg-card p-3.5 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-400 ring-1 ring-amber-500/20 shrink-0">
                      <Calendar className="h-4.5 w-4.5" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Due Today</span>
                      <span className="text-base font-bold text-slate-800 dark:text-slate-200">{stats.due}</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-card-border bg-card p-3.5 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-pink-500/10 flex items-center justify-center text-pink-400 ring-1 ring-pink-500/20 shrink-0">
                      <Brain className="h-4.5 w-4.5" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Learning</span>
                      <span className="text-base font-bold text-slate-800 dark:text-slate-200">{stats.learning}</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-card-border bg-card p-3.5 flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 ring-1 ring-emerald-500/20 shrink-0">
                      <Award className="h-4.5 w-4.5" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Mastered</span>
                      <span className="text-base font-bold text-slate-800 dark:text-slate-200">{stats.mastered}</span>
                    </div>
                  </div>

                  <div className="rounded-xl border border-card-border bg-card p-3.5 flex items-center gap-3 col-span-2 md:col-span-1">
                    <div className="h-9 w-9 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400 ring-1 ring-cyan-500/20 shrink-0">
                      <TrendingUp className="h-4.5 w-4.5" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Retention</span>
                      <span className="text-base font-bold text-slate-800 dark:text-slate-200">{forecastStats.retentionRate}%</span>
                    </div>
                  </div>
                </div>

                {/* Review Forecast Banner */}
                <div className="rounded-xl border border-card-border bg-card p-3.5 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400 font-medium">
                    <BarChart3 className="h-4 w-4 text-indigo-500 dark:text-indigo-400 shrink-0" />
                    <span className="font-bold text-slate-800 dark:text-slate-200">Upcoming Forecast:</span>
                  </span>

                  <div className="flex items-center gap-4 text-[11px] font-semibold">
                    <span className="flex items-center gap-1.5 text-slate-400">
                      Tomorrow: <span className="text-indigo-400 font-bold">{forecastStats.dueTomorrow}</span>
                    </span>
                    <span className="text-slate-700">•</span>
                    <span className="flex items-center gap-1.5 text-slate-400">
                      Next 7 Days: <span className="text-cyan-400 font-bold">{forecastStats.dueIn7Days}</span>
                    </span>
                  </div>
                </div>

                {/* Enhanced Heatmap & Vault Activity Section */}
                <div className="rounded-xl border border-card-border bg-card p-5 flex flex-col gap-4 shadow-xs overflow-visible relative">
                  {/* Header & Badges */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-card-border/60">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                        <Activity className="h-4 w-4" />
                      </div>
                      <div>
                        <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200 tracking-wider uppercase">
                          Study & Vault Activity
                        </h3>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                          Consistency tracking across flashcards, notes & tasks (Last 12 Weeks)
                        </p>
                      </div>
                    </div>

                    {/* Streak Metrics Pills */}
                    <div className="flex items-center gap-2 flex-wrap text-[11px]">
                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/25 text-amber-700 dark:text-amber-300 font-bold shadow-2xs">
                        <Flame className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400 animate-pulse" />
                        <span>Streak:</span>
                        <span className="text-amber-800 dark:text-amber-200 font-extrabold">{streakStats.currentStreak} {streakStats.currentStreak === 1 ? "day" : "days"}</span>
                      </div>

                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/25 text-indigo-700 dark:text-indigo-300 font-bold shadow-2xs">
                        <Zap className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
                        <span>Best:</span>
                        <span className="text-indigo-900 dark:text-indigo-200 font-extrabold">{streakStats.longestStreak} days</span>
                      </div>

                      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700/60 text-slate-600 dark:text-slate-300 font-medium">
                        <CalendarDays className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                        <span>Active:</span>
                        <span className="text-slate-900 dark:text-slate-100 font-bold">{streakStats.activeDaysCount}/84 days</span>
                      </div>
                    </div>
                  </div>

                  {/* Heatmap Grid with Month & Day Headers */}
                  <div className="flex flex-col gap-1.5 w-full py-2 scrollbar-none overflow-visible">
                    {/* Month Labels Header Row aligned via 12-col grid */}
                    <div className="grid grid-cols-12 gap-1.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400 pl-8 w-full">
                      {monthsHeader.map((m, idx) => (
                        <div
                          key={idx}
                          style={{ gridColumn: `span ${m.spanWeeks}` }}
                          className="truncate text-left font-bold text-indigo-600 dark:text-indigo-400/90"
                        >
                          {m.name}
                        </div>
                      ))}
                    </div>

                    {/* Grid Container with Day-of-Week Y-Axis */}
                    <div className="flex items-center gap-2 w-full overflow-visible">
                      {/* Day Labels Y-Axis */}
                      <div className="flex flex-col justify-between text-[9px] font-bold text-slate-500 dark:text-slate-400 py-0.5 h-25.5 w-6 shrink-0 select-none">
                        <span>Sun</span>
                        <span>Tue</span>
                        <span>Thu</span>
                        <span>Sat</span>
                      </div>

                      {/* 12-Column Grid filling full card width */}
                      <div className="grid grid-cols-12 gap-1.5 flex-1 select-none overflow-visible">
                        {Array.from({ length: 12 }).map((_, weekIdx) => {
                          const horizPosClass =
                            weekIdx >= 9
                              ? "right-0 left-auto translate-x-0"
                              : weekIdx <= 2
                              ? "left-0 translate-x-0"
                              : "left-1/2 -translate-x-1/2";

                          return (
                            <div key={weekIdx} className="flex flex-col gap-0.75 relative hover:z-50 focus-within:z-50 overflow-visible">
                              {Array.from({ length: 7 }).map((_, dayIdx) => {
                                const cellIndex = weekIdx * 7 + dayIdx;
                                const cell = heatmapCells[cellIndex];
                                if (!cell) return null;

                                const vertPosClass = dayIdx <= 3 ? "top-full mt-2" : "bottom-full mb-2";

                                return (
                                  <div
                                    key={cellIndex}
                                    className={`group relative h-3.5 w-full rounded-[3px] border overflow-visible transition-colors duration-150 cursor-pointer hover:brightness-110 hover:border-slate-400 dark:hover:border-slate-500 hover:z-50 focus-within:z-50 ${
                                      cell.isToday
                                        ? "ring-2 ring-amber-400 dark:ring-amber-400 ring-offset-1 ring-offset-white dark:ring-offset-slate-950 z-20"
                                        : "z-1"
                                    } ${cell.total === 0 ? "bg-slate-100 dark:bg-slate-800/50 border-slate-200/80 dark:border-slate-700/60" : "bg-slate-900/30 border-slate-300 dark:border-slate-700"}`}
                                  >
                                    {/* Stacked Horizontal Graph Bar Inside Pill */}
                                    {cell.total > 0 && (
                                      <div className="flex h-full w-full rounded-xs overflow-hidden">
                                        {cell.flashcards > 0 && (
                                          <div
                                            style={{ width: `${(cell.flashcards / cell.total) * 100}%` }}
                                            className="h-full bg-amber-400 dark:bg-amber-400 border-r border-black/20 dark:border-black/40 last:border-r-0 transition-all"
                                            title={`Flashcards: ${cell.flashcards}`}
                                          />
                                        )}
                                        {cell.noteEdits > 0 && (
                                          <div
                                            style={{ width: `${(cell.noteEdits / cell.total) * 100}%` }}
                                            className="h-full bg-violet-500 dark:bg-violet-400 border-r border-black/20 dark:border-black/40 last:border-r-0 transition-all"
                                            title={`Notes: ${cell.noteEdits}`}
                                          />
                                        )}
                                        {cell.tasksCompleted > 0 && (
                                          <div
                                            style={{ width: `${(cell.tasksCompleted / cell.total) * 100}%` }}
                                            className="h-full bg-teal-400 dark:bg-teal-400 border-r border-black/20 dark:border-black/40 last:border-r-0 transition-all"
                                            title={`Tasks: ${cell.tasksCompleted}`}
                                          />
                                        )}
                                        {cell.boardDone > 0 && (
                                          <div
                                            style={{ width: `${(cell.boardDone / cell.total) * 100}%` }}
                                            className="h-full bg-orange-400 dark:bg-orange-400 border-r border-black/20 dark:border-black/40 last:border-r-0 transition-all"
                                            title={`Board Done: ${cell.boardDone}`}
                                          />
                                        )}
                                      </div>
                                    )}

                                    {/* 2D Edge-Aware Tooltip on Hover */}
                                    <div className={`pointer-events-none absolute ${vertPosClass} ${horizPosClass} opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-40 whitespace-nowrap rounded-lg bg-slate-900 border border-slate-700/90 px-3 py-2 text-[10px] shadow-2xl text-slate-100`}>
                                      <div className="font-bold text-indigo-300 border-b border-slate-800 pb-1 mb-1.5 flex items-center justify-between gap-3">
                                        <span>{cell.formattedDate}</span>
                                        {cell.isToday && (
                                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase font-black tracking-wider">Today</span>
                                        )}
                                      </div>
                                      {cell.total > 0 ? (
                                        <div className="flex flex-col gap-1 text-[10px]">
                                          {cell.flashcards > 0 && (
                                            <div className="flex items-center gap-2">
                                              <div className="h-2 w-2 rounded-xs bg-amber-400 shrink-0" />
                                              <span className="text-slate-300 font-medium">{cell.flashcards} Flashcards reviewed</span>
                                            </div>
                                          )}
                                          {cell.noteEdits > 0 && (
                                            <div className="flex items-center gap-2">
                                              <div className="h-2 w-2 rounded-xs bg-violet-400 shrink-0" />
                                              <span className="text-slate-300 font-medium">{cell.noteEdits} Notes updated</span>
                                            </div>
                                          )}
                                          {cell.tasksCompleted > 0 && (
                                            <div className="flex items-center gap-2">
                                              <div className="h-2 w-2 rounded-xs bg-teal-400 shrink-0" />
                                              <span className="text-slate-300 font-medium">{cell.tasksCompleted} Tasks completed</span>
                                            </div>
                                          )}
                                          {cell.boardDone > 0 && (
                                            <div className="flex items-center gap-2">
                                              <div className="h-2 w-2 rounded-xs bg-orange-400 shrink-0" />
                                              <span className="text-slate-300 font-medium">{cell.boardDone} Board items Done</span>
                                            </div>
                                          )}
                                          <div className="border-t border-slate-800 pt-1 mt-0.5 text-slate-400 font-semibold text-[9px] flex justify-between gap-4">
                                            <span>Total Interactions:</span>
                                            <span className="text-white font-bold">{cell.total}</span>
                                          </div>
                                        </div>
                                      ) : (
                                        <span className="text-slate-400 italic">No activity recorded</span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Heatmap Legend & Summary Footnote */}
                  <div className="flex items-center justify-between pt-1 border-t border-card-border/40 text-[9px] text-slate-500 dark:text-slate-400 font-medium px-1">
                    <span>Total 12-week activity: <strong className="text-indigo-600 dark:text-indigo-400 font-bold">{streakStats.totalActivityCount} interactions</strong></span>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5">
                        <div className="h-2 w-2 rounded-xs bg-amber-400 shrink-0" />
                        <span className="text-slate-600 dark:text-slate-300 font-semibold">Flashcards</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="h-2 w-2 rounded-xs bg-violet-400 shrink-0" />
                        <span className="text-slate-600 dark:text-slate-300 font-semibold">Notes</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="h-2 w-2 rounded-xs bg-teal-400 shrink-0" />
                        <span className="text-slate-600 dark:text-slate-300 font-semibold">Tasks</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <div className="h-2 w-2 rounded-xs bg-orange-400 shrink-0" />
                        <span className="text-slate-600 dark:text-slate-300 font-semibold">Kanban Done</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Decks Category Grid */}
                <div className="flex flex-col gap-3 mt-1">
                  <div className="flex items-center justify-between border-b border-card-border pb-2">
                    <h3 className="text-xs font-bold text-slate-400 tracking-wider uppercase">
                      STUDY DECKS ({decks.length})
                    </h3>
                    
                    {/* Toggle Grouping (Folders | Tags | Notes | Deadlines) */}
                    <div className="flex bg-card p-0.5 rounded-lg border border-card-border shadow-xs text-[9px] font-bold">
                      <button
                        onClick={() => setDeckGrouping("folder")}
                        className={`px-2.5 py-1 rounded flex items-center gap-1 cursor-pointer transition-colors ${
                          deckGrouping === "folder" ? "bg-indigo-600/20 text-indigo-500 dark:text-indigo-400 border border-indigo-500/30 font-extrabold" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                        }`}
                      >
                        <FolderOpen className="h-2.5 w-2.5" /> Folders
                      </button>
                      <button
                        onClick={() => setDeckGrouping("tag")}
                        className={`px-2.5 py-1 rounded flex items-center gap-1 cursor-pointer transition-colors ${
                          deckGrouping === "tag" ? "bg-indigo-600/20 text-indigo-500 dark:text-indigo-400 border border-indigo-500/30 font-extrabold" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                        }`}
                      >
                        <Tag className="h-2.5 w-2.5" /> Tags
                      </button>
                      <button
                        onClick={() => setDeckGrouping("note")}
                        className={`px-2.5 py-1 rounded flex items-center gap-1 cursor-pointer transition-colors ${
                          deckGrouping === "note" ? "bg-indigo-600/20 text-indigo-500 dark:text-indigo-400 border border-indigo-500/30 font-extrabold" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                        }`}
                      >
                        <FileText className="h-2.5 w-2.5" /> Notes
                      </button>
                      <button
                        onClick={() => setDeckGrouping("deadline")}
                        className={`px-2.5 py-1 rounded flex items-center gap-1 cursor-pointer transition-colors ${
                          deckGrouping === "deadline" ? "bg-amber-600/20 text-amber-500 dark:text-amber-400 border border-amber-500/30 font-extrabold" : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200"
                        }`}
                      >
                        <Clock className="h-2.5 w-2.5 text-amber-500 dark:text-amber-400" /> Deadlines
                      </button>
                    </div>
                  </div>

                  {decks.length === 0 ? (
                    <div className="rounded-xl border border-card-border bg-card p-10 text-center text-slate-500 text-xs">
                      No flashcards found. Create inline or block flashcards with the <code className="text-indigo-400">@flashcard (Question::Answer)</code> syntax.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {decks.map((deck) => (
                        <div 
                          key={deck.name} 
                          onClick={() => startReviewSession(deck.cards)}
                          className="rounded-xl border border-card-border bg-card p-4 flex items-center justify-between hover:border-indigo-500/40 hover:bg-card-hover transition-all group cursor-pointer"
                        >
                          <div className="flex flex-col gap-1.5 truncate pr-4">
                            <span className="text-xs font-bold text-foreground flex items-center gap-1.5 truncate">
                              {deckGrouping === "folder" ? (
                                <FolderOpen className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400 shrink-0" />
                              ) : deckGrouping === "note" ? (
                                <FileText className="h-3.5 w-3.5 text-cyan-500 dark:text-cyan-400 shrink-0" />
                              ) : deckGrouping === "deadline" ? (
                                <Target className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400 shrink-0" />
                              ) : (
                                <Tag className="h-3.5 w-3.5 text-pink-500 dark:text-pink-400 shrink-0" />
                              )}
                              {deck.name}
                            </span>
                            <div className="flex items-center gap-2 text-[10px] text-slate-500 font-medium">
                              <span>{deck.total} cards</span>
                              <span className="h-1 w-1 rounded-full bg-slate-400" />
                              <span className={deck.due > 0 ? "text-amber-500 dark:text-amber-400 font-semibold" : "text-emerald-500 dark:text-emerald-400 font-semibold"}>
                                {deck.due > 0 ? `${deck.due} due` : "Completed"}
                              </span>
                            </div>
                          </div>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startReviewSession(deck.cards);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600/20 text-indigo-500 dark:text-indigo-400 hover:bg-indigo-600 hover:text-white active:scale-95 transition-all cursor-pointer shrink-0"
                            title={deck.due > 0 ? `Review ${deck.due} due cards in ${deck.name}` : `Practice all ${deck.total} cards in ${deck.name}`}
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
                <div className="rounded-xl border border-card-border bg-card p-5 flex flex-col gap-4">
                  <div className="flex items-start justify-between">
                    <div className="flex flex-col gap-1">
                      <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                        <Sparkles className="h-4.5 w-4.5 text-indigo-400" />
                        AI Spaced Repetition Generator
                      </h3>
                      <p className="text-xs text-slate-400 leading-relaxed max-w-lg">
                        Instantly compile note contents into clean flashcards. Open a note in the editor, and click below to review suggestions.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3.5 rounded-xl bg-background border border-slate-800 p-4 text-xs text-slate-400">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <FileText className="h-4 w-4 text-indigo-400 shrink-0" />
                        <span className="text-slate-400 font-semibold shrink-0">Primary Target Note:</span>
                        <select
                          value={targetAiFile?.path || ""}
                          onChange={(e) => {
                            const found = allNoteFiles.find((f) => f.path === e.target.value);
                            if (found) setAiSelectedFile(found);
                          }}
                          className="flex-1 min-w-0 bg-card border border-slate-800 rounded-lg px-3 py-2 font-bold text-slate-200 focus:outline-none focus:border-indigo-500/50 cursor-pointer truncate max-w-md"
                        >
                          {allNoteFiles.map((f) => {
                            const meta = flashcardStore.noteMetaMap.get(f.path) || {};
                            const dueText = meta.dueDate ? ` [🎯 Due: ${formatUserFriendlyDate(meta.dueDate)}]` : "";
                            const prioText = meta.priority ? ` [⚡ ${meta.priority.toUpperCase()}]` : "";
                            return (
                              <option key={f.path} value={f.path}>
                                {f.name}{dueText}{prioText} {activeFile?.path === f.path ? "★ (Active)" : ""}
                              </option>
                            );
                          })}
                        </select>
                      </div>

                      <button
                        onClick={handleAiGenerate}
                        disabled={!targetAiFile || aiGenerating}
                        className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 font-bold text-xs text-white hover:bg-indigo-500 disabled:opacity-40 transition-all active:scale-95 shadow-md shadow-indigo-600/30 cursor-pointer shrink-0 w-44 min-w-44"
                      >
                        {aiGenerating ? (
                          <>
                            <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
                            <span>Generating Cards...</span>
                          </>
                        ) : (
                          <>
                            <Zap className="h-3.5 w-3.5 shrink-0" />
                            <span>Generate Cards</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Multi-note Include / Exclude Checkboxes with Clean 3-Option Control Bar */}
                    <div className="flex flex-col gap-2.5 pt-3.5 border-t border-slate-800/80">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5 shrink-0">
                          <SlidersHorizontal className="h-3.5 w-3.5 text-indigo-400" /> Select Notes ({selectedAiNotes.length} / {allNoteFiles.length} selected)
                        </span>

                        {/* Note Search Filter */}
                        <div className="relative flex-1 sm:max-w-xs">
                          <Search className="absolute left-2.5 top-2 h-3 w-3 text-slate-500" />
                          <input
                            type="text"
                            value={aiNoteSearch}
                            onChange={(e) => setAiNoteSearch(e.target.value)}
                            placeholder="Search notes..."
                            className="w-full rounded-md bg-card border border-slate-800 pl-8 pr-2.5 py-1 text-[11px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50"
                          />
                        </div>
                      </div>

                      {/* Clean 3-Option Control Toolbar: Filter | Select All | Clear All */}
                      <div className="flex items-center justify-between gap-3 text-[11px] bg-card/70 p-2 px-3 rounded-lg border border-slate-800/80">
                        {/* Option 1: Filter Dropdown (contains all note filter categories) */}
                        <div className="flex items-center gap-2">
                          <Filter className="h-3.5 w-3.5 text-indigo-400 shrink-0" />
                          <span className="text-slate-400 font-semibold shrink-0">Filter:</span>
                          <select
                            value={aiFilterCategory}
                            onChange={(e) => setAiFilterCategory(e.target.value as any)}
                            className="bg-background border border-slate-800 rounded-md px-2.5 py-1 text-xs font-bold text-slate-200 focus:outline-none focus:border-indigo-500/50 cursor-pointer"
                          >
                            <option value="all">📁 All Notes ({allNoteFiles.length})</option>
                            <option value="due">🎯 Notes with Due Dates</option>
                            <option value="high">⚡ High Priority Notes</option>
                            <option value="medium">⚡ Medium Priority Notes</option>
                            <option value="low">⚡ Low Priority Notes</option>
                          </select>
                        </div>

                        {/* Option 2 & 3: Select All (matches filter) & Clear All */}
                        <div className="flex items-center gap-3 font-bold text-xs">
                          <button
                            onClick={() => {
                              const visiblePaths = filteredNoteFiles.map((f) => f.path);
                              setSelectedAiNotes((prev) => Array.from(new Set([...prev, ...visiblePaths])));
                            }}
                            className="text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer"
                            title="Select all notes currently shown after applying the filter and search"
                          >
                            Select All
                          </button>
                          <span className="text-slate-700">•</span>
                          <button
                            onClick={() => setSelectedAiNotes([])}
                            className="text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
                            title="Clear selection"
                          >
                            Clear All
                          </button>
                        </div>
                      </div>

                      {/* 2-Column Responsive Grid with App-based Dynamic Height */}
                      <div className="max-h-[35vh] sm:max-h-[42vh] overflow-y-auto rounded-xl bg-card border border-slate-800/80 p-2.5 grid grid-cols-1 md:grid-cols-2 gap-2 text-slate-300">
                        {filteredNoteFiles.map((f) => {
                            const isChecked = selectedAiNotes.includes(f.path) || targetAiFile?.path === f.path;
                            const meta = flashcardStore.noteMetaMap.get(f.path) || {};
                            return (
                              <label
                                key={f.path}
                                className={`flex items-center justify-between gap-2 p-2 rounded-lg border transition-all cursor-pointer text-[11px] ${
                                  isChecked
                                    ? "bg-indigo-950/20 border-indigo-500/30 text-slate-200"
                                    : "bg-background/40 border-slate-800/60 hover:bg-background/80 text-slate-400"
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedAiNotes((prev) => [...prev, f.path]);
                                      } else {
                                        setSelectedAiNotes((prev) => prev.filter((p) => p !== f.path));
                                      }
                                    }}
                                    className="h-3.5 w-3.5 rounded border-slate-700 bg-background text-indigo-600 focus:ring-indigo-600 cursor-pointer shrink-0"
                                  />
                                  <span className="truncate font-semibold text-slate-200">{f.name}</span>
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  {meta.dueDate && (
                                    <span
                                      className="text-[9px] font-bold text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20 flex items-center gap-1"
                                      title={`Target Due Date: ${formatUserFriendlyDate(meta.dueDate)}`}
                                    >
                                      <Target className="h-2.5 w-2.5" />
                                      {formatUserFriendlyDate(meta.dueDate)}
                                    </span>
                                  )}
                                  {meta.priority && (
                                    <span
                                      className={`text-[8px] font-extrabold px-1.5 py-0.5 rounded border uppercase ${
                                        meta.priority === "high"
                                          ? "text-rose-400 bg-rose-500/10 border-rose-500/30"
                                          : meta.priority === "medium"
                                          ? "text-amber-400 bg-amber-500/10 border-amber-500/30"
                                          : "text-cyan-400 bg-cyan-500/10 border-cyan-500/30"
                                      }`}
                                      title={`Priority: ${meta.priority}`}
                                    >
                                      {meta.priority}
                                    </span>
                                  )}
                                </div>
                              </label>
                            );
                          })}
                      </div>
                    </div>
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
                  <div ref={previewSectionRef} className="flex flex-col gap-3 animate-slide-up pt-4">
                    <div className="flex items-center justify-between border-b border-card-border pb-2">
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
                        <div key={card.id} className="rounded-xl border border-card-border bg-card p-4 flex gap-3.5 items-start">
                          <input
                            type="checkbox"
                            checked={card.enabled}
                            onChange={(e) => {
                              const updated = [...generatedCards];
                              updated[idx].enabled = e.target.checked;
                              setGeneratedCards(updated);
                            }}
                            className="h-4 w-4 mt-2 rounded border-card-border bg-background text-indigo-600 focus:ring-indigo-600 focus:ring-offset-card"
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
                                className="w-full rounded bg-background border border-slate-800 px-2.5 py-1.5 focus:outline-none focus:border-indigo-500/50 resize-y text-slate-300 font-medium"
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
                                className="w-full rounded bg-background border border-slate-800 px-2.5 py-1.5 focus:outline-none focus:border-indigo-500/50 resize-y text-slate-300 font-medium"
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
                <div className="rounded-xl border border-card-border bg-card p-4 flex flex-col sm:flex-row gap-3 items-center justify-between">
                  <div className="relative w-full sm:max-w-xs">
                    <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
                    <input
                      type="text"
                      value={managerSearch}
                      onChange={(e) => setManagerSearch(e.target.value)}
                      placeholder="Search card content..."
                      className="w-full rounded-lg bg-background border border-slate-800 pl-9 pr-3 py-2 text-xs focus:outline-none focus:border-indigo-500/50 placeholder:text-slate-500"
                    />
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <SlidersHorizontal className="h-3.5 w-3.5 text-slate-500" />
                    <select
                      value={managerDeckFilter}
                      onChange={(e) => setManagerDeckFilter(e.target.value)}
                      className="rounded-lg bg-background border border-slate-800 px-3 py-2 text-xs focus:outline-none focus:border-indigo-500/50 font-semibold"
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
                    <div className="rounded-xl border border-card-border bg-card p-10 text-center text-slate-500 text-xs">
                      No matching cards found.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {filteredManagerCards.map((card) => (
                        <div 
                          key={card.id} 
                          className="rounded-xl border border-card-border bg-card p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs hover:border-slate-800 transition-all"
                        >
                          <div className="flex-1 flex flex-col gap-1.5 truncate">
                            <span className="font-semibold text-slate-200 whitespace-normal leading-relaxed">
                              {card.front}
                            </span>
                            <span className="text-[10px] text-slate-500 whitespace-normal leading-relaxed">
                              Answer: {card.back}
                            </span>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[9px] font-bold text-slate-500">
                              <span className="flex items-center gap-1 bg-background px-2 py-0.5 rounded border border-slate-800/50">
                                <FileText className="h-2.5 w-2.5" />
                                {card.filePath.split(/[/\\]/).pop()}
                              </span>
                              <span className="bg-indigo-950/20 text-indigo-400 px-2 py-0.5 rounded border border-indigo-950/40">
                                Reps: {card.repetition}
                              </span>
                              <span className="bg-emerald-950/20 text-emerald-400 px-2 py-0.5 rounded border border-emerald-950/40">
                                Due: {card.nextReviewDate}
                              </span>
                              {card.noteDueDate && (
                                <span className="flex items-center gap-1 bg-amber-950/20 text-amber-400 px-2 py-0.5 rounded border border-amber-950/40" title={`Source note target deadline: ${card.noteDueDate}`}>
                                  <Target className="h-2.5 w-2.5" />
                                  Note Target: {card.noteDueDate}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                            <button
                              onClick={() => {
                                setEditingCard(card);
                                setEditFront(card.front);
                                setEditBack(card.back);
                              }}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 text-[10px] font-bold text-indigo-300 hover:bg-indigo-500/20 active:scale-95 transition-all cursor-pointer"
                              title="Edit flashcard in note"
                            >
                              <Edit3 className="h-3 w-3" />
                              <span>Edit</span>
                            </button>
                            <button
                              onClick={() => {
                                const file = files.find((f) => f.path === card.filePath);
                                if (file) {
                                  openFile(file);
                                  setActiveView("editor");
                                }
                              }}
                              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-800 bg-background text-[10px] font-bold text-slate-400 hover:text-slate-200 active:scale-95 transition-all cursor-pointer"
                              title="Open source note in Editor"
                            >
                              <FileText className="h-3 w-3" />
                              <span>Open Note</span>
                            </button>
                            <button
                              onClick={() => handleResetCard(card.id)}
                              className="px-2 py-1.5 rounded-lg border border-slate-800 bg-background text-[10px] font-bold text-slate-400 hover:text-slate-200 active:scale-95 transition-all cursor-pointer"
                              title="Reset Spaced Repetition Schedule"
                            >
                              Reset
                            </button>
                            <button
                              onClick={() => handleDeleteCardFromNote(card)}
                              className="p-1.5 rounded-lg border border-red-950/40 bg-red-950/10 text-red-400 hover:bg-red-500 hover:text-white active:scale-95 transition-all cursor-pointer"
                              title="Delete flashcard line from note"
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

      {/* Edit Card Modal Overlay */}
      {editingCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-fade-in">
          <div className="w-full max-w-md rounded-2xl border border-card-border bg-card p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-card-border pb-3">
              <span className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <Edit3 className="h-4 w-4 text-indigo-400" />
                Edit Flashcard (Live Sync to Note)
              </span>
              <button
                onClick={() => setEditingCard(null)}
                className="text-slate-500 hover:text-slate-300 p-1 rounded-md transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-3 text-xs">
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Question (Front)</span>
                <textarea
                  value={editFront}
                  onChange={(e) => setEditFront(e.target.value)}
                  className="w-full rounded-xl bg-background border border-slate-800 p-3 text-slate-200 text-xs focus:outline-none focus:border-indigo-500/50 resize-y font-medium min-h-17.5"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Answer (Back)</span>
                <textarea
                  value={editBack}
                  onChange={(e) => setEditBack(e.target.value)}
                  className="w-full rounded-xl bg-background border border-slate-800 p-3 text-slate-200 text-xs focus:outline-none focus:border-indigo-500/50 resize-y font-medium min-h-17.5"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-card-border">
              <button
                onClick={() => setEditingCard(null)}
                className="px-4 py-2 rounded-lg border border-slate-800 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCardEdit}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-md shadow-indigo-600/30 transition-all cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" /> Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save Conflict Modal (Replace vs Append) */}
      {saveConflictModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-fade-in">
          <div className="w-full max-w-md rounded-2xl border border-card-border bg-card p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-card-border pb-3">
              <span className="text-xs font-bold text-amber-400 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                Flashcard Save Action Required
              </span>
              <button
                onClick={() => setSaveConflictModal(null)}
                className="text-slate-500 hover:text-slate-300 p-1 rounded-md transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-2 text-xs text-slate-300 leading-relaxed">
              <p>
                Target note <strong className="text-indigo-400">"{saveConflictModal.targetFile.name}"</strong> already has existing flashcards.
              </p>
              <p className="text-[11px] text-slate-400">
                How would you like to handle saving the <strong className="text-slate-200">{saveConflictModal.cardsToSave.length} new AI flashcard(s)</strong>?
              </p>
            </div>

            <div className="flex flex-col gap-2 pt-2 border-t border-card-border">
              <button
                onClick={() =>
                  executeSaveGenerated(
                    saveConflictModal.targetFile,
                    saveConflictModal.cardsToSave,
                    "replace"
                  )
                }
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/30 text-xs font-bold transition-all cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Replace Existing Cards in Note
              </button>

              <button
                onClick={() =>
                  executeSaveGenerated(
                    saveConflictModal.targetFile,
                    saveConflictModal.cardsToSave,
                    "append"
                  )
                }
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all cursor-pointer"
              >
                <Check className="h-3.5 w-3.5" /> Append New Cards to Note Normally
              </button>

              <button
                onClick={() => setSaveConflictModal(null)}
                className="px-4 py-1.5 text-center text-[11px] font-semibold text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Generation Error Popup Modal */}
      {aiErrorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-fade-in">
          <div className="w-full max-w-md rounded-2xl border border-rose-500/30 bg-[#0f111a] p-6 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="text-xs font-bold text-rose-400 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                {aiErrorModal.title}
              </span>
              <button
                onClick={() => setAiErrorModal(null)}
                className="text-slate-500 hover:text-slate-300 p-1 rounded-md transition-colors cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex flex-col gap-2 text-xs text-slate-300 leading-relaxed">
              <p className="font-semibold text-slate-400">
                The AI generator encountered an issue creating cards:
              </p>
              <div className="rounded-xl bg-rose-950/30 border border-rose-500/25 p-3 text-rose-200 font-mono text-[11px] break-all leading-normal max-h-48 overflow-y-auto">
                {aiErrorModal.reason}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-800/80">
              <button
                onClick={() => setAiErrorModal(null)}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all cursor-pointer"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
