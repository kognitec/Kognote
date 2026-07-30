/**
 * Universal YAML Frontmatter Engine for Kognote
 * Manages standardized note metadata fields, validation, and auto-syncing.
 */

export interface KognoteFrontmatter {
  type: "note" | "daily" | "template" | "clipping" | string;
  created_by: "user" | "ai";
  updated_by: "user" | "ai";
  status: "none" | "todo" | "in-progress" | "in-review" | "done" | "backlog" | string;
  priority: "high" | "medium" | "low" | "none" | string;
  due: string;
  created: string;
  updated: string;
  storage: "active" | "archived" | "deleted" | string;
  bookmarked: "yes" | "no";
  mentions: string[];
}

export interface ParsedFrontmatter {
  hasFrontmatter: boolean;
  frontmatterRaw: string;
  fields: Partial<KognoteFrontmatter>;
  rawFields: Record<string, string>;
  bodyContent: string;
}

export interface SyncOptions {
  noteName?: string;
  backlinks?: string[];
  updater?: "user" | "ai";
  creator?: "user" | "ai";
  forceUpdateTimestamp?: boolean;
  status?: string;
  type?: string;
  priority?: string;
  due?: string;
  bookmarked?: string;
  storage?: string;
}

export function getCurrentIsoTimestamp(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`;
}

export function parseFrontmatter(fullContent: string): ParsedFrontmatter {
  if (!fullContent) {
    return {
      hasFrontmatter: false,
      frontmatterRaw: "",
      fields: {},
      rawFields: {},
      bodyContent: "",
    };
  }

  const match = fullContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return {
      hasFrontmatter: false,
      frontmatterRaw: "",
      fields: {},
      rawFields: {},
      bodyContent: fullContent,
    };
  }

  const frontmatterRaw = match[0];
  const yamlText = match[1].trim();
  const bodyContent = fullContent.slice(frontmatterRaw.length);

  const rawFields: Record<string, string> = {};
  const lines = yamlText.split(/\r?\n/);
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx !== -1) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      if (key) {
        rawFields[key] = val;
      }
    }
  }

  // Parse mentions array if formatted as [Note A, Note B]
  let mentions: string[] = [];
  if (rawFields.mentions) {
    const mStr = rawFields.mentions.replace(/^\[|\]$/g, "");
    if (mStr.trim()) {
      mentions = mStr.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    }
  }

  const rawType = rawFields.type ? rawFields.type.replace(/^["']|["']$/g, "").toLowerCase() : "note";
  const type = ["note", "daily", "template", "clipping"].includes(rawType) ? rawType : "note";

  const rawStatus = rawFields.status ? rawFields.status.replace(/^["']|["']$/g, "").toLowerCase() : "none";
  const status = ["none", "todo", "in-progress", "in-review", "done", "backlog"].includes(rawStatus) ? rawStatus : "none";

  const rawStorage = rawFields.storage ? rawFields.storage.replace(/^["']|["']$/g, "").toLowerCase() : "active";
  let storage = rawStorage === "bookmarked" ? "active" : rawStorage;

  const rawBookmarked = rawFields.bookmarked ? rawFields.bookmarked.replace(/^["']|["']$/g, "").toLowerCase() : "no";
  let bookmarked: "yes" | "no" = rawBookmarked === "yes" || rawBookmarked === "true" || rawStorage === "bookmarked" ? "yes" : "no";

  // Mutual exclusivity: Archived or deleted notes CANNOT be bookmarked
  if (storage === "archived" || storage === "deleted") {
    bookmarked = "no";
  }

  const fields: Partial<KognoteFrontmatter> = {
    type,
    created_by: rawFields["created by"] === "ai" || rawFields.created_by === "ai" ? "ai" : "user",
    updated_by: rawFields["updated by"] === "ai" || rawFields.updated_by === "ai" ? "ai" : "user",
    status,
    priority: rawFields.priority ? rawFields.priority.replace(/^["']|["']$/g, "").toLowerCase() : "none",
    due: rawFields.due ? rawFields.due.replace(/^["']|["']$/g, "") : "",
    created: rawFields.created ? rawFields.created.replace(/^["']|["']$/g, "") : "",
    updated: rawFields.updated ? rawFields.updated.replace(/^["']|["']$/g, "") : "",
    storage,
    bookmarked,
    mentions,
  };

  return {
    hasFrontmatter: true,
    frontmatterRaw,
    fields,
    rawFields,
    bodyContent,
  };
}

export function stringifyFrontmatter(fields: KognoteFrontmatter): string {
  let cleanStorage = fields.storage === "bookmarked" ? "active" : fields.storage || "active";
  let cleanBookmarked = fields.bookmarked || "no";

  if (cleanStorage === "archived" || cleanStorage === "deleted") {
    cleanBookmarked = "no";
  }

  return `---
type: "${fields.type || "note"}"
created by: ${fields.created_by || "user"}
updated by: ${fields.updated_by || "user"}
status: ${fields.status || "none"}
priority: ${fields.priority || "none"}
due: "${fields.due || ""}"
created: "${fields.created}"
updated: "${fields.updated}"
storage: ${cleanStorage}
bookmarked: ${cleanBookmarked}
---`;
}

export function ensureAndSyncFrontmatter(
  fullContent: string,
  options: SyncOptions
): { fullContent: string; frontmatter: KognoteFrontmatter; bodyContent: string } {
  const parsed = parseFrontmatter(fullContent);
  const nowIso = getCurrentIsoTimestamp();

  const type = options.type !== undefined ? options.type : (parsed.fields.type || "note");
  const created_by = parsed.fields.created_by || options.creator || "user";
  const updated_by = options.updater || parsed.fields.updated_by || "user";
  const status = options.status !== undefined ? options.status : (parsed.fields.status || "none");
  const priority = options.priority !== undefined ? options.priority : (parsed.fields.priority || "none");
  const due = options.due !== undefined ? options.due : (parsed.fields.due || "");
  const created = parsed.fields.created || nowIso;
  const updated = options.forceUpdateTimestamp ? nowIso : (parsed.fields.updated || nowIso);
  
  let storage = options.storage !== undefined ? options.storage : (parsed.fields.storage || "active");
  if (storage === "bookmarked") storage = "active";

  const rawBm = options.bookmarked !== undefined ? options.bookmarked : (parsed.fields.bookmarked || "no");
  let bookmarked: "yes" | "no" = rawBm === "yes" || rawBm === "true" ? "yes" : "no";

  // Mutual exclusivity rules
  if (bookmarked === "yes" && (storage === "archived" || storage === "deleted")) {
    storage = "active";
  } else if (storage === "archived" || storage === "deleted") {
    bookmarked = "no";
  }
  const mentions = options.backlinks !== undefined ? options.backlinks : (parsed.fields.mentions || []);

  const frontmatter: KognoteFrontmatter = {
    type,
    created_by,
    updated_by,
    status,
    priority,
    due,
    created,
    updated,
    storage,
    bookmarked,
    mentions,
  };

  const frontmatterHeader = stringifyFrontmatter(frontmatter);
  const bodyContent = parsed.bodyContent.replace(/^\r?\n+/, "");
  const syncFullContent = `${frontmatterHeader}\n\n${bodyContent}`;

  return {
    fullContent: syncFullContent,
    frontmatter,
    bodyContent,
  };
}
