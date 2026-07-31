import React, { useState, useEffect, useRef, useCallback } from "react";
import { Excalidraw, convertToExcalidrawElements, viewportCoordsToSceneCoords, MainMenu } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useSettings } from "../contexts/SettingsContext";
import { useVault } from "../contexts/VaultContext";
import { invokeIPC } from "../lib/ipc";
import { parseFrontmatter } from "../lib/frontmatter";
import { getDragState, clearDragState } from "../lib/drag-state";

// Helper function to manually wrap text to fit within card bounds
function wrapText(text: string, maxCharsPerLine: number = 24): string {
  const lines = text.split("\n");
  const wrappedLines: string[] = [];

  for (const line of lines) {
    if (line.trim().length === 0) {
      wrappedLines.push("");
      continue;
    }

    if (line.length <= maxCharsPerLine) {
      wrappedLines.push(line);
      continue;
    }

    let currentLine = "";
    const words = line.split(" ");
    for (const word of words) {
      if ((currentLine + " " + word).trim().length <= maxCharsPerLine) {
        currentLine = (currentLine + " " + word).trim();
      } else {
        if (currentLine) {
          wrappedLines.push(currentLine);
        }
        currentLine = word;
      }
    }
    if (currentLine) {
      wrappedLines.push(currentLine);
    }
  }

  return wrappedLines.join("\n");
}

// Formats full title text to wrap cleanly without truncation
function getTitleWrappedText(noteTitle: string): string {
  const cleanTitle = noteTitle.replace(/\.md$/, "");
  return wrapText(cleanTitle, 24);
}

interface NoteCardInfo {
  title: string;
  headerLine: string;
  footerLine: string;
  strokeColor: string;
  height: number;
}

function parseNoteCardData(
  rawContent: string,
  fileName: string,
  cachedMeta?: any,
  cachedTasks?: any[]
): NoteCardInfo {
  const parsed = parseFrontmatter(rawContent);
  const fields = { ...parsed.fields, ...(cachedMeta || {}) };
  const noteTitle = fileName.replace(/\.md$/, "");

  // 1. Header Line (Type, Priority, Status, Bookmark)
  const typeStr = (fields.type || "note").toUpperCase();
  let typeLabel = `📄 ${typeStr}`;
  if (typeStr === "DAILY") typeLabel = "📅 DAILY";
  if (typeStr === "TEMPLATE") typeLabel = "🗂️ TEMPLATE";
  if (typeStr === "CLIPPING") typeLabel = "✂️ CLIPPING";

  const priority = (fields.priority || "none").toLowerCase();
  let priorityLabel = "";
  let strokeColor = "#6366f1"; // default indigo border

  if (priority === "high") {
    priorityLabel = "🔴 HIGH";
    strokeColor = "#f43f5e";
  } else if (priority === "medium") {
    priorityLabel = "🟡 MEDIUM";
    strokeColor = "#f59e0b";
  } else if (priority === "low") {
    priorityLabel = "🔵 LOW";
    strokeColor = "#3b82f6";
  }

  const rawStatus = (fields.status || "none").toLowerCase();
  let statusLabel = "";
  if (rawStatus === "in-progress" || rawStatus === "inprogress") {
    statusLabel = "🔄 IN PROGRESS";
  } else if (rawStatus === "in-review" || rawStatus === "inreview") {
    statusLabel = "👀 IN REVIEW";
  } else if (rawStatus === "done") {
    statusLabel = "✅ DONE";
  } else if (rawStatus === "todo") {
    statusLabel = "📋 TODO";
  } else if (rawStatus === "backlog") {
    statusLabel = "📥 BACKLOG";
  }

  const isBookmarked = fields.bookmarked === "yes" || fields.storage === "bookmarked";
  const bookmarkLabel = isBookmarked ? "🔖 BOOKMARKED" : "";

  const headerParts: string[] = [typeLabel];
  if (priorityLabel) headerParts.push(priorityLabel);
  if (statusLabel) headerParts.push(statusLabel);
  if (bookmarkLabel) headerParts.push(bookmarkLabel);

  const headerLine = headerParts.join("  ·  ");

  // 2. Full Note Title (wrapped cleanly)
  const wrappedTitle = getTitleWrappedText(noteTitle);
  const titleLineCount = wrappedTitle.split("\n").length;

  // 3. Footer Metadata Items (Due Date, Storage State, Tasks)
  const footerParts: string[] = [];

  // Due Date
  const due = fields.due ? fields.due.trim() : "";
  if (due) {
    footerParts.push(`📅 Due: ${due}`);
  }

  // Storage State Label
  const storage = (fields.storage || "active").toLowerCase();
  let storageLabel = "📂 Active";
  if (storage === "archived") storageLabel = "📦 Archived";
  if (storage === "deleted") storageLabel = "🗑️ Deleted";
  footerParts.push(storageLabel);

  // Task Completion Progress (using central task scanner data or fallback regex)
  let totalTasks = 0;
  let completedTasks = 0;

  if (cachedTasks && Array.isArray(cachedTasks)) {
    totalTasks = cachedTasks.length;
    completedTasks = cachedTasks.filter((t: any) => t.completed).length;
  } else {
    const taskRegex = /(?:^|\n)[\s\t]*[-\*\d\.]+\s*\[([ xX])\]\s*(.*)/g;
    const taskMatches = Array.from(rawContent.matchAll(taskRegex));
    totalTasks = taskMatches.length;
    completedTasks = taskMatches.filter(m => m[1].toLowerCase() === "x").length;
  }

  if (totalTasks > 0) {
    footerParts.push(`✓ ${completedTasks}/${totalTasks} Tasks`);
  }

  const footerLine = footerParts.join("     ");

  // Calculate dynamic card height based on title line count
  const height = Math.max(125, 85 + titleLineCount * 22);

  return {
    title: wrappedTitle,
    headerLine,
    footerLine,
    strokeColor,
    height
  };
}

