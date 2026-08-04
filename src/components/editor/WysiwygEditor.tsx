import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Crepe } from "@milkdown/crepe";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { replaceAll } from "@milkdown/utils";
import { diagram } from "@milkdown/plugin-diagram";
import { Decoration, DecorationSet } from "@milkdown/kit/prose/view";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { prosePluginsCtx, editorViewCtx, commandsCtx } from "@milkdown/kit/core";
import { clearTextInCurrentBlockCommand } from "@milkdown/kit/preset/commonmark";
import { useVault, FileEntry } from "../../contexts/VaultContext";
import { useSettings } from "../../contexts/SettingsContext";
import { invokeIPC } from "../../lib/ipc";
import { convertFileSrc } from "@tauri-apps/api/core";
import { FileText, Tag as TagIcon, Calendar } from "lucide-react";
import { getDateSuggestions, formatDateISO, isDateQueryCompleted, formatUtcIsoFromDateAndTime, formatTime12 } from "../../lib/date-parser";
import { parseFrontmatter, getZonedDateParts } from "../../lib/frontmatter";
import { getShortestUniquePath, processMarkdownImages, resolveLocalImagePath, cleanEscapedWikilinks } from "../../lib/wikilink-utils";
import { getDragState } from "../../lib/drag-state";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { FloatingAiCoords } from "./FloatingAiToolbar";

// ─────────────────────────────────────────────────────────────────────────────
// ProseMirror Plugins for Tags, Wikilinks, Comments & Smart Queries
// ─────────────────────────────────────────────────────────────────────────────

function buildAiCommentHiderDecorations(doc: any): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node: any, pos: number) => {
    if (node.isBlock && node.type.name !== "doc") {
      const text = node.textContent || "";
      if (
        text.includes("ai-metadata") ||
        text.includes("AI Tags:") ||
        text.includes("AI Backlinks:") ||
        text.includes("</div>")
      ) {
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: "ai-generated-comment-hidden"
          })
        );
      }
    }
  });
  return DecorationSet.create(doc, decorations);
}

const aiCommentHiderPlugin = new Plugin({
  state: {
    init(_config, instance) {
      return buildAiCommentHiderDecorations(instance.doc);
    },
    apply(tr, oldState) {
      if (!tr.docChanged) return oldState;
      return buildAiCommentHiderDecorations(tr.doc);
    }
  },
  props: {
    decorations(state) { return this.getState(state); }
  }
});

function buildHighlightDecorations(doc: any): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node: any, pos: number) => {
    if (node.isText) {
      const text = node.text || "";

      // Match tags (#tag)
      const tagRegex = /\\?#[a-zA-Z0-9_\-\/]+/g;
      let match;
      while ((match = tagRegex.exec(text)) !== null) {
        const start = pos + match.index;
        const end = start + match[0].length;
        decorations.push(
          Decoration.inline(start, end, { class: "custom-preview-tag" })
        );
      }

      // Match Wiki links ([[Note]])
      const linkRegex = /(?:\\?\[){2}(.*?)(?:\\?\]){2}/g;
      while ((match = linkRegex.exec(text)) !== null) {
        const start = pos + match.index;
        const end = start + match[0].length;
        decorations.push(
          Decoration.inline(start, end, { class: "custom-preview-link" })
        );
      }

      // Match Flashcards syntax (@flashcard (Question :: Answer))
      const flashcardRegex = /@flashcards?\s*\(([\s\S]*?)::([\s\S]*?)\)/gi;
      while ((match = flashcardRegex.exec(text)) !== null) {
        const start = pos + match.index;
        const end = start + match[0].length;
        decorations.push(
          Decoration.inline(start, end, { class: "custom-preview-flashcard" })
        );
      }
    }
  });
  return DecorationSet.create(doc, decorations);
}

const highlightPlugin = new Plugin({
  state: {
    init(_config, instance) {
      return buildHighlightDecorations(instance.doc);
    },
    apply(tr, oldState) {
      if (!tr.docChanged) return oldState;
      return buildHighlightDecorations(tr.doc);
    }
  },
  props: {
    decorations(state) { return this.getState(state); }
  }
});

