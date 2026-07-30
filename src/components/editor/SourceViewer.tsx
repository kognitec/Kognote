import React, { useEffect, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers, keymap } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap } from "@codemirror/commands";
import { autocompletion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";

import { useVault, FileEntry } from "../../contexts/VaultContext";
import { Copy, Check, FileCode, Edit3 } from "lucide-react";
import { getDateSuggestions, isDateQueryCompleted } from "../../lib/date-parser";
import { getShortestUniquePath } from "../../lib/wikilink-utils";

interface SourceEditorProps {
  content: string;
  onChange: (val: string) => void;
  onBlur?: (val: string) => void;
}

export const SourceViewer: React.FC<SourceEditorProps> = ({ content, onChange, onBlur }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { files, vaultPath } = useVault();
  const [copied, setCopied] = useState(false);

  // Store props in refs to keep callback identities stable and prevent
  // editor destruction/recreation while typing in source mode.
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const filesRef = useRef(files);
  const vaultPathRef = useRef(vaultPath);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onBlurRef.current = onBlur; }, [onBlur]);
  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => { vaultPathRef.current = vaultPath; }, [vaultPath]);

  const handleCopy = async () => {
    try {
      const currentDoc = viewRef.current ? viewRef.current.state.doc.toString() : content;
      await navigator.clipboard.writeText(currentDoc);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy raw markdown:", err);
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;

    const customTheme = EditorView.theme({
      "&": {
        color: "#cbd5e1",
        backgroundColor: "#07080c",
        height: "100%",
        fontFamily: "'Fira Code', 'Courier New', monospace",
        fontSize: "13px"
      },
      ".cm-content": {
        caretColor: "#818cf8"
      },
      "&.cm-focused .cm-cursor": {
        borderLeftColor: "#818cf8"
      },
      "&.cm-focused .cm-selectionBackground, ::selection": {
        backgroundColor: "#4f46e540 !important"
      },
      ".cm-gutters": {
        backgroundColor: "#0b0c10",
        color: "#475569",
        borderRight: "1px solid #1f2335"
      },
      ".cm-activeLineGutter": {
        backgroundColor: "#161825",
        color: "#818cf8"
      },
      ".cm-activeLine": {
        backgroundColor: "#0f111a"
      },
      ".custom-source-tag": {
        backgroundColor: "#6366f120",
        color: "#818cf8",
        padding: "1px 4px",
        borderRadius: "4px",
        fontWeight: "600"
      },
      ".custom-source-link": {
        color: "#38bdf8",
        textDecoration: "underline",
        cursor: "pointer"
      },
      ".cm-tooltip-autocomplete": {
        backgroundColor: "#11131c",
        border: "1px solid #312e81",
        borderRadius: "8px",
        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)"
      },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
        backgroundColor: "#1e293b20",
        color: "#a5b4fc"
      }
    });

    // Autocomplete source for [[wikilinks]], #tags, /commands, and @dates
    const customAutocompleteSource = (context: CompletionContext): CompletionResult | null => {
      const word = context.matchBefore(/(?:\\?\[\\?\[|#|\/|@)[a-zA-Z0-9_\-\/\s:]*$/);
      if (!word) return null;
      
      const text = word.text;
      
      if (text.startsWith("@")) {
        const query = text.slice(1);
        if (isDateQueryCompleted(query)) return null;

        const suggestions = getDateSuggestions(query);
        const options = suggestions.map((s) => ({
          label: s.label,
          apply: s.value,
          type: "keyword",
          detail: s.sublabel
        }));
        return { from: word.from, options, filter: false };
      }

      if (text.startsWith("[[")) {
        const query = text.slice(2).toLowerCase();
        const allFilesList: FileEntry[] = [];
        const gatherFiles = (entries: FileEntry[]) => {
          entries.forEach((e) => {
            allFilesList.push(e);
            if (e.is_dir && e.children) gatherFiles(e.children);
          });
        };
        gatherFiles(filesRef.current);

        const noteNames: string[] = [];
        allFilesList.forEach((e) => {
          if (!e.is_dir && (e.name.toLowerCase().endsWith(".md") || e.name.toLowerCase().endsWith(".excalidraw"))) {
            const uniquePath = getShortestUniquePath(e.path, vaultPathRef.current, allFilesList);
            if (!noteNames.includes(uniquePath)) {
              noteNames.push(uniquePath);
            }
          }
        });

        const options = noteNames
          .filter(name => name.toLowerCase().includes(query))
          .map(name => ({
            label: `[[${name}]]`,
            apply: `[[${name}]]`,
            type: "keyword",
            detail: "Note Link"
          }));

        return { from: word.from, options, filter: false };
      }

      if (text.startsWith("#")) {
        const query = text.slice(1).toLowerCase();
        const existingTags = ["todo", "inprogress", "in-progress", "done", "backlog", "board", "important", "ideas", "reference", "journal"];
        const options = existingTags
          .filter(t => t.includes(query))
          .map(t => ({ label: `#${t}`, apply: `#${t}`, type: "type", detail: "Tag" }));
        return { from: word.from, options, filter: false };
      }

      if (text.startsWith("/")) {
        const query = text.slice(1).toLowerCase();
        const commands = [
          { label: "Bold text", apply: "**text**", detail: "Markdown" },
          { label: "Italic text", apply: "*text*", detail: "Markdown" },
          { label: "Heading 1", apply: "# Heading 1\n", detail: "Markdown" },
          { label: "Heading 2", apply: "## Heading 2\n", detail: "Markdown" },
          { label: "Bullet List", apply: "- Item\n", detail: "Markdown" },
          { label: "Checklist Item", apply: "- [ ] Task\n", detail: "Markdown" },
          { label: "Insert Table", apply: "| Header 1 | Header 2 |\n|---|---|\n| Cell 1 | Cell 2 |\n", detail: "Markdown" },
        ];
        const options = commands
          .filter(c => c.label.toLowerCase().includes(query))
          .map(c => ({ label: `/${c.label}`, apply: c.apply, type: "text", detail: c.detail }));
        return { from: word.from, options, filter: false };
      }

      return null;
    };

    const state = EditorState.create({
      doc: content,
      extensions: [
        markdown(),
        lineNumbers(),
        oneDark,
        customTheme,
        autocompletion({ override: [customAutocompleteSource] }),
        keymap.of(defaultKeymap),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
          if (update.focusChanged && !update.view.hasFocus) {
            onBlurRef.current?.(update.state.doc.toString());
          }
        })
      ]
    });

    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    viewRef.current = view;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    };

    const handleDrop = (e: DragEvent) => {
      const fileDataStr = e.dataTransfer?.getData("application/kognote-file");
      const plainTextPath = e.dataTransfer?.getData("text/plain");

      let droppedFilePath: string | null = null;
      if (fileDataStr) {
        try {
          const parsed = JSON.parse(fileDataStr);
          if (parsed && parsed.path && !parsed.is_dir) {
            droppedFilePath = parsed.path;
          }
        } catch {}
      }
      if (!droppedFilePath && plainTextPath && (plainTextPath.endsWith(".md") || plainTextPath.endsWith(".excalidraw"))) {
        droppedFilePath = plainTextPath;
      }

      if (droppedFilePath && viewRef.current) {
        e.preventDefault();
        e.stopPropagation();

        const linkTarget = getShortestUniquePath(droppedFilePath, vaultPathRef.current, filesRef.current);
        const backlinkText = `[[${linkTarget}]]`;
        const v = viewRef.current;
        const coords = v.posAtCoords({ x: e.clientX, y: e.clientY });
        const pos = coords ?? v.state.selection.main.head;

        v.dispatch({
          changes: { from: pos, insert: backlinkText },
          selection: { anchor: pos + backlinkText.length }
        });
      }
    };

    const container = containerRef.current;
    container.addEventListener("dragover", handleDragOver, true);
    container.addEventListener("drop", handleDrop, true);

    return () => {
      container.removeEventListener("dragover", handleDragOver, true);
      container.removeEventListener("drop", handleDrop, true);
      view.destroy();
      viewRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (viewRef.current) {
      const currentVal = viewRef.current.state.doc.toString();
      if (currentVal !== content) {
        viewRef.current.dispatch({
          changes: { from: 0, to: currentVal.length, insert: content }
        });
      }
    }
  }, [content]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#07080c] flex flex-col">
      {/* Top Banner indicating editable source mode */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#0b0c10] border-b border-[#1f2335] text-xs">
        <div className="flex items-center gap-2 text-slate-400 font-medium">
          <FileCode className="h-4 w-4 text-indigo-400" />
          <span>Markdown Source Mode</span>
          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold flex items-center gap-1">
            <Edit3 className="h-2.5 w-2.5" />
            Editable
          </span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-[#161825] hover:bg-indigo-600/20 border border-[#1f2335] text-slate-300 hover:text-indigo-300 transition-all text-[11px] font-medium cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="h-3.5 w-3.5 text-emerald-400" />
              <span className="text-emerald-400">Copied!</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5 text-indigo-400" />
              <span>Copy Markdown</span>
            </>
          )}
        </button>
      </div>

      {/* CodeMirror Editable Container */}
      <div ref={containerRef} className="flex-1 overflow-auto font-mono text-xs" />
    </div>
  );
};
