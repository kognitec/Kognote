import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import {
  Sparkles,
  Wand2,
  HelpCircle,
  FileText,
  CheckCircle2,
  Copy,
  Replace,
  CornerDownLeft,
  X,
  Loader2,
  Send,
  Maximize2,
  Minimize2,
  GraduationCap,
  CheckSquare,
  ChevronDown,
  RotateCcw,
  Split,
  Palette
} from "lucide-react";

export interface FloatingAiCoords {
  x: number;
  y: number;
  selectionTop?: number;
  selectionBottom?: number;
  selectionLeft?: number;
  selectionRight?: number;
  containerRect?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
    width: number;
    height: number;
  };
}

export interface FloatingAiSelection {
  text: string;
  coords: FloatingAiCoords;
}

export interface FloatingAiResult {
  originalText: string;
  aiResultText: string;
  actionType: string;
  coords: FloatingAiCoords;
}

interface FloatingAiToolbarProps {
  selection: FloatingAiSelection | null;
  result: FloatingAiResult | null;
  onExecuteAi: (
    action: "rewrite" | "explain" | "summarize" | "fix" | "expand" | "shorten" | "flashcard" | "tasks" | "tone" | "custom",
    customInstruction?: string
  ) => Promise<void>;
  onReplaceSelection: (newText: string) => void;
  onInsertBelow: (newText: string) => void;
  onClose: () => void;
  isAiLoading: boolean;
}