function buildDatePillDecorations(doc: any, selection?: any): DecorationSet {
  const decorations: Decoration[] = [];
  const userTimezone = (window as any).__KOGNOTE_USER_TIMEZONE__ || localStorage.getItem("kognote-user-timezone") || "auto";

  doc.descendants((node: any, pos: number) => {
    if (node.isText) {
      const text = node.text || "";
      const dateTokenRegex = /(?:@due:?|@|due:\s*)(20\d{2}[-/]\d{2}[-/]\d{2}(?:T[^\s]+|[ T]\d{2}:\d{2})?)/gi;
      let match;
      while ((match = dateTokenRegex.exec(text)) !== null) {
        const start = pos + match.index;
        const end = start + match[0].length;
        const rawToken = match[0];
        const isoRaw = match[1];
        const isDue = rawToken.toLowerCase().includes("due");

        const isEditing = selection ? (selection.from <= end && selection.to >= start) : false;

        if (!isEditing) {
          decorations.push(
            Decoration.inline(start, end, { class: "custom-date-pill-hidden-raw" })
          );

          decorations.push(
            Decoration.widget(start, () => {
              const span = document.createElement("span");
              span.title = `Raw value: ${rawToken}`;

              const { dateStr, timeStr } = getZonedDateParts(isoRaw, userTimezone);
              if (dateStr) {
                const todayStr = new Date().toISOString().split("T")[0];
                const tomorrowObj = new Date();
                tomorrowObj.setDate(tomorrowObj.getDate() + 1);
                const tomorrowStr = tomorrowObj.toISOString().split("T")[0];

                let dateDisplay = dateStr;
                if (dateStr === todayStr) dateDisplay = "Today";
                else if (dateStr === tomorrowStr) dateDisplay = "Tomorrow";
                else {
                  const [y, m, d] = dateStr.split("-");
                  if (y && m && d) {
                    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                    const mIdx = parseInt(m, 10) - 1;
                    if (months[mIdx]) {
                      dateDisplay = `${months[mIdx]} ${parseInt(d, 10)}${y !== new Date().getFullYear().toString() ? `, ${y}` : ""}`;
                    }
                  }
                }

                const timeDisplay = timeStr ? ` ${formatTime12(timeStr).trim()}` : "";
                const fullLabel = isDue ? `Due: ${dateDisplay}${timeDisplay}` : `${dateDisplay}${timeDisplay}`;

                span.className = `inline-flex items-baseline gap-[0.3em] font-semibold text-[inherit] select-none transition-all cursor-pointer hover:underline ${
                  isDue ? "text-rose-400" : "text-indigo-400"
                }`;

                span.innerHTML = `<svg class="w-[0.9em] h-[0.9em] shrink-0 opacity-85 self-center" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="4" rx="2" ry="2"/><line x1="16" x2="16" y1="2" y2="6"/><line x1="8" x2="8" y1="2" y2="6"/><line x1="3" x2="21" y1="10" y2="10"/></svg><span>${fullLabel}</span>`;
              } else {
                span.className = "inline-flex items-baseline gap-[0.3em] font-semibold text-[inherit] text-indigo-400 hover:underline cursor-pointer";
                span.innerText = rawToken;
              }

              return span;
            }, { side: -1 })
          );
        } else {
          decorations.push(
            Decoration.inline(start, end, { class: "custom-date-pill-active-editing" })
          );
        }
      }
    }
  });
  return DecorationSet.create(doc, decorations);
}

const datePillPlugin = new Plugin({
  state: {
    init(_config, instance) {
      return buildDatePillDecorations(instance.doc, null);
    },
    apply(tr, oldState) {
      if (!tr.docChanged && !tr.selectionSet && !tr.getMeta("timezone-changed")) return oldState;
      return buildDatePillDecorations(tr.doc, tr.selection);
    }
  },
  props: {
    decorations(state) { return this.getState(state); }
  }
});

const queryWidgetPlugin = new Plugin({
  state: {
    init() { return DecorationSet.empty; },
    apply(tr, oldState) {
      if (!tr.docChanged) return oldState;
      const doc = tr.doc;
      const decorations: Decoration[] = [];

      doc.descendants((node, pos) => {
        if (node.type.name === "code_block" || node.type.name === "fence") {
          const params = (node.attrs.language || node.attrs.params || node.attrs.info || "").trim();
          if (params === "query") {
            const queryText = node.textContent;
            const endPos = pos + node.nodeSize;
            decorations.push(
              Decoration.widget(endPos, () => {
                const dom = document.createElement("div");
                dom.className = "kognote-smart-query-portal mt-2 mb-4";
                dom.setAttribute("data-query", queryText);
                return dom;
              })
            );
          }
        }
      });
      return DecorationSet.create(doc, decorations);
    }
  },
  props: {
    decorations(state) { return this.getState(state); }
  }
});

const imageResolverPlugin = new Plugin({
  view() {
    const fixImages = (dom: HTMLElement) => {
      const images = dom.querySelectorAll("img");
      images.forEach((img) => {
        const rawSrc = img.getAttribute("src");
        if (
          rawSrc &&
          !rawSrc.startsWith("http://asset.localhost") &&
          !rawSrc.startsWith("https://asset.localhost") &&
          !rawSrc.startsWith("asset://") &&
          !/^(https?:|data:|blob:)/i.test(rawSrc)
        ) {
          const resolved = resolveLocalImagePath(
            rawSrc,
            (window as any).__KOGNOTE_VAULT_PATH__,
            (window as any).__KOGNOTE_ATTACHMENTS_PATH__
          );
          if (resolved && resolved !== rawSrc) {
            img.setAttribute("src", resolved);
          }
        }
      });
    };

    return {
      update(view) {
        fixImages(view.dom);
      }
    };
  }
});

const yamlFrontmatterPlugin = new Plugin({
  state: {
    init(_, instance) {
      return getYamlDecorations(instance.doc);
    },
    apply(tr, oldState) {
      if (!tr.docChanged) return oldState;
      return getYamlDecorations(tr.doc);
    }
  },
  props: {
    decorations(state) {
      return this.getState(state);
    }
  }
});

