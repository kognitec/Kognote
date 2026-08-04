import React, { useState } from "react";
import { Check, X, ChevronDown, ChevronUp, FileCode } from "lucide-react";

interface DiffPreviewCardProps {
  fileName: string;
  originalText: string;
  updatedText: string;
  onAccept: () => void;
  onReject: () => void;
}

export const DiffPreviewCard: React.FC<DiffPreviewCardProps> = ({
  fileName,
  originalText,
  updatedText,
  onAccept,
  onReject,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [status, setStatus] = useState<"pending" | "accepted" | "rejected">("pending");

  const handleAccept = () => {
    setStatus("accepted");
    onAccept();
  };

  const handleReject = () => {
    setStatus("rejected");
    onReject();
  };

  const origLines = originalText.split("\n");
  const newLines = updatedText.split("\n");

  return (
    <div className="my-3 rounded-lg border border-slate-700/80 bg-slate-900/90 shadow-lg overflow-hidden text-xs font-sans">
      {/* Card Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-800/90 border-b border-slate-700/60 select-none">
        <div className="flex items-center gap-2 text-slate-200 font-medium">
          <FileCode className="w-4 h-4 text-emerald-400" />
          <span>Proposed Edits for <span className="text-emerald-300 font-semibold">{fileName}</span></span>
        </div>
        <div className="flex items-center gap-2">
          {status === "pending" && (
            <>
              <button
                onClick={handleAccept}
                className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-medium transition-colors shadow-sm cursor-pointer"
              >
                <Check className="w-3.5 h-3.5" />
                Accept
              </button>
              <button
                onClick={handleReject}
                className="flex items-center gap-1 px-2.5 py-1 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded font-medium transition-colors cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                Dismiss
              </button>
            </>
          )}
          {status === "accepted" && (
            <span className="flex items-center gap-1 text-emerald-400 font-medium bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/60">
              <Check className="w-3.5 h-3.5" /> Accepted
            </span>
          )}
          {status === "rejected" && (
            <span className="flex items-center gap-1 text-slate-400 font-medium bg-slate-800/60 px-2 py-0.5 rounded">
              <X className="w-3.5 h-3.5" /> Dismissed
            </span>
          )}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Diff View Body */}
      {isExpanded && (
        <div className="max-h-60 overflow-y-auto font-mono text-[11px] leading-relaxed p-2 bg-slate-950/80">
          <div className="text-slate-400 mb-1 text-[10px] uppercase tracking-wider font-semibold">Changes Preview:</div>
          <div className="space-y-0.5">
            {newLines.slice(0, 15).map((line, i) => {
              const origLine = origLines[i] || "";
              const isDiff = line !== origLine;
              return (
                <div
                  key={i}
                  className={`px-2 py-0.5 rounded flex items-start gap-2 whitespace-pre-wrap ${
                    isDiff ? "bg-emerald-950/50 text-emerald-300 border-l-2 border-emerald-500" : "text-slate-400"
                  }`}
                >
                  <span className="select-none text-slate-600 w-6 text-right shrink-0">{i + 1}</span>
                  <span>{line}</span>
                </div>
              );
            })}
            {newLines.length > 15 && (
              <div className="text-slate-500 italic px-2 py-1">
                ... +{newLines.length - 15} more lines
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
