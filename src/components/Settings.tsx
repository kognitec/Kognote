import React, { useState, useEffect, useCallback } from "react";
import { useSettings } from "../contexts/SettingsContext";
import { useSync } from "../contexts/SyncContext";
import { open } from "@tauri-apps/plugin-dialog";
import { invokeIPC } from "../lib/ipc";
import {
  FolderOpen, X,
  Download, Trash2, Loader2,
  ChevronDown, FileCode, Lock, Brain, Archive,
  Info, Globe, ExternalLink, ShieldCheck, Cpu, Sparkles
} from "lucide-react";
import { aiService, type ModelStatus, type DownloadProgressEvent } from "../lib/local-ai";
import { DEFAULT_AGENTS_MD } from "../constants/defaultAgents";
import logoImg from "../assets/logo.png";

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export const Settings: React.FC<SettingsProps> = ({ isOpen, onClose }) => {
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
    includeArchivedInScans,
    setIncludeArchivedInScans,
  } = useSettings();

  const { triggerSync } = useSync();

  // Per-model download state
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

  const [expandedSection, setExpandedSection] = useState<string | null>("vault");
  const toggleAccordion = (sec: string) => {
    setExpandedSection(expandedSection === sec ? null : sec);
  };

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
        const text = await invokeIPC("read_note", { path: agentsPath }) as string;
        setAgentsContent(text || DEFAULT_AGENTS_MD);
      } else {
        setAgentsContent(DEFAULT_AGENTS_MD);
      }
    } catch {
      setAgentsContent(DEFAULT_AGENTS_MD);
    }
  }, [agentsPath]);

  const refreshModels = useCallback(async () => {
    try {
      const list = await aiService.listModels();
      setModels(list);
      const current = await aiService.currentModel();
      setLoadedModel(current);
    } catch {
      // Tauri not ready yet
    }
  }, []);

  const checkApiStatus = async () => {
    setApiStatus("checking");
    setApiErrorMsg("");
    try {
      const ok = await aiService.checkConnection();
      setApiStatus(ok ? "ok" : "error");
      if (!ok) setApiErrorMsg("Could not connect to the API endpoint. Check your API key or endpoint URL.");
    } catch (e: any) {
      setApiStatus("error");
      setApiErrorMsg(e.message || "Connection failed.");
    }
  };

  useEffect(() => {
    if (isOpen) {
      refreshModels();
      loadAgentsMd();
      if (aiProvider !== "local" && aiProvider !== "api") {
        checkApiStatus();
      }
    }
  }, [isOpen, aiProvider, refreshModels, loadAgentsMd]);

  const handleDownloadModel = async (modelId: string) => {
    setDownloadingId(modelId);
    setModelError((prev) => ({ ...prev, [modelId]: "" }));
    try {
      await aiService.downloadModel(modelId, (evt) => {
        setDownloadProgress((prev) => ({ ...prev, [modelId]: evt }));
      });
      await refreshModels();
    } catch (err: any) {
      setModelError((prev) => ({ ...prev, [modelId]: err.message || "Download failed." }));
    } finally {
      setDownloadingId(null);
    }
  };

  const handleLoadModel = async (modelId: string) => {
    setLoadingId(modelId);
    setModelError((prev) => ({ ...prev, [modelId]: "" }));
    try {
      await aiService.loadModel(modelId);
      await setAiLocalModel(modelId as any);
      setLoadedModel(modelId);
    } catch (err: any) {
      setModelError((prev) => ({ ...prev, [modelId]: err.message || "Failed to load model." }));
    } finally {
      setLoadingId(null);
    }
  };

  const handleUnloadModel = async () => {
    try {
      await aiService.unloadModel();
      setLoadedModel(null);
    } catch (err: any) {
      alert("Failed to unload model: " + err.message);
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    try {
      await aiService.deleteModel(modelId);
      if (loadedModel === modelId) setLoadedModel(null);
      await refreshModels();
    } catch (err: any) {
      alert("Failed to delete model: " + err.message);
    }
  };

  const handleSelectVaultFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Vault Storage Folder"
      });

      if (selected && typeof selected === "string") {
        await setVaultPath(selected);
      }
    } catch (err) {
      console.error("Failed to select folder:", err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-200 flex items-center justify-center bg-black/75 animate-fade-in p-4 selection:bg-indigo-600/30">
      <div className="flex flex-col dark:bg-card bg-white rounded-2xl border dark:border-card-border border-slate-300 w-full max-w-2xl max-h-[90vh] shadow-2xl overflow-hidden p-5 animate-modal-pop">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b dark:border-card-border border-slate-200 pb-3.5 shrink-0">
          <div className="flex items-center gap-2">
            <img src={logoImg} alt="Kognite Logo" className="h-5 w-5 object-contain rounded-md shadow-sm" />
            <h2 className="text-base font-bold dark:text-white text-slate-900">App & AI Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-card-border transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
          
          {/* Accordion 1: Storage & Vault Settings */}
          <div className="rounded-xl border dark:border-card-border border-slate-200 dark:bg-[#161825] bg-slate-50 overflow-hidden">
            <button
              type="button"
              onClick={() => toggleAccordion("vault")}
              className="w-full flex items-center justify-between p-3.5 text-left font-semibold text-xs text-slate-200 hover:bg-[#1a1d2d] transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-indigo-400" />
                Vault Storage Location
              </span>
              <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${expandedSection === "vault" ? "rotate-180" : ""}`} />
            </button>

            {expandedSection === "vault" && (
              <div className="p-4 border-t dark:border-card-border border-slate-200 flex flex-col gap-3">
                <span className="text-xs text-slate-400 leading-relaxed">
                  Select the root folder where all your plain Markdown (.md) files, Daily Notes, and canvas attachments are stored on disk.
                </span>
                
                <div className="flex items-center gap-2">
                  <div className="flex-1 rounded-lg bg-card border border-slate-800 px-3 py-2 text-xs text-slate-300 font-mono truncate">
                    {vaultPath || "No vault path set"}
                  </div>
                  <button
                    onClick={handleSelectVaultFolder}
                    className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs px-3.5 py-2 transition-all active:scale-95 cursor-pointer shrink-0 shadow-md"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    Browse
                  </button>
                </div>

                {/* Archive & Trash Scanning Filter Toggles */}
                <div className="pt-3 border-t dark:border-card-border border-slate-200 flex flex-col gap-3">
                  <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Archive className="h-3.5 w-3.5 text-sky-400" /> Vault Scan & Storage Filters
                  </span>

                  <div className="flex items-center justify-between p-3 rounded-lg bg-card border border-slate-800">
                    <div className="flex flex-col gap-0.5 pr-3">
                      <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                        <Archive className="h-3.5 w-3.5 text-sky-400" /> Include Archived Folder & Notes in Scans
                      </span>
                      <span className="text-[11px] text-slate-400 leading-snug">
                        When ON, notes inside <code className="text-sky-300 bg-sky-950/40 px-1 py-0.5 rounded">/Archived/</code> or with frontmatter <code className="text-sky-300 bg-sky-950/40 px-1 py-0.5 rounded">storage: archived</code> will be included in Task lists, Calendar, Flashcards, Board, and Graph.
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIncludeArchivedInScans(!includeArchivedInScans);
                        // Defer sync so the new setting value is committed before scanning
                        setTimeout(triggerSync, 50);
                      }}
                      className={`relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        includeArchivedInScans ? "bg-indigo-600" : "bg-slate-700"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                          includeArchivedInScans ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                  </div>

                </div>
              </div>
            )}
          </div>

          {/* Accordion 3: Local AI Models & Cloud Providers */}
          <div className="rounded-xl border dark:border-card-border border-slate-200 dark:bg-[#161825] bg-slate-50 overflow-hidden">
            <button
              type="button"
              onClick={() => toggleAccordion("ai")}
              className="w-full flex items-center justify-between p-3.5 text-left font-semibold text-xs text-slate-200 hover:bg-[#1a1d2d] transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-indigo-400" />
                AI Inference Engine Settings
              </span>
              <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${expandedSection === "ai" ? "rotate-180" : ""}`} />
            </button>

            {expandedSection === "ai" && (
              <div className="p-4 border-t dark:border-card-border border-slate-200 flex flex-col gap-4">
                
                {/* Provider Selector */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">AI Engine Provider</span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {[
                      { id: "local", label: "Local (GGUF)" },
                      { id: "anthropic", label: "Claude" },
                      { id: "gemini", label: "Gemini" },
                      { id: "openai", label: "OpenAI / Custom API" },
                    ].map((prov) => (
                      <button
                        key={prov.id}
                        type="button"
                        onClick={() => setAiProvider(prov.id as any)}
                        className={`py-2 px-3 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                          aiProvider === prov.id
                            ? "bg-indigo-600 border-indigo-500 text-white shadow-md"
                            : "bg-card border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-[#181b29]"
                        }`}
                      >
                        {prov.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Provider Options */}
                {aiProvider === "local" && (
                  <div className="flex flex-col gap-3">
                    <span className="text-xs text-slate-400">
                      Local models run 100% offline on your device using native GPU acceleration.
                    </span>

                    {models.map((m) => {
                      const isDownloaded = m.downloaded;
                      const isLoaded = loadedModel === m.id;
                      const isDownloading = downloadingId === m.id;
                      const isLoading = loadingId === m.id;
                      const prog = downloadProgress[m.id];
                      const err = modelError[m.id];

                      return (
                        <div
                          key={m.id}
                          className="flex flex-col gap-2 p-3 rounded-xl bg-card border border-slate-800 text-xs"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                              <span className="font-bold text-slate-200 flex items-center gap-1.5">
                                {m.display_name || m.id}
                                {isLoaded && (
                                  <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded-full">
                                    Active Model
                                  </span>
                                )}
                              </span>
                              <span className="text-[10px] text-slate-500">
                                {m.file_size_bytes ? `${(m.file_size_bytes / (1024 * 1024 * 1024)).toFixed(1)} GB` : "GGUF Model"}
                              </span>
                            </div>

                            <div className="flex items-center gap-2">
                              {!isDownloaded ? (
                                <button
                                  onClick={() => handleDownloadModel(m.id)}
                                  disabled={isDownloading}
                                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs disabled:opacity-50 transition cursor-pointer"
                                >
                                  {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                                  <span>{isDownloading ? "Downloading..." : "Download"}</span>
                                </button>
                              ) : isLoaded ? (
                                <button
                                  onClick={handleUnloadModel}
                                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs transition cursor-pointer"
                                >
                                  Unload
                                </button>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => handleLoadModel(m.id)}
                                    disabled={isLoading}
                                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs disabled:opacity-50 transition cursor-pointer"
                                  >
                                    {isLoading ? "Booting..." : "Boot Model"}
                                  </button>
                                  <button
                                    onClick={() => handleDeleteModel(m.id)}
                                    className="p-1.5 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition cursor-pointer"
                                    title="Delete model file"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {isDownloading && prog && (
                            <div className="flex flex-col gap-1 mt-1">
                              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-500 transition-all duration-200" style={{ width: `${prog.percent}%` }} />
                              </div>
                              <span className="text-[9px] text-slate-500 font-mono">
                                {prog.status === "downloading_runtime"
                                  ? "Downloading & setting up AI runtime engine (llama-server)..."
                                  : `${prog.percent}% (${(prog.downloaded_bytes / (1024 * 1024)).toFixed(1)}MB / ${(prog.total_bytes / (1024 * 1024)).toFixed(1)}MB)`}
                              </span>
                            </div>
                          )}

                          {err && <span className="text-[10px] text-red-400 font-mono mt-1">⚠️ {err}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {aiProvider === "anthropic" && (
                  <div className="flex flex-col gap-3 bg-card p-3 rounded-xl border border-slate-800 text-xs">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Anthropic API Key</span>
                      <input
                        type="password"
                        value={aiApiKey}
                        onChange={(e) => setAiApiKey(e.target.value)}
                        placeholder="sk-ant-..."
                        className="w-full rounded-lg bg-[#161825] px-3 py-2 text-xs text-slate-200 border border-slate-800 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Model Select</span>
                      <select
                        value={aiApiModel}
                        onChange={(e) => setAiApiModel(e.target.value)}
                        className="w-full rounded-lg bg-[#161825] px-3 py-2 text-xs text-slate-200 border border-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
                      >
                        <option value="claude-3-5-sonnet-latest">Claude 3.5 Sonnet (claude-3-5-sonnet-latest)</option>
                        <option value="claude-3-5-haiku-latest">Claude 3.5 Haiku (claude-3-5-haiku-latest)</option>
                        <option value="claude-3-opus-latest">Claude 3 Opus (claude-3-opus-latest)</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-400">
                        Status:{" "}
                        {apiStatus === "checking" && <span className="text-amber-400 font-semibold">Testing key...</span>}
                        {apiStatus === "ok" && <span className="text-emerald-400 font-semibold">✓ Connected</span>}
                        {apiStatus === "error" && <span className="text-red-400 font-semibold">Verification failed</span>}
                      </span>
                      <button
                        onClick={checkApiStatus}
                        className="rounded-lg bg-card-border border border-slate-800 px-3 py-1 font-semibold text-[10px] text-slate-300 hover:bg-slate-800 transition-all cursor-pointer"
                      >
                        Test Connection
                      </button>
                    </div>
                    {apiErrorMsg && <span className="text-[10px] text-red-400 font-mono">⚠️ {apiErrorMsg}</span>}
                  </div>
                )}

                {aiProvider === "gemini" && (
                  <div className="flex flex-col gap-3 bg-card p-3 rounded-xl border border-slate-800 text-xs">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Google AI Studio API Key</span>
                      <input
                        type="password"
                        value={aiApiKey}
                        onChange={(e) => setAiApiKey(e.target.value)}
                        placeholder="AIzaSy..."
                        className="w-full rounded-lg bg-[#161825] px-3 py-2 text-xs text-slate-200 border border-slate-800 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Model Select</span>
                      <select
                        value={aiApiModel}
                        onChange={(e) => setAiApiModel(e.target.value)}
                        className="w-full rounded-lg bg-[#161825] px-3 py-2 text-xs text-slate-200 border border-slate-800 focus:outline-none focus:border-indigo-500 cursor-pointer"
                      >
                        <option value="gemini-1.5-flash">Gemini 1.5 Flash (gemini-1.5-flash)</option>
                        <option value="gemini-1.5-pro">Gemini 1.5 Pro (gemini-1.5-pro)</option>
                        <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash (gemini-2.0-flash-exp)</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-400">
                        Status:{" "}
                        {apiStatus === "checking" && <span className="text-amber-400 font-semibold">Testing key...</span>}
                        {apiStatus === "ok" && <span className="text-emerald-400 font-semibold">✓ Connected</span>}
                        {apiStatus === "error" && <span className="text-red-400 font-semibold">Verification failed</span>}
                      </span>
                      <button
                        onClick={checkApiStatus}
                        className="rounded-lg bg-card-border border border-slate-800 px-3 py-1 font-semibold text-[10px] text-slate-300 hover:bg-slate-800 transition-all cursor-pointer"
                      >
                        Test Connection
                      </button>
                    </div>
                    {apiErrorMsg && <span className="text-[10px] text-red-400 font-mono">⚠️ {apiErrorMsg}</span>}
                  </div>
                )}

                {(aiProvider === "openai" || aiProvider === "api") && (
                  <div className="flex flex-col gap-3 bg-card p-3 rounded-xl border border-slate-800 text-xs">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Base URL Endpoint</span>
                      <input
                        type="text"
                        value={aiApiUrl}
                        onChange={(e) => setAiApiUrl(e.target.value)}
                        placeholder="https://api.openai.com/v1"
                        className="w-full rounded-lg bg-[#161825] px-3 py-2 text-xs text-slate-200 border border-slate-800 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">API Key</span>
                      <input
                        type="password"
                        value={aiApiKey}
                        onChange={(e) => setAiApiKey(e.target.value)}
                        placeholder="sk-..."
                        className="w-full rounded-lg bg-[#161825] px-3 py-2 text-xs text-slate-200 border border-slate-800 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Model Name</span>
                      <input
                        type="text"
                        value={aiApiModel}
                        onChange={(e) => setAiApiModel(e.target.value)}
                        placeholder="gpt-4o-mini"
                        className="w-full rounded-lg bg-[#161825] px-3 py-2 text-xs text-slate-200 border border-slate-800 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="text-slate-400">
                        Status:{" "}
                        {apiStatus === "checking" && <span className="text-amber-400 font-semibold">Testing...</span>}
                        {apiStatus === "ok" && <span className="text-emerald-400 font-semibold">✓ Connected</span>}
                        {apiStatus === "error" && <span className="text-red-400 font-semibold">Auth failed</span>}
                      </span>
                      <button
                        onClick={checkApiStatus}
                        className="rounded-lg bg-card-border border border-slate-800 px-3 py-1 font-semibold text-[10px] text-slate-300 hover:bg-slate-800 transition-all cursor-pointer"
                      >
                        Test Connection
                      </button>
                    </div>
                    {apiErrorMsg && <span className="text-[10px] text-red-400 font-mono">⚠️ {apiErrorMsg}</span>}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Accordion 4: AI Guidelines & Vault Rules (AGENTS.md) */}
          <div className="rounded-xl border dark:border-card-border border-slate-200 dark:bg-[#161825] bg-slate-50 overflow-hidden">
            <button
              type="button"
              onClick={() => toggleAccordion("agents")}
              className="w-full flex items-center justify-between p-3.5 text-left font-semibold text-xs text-slate-200 hover:bg-[#1a1d2d] transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <FileCode className="h-4 w-4 text-indigo-400" />
                AI Guidelines & Formatting Rules (AGENTS.md)
              </span>
              <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${expandedSection === "agents" ? "rotate-180" : ""}`} />
            </button>

            {expandedSection === "agents" && (
              <div className="p-4 border-t dark:border-card-border border-slate-200 flex flex-col gap-4">
                
                {/* Protected Core Metadata System Context */}
                <div className="p-3 rounded-xl bg-card border border-slate-800 flex flex-col gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-amber-400">
                    <Lock className="h-3.5 w-3.5 shrink-0" />
                    <span>Core Protected Metadata Context & Schemas</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Kognote enforces standard metadata schemas across all notes to keep features in sync:
                  </p>
                  <ul className="text-[10px] font-mono text-slate-300 space-y-1 list-disc pl-4 bg-black/30 p-2.5 rounded-lg border border-slate-800/60">
                    <li><strong>Tasks & Priorities</strong>: <code className="text-indigo-300">- [ ] Task text @YYYY-MM-DD !!! #tag</code> (where <code className="text-amber-300">!</code> low, <code className="text-amber-300">!!</code> medium, <code className="text-rose-400">!!!</code> high)</li>
                    <li><strong>Kanban Status & Priority</strong>: <code className="text-indigo-300">status: backlog \| todo \| in-progress \| in-review \| done</code> · <code className="text-indigo-300">priority: high \| medium \| low \| none</code></li>
                    <li><strong>WikiLinks & Tags</strong>: <code className="text-indigo-300">[[Target Note Title]]</code> · <code className="text-indigo-300">#tag-name</code></li>
                    <li><strong>Flashcards Syntax</strong>: <code className="text-indigo-300">@flashcard ( Question :: Answer )</code> or <code className="text-indigo-300">( Question :: Answer )</code></li>
                    <li><strong>AI Block Diffs</strong>: <code className="text-emerald-300">&lt;&lt;&lt;&lt;&lt;&lt;&lt; SEARCH \n [existing] \n ======= \n [updated] \n &gt;&gt;&gt;&gt;&gt;&gt;&gt; REPLACE</code></li>
                    <li><strong>Full Metadata Schema</strong>: <code className="text-slate-400">type, created_by, updated_by, status, priority, due, created, updated, storage, bookmarked, mentions, tags</code></li>
                  </ul>
                </div>

                {/* System Vault AI Rules (Read-Only AGENTS.md) */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Lock className="h-3 w-3 text-amber-400" /> System Vault AI Rules (AGENTS.md)
                    </span>
                    <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/20">
                      Read-Only System Guidelines
                    </span>
                  </div>

                  <div className="w-full rounded-xl bg-[#0d0e15] border border-slate-800/80 p-3.5 text-xs text-slate-300 font-mono leading-relaxed max-h-64 overflow-y-auto select-text shadow-inner">
                    {agentsContent ? (
                      <pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-300 leading-relaxed">
                        {agentsContent}
                      </pre>
                    ) : (
                      <div className="text-slate-500 text-center py-4 italic text-[11px]">
                        No custom AGENTS.md override found in vault. System default guidelines active.
                      </div>
                    )}
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* Accordion 5: About KogNote & Kognitec Info */}
          <div className="rounded-xl border dark:border-card-border border-slate-200 dark:bg-[#161825] bg-slate-50 overflow-hidden">
            <button
              type="button"
              onClick={() => toggleAccordion("about")}
              className="w-full flex items-center justify-between p-3.5 text-left font-semibold text-xs text-slate-200 hover:bg-[#1a1d2d] transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <Info className="h-4 w-4 text-indigo-400" />
                About KogNote & Kognitec
              </span>
              <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${expandedSection === "about" ? "rotate-180" : ""}`} />
            </button>

            {expandedSection === "about" && (
              <div className="p-4 border-t dark:border-card-border border-slate-200 flex flex-col gap-4">
                
                {/* Brand Header Banner */}
                <div className="flex items-center justify-between p-4 rounded-xl bg-linear-to-r from-indigo-950/60 via-card to-purple-950/40 border border-indigo-500/20 shadow-md">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/30 shadow-inner">
                      <img src={logoImg} alt="KogNote Logo" className="h-8 w-8 object-contain rounded-lg" />
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-white tracking-tight">KogNote</h3>
                        <span className="text-[10px] font-semibold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full">
                          v1.0.0
                        </span>
                      </div>
                      <p className="text-xs text-slate-400">
                        Local-First Knowledge Management & Dual-Engine AI Workspace
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => handleOpenWebsite("https://kognitec.com/")}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-all active:scale-95 cursor-pointer shadow-md shrink-0"
                  >
                    <Globe className="h-3.5 w-3.5" />
                    <span>kognitec.com</span>
                    <ExternalLink className="h-3 w-3 opacity-80" />
                  </button>
                </div>

                {/* Built By Details Card */}
                <div className="p-3.5 rounded-xl bg-card border border-slate-800 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-amber-400" /> Developed & Maintained by Kognitec
                    </span>
                    <button
                      onClick={() => handleOpenWebsite("https://kognitec.com/")}
                      className="text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      Visit Official Website <ExternalLink className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    KogNote is engineered by <strong className="text-slate-200">Kognitec</strong> to provide a fast, private, and extensible note-taking environment. All your notes, knowledge graphs, drawings, flashcards, and vector embeddings remain 100% stored on your local device.
                  </p>
                </div>

                {/* Technical System Specs Grid */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-3 rounded-xl bg-card border border-slate-800 flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                      <Cpu className="h-3 w-3 text-indigo-400" /> Architecture
                    </span>
                    <span className="font-semibold text-slate-200 text-[11px]">Tauri v2 + Rust + React</span>
                    <span className="text-[10px] text-slate-400">Native macOS & Cross-Platform Desktop Engine</span>
                  </div>

                  <div className="p-3 rounded-xl bg-card border border-slate-800 flex flex-col gap-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                      <ShieldCheck className="h-3 w-3 text-emerald-400" /> Vector Database
                    </span>
                    <span className="font-semibold text-slate-200 text-[11px]">SQLite + sqlite-vec</span>
                    <span className="text-[10px] text-slate-400">Offline Local Embedding Vector Search</span>
                  </div>
                </div>

                {/* Copyright & Credits Footer */}
                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-800/60">
                  <span>© 2026 Kognitec. All rights reserved.</span>
                  <button
                    onClick={() => handleOpenWebsite("https://kognitec.com/")}
                    className="hover:text-indigo-400 transition-colors cursor-pointer underline underline-offset-2"
                  >
                    https://kognitec.com/
                  </button>
                </div>

              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="mt-4 flex justify-end border-t dark:border-card-border border-slate-200 pt-3 shrink-0">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-5 py-2 font-semibold text-xs text-slate-300 hover:bg-slate-700 active:scale-95 transition-all cursor-pointer"
          >
            Close Settings
          </button>
        </div>
      </div>
    </div>
  );
};
