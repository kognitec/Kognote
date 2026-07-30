/**
 * Utility functions for strict, accurate hashtag extraction.
 * Guarantees that only valid note/task hashtags are parsed,
 * excluding code blocks, CSS hex colors (#1f2335, #ffffff), URL fragments, 
 * Markdown headers (# Heading), pure numbers (#123), and punctuation.
 */

/**
 * Strips fenced code blocks (```...```) and inline code spans (`...`) from text.
 */
export function stripCodeBlocks(text: string): string {
  if (!text) return "";
  let clean = text.replace(/```[\s\S]*?```/g, "").replace(/~~~[\s\S]*?~~~/g, "");
  clean = clean.replace(/`[^`\n]+`/g, "");
  return clean;
}

/**
 * Validates whether a candidate hashtag token is a legitimate user tag.
 */
export function isValidTagToken(candidate: string): boolean {
  if (!candidate) return false;
  const clean = candidate.trim().toLowerCase();

  // Minimum length 2
  if (clean.length < 2) return false;

  // Must NOT start with a digit (e.g. #123, #2026, #1st)
  if (/^\d/.test(clean)) return false;

  // Must contain at least one letter a-z
  if (!/[a-z]/.test(clean)) return false;

  // Reject 3-digit, 6-digit, or 8-digit CSS hex color codes (e.g. #fff, #ffffff, #1f2335, #000000, #ffffff80)
  if (/^[0-9a-fA-F]{3}$/.test(clean) || /^[0-9a-fA-F]{6}$/.test(clean) || /^[0-9a-fA-F]{8}$/.test(clean)) {
    return false;
  }

  // Reject URL protocols and reserved keywords
  if (["http", "https", "true", "false", "null", "undefined", "none", "flashcard", "due"].includes(clean)) {
    return false;
  }

  return true;
}

/**
 * Extracts all valid hashtags from note or task text.
 * Ignores code blocks, URL anchors, Markdown headers, hex colors, and trailing punctuation.
 */
export function extractValidHashtags(text: string): string[] {
  if (!text) return [];

  // Strip YAML frontmatter if present
  let body = text;
  if (body.startsWith("---")) {
    const endFm = body.indexOf("---", 3);
    if (endFm !== -1) {
      body = body.substring(endFm + 3);
    }
  }

  // Strip code blocks
  body = stripCodeBlocks(body);

  // Match hashtags preceded by start-of-line, space, or backslash, starting with # and a letter
  const tagRegex = /(?:^|\s|\\)#([a-zA-Z][a-zA-Z0-9_\-\/]*)/g;
  const tagSet = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(body)) !== null) {
    let rawTag = match[1].replace(/[.,;:!?)\\]+$/, "");
    const clean = rawTag.toLowerCase();
    if (isValidTagToken(clean)) {
      tagSet.add(clean);
    }
  }

  return Array.from(tagSet);
}
