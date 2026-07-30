import React, { useState, useEffect, useRef } from "react";
import { useVault } from "../contexts/VaultContext";
import { X, FileText, Network, LayoutTemplate } from "lucide-react";
import { invokeIPC } from "../lib/ipc";
import { parseFrontmatter, stringifyFrontmatter } from "../lib/frontmatter";

export const CreateFileModal: React.FC = () => {
  const { createFileModal, setCreateFileModal, createFile, openFile, getTemplates } = useVault();
  const [fileName, setFileName] = useState("");
  const [fileType, setFileType] = useState<"md" | "excalidraw">("md");
  const [templates, setTemplates] = useState<{ name: string; path: string; content: string; type: string }[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");

  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const isDailyNotes = createFileModal.parentDir?.replace(/\\/g, "/").split("/").pop()?.toLowerCase() === "daily notes";

  useEffect(() => {
    if (createFileModal.isOpen) {
      if (isDailyNotes) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, "0");
        const dd = String(today.getDate()).padStart(2, "0");
        setFileName(`${yyyy}-${mm}-${dd}`);
      } else {
        setFileName("");
      }
      setFileType("md");
      setSelectedTemplate("");

      getTemplates().then((list) => {
        setTemplates(list);
      });

      if (!isDailyNotes) {
        setTimeout(() => inputRef.current?.focus(), 80);
      }
    }
  }, [createFileModal.isOpen, isDailyNotes, getTemplates]);

  // Click outside listener
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        setCreateFileModal({ isOpen: false, parentDir: null });
      }
    };
    if (createFileModal.isOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [createFileModal.isOpen, setCreateFileModal]);

  if (!createFileModal.isOpen) return null;

  const handleCreate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = fileName.trim();
    if (!trimmed) return;

    const ext = fileType === "md" ? ".md" : ".excalidraw";
    const nameWithExt = trimmed.toLowerCase().endsWith(ext) ? trimmed : `${trimmed}${ext}`;

    try {
      const parent = createFileModal.parentDir || "";
      const separator = parent.includes("\\") ? "\\" : "/";
      const targetPath = `${parent}${separator}${nameWithExt}`;

      // Check if file already exists (for Daily Notes date reuse)
      const fileExists = await invokeIPC("fs_exists", { path: targetPath }).catch(() => false);
      if (fileExists) {
        openFile({
          name: nameWithExt,
          path: targetPath,
          is_dir: false
        });
      } else {
        const filePath = await createFile(createFileModal.parentDir, nameWithExt);

        // If template selected, write template content
        if (selectedTemplate && fileType === "md") {
          const tpl = templates.find((t) => t.path === selectedTemplate || t.name === selectedTemplate);
          if (tpl) {
            const parsed = parseFrontmatter(tpl.content);
            const nowIso = new Date().toISOString();
            const isDaily = createFileModal.parentDir?.toLowerCase().includes("daily notes");
            const isTemplateDir = createFileModal.parentDir?.toLowerCase().includes("templates");
            const defaultType = isDaily ? "daily" : isTemplateDir ? "template" : "note";
            const newHeader = stringifyFrontmatter({
              type: tpl.type || defaultType,
              created_by: "user",
              updated_by: "user",
              status: parsed.fields.status || "none",
              priority: parsed.fields.priority || "none",
              due: parsed.fields.due || "",
              created: nowIso,
              updated: nowIso,
              storage: "active",
              bookmarked: parsed.fields.bookmarked || "no",
              mentions: [],
            });
            const tplContent = `${newHeader}\n\n${parsed.bodyContent.replace(/^\r?\n+/, "")}`;
            await invokeIPC("write_note", { path: filePath, content: tplContent });
          }
        }

        openFile({
          name: nameWithExt,
          path: filePath,
          is_dir: false
        });
      }
      setCreateFileModal({ isOpen: false, parentDir: null });
      setFileName("");
    } catch (err) {
      console.error("Failed to create file via modal:", err);
      alert(`Failed to create file: ${err}`);
    }
  };

  const getTargetFolderLabel = () => {
    if (!createFileModal.parentDir) return "Root of Vault";
    const parts = createFileModal.parentDir.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1];
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs animate-fade-in select-none">
      <div
        ref={modalRef}
        className="w-full max-w-md rounded-2xl border border-[#1f2335] bg-[#0b0c10]/95 p-6 shadow-2xl backdrop-blur-md animate-scale-up text-slate-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#1f2335] mb-5">
          <div>
            <h3 className="text-sm font-extrabold tracking-wider text-slate-100 uppercase">
              Create New File
            </h3>
            <p className="text-[10px] text-slate-500 mt-0.5">
              Creating in: <span className="text-indigo-400 font-semibold">{getTargetFolderLabel()}</span>
            </p>
          </div>
          <button
            onClick={() => setCreateFileModal({ isOpen: false, parentDir: null })}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-[#1a1d2d] hover:text-slate-200 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleCreate} className="space-y-4">
          {/* File Type Selection */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
              File Type
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setFileType("md")}
                className={`flex items-center justify-center gap-2 rounded-xl p-3 border text-xs font-semibold transition-all ${
                  fileType === "md"
                    ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-400 shadow-md shadow-indigo-500/5"
                    : "border-[#1f2335] bg-[#12141d] text-slate-400 hover:border-slate-700 hover:text-slate-200"
                }`}
              >
                <FileText className="h-4 w-4" />
                <span>Markdown Note</span>
              </button>
              <button
                type="button"
                onClick={() => setFileType("excalidraw")}
                className={`flex items-center justify-center gap-2 rounded-xl p-3 border text-xs font-semibold transition-all ${
                  fileType === "excalidraw"
                    ? "border-purple-500/50 bg-purple-500/10 text-purple-400 shadow-md shadow-purple-500/5"
                    : "border-[#1f2335] bg-[#12141d] text-slate-400 hover:border-slate-700 hover:text-slate-200"
                }`}
              >
                <Network className="h-4 w-4" />
                <span>Canvas Drawing</span>
              </button>
            </div>
          </div>

          {/* Template Selection Dropdown (Only for Markdown) */}
          {fileType === "md" && templates.length > 0 && (
            <div>
              <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <LayoutTemplate className="h-3.5 w-3.5 text-indigo-400" />
                  <span>Choose Template (Optional)</span>
                </span>
                <span className="text-[10px] text-slate-500 font-normal">Pre-packaged</span>
              </label>
              <select
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
                className="w-full rounded-xl border border-[#1f2335] bg-[#12141d] px-3.5 py-2.5 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none transition-colors cursor-pointer"
              >
                <option value="">Blank Note (No Template)</option>
                {templates.map((tpl) => (
                  <option key={tpl.path} value={tpl.path}>
                    📄 {tpl.name} ({tpl.type})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* File Name Input */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
              File Name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder={fileType === "md" ? "e.g. Weekly Roadmap" : "e.g. System Architecture"}
              className="w-full rounded-xl border border-[#1f2335] bg-[#12141d] px-3.5 py-2.5 text-xs text-slate-200 placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3">
            <button
              type="button"
              onClick={() => setCreateFileModal({ isOpen: false, parentDir: null })}
              className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-400 hover:bg-[#1a1d2d] hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!fileName.trim()}
              className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-600/20 transition-all"
            >
              Create File
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
