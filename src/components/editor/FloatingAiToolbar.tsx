import React, { useState, useEffect, useRef } from "react";
import { Sparkles, Wand2, HelpCircle, FileText, CheckCircle2, Copy, Replace, CornerDownLeft, X, Loader2, Send } from "lucide-react";

export interface FloatingAiSelection {
  text: string;
  coords: { x: number; y: number };
}

export interface FloatingAiResult {
  originalText: string;
  aiResultText: string;
  actionType: string;
  coords: { x: number; y: number };
}

interface FloatingAiToolbarProps {
  selection: FloatingAiSelection | null;
  result: FloatingAiResult | null;
  onExecuteAi: (action: "rewrite" | "explain" | "summarize" | "fix" | "custom", customInstruction?: string) => Promise<void>;
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
  const [copied, setCopied] = useState(false);
  const customInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showCustomInput && customInputRef.current) {
      customInputRef.current.focus();
    }
  }, [showCustomInput]);

  if (!selection && !result) return null;

  // Prefer coordinates from selection or result
  const activeCoords = selection?.coords || result?.coords || { x: 100, y: 100 };
  
  // Viewport clamping
  const clampedX = Math.max(16, Math.min(window.innerWidth - 380, activeCoords.x));
  const clampedY = Math.max(70, Math.min(window.innerHeight - 280, activeCoords.y + 12));

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
    onExecuteAi("custom", customPrompt.trim());
    setCustomPrompt("");
    setShowCustomInput(false);
  };

  return (
    <div
      className="fixed z-[120] transition-all duration-150 ease-out"
      style={{ top: `${clampedY}px`, left: `${clampedX}px` }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* 1. SELECTION TOOLBAR MENU (When text is selected and no result yet) */}
      {selection && !result && (
        <div className="flex items-center gap-1 p-1.5 rounded-xl bg-[#11131c]/95 border border-indigo-500/30 shadow-2xl backdrop-blur-md text-xs animate-fade-in">
          {isAiLoading ? (
            <div className="flex items-center gap-2 px-3 py-1.5 text-indigo-400 font-semibold">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-400" />
              <span>AI is thinking...</span>
            </div>
          ) : showCustomInput ? (
            <form onSubmit={handleCustomSubmit} className="flex items-center gap-1.5 px-1">
              <input
                ref={customInputRef}
                type="text"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="Ask AI to modify selection..."
                className="w-56 bg-[#161825] border border-indigo-500/30 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-400 placeholder-slate-500"
              />
              <button
                type="submit"
                disabled={!customPrompt.trim()}
                className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setShowCustomInput(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </form>
          ) : (
            <>
              <button
                onClick={() => onExecuteAi("rewrite")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-indigo-600/20 transition-all font-medium cursor-pointer group"
                title="Rewrite selection for clarity and impact"
              >
                <Wand2 className="h-3.5 w-3.5 text-indigo-400 group-hover:scale-110 transition-transform" />
                <span>Rewrite</span>
              </button>

              <button
                onClick={() => onExecuteAi("explain")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-indigo-600/20 transition-all font-medium cursor-pointer group"
                title="Explain selection in simple terms"
              >
                <HelpCircle className="h-3.5 w-3.5 text-sky-400 group-hover:scale-110 transition-transform" />
                <span>Explain</span>
              </button>

              <button
                onClick={() => onExecuteAi("summarize")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-indigo-600/20 transition-all font-medium cursor-pointer group"
                title="Summarize selection as bullet points"
              >
                <FileText className="h-3.5 w-3.5 text-emerald-400 group-hover:scale-110 transition-transform" />
                <span>Summarize</span>
              </button>

              <button
                onClick={() => onExecuteAi("fix")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-indigo-600/20 transition-all font-medium cursor-pointer group"
                title="Fix grammar, spelling, and formatting"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-amber-400 group-hover:scale-110 transition-transform" />
                <span>Fix Format</span>
              </button>

              <div className="w-[1px] h-4 bg-slate-800 mx-0.5" />

              <button
                onClick={() => setShowCustomInput(true)}
                className="p-1.5 rounded-lg text-indigo-400 hover:bg-indigo-600/20 transition-all cursor-pointer"
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
        <div className="w-[380px] max-h-[320px] rounded-xl bg-[#11131c] border border-indigo-500/30 shadow-2xl backdrop-blur-md p-4 flex flex-col gap-3 animate-fade-in text-xs">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#1f2335] pb-2">
            <div className="flex items-center gap-2 font-bold text-indigo-400">
              <Sparkles className="h-4 w-4" />
              <span className="capitalize">{result.actionType} Output</span>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded text-slate-500 hover:text-slate-300 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* AI Result Content */}
          <div className="flex-1 overflow-y-auto max-h-[180px] text-slate-200 leading-relaxed font-sans pr-1 select-text bg-[#0b0c10] p-3 rounded-lg border border-[#1f2335] whitespace-pre-wrap">
            {result.aiResultText}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-1">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 px-2.5 py-1 rounded bg-[#161825] hover:bg-[#1f2335] text-slate-300 transition-colors text-[11px] font-medium cursor-pointer"
            >
              {copied ? (
                <span className="text-emerald-400 font-semibold">Copied!</span>
              ) : (
                <>
                  <Copy className="h-3 w-3 text-slate-400" />
                  <span>Copy</span>
                </>
              )}
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={() => onInsertBelow(result.aiResultText)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#161825] hover:bg-indigo-600/20 text-indigo-300 border border-indigo-500/20 transition-all font-semibold cursor-pointer"
              >
                <CornerDownLeft className="h-3 w-3" />
                <span>Insert Below</span>
              </button>

              <button
                onClick={() => onReplaceSelection(result.aiResultText)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-md transition-all cursor-pointer"
              >
                <Replace className="h-3 w-3" />
                <span>Replace</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
