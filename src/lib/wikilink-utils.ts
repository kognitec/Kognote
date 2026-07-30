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