// Helper to resolve moved note paths across active, archived, and deleted states
function resolveNotePath(
  originalPath: string,
  noteCache: Record<string, any>,
  files: any[]
): string | null {
  if (noteCache[originalPath]) {
    return originalPath;
  }

  const fileName = originalPath.replace(/\\/g, "/").split("/").pop() || "";
  if (!fileName) return null;

  const fileNameLower = fileName.toLowerCase();

  const cacheKeys = Object.keys(noteCache);
  const cacheMatch = cacheKeys.find((k) => {
    const kName = k.replace(/\\/g, "/").split("/").pop() || "";
    return kName.toLowerCase() === fileNameLower;
  });

  if (cacheMatch) {
    return cacheMatch;
  }

  function findInFiles(items: any[]): string | null {
    for (const item of items) {
      if (item.is_dir) {
        if (item.children) {
          const res = findInFiles(item.children);
          if (res) return res;
        }
      } else {
        if (item.name.toLowerCase() === fileNameLower) {
          return item.path;
        }
      }
    }
    return null;
  }

  return findInFiles(files);
}

export const Canvas: React.FC = () => {
  const { vaultPath } = useSettings();
  const { openFile, activeFile, noteCache, files, attachmentsFolderPath, refreshFiles } = useVault();
  const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
  const [isReady, setIsReady] = useState(false);
  const [initialData, setInitialData] = useState<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<number | null>(null);
  const lastClickRef = useRef<{ time: number; elementId: string } | null>(null);

  // Resolve the active canvas file path
  const currentCanvasPath = (activeFile && activeFile.name.endsWith(".excalidraw"))
    ? activeFile.path
    : "";

  // Track the current path in a ref so the debounced save callback always uses the fresh path
  const currentPathRef = useRef(currentCanvasPath);
  useEffect(() => {
    currentPathRef.current = currentCanvasPath;
  }, [currentCanvasPath]);

  // Load layout snapshots whenever the target canvas file or cached notes change
  useEffect(() => {
    if (!vaultPath) return;
    let isCurrent = true;

    async function loadLayout() {
      if (!activeFile || !activeFile.name.endsWith(".excalidraw")) return;

      const targetPath = activeFile.path;

      try {
        const fileExists = await invokeIPC("fs_exists", { path: targetPath });
        if (!isCurrent) return;
        let data: { elements: any[]; appState: any } = { elements: [], appState: { theme: "dark" } };

        if (fileExists) {
          const jsonStr = await invokeIPC("fs_read", { path: targetPath });
          if (!isCurrent) return;
          if (jsonStr) {
            try {
              data = JSON.parse(jsonStr);
            } catch (jsonErr) {
              console.error("Invalid canvas json layout, resetting:", jsonErr);
            }
          }
        }

        // Dynamically sync note card elements with actual files on disk & in-memory cache
        if (data.elements && data.elements.length > 0) {
          const noteElements = data.elements.filter((el: any) => el.customData?.type === "note" && el.customData?.path);
          if (noteElements.length > 0) {
            const uniqueOriginalPaths = Array.from(new Set(noteElements.map((el: any) => el.customData.path))) as string[];
            const pathMapping: Record<string, string> = {};
            const noteContentMap: Record<string, string> = {};

            await Promise.all(
              uniqueOriginalPaths.map(async (origPath) => {
                try {
                  let resolvedPath: string | null = origPath;

                  const existsOrig = await invokeIPC("fs_exists", { path: origPath }).catch(() => false);
                  if (!existsOrig && !noteCache[origPath]) {
                    resolvedPath = resolveNotePath(origPath, noteCache, files);
                  }

                  if (!resolvedPath || !isCurrent) return;

                  pathMapping[origPath] = resolvedPath;

                  const inMemory = noteCache[resolvedPath];
                  let content = inMemory?.content;
                  if (content === undefined || content === null) {
                    const exists = await invokeIPC("fs_exists", { path: resolvedPath }).catch(() => false);
                    if (!isCurrent || !exists) return;

                    try {
                      content = await invokeIPC("read_note", {
                        path: resolvedPath,
                      }) as string;
                    } catch {
                      content = await invokeIPC("fs_read", { path: resolvedPath }).catch(() => "") as string;
                    }
                  }

                  if (!isCurrent) return;
                  if (content !== undefined && content !== null) {
                    noteContentMap[origPath] = content;
                  }
                } catch (readErr) {
                  console.warn("Failed to sync note data on canvas load:", origPath, readErr);
                }
              })
            );

            if (!isCurrent) return;

            data.elements = data.elements.map((el: any) => {
              if (el.customData?.type === "note" && el.customData?.path) {
                const origPath = el.customData.path;
                const resolvedPath = pathMapping[origPath] || origPath;
                const freshContent = noteContentMap[origPath] || "";

                const nameWithExt = resolvedPath.replace(/\\/g, "/").split("/").pop() || "";
                const cachedData = noteCache[resolvedPath];
                const cardInfo = parseNoteCardData(
                  freshContent,
                  nameWithExt,
                  cachedData?.meta,
                  cachedData?.tasks
                );

                const nextVersion = (el.version || 1) + 1;
                const versionNonce = Math.floor(Math.random() * 1000000);

                if (el.type === "text") {
                  if (el.customData?.role === "header") {
                    return {
                      ...el,
                      text: cardInfo.headerLine,
                      width: 245,
                      height: 20,
                      fontFamily: 2,
                      strokeColor: "#94a3b8",
                      version: nextVersion,
                      versionNonce,
                      customData: { ...el.customData, path: resolvedPath, name: nameWithExt }
                    };
                  }
                  if (el.customData?.role === "title" || el.fontSize === 16 || el.fontSize === 15) {
                    return {
                      ...el,
                      text: cardInfo.title,
                      width: 245,
                      height: 48,
                      fontFamily: 2,
                      strokeColor: "#ffffff",
                      version: nextVersion,
                      versionNonce,
                      customData: { ...el.customData, path: resolvedPath, name: nameWithExt }
                    };
                  }
                  if (el.customData?.role === "footer" || el.customData?.role === "body" || el.fontSize === 12 || el.fontSize === 11 || el.fontSize === 10) {
                    return {
                      ...el,
                      text: cardInfo.footerLine,
                      width: 245,
                      height: 20,
                      fontFamily: 2,
                      strokeColor: "#cbd5e1",
                      version: nextVersion,
                      versionNonce,
                      customData: { ...el.customData, path: resolvedPath, name: nameWithExt }
                    };
                  }
                } else if (el.type === "rectangle") {
                  return {
                    ...el,
                    width: 270,
                    height: Math.max(135, cardInfo.height),
                    strokeColor: cardInfo.strokeColor,
                    backgroundColor: "#000000",
                    fillStyle: "solid",
                    link: resolvedPath,
                    version: nextVersion,
                    versionNonce,
                    customData: {
                      ...el.customData,
                      path: resolvedPath,
                      name: nameWithExt
                    }
                  };
                }
              }
              return el;
            });
          }
        }

        if (!isCurrent) return;

        const formattedData = {
          elements: data.elements || [],
          appState: {
            ...(data.appState || {}),
            theme: "dark"
          }
        };

        if (excalidrawAPI) {
          excalidrawAPI.updateScene(formattedData);
        } else {
          setInitialData(formattedData);
        }
      } catch (err) {
        console.error("Failed to load canvas layout:", err);
      } finally {
        if (isCurrent) {
          setIsReady(true);
        }
      }
    }

    loadLayout();

    return () => {
      isCurrent = false;
    };
  }, [vaultPath, activeFile?.path, excalidrawAPI, noteCache, files]);

  // Debounced auto-save of elements state to disk
  const saveLayout = useCallback(async (currentElements: readonly any[], currentAppState: any) => {
    if (!vaultPath || !currentPathRef.current) return;
    try {
      const data = {
        elements: currentElements.filter(el => !el.isDeleted),
        appState: {
          scrollX: currentAppState.scrollX,
          scrollY: currentAppState.scrollY,
          zoom: currentAppState.zoom
        }
      };
      const jsonStr = JSON.stringify(data, null, 2);
      await invokeIPC("fs_write", { path: currentPathRef.current, content: jsonStr });
    } catch (err) {
      console.error("Failed to autosave Excalidraw board:", err);
    }
  }, [vaultPath]);

  const onChange = (elements: readonly any[], state: any) => {
    if (!isReady) return;

    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(() => {
      saveLayout(elements, state);
    }, 1500) as unknown as number;
  };

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const onPointerDown = (_activeTool: any, pointerDownState: any) => {
    const element = pointerDownState.hit?.element;
    if (element && element.customData && element.customData.type === "note") {
      const now = Date.now();
      const last = lastClickRef.current;

      // Handle double click gesture to open note in editor
      if (last && last.elementId === element.id && now - last.time < 300) {
        const data = element.customData as any;
        openFile({
          name: data.name,
          path: data.path,
          is_dir: false
        });
        lastClickRef.current = null;
      } else {
        lastClickRef.current = { time: now, elementId: element.id };
      }
    }
  };

  // HTML5 drag and drop files & attachments onto visual board
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!excalidrawAPI || !containerRef.current) return;

    let item: { name: string; path: string; is_dir?: boolean } | null = null;
    const draggedState = getDragState("file") || getDragState("card");
    if (draggedState) {
      const p = draggedState.path || draggedState.file?.path;
      const n = draggedState.name || draggedState.title || p?.split(/[/\\]/).pop() || "File";
      if (p) {
        item = { name: n, path: p, is_dir: !!draggedState.is_dir };
      }
    }
    if (!item || !item.path) {
      const fileData = e.dataTransfer.getData("application/kognote-file");
      if (fileData) {
        try {
          item = JSON.parse(fileData);
        } catch { }
      }
    }
    if (!item || !item.path) {
      const plainPath = e.dataTransfer.getData("text/plain");
      if (plainPath) {
        const fileName = plainPath.split(/[/\\]/).pop() || "File";
        item = { name: fileName, path: plainPath, is_dir: false };
      }
    }
    if ((!item || !item.path) && e.dataTransfer?.files && e.dataTransfer.files.length > 0 && attachmentsFolderPath) {
      const filesToProcess = Array.from(e.dataTransfer.files);
      const imageFile = filesToProcess.find(f => {
        const ext = f.name.toLowerCase().split('.').pop() || '';
        return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico'].includes(ext);
      });
      if (imageFile) {
        try {
          const cleanName = imageFile.name ? imageFile.name.replace(/\s+/g, "_") : `canvas_${Date.now()}.png`;
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
          item = { name: fileName, path: destPath, is_dir: false };
        } catch (err) {
          console.error("Canvas external OS image drop failed:", err);
        }
      }
    }
    if (!item || !item.path) return;

    try {
      const appState = excalidrawAPI.getAppState();

      // Accurately translate drop client coordinates to Excalidraw scene coordinates
      const sceneCoords = viewportCoordsToSceneCoords(
        { clientX: e.clientX, clientY: e.clientY },
        appState
      );
      const sceneX = sceneCoords.x;
      const sceneY = sceneCoords.y;

      const ext = (item.name || "").toLowerCase().split('.').pop() || '';
      const isImage = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico'].includes(ext);

      // Handle Image Attachments -> Import as native Excalidraw Image element
      if (isImage) {
        let dataUrl = "";
        try {
          const assetUrl = convertFileSrc(item.path);
          const resp = await fetch(assetUrl);
          const blob = await resp.blob();
          dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (fetchErr) {
          console.error("Failed to read image dataUrl for canvas import:", fetchErr);
        }

        let imgWidth = 360;
        let imgHeight = 270;
        if (dataUrl) {
          try {
            const img = new Image();
            img.src = dataUrl;
            await img.decode();
            if (img.naturalWidth && img.naturalHeight) {
              imgWidth = img.naturalWidth;
              imgHeight = img.naturalHeight;
              if (imgWidth > 450) {
                imgHeight = Math.round((450 / imgWidth) * imgHeight);
                imgWidth = 450;
              }
            }
          } catch { }
        }

        const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const mimeType = ext === "svg" ? "image/svg+xml" : `image/${ext === "jpg" ? "jpeg" : ext}`;

        if (dataUrl) {
          excalidrawAPI.addFiles([
            {
              id: fileId,
              dataURL: dataUrl,
              mimeType: mimeType,
              created: Date.now()
            }
          ]);
        }

        const imageElement = {
          type: "image",
          x: sceneX - imgWidth / 2,
          y: sceneY - imgHeight / 2,
          width: imgWidth,
          height: imgHeight,
          fileId: fileId,
          strokeColor: "transparent",
          backgroundColor: "transparent",
          fillStyle: "solid",
          strokeWidth: 1,
          strokeStyle: "solid",
          roughness: 0,
          opacity: 100,
          status: "pending",
          scale: [1, 1],
          link: item.path,
          customData: {
            type: "attachment",
            name: item.name,
            path: item.path
          }
        };

        const newElements = convertToExcalidrawElements([imageElement] as any);
        excalidrawAPI.updateScene({
          elements: [...excalidrawAPI.getSceneElements(), ...newElements]
        });
        return;
      }

      // Handle Non-Image Attachments -> Import as Attachment Card
      if (!item.name.toLowerCase().endsWith(".md")) {
        const groupId = `group_${Date.now()}`;
        const cardElement = {
          type: "rectangle",
          x: sceneX - 125,
          y: sceneY - 45,
          width: 250,
          height: 90,
          strokeColor: "#10b981", // Emerald accent border
          backgroundColor: "#0c0d15",
          fillStyle: "solid",
          strokeWidth: 2,
          strokeStyle: "solid",
          roughness: 0,
          opacity: 100,
          roundness: { type: 3 },
          link: item.path,
          groupIds: [groupId],
          customData: {
            type: "attachment",
            name: item.name,
            path: item.path
          }
        };

        const headerElement = {
          type: "text",
          x: sceneX - 110,
          y: sceneY - 35,
          width: 220,
          height: 18,
          strokeColor: "#34d399",
          backgroundColor: "transparent",
          fillStyle: "transparent",
          strokeWidth: 1,
          strokeStyle: "solid",
          roughness: 0,
          opacity: 100,
          text: `📎 ATTACHMENT · ${ext.toUpperCase()}`,
          fontSize: 9,
          fontFamily: 2,
          textAlign: "left",
          verticalAlign: "top",
          groupIds: [groupId],
          customData: {
            type: "attachment",
            name: item.name,
            path: item.path
          }
        };

        const titleElement = {
          type: "text",
          x: sceneX - 110,
          y: sceneY - 12,
          width: 220,
          height: 35,
          strokeColor: "#ffffff",
          backgroundColor: "transparent",
          fillStyle: "transparent",
          strokeWidth: 1,
          strokeStyle: "solid",
          roughness: 0,
          opacity: 100,
          text: wrapText(item.name, 22),
          fontSize: 14,
          fontFamily: 2,
          textAlign: "left",
          verticalAlign: "top",
          groupIds: [groupId],
          customData: {
            type: "attachment",
            name: item.name,
            path: item.path
          }
        };

        const newElements = convertToExcalidrawElements([cardElement, headerElement, titleElement] as any);
        excalidrawAPI.updateScene({
          elements: [...excalidrawAPI.getSceneElements(), ...newElements]
        });
        return;
      }

      let rawContent = "";
      try {
        rawContent = (await invokeIPC("read_note", {
          path: item.path,
        })) as string;
      } catch {
        rawContent = (await invokeIPC("fs_read", { path: item.path }).catch(() => "")) as string;
      }

      const cachedData = noteCache[item.path];
      const cardInfo = parseNoteCardData(rawContent, item.name, cachedData?.meta, cachedData?.tasks);
      const groupId = `group_${Date.now()}`;

      // Create structured elements representing dynamic Board card:
      // 1. Rectangle card container (Solid Black Background, 270px width)
      const cardElement = {
        type: "rectangle",
        x: sceneX - 135,
        y: sceneY - 65,
        width: 270,
        height: Math.max(135, cardInfo.height),
        strokeColor: cardInfo.strokeColor,
        backgroundColor: "#000000", // Pure Black
        fillStyle: "solid",
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        roundness: { type: 3 },
        link: item.path,
        groupIds: [groupId],
        customData: {
          type: "note",
          name: item.name,
          path: item.path
        }
      };

      // 2. Header text element (Type, Priority, Status, Bookmark)
      const headerElement = {
        type: "text",
        x: sceneX - 120,
        y: sceneY - 52,
        width: 245,
        height: 20,
        strokeColor: "#94a3b8", // Slate light text
        backgroundColor: "transparent",
        fillStyle: "transparent",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        text: cardInfo.headerLine,
        fontSize: 9,
        fontFamily: 2, // Normal Sans-serif font!
        textAlign: "left",
        verticalAlign: "top",
        groupIds: [groupId],
        customData: {
          type: "note",
          name: item.name,
          path: item.path,
          role: "header"
        }
      };

      // 3. Title text element (Full Note Title - Bold Pure White)
      const titleElement = {
        type: "text",
        x: sceneX - 120,
        y: sceneY - 28,
        width: 245,
        height: 48,
        strokeColor: "#ffffff", // Pure White
        backgroundColor: "transparent",
        fillStyle: "transparent",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        text: cardInfo.title,
        fontSize: 15,
        fontFamily: 2, // Normal Sans-serif font!
        textAlign: "left",
        verticalAlign: "top",
        groupIds: [groupId],
        customData: {
          type: "note",
          name: item.name,
          path: item.path,
          role: "title"
        }
      };

      // 4. Footer text element (Due Date, Storage State, Task Progress - NO Word Count)
      const footerElement = {
        type: "text",
        x: sceneX - 120,
        y: sceneY + 32,
        width: 245,
        height: 20,
        strokeColor: "#cbd5e1", // Light slate text
        backgroundColor: "transparent",
        fillStyle: "transparent",
        strokeWidth: 1,
        strokeStyle: "solid",
        roughness: 0,
        opacity: 100,
        text: cardInfo.footerLine,
        fontSize: 9.5,
        fontFamily: 2, // Normal Sans-serif font!
        textAlign: "left",
        verticalAlign: "top",
        groupIds: [groupId],
        customData: {
          type: "note",
          name: item.name,
          path: item.path,
          role: "footer"
        }
      };

      const newElements = convertToExcalidrawElements([
        cardElement,
        headerElement,
        titleElement,
        footerElement
      ] as any);

      excalidrawAPI.updateScene({
        elements: [...excalidrawAPI.getSceneElements(), ...newElements]
      });

    } catch (err) {
      console.error("Error inserting dropped note into Excalidraw canvas:", err);
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleDragOverCapture = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    };

    const handleDropCapture = (e: DragEvent) => {
      handleDrop(e as any);
      clearDragState();
    };

    container.addEventListener("dragenter", handleDragOverCapture, true);
    container.addEventListener("dragover", handleDragOverCapture, true);
    container.addEventListener("drop", handleDropCapture, true);

    return () => {
      container.removeEventListener("dragenter", handleDragOverCapture, true);
      container.removeEventListener("dragover", handleDragOverCapture, true);
      container.removeEventListener("drop", handleDropCapture, true);
    };
  }, [excalidrawAPI, attachmentsFolderPath]);

  if (!isReady || !initialData) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-background text-slate-400">
        Loading Whiteboard...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="h-full w-full relative flex flex-col bg-background"
    >
      <Excalidraw
        excalidrawAPI={(api) => setExcalidrawAPI(api)}
        onChange={onChange}
        theme="dark"
        initialData={initialData}
        onPointerDown={onPointerDown}
        onLinkOpen={(element, event) => {
          event.preventDefault(); // Prevent standard browser redirect/open
          if (element.link) {
            openFile({
              name: element.customData?.name || "Note",
              path: element.link,
              is_dir: false
            });
          }
        }}
        UIOptions={{
          welcomeScreen: false
        }}
      >
        <MainMenu>
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.SaveToActiveFile />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.SearchMenu />
          <MainMenu.DefaultItems.Help />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
      </Excalidraw>
    </div>
  );
};
