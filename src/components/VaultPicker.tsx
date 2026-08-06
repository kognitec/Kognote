import React from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSettings } from "../contexts/SettingsContext";
import { 
  FolderOpen, ShieldCheck, Sparkles, Network, 
  GraduationCap, CheckSquare, Lock, FileText, Cpu, ArrowRight 
} from "lucide-react";
import logoImg from "../assets/logo.png";

export const VaultPicker: React.FC = () => {
  const { setVaultPath } = useSettings();

  const handleSelectFolder = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select or Create your Notes Vault Directory",
      });
      if (selected && typeof selected === "string") {
        await setVaultPath(selected);
      }
    } catch (err) {
      console.error("Error opening directory dialog:", err);
    }
  };

  return (
    <div className="relative flex min-h-screen w-screen flex-col items-center justify-center bg-background p-6 text-foreground animate-fade-in select-none overflow-y-auto">
      {/* Dynamic ambient gradient background glows */}
      <div className="absolute top-1/4 left-1/2 h-125 w-125 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-600/15 blur-[140px] pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 h-100 w-100 rounded-full bg-pink-600/10 blur-[130px] pointer-events-none" />

      <div className="relative z-10 my-auto max-w-3xl w-full text-center py-8">
        {/* Version & Subtitle Badge */}
        <div className="inline-flex items-center gap-2 rounded-full bg-indigo-500/10 border border-indigo-500/20 px-4 py-1.5 text-xs font-semibold text-indigo-300 shadow-sm mb-6">
          <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
          <span>Local-First Knowledge Workspace</span>
          <span className="h-1 w-1 rounded-full bg-indigo-400/60" />
          <span className="text-slate-400 font-mono text-[11px]">v0.1.6</span>
        </div>

        {/* Logo Container */}
        <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-linear-to-b from-card to-sidebar border border-white/15 shadow-2xl shadow-indigo-500/20 ring-1 ring-white/10 group transition-all duration-300 hover:scale-105 hover:border-indigo-500/40">
          <img src={logoImg} alt="Kognote Logo" className="h-16 w-16 object-contain drop-shadow-[0_4px_12px_rgba(99,102,241,0.4)]" />
        </div>

        {/* App Title & Pitch */}
        <h1 className="mb-3 text-4xl sm:text-5xl font-black tracking-tight bg-clip-text text-transparent bg-linear-to-r from-white via-slate-100 to-indigo-200">
          Welcome to KOGNOTE
        </h1>
        <p className="mx-auto mb-8 max-w-xl text-slate-400 text-sm sm:text-base leading-relaxed">
          A high-performance markdown note-taking environment with local AI copilot, visual graph connections, interactive whiteboards, and offline privacy.
        </p>

        {/* Primary Action Button */}
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={handleSelectFolder}
            className="group relative flex items-center justify-center gap-3 rounded-2xl bg-linear-to-r from-indigo-600 to-indigo-500 px-9 py-4 font-bold text-white shadow-xl shadow-indigo-600/30 hover:from-indigo-500 hover:to-indigo-400 active:scale-[0.98] transition-all duration-200 cursor-pointer border border-indigo-400/30 text-base"
          >
            <FolderOpen className="h-5 w-5 text-indigo-100 group-hover:scale-110 transition-transform" />
            <span>Select or Create Vault Directory</span>
            <ArrowRight className="h-4 w-4 text-indigo-200 opacity-70 group-hover:translate-x-1 transition-transform" />
          </button>
          
          <p className="text-xs text-slate-500 flex items-center gap-1.5 mt-1">
            <Lock className="h-3.5 w-3.5 text-slate-400" />
            <span>Your notes stay 100% stored on your local disk in standard Markdown files.</span>
          </p>
        </div>

        {/* Feature Highlights Grid */}
        <div className="mt-14 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-left border-t border-white/8 pt-10">
          <div className="rounded-2xl bg-white/2 border border-white/6 p-4.5 hover:border-indigo-500/30 hover:bg-white/4 transition-all duration-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 ring-1 ring-indigo-500/20">
                <FileText className="h-4 w-4" />
              </div>
              <h3 className="font-bold text-slate-200 text-sm">Local Markdown</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Standard <code className="text-indigo-300">.md</code> files on your local drive with zero vendor lock-in, YAML frontmatter, and WikiLinks.
            </p>
          </div>

          <div className="rounded-2xl bg-white/2 border border-white/6 p-4.5 hover:border-pink-500/30 hover:bg-white/4 transition-all duration-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pink-500/10 text-pink-400 ring-1 ring-pink-500/20">
                <Cpu className="h-4 w-4" />
              </div>
              <h3 className="font-bold text-slate-200 text-sm">Offline Local AI</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Private RAG copilot powered by SQLite vector embeddings, GGUF models, or custom API endpoints.
            </p>
          </div>

          <div className="rounded-2xl bg-white/2 border border-white/6 p-4.5 hover:border-purple-500/30 hover:bg-white/4 transition-all duration-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 ring-1 ring-purple-500/20">
                <Network className="h-4 w-4" />
              </div>
              <h3 className="font-bold text-slate-200 text-sm">Interactive Graph & Canvas</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Visualize bidirectional links in 2D/3D physics graphs and draw on infinite whiteboard canvases.
            </p>
          </div>

          <div className="rounded-2xl bg-white/2 border border-white/6 p-4.5 hover:border-emerald-500/30 hover:bg-white/4 transition-all duration-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
                <GraduationCap className="h-4 w-4" />
              </div>
              <h3 className="font-bold text-slate-200 text-sm">FSRS Spaced Repetition</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Auto-generate flashcards from notes and master concepts using the scientific FSRS v5 algorithm.
            </p>
          </div>

          <div className="rounded-2xl bg-white/2 border border-white/6 p-4.5 hover:border-amber-500/30 hover:bg-white/4 transition-all duration-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/20">
                <CheckSquare className="h-4 w-4" />
              </div>
              <h3 className="font-bold text-slate-200 text-sm">Tasks & Kanban Boards</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Scan task items across files, organize Kanban columns, and track deadlines on a calendar timeline.
            </p>
          </div>

          <div className="rounded-2xl bg-white/2 border border-white/6 p-4.5 hover:border-blue-500/30 hover:bg-white/4 transition-all duration-200">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 ring-1 ring-blue-500/20">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <h3 className="font-bold text-slate-200 text-sm">On-Disk E2EE Security</h3>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Hardware-backed ChaCha20-Poly1305 vault encryption option powered by Tauri Stronghold.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