function getYamlDecorations(doc: any): DecorationSet {
  const decorations: Decoration[] = [];
  let inFrontmatter = false;
  let hasStarted = false;
  let closingFound = false;

  const nodesToHide: { pos: number; endPos: number }[] = [];

  doc.descendants((node: any, pos: number) => {
    if (closingFound) return false;
    if (pos > 1500) return false;

    if (node.isBlock && node.type.name !== "doc") {
      const text = (node.textContent || "").trim();
      const nodeTypeName = node.type.name;

      const isDivider = nodeTypeName === "hr" || nodeTypeName === "thematic_break" || text === "---";

      if (!hasStarted) {
        if (isDivider) {
          hasStarted = true;
          inFrontmatter = true;
          nodesToHide.push({ pos, endPos: pos + node.nodeSize });
          return false;
        } else {
          return false;
        }
      }

      if (inFrontmatter) {
        nodesToHide.push({ pos, endPos: pos + node.nodeSize });
        if (isDivider) {
          inFrontmatter = false;
          closingFound = true;
        }
      }
    }
  });

  if (hasStarted && closingFound) {
    nodesToHide.forEach(({ pos, endPos }) => {
      decorations.push(
        Decoration.node(pos, endPos, {
          class: "yaml-frontmatter-hidden"
        })
      );
    });
  }

  return DecorationSet.create(doc, decorations);
}

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

interface AutocompletePopupState {
  type: "link" | "tag" | "date";
  query: string;
  coords: { top: number; left: number };
  startPos: number;
  endPos: number;
}

export interface FrontmatterResult {
  hasFrontmatter: boolean;
  frontmatterRaw: string;
  frontmatterText: string;
  parsedFields: Record<string, string>;
  bodyContent: string;
}

export function extractFrontmatter(fullContent: string): FrontmatterResult {
  if (!fullContent) {
    return { hasFrontmatter: false, frontmatterRaw: "", frontmatterText: "", parsedFields: {}, bodyContent: "" };
  }

  const match = fullContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return {
      hasFrontmatter: false,
      frontmatterRaw: "",
      frontmatterText: "",
      parsedFields: {},
      bodyContent: fullContent
    };
  }

  const frontmatterRaw = match[0];
  const frontmatterText = match[1].trim();
  const bodyContent = fullContent.slice(frontmatterRaw.length);

  const parsedFields: Record<string, string> = {};
  const lines = frontmatterText.split(/\r?\n/);
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      if (key) {
        parsedFields[key] = val;
      }
    }
  }

  return {
    hasFrontmatter: true,
    frontmatterRaw,
    frontmatterText,
    parsedFields,
    bodyContent
  };
}

interface WysiwygEditorProps {
  content: string;
  onChange: (val: string) => void;
  onEditorReady: (crepe: Crepe) => void;
  onSelectionChange?: (selectedText: string, coords: FloatingAiCoords | null) => void;
}

