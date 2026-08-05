import React, { useState, useRef, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useVault } from "../contexts/VaultContext";
import { useSync } from "../contexts/SyncContext";
import { store } from "../contexts/SettingsContext";
import { FileTree } from "./FileTree";
import { Editor } from "./Editor";
import { Titlebar } from "./Titlebar";
import { Settings } from "./Settings";
import { Canvas } from "./Canvas";
import { FlashcardDashboard } from "./FlashcardDashboard";
import { GraphView } from "./GraphView";
import { CalendarView } from "./CalendarView";
import { TasksView } from "./TasksView";
import { BoardView } from "./BoardView";
// Dedicated view component for Daily Activity Logs timeline
import { CopilotChat } from "./CopilotChat";
import { CommandPalette } from "./CommandPalette";
import { CreateFileModal } from "./CreateFileModal";
import { AttachmentViewer } from "./AttachmentViewer";
import { FileText, Network, X, SquareX } from "lucide-react";
import { FileEntry, NoteCachedData } from "../types/note";
import aiStaticIcon from "../assets/ai-static.png";
import { getFileIcon } from "../lib/file-icons";
import { setDragState, getDragState, clearDragState } from "../lib/drag-state";

const ATTACHMENT_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'mp3', 'mp4', 'wav', 'm4a', 'mov', 'pdf'];

const isAttachmentFile = (file: FileEntry | null): boolean => {
  if (!file) return false;
  const ext = file.name.toLowerCase().split('.').pop() || '';
  return ATTACHMENT_EXTS.includes(ext);
};

const getTabIcon = (file: FileEntry, noteCache: Record<string, NoteCachedData>) => {
  return getFileIcon(file, noteCache, { className: "h-3.5 w-3.5 shrink-0" });
};

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