export const FloatingAiToolbar: React.FC<FloatingAiToolbarProps> = ({
  selection,
  result,
  onExecuteAi,
  onReplaceSelection,
  onInsertBelow,
  onClose,
  isAiLoading
}) => {
  const [customPrompt, setCustomPrompt] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showToneMenu, setShowToneMenu] = useState(false);
  const [showDiffView, setShowDiffView] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastAction, setLastAction] = useState<{ action: any; instruction?: string } | null>(null);

  // Dynamic measurement of rendered toolbar/card dimensions
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 440, height: 44 });

  const customInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (toolbarRef.current) {
      const rect = toolbarRef.current.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setDimensions({ width: rect.width, height: rect.height });
      }
    }
  }, [selection, result, showCustomInput, showMoreMenu, showToneMenu, showDiffView, isAiLoading]);

  useEffect(() => {
    if (showCustomInput && customInputRef.current) {
      customInputRef.current.focus();
    }
  }, [showCustomInput]);

  // Pressing Escape closes the toolbar and resets sub-states
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowCustomInput(false);
        setShowMoreMenu(false);
        setShowToneMenu(false);
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (!selection && !result) return null;

  // Active Coordinates & Container Boundary Resolution
  const activeCoords: FloatingAiCoords = selection?.coords || result?.coords || { x: 100, y: 100 };

  const containerRect = activeCoords.containerRect || {
    top: 70,
    bottom: window.innerHeight - 16,
    left: 16,
    right: window.innerWidth - 16,
    width: window.innerWidth - 32,
    height: window.innerHeight - 86
  };

  // Safe boundary limits for active note area & viewport
  const minTop = Math.max(containerRect.top + 8, 70);
  const maxBottom = Math.min(containerRect.bottom - 8, window.innerHeight - 16);
  const minLeft = Math.max(containerRect.left + 16, 16);
  const maxRight = Math.min(containerRect.right - 16, window.innerWidth - 16);

  const selTop = activeCoords.selectionTop ?? activeCoords.y;
  const selBottom = activeCoords.selectionBottom ?? (activeCoords.y + 24);
  const selCenterX = activeCoords.x;

  const gap = 10;
  const elementHeight = dimensions.height || (result ? 320 : 44);
  const elementWidth = dimensions.width || (result ? 420 : 440);

  // Smart Placement: Default to ABOVE text selection (0% text blockage).
  // If top boundary space is tight, flip BELOW text selection.
  const spaceAbove = selTop - minTop;
  const spaceBelow = maxBottom - selBottom;

  let finalY = selTop - elementHeight - gap;

  if (spaceAbove < elementHeight + gap) {
    if (spaceBelow >= elementHeight + gap) {
      finalY = selBottom + gap;
    } else {
      // Clamped within container boundaries if room on both sides is tight
      finalY = Math.max(minTop, Math.min(maxBottom - elementHeight, selTop - elementHeight - gap));
    }
  }

  // Horizontal Centering + Active Note Boundary Clamping
  let finalX = selCenterX - elementWidth / 2;
  finalX = Math.max(minLeft, Math.min(maxRight - elementWidth, finalX));

  const clampedX = Math.round(finalX);
  const clampedY = Math.round(finalY);

  const handleRunAction = (
    action: "rewrite" | "explain" | "summarize" | "fix" | "expand" | "shorten" | "flashcard" | "tasks" | "tone" | "custom",
    customInstruction?: string
  ) => {
    setLastAction({ action, instruction: customInstruction });
    setShowMoreMenu(false);
    setShowToneMenu(false);
    onExecuteAi(action, customInstruction);
  };

  const handleCopy = async () => {
    if (!result?.aiResultText) return;
    try {
      await navigator.clipboard.writeText(result.aiResultText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customPrompt.trim()) return;
    handleRunAction("custom", customPrompt.trim());
    setCustomPrompt("");
    setShowCustomInput(false);
  };

  // Word count delta calculation
  const origWords = result?.originalText ? result.originalText.trim().split(/\s+/).filter(Boolean).length : 0;
  const resultWords = result?.aiResultText ? result.aiResultText.trim().split(/\s+/).filter(Boolean).length : 0;
  const wordDiff = resultWords - origWords;

  return (
    <div
      ref={toolbarRef}
      data-floating-toolbar="true"
      className="fixed z-120 transition-all duration-150 ease-out"
      style={{ top: `${clampedY}px`, left: `${clampedX}px` }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 1. SELECTION TOOLBAR MENU (When text is selected and no result yet) */}
      {selection && !result && (
        <div className="flex items-center gap-1 p-1.5 rounded-xl bg-card border border-card-border shadow-2xl backdrop-blur-md text-xs animate-fade-in relative">
          {isAiLoading ? (
            <div className="flex items-center gap-2 px-3 py-1.5 text-indigo-500 dark:text-indigo-400 font-semibold">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-500 dark:text-indigo-400" />
              <span>AI is thinking...</span>
            </div>
          ) : showCustomInput ? (
            <form onSubmit={handleCustomSubmit} className="flex items-center gap-1.5 px-1">
              <input
                ref={customInputRef}
                type="text"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                // Prevent mousedown from collapsing the editor's DOM selection
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") setShowCustomInput(false);
                }}
                placeholder="Ask AI to modify selection..."
                className="w-64 bg-background border border-card-border rounded-lg px-2.5 py-1 text-xs text-foreground focus:outline-none focus:border-indigo-500/50 placeholder-slate-400"
              />
              <button
                type="submit"
                disabled={!customPrompt.trim()}
                onMouseDown={(e) => e.stopPropagation()}
                className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setShowCustomInput(false)}
                onMouseDown={(e) => e.stopPropagation()}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </form>
          ) : (
            <>
              {/* Core Actions */}
              <button
                onClick={() => handleRunAction("rewrite")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-white hover:bg-indigo-600/10 dark:hover:bg-indigo-600/20 transition-all font-semibold cursor-pointer group"
                title="Rewrite selection for clarity and impact"
              >
                <Wand2 className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400 group-hover:scale-110 transition-transform" />
                <span>Rewrite</span>
              </button>

              <button
                onClick={() => handleRunAction("explain")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-white hover:bg-indigo-600/10 dark:hover:bg-indigo-600/20 transition-all font-semibold cursor-pointer group"
                title="Explain selection in simple terms"
              >
                <HelpCircle className="h-3.5 w-3.5 text-sky-500 dark:text-sky-400 group-hover:scale-110 transition-transform" />
                <span>Explain</span>
              </button>

              <button
                onClick={() => handleRunAction("summarize")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-white hover:bg-indigo-600/10 dark:hover:bg-indigo-600/20 transition-all font-semibold cursor-pointer group"
                title="Summarize selection as bullet points"
              >
                <FileText className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400 group-hover:scale-110 transition-transform" />
                <span>Summarize</span>
              </button>

              <button
                onClick={() => handleRunAction("fix")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-white hover:bg-indigo-600/10 dark:hover:bg-indigo-600/20 transition-all font-semibold cursor-pointer group"
                title="Fix grammar, spelling, and formatting"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400 group-hover:scale-110 transition-transform" />
                <span>Fix Format</span>
              </button>

              {/* Tone Dropdown Toggle */}
              <div className="relative">
                <button
                  onClick={() => { setShowToneMenu(!showToneMenu); setShowMoreMenu(false); }}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:text-purple-600 dark:hover:text-white hover:bg-purple-600/10 dark:hover:bg-purple-600/20 transition-all font-semibold cursor-pointer"
                  title="Change Tone of selection"
                >
                  <Palette className="h-3.5 w-3.5 text-purple-500 dark:text-purple-400" />
                  <span>Tone</span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>

                {showToneMenu && (
                  <div className="absolute left-0 top-full mt-1.5 z-130 w-44 bg-card border border-card-border rounded-xl p-1 shadow-2xl backdrop-blur-xl text-xs space-y-0.5 animate-fade-in">
                    {[
                      { id: "Professional", label: "Professional & Clean" },
                      { id: "Academic",     label: "Academic & Scholarly" },
                      { id: "Casual",       label: "Casual & Friendly" },
                      { id: "Executive",    label: "Executive Summary" },
                    ].map((tone) => (
                      <button
                        key={tone.id}
                        onClick={() => handleRunAction("tone", tone.id)}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-card-hover text-slate-700 dark:text-slate-300 font-medium cursor-pointer transition-colors"
                      >
                        {tone.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* More Actions Dropdown Toggle */}
              <div className="relative">
                <button
                  onClick={() => { setShowMoreMenu(!showMoreMenu); setShowToneMenu(false); }}
                  className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-white hover:bg-indigo-600/10 dark:hover:bg-indigo-600/20 transition-all font-semibold cursor-pointer"
                  title="More AI options"
                >
                  <span>More</span>
                  <ChevronDown className="h-3 w-3 opacity-60" />
                </button>

                {showMoreMenu && (
                  <div className="absolute left-0 top-full mt-1.5 z-130 w-52 bg-card border border-card-border rounded-xl p-1 shadow-2xl backdrop-blur-xl text-xs space-y-0.5 animate-fade-in">
                    <button
                      onClick={() => handleRunAction("expand")}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-card-hover text-slate-700 dark:text-slate-300 font-medium cursor-pointer transition-colors flex items-center gap-2"
                    >
                      <Maximize2 className="h-3.5 w-3.5 text-indigo-400" />
                      <span>Expand & Elaborate</span>
                    </button>
                    <button
                      onClick={() => handleRunAction("shorten")}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-card-hover text-slate-700 dark:text-slate-300 font-medium cursor-pointer transition-colors flex items-center gap-2"
                    >
                      <Minimize2 className="h-3.5 w-3.5 text-rose-400" />
                      <span>Shorten & Condense</span>
                    </button>
                    <button
                      onClick={() => handleRunAction("flashcard")}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-card-hover text-slate-700 dark:text-slate-300 font-medium cursor-pointer transition-colors flex items-center gap-2"
                    >
                      <GraduationCap className="h-3.5 w-3.5 text-amber-400" />
                      <span>Create Flashcards</span>
                    </button>
                    <button
                      onClick={() => handleRunAction("tasks")}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-card-hover text-slate-700 dark:text-slate-300 font-medium cursor-pointer transition-colors flex items-center gap-2"
                    >
                      <CheckSquare className="h-3.5 w-3.5 text-teal-400" />
                      <span>Extract Action Tasks</span>
                    </button>
                  </div>
                )}
              </div>

              <div className="w-px h-4 bg-card-border mx-0.5" />

              {/* Custom Prompt Trigger */}
              <button
                onClick={() => setShowCustomInput(true)}
                onMouseDown={(e) => e.stopPropagation()}
                className="p-1.5 rounded-lg text-indigo-500 dark:text-indigo-400 hover:bg-indigo-600/10 dark:hover:bg-indigo-600/20 transition-all cursor-pointer"
                title="Custom AI Prompt"
              >
                <Sparkles className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      )}

      {/* 2. RESULT CARD (When AI returns response) */}
      {result && (
        <div className="w-105 max-h-95 rounded-2xl bg-card border border-card-border shadow-2xl backdrop-blur-xl p-4 flex flex-col gap-3 animate-fade-in text-xs">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-card-border pb-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-indigo-500 dark:text-indigo-400" />
              <span className="font-bold text-foreground capitalize">{result.actionType} Output</span>
              
              {/* Word count delta indicator */}
              <span className="text-[9.5px] px-1.5 py-0.5 rounded font-mono font-bold bg-sidebar border border-card-border text-slate-600 dark:text-slate-400">
                {resultWords} words {wordDiff > 0 ? `(+${wordDiff})` : wordDiff < 0 ? `(${wordDiff})` : ""}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Toggle Diff View */}
              <button
                onClick={() => setShowDiffView(!showDiffView)}
                className={`p-1 rounded-md border transition-colors cursor-pointer ${
                  showDiffView
                    ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-500 dark:text-indigo-300 font-bold"
                    : "border-card-border text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-card-hover"
                }`}
                title="Toggle Diff comparison view"
              >
                <Split className="h-3.5 w-3.5" />
              </button>

              {/* Regenerate Action */}
              {lastAction && (
                <button
                  onClick={() => handleRunAction(lastAction.action, lastAction.instruction)}
                  disabled={isAiLoading}
                  className="p-1 rounded-md border border-card-border text-slate-500 hover:text-indigo-500 dark:hover:text-indigo-300 hover:bg-card-hover transition-colors cursor-pointer disabled:opacity-30"
                  title="Regenerate AI output"
                >
                  <RotateCcw className={`h-3.5 w-3.5 ${isAiLoading ? "animate-spin" : ""}`} />
                </button>
              )}

              <button
                onClick={onClose}
                className="p-1 rounded text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
                title="Close AI Result (Esc)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* AI Result Content or Diff Comparison */}
          {showDiffView ? (
            <div className="flex flex-col gap-2 max-h-52 overflow-y-auto pr-1">
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">Original Text:</span>
                <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 text-[11px] font-sans leading-relaxed select-text whitespace-pre-wrap">
                  {result.originalText}
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">AI Generated Output:</span>
                <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[11px] font-sans leading-relaxed select-text whitespace-pre-wrap">
                  {result.aiResultText}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto max-h-52 text-foreground leading-relaxed font-sans pr-1 select-text bg-sidebar p-3 rounded-xl border border-card-border whitespace-pre-wrap">
              {result.aiResultText}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sidebar hover:bg-card-hover text-slate-700 dark:text-slate-300 border border-card-border transition-colors text-[11px] font-medium cursor-pointer"
            >
              {copied ? (
                <span className="text-emerald-500 dark:text-emerald-400 font-semibold">Copied!</span>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-slate-500" />
                  <span>Copy</span>
                </>
              )}
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => onInsertBelow(result.aiResultText)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-sidebar hover:bg-indigo-600/20 text-indigo-600 dark:text-indigo-300 border border-card-border transition-all font-semibold cursor-pointer"
              >
                <CornerDownLeft className="h-3.5 w-3.5" />
                <span>Insert Below</span>
              </button>

              <button
                onClick={() => onReplaceSelection(result.aiResultText)}
                className="flex items-center gap-1 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-md transition-all cursor-pointer"
              >
                <Replace className="h-3.5 w-3.5" />
                <span>Replace</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