const WysiwygEditorInner: React.FC<WysiwygEditorProps> = ({
  content,
  onChange,
  onEditorReady,
  onSelectionChange
}) => {
  const crepeRef = useRef<Crepe | null>(null);
  const isExternalUpdateRef = useRef(false);
  const isWysiwygEditingRef = useRef(false);
  const isInitialRenderRef = useRef(true);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastContentRef = useRef(content);
  const { attachmentsFolderPath, refreshFiles, files, vaultPath, openNoteByName } = useVault();
  const { userTimezone } = useSettings();

  // Keep window global in sync and force ProseMirror view update when active timezone changes
  useEffect(() => {
    (window as any).__KOGNOTE_USER_TIMEZONE__ = userTimezone;
    if (crepeRef.current) {
      try {
        crepeRef.current.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          if (view && view.state) {
            view.dispatch(view.state.tr.setMeta("timezone-changed", true));
          }
        });
      } catch (err) {}
    }
  }, [userTimezone]);

  // Click handler for decorated [[wikilinks]] inside the editor
  const handleContainerClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const linkEl = target.closest(".custom-preview-link") as HTMLElement | null;
    if (linkEl) {
      const rawText = linkEl.textContent || "";
      const match = rawText.match(/(?:\\?\[){2}(.*?)(?:\\?\]){2}/);
      if (match && match[1]) {
        const noteName = match[1].replace(/\\/g, "").trim();
        if (noteName) {
          openNoteByName(noteName);
        }
      }
    }
  }, [openNoteByName]);

  // Extract YAML frontmatter to prevent raw --- lines from appearing in preview body
  const frontmatterInfo = useMemo(() => parseFrontmatter(content), [content]);
  const frontmatterRawRef = useRef(frontmatterInfo.frontmatterRaw);

  useEffect(() => {
    frontmatterRawRef.current = frontmatterInfo.frontmatterRaw;
  }, [frontmatterInfo.frontmatterRaw]);

  // Autocomplete state for [[wikilink]] and #tag suggestions
  const [autocompletePopup, setAutocompletePopup] = useState<AutocompletePopupState | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [pickerDate, setPickerDate] = useState<string>("");
  const [pickerTime, setPickerTime] = useState<string>("");

  // Helper to extract note names (disambiguated with Shortest Unique Path if duplicate base name exists)
  const availableNoteNames = useCallback(() => {
    const items: string[] = [];
    const allFilesList: { name: string; path: string; is_dir?: boolean; children?: any[] }[] = [];

    const walk = (entries: FileEntry[]) => {
      entries.forEach((e) => {
        allFilesList.push(e);
        if (e.is_dir && e.children) {
          walk(e.children);
        }
      });
    };
    walk(files);

    allFilesList.forEach((e) => {
      if (!e.is_dir && (e.name.endsWith(".md") || e.name.endsWith(".excalidraw"))) {
        const uniquePath = getShortestUniquePath(e.path, vaultPath, allFilesList);
        if (!items.includes(uniquePath)) {
          items.push(uniquePath);
        }
      }
    });

    return items;
  }, [files, vaultPath]);

  // Available options for current popup
  const options = useCallback(() => {
    if (!autocompletePopup) return [];
    const query = autocompletePopup.query.toLowerCase();
    if (autocompletePopup.type === "link") {
      return availableNoteNames()
        .filter((name) => name.toLowerCase().includes(query))
        .map((n) => ({ label: `[[${n}]]`, value: n, sublabel: "" }));
    } else if (autocompletePopup.type === "tag") {
      const defaultTags = ["todo", "inprogress", "in-progress", "done", "backlog", "board", "important", "ideas", "reference", "journal"];
      return defaultTags
        .filter((t) => t.toLowerCase().includes(query))
        .map((t) => ({ label: `#${t}`, value: t, sublabel: "" }));
    } else {
      const suggestions = getDateSuggestions(autocompletePopup.query);
      return suggestions.map((s) => ({ label: s.label, value: s.value, sublabel: s.sublabel }));
    }
  }, [autocompletePopup, availableNoteNames]);

  const currentOptions = options();

  const handleSelectSuggestion = useCallback((item: { label: string; value: string; sublabel: string }) => {
    if (!autocompletePopup) return;
    const crepe = crepeRef.current;
    if (!crepe) return;

    crepe.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { state, dispatch } = view;
      const { startPos, endPos, type } = autocompletePopup;

      const replacement = type === "link" ? `[[${item.value}]]` : type === "tag" ? `#${item.value}` : item.value;
      dispatch(state.tr.replaceWith(startPos, endPos, state.schema.text(replacement)));
      view.focus();
    });

    setAutocompletePopup(null);
  }, [autocompletePopup]);

  const { get, loading } = useEditor((root) => {
    isExternalUpdateRef.current = true;
    const crepe = new Crepe({
      root,
      defaultValue: processMarkdownImages(cleanEscapedWikilinks(frontmatterInfo.bodyContent), vaultPath, attachmentsFolderPath),
      features: {
        [Crepe.Feature.Cursor]: true,
        [Crepe.Feature.Toolbar]: false,
        [Crepe.Feature.TopBar]: false,
        [Crepe.Feature.BlockEdit]: true,
        [Crepe.Feature.ListItem]: true,
        [Crepe.Feature.LinkTooltip]: true,
        [Crepe.Feature.ImageBlock]: true,
        [Crepe.Feature.Table]: true,
        [Crepe.Feature.Latex]: true,
        [Crepe.Feature.Placeholder]: true,
        [Crepe.Feature.CodeMirror]: true,
      },
      featureConfigs: {
        [Crepe.Feature.BlockEdit]: {
          buildMenu: (builder: any) => {
            const customGroup = builder.addGroup("custom", "Custom");

            customGroup.addItem("flashcard", {
              label: "Flashcard",
              icon: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M19 4H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H5V6h14v12zm-12-8h10v2H7v-2zm0 4h7v2H7v-2z"/></svg>`,
              onRun: (ctx: any) => {
                const commands = ctx.get(commandsCtx);
                commands.call(clearTextInCurrentBlockCommand.key);

                const view = ctx.get(editorViewCtx);
                const { state, dispatch } = view;
                dispatch(state.tr.insertText("@flashcard (  ::  )"));
              }
            });

            // Move 'custom' group to the very top of native Crepe slash menu
            const builtGroups = builder.build();
            const customIdx = builtGroups.findIndex((g: any) => g.key === "custom");
            if (customIdx > 0) {
              const [customG] = builtGroups.splice(customIdx, 1);
              builtGroups.unshift(customG);
            }
          }
        },
        [Crepe.Feature.Placeholder]: {
          text: "Start writing your note here...",
        },
        [Crepe.Feature.ImageBlock]: {
          onUpload: async (file: File): Promise<string> => {
            if (!attachmentsFolderPath) {
              return URL.createObjectURL(file);
            }
            try {
              const reader = new FileReader();
              const base64Promise = new Promise<string>((resolve, reject) => {
                reader.onload = () => {
                  const result = reader.result as string;
                  const base64 = result.split(",")[1];
                  resolve(base64);
                };
                reader.onerror = reject;
              });
              reader.readAsDataURL(file);
              const base64Str = await base64Promise;

              const cleanName = file.name ? file.name.replace(/\s+/g, "_") : `image_${Date.now()}.png`;
              const timestamp = Date.now();
              const fileName = `${timestamp}_${cleanName}`;
              const separator = attachmentsFolderPath.includes("\\") ? "\\" : "/";
              const destPath = `${attachmentsFolderPath}${separator}${fileName}`;

              await invokeIPC("fs_write_base64", { path: destPath, data: base64Str });
              refreshFiles();

              return convertFileSrc(destPath);
            } catch (err) {
              console.error("Image upload/save failed:", err);
              return URL.createObjectURL(file);
            }
          }
        }
      }
    });

    crepe.editor.config((ctx) => {
      ctx.update(prosePluginsCtx, (prev) => [...prev, highlightPlugin, aiCommentHiderPlugin, queryWidgetPlugin, yamlFrontmatterPlugin, datePillPlugin, imageResolverPlugin]);
    });
    crepe.editor.use(diagram);

    crepeRef.current = crepe;
    onEditorReady(crepe);

    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, bodyMarkdown) => {
        if (isInitialRenderRef.current) {
          isInitialRenderRef.current = false;
          lastBodyContentRef.current = bodyMarkdown;
          return;
        }
        if (!isExternalUpdateRef.current) {
          isWysiwygEditingRef.current = true;
          const cleanedBody = cleanEscapedWikilinks(bodyMarkdown);
          lastBodyContentRef.current = cleanedBody;
          const fullContent = frontmatterRawRef.current
            ? `${frontmatterRawRef.current}\n\n${cleanedBody.replace(/^\n+/, "")}`
            : cleanedBody;
          lastContentRef.current = fullContent;
          onChange(fullContent);
        } else {
          isExternalUpdateRef.current = false;
        }
      });
    });

    return crepe;
  }, [attachmentsFolderPath]);

  const lastBodyContentRef = useRef(frontmatterInfo.bodyContent);

  // Sync external content changes (e.g. switching active note or AI edit mode)
  useEffect(() => {
    if (loading) return;

    // Skip replacing editor content if the change originated from internal WYSIWYG typing
    if (isWysiwygEditingRef.current) {
      isWysiwygEditingRef.current = false;
      lastContentRef.current = content;
      lastBodyContentRef.current = frontmatterInfo.bodyContent;
      return;
    }

    if (content === lastContentRef.current && frontmatterInfo.bodyContent === lastBodyContentRef.current) return;

    let crepe: Crepe | undefined = undefined;
    try {
      crepe = crepeRef.current || (get() as Crepe | undefined);
    } catch (_) {
      return;
    }

    if (!crepe || !crepe.editor || typeof crepe.editor.action !== "function") return;

    // If bodyContent hasn't changed, just update refs without resetting Milkdown
    if (frontmatterInfo.bodyContent === lastBodyContentRef.current) {
      lastContentRef.current = content;
      return;
    }

    isExternalUpdateRef.current = true;
    lastContentRef.current = content;
    lastBodyContentRef.current = frontmatterInfo.bodyContent;

    try {
      const processedBody = processMarkdownImages(cleanEscapedWikilinks(frontmatterInfo.bodyContent), vaultPath, attachmentsFolderPath);
      crepe.editor.action(replaceAll(processedBody));
    } catch (e) {
      console.warn("Milkdown replaceAll failed:", e);
    } finally {
      setTimeout(() => {
        isExternalUpdateRef.current = false;
      }, 50);
    }
  }, [content, frontmatterInfo.bodyContent, get, loading, vaultPath, attachmentsFolderPath]);

  // Selection Tracking & Autocomplete Popup Scanner
  useEffect(() => {
    const handleSelectionAndAutocomplete = () => {
      const selection = window.getSelection();
      
      // 1. Text Selection for AI Floating Toolbar
      if (selection && !selection.isCollapsed && onSelectionChange) {
        const selectedText = selection.toString().trim();
        if (selectedText.length >= 2 && containerRef.current && containerRef.current.contains(selection.anchorNode)) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          const containerRect = containerRef.current.getBoundingClientRect();
          onSelectionChange(selectedText, {
            x: rect.left + rect.width / 2,
            y: rect.top,
            selectionTop: rect.top,
            selectionBottom: rect.bottom,
            selectionLeft: rect.left,
            selectionRight: rect.right,
            containerRect: {
              top: containerRect.top,
              bottom: containerRect.bottom,
              left: containerRect.left,
              right: containerRect.right,
              width: containerRect.width,
              height: containerRect.height
            }
          });
        }
      } else {
        // Do not clear selection if user is interacting with the floating AI toolbar
        const activeEl = document.activeElement;
        const isToolbarActive = activeEl?.closest?.('[data-floating-toolbar="true"]');
        if (!isToolbarActive) {
          onSelectionChange?.("", null);
        }
      }

      // 2. Wikilinks [[ and #Tags Autocomplete Scanner
      const crepe = crepeRef.current;
      if (!crepe || !crepe.editor || typeof crepe.editor.action !== "function") return;

      crepe.editor.action((ctx) => {
        try {
          const view = ctx.get(editorViewCtx);
          const { state } = view;
          const { selection: docSelection } = state;
          const { $from, empty } = docSelection;

          if (!empty) {
            setAutocompletePopup(null);
            return;
          }

          const textBefore = $from.parent.textBetween(0, $from.parentOffset, null, "\uFFFC");

          // Check for [[wikilink (supporting optional backslashes and parentheses)
          const linkMatch = textBefore.match(/(?:\\?\[){2}([a-zA-Z0-9_\-\/\s()]*)$/);
          if (linkMatch) {
            const query = linkMatch[1];
            const matchStart = $from.pos - (2 + query.length);
            const coords = view.coordsAtPos($from.pos);
            setAutocompletePopup({
              type: "link",
              query,
              coords: { top: coords.bottom + 6, left: Math.max(16, coords.left - 20) },
              startPos: matchStart,
              endPos: $from.pos
            });
            setSelectedIndex(0);
            return;
          }

          // Check for #tag
          const tagMatch = textBefore.match(/(?:^|\s)#([a-zA-Z0-9_\-\/]*)$/);
          if (tagMatch) {
            const query = tagMatch[1];
            const matchStart = $from.pos - (1 + query.length);
            const coords = view.coordsAtPos($from.pos);
            setAutocompletePopup({
              type: "tag",
              query,
              coords: { top: coords.bottom + 6, left: Math.max(16, coords.left - 10) },
              startPos: matchStart,
              endPos: $from.pos
            });
            setSelectedIndex(0);
            return;
          }

          // Check for @date or @due:date (EXCLUSIVELY for Date & Time)
          const dateMatch = textBefore.match(/(?:^|\s)@([a-zA-Z0-9_\-\/\s:]*)$/);
          if (dateMatch) {
            const query = dateMatch[1];
            // Do NOT trigger popup if text already forms a completed date, task token, or text past completed date
            if (!isDateQueryCompleted(query)) {
              const matchStart = $from.pos - (1 + query.length);
              const coords = view.coordsAtPos($from.pos);
              setAutocompletePopup({
                type: "date",
                query,
                coords: { top: coords.bottom + 6, left: Math.max(16, coords.left - 10) },
                startPos: matchStart,
                endPos: $from.pos
              });
              setSelectedIndex(0);
              return;
            }
          }

          setAutocompletePopup(null);
        } catch (e) {
          // Ignore non-critical scanner errors
        }
      });
    };

    document.addEventListener("selectionchange", handleSelectionAndAutocomplete);
    document.addEventListener("keyup", handleSelectionAndAutocomplete);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionAndAutocomplete);
      document.removeEventListener("keyup", handleSelectionAndAutocomplete);
    };
  }, [onSelectionChange]);

  // Keydown Interceptor for Autocomplete Navigation (Up/Down/Enter/Tab/Esc)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!autocompletePopup || currentOptions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex((prev) => (prev + 1) % currentOptions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      setSelectedIndex((prev) => (prev - 1 + currentOptions.length) % currentOptions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      if (currentOptions[selectedIndex]) {
        handleSelectSuggestion(currentOptions[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setAutocompletePopup(null);
    }
  };

  // Intercept the block-handle plus (+) button and image drag-and-drop
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handlePointerUp = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      const opItem = target.closest(".milkdown-block-handle > .operation-item");
      if (!opItem) return;

      if (opItem.parentElement?.firstElementChild !== opItem) return;

      e.stopPropagation();
      e.preventDefault();

      opItem.classList.remove("active");

      const crepe = crepeRef.current;
      if (!crepe) return;

      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (!view.hasFocus()) view.focus();

        const { state, dispatch } = view;
        const { selection } = state;
        const { $from } = selection;

        const activeNode = $from.depth > 0 ? $from.node(1) : null;
        const isEmpty = activeNode ? activeNode.textContent.trim() === "" : true;

        const menuSlice = (ctx as any).get("menuAPICtx");
        const menuAPIVal = menuSlice && typeof menuSlice.get === "function" ? menuSlice.get() : menuSlice;

        if (isEmpty) {
          if (menuAPIVal?.show) {
            menuAPIVal.show(selection.from);
          }
        } else {
          const pos = $from.after(1);
          const paragraphType = state.schema.nodes.paragraph;
          let tr = state.tr.insert(pos, paragraphType.create());
          tr = tr.setSelection(TextSelection.near(tr.doc.resolve(pos)));
          dispatch(tr.scrollIntoView());

          setTimeout(() => {
            if (menuAPIVal?.show) {
              menuAPIVal.show(tr.selection.from);
            }
          }, 20);
        }
      });
    };

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
      return check(files);
    };

    const handleDragEnter = (e: DragEvent) => {
      const isAppDrag = getDragState() !== null ||
        (e.dataTransfer?.types && Array.from(e.dataTransfer.types).some(t => t.startsWith("application/kognote")));
      const isOsFileDrag = e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes("Files");

      if (isAppDrag || isOsFileDrag) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    const handleDragOver = (e: DragEvent) => {
      const isAppDrag = getDragState() !== null ||
        (e.dataTransfer?.types && Array.from(e.dataTransfer.types).some(t => t.startsWith("application/kognote")));
      const isOsFileDrag = e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes("Files");

      if (isAppDrag || isOsFileDrag) {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = "copy";
        }
      }
    };

    const handleDrop = async (e: DragEvent) => {
      const fileDataStr = e.dataTransfer?.getData("application/kognote-file");
      const tagDataStr = e.dataTransfer?.getData("application/kognote-tag");
      const plainTextPath = e.dataTransfer?.getData("text/plain");

      const draggedTag = getDragState("tag");
      const draggedState = getDragState("file") || getDragState("card");
      const isOsFileDrop = e.dataTransfer?.files && e.dataTransfer.files.length > 0;

      // If this is an internal drag (not from sidebar, not a vault file, not external files), let ProseMirror handle native block/text reordering
      const isExternalOrSidebarDrag =
        draggedTag !== null ||
        draggedState !== null ||
        !!tagDataStr ||
        !!fileDataStr ||
        isOsFileDrop ||
        (!!plainTextPath && isVaultFile(plainTextPath.trim()));

      if (!isExternalOrSidebarDrag) {
        return; // Allow native editor drag-and-drop to handle block reordering
      }

      // 1. Tag drop handling
      let tagText: string | null = null;
      if (draggedTag) {
        tagText = `#${draggedTag}`;
      } else if (tagDataStr) {
        tagText = `#${tagDataStr}`;
      }

      if (tagText) {
        e.preventDefault();
        e.stopPropagation();

        const crepe = crepeRef.current;
        if (crepe) {
          crepe.editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { state, dispatch } = view;
            const coordinates = view.posAtCoords({ left: e.clientX, top: e.clientY });
            const pos = coordinates ? coordinates.pos : state.selection.from;
            const tr = state.tr.insertText(tagText, pos);
            dispatch(tr.scrollIntoView());
          });
        }
        return;
      }

      // 2. Note / File Backlink drop handling
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

      if (droppedFilePath) {
        e.preventDefault();
        e.stopPropagation();

        const isImg = isImageFile(droppedFilePath);
        const crepe = crepeRef.current;
        if (crepe) {
          crepe.editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { state, dispatch } = view;
            const coordinates = view.posAtCoords({ left: e.clientX, top: e.clientY });
            const pos = coordinates ? coordinates.pos : state.selection.from;

            if (isImg) {
              const assetUrl = convertFileSrc(droppedFilePath);
              const fileName = droppedFilePath.split(/[/\\]/).pop() || "image";

              const imageType = state.schema.nodes.image || state.schema.nodes.image_block;
              if (imageType) {
                try {
                  const node = imageType.createAndFill({ src: assetUrl, alt: fileName }) ||
                               imageType.create({ src: assetUrl, alt: fileName });
                  if (node) {
                    const tr = state.tr.insert(pos, node);
                    dispatch(tr.scrollIntoView());
                    return;
                  }
                } catch (_) {}
              }
              const tr = state.tr.insertText(`![[${fileName}]]`, pos);
              dispatch(tr.scrollIntoView());
            } else {
              const linkTarget = getShortestUniquePath(droppedFilePath, vaultPath, files);
              const tr = state.tr.insertText(`[[${linkTarget}]]`, pos);
              dispatch(tr.scrollIntoView());
            }
          });
        }
        return;
      }

      // 3. External OS Image File Drop handling
      if (!fileDataStr && e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        const filesToProcess = Array.from(e.dataTransfer.files);
        const imageFile = filesToProcess.find(f => isImageFile(f.name));
        if (imageFile && attachmentsFolderPath) {
          e.preventDefault();
          e.stopPropagation();

          try {
            const cleanName = imageFile.name ? imageFile.name.replace(/\s+/g, "_") : `dropped_${Date.now()}.png`;
            const timestamp = Date.now();
            const fileName = `${timestamp}_${cleanName}`;
            const separator = attachmentsFolderPath.includes("\\") ? "\\" : "/";
            const destPath = `${attachmentsFolderPath}${separator}${fileName}`;

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
            refreshFiles();

            const assetUrl = convertFileSrc(destPath);
            const crepe = crepeRef.current;
            if (crepe) {
              crepe.editor.action((ctx) => {
                const view = ctx.get(editorViewCtx);
                const { state, dispatch } = view;
                const coordinates = view.posAtCoords({ left: e.clientX, top: e.clientY });
                const pos = coordinates ? coordinates.pos : state.selection.from;

                const imageType = state.schema.nodes.image || state.schema.nodes.image_block;
                if (imageType) {
                  try {
                    const node = imageType.createAndFill({ src: assetUrl, alt: fileName }) ||
                                 imageType.create({ src: assetUrl, alt: fileName });
                    if (node) {
                      const tr = state.tr.insert(pos, node);
                      dispatch(tr.scrollIntoView());
                      return;
                    }
                  } catch (_) {}
                }
                const tr = state.tr.insertText(`![[${fileName}]]`, pos);
                dispatch(tr.scrollIntoView());
              });
            }
          } catch (err) {
            console.error("Drop image failed:", err);
          }
        }
      }
    };

    container.addEventListener("dragenter", handleDragEnter, true);
    container.addEventListener("dragover", handleDragOver, true);
    container.addEventListener("pointerup", handlePointerUp, true);
    container.addEventListener("drop", handleDrop, true);

    return () => {
      container.removeEventListener("dragenter", handleDragEnter, true);
      container.removeEventListener("dragover", handleDragOver, true);
      container.removeEventListener("pointerup", handlePointerUp, true);
      container.removeEventListener("drop", handleDrop, true);
    };
  }, [attachmentsFolderPath, refreshFiles]);

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      onClick={handleContainerClick}
      className="h-full w-full overflow-y-auto px-6 py-6 font-sans text-foreground focus:outline-none custom-milkdown-container bg-background selection:bg-indigo-600/35 relative"
    >


      <Milkdown />

      {/* Autocomplete Popup Dropdown for [[wikilinks]] and #tags */}
      {autocompletePopup && currentOptions.length > 0 && (
        <div
          className={`fixed z-130 max-h-60 overflow-y-auto rounded-xl bg-card border border-indigo-500/30 p-1.5 shadow-2xl backdrop-blur-md animate-fade-in text-xs font-sans ${
            autocompletePopup.type === "date" ? "w-80" : "w-64"
          }`}
          style={{ top: `${autocompletePopup.coords.top}px`, left: `${autocompletePopup.coords.left}px` }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="px-2 py-1 border-b border-card-border mb-1 flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
            {autocompletePopup.type === "link" ? (
              <div className="flex items-center gap-1.5">
                <FileText className="h-3 w-3 text-indigo-400" />
                <span>Link to Note</span>
              </div>
            ) : autocompletePopup.type === "tag" ? (
              <div className="flex items-center gap-1.5">
                <TagIcon className="h-3 w-3 text-emerald-400" />
                <span>Insert Tag</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <Calendar className="h-3 w-3 text-cyan-400" />
                <span>Smart Date & Time Picker (@)</span>
              </div>
            )}

            {autocompletePopup.type === "date" && (
              <div className="flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
                <input
                  type="date"
                  value={pickerDate || formatDateISO(new Date())}
                  title="Pick Date"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-sidebar border border-card-border rounded text-[10px] px-1.5 py-0.5 text-foreground outline-none cursor-pointer hover:border-indigo-500/50 transition-colors"
                  onChange={(e) => {
                    const d = e.target.value;
                    setPickerDate(d);
                  }}
                />
                <input
                  type="time"
                  value={pickerTime}
                  title="Pick Time"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-sidebar border border-card-border rounded text-[10px] px-1.5 py-0.5 text-foreground outline-none cursor-pointer hover:border-indigo-500/50 transition-colors"
                  onChange={(e) => {
                    const t = e.target.value;
                    setPickerTime(t);
                  }}
                />
                <button
                  type="button"
                  title="Insert Date & Time"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    const d = pickerDate || formatDateISO(new Date());
                    const prefix = autocompletePopup.query.toLowerCase().startsWith("due") ? "@due:" : "@";
                    const valWithTime = pickerTime ? formatUtcIsoFromDateAndTime(d, pickerTime) : d;
                    const val = `${prefix}${valWithTime}`;
                    handleSelectSuggestion({ label: d, value: val, sublabel: val });
                  }}
                  className="px-1.5 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] transition-colors cursor-pointer shrink-0"
                >
                  ✓
                </button>
              </div>
            )}
          </div>

          {currentOptions.map((item, idx) => (
            <button
              key={item.value + idx}
              onClick={() => handleSelectSuggestion(item)}
              className={`w-full text-left rounded-lg px-2.5 py-1.5 text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                idx === selectedIndex
                  ? "bg-indigo-600 text-white font-semibold shadow-md"
                  : "text-slate-700 dark:text-slate-300 hover:bg-card-hover hover:text-indigo-600 dark:hover:text-indigo-300"
              }`}
            >
              <span className="truncate">{item.label}</span>
              {item.sublabel && (
                <span
                  className={`text-[9.5px] font-mono shrink-0 ml-2 px-1.5 py-0.5 rounded ${
                    idx === selectedIndex
                      ? "bg-indigo-700/60 text-indigo-100"
                      : "bg-sidebar border border-card-border text-slate-600 dark:text-slate-400"
                  }`}
                >
                  {item.sublabel}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export const WysiwygEditor: React.FC<WysiwygEditorProps> = (props) => {
  return (
    <MilkdownProvider>
      <WysiwygEditorInner {...props} />
    </MilkdownProvider>
  );
};
