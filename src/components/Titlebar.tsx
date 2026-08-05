import React, { useState, useEffect, useRef } from "react";
import { getCurrentWindow, primaryMonitor } from "@tauri-apps/api/window";
import { LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";
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
  const [showSnapMenu, setShowSnapMenu] = useState(false);
  const hoverTimeoutRef = useRef<any>(null);

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

  // Window Snapping Helper (Windows Snap Layouts / macOS Tile Options)
  const snapWindow = async (layout: "left" | "right" | "center" | "maximize") => {
    try {
      if (layout === "maximize") {
        await appWindow.maximize();
        setIsMaximized(true);
        return;
      }

      const monitor = await primaryMonitor();
      if (!monitor) {
        await appWindow.maximize();
        return;
      }

      if (await appWindow.isMaximized()) {
        await appWindow.unmaximize();
        setIsMaximized(false);
      }

      const workArea = monitor.size;
      const scaleFactor = monitor.scaleFactor || 1;
      const screenW = Math.floor(workArea.width / scaleFactor);
      const screenH = Math.floor(workArea.height / scaleFactor);

      let w = screenW;
      let h = screenH;
      let x = 0;
      let y = 0;

      if (layout === "left") {
        w = Math.floor(screenW / 2);
        h = screenH;
        x = 0;
        y = 0;
      } else if (layout === "right") {
        w = Math.floor(screenW / 2);
        h = screenH;
        x = Math.floor(screenW / 2);
        y = 0;
      } else if (layout === "center") {
        w = Math.floor(screenW * 0.8);
        h = Math.floor(screenH * 0.85);
        x = Math.floor((screenW - w) / 2);
        y = Math.floor((screenH - h) / 2);
      }

      await appWindow.setSize(new LogicalSize(w, h));
      await appWindow.setPosition(new LogicalPosition(x, y));
    } catch (err) {
      console.error("Failed to snap window:", err);
    }
  };

  const handleMaximizeMouseEnter = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setShowSnapMenu(true);
    }, 450);
  };

  const handleMaximizeMouseLeave = () => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
  };

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
      className="flex h-11 w-full items-center justify-between border-b border-slate-200/80 dark:border-slate-800/80 bg-white/90 dark:bg-slate-950/70 backdrop-blur-xl px-3 text-foreground select-none relative z-40 transition-all duration-300"
    >
      {/* Left section: Logo & macOS window controls */}
      <div className="flex items-center gap-3 shrink-0" data-tauri-drag-region>
        {isMac && (
          <div className="flex items-center gap-2 mr-1 group/traffic">
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
              onMouseEnter={handleMaximizeMouseEnter}
              onMouseLeave={handleMaximizeMouseLeave}
              onContextMenu={(e) => { e.preventDefault(); setShowSnapMenu((prev) => !prev); }}
              className="w-3 h-3 rounded-full bg-[#28c840] border border-[#1aab29] hover:bg-[#1aab29] flex items-center justify-center cursor-pointer relative transition-all shadow-xs"
              title="Click: Fullscreen | Option+Click: Zoom | Right-click/Hover: Tile options"
            >
              <span className="absolute text-[7px] text-[#004d02] font-black opacity-0 group-hover/traffic:opacity-100 transition-opacity leading-none">⤢</span>
            </button>
          </div>
        )}
        <div className="flex items-center gap-2 group cursor-default" data-tauri-drag-region>
          <img
            src={logoImg}
            alt="Kognote Logo"
            className="h-7 w-7 object-contain transition-all duration-300 group-hover:scale-110"
            style={{
              filter: theme === "dark"
                ? "drop-shadow(0 0 6px rgba(139,92,246,0.7)) drop-shadow(0 0 12px rgba(249,115,22,0.4))"
                : "drop-shadow(0 2px 4px rgba(109,40,217,0.3)) drop-shadow(0 1px 3px rgba(234,88,12,0.2))"
            }}
          />
          <span className="font-black text-[15px] tracking-tight bg-clip-text text-transparent select-none"
            style={{
              backgroundImage: theme === "dark"
                ? "linear-gradient(135deg, #a78bfa 0%, #c084fc 40%, #f472b6 80%, #fb923c 100%)"
                : "linear-gradient(135deg, #4f46e5 0%, #7c3aed 40%, #db2777 80%, #ea580c 100%)"
            }}
          >
            Kognote
          </span>
          <span className="text-[8.5px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-indigo-500/10 dark:bg-indigo-400/15 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20 dark:border-indigo-400/30 shadow-2xs leading-none select-none transition-colors duration-200">
            BETA
          </span>
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
            { id: "editor",     label: "Editor",   icon: Edit,          title: "Markdown Editor",        iconColor: "text-violet-500 dark:text-violet-400" },
            { id: "canvas",     label: "Canvas",   icon: Network,       title: "Whiteboard Canvas",      iconColor: "text-emerald-500 dark:text-emerald-400" },
            { id: "graph",      label: "Graph",    icon: Waypoints,     title: "Graph Connection View",  iconColor: "text-sky-500 dark:text-sky-400" },
            { id: "flashcards", label: "Review",   icon: GraduationCap, title: "Flashcards Dashboard",  iconColor: "text-amber-400" },
            { id: "calendar",   label: "Calendar", icon: Calendar,      title: "Calendar Timeline",      iconColor: "text-rose-400" },
            { id: "tasks",      label: "Tasks",    icon: CheckSquare,   title: "Tasks Board",            iconColor: "text-teal-400" },
            { id: "board",      label: "Board",    icon: Columns,       title: "Kanban Board",           iconColor: "text-orange-400" },
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
              title="Minimize (Win + Down)"
            >
              <Minus className="h-3.5 w-3.5 stroke-[1.5]" />
            </button>
            <button
              onClick={handleMaximize}
              onMouseEnter={handleMaximizeMouseEnter}
              onMouseLeave={handleMaximizeMouseLeave}
              onContextMenu={(e) => { e.preventDefault(); setShowSnapMenu((prev) => !prev); }}
              className="flex h-7 w-8.5 items-center justify-center rounded-md text-slate-400 hover:bg-white/10 hover:text-slate-100 transition-all cursor-pointer relative"
              title={isMaximized ? "Restore (Right-click or hover for Snap Layouts)" : "Maximize (Right-click or hover for Snap Layouts)"}
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
              title="Close (Alt + F4)"
            >
              <X className="h-3.5 w-3.5 stroke-[1.5]" />
            </button>
          </div>
        )}
      </div>

      {/* Snap Layouts & Tile Options Floating Menu */}
      {showSnapMenu && (
        <div
          className={`absolute top-10 ${isMac ? "left-12" : "right-8"} z-50 p-2.5 rounded-xl bg-card border border-card-border shadow-2xl flex flex-col gap-2 animate-fade-in text-foreground select-none w-56`}
          onMouseEnter={() => { if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current); }}
          onMouseLeave={() => setShowSnapMenu(false)}
        >
          <div className="flex items-center justify-between px-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            <span>{isMac ? "Tile & Snap Options" : "Snap Layouts"}</span>
            <span className="text-[9px] font-normal text-slate-500 font-mono">
              {isMac ? "Option + Green" : "Win + Z"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* Left Half */}
            <button
              onClick={() => { snapWindow("left"); setShowSnapMenu(false); }}
              className="flex flex-col items-center gap-1.5 p-2 rounded-lg bg-sidebar hover:bg-card-hover border border-card-border hover:border-indigo-400/40 transition-all cursor-pointer group"
              title="Snap to Left Half (50%)"
            >
              <div className="w-12 h-8 rounded border border-slate-400 dark:border-slate-500 group-hover:border-indigo-400 flex p-0.5 gap-0.5">
                <div className="w-1/2 h-full bg-indigo-500 rounded-xs" />
                <div className="w-1/2 h-full bg-slate-300 dark:bg-slate-700/50 rounded-xs" />
              </div>
              <span className="text-[10px] font-semibold text-foreground group-hover:text-indigo-500 dark:group-hover:text-indigo-300">Left Half</span>
            </button>

            {/* Right Half */}
            <button
              onClick={() => { snapWindow("right"); setShowSnapMenu(false); }}
              className="flex flex-col items-center gap-1.5 p-2 rounded-lg bg-sidebar hover:bg-card-hover border border-card-border hover:border-indigo-400/40 transition-all cursor-pointer group"
              title="Snap to Right Half (50%)"
            >
              <div className="w-12 h-8 rounded border border-slate-400 dark:border-slate-500 group-hover:border-indigo-400 flex p-0.5 gap-0.5">
                <div className="w-1/2 h-full bg-slate-300 dark:bg-slate-700/50 rounded-xs" />
                <div className="w-1/2 h-full bg-indigo-500 rounded-xs" />
              </div>
              <span className="text-[10px] font-semibold text-foreground group-hover:text-indigo-500 dark:group-hover:text-indigo-300">Right Half</span>
            </button>

            {/* Centered */}
            <button
              onClick={() => { snapWindow("center"); setShowSnapMenu(false); }}
              className="flex flex-col items-center gap-1.5 p-2 rounded-lg bg-sidebar hover:bg-card-hover border border-card-border hover:border-indigo-400/40 transition-all cursor-pointer group"
              title="Focus Centered Window (80%)"
            >
              <div className="w-12 h-8 rounded border border-slate-400 dark:border-slate-500 group-hover:border-indigo-400 flex items-center justify-center p-1">
                <div className="w-8 h-5 bg-indigo-500 rounded-xs" />
              </div>
              <span className="text-[10px] font-semibold text-foreground group-hover:text-indigo-500 dark:group-hover:text-indigo-300">Centered</span>
            </button>

            {/* Full Screen */}
            <button
              onClick={() => { snapWindow("maximize"); setShowSnapMenu(false); }}
              className="flex flex-col items-center gap-1.5 p-2 rounded-lg bg-sidebar hover:bg-card-hover border border-card-border hover:border-indigo-400/40 transition-all cursor-pointer group"
              title="Full Screen / Maximize (100%)"
            >
              <div className="w-12 h-8 rounded border border-slate-400 dark:border-slate-500 group-hover:border-indigo-400 p-0.5">
                <div className="w-full h-full bg-indigo-500 rounded-xs" />
              </div>
              <span className="text-[10px] font-semibold text-foreground group-hover:text-indigo-500 dark:group-hover:text-indigo-300">Full Screen</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
