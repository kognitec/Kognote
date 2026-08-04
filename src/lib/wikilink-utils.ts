export interface FileEntrySimple {
  name: string;
  path: string;
  is_dir?: boolean;
  children?: FileEntrySimple[];
}

/**
 * Normalizes a file path to use forward slashes and lowercasing for consistent comparison.
 */
export function normalizePath(pathStr: string): string {
  return pathStr.replace(/\\/g, "/");
}

/**
 * Given a file path within a vault, computes the Shortest Unique Path needed to disambiguate it
 * from any other file sharing the same basename (title).
 *
 * Examples:
 * - Unique note title across vault: `Meeting.md` -> `Meeting`
 * - Collision: `Work/Meeting.md` & `Personal/Meeting.md` -> `Work/Meeting` vs `Personal/Meeting`
 * - Deeper collision: `Work/A/Meeting.md` & `Work/B/Meeting.md` -> `A/Meeting` vs `B/Meeting`
 */
export function getShortestUniquePath(
  targetFilePath: string,
  vaultPath: string | null,
  allFiles: FileEntrySimple[]
): string {
  const normTarget = normalizePath(targetFilePath);
  const vClean = vaultPath ? normalizePath(vaultPath).replace(/\/$/, "") : "";

  // Helper to extract relative path from vault root
  const getRelPath = (fullPath: string): string => {
    const norm = normalizePath(fullPath);
    if (vClean && norm.startsWith(vClean)) {
      return norm.slice(vClean.length).replace(/^\//, "");
    }
    return norm;
  };

  const targetRelPath = getRelPath(normTarget);
  const targetBaseName = normTarget.split("/").pop()?.replace(/\.(md|excalidraw)$/i, "") || "";

  if (!targetBaseName) return targetRelPath;

  // Gather all files in vault that share the same base name (case-insensitive)
  const collidingRelPaths: string[] = [];
  
  const collectCollisions = (entries: FileEntrySimple[]) => {
    entries.forEach((e) => {
      if (e.is_dir && e.children) {
        collectCollisions(e.children);
        return;
      }
      if (!e.is_dir) {
        const base = e.name.replace(/\.(md|excalidraw)$/i, "");
        if (base.toLowerCase() === targetBaseName.toLowerCase()) {
          const rel = getRelPath(e.path).replace(/\.(md|excalidraw)$/i, "");
          if (!collidingRelPaths.includes(rel)) {
            collidingRelPaths.push(rel);
          }
        }
      }
    });
  };

  collectCollisions(allFiles);

  const targetRelNoExt = targetRelPath.replace(/\.(md|excalidraw)$/i, "");

  // If unique base name across vault, return title only
  if (collidingRelPaths.length <= 1) {
    return targetBaseName;
  }

  // Break matching relative paths into segments from right to left
  const targetSegments = targetRelNoExt.split("/");
  
  // Find minimum number of segments (starting from rightmost) that uniquely identifies targetRelNoExt
  for (let numSegments = 1; numSegments <= targetSegments.length; numSegments++) {
    const candidatePath = targetSegments.slice(targetSegments.length - numSegments).join("/");
    const candidateLower = candidatePath.toLowerCase();

    const matchesCount = collidingRelPaths.filter((rel) => {
      const relSegments = rel.split("/");
      if (relSegments.length < numSegments) return false;
      const relCandidate = relSegments.slice(relSegments.length - numSegments).join("/");
      return relCandidate.toLowerCase() === candidateLower;
    }).length;

    if (matchesCount === 1) {
      return candidatePath;
    }
  }

  return targetRelNoExt;
}

/**
 * Extracts wikilinks [[link]] from markdown content while strictly ignoring
 * any matches inside fenced code blocks (```...```) or inline code spans (`...`).
 */
export function parseWikilinksOutsideCode(content: string): string[] {
  if (!content) return [];

  // Remove frontmatter if present
  let bodyContent = content;
  if (content.startsWith("---")) {
    const endFm = content.indexOf("\n---", 3);
    if (endFm !== -1) {
      bodyContent = content.slice(endFm + 4);
    }
  }

  // Mask fenced code blocks (```...``` or ~~~...~~~)
  const sanitized = bodyContent
    .replace(/```[\s\S]*?```/g, "")
    .replace(/~~~[\s\S]*?~~~/g, "")
    .replace(/`[^`\n]+`/g, ""); // Mask inline code spans

  const linksSet = new Set<string>();
  const linkRegex = /(?:\\?\[){2}(.*?)(?:\\?\]){2}/g;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(sanitized)) !== null) {
    const rawLink = match[1].replace(/\\/g, "").trim();
    if (rawLink && rawLink.toLowerCase() !== "none") {
      linksSet.add(rawLink);
    }
  }

  return Array.from(linksSet);
}

/**
 * Safely replaces wikilinks [[oldTarget]] with [[newTarget]] across markdown content.
 * Guarantees that fenced code blocks (```...```) and inline code spans (`...`)
 * remain completely untouched to prevent refactoring corruption.
 */
export function replaceWikilinksOutsideCode(
  content: string,
  oldTarget: string,
  newTarget: string
): string {
  if (!content || !oldTarget || !newTarget || oldTarget === newTarget) {
    return content;
  }

  // Tokenize markdown into code segments and non-code segments
  // We use a regex splitter that captures fenced code blocks and inline code spans
  const codeBlockRegex = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g;
  const parts = content.split(codeBlockRegex);

  const escapedOld = oldTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const backlinkRegex = new RegExp(`\\[\\[${escapedOld}\\]\\]`, "gi");

  return parts
    .map((part) => {
      // If this part is a code block or code span, return it as-is
      if (
        (part.startsWith("```") && part.endsWith("```")) ||
        (part.startsWith("~~~") && part.endsWith("~~~")) ||
        (part.startsWith("`") && part.endsWith("`") && part.length > 1)
      ) {
        return part;
      }

      // Otherwise, perform safe wikilink replacement in non-code text
      return part.replace(backlinkRegex, `[[${newTarget}]]`);
    })
    .join("");
}

import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Converts a raw local image path (absolute Windows/macOS path or relative Attachments/ path)
 * into a Tauri v2 asset protocol URL (e.g. http://asset.localhost/...) using convertFileSrc.
 */
export function resolveLocalImagePath(
  src: string,
  vaultPath?: string | null,
  attachmentsFolderPath?: string | null
): string {
  if (!src) return "";

  // If already HTTP/HTTPS/data/blob, return as-is
  if (/^(https?:|data:|blob:)/i.test(src)) {
    return src;
  }

  // Strip leading file:// scheme if present
  let cleanPath = decodeURIComponent(src.trim().replace(/^file:\/\/\/?/i, ""));

  // If it already starts with asset:// or http(s)://asset.localhost, return as-is
  if (
    cleanPath.startsWith("asset://") ||
    cleanPath.startsWith("http://asset.localhost") ||
    cleanPath.startsWith("https://asset.localhost")
  ) {
    return cleanPath;
  }

  let absoluteDiskPath = cleanPath;
  const isWindowsAbsolute = /^[a-zA-Z]:[\\\/]/.test(cleanPath);
  const isPosixAbsolute = /^\//.test(cleanPath);
  const isAbsolute = isWindowsAbsolute || isPosixAbsolute;

  if (!isAbsolute) {
    // Relative path (e.g. "Attachments/1785578151779_image.png" or "1785578151779_image.png")
    const filename = cleanPath.replace(/^Attachments[\\\/]/i, "");
    if (attachmentsFolderPath) {
      const sep = attachmentsFolderPath.includes("\\") ? "\\" : "/";
      absoluteDiskPath = `${attachmentsFolderPath}${sep}${filename}`;
    } else if (vaultPath) {
      const sep = vaultPath.includes("\\") ? "\\" : "/";
      absoluteDiskPath = `${vaultPath}${sep}${cleanPath}`;
    }
  }

  try {
    return convertFileSrc(absoluteDiskPath);
  } catch (err) {
    console.error("convertFileSrc failed for path:", absoluteDiskPath, err);
    return src;
  }
}

/**
 * Pre-processes a markdown string, converting all local image paths (![alt](path) and ![[image.png]])
 * to valid Tauri v2 asset protocol URLs via convertFileSrc.
 */
export function processMarkdownImages(
  markdown: string,
  vaultPath?: string | null,
  attachmentsFolderPath?: string | null
): string {
  if (!markdown) return "";

  // 0. Un-escape backslash-escaped markdown image tags like !\[alt\]\(http\://...\)
  let processed = markdown.replace(/!\\?\[(.*?)\\?\]\(http\\?:(.*?)\)/g, (_m, alt, rest) => {
    const cleanAlt = alt.replace(/\\_/g, "_").replace(/\\\[/g, "[").replace(/\\\]/g, "]");
    const cleanUrl = `http:${rest.replace(/\\_/g, "_").replace(/\\:/g, ":")}`;
    return `![${cleanAlt}](${cleanUrl})`;
  });

  // 1. Transform ![[image.png]] or ![[Attachments/image.png]] wikilink image syntax into standard markdown image ![image.png](assetUrl)
  processed = processed.replace(/!\[\[(.*?\.(?:png|jpe?g|gif|webp|svg|avif|bmp))\]\]/gi, (_match, filename) => {
    const assetUrl = resolveLocalImagePath(filename, vaultPath, attachmentsFolderPath);
    const alt = filename.split("/").pop()?.split("\\").pop() || filename;
    return `![${alt}](${assetUrl})`;
  });

  // 2. Transform standard markdown images ![alt](localPath)
  processed = processed.replace(/!\[(.*?)\]\((.*?)\)/g, (match, alt, src) => {
    if (!src || /^(https?:|data:|blob:)/i.test(src)) {
      return match;
    }
    const assetUrl = resolveLocalImagePath(src, vaultPath, attachmentsFolderPath);
    return `![${alt}](${assetUrl})`;
  });

  return processed;
}

/**
 * Un-escapes wikilinks that were backslash-escaped by Markdown serializers (e.g. \[\[note name\]\] -> [[note name]])
 * and un-escapes characters inside wikilinks (e.g. [[milkdown\_new]] -> [[milkdown_new]]),
 * while strictly preserving code blocks and inline code spans.
 */
export function cleanEscapedWikilinks(markdown: string): string {
  if (!markdown) return "";

  // Regex matches fenced code blocks (```...``` or ~~~...~~~) or inline code spans (`...`)
  const codeBlockRegex = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]+`)/g;
  const parts = markdown.split(codeBlockRegex);

  const IMAGE_EXTS_REGEX = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

  return parts.map((part, index) => {
    // Odd indices in split array are code blocks/spans -> keep intact
    if (index % 2 === 1) {
      return part;
    }

    // 1. Convert local asset image syntax ![alt](assetUrl "title") back into ![[filename.ext]]
    let cleaned = part.replace(/!\[([\s\S]*?)\]\(([\s\S]*?)\)/g, (fullMatch, alt, srcAndTitle) => {
      if (!srcAndTitle) return fullMatch;
      const src = srcAndTitle.trim().split(/\s+["']/)[0].replace(/\\/g, "");
      // Skip external HTTP/HTTPS web images
      if (/^https?:\/\/(?!asset\.localhost)/i.test(src)) {
        return fullMatch;
      }
      const unescapedSrc = decodeURIComponent(src);
      const rawName = unescapedSrc.split(/[/\\]/).pop() || alt.replace(/\\/g, "") || "";
      const cleanName = rawName.split("?")[0].trim();
      if (IMAGE_EXTS_REGEX.test(cleanName)) {
        return `![[${cleanName}]]`;
      }
      return fullMatch;
    });

    // 2. Clean embedded image wikilinks !\[\[image.png\]\] or ![[image\_1.png]] -> ![[image_1.png]]
    cleaned = cleaned.replace(/!\\?\[\\?\[([\s\S]*?)\\?\]\\?\]/g, (_m, inner) => {
      const cleanInner = inner.replace(/\\(.)/g, "$1");
      return `![[${cleanInner}]]`;
    });

    // 3. Clean standard text wikilinks (not preceded by !) \[\[note\_name\]\] or [[note\_name]] -> [[note_name]]
    cleaned = cleaned.replace(/(?<!!)\\?\[\\?\[([\s\S]*?)\\?\]\\?\]/g, (_m, inner) => {
      const cleanInner = inner.replace(/\\(.)/g, "$1");
      return `[[${cleanInner}]]`;
    });

    return cleaned;
  }).join("");
}