class ViewErrorBoundary extends React.Component<{ children: React.ReactNode; viewName: string }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode; viewName: string }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[KogNote ErrorBoundary] Error in view [${this.props.viewName}]:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full w-full flex-col items-center justify-center bg-background text-slate-400 select-none p-6 text-center">
          <div className="p-3 rounded-full bg-rose-500/10 border border-rose-500/20 mb-3">
            <X className="h-6 w-6 text-rose-400" />
          </div>
          <h4 className="text-sm font-semibold text-slate-200 mb-1">
            Section view encountered an error ({this.props.viewName})
          </h4>
          <p className="text-xs text-slate-500 max-w-sm mb-4">
            {this.state.error?.message || "An unexpected error occurred while rendering this section."}
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-colors cursor-pointer shadow-md"
          >
            Reload View
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export const Layout: React.FC = () => {
  const {
    activeView,
    refreshFiles,
    openFiles,
    setOpenFiles,
    activeFile,
    openFile,
    closeFile,
    setActiveView,
    noteCache,
    triggerNotesScan
  } = useVault();
  const { triggerSync, registerSyncHandler, unregisterSyncHandler } = useSync();
  const [sidebarWidth, setSidebarWidth] = useState(250);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isChatDetached, setIsChatDetached] = useState(false);
  const [isSidebarVisible, setIsSidebarVisible] = useState(true);
  const isResizingRef = useRef(false);

  const [draggedPath, setDraggedPath] = useState<string | null>(null);
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [isTabsSquished, setIsTabsSquished] = useState(false);

  useEffect(() => {
    const handleOpenAiPrompt = async (e: Event) => {
      const customEvent = e as CustomEvent;
      const promptText = customEvent.detail;
      try {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const existing = await WebviewWindow.getByLabel("ai-chat");
        if (existing) {
          await existing.close();
        }
      } catch {}
      setIsChatDetached(false);
      setIsChatOpen(true);
      window.dispatchEvent(new CustomEvent("clear-floating-ai-selection"));

      if (typeof promptText === "string" && promptText.trim()) {
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("submit-copilot-prompt", { detail: promptText.trim() }));
        }, 120);
      }
    };

    window.addEventListener("open-ai-chat-with-prompt", handleOpenAiPrompt as EventListener);

    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen("open-docked-ai-chat", async () => {
        setIsChatDetached(false);
        setIsChatOpen(true);
      }).then((un) => {
        unlisten = un;
      });
    }).catch(() => {});

    return () => {
      window.removeEventListener("open-ai-chat-with-prompt", handleOpenAiPrompt);
      if (unlisten) unlisten();
    };
  }, []);

  const handleToggleDetach = async () => {
    try {
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const existing = await WebviewWindow.getByLabel("ai-chat");
      if (existing) {
        await existing.close();
        setIsChatDetached(false);
        setIsChatOpen(true);
        return;
      }
      const win = new WebviewWindow("ai-chat", {
        url: "/index.html?view=ai-chat",
        title: "KogNote AI Assistant",
        width: 440,
        height: 620,
        resizable: true,
        alwaysOnTop: true,
        decorations: true,
      });
      win.once("tauri://created", () => {
        setIsChatOpen(false);
      });
      win.once("tauri://error", (err) => {
        console.error("Failed to create native AI WebviewWindow:", err);
        setIsChatDetached((prev) => !prev);
      });
    } catch (err) {
      console.warn("Native WebviewWindow not supported, toggling in-app floating mode:", err);
      setIsChatDetached((prev) => !prev);
    }
  };

  const handleToggleChat = async () => {
    if (!isChatOpen) {
      try {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const existing = await WebviewWindow.getByLabel("ai-chat");
        if (existing) {
          await existing.close();
        }
      } catch {}
      setIsChatDetached(false);
      setIsChatOpen(true);
    } else {
      setIsChatOpen(false);
    }
  };

  // Dynamic detection for tab squishing / crowded workspace
  useEffect(() => {
    const checkSquished = () => {
      if (tabsContainerRef.current) {
        const { clientWidth, scrollWidth } = tabsContainerRef.current;
        const avgTabWidth = clientWidth / (openFiles.length || 1);
        const squished = scrollWidth > clientWidth || (openFiles.length >= 4 && avgTabWidth < 125);
        setIsTabsSquished(squished);
      }
    };

    checkSquished();
    const observer = new ResizeObserver(checkSquished);
    if (tabsContainerRef.current) {
      observer.observe(tabsContainerRef.current);
    }
    return () => observer.disconnect();
  }, [openFiles.length, sidebarWidth, isSidebarVisible]);

  const handleDragStart = (e: React.DragEvent, path: string) => {
    setDraggedPath(path);
    setDragState("tab", path);
    e.dataTransfer.setData("text/plain", path);
    e.dataTransfer.effectAllowed = "all";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDropTab = (e: React.DragEvent, targetPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    const source = getDragState("tab") || draggedPath || e.dataTransfer.getData("text/plain");
    if (!source || source === targetPath) return;

    setOpenFiles((prev) => {
      const fromIdx = prev.findIndex((f) => f.path === source);
      const toIdx = prev.findIndex((f) => f.path === targetPath);
      if (fromIdx === -1 || toIdx === -1) return prev;

      const updated = [...prev];
      const [moved] = updated.splice(fromIdx, 1);
      updated.splice(toIdx, 0, moved);
      return updated;
    });
    setDraggedPath(null);
    clearDragState();
  };

  const handleDragEnd = () => {
    setDraggedPath(null);
    clearDragState();
  };

  const handleCloseOthers = () => {
    if (activeFile) {
      setOpenFiles([activeFile]);
    } else {
      setOpenFiles([]);
    }
  };

  // Command Palette & Native Application Menu Event Handlers
  useEffect(() => {
    const handleSwitchView = (e: Event) => {
      const view = (e as CustomEvent).detail;
      setActiveView(view);
    };
    const handleOpenSettings = () => {
      setIsSettingsOpen(true);
    };
    const handleOpenChat = () => {
      setIsChatOpen(true);
    };
    const handleToggleChat = () => {
      setIsChatOpen((prev) => !prev);
    };
    const handleToggleSidebar = () => {
      setIsSidebarVisible((prev) => !prev);
    };

    window.addEventListener("cmd-switch-view", handleSwitchView);
    window.addEventListener("trigger-open-settings", handleOpenSettings);
    window.addEventListener("trigger-open-chat", handleOpenChat);
    window.addEventListener("trigger-toggle-chat", handleToggleChat);
    window.addEventListener("trigger-toggle-sidebar", handleToggleSidebar);

    // Listen to native OS menu item clicks (macOS & Windows)
    const unlistenMenu = listen<string>("menu_action", (event) => {
      const action = event.payload;
      if (action === "settings") setIsSettingsOpen(true);
      else if (action === "new_note") window.dispatchEvent(new CustomEvent("trigger-create-note"));
      else if (action === "open_palette") window.dispatchEvent(new CustomEvent("trigger-open-palette"));
      else if (action === "view_editor") setActiveView("editor");
      else if (action === "view_canvas") setActiveView("canvas");
      else if (action === "view_graph") setActiveView("graph");
      else if (action === "view_calendar") setActiveView("calendar");
      else if (action === "view_tasks") setActiveView("tasks");
      else if (action === "view_board") setActiveView("board");
      else if (action === "view_flashcards") setActiveView("flashcards");
      else if (action === "toggle_chat") setIsChatOpen((prev) => !prev);
      else if (action === "toggle_sidebar") setIsSidebarVisible((prev) => !prev);
    });

    return () => {
      window.removeEventListener("cmd-switch-view", handleSwitchView);
      window.removeEventListener("trigger-open-settings", handleOpenSettings);
      window.removeEventListener("trigger-open-chat", handleOpenChat);
      window.removeEventListener("trigger-toggle-chat", handleToggleChat);
      window.removeEventListener("trigger-toggle-sidebar", handleToggleSidebar);
      unlistenMenu.then((f) => f());
    };
  }, [setActiveView]);

  // Register the file-system refresh as the first sync step
  useEffect(() => {
    registerSyncHandler(
      "vault-refresh",
      async () => {
        await refreshFiles();
        await triggerNotesScan();
      },
      "Sync vault files"
    );
    return () => unregisterSyncHandler("vault-refresh");
  }, [registerSyncHandler, unregisterSyncHandler, refreshFiles, triggerNotesScan]);

  // Initial automatic sync trigger on fresh app load
  useEffect(() => {
    const timer = setTimeout(() => {
      triggerSync();
    }, 400);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    store.get<number>("sidebarWidth").then((w) => {
      if (w && w >= 180 && w <= 450) {
        setSidebarWidth(w);
      }
    });
  }, []);

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newWidth = Math.max(180, Math.min(e.clientX, 450));
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (isResizingRef.current) {
        isResizingRef.current = false;
        store.set("sidebarWidth", sidebarWidth);
        store.save();
      }
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [sidebarWidth]);



  return (
    <div className="flex h-screen w-screen flex-col bg-background select-none root-layout-bg relative">
      {/* Titlebar */}
      <Titlebar
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* Main Area */}
      <div className="flex flex-1 w-full overflow-hidden">
        {/* Sidebar */}
        <div
          style={{ width: isSidebarVisible ? `${sidebarWidth}px` : "0px" }}
          className="h-full shrink-0 overflow-hidden transition-all duration-200"
        >
          <FileTree />
        </div>

        {/* Resizer */}
        {isSidebarVisible && (
          <div
            onMouseDown={startResize}
            className="w-px cursor-col-resize bg-white/5 hover:bg-indigo-500/40 transition-colors shrink-0 h-full"
          />
        )}

        {/* Dynamic Content Pane with Horizontal Tab Bar */}
        <div className="flex-1 h-full overflow-hidden flex flex-col">
          {/* Workspace Tabs */}
          {(activeView === "editor" || activeView === "canvas") && openFiles.length > 0 && (
            <div className="flex items-end bg-sidebar/80 backdrop-blur-sm border-b border-white/5 px-2 h-9 select-none shrink-0 gap-px w-full" style={{ boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.04)' }}>
              {/* Tabs List */}
              <div ref={tabsContainerRef} className="flex items-end flex-1 min-w-0 h-full overflow-hidden gap-px">
                {openFiles.map((tab) => {
                  const isActive = activeFile?.path === tab.path;
                  // Strip only .excalidraw and .md extensions — preserve attachment extensions for clarity
                  const displayName = tab.name.replace(/\.excalidraw$/, "").replace(/\.md$/, "");

                  return (
                    <div
                      key={tab.path}
                      draggable
                      onDragStart={(e) => handleDragStart(e, tab.path)}
                      onDragEnter={handleDragEnter}
                      onDragOver={handleDragOver}
                      onDrop={(e) => handleDropTab(e, tab.path)}
                      onDragEnd={handleDragEnd}
                      onClick={() => openFile(tab)}
                      onAuxClick={(e) => {
                        if (e.button === 1) { // Middle click closes tab
                          e.preventDefault();
                          closeFile(tab.path);
                        }
                      }}
                      className={`group flex items-center gap-1.5 h-7 px-2.5 text-[11px] rounded-t-md border-x border-t transition-all duration-150 cursor-pointer flex-1 min-w-12.5 max-w-40 ${isActive
                          ? "bg-card text-[#d946ef] border-card-border border-t-[#d946ef] font-semibold"
                          : "bg-transparent text-slate-500 hover:text-slate-300 hover:bg-card-hover/50 border-transparent"
                        }`}
                    >
                      {getTabIcon(tab, noteCache)}
                      <span className="truncate flex-1" title={tab.name}>{displayName}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          closeFile(tab.path);
                        }}
                        className={`ml-1 p-0.5 rounded-full hover:bg-slate-800 text-slate-500 hover:text-slate-300 transition-opacity ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                          }`}
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Right-Aligned Close Other Tabs Button with Dynamic Faint Glow when squished */}
              {openFiles.length > 1 && (
                <button
                  onClick={handleCloseOthers}
                  title="Close other tabs"
                  className={`mb-1 p-1 rounded-md transition-all cursor-pointer shrink-0 ml-1.5 flex items-center justify-center ${
                    isTabsSquished
                      ? "bg-rose-500/20 text-rose-400 border border-rose-500/40 shadow-[0_0_12px_rgba(244,63,94,0.4)] animate-pulse hover:bg-rose-500/30 hover:shadow-[0_0_16px_rgba(244,63,94,0.6)]"
                      : "text-slate-500 hover:text-rose-400 hover:bg-slate-800/80 border border-transparent"
                  }`}
                >
                  <SquareX className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Tabbed Viewport Content */}
          <div className="flex-1 min-h-0 relative overflow-hidden">
            <ViewErrorBoundary key={activeView} viewName={activeView}>
              {activeView === "editor" && (
                openFiles.length > 0 ? (
                  isAttachmentFile(activeFile) ? (
                    <AttachmentViewer file={activeFile!} />
                  ) : (
                    <Editor />
                  )
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center bg-background text-slate-500 select-none">
                    <div className="flex flex-col items-center gap-4 max-w-sm text-center">
                      <div className="p-4 rounded-full bg-white/5 border border-white/6 backdrop-blur-md shadow-xl">
                        <FileText className="h-8 w-8 text-[#d946ef]" />
                      </div>
                      <h3 className="text-sm font-semibold text-foreground">No open notes</h3>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Select a note from the file tree sidebar, or press <kbd className="bg-sidebar px-1.5 py-0.5 rounded border border-card-border text-indigo-500 dark:text-indigo-400 font-bold font-mono">Cmd + K</kbd> to find notes or run quick commands.
                      </p>
                    </div>
                  </div>
                )
              )}
              {activeView === "canvas" && (
                (activeFile && activeFile.name.endsWith(".excalidraw")) ? (
                  <Canvas />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center bg-background text-slate-500 select-none">
                    <div className="flex flex-col items-center gap-4 max-w-sm text-center">
                      <div className="p-4 rounded-full bg-white/5 border border-white/6 backdrop-blur-md shadow-xl">
                        <Network className="h-8 w-8 text-indigo-500" />
                      </div>
                      <h3 className="text-sm font-semibold text-slate-300">No open drawing canvases</h3>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Create or select an Excalidraw drawing canvas in the sidebar directory.
                      </p>
                    </div>
                  </div>
                )
              )}
              {activeView === "flashcards" && <FlashcardDashboard />}
              {activeView === "graph" && <GraphView />}
              {activeView === "calendar" && <CalendarView />}
              {activeView === "tasks" && <TasksView />}
              {activeView === "board" && <BoardView />}
            </ViewErrorBoundary>
          </div>
        </div>
      </div>

      {/* ── FLOATING LINEAR AI CHAT LAUNCHER BUTTON & MODAL ────────────────── */}
      {/* Extreme Bottom-Right Corner AI Chat Launcher Tab */}
      <div className="absolute bottom-0 right-0 z-90 flex items-center select-none">
        <div className="cmyk-glow-button-wrapper">
          <button
            onClick={handleToggleChat}
            className={`relative z-10 flex items-center gap-1.5 px-3.5 py-1.5 rounded-tl-xl border-t border-l shadow-2xl backdrop-blur-md cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95 group ${isChatOpen
                ? "bg-card/95 text-white border-cyan-500/50 shadow-cyan-500/20"
                : "bg-sidebar/95 hover:bg-card-hover/95 border-white/10 text-slate-200 hover:text-white"
              }`}
            title="Toggle KogNote AI Chat"
          >
            <div className="w-5 h-5 rounded-full bg-black flex items-center justify-center p-0.5 shrink-0 shadow-xs ring-1 ring-white/10">
              <img
                src={aiStaticIcon}
                alt="KogNote AI"
                className="w-3.5 h-3.5 object-contain"
              />
            </div>
            <span className="text-[11px] font-bold tracking-tight">KogNote AI</span>
          </button>
        </div>
      </div>

      {/* Floating Linear AI Chat Panel (Attached Dock vs Independent Detached Window) */}
      {isChatOpen && (
        <div
          className={`fixed transition-all duration-300 flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 ${
            isChatDetached
              ? "top-14 right-6 z-250 w-88 sm:w-96 h-130 max-w-[calc(100vw-32px)] max-h-[calc(100vh-80px)] bg-background/95 border border-indigo-500/50 rounded-2xl shadow-2xl shadow-indigo-500/20 backdrop-blur-md resize overflow-auto drop-shadow-2xl"
              : "bottom-5 right-5 z-100 w-78 sm:w-84 h-115 max-w-[calc(100vw-32px)] max-h-[calc(100vh-80px)] bg-background/95 border border-card-border/80 rounded-2xl shadow-xl backdrop-blur-md"
          }`}
        >
          <CopilotChat
            onClose={() => setIsChatOpen(false)}
            isDetached={isChatDetached}
            onToggleDetach={handleToggleDetach}
            onOpenSettings={() => setIsSettingsOpen(true)}
          />
        </div>
      )}

      {/* Settings Dialog Overlay */}
      <Settings isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {/* Spotlight Command Palette */}
      <CommandPalette />

      {/* Create New File Modal Overlay */}
      <CreateFileModal />
    </div>
  );
};
