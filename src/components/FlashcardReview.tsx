import React, { useState, useEffect, useRef } from "react";
import { isModKey } from "../lib/keyboard-utils";
import { Flashcard } from "../lib/flashcard-parser";
import { computeFSRS } from "../lib/fsrs";
import { flashcardStore } from "../lib/flashcard-store";
import { ArrowLeft, CheckCircle2, RotateCw, Volume2, Undo2, Edit3, Trash2, Check, X, Target } from "lucide-react";
import confetti from "canvas-confetti";

interface FlashcardReviewProps {
  cards: Flashcard[];
  onClose: () => void;
}

export const FlashcardReview: React.FC<FlashcardReviewProps> = ({ cards, onClose }) => {
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

  if (sessionCards.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center bg-background text-slate-500 gap-4">
        <span>No cards due for review!</span>
        <button
          onClick={onClose}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2 font-semibold text-xs text-white hover:bg-indigo-500"
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
          onClick={onClose}
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
              onClick={onClose}
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
