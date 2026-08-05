import React, { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useVault } from "../contexts/VaultContext";
import {
  Settings as SettingsIcon, Minus, Square, X, Edit,
  Network, GraduationCap, Waypoints, Calendar, CheckSquare,
  Columns, RefreshCw, Sun, Moon
} from "lucide-react";
import { useSync } from "../contexts/SyncContext";
import { useTheme } from "../contexts/ThemeContext";

import logoImg from "../assets/logo.png";

interface TitlebarProps {
  onOpenSettings: () => void;
}

export const Titlebar: React.FC<TitlebarProps> = ({ onOpenSettings }) => {
  const { activeView, setActiveView } = useVault();
  const { isSyncing, lastSyncAt, triggerSync } = useSync();
  const { theme, toggleTheme } = useTheme();
  const appWindow = getCurrentWindow();
  const [isMaximized, setIsMaximized] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(event.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const [indicatorStyle, setIndicatorStyle] = useState({
    left: 0,
    width: 0,
    opacity: 0,
    phase: "idle" as "stretch" | "travel" | "contract" | "idle",
  });
  const prevPosRef = useRef<{ left: number; width: number } | null>(null);
  const animTimerRef1 = useRef<any>(null);
  const animTimerRef2 = useRef<any>(null);
  const navContainerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Liquid Stretch-Travel-Contract Pill Animation Engine
  useEffect(() => {
    const updateIndicator = () => {
      const activeEl = tabRefs.current[activeView];
      const containerEl = navContainerRef.current;
      if (!activeEl || !containerEl) return;

      const activeRect = activeEl.getBoundingClientRect();
      const containerRect = containerEl.getBoundingClientRect();

      const targetLeft = activeRect.left - containerRect.left - 5;
      const targetWidth = activeRect.width;

      if (animTimerRef1.current) clearTimeout(animTimerRef1.current);
      if (animTimerRef2.current) clearTimeout(animTimerRef2.current);

      const prev = prevPosRef.current;

      if (prev && Math.abs(prev.left - targetLeft) > 2) {
        const stretchAmount = Math.min(Math.abs(targetLeft - prev.left), 10);

        let stretchLeft = prev.left;
        let stretchWidth = prev.width + stretchAmount;

        if (targetLeft < prev.left) {
          // Moving Left: stretch leftward from prev.left
          stretchLeft = prev.left - stretchAmount;
          stretchWidth = prev.width + stretchAmount;
        }

        let travelLeft = targetLeft;
        let travelWidth = targetWidth + stretchAmount;

        if (targetLeft > prev.left) {
          // Moving Right: travel to target in stretched state
          travelLeft = targetLeft - stretchAmount;
          travelWidth = targetWidth + stretchAmount;
        } else {
          // Moving Left: travel to target in stretched state
          travelLeft = targetLeft;
          travelWidth = targetWidth + stretchAmount;
        }

        // Phase 1 (t = 0ms): Stretch front edge outward toward movement direction while holding tail at prev position
        setIndicatorStyle({
          left: stretchLeft,
          width: stretchWidth,
          opacity: 1,
          phase: "stretch",
        });

        // Phase 2 (t = 60ms): Unanchor tail and travel across in stretched state to target destination
        animTimerRef1.current = setTimeout(() => {
          setIndicatorStyle({
            left: travelLeft,
            width: travelWidth,
            opacity: 1,
            phase: "travel",
          });
        }, 60);

        // Phase 3 (t = 140ms): Arrive at target destination, front edge stops, tail gradually contracts to original pill size
        animTimerRef2.current = setTimeout(() => {
          setIndicatorStyle({
            left: targetLeft,
            width: targetWidth,
            opacity: 1,
            phase: "contract",
          });
          prevPosRef.current = { left: targetLeft, width: targetWidth };
        }, 140);
      } else {
        // Initial mount or window resize
        setIndicatorStyle({
          left: targetLeft,
          width: targetWidth,
          opacity: 1,
          phase: "idle",
        });
        prevPosRef.current = { left: targetLeft, width: targetWidth };
      }
    };

    updateIndicator();
    const resizeTimer = setTimeout(updateIndicator, 50);
    window.addEventListener("resize", updateIndicator);
    return () => {
      clearTimeout(resizeTimer);
      if (animTimerRef1.current) clearTimeout(animTimerRef1.current);
      if (animTimerRef2.current) clearTimeout(animTimerRef2.current);
      window.removeEventListener("resize", updateIndicator);
    };
  }, [activeView]);

  // Detect macOS client-side
  const isMac = typeof window !== "undefined" && /Mac|iPhone|iPod|iPad/i.test(navigator.userAgent || navigator.platform || "");

  // Track window maximize / restore state
  useEffect(() => {
    const updateMaximized = async () => {
      try {
        const max = await appWindow.isMaximized();
        setIsMaximized(max);
      } catch {
        // ignore window state error
      }
    };

    updateMaximized();

    let unlisten: (() => void) | undefined;
    appWindow.onResized(() => {
      updateMaximized();
    }).then((fn) => {
      unlisten = fn;
    }).catch(() => { });

    return () => {
      if (unlisten) unlisten();
    };
  }, [appWindow]);

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
      await appWindow.toggleMaximize();
      const max = await appWindow.isMaximized();
      setIsMaximized(max);
    } catch (err) {
      console.error("Failed to toggle maximize window:", err);
    }
  };

  // macOS Native Green Button: Click = Native Fullscreen, Option+Click = Zoom/Maximize
  const handleMacGreenClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (e.altKey) {
        await appWindow.toggleMaximize();
      } else {
        const isFS = await appWindow.isFullscreen();
        await appWindow.setFullscreen(!isFS);
      }
    } catch {
      await appWindow.toggleMaximize();
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
      appWindow.startDragging().catch(() => { });
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).hasAttribute("data-tauri-drag-region")) {
      handleMaximize(e);
    }
  };

  return (
    <div
      id="titlebar"
      data-tauri-drag-region
      onMouseDown={handleStartDrag}
      onDoubleClick={handleDoubleClick}
      className="flex h-9 w-full items-center justify-between border-b border-card-border bg-background/95 backdrop-blur-xl px-2.5 text-foreground select-none relative z-40 transition-colors duration-200"
    >
      {/* Left section: Logo & macOS window controls */}
      <div className="flex items-center gap-2 shrink-0" data-tauri-drag-region>
        {isMac && (
          <div className="flex items-center gap-1.5 mr-1 group/traffic">
            <button
              onClick={handleClose}
              className="w-3 h-3 rounded-full bg-[#ff5f57] border border-[#e0443e] hover:bg-[#e0443e] flex items-center justify-center cursor-pointer relative transition-all shadow-xs"
              title="Close (Cmd+W)"
            >
              <span className="absolute text-[9px] text-[#4c0002] font-black opacity-0 group-hover/traffic:opacity-100 transition-opacity leading-none">×</span>
            </button>
            <button
              onClick={handleMinimize}
              className="w-3 h-3 rounded-full bg-[#febc2e] border border-[#dea123] hover:bg-[#dea123] flex items-center justify-center cursor-pointer relative transition-all shadow-xs"
              title="Minimize (Cmd+M)"
            >
              <span className="absolute text-[9px] text-[#5c3e00] font-black opacity-0 group-hover/traffic:opacity-100 transition-opacity leading-none" style={{ marginTop: "-2px" }}>−</span>
            </button>
            <button
              onClick={handleMacGreenClick}
              className="w-3 h-3 rounded-full bg-[#28c840] border border-[#1aab29] hover:bg-[#1aab29] flex items-center justify-center cursor-pointer relative transition-all shadow-xs"
              title="Click: Fullscreen | Option+Click: Zoom"
            >
              <span className="absolute text-[7px] text-[#004d02] font-black opacity-0 group-hover/traffic:opacity-100 transition-opacity leading-none">⤢</span>
            </button>
          </div>
        )}
        <div className="flex items-center gap-1.5 group cursor-default" data-tauri-drag-region>
          <img
            src={logoImg}
            alt="Kognote Logo"
            className="h-4.5 w-4.5 object-contain transition-all duration-300 group-hover:scale-110"
            style={{
              filter: theme === "dark"
                ? "drop-shadow(0 0 4px rgba(139,92,246,0.6))"
                : "drop-shadow(0 1px 2px rgba(109,40,217,0.3))"
            }}
          />
          <span className="font-bold text-xs tracking-tight bg-clip-text text-transparent select-none"
            style={{
              backgroundImage: theme === "dark"
                ? "linear-gradient(135deg, #a78bfa 0%, #c084fc 40%, #f472b6 80%, #fb923c 100%)"
                : "linear-gradient(135deg, #4f46e5 0%, #7c3aed 40%, #db2777 80%, #ea580c 100%)"
            }}
          >
            Kognote
          </span>
          <span className="text-[7.5px] font-bold uppercase tracking-wider px-1 py-0.2 rounded bg-indigo-500/10 dark:bg-indigo-400/15 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20 dark:border-indigo-400/30 shadow-2xs leading-none select-none transition-colors duration-200">
            BETA
          </span>
        </div>

        {/* Inline App Dropdown Menus (File, Edit, View, Window, Help) */}
        <div ref={menuContainerRef} className="flex items-center gap-0.5 ml-1 sm:ml-2" data-tauri-drag-region={false}>
          {[
            {
              id: "file",
              label: "File",
              items: [
                { label: "New Note", shortcut: isMac ? "⌘N" : "Ctrl+N", action: () => window.dispatchEvent(new CustomEvent("new-note-action")) },
                { label: "New Daily Log", shortcut: isMac ? "⇧⌘D" : "Ctrl+Shift+D", action: () => window.dispatchEvent(new CustomEvent("new-daily-action")) },
                { label: "Open Vault...", shortcut: isMac ? "⌘O" : "Ctrl+O", action: () => window.dispatchEvent(new CustomEvent("open-vault-action")) },
                { separator: true },
                { label: "Save Note", shortcut: isMac ? "⌘S" : "Ctrl+S", action: () => window.dispatchEvent(new CustomEvent("save-note-action")) },
                { label: "Close Note", shortcut: isMac ? "⌘W" : "Ctrl+W", action: () => window.dispatchEvent(new CustomEvent("close-note-action")) },
                { separator: true },
                { label: "Reveal in Finder / Explorer", shortcut: isMac ? "⇧⌘R" : "Ctrl+Shift+R", action: () => window.dispatchEvent(new CustomEvent("reveal-note-action")) },
              ]
            },
            {
              id: "edit",
              label: "Edit",
              items: [
                { label: "Undo", shortcut: isMac ? "⌘Z" : "Ctrl+Z", action: () => document.execCommand("undo") },
                { label: "Redo", shortcut: isMac ? "⇧⌘Z" : "Ctrl+Y", action: () => document.execCommand("redo") },
                { separator: true },
                { label: "Command Palette...", shortcut: isMac ? "⌘K" : "Ctrl+K", action: () => window.dispatchEvent(new CustomEvent("open-command-palette")) },
              ]
            },
            {
              id: "view",
              label: "View",
              items: [
                { label: "Editor", shortcut: isMac ? "⌘1" : "Ctrl+1", action: () => setActiveView("editor") },
                { label: "Canvas", shortcut: isMac ? "⌘2" : "Ctrl+2", action: () => setActiveView("canvas") },
                { label: "Knowledge Graph", shortcut: isMac ? "⌘3" : "Ctrl+3", action: () => setActiveView("graph") },
                { label: "Review Deck", shortcut: isMac ? "⌘4" : "Ctrl+4", action: () => setActiveView("flashcards") },
                { label: "Calendar", shortcut: isMac ? "⌘5" : "Ctrl+5", action: () => setActiveView("calendar") },
                { label: "Task Manager", shortcut: isMac ? "⌘6" : "Ctrl+6", action: () => setActiveView("tasks") },
                { label: "Kanban Board", shortcut: isMac ? "⌘7" : "Ctrl+7", action: () => setActiveView("board") },
                { separator: true },
                { label: "Toggle KogNote AI Chat", shortcut: isMac ? "⇧⌘C" : "Ctrl+Shift+C", action: () => window.dispatchEvent(new CustomEvent("open-ai-chat-with-prompt", { detail: "" })) },
              ]
            },
            {
              id: "window",
              label: "Window",
              items: [
                { label: "Minimize Window", shortcut: isMac ? "⌘M" : "Win+Down", action: handleMinimize },
                { label: isMaximized ? "Restore Window" : "Maximize Window", action: handleMaximize },
                { separator: true },
                { label: "Close App", shortcut: isMac ? "⌘Q" : "Alt+F4", action: handleClose },
              ]
            },
            {
              id: "help",
              label: "Help",
              items: [
                { label: "KogNote Documentation", action: () => window.open("https://kognitec.com", "_blank") },
                { label: "System Preferences / Settings", action: onOpenSettings },
              ]
            }
          ].map((menu) => (
            <div key={menu.id} className="relative">
              <button
                type="button"
                onClick={() => setActiveMenu(activeMenu === menu.id ? null : menu.id)}
                onMouseEnter={() => { if (activeMenu) setActiveMenu(menu.id); }}
                className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors cursor-pointer select-none ${
                  activeMenu === menu.id
                    ? "bg-slate-200 dark:bg-slate-800 text-foreground font-bold"
                    : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-foreground"
                }`}
              >
                {menu.label}
              </button>

              {activeMenu === menu.id && (
                <div className="absolute left-0 top-full mt-1 z-50 min-w-52 py-1 rounded-xl bg-card border border-card-border shadow-2xl backdrop-blur-xl animate-fade-in text-xs">
                  {menu.items.map((item: any, idx: number) => (
                    item.separator ? (
                      <div key={idx} className="my-1 border-t border-card-border" />
                    ) : (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => { item.action?.(); setActiveMenu(null); }}
                        className="w-full px-3 py-1.5 text-xs text-left text-foreground hover:bg-indigo-600 hover:text-white flex items-center justify-between transition-colors cursor-pointer group"
                      >
                        <span>{item.label}</span>
                        {item.shortcut && (
                          <span className="text-[10px] text-slate-400 group-hover:text-white/80 font-mono ml-3">{item.shortcut}</span>
                        )}
                      </button>
                    )
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Center section: Switcher Capsule Pills with Fluid Moving Indicator */}
      <div className="flex-1 flex justify-center" data-tauri-drag-region>
        <div
          ref={navContainerRef}
          className="relative flex items-center p-1 rounded-full bg-white dark:bg-slate-900/80 backdrop-blur-xl border border-slate-200/90 dark:border-slate-800 shadow-xs overflow-hidden gap-0.5"
        >
          {/* Liquid Stretch, Travel & Destination Contraction Pill */}
          <div
            className={`absolute top-1 bottom-1 rounded-full bg-linear-to-r from-blue-600 via-indigo-600 to-purple-600 shadow-[0_2px_10px_rgba(99,102,241,0.4)] border border-white/30 pointer-events-none ${
              indicatorStyle.phase === "stretch"
                ? "transition-all duration-70 ease-out"
                : indicatorStyle.phase === "travel"
                ? "transition-all duration-80 ease-linear"
                : indicatorStyle.phase === "contract"
                ? "transition-all duration-160 ease-[cubic-bezier(0.16,1,0.3,1)]"
                : "transition-all duration-100 ease-out"
            }`}
            style={{
              transform: `translateX(${indicatorStyle.left}px)`,
              width: `${indicatorStyle.width}px`,
              opacity: indicatorStyle.opacity,
            }}
          />

          {[
            { id: "editor",     label: "Editor",   icon: Edit,          title: "Markdown Editor",        iconColor: "text-indigo-600 dark:text-indigo-400" },
            { id: "canvas",     label: "Canvas",   icon: Network,       title: "Whiteboard Canvas",      iconColor: "text-purple-600 dark:text-purple-400" },
            { id: "graph",      label: "Graph",    icon: Waypoints,     title: "Graph Connection View",  iconColor: "text-sky-500 dark:text-sky-400" },
            { id: "flashcards", label: "Review",   icon: GraduationCap, title: "Flashcards Dashboard",  iconColor: "text-amber-500 dark:text-amber-400" },
            { id: "calendar",   label: "Calendar", icon: Calendar,      title: "Calendar Timeline",      iconColor: "text-rose-500 dark:text-rose-400" },
            { id: "tasks",      label: "Tasks",    icon: CheckSquare,   title: "Tasks Board",            iconColor: "text-emerald-500 dark:text-emerald-400" },
            { id: "board",      label: "Board",    icon: Columns,       title: "Kanban Board",           iconColor: "text-slate-600 dark:text-slate-300" },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeView === tab.id;
            return (
              <button
                key={tab.id}
                ref={(el) => { tabRefs.current[tab.id] = el; }}
                onClick={() => setActiveView(tab.id as any)}
                className={`relative z-10 flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold cursor-pointer select-none rounded-full transition-colors duration-150 ${
                  isActive
                    ? "text-white! drop-shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-white/10"
                }`}
                title={tab.title}
              >
                <Icon className={`h-3.5 w-3.5 transition-transform duration-200 ${isActive ? "text-white! scale-110" : tab.iconColor}`} />
                <span className={isActive ? "text-white!" : ""}>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right section: AI Toggle, Settings & custom Windows controls */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={triggerSync}
          disabled={isSyncing}
          className={`flex h-7 w-7 items-center justify-center rounded-full border transition-all duration-200 cursor-pointer ${isSyncing
              ? "bg-indigo-500/25 text-indigo-400 border-indigo-500/30 animate-pulse"
              : "text-slate-400 border-transparent hover:bg-white/10 hover:text-slate-200"
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
          className="flex h-7 w-7 items-center justify-center rounded-full text-slate-400 hover:bg-white/10 hover:text-slate-200 transition-colors border border-transparent cursor-pointer hover-rotate-continuous"
          title="Settings"
        >
          <SettingsIcon className="h-3.5 w-3.5" />
        </button>

        {/* Concentric Circular Theme Switcher Button */}
        <button
          onClick={(e) => toggleTheme(e)}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 hover:text-indigo-300 transition-all duration-200 cursor-pointer shadow-xs active:scale-95 group"
          title={`Click to switch to ${theme === "dark" ? "Light" : "Dark"} Mode (Concentric Ripple Transition)`}
        >
          {theme === "dark" ? (
            <Sun className="h-3.5 w-3.5 text-amber-400 group-hover:rotate-45 transition-transform duration-300" />
          ) : (
            <Moon className="h-3.5 w-3.5 text-indigo-400 group-hover:-rotate-12 transition-transform duration-300" />
          )}
        </button>

        {/* Custom Window control buttons for borderless mode (Windows / Linux) */}
        {!isMac && (
          <div className="flex items-center gap-0.5 ml-1 border-l border-white/10 pl-2">
            <button
              onClick={handleMinimize}
              className="flex h-7 w-8.5 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-slate-100 transition-all cursor-pointer"
              title="Minimize"
            >
              <Minus className="h-3.5 w-3.5 stroke-[1.5]" />
            </button>
            <button
              onClick={handleMaximize}
              className="flex h-7 w-8.5 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-slate-100 transition-all cursor-pointer relative"
              title={isMaximized ? "Restore Window" : "Maximize Window"}
            >
              {isMaximized ? (
                <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <rect x="3.5" y="1.5" width="7" height="7" rx="0.5" />
                  <path d="M1.5 3.5v7h7" />
                </svg>
              ) : (
                <Square className="h-3 w-3 stroke-[1.5]" />
              )}
            </button>
            <button
              onClick={handleClose}
              className="flex h-7 w-8.5 items-center justify-center rounded-md text-slate-400 hover:bg-[#e81123] hover:text-white transition-all cursor-pointer"
              title="Close"
            >
              <X className="h-3.5 w-3.5 stroke-[1.5]" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
