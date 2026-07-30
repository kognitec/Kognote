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
 * Format:
 * <<<<<<< SEARCH
 * [exact text to match]
 * =======
 * [new replacement text]
 * >>>>>>> REPLACE
 */
export function parseDiffBlocks(diffText: string): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  // Resilient regex supporting optional code fences, loose spaces, and multi-line blocks
  const regex = /<<<<<<<\s*SEARCH[^\n]*\r?\n([\s\S]*?)\r?\n========*\r?\n([\s\S]*?)\r?\n>>>>>>>\s*REPLACE/gi;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(diffText)) !== null) {
    blocks.push({
      search: match[1],
      replace: match[2],
    });
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
    // If search block is empty, treat as appending replacement to document
    if (!block.search.trim()) {
      content = content.trim() ? `${content}\n\n${block.replace}` : block.replace;
      appliedCount++;
      continue;
    }

    if (content.includes(block.search)) {
      content = content.replace(block.search, block.replace);
      appliedCount++;
    } else {
      // Fuzzy line matching if whitespace or formatting slightly differs
      const trimmedSearch = block.search.trim();
      if (content.includes(trimmedSearch)) {
        content = content.replace(trimmedSearch, block.replace.trim());
        appliedCount++;
        continue;
      }

      const lines = content.split("\n");
      const searchLines = trimmedSearch.split("\n");

      let foundIndex = -1;
      for (let i = 0; i <= lines.length - searchLines.length; i++) {
        let match = true;
        for (let j = 0; j < searchLines.length; j++) {
          if (lines[i + j].trim() !== searchLines[j].trim()) {
            match = false;
            break;
          }
        }
        if (match) {
          foundIndex = i;
          break;
        }
      }

      if (foundIndex !== -1) {
        const replaceLines = block.replace.split("\n");
        lines.splice(foundIndex, searchLines.length, ...replaceLines);
        content = lines.join("\n");
        appliedCount++;
      }
    }
  }

  return { updatedContent: content, appliedCount };
}

export function applyBlockDiff(original: string, search: string, replace: string): string {
  const { updatedContent } = applyDiffBlocks(original, [{ search, replace }]);
  return updatedContent;
}
