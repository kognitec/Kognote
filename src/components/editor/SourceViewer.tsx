import React, { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers, keymap } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import { defaultKeymap } from "@codemirror/commands";
import { autocompletion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";

import { useVault, FileEntry } from "../../contexts/VaultContext";
import { getDateSuggestions, isDateQueryCompleted } from "../../lib/date-parser";
import { getShortestUniquePath } from "../../lib/wikilink-utils";
import { getDragState } from "../../lib/drag-state";
import { invokeIPC } from "../../lib/ipc";

const isImageFile = (name: string): boolean => {
  const nameLower = name.toLowerCase();
  return (
    nameLower.endsWith(".png") ||
    nameLower.endsWith(".jpg") ||
    nameLower.endsWith(".jpeg") ||
    nameLower.endsWith(".webp") ||
    nameLower.endsWith(".gif") ||
    nameLower.endsWith(".svg")
  );
};

interface SourceEditorProps {
  content: string;
  onChange: (val: string) => void;
  onBlur?: (val: string) => void;
}

export const SourceViewer: React.FC<SourceEditorProps> = ({ content, onChange, onBlur }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const { files, vaultPath, attachmentsFolderPath, refreshFiles } = useVault();

  // Store props in refs to keep callback identities stable and prevent
  // editor destruction/recreation while typing in source mode.
  const onChangeRef = useRef(onChange);
  const onBlurRef = useRef(onBlur);
  const filesRef = useRef(files);
  const vaultPathRef = useRef(vaultPath);
  const attachmentsFolderPathRef = useRef(attachmentsFolderPath);
  const refreshFilesRef = useRef(refreshFiles);

  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => { onBlurRef.current = onBlur; }, [onBlur]);
  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => { vaultPathRef.current = vaultPath; }, [vaultPath]);
  useEffect(() => { attachmentsFolderPathRef.current = attachmentsFolderPath; }, [attachmentsFolderPath]);
  useEffect(() => { refreshFilesRef.current = refreshFiles; }, [refreshFiles]);

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

    const isVaultFile = (pathStr: string): boolean => {
      if (!pathStr || typeof pathStr !== "string") return false;
      const norm = pathStr.replace(/\\/g, "/").toLowerCase().trim();
      const check = (entries: FileEntry[]): boolean => {
        for (const e of entries) {
          if (!e.is_dir && e.path.replace(/\\/g, "/").toLowerCase() === norm) return true;
          if (e.is_dir && e.children && check(e.children)) return true;
        }
        return false;
      };
      return check(filesRef.current);
    };

    const handleDragOver = (e: DragEvent) => {
      const isAppDrag = getDragState() !== null ||
        (e.dataTransfer?.types && Array.from(e.dataTransfer.types).some(t => t.startsWith("application/kognote")));
      const isOsFileDrag = e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes("Files");

      if (isAppDrag || isOsFileDrag) {
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = "copy";
        }
      }
    };

    const handleDrop = async (e: DragEvent) => {
      const fileDataStr = e.dataTransfer?.getData("application/kognote-file");
      const plainTextPath = e.dataTransfer?.getData("text/plain");

      const draggedState = getDragState("file") || getDragState("card");
      const isOsFileDrop = e.dataTransfer?.files && e.dataTransfer.files.length > 0;

      const isExternalOrSidebarDrag =
        draggedState !== null ||
        !!fileDataStr ||
        isOsFileDrop ||
        (!!plainTextPath && isVaultFile(plainTextPath.trim()));

      if (!isExternalOrSidebarDrag) {
        return; // Allow CodeMirror native drag and drop
      }

      let droppedFilePath: string | null = null;
      if (draggedState) {
        droppedFilePath = draggedState.path || draggedState.file?.path || null;
      }
      if (!droppedFilePath && fileDataStr) {
        try {
          const parsed = JSON.parse(fileDataStr);
          if (parsed && parsed.path && !parsed.is_dir) {
            droppedFilePath = parsed.path;
          }
        } catch {}
      }
      if (!droppedFilePath && plainTextPath && isVaultFile(plainTextPath.trim())) {
        droppedFilePath = plainTextPath.trim();
      }

      if (droppedFilePath && viewRef.current) {
        e.preventDefault();
        e.stopPropagation();

        const isImg = isImageFile(droppedFilePath);
        let insertText = "";
        if (isImg) {
          const fileName = droppedFilePath.split(/[/\\]/).pop() || "image";
          insertText = `![[${fileName}]]`;
        } else {
          const linkTarget = getShortestUniquePath(droppedFilePath, vaultPathRef.current, filesRef.current);
          insertText = `[[${linkTarget}]]`;
        }

        const v = viewRef.current;
        const coords = v.posAtCoords({ x: e.clientX, y: e.clientY });
        const pos = coords ?? v.state.selection.main.head;

        v.dispatch({
          changes: { from: pos, insert: insertText },
          selection: { anchor: pos + insertText.length }
        });
        return;
      }

      // External OS Image File Drop handling
      if (!fileDataStr && e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        const filesToProcess = Array.from(e.dataTransfer.files);
        const imageFile = filesToProcess.find(f => isImageFile(f.name));
        const attPath = attachmentsFolderPathRef.current;
        if (imageFile && attPath && viewRef.current) {
          e.preventDefault();
          e.stopPropagation();

          try {
            const cleanName = imageFile.name ? imageFile.name.replace(/\s+/g, "_") : `dropped_${Date.now()}.png`;
            const timestamp = Date.now();
            const fileName = `${timestamp}_${cleanName}`;
            const separator = attPath.includes("\\") ? "\\" : "/";
            const destPath = `${attPath}${separator}${fileName}`;

            const reader = new FileReader();
            const base64Promise = new Promise<string>((resolve, reject) => {
              reader.onload = () => {
                const res = reader.result as string;
                resolve(res.split(",")[1]);
              };
              reader.onerror = reject;
            });
            reader.readAsDataURL(imageFile);
            const base64Str = await base64Promise;

            await invokeIPC("fs_write_base64", { path: destPath, data: base64Str });
            refreshFilesRef.current();

            const backlinkText = `![[${fileName}]]`;
            const v = viewRef.current;
            const coords = v.posAtCoords({ x: e.clientX, y: e.clientY });
            const pos = coords ?? v.state.selection.main.head;

            v.dispatch({
              changes: { from: pos, insert: backlinkText },
              selection: { anchor: pos + backlinkText.length }
            });
          } catch (err) {
            console.error("SourceViewer drop external image failed:", err);
          }
        }
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
      {/* CodeMirror Editable Container */}
      <div ref={containerRef} className="flex-1 overflow-auto font-mono text-xs" />
    </div>
  );
};
