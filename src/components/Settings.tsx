import React, { useState, useEffect, useCallback } from "react";
import { useSettings } from "../contexts/SettingsContext";
import { useSync } from "../contexts/SyncContext";
import { invokeIPC } from "../lib/ipc";
import {
  FolderOpen, X,
  Download, Trash2, Loader2,
  FileCode, Lock, Brain, Archive,
  Info, Globe, ExternalLink, ShieldCheck, Cpu, Sparkles, Clock,
  BookOpen, Layers, Edit, Waypoints, GraduationCap, CheckSquare, Wand2
} from "lucide-react";
import { aiService, type ModelStatus, type DownloadProgressEvent, type SystemHardwareInfo } from "../lib/local-ai";
import { DEFAULT_AGENTS_MD } from "../constants/defaultAgents";
import { formatTimestampForDisplay } from "../lib/frontmatter";
import logoImg from "../assets/logo.png";

const GithubIcon: React.FC<{ className?: string }> = ({ className = "h-4 w-4" }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

export type SettingsTab = "vault" | "timezone" | "ai" | "sysinfo" | "agents" | "docs" | "about";

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: SettingsTab;
}

export const Settings: React.FC<SettingsProps> = ({ isOpen, onClose, initialTab }) => {
  const {
    vaultPath,
    setVaultPath,
    aiProvider,
    setAiProvider,
    setAiLocalModel,
    aiApiUrl,
    setAiApiUrl,
    aiApiKey,
    setAiApiKey,
    aiApiModel,
    setAiApiModel,
    userTimezone,
    setUserTimezone,
    includeArchivedInScans,
    setIncludeArchivedInScans,
  } = useSettings();

  const { triggerSync } = useSync();

  // Active navigation tab on the left sidebar
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab || "vault");

  // Per-model download & load state
  const [models, setModels] = useState<ModelStatus[]>([]);
  const [loadedModel, setLoadedModel] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, DownloadProgressEvent>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [modelError, setModelError] = useState<Record<string, string>>({});

  // API connection test state
  const [apiStatus, setApiStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const [apiErrorMsg, setApiErrorMsg] = useState("");

  // AGENTS.md rules state (Read-Only)
  const [agentsContent, setAgentsContent] = useState("");

  const separator = vaultPath?.includes("\\") ? "\\" : "/";
  const agentsPath = vaultPath ? `${vaultPath}${separator}AGENTS.md` : "";

  const handleOpenWebsite = async (url: string = "https://kognitec.com/") => {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
    } catch {
      window.open(url, "_blank");
    }
  };

  const loadAgentsMd = useCallback(async () => {
    if (!agentsPath) {
      setAgentsContent(DEFAULT_AGENTS_MD);
      return;
    }
    try {
      const exists = await invokeIPC("fs_exists", { path: agentsPath }).catch(() => false);
      if (exists) {
        const text = (await invokeIPC("read_note", { path: agentsPath })) as string;
        setAgentsContent(text || DEFAULT_AGENTS_MD);
      } else {
        setAgentsContent(DEFAULT_AGENTS_MD);
      }
    } catch {
      setAgentsContent(DEFAULT_AGENTS_MD);
    }
  }, [agentsPath]);

  const [sysInfo, setSysInfo] = useState<SystemHardwareInfo | null>(null);

  const refreshModels = useCallback(async () => {
    try {
      const list = await aiService.listModels();
      setModels(list);
      const current = await aiService.currentModel();
      setLoadedModel(current);
      const hardware = await aiService.getSystemInfo().catch(() => null);
      if (hardware) setSysInfo(hardware);
    } catch (err) {
      console.error("Failed to list local models:", err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      if (initialTab) {
        setActiveTab(initialTab);
      }
      refreshModels();
      loadAgentsMd();
    }
  }, [isOpen, initialTab, refreshModels, loadAgentsMd]);

  const handleDownloadModel = async (modelId: string) => {
    setDownloadingId(modelId);
    setModelError((prev) => ({ ...prev, [modelId]: "" }));
    try {
      await aiService.downloadModel(modelId, (progress) => {
        setDownloadProgress((prev) => ({ ...prev, [modelId]: progress }));
      });
      await refreshModels();
    } catch (err: any) {
      console.error("Download failed:", err);
      setModelError((prev) => ({ ...prev, [modelId]: err?.message || String(err) }));
    } finally {
      setDownloadingId(null);
    }
  };

  const handleLoadModel = async (modelId: string) => {
    setLoadingId(modelId);
    setModelError((prev) => ({ ...prev, [modelId]: "" }));
    try {
      await aiService.loadModel(modelId);
      setAiLocalModel(modelId);
      setLoadedModel(modelId);
    } catch (err: any) {
      console.error("Failed to load model:", err);
      setModelError((prev) => ({ ...prev, [modelId]: err?.message || String(err) }));
    } finally {
      setLoadingId(null);
    }
  };

  const handleUnloadModel = async () => {
    try {
      await aiService.unloadModel();
      setLoadedModel(null);
    } catch (err: any) {
      console.error("Failed to unload model:", err);
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    try {
      await aiService.deleteModel(modelId);
      if (loadedModel === modelId) {
        setLoadedModel(null);
      }
      await refreshModels();
    } catch (err: any) {
      console.error("Failed to delete model:", err);
      setModelError((prev) => ({ ...prev, [modelId]: err?.message || String(err) }));
    }
  };

  const checkApiStatus = async () => {
    setApiStatus("checking");
    setApiErrorMsg("");
    try {
      const ok = await aiService.checkConnection();
      if (ok) {
        setApiStatus("ok");
      } else {
        setApiStatus("error");
        setApiErrorMsg("Unable to connect or invalid credentials.");
      }
    } catch (err: any) {
      setApiStatus("error");
      setApiErrorMsg(err?.message || String(err));
    }
  };

  const handleSelectVaultFolder = async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Vault Root Directory",
      });
      if (selected && typeof selected === "string") {
        setVaultPath(selected);
      }
    } catch (err) {
      console.error("Failed to select folder:", err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center bg-black/75 animate-fade-in p-4 selection:bg-indigo-600/30">
      <div className="flex flex-col bg-white dark:bg-[#121425] rounded-2xl border border-slate-200 dark:border-card-border w-full max-w-4xl h-[85vh] max-h-180 min-h-130 shadow-2xl overflow-hidden animate-modal-pop">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-card-border/80 px-6 py-3.5 bg-slate-50/80 dark:bg-sidebar/50 shrink-0">
          <div className="flex items-center gap-2.5">
            <img src={logoImg} alt="KogNote Logo" className="h-6 w-6 object-contain rounded-md shadow-xs" />
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">App & AI Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200 dark:text-slate-400 dark:hover:text-white dark:hover:bg-card-border transition-colors cursor-pointer"
            title="Close Settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Split 2-Column Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          
          {/* LEFT COLUMN: Headings / Section Navigation */}
          <div className="w-56 bg-slate-100/90 dark:bg-sidebar border-r border-slate-200 dark:border-card-border/60 p-3 flex flex-col gap-1 shrink-0 overflow-y-auto select-none">
            <span className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Preferences
            </span>

            {[
              { id: "vault", label: "Vault Storage", icon: FolderOpen, desc: "Path & scan filters" },
              { id: "timezone", label: "Timezone & Date", icon: Clock, desc: "Regional formatting" },
              { id: "ai", label: "AI Engine & Models", icon: Brain, desc: "Local GGUF & API keys" },
              { id: "sysinfo", label: "Hardware & Stats", icon: Cpu, desc: "System diagnostics" },
              { id: "agents", label: "AI Rules (AGENTS)", icon: FileCode, desc: "Protected schemas" },
              { id: "docs", label: "Documentation", icon: BookOpen, desc: "User manual & guides" },
              { id: "about", label: "About KogNote", icon: Info, desc: "App & Kognitec specs" },
            ].map((sec) => {
              const Icon = sec.icon;
              const isActive = activeTab === sec.id;
              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => setActiveTab(sec.id as any)}
                  className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all cursor-pointer group ${
                    isActive
                      ? "bg-white dark:bg-indigo-600/20 text-indigo-700 dark:text-indigo-300 font-bold border-l-3 border-indigo-600 dark:border-indigo-400 shadow-xs"
                      : "text-slate-600 dark:text-slate-400 hover:bg-slate-200/60 dark:hover:bg-card-hover hover:text-slate-900 dark:hover:text-slate-200"
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 mt-0.5 ${isActive ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-slate-400 group-hover:text-indigo-500"}`} />
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs truncate">{sec.label}</span>
                    <span className="text-[10px] opacity-75 truncate font-normal">{sec.desc}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* RIGHT COLUMN: Active Section Content */}
          <div className="flex-1 overflow-y-auto p-6 bg-white dark:bg-[#121425] text-slate-900 dark:text-slate-100">
            
            {/* 1. VAULT STORAGE */}
            {activeTab === "vault" && (
              <div className="flex flex-col gap-6 animate-fade-in">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    Vault Storage Location
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
                    Select the root folder where all your plain Markdown (.md) files, Daily Notes, and canvas attachments are stored on disk.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex-1 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-slate-800 px-3.5 py-2.5 text-xs text-slate-800 dark:text-slate-200 font-mono truncate shadow-2xs">
                    {vaultPath || "No vault path set"}
                  </div>
                  <button
                    onClick={handleSelectVaultFolder}
                    className="flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-4 py-2.5 transition-all active:scale-95 cursor-pointer shrink-0 shadow-md"
                  >
                    <FolderOpen className="h-4 w-4" />
                    Browse Folder
                  </button>
                </div>

                <div className="pt-5 border-t border-slate-200 dark:border-card-border/80 flex flex-col gap-4">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                    <Archive className="h-4 w-4 text-sky-500 dark:text-sky-400" /> Vault Scan & Storage Filters
                  </h4>

                  <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-slate-800 shadow-2xs">
                    <div className="flex flex-col gap-1 pr-4">
                      <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <Archive className="h-4 w-4 text-sky-500 dark:text-sky-400" /> Include Archived Folder & Notes in Scans
                      </span>
                      <span className="text-[11.5px] text-slate-600 dark:text-slate-400 leading-snug">
                        When ON, notes inside <code className="text-sky-700 dark:text-sky-300 bg-slate-200 dark:bg-sky-950/50 px-1.5 py-0.5 rounded font-mono text-[11px]">/Archived/</code> or with frontmatter <code className="text-sky-700 dark:text-sky-300 bg-slate-200 dark:bg-sky-950/50 px-1.5 py-0.5 rounded font-mono text-[11px]">storage: archived</code> will be included in Task lists, Calendar, Flashcards, Board, and Graph.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIncludeArchivedInScans(!includeArchivedInScans);
                        setTimeout(triggerSync, 50);
                      }}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        includeArchivedInScans ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-700"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                          includeArchivedInScans ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* 2. TIMEZONE & DATE DISPLAY */}
            {activeTab === "timezone" && (
              <div className="flex flex-col gap-6 animate-fade-in">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                    Timezone & Date Display
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
                    All notes store metadata timestamps in native UTC ISO format (<code className="text-indigo-700 dark:text-indigo-300 bg-slate-200 dark:bg-indigo-950/50 px-1.5 py-0.5 rounded font-mono text-[11px]">new Date().toISOString()</code>). Select your preferred timezone below to customize how timestamps and dates are formatted across the inspector, calendar, and task lists.
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Select Target Timezone
                  </label>
                  <select
                    value={userTimezone}
                    onChange={(e) => setUserTimezone(e.target.value)}
                    className="w-full rounded-xl bg-slate-50 dark:bg-card border border-slate-300 dark:border-slate-800 px-3.5 py-2.5 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500 cursor-pointer font-mono shadow-2xs"
                  >
                    {[
                      { value: "auto", base: "System Default (Auto)" },
                      { value: "UTC", base: "UTC (Coordinated Universal Time)" },
                      { value: "America/New_York", base: "Eastern Time (US & Canada) - EST/EDT" },
                      { value: "America/Chicago", base: "Central Time (US & Canada) - CST/CDT" },
                      { value: "America/Denver", base: "Mountain Time (US & Canada) - MST/MDT" },
                      { value: "America/Los_Angeles", base: "Pacific Time (US & Canada) - PST/PDT" },
                      { value: "Europe/London", base: "London / GMT / BST" },
                      { value: "Europe/Paris", base: "Paris / Berlin / Rome - CET/CEST" },
                      { value: "Europe/Moscow", base: "Moscow - MSK" },
                      { value: "Asia/Kolkata", base: "India Standard Time - IST" },
                      { value: "Asia/Dubai", base: "Gulf Standard Time - GST" },
                      { value: "Asia/Singapore", base: "Singapore Standard Time - SGT" },
                      { value: "Asia/Tokyo", base: "Japan Standard Time - JST" },
                      { value: "Australia/Sydney", base: "Australian Eastern Time - AEST/AEDT" },
                    ].map((tz) => {
                      const getDynamicUtcOffset = (tzValue: string): string => {
                        try {
                          const targetTz = tzValue === "auto" ? Intl.DateTimeFormat().resolvedOptions().timeZone : tzValue;
                          const now = new Date();
                          const parts = new Intl.DateTimeFormat("en-US", {
                            timeZone: targetTz,
                            timeZoneName: "shortOffset",
                          }).formatToParts(now);
                          const tzPart = parts.find((p) => p.type === "timeZoneName")?.value || "";
                          let offset = tzPart.replace(/^GMT/, "UTC");
                          if (offset === "UTC") offset = "UTC+00:00";
                          return offset;
                        } catch {
                          return "";
                        }
                      };

                      const offset = getDynamicUtcOffset(tz.value);
                      const displayLabel = tz.value === "auto"
                        ? `${tz.base} (${Intl.DateTimeFormat().resolvedOptions().timeZone} - ${offset})`
                        : `${tz.base} (${offset})`;

                      return (
                        <option key={tz.value} value={tz.value}>
                          {displayLabel}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Live Formatted Timestamp Preview */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-slate-800 flex flex-col gap-2.5 shadow-2xs">
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Clock className="h-4 w-4 text-cyan-600 dark:text-cyan-400" /> Live Date Format Preview
                  </span>
                  <div className="flex flex-col gap-1.5 font-mono text-xs">
                    <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                      <span>Stored UTC String:</span>
                      <span className="text-slate-900 dark:text-slate-200 font-semibold">{new Date().toISOString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-800/80">
                      <span>Formatted Display:</span>
                      <span className="text-cyan-700 dark:text-cyan-300 font-bold">{formatTimestampForDisplay(new Date().toISOString(), userTimezone)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 3. AI ENGINE & MODELS */}
            {activeTab === "ai" && (
              <div className="flex flex-col gap-6 animate-fade-in">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Brain className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    AI Inference Engine & Models
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
                    Choose between 100% offline Local GGUF models or cloud provider API keys (Anthropic, Gemini, OpenAI).
                  </p>
                </div>

                {/* Provider Selector */}
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Select Engine Provider</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { id: "local", label: "Local (GGUF)" },
                      { id: "anthropic", label: "Claude" },
                      { id: "gemini", label: "Gemini" },
                      { id: "openai", label: "OpenAI / Custom" },
                    ].map((prov) => (
                      <button
                        key={prov.id}
                        type="button"
                        onClick={() => setAiProvider(prov.id as any)}
                        className={`py-2.5 px-3 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                          aiProvider === prov.id
                            ? "bg-indigo-600 border-indigo-500 text-white shadow-md font-bold"
                            : "bg-slate-50 dark:bg-card border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-card-hover"
                        }`}
                      >
                        {prov.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Local Provider Section */}
                {aiProvider === "local" && (
                  <div className="flex flex-col gap-4">
                    {sysInfo && (
                      <div className="flex flex-col gap-2.5 p-4 rounded-xl bg-indigo-50/70 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30 text-xs text-indigo-900 dark:text-indigo-300 shadow-2xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Cpu className="h-4 w-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                            <span className="font-bold text-slate-900 dark:text-slate-100 text-xs">Hardware Auto-Detected</span>
                          </div>
                          <span className="text-[9.5px] font-mono bg-indigo-100 dark:bg-indigo-500/20 border border-indigo-200 dark:border-indigo-500/40 px-2.5 py-0.5 rounded-full font-bold text-indigo-800 dark:text-indigo-200">
                            CPU • RAM • GPU Scanned
                          </span>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 py-1 text-[10.5px]">
                          <div className="p-2.5 rounded-lg bg-white/80 dark:bg-card/60 border border-indigo-200 dark:border-indigo-500/20 flex flex-col">
                            <span className="text-[9px] text-slate-500 dark:text-slate-400 uppercase font-bold">CPU & Cores</span>
                            <span className="font-semibold text-slate-900 dark:text-slate-200 truncate">{sysInfo.cpu_brand || "System CPU"} ({sysInfo.cpu_cores} Cores)</span>
                          </div>

                          <div className="p-2.5 rounded-lg bg-white/80 dark:bg-card/60 border border-indigo-200 dark:border-indigo-500/20 flex flex-col">
                            <span className="text-[9px] text-slate-500 dark:text-slate-400 uppercase font-bold">Memory (RAM)</span>
                            <span className="font-semibold text-amber-700 dark:text-amber-300 font-mono">{sysInfo.total_ram_gb.toFixed(1)} GB Total RAM</span>
                          </div>

                          <div className="p-2.5 rounded-lg bg-white/80 dark:bg-card/60 border border-indigo-200 dark:border-indigo-500/20 flex flex-col">
                            <span className="text-[9px] text-slate-500 dark:text-slate-400 uppercase font-bold">Graphics / GPU</span>
                            <span className="font-semibold text-emerald-700 dark:text-emerald-300 truncate">{sysInfo.gpu_name || "Integrated Graphics"}</span>
                          </div>
                        </div>

                        {sysInfo.recommendation_reason && (
                          <div className="flex items-center gap-1.5 text-[10.5px] text-indigo-800 dark:text-indigo-200 font-medium pt-1.5 border-t border-indigo-200 dark:border-indigo-500/20">
                            <Sparkles className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                            <span><strong>Recommendation:</strong> {sysInfo.recommendation_reason}</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-col gap-3">
                      <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Available Local Models</span>

                      {models.map((m) => {
                        const isRecommended = sysInfo && sysInfo.recommended_model_id === m.id;
                        const isDownloaded = m.downloaded;
                        const isLoaded = loadedModel === m.id;
                        const isDownloading = downloadingId === m.id;
                        const isLoading = loadingId === m.id;
                        const prog = downloadProgress[m.id];
                        const err = modelError[m.id];

                        return (
                          <div
                            key={m.id}
                            className={`flex flex-col gap-2.5 p-4 rounded-xl border text-xs transition-all ${
                              isRecommended
                                ? "bg-indigo-50/40 dark:bg-card border-indigo-300 dark:border-indigo-500/50 shadow-sm ring-1 ring-indigo-500/30"
                                : "bg-slate-50/50 dark:bg-card border-slate-200 dark:border-slate-800"
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex flex-col gap-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                                    {m.display_name || m.id}
                                  </span>
                                  {isRecommended && (
                                    <span className="text-[9px] font-extrabold text-indigo-800 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-500/20 border border-indigo-300 dark:border-indigo-500/40 px-2 py-0.5 rounded-full flex items-center gap-1">
                                      <Sparkles className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                                      RECOMMENDED FOR YOUR SYSTEM
                                    </span>
                                  )}
                                  {isLoaded && (
                                    <span className="text-[9px] font-bold text-emerald-800 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-500/10 border border-emerald-300 dark:border-emerald-500/30 px-2 py-0.5 rounded-full">
                                      Active Model
                                    </span>
                                  )}
                                </div>

                                <span className="text-[11.5px] text-slate-600 dark:text-slate-400 leading-normal">
                                  {m.description}
                                </span>

                                <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[10px]">
                                  <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-[#161825] border border-slate-300 dark:border-slate-800 text-slate-800 dark:text-slate-300">
                                    💾 {m.size_bytes ? `${(m.size_bytes / (1024 * 1024 * 1024)).toFixed(1)} GB File` : "GGUF"}
                                  </span>
                                  <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-[#161825] border border-slate-300 dark:border-slate-800 text-amber-800 dark:text-amber-300 font-semibold">
                                    🧠 Req: {m.ram_required}
                                  </span>
                                  <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-[#161825] border border-slate-300 dark:border-slate-800 text-indigo-800 dark:text-indigo-300 font-semibold">
                                    {m.speed_rating}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0 pt-0.5">
                                {!isDownloaded ? (
                                  <button
                                    onClick={() => handleDownloadModel(m.id)}
                                    disabled={isDownloading}
                                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs disabled:opacity-50 transition cursor-pointer shadow-md"
                                  >
                                    {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                                    <span>{isDownloading ? "Downloading..." : "Download"}</span>
                                  </button>
                                ) : isLoaded ? (
                                  <button
                                    onClick={handleUnloadModel}
                                    className="px-3.5 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-300 font-semibold text-xs transition cursor-pointer"
                                  >
                                    Unload
                                  </button>
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      onClick={() => handleLoadModel(m.id)}
                                      disabled={isLoading}
                                      className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs disabled:opacity-50 transition cursor-pointer shadow-md"
                                    >
                                      {isLoading ? "Booting..." : "Select & Boot"}
                                    </button>
                                    <button
                                      onClick={() => handleDeleteModel(m.id)}
                                      className="p-2 rounded-xl text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition cursor-pointer"
                                      title="Delete model file"
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>

                            {isDownloading && prog && (
                              <div className="flex flex-col gap-1.5 mt-1 p-2.5 rounded-xl bg-slate-100 dark:bg-card border border-slate-200 dark:border-slate-800">
                                <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                                  <div className="h-full bg-indigo-600 dark:bg-indigo-500 transition-all duration-200" style={{ width: `${prog.percent}%` }} />
                                </div>
                                <div className="flex items-center justify-between text-[9.5px] text-slate-600 dark:text-slate-400 font-mono">
                                  <span>
                                    {prog.status === "downloading_runtime"
                                      ? "Setting up AI runtime engine (llama-server)..."
                                      : `${prog.percent}% completed`}
                                  </span>
                                  <span>
                                    {(prog.downloaded_bytes / (1024 * 1024)).toFixed(1)} MB / {(prog.total_bytes / (1024 * 1024)).toFixed(1)} MB
                                  </span>
                                </div>
                              </div>
                            )}

                            {err && <span className="text-[10.5px] text-rose-600 dark:text-red-400 font-mono mt-1">⚠️ {err}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Cloud Providers Options */}
                {aiProvider === "anthropic" && (
                  <div className="flex flex-col gap-4 bg-slate-50 dark:bg-card p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-xs shadow-2xs">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Anthropic API Key</span>
                      <input
                        type="password"
                        value={aiApiKey}
                        onChange={(e) => setAiApiKey(e.target.value)}
                        placeholder="sk-ant-..."
                        className="w-full rounded-xl bg-white dark:bg-[#161825] px-3.5 py-2.5 text-xs text-slate-900 dark:text-slate-200 border border-slate-300 dark:border-slate-800 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Model Select</span>
                      <select
                        value={aiApiModel}
                        onChange={(e) => setAiApiModel(e.target.value)}
                        className="w-full rounded-xl bg-white dark:bg-[#161825] px-3.5 py-2.5 text-xs text-slate-900 dark:text-slate-200 border border-slate-300 dark:border-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
                      >
                        <option value="claude-3-5-sonnet-latest">Claude 3.5 Sonnet (claude-3-5-sonnet-latest)</option>
                        <option value="claude-3-5-haiku-latest">Claude 3.5 Haiku (claude-3-5-haiku-latest)</option>
                        <option value="claude-3-opus-latest">Claude 3 Opus (claude-3-opus-latest)</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="text-slate-600 dark:text-slate-400">
                        Status:{" "}
                        {apiStatus === "checking" && <span className="text-amber-600 dark:text-amber-400 font-semibold">Testing key...</span>}
                        {apiStatus === "ok" && <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓ Connected</span>}
                        {apiStatus === "error" && <span className="text-rose-600 dark:text-red-400 font-semibold">Verification failed</span>}
                      </span>
                      <button
                        onClick={checkApiStatus}
                        className="rounded-xl bg-slate-200 dark:bg-card-border border border-slate-300 dark:border-slate-800 px-3.5 py-1.5 font-semibold text-xs text-slate-800 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-800 transition-all cursor-pointer shadow-xs"
                      >
                        Test Connection
                      </button>
                    </div>
                    {apiErrorMsg && <span className="text-[10.5px] text-rose-600 dark:text-red-400 font-mono">⚠️ {apiErrorMsg}</span>}
                  </div>
                )}

                {aiProvider === "gemini" && (
                  <div className="flex flex-col gap-4 bg-slate-50 dark:bg-card p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-xs shadow-2xs">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Google AI Studio API Key</span>
                      <input
                        type="password"
                        value={aiApiKey}
                        onChange={(e) => setAiApiKey(e.target.value)}
                        placeholder="AIzaSy..."
                        className="w-full rounded-xl bg-white dark:bg-[#161825] px-3.5 py-2.5 text-xs text-slate-900 dark:text-slate-200 border border-slate-300 dark:border-slate-800 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Model Select</span>
                      <select
                        value={aiApiModel}
                        onChange={(e) => setAiApiModel(e.target.value)}
                        className="w-full rounded-xl bg-white dark:bg-[#161825] px-3.5 py-2.5 text-xs text-slate-900 dark:text-slate-200 border border-slate-300 dark:border-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
                      >
                        <option value="gemini-1.5-flash">Gemini 1.5 Flash (gemini-1.5-flash)</option>
                        <option value="gemini-1.5-pro">Gemini 1.5 Pro (gemini-1.5-pro)</option>
                        <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash (gemini-2.0-flash-exp)</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="text-slate-600 dark:text-slate-400">
                        Status:{" "}
                        {apiStatus === "checking" && <span className="text-amber-600 dark:text-amber-400 font-semibold">Testing key...</span>}
                        {apiStatus === "ok" && <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓ Connected</span>}
                        {apiStatus === "error" && <span className="text-rose-600 dark:text-red-400 font-semibold">Verification failed</span>}
                      </span>
                      <button
                        onClick={checkApiStatus}
                        className="rounded-xl bg-slate-200 dark:bg-card-border border border-slate-300 dark:border-slate-800 px-3.5 py-1.5 font-semibold text-xs text-slate-800 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-800 transition-all cursor-pointer shadow-xs"
                      >
                        Test Connection
                      </button>
                    </div>
                    {apiErrorMsg && <span className="text-[10.5px] text-rose-600 dark:text-red-400 font-mono">⚠️ {apiErrorMsg}</span>}
                  </div>
                )}

                {(aiProvider === "openai" || aiProvider === "api") && (
                  <div className="flex flex-col gap-4 bg-slate-50 dark:bg-card p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-xs shadow-2xs">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Base URL Endpoint</span>
                      <input
                        type="text"
                        value={aiApiUrl}
                        onChange={(e) => setAiApiUrl(e.target.value)}
                        placeholder="https://api.openai.com/v1"
                        className="w-full rounded-xl bg-white dark:bg-[#161825] px-3.5 py-2.5 text-xs text-slate-900 dark:text-slate-200 border border-slate-300 dark:border-slate-800 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">API Key</span>
                      <input
                        type="password"
                        value={aiApiKey}
                        onChange={(e) => setAiApiKey(e.target.value)}
                        placeholder="sk-..."
                        className="w-full rounded-xl bg-white dark:bg-[#161825] px-3.5 py-2.5 text-xs text-slate-900 dark:text-slate-200 border border-slate-300 dark:border-slate-800 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">Model Name</span>
                      <input
                        type="text"
                        value={aiApiModel}
                        onChange={(e) => setAiApiModel(e.target.value)}
                        placeholder="gpt-4o-mini"
                        className="w-full rounded-xl bg-white dark:bg-[#161825] px-3.5 py-2.5 text-xs text-slate-900 dark:text-slate-200 border border-slate-300 dark:border-slate-800 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="text-slate-600 dark:text-slate-400">
                        Status:{" "}
                        {apiStatus === "checking" && <span className="text-amber-600 dark:text-amber-400 font-semibold">Testing...</span>}
                        {apiStatus === "ok" && <span className="text-emerald-600 dark:text-emerald-400 font-semibold">✓ Connected</span>}
                        {apiStatus === "error" && <span className="text-rose-600 dark:text-red-400 font-semibold">Auth failed</span>}
                      </span>
                      <button
                        onClick={checkApiStatus}
                        className="rounded-xl bg-slate-200 dark:bg-card-border border border-slate-300 dark:border-slate-800 px-3.5 py-1.5 font-semibold text-xs text-slate-800 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-800 transition-all cursor-pointer shadow-xs"
                      >
                        Test Connection
                      </button>
                    </div>
                    {apiErrorMsg && <span className="text-[10.5px] text-rose-600 dark:text-red-400 font-mono">⚠️ {apiErrorMsg}</span>}
                  </div>
                )}
              </div>
            )}

            {/* 4. HARDWARE & SYSTEM DIAGNOSTICS */}
            {activeTab === "sysinfo" && (
              <div className="flex flex-col gap-6 animate-fade-in">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Cpu className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    Hardware & System Diagnostics
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
                    System specifications and hardware capabilities scanned by native Rust system hooks.
                  </p>
                </div>

                {sysInfo ? (
                  <div className="flex flex-col gap-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div className="p-4 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-slate-800 flex flex-col gap-1 shadow-2xs">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Processor / CPU</span>
                        <span className="font-bold text-slate-900 dark:text-slate-100 text-sm truncate">{sysInfo.cpu_brand || "System CPU"}</span>
                        <span className="text-[11px] text-slate-600 dark:text-slate-400">{sysInfo.cpu_cores} Physical & Logical Cores</span>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-slate-800 flex flex-col gap-1 shadow-2xs">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Total Memory (RAM)</span>
                        <span className="font-bold text-amber-700 dark:text-amber-300 text-sm font-mono">{sysInfo.total_ram_gb.toFixed(1)} GB</span>
                        <span className="text-[11px] text-slate-600 dark:text-slate-400">Available System RAM</span>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-slate-800 flex flex-col gap-1 shadow-2xs">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">Graphics Accelerator</span>
                        <span className="font-bold text-emerald-700 dark:text-emerald-300 text-sm truncate">{sysInfo.gpu_name || "Integrated Graphics"}</span>
                        <span className="text-[11px] text-slate-600 dark:text-slate-400">GPU Offload Ready</span>
                      </div>

                      <div className="p-4 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-slate-800 flex flex-col gap-1 shadow-2xs">
                        <span className="text-[10px] font-bold text-slate-500 uppercase">System Timezone & Location</span>
                        <span className="font-bold text-sky-700 dark:text-sky-300 text-sm truncate">
                          {Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"}
                        </span>
                        <span className="text-[11px] text-slate-600 dark:text-slate-400 font-mono">
                          {(() => {
                            try {
                              const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
                              const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date());
                              const tzPart = parts.find(p => p.type === "timeZoneName")?.value || "";
                              let offset = tzPart.replace(/^GMT/, "UTC");
                              if (offset === "UTC") offset = "UTC+00:00";
                              return `${offset} • System Local`;
                            } catch {
                              return "Detected System Local";
                            }
                          })()}
                        </span>
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-indigo-50/70 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/30 flex flex-col gap-2 text-xs">
                      <span className="font-bold text-indigo-900 dark:text-indigo-200 text-xs flex items-center gap-1.5">
                        <Sparkles className="h-4 w-4 text-indigo-600 dark:text-indigo-400" /> System Compatibility Rating
                      </span>
                      <p className="text-indigo-800 dark:text-indigo-300 leading-relaxed text-xs">
                        {sysInfo.recommendation_reason || "Your system is ready to run offline GGUF local models and native vector embeddings."}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="p-6 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-slate-800 text-center text-slate-500 text-xs">
                    Scanning hardware specifications...
                  </div>
                )}
              </div>
            )}

            {/* 5. AI RULES (AGENTS.md) */}
            {activeTab === "agents" && (
              <div className="flex flex-col gap-6 animate-fade-in">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <FileCode className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    AI Guidelines & Formatting Rules (AGENTS.md)
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed mt-1">
                    System rules and protected metadata schemas used by AI actions to edit notes without breaking tags or frontmatter.
                  </p>
                </div>

                {/* Protected Core Metadata System Context */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-slate-800 flex flex-col gap-2.5 shadow-2xs">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400">
                    <Lock className="h-4 w-4 shrink-0" />
                    <span>Core Protected Metadata Context & Schemas</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    KogNote enforces standard metadata schemas across all notes to keep features in sync:
                  </p>
                  <ul className="text-[11px] font-mono text-slate-800 dark:text-slate-300 space-y-2 list-disc pl-4 bg-slate-100 dark:bg-black/40 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800">
                    <li><strong>Tasks & Priorities</strong>: <code className="text-emerald-600 dark:text-emerald-400 font-bold">- [ ] Task text @YYYY-MM-DD [HH:mm] !!! #tag</code></li>
                    <li><strong>Kanban Status & Priority</strong>: <code className="text-slate-600 dark:text-slate-300 font-bold">status: backlog | todo | in-progress | in-review | done</code> · <code className="text-slate-600 dark:text-slate-300 font-bold">priority: high | medium | low</code> · <code className="text-slate-600 dark:text-slate-300 font-bold">due: YYYY-MM-DD</code></li>
                    <li><strong>WikiLinks & Tags</strong>: <code className="text-sky-600 dark:text-sky-400 font-bold">[[Target Note Title]]</code> · <code className="text-sky-600 dark:text-sky-400 font-bold">[[Note#Section]]</code> · <code className="text-sky-600 dark:text-sky-400 font-bold">[[Note|Alias]]</code> · <code className="text-sky-600 dark:text-sky-400 font-bold">#tag-name</code></li>
                    <li><strong>Flashcards Syntax</strong>: <code className="text-amber-600 dark:text-amber-400 font-bold">@flashcard ( Question :: Answer )</code> or <code className="text-amber-600 dark:text-amber-400 font-bold">@flashcards ( Question :: Answer )</code></li>
                    <li><strong>AI Block Diffs</strong>: <code className="text-indigo-600 dark:text-indigo-400 font-bold">&lt;&lt;&lt;&lt;&lt;&lt;&lt; SEARCH \n [existing] \n ======= \n [updated] \n &gt;&gt;&gt;&gt;&gt;&gt;&gt; REPLACE</code></li>
                  </ul>
                </div>

                {/* System Vault AI Rules (Read-Only AGENTS.md) */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-700 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Lock className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" /> System Vault AI Rules (AGENTS.md)
                    </span>
                    <span className="text-[10px] font-bold text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-500/10 px-2.5 py-0.5 rounded-full border border-indigo-200 dark:border-indigo-500/20">
                      Read-Only System Guidelines
                    </span>
                  </div>

                  <div className="w-full rounded-xl bg-slate-900 border border-slate-800 p-4 text-xs text-slate-200 font-mono leading-relaxed max-h-72 overflow-y-auto select-text shadow-inner">
                    {agentsContent ? (
                      <pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-200 leading-relaxed">
                        {agentsContent}
                      </pre>
                    ) : (
                      <div className="text-slate-500 text-center py-4 italic text-xs">
                        No custom AGENTS.md override found in vault. System default guidelines active.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 6. DOCUMENTATION & USER MANUAL */}
            {activeTab === "docs" && (
              <div className="flex flex-col gap-6 animate-fade-in">
                {/* Hero Banner with GitHub Button */}
                <div className="flex items-center justify-between p-4.5 rounded-2xl bg-linear-to-r from-indigo-500/10 via-purple-500/5 to-pink-500/10 dark:from-indigo-950/60 dark:via-card dark:to-purple-950/40 border border-indigo-200 dark:border-indigo-500/20 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-indigo-600 text-white shadow-md">
                      <BookOpen className="h-6 w-6" />
                    </div>
                    <div className="flex flex-col">
                      <h3 className="text-base font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                        KogNote Documentation & User Guide
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Complete reference manual for notes, canvas, graph, flashcards, tasks & AI rules.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleOpenWebsite("https://github.com/kognitec/Kognote?tab=readme-ov-file")}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white font-semibold text-xs transition-all active:scale-95 cursor-pointer shadow-md shrink-0 border border-slate-700/50"
                    title="Open KogNote GitHub Repository & README"
                  >
                    <GithubIcon className="h-4 w-4 text-white" />
                    <span>View on GitHub</span>
                    <ExternalLink className="h-3 w-3 text-slate-400" />
                  </button>
                </div>

                {/* System Architecture Flow Diagram */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-card-border/80 flex flex-col gap-3 shadow-2xs">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-indigo-500" /> Local System Architecture & Data Flow
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-center text-xs">
                    <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center gap-1 shadow-2xs">
                      <FolderOpen className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                      <span className="font-bold text-slate-800 dark:text-slate-200 text-[11px]">Local Vault (.md)</span>
                      <span className="text-[9.5px] text-slate-500">Plaintext Markdown</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center gap-1 shadow-2xs">
                      <Layers className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                      <span className="font-bold text-slate-800 dark:text-slate-200 text-[11px]">In-Memory Parser</span>
                      <span className="text-[9.5px] text-slate-500">WikiLinks & Cache</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center gap-1 shadow-2xs">
                      <Cpu className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="font-bold text-slate-800 dark:text-slate-200 text-[11px]">Vector Engine</span>
                      <span className="text-[9.5px] text-slate-500">sqlite-vec Search</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center gap-1 shadow-2xs">
                      <Brain className="h-4 w-4 text-amber-500" />
                      <span className="font-bold text-slate-800 dark:text-slate-200 text-[11px]">AI Copilot</span>
                      <span className="text-[9.5px] text-slate-500">AGENTS.md Rules</span>
                    </div>
                  </div>
                </div>

                {/* Core Feature Sections Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* 1. Markdown Editor & Syntax */}
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-card-border/80 flex flex-col gap-2 shadow-2xs">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <Edit className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                      1. Editor, WikiLinks & Frontmatter
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      KogNote features dual WYSIWYG & Source split editing with auto-save.
                    </p>
                    <div className="mt-1 p-2.5 rounded-lg bg-white dark:bg-slate-950/80 border border-slate-200 dark:border-slate-800 font-mono text-[10.5px] text-slate-700 dark:text-slate-300 flex flex-col gap-1">
                      <div><span className="text-indigo-500 font-bold">[[Note Name]]</span> — Internal WikiLink</div>
                      <div><span className="text-purple-500 font-bold">[[Note|Custom Alias]]</span> — Custom link label</div>
                      <div><span className="text-pink-500 font-bold">[[Note#Section Header]]</span> — Direct section header link</div>
                      <div><span className="text-amber-500 font-bold">due: @2026-08-05 14:00</span> — Calendar date & time sync</div>
                      <div><span className="text-emerald-500 font-bold">priority: High | Medium | Low</span> — Task priority level</div>
                    </div>
                  </div>

                  {/* 2. Whiteboard Canvas & Excalidraw */}
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-card-border/80 flex flex-col gap-2 shadow-2xs">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <Layers className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                      2. Spatial Whiteboard Canvas
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Infinite vector canvas powered by Excalidraw. Drag & drop note cards, images, sticky notes, and connect ideas visually.
                    </p>
                    <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 list-disc list-inside mt-1">
                      <li>Saved natively as <code className="text-purple-500 bg-purple-500/10 px-1 py-0.5 rounded font-mono text-[10.5px]">.excalidraw</code> files in your vault.</li>
                      <li>Double-click any node to open its full markdown note.</li>
                      <li>Embed drawings directly inside markdown documents.</li>
                    </ul>
                  </div>

                  {/* 3. Knowledge Graph */}
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-card-border/80 flex flex-col gap-2 shadow-2xs">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <Waypoints className="h-4 w-4 text-sky-500" />
                      3. Interactive Knowledge Graph
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      2D force-directed physics graph visualizing all bidirectional links, tags, and daily logs across your vault.
                    </p>
                    <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 list-disc list-inside mt-1">
                      <li>Nodes size dynamically based on link count (hubs).</li>
                      <li>Filter nodes by tag (<code className="text-sky-500 bg-sky-500/10 px-1 py-0.5 rounded font-mono text-[10.5px]">#study</code>, <code className="text-sky-500 bg-sky-500/10 px-1 py-0.5 rounded font-mono text-[10.5px]">#project</code>).</li>
                      <li>Click any node to navigate instantly to that note.</li>
                    </ul>
                  </div>

                  {/* 4. AI Copilot & AGENTS.md Directive */}
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-card-border/80 flex flex-col gap-2 shadow-2xs">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <Wand2 className="h-4 w-4 text-amber-500" />
                      4. AI Copilot & System Directives
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Dual-engine AI supporting 100% offline local models (Qwen 2.5 Coder 3B) via GGUF, as well as OpenAI, Gemini & Anthropic APIs.
                    </p>
                    <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 list-disc list-inside mt-1">
                      <li>Controlled by <strong className="text-slate-800 dark:text-slate-200">AGENTS.md</strong> system rules stored in your vault root.</li>
                      <li>AI Smart Actions: Format, Continue Writing, Rewrite, Suggest Links.</li>
                      <li>RAG vector search across all notes in your vault.</li>
                    </ul>
                  </div>

                  {/* 5. Flashcard Review Deck */}
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-card-border/80 flex flex-col gap-2 shadow-2xs">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <GraduationCap className="h-4 w-4 text-amber-500" />
                      5. Spaced-Repetition Flashcards
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Automatically scans notes for flashcards formatted with <code className="text-amber-500 bg-amber-500/10 px-1 py-0.5 rounded font-mono text-[10.5px]">Q: ... / A: ...</code> syntax.
                    </p>
                    <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 list-disc list-inside mt-1">
                      <li>Uses the SuperMemo SM-2 spaced repetition algorithm.</li>
                      <li>Tracks memory retention heatmaps & daily study streaks.</li>
                    </ul>
                  </div>

                  {/* 6. Tasks & Kanban Board */}
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-card-border/80 flex flex-col gap-2 shadow-2xs">
                    <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                      <CheckSquare className="h-4 w-4 text-emerald-500" />
                      6. Task Manager & Kanban Board
                    </h4>
                    <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                      Extracts <code className="text-emerald-500 bg-emerald-500/10 px-1 py-0.5 rounded font-mono text-[10.5px]">- [ ] Task name</code> checkboxes from all notes into a central workspace.
                    </p>
                    <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 list-disc list-inside mt-1">
                      <li>Kanban Board with drag & drop columns (To Do, Doing, Done).</li>
                      <li>Filter by priority (<span className="text-rose-500 font-bold">High</span>, <span className="text-amber-500 font-bold">Medium</span>, <span className="text-slate-400 font-bold">Low</span>).</li>
                    </ul>
                  </div>
                </div>

                {/* Keyboard Shortcuts Reference Box */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-card-border/80 flex flex-col gap-3 shadow-2xs">
                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Clock className="h-4 w-4 text-indigo-500" />
                    Essential Keyboard Shortcuts
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono">
                    <div className="p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                      <span className="text-slate-500 font-sans text-[11px]">New Note</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border text-[10px] text-indigo-500 font-bold">Ctrl/Cmd + N</kbd>
                    </div>
                    <div className="p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                      <span className="text-slate-500 font-sans text-[11px]">Daily Note</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border text-[10px] text-indigo-500 font-bold">Ctrl/Cmd + Shift + D</kbd>
                    </div>
                    <div className="p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                      <span className="text-slate-500 font-sans text-[11px]">Command Palette</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border text-[10px] text-indigo-500 font-bold">Ctrl/Cmd + K</kbd>
                    </div>
                    <div className="p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                      <span className="text-slate-500 font-sans text-[11px]">Toggle AI Chat</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border text-[10px] text-indigo-500 font-bold">Ctrl/Cmd + Shift + C</kbd>
                    </div>
                    <div className="p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                      <span className="text-slate-500 font-sans text-[11px]">Toggle Sidebar</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border text-[10px] text-indigo-500 font-bold">Ctrl/Cmd + \</kbd>
                    </div>
                    <div className="p-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between">
                      <span className="text-slate-500 font-sans text-[11px]">Switch Views</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border text-[10px] text-indigo-500 font-bold">Ctrl/Cmd + 1..7</kbd>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 7. ABOUT KOGNOTE & KOGNITEC */}
            {activeTab === "about" && (
              <div className="flex flex-col gap-6 animate-fade-in">
                {/* Brand Header Banner */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-linear-to-r from-indigo-500/10 via-slate-50 to-purple-500/10 dark:from-indigo-950/60 dark:via-card dark:to-purple-950/40 border border-indigo-200 dark:border-indigo-500/20 shadow-2xs">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/30 shadow-inner">
                      <img src={logoImg} alt="KogNote Logo" className="h-8 w-8 object-contain rounded-lg" />
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">KogNote</h3>
                        <span className="text-[10px] font-bold text-indigo-700 dark:text-indigo-400 bg-indigo-100 dark:bg-indigo-500/10 border border-indigo-300 dark:border-indigo-500/20 px-2 py-0.5 rounded-full">
                          v1.0.0
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400">
                        Local-First Knowledge Management & Dual-Engine AI Workspace
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleOpenWebsite("https://kognitec.com/")}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all active:scale-95 cursor-pointer shadow-md shrink-0"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    <span>kognitec.com</span>
                    <ExternalLink className="h-3 w-3 opacity-80" />
                  </button>
                </div>

                {/* Built By Details Card */}
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-slate-800 flex flex-col gap-2.5 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-800 dark:text-slate-300 flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-amber-500 dark:text-amber-400" /> Developed & Maintained by Kognitec
                    </span>
                    <button
                      onClick={() => handleOpenWebsite("https://kognitec.com/")}
                      className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      Visit Official Website <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    KogNote is engineered by <strong className="text-slate-900 dark:text-slate-200">Kognitec</strong> to provide a fast, private, and extensible note-taking environment. All your notes, knowledge graphs, drawings, flashcards, and vector embeddings remain 100% stored on your local device.
                  </p>
                </div>

                {/* Technical System Specs Grid */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-slate-800 flex flex-col gap-1 shadow-2xs">
                    <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                      <Cpu className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" /> Architecture
                    </span>
                    <span className="font-bold text-slate-900 dark:text-slate-200 text-xs">Tauri v2 + Rust + React</span>
                    <span className="text-[10.5px] text-slate-600 dark:text-slate-400">Native Desktop Engine</span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-card border border-slate-200 dark:border-slate-800 flex flex-col gap-1 shadow-2xs">
                    <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> Vector Database
                    </span>
                    <span className="font-bold text-slate-900 dark:text-slate-200 text-xs">SQLite + sqlite-vec</span>
                    <span className="text-[10.5px] text-slate-600 dark:text-slate-400">Offline Vector Search</span>
                  </div>
                </div>

                {/* Copyright & Credits Footer */}
                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-200 dark:border-slate-800/80">
                  <span>© 2026 Kognitec. All rights reserved.</span>
                  <button
                    onClick={() => handleOpenWebsite("https://kognitec.com/")}
                    className="hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors cursor-pointer underline underline-offset-2"
                  >
                    https://kognitec.com/
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-slate-200 dark:border-card-border/80 px-6 py-3 bg-slate-50/80 dark:bg-sidebar/50 shrink-0">
          <button
            onClick={onClose}
            className="rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 px-5 py-2 font-semibold text-xs transition-all active:scale-95 cursor-pointer shadow-xs"
          >
            Close Settings
          </button>
        </div>
      </div>
    </div>
  );
};
