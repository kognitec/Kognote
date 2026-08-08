/**
 * SEARCH/REPLACE Block-Diff Engine for Kognote.
 * Replaces target blocks without destroying surrounding text, markdown format, or undo state.
 */

export interface DiffBlock {
  search: string;
  replace: string;
}

/**
 * Parses markdown SEARCH/REPLACE diff blocks from AI output.
 * Supports:
 *   <<<<<<< SEARCH
 *   [exact text to match — can be empty for insert/append]
 *   =======
 *   [new replacement text]
 *   >>>>>>> REPLACE
 *
 * Uses a split-based state machine instead of a fragile regex to
 * correctly handle empty SEARCH sections and varying separator styles.
 */
export function parseDiffBlocks(diffText: string): DiffBlock[] {
  const blocks: DiffBlock[] = [];

  // Normalize all line endings to \n for consistent parsing
  let normalized = diffText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  
  // Strip outer ```markdown ... ``` fence if model wrapped the diff block in markdown code fences
  const outerFenceRegex = /^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i;
  if (outerFenceRegex.test(normalized.trim())) {
    normalized = normalized.trim().replace(outerFenceRegex, "$1");
  }

  const lines = normalized.split("\n");

  let state: "outside" | "search" | "replace" = "outside";
  let searchLines: string[] = [];
  let replaceLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^<{7}\s*SEARCH/i.test(trimmed)) {
      // Start of a new block
      state = "search";
      searchLines = [];
      replaceLines = [];
      continue;
    }

    if (state !== "outside" && /^={4,}$/.test(trimmed)) {
      // Separator — switch from SEARCH to REPLACE collection
      state = "replace";
      continue;
    }

    if (state !== "outside" && /^>{7}\s*REPLACE/i.test(trimmed)) {
      // End of block — commit it
      blocks.push({
        search: searchLines.join("\n"),
        replace: replaceLines.join("\n"),
      });
      state = "outside";
      searchLines = [];
      replaceLines = [];
      continue;
    }

    if (state === "search") {
      searchLines.push(line);
      continue;
    }

    if (state === "replace") {
      replaceLines.push(line);
      continue;
    }
  }

  return blocks;
}

/**
 * Applies search/replace blocks strictly to the document content.
 */
export function applyDiffBlocks(originalContent: string, diffBlocks: DiffBlock[]): { updatedContent: string; appliedCount: number } {
  let content = originalContent;
  let appliedCount = 0;

  for (const block of diffBlocks) {
    // Strip stray backtick code fences from replace content in case the AI wrapped it
    let cleanReplace = block.replace.trim();
    const outerFenceRegex = /^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i;
    if (outerFenceRegex.test(cleanReplace)) {
      cleanReplace = cleanReplace.replace(outerFenceRegex, "$1").trim();
    }
    cleanReplace = cleanReplace
      .replace(/^```(?:markdown|md|text)?\s*\n?/i, "")
      .replace(/\n?```$/, "")
      .trim();

    // If search block is empty, treat as appending replacement to end of document
    if (!block.search.trim()) {
      content = content.trim() ? `${content}\n\n${cleanReplace}` : cleanReplace;
      appliedCount++;
      continue;
    }

    // Exact match using safe index slicing to prevent $ substitution bugs
    const exactIdx = content.indexOf(block.search);
    if (exactIdx !== -1) {
      content = content.slice(0, exactIdx) + cleanReplace + content.slice(exactIdx + block.search.length);
      appliedCount++;
      continue;
    }

    // Fuzzy trim match (handles minor leading/trailing whitespace differences)
    const trimmedSearch = block.search.trim();
    const trimmedIdx = content.indexOf(trimmedSearch);
    if (trimmedIdx !== -1) {
      content = content.slice(0, trimmedIdx) + cleanReplace + content.slice(trimmedIdx + trimmedSearch.length);
      appliedCount++;
      continue;
    }

    // Line-by-line fuzzy match (handles per-line whitespace differences)
    const contentLines = content.split("\n");
    const searchLines = trimmedSearch.split("\n");

    let foundIndex = -1;
    for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
      let allMatch = true;
      for (let j = 0; j < searchLines.length; j++) {
        if (contentLines[i + j].trim() !== searchLines[j].trim()) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex !== -1) {
      const replaceLinesSplit = cleanReplace.split("\n");
      contentLines.splice(foundIndex, searchLines.length, ...replaceLinesSplit);
      content = contentLines.join("\n");
      appliedCount++;
      continue;
    }

    // Tier 4: Fuzzy String Similarity Match (85% similarity threshold)
    // Forgives minor AI typos, extra spaces, or missing punctuation in SEARCH blocks
    let bestSimilarity = 0;
    let bestIndex = -1;
    const searchLen = searchLines.length;

    for (let i = 0; i <= contentLines.length - searchLen; i++) {
      const candidateChunk = contentLines.slice(i, i + searchLen).join("\n");
      const sim = calculateStringSimilarity(candidateChunk, trimmedSearch);
      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        bestIndex = i;
      }
    }

    if (bestIndex !== -1 && bestSimilarity >= 0.85) {
      const replaceLinesSplit = cleanReplace.split("\n");
      contentLines.splice(bestIndex, searchLen, ...replaceLinesSplit);
      content = contentLines.join("\n");
      appliedCount++;
    }
  }

  return { updatedContent: content, appliedCount };
}

/**
 * Fast Levenshtein distance similarity calculation (0.0 to 1.0)
 */
export function calculateStringSimilarity(str1: string, str2: string): number {
  const s1 = str1.trim().toLowerCase();
  const s2 = str2.trim().toLowerCase();
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  const len1 = s1.length;
  const len2 = s2.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const maxLen = Math.max(len1, len2);
  return 1 - matrix[len1][len2] / maxLen;
}

export function applyBlockDiff(original: string, search: string, replace: string): string {
  const { updatedContent } = applyDiffBlocks(original, [{ search, replace }]);
  return updatedContent;
}
