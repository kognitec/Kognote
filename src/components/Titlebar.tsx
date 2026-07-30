import React from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useVault } from "../contexts/VaultContext";
import { 
  Settings as SettingsIcon, Minus, Square, X, Edit, 
  Network, GraduationCap, Brain, Calendar, CheckSquare, 
  Columns, RefreshCw
} from "lucide-react";
import { useSync } from "../contexts/SyncContext";

import logoImg from "../assets/logo.png";

interface TitlebarProps {
  onOpenSettings: () => void;
}

export const Titlebar: React.FC<TitlebarProps> = ({ onOpenSettings }) => {
  const { activeView, setActiveView } = useVault();
  const { isSyncing, lastSyncAt, triggerSync } = useSync();
  const appWindow = getCurrentWindow();

  // Detect macOS client-side
  const isMac = typeof window !== "undefined" && /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent || navigator.platform || "");

  const handleMinimize = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await appWindow.minimize();
    } catch (err) {
      console.error("Failed to minimize window:", err);
    }
  };

  const handleMaximize = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      if (await appWindow.isMaximized()) {
        await appWindow.unmaximize();
      } else {
        await appWindow.maximize();
      }
    } catch (err) {
      console.error("Failed to toggle maximize window:", err);
    }
  };

  const handleClose = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await appWindow.close();
    } catch (err) {
      console.error("Failed to close window:", err);
    }
  };

  const handleStartDrag = (e: React.MouseEvent) => {
    // Only drag on primary left click when target has drag region attribute
    if (e.buttons === 1 && (e.target as HTMLElement).hasAttribute("data-tauri-drag-region")) {
      appWindow.startDragging().catch(() => {});
    }
  };

  return (
    <div
      data-tauri-drag-region
      onMouseDown={handleStartDrag}
      className="flex h-11 w-full items-center justify-between border-b border-white/[0.06] bg-[#0b0c10]/95 backdrop-blur-xs px-4 text-foreground select-none"
      style={{boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.04), 0 1px 0 rgba(0,0,0,0.3)'}}
    >
      {/* Left section: Logo & macOS window controls */}
      <div className="flex items-center gap-3 shrink-0" data-tauri-drag-region>
        {isMac && (
          <div className="flex items-center gap-1.5 mr-2 group/traffic">
            <button
              onClick={handleClose}
              className="w-3 h-3 rounded-full bg-[#ff5f56] border border-[#e0443e] flex items-center justify-center cursor-pointer relative"
              title="Close"
            >
              <span className="absolute text-[8px] text-[#4c0002] font-extrabold opacity-0 group-hover/traffic:opacity-100 transition-opacity">×</span>
            </button>
            <button
              onClick={handleMinimize}
              className="w-3 h-3 rounded-full bg-[#ffbd2e] border border-[#dea123] flex items-center justify-center cursor-pointer relative"
              title="Minimize"
            >
              <span className="absolute text-[8px] text-[#5c3e00] font-extrabold opacity-0 group-hover/traffic:opacity-100 transition-opacity leading-none" style={{ marginTop: "-2px" }}>−</span>
            </button>
            <button
              onClick={handleMaximize}
              className="w-3 h-3 rounded-full bg-[#27c93f] border border-[#1aab29] flex items-center justify-center cursor-pointer relative"
              title="Maximize"
            >
              <span className="absolute text-[6px] text-[#004d02] font-extrabold opacity-0 group-hover/traffic:opacity-100 transition-opacity leading-none">↕</span>
            </button>
          </div>
        )}
        <div className="flex items-center gap-2">
          <img src={logoImg} alt="Kognite Logo" className="h-5 w-5 object-contain rounded-md shadow-sm" />
          <span className="bg-clip-text text-transparent bg-linear-to-r from-indigo-400 to-pink-400 font-extrabold tracking-wider text-xs">
            KOGNOTE
          </span>
        </div>
      </div>

      {/* Center section: Switcher Pills (Centered) */}
      <div className="flex-1 flex justify-center" data-tauri-drag-region>
        <div className="segmented-switcher-container">
          <button
            onClick={() => setActiveView("editor")}
            className={`flex items-center gap-1 px-3 py-1 rounded-md text-[10px] font-bold transition-all duration-200 cursor-pointer hover-wiggle ${
              activeView === "editor"
                ? "active-app-glow text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
            title="Markdown Editor"
          >
            <Edit className="h-3 w-3" />
            Editor
          </button>
          <button
            onClick={() => setActiveView("canvas")}
            className={`flex items-center gap-1 px-3 py-1 rounded-md text-[10px] font-bold transition-all duration-200 cursor-pointer hover-wiggle ${
              activeView === "canvas"
                ? "active-app-glow text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
            title="Whiteboard Canvas"
          >
            <Network className="h-3 w-3" />
            Canvas
          </button>
          <button
            onClick={() => setActiveView("graph")}
            className={`flex items-center gap-1 px-3 py-1 rounded-md text-[10px] font-bold transition-all duration-200 cursor-pointer hover-wiggle ${
              activeView === "graph"
                ? "active-app-glow text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
            title="Graph Connection View"
          >
            <Brain className="h-3 w-3" />
            Graph
          </button>
          <button
            onClick={() => setActiveView("flashcards")}
            className={`flex items-center gap-1 px-3 py-1 rounded-md text-[10px] font-bold transition-all duration-200 cursor-pointer hover-wiggle ${
              activeView === "flashcards"
                ? "active-app-glow text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
            title="Flashcards Dashboard"
          >
            <GraduationCap className="h-3 w-3" />
            Review
          </button>
          <button
            onClick={() => setActiveView("calendar")}
            className={`flex items-center gap-1 px-3 py-1 rounded-md text-[10px] font-bold transition-all duration-200 cursor-pointer hover-wiggle ${
              activeView === "calendar"
                ? "active-app-glow text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
            title="Calendar Timeline"
          >
            <Calendar className="h-3 w-3" />
            Calendar
          </button>
          <button
            onClick={() => setActiveView("tasks")}
            className={`flex items-center gap-1 px-3 py-1 rounded-md text-[10px] font-bold transition-all duration-200 cursor-pointer hover-wiggle ${
              activeView === "tasks"
                ? "active-app-glow text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
            title="Tasks Board"
          >
            <CheckSquare className="h-3 w-3" />
            Tasks
          </button>
          <button
            onClick={() => setActiveView("board")}
            className={`flex items-center gap-1 px-3 py-1 rounded-md text-[10px] font-bold transition-all duration-200 cursor-pointer hover-wiggle ${
              activeView === "board"
                ? "active-app-glow text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
            title="Kanban Board"
          >
            <Columns className="h-3 w-3" />
            Board
          </button>
        </div>
      </div>

      {/* Right section: AI Toggle, Settings & custom Windows controls */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={triggerSync}
          disabled={isSyncing}
          className={`flex h-7 w-7 items-center justify-center rounded-full border transition-all duration-200 cursor-pointer ${
            isSyncing 
              ? "bg-indigo-500/25 text-indigo-400 border-indigo-500/30 animate-pulse" 
              : "text-slate-400 border-transparent hover:bg-[#1a1d29] hover:text-slate-200 hover:border-slate-800"
          }`}
          title={
            isSyncing
              ? "Syncing vault data & views..."
              : lastSyncAt
              ? `Sync Vault Data (Last synced: ${new Date(lastSyncAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
              : "Sync Vault Data (Click to run full manual sync)"
          }
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin text-indigo-400" : ""}`} />
        </button>

        <button
          onClick={onOpenSettings}
          className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-[#1a1d29] hover:text-slate-200 transition-colors border border-transparent hover:border-slate-800 cursor-pointer hover-rotate-continuous"
          title="Settings"
        >
          <SettingsIcon className="h-3.5 w-3.5" />
        </button>
        
        {/* Custom Window control buttons for borderless mode (Windows / Linux only) */}
        {!isMac && (
          <div className="flex items-center gap-0.5 ml-1 border-l border-slate-800 pl-1.5">
            <button
              onClick={handleMinimize}
              className="flex h-6 w-6 items-center justify-center rounded-full text-slate-500 hover:bg-[#1a1d29] hover:text-slate-200 transition-colors cursor-pointer"
            >
              <Minus className="h-3 w-3" />
            </button>
            <button
              onClick={handleMaximize}
              className="flex h-6 w-6 items-center justify-center rounded-full text-slate-500 hover:bg-[#1a1d29] hover:text-slate-200 transition-colors cursor-pointer"
            >
              <Square className="h-2.5 w-2.5" />
            </button>
            <button
              onClick={handleClose}
              className="flex h-6 w-6 items-center justify-full rounded-full text-slate-500 hover:bg-red-500/20 hover:text-red-400 transition-colors cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
