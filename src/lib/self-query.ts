export interface SelfQueryFilter {
  tags?: string[];
  status?: string;
  dateAfter?: number; // Unix timestamp in ms
  dateBefore?: number; // Unix timestamp in ms
  noteType?: string;
  cleanQuery: string;
}

const TAG_REGEX = /#([a-zA-Z0-9_\-\/]+)/g;
const STATUS_PATTERNS: Record<string, RegExp> = {
  "in-progress": /\b(in[- ]progress|working on|active)\b/i,
  "todo": /\b(todo|to-do|backlog|pending)\b/i,
  "done": /\b(done|completed|finished)\b/i,
  "in-review": /\b(in[- ]review|under review)\b/i,
};

const RECENCY_PATTERNS = [
  { regex: /\b(today|last 24 hours)\b/i, durationMs: 24 * 60 * 60 * 1000 },
  { regex: /\b(this week|last 7 days)\b/i, durationMs: 7 * 24 * 60 * 60 * 1000 },
  { regex: /\b(this month|last 30 days|last month)\b/i, durationMs: 30 * 24 * 60 * 60 * 1000 },
  { regex: /\b(this year|last year)\b/i, durationMs: 365 * 24 * 60 * 60 * 1000 },
];

/**
 * 0ms Self-Query Pre-Filter Extractor for Kognote.
 * Parses tags (#tag), note statuses, and temporal directives (e.g. "edited this week")
 * from the user prompt to apply SQL WHERE filters before vector similarity scoring.
 */
export function extractSelfQueryFilter(prompt: string): SelfQueryFilter {
  let cleanQuery = prompt;

  // 1. Extract Tags (#work, #project-x)
  const tags: string[] = [];
  let tagMatch: RegExpExecArray | null;
  while ((tagMatch = TAG_REGEX.exec(prompt)) !== null) {
    tags.push(tagMatch[1].toLowerCase());
  }

  // Strip extracted #tags from query to avoid cluttering semantic vector search
  cleanQuery = cleanQuery.replace(TAG_REGEX, "").trim();

  // 2. Extract Status Filters
  let status: string | undefined = undefined;
  for (const [st, regex] of Object.entries(STATUS_PATTERNS)) {
    if (regex.test(prompt)) {
      status = st;
      break;
    }
  }

  // 3. Extract Date / Recency Directives
  let dateAfter: number | undefined = undefined;
  const now = Date.now();

  for (const item of RECENCY_PATTERNS) {
    if (item.regex.test(prompt)) {
      dateAfter = now - item.durationMs;
      break;
    }
  }

  // Explicit ISO Date matching (e.g., "after 2026-07-01")
  const isoAfterMatch = prompt.match(/\b(after|since)\s+(\d{4}-\d{2}-\d{2})\b/i);
  if (isoAfterMatch) {
    const parsedDate = Date.parse(isoAfterMatch[2]);
    if (!isNaN(parsedDate)) {
      dateAfter = parsedDate;
    }
  }

  return {
    tags: tags.length > 0 ? tags : undefined,
    status,
    dateAfter,
    cleanQuery: cleanQuery || prompt,
  };
}
