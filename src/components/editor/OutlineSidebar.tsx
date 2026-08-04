import React from "react";
import { List, X } from "lucide-react";

export interface HeadingItem {
  level: number;
  text: string;
  lineNumber: number;
}

interface OutlineSidebarProps {
  headings: HeadingItem[];
  isOpen: boolean;
  onClose: () => void;
  onJumpToHeading: (headingText: string, lineNumber: number) => void;
}

export const OutlineSidebar: React.FC<OutlineSidebarProps> = ({
  headings,
  isOpen,
  onClose,
  onJumpToHeading
}) => {
  if (!isOpen) return null;

  return (
    <div className="w-64 border-l border-card-border bg-sidebar flex flex-col h-full shrink-0 select-none animate-fade-in">
      <div className="p-3 border-b border-card-border flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-wider text-slate-400 uppercase flex items-center gap-1.5">
          <List className="h-3.5 w-3.5 text-indigo-400" />
          Document Outline
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {headings.length === 0 ? (
          <span className="text-[11px] text-slate-600 block px-3 py-6 italic text-center">
            No headings found in document
          </span>
        ) : (
          headings.map((item, i) => (
            <button
              key={`${item.lineNumber}-${i}`}
              onClick={() => onJumpToHeading(item.text, item.lineNumber)}
              className="w-full text-left rounded-md px-2.5 py-1.5 text-[11px] font-medium text-slate-400 hover:bg-[#161825] hover:text-indigo-400 transition-colors truncate block cursor-pointer"
              style={{ paddingLeft: `${Math.max(10, item.level * 8)}px` }}
            >
              <span className="text-slate-600 mr-1.5 font-mono text-[10px]">
                {"#".repeat(item.level)}
              </span>
              <span>{item.text}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
};
