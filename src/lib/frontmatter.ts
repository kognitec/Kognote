/**
 * Universal YAML Frontmatter Engine for Kognote
 * Manages standardized note metadata fields, validation, and auto-syncing.
 */

export interface KognoteFrontmatter {
  type: "note" | "daily" | "template" | "clipping" | string;
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
  forceUpdateTimestamp?: boolean;
  status?: string;
  type?: string;
  priority?: string;
  due?: string;
  bookmarked?: string;
  storage?: string;
}

export function getCurrentIsoTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Formats stored ISO timestamp (UTC or local) into a human-readable display string
 * taking into account the user's configured target timezone setting.
 */
export function formatTimestampForDisplay(rawTimestamp?: string, targetTimezone: string = "auto"): string {
  if (!rawTimestamp || !rawTimestamp.trim()) {
    return "Not recorded";
  }

  let cleanRaw = rawTimestamp.trim().replace(/^["']|["']$/g, "");
  
  // Date-only string (YYYY-MM-DD): format as plain date without time or day-shifting
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleanRaw)) {
    const [y, m, d] = cleanRaw.split("-").map(Number);
    const dateObj = new Date(y, m - 1, d);
    return dateObj.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
  }

  const dateObj = new Date(cleanRaw);

  if (isNaN(dateObj.getTime())) {
    return cleanRaw;
  }

  const timeZoneOption = (!targetTimezone || targetTimezone === "auto") ? undefined : targetTimezone;

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      ...(timeZoneOption ? { timeZone: timeZoneOption } : {}),
    });
    return formatter.format(dateObj);
  } catch (err) {
    // Fallback if timezone is invalid or unsupported by browser runtime
    return dateObj.toLocaleString("en-US", { hour12: false });
  }
}

/**
 * Extracts target-timezone normalized dateStr (YYYY-MM-DD) and optional timeStr (HH:mm)
 * from any ISO UTC timestamp or date string based on the user's active timezone.
 */
export function getZonedDateParts(rawTimestamp?: string, targetTimezone: string = "auto"): { dateStr: string; timeStr?: string } {
  if (!rawTimestamp || !rawTimestamp.trim()) {
    return { dateStr: "" };
  }

  const cleanRaw = rawTimestamp.trim().replace(/^["']|["']$/g, "");

  // If date-only string like YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleanRaw)) {
    return { dateStr: cleanRaw };
  }

  const dateObj = new Date(cleanRaw);

  if (isNaN(dateObj.getTime())) {
    const dtMatch = cleanRaw.match(/^(20\d{2}[-/]\d{2}[-/]\d{2})(?:[T\s]+([01]\d|2[0-3]):([0-5]\d))?/);
    if (dtMatch) {
      const dateStr = dtMatch[1].replace(/\//g, "-");
      const timeStr = dtMatch[2] && dtMatch[3] ? `${dtMatch[2]}:${dtMatch[3]}` : undefined;
      return { dateStr, timeStr };
    }
    return { dateStr: "" };
  }

  const timeZoneOption = (!targetTimezone || targetTimezone === "auto") ? undefined : targetTimezone;

  try {
    const dtfDate = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZoneOption,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const partsDate = dtfDate.formatToParts(dateObj);
    let year = "", month = "", day = "";
    for (const p of partsDate) {
      if (p.type === "year") year = p.value;
      if (p.type === "month") month = p.value;
      if (p.type === "day") day = p.value;
    }

    const hasTime = cleanRaw.includes("T") || cleanRaw.includes(":") || cleanRaw.includes("Z");
    let timeStr: string | undefined = undefined;

    if (hasTime) {
      const dtfTime = new Intl.DateTimeFormat("en-US", {
        timeZone: timeZoneOption,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const partsTime = dtfTime.formatToParts(dateObj);
      let hour = "", minute = "";
      for (const p of partsTime) {
        if (p.type === "hour") hour = p.value.padStart(2, "0");
        if (p.type === "minute") minute = p.value.padStart(2, "0");
      }
      if (hour === "24") hour = "00";
      timeStr = `${hour}:${minute}`;
    }

    return {
      dateStr: `${year}-${month}-${day}`,
      timeStr,
    };
  } catch (err) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const day = String(dateObj.getDate()).padStart(2, "0");
    const hasTime = cleanRaw.includes("T") || cleanRaw.includes(":") || cleanRaw.includes("Z");
    const timeStr = hasTime ? `${String(dateObj.getHours()).padStart(2, "0")}:${String(dateObj.getMinutes()).padStart(2, "0")}` : undefined;
    return { dateStr: `${y}-${m}-${day}`, timeStr };
  }
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
      if (key && key !== "created_by" && key !== "created by" && key !== "updated_by" && key !== "updated by") {
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

  const mentionsLine = fields.mentions && fields.mentions.length > 0
    ? `\nmentions: [${fields.mentions.map((m) => `"${m.replace(/"/g, '\\"')}"`).join(", ")}]`
    : "";

  return `---
type: "${fields.type || "note"}"
status: ${fields.status || "none"}
priority: ${fields.priority || "none"}
due: "${fields.due || ""}"
created: "${fields.created}"
updated: "${fields.updated}"
storage: ${cleanStorage}
bookmarked: ${cleanBookmarked}${mentionsLine}
---`;
}

export function toNormalizedNativeIso(val?: string, fallbackToNow: boolean = false): string {
  if (!val || !val.trim()) {
    return fallbackToNow ? new Date().toISOString() : "";
  }
  const clean = val.trim().replace(/^["']|["']$/g, "");

  // If date-only format (e.g. 2026-08-15) and not forcing audit timestamp fallback, preserve as YYYY-MM-DD
  if (!fallbackToNow && /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(clean)) {
    return clean.replace(/\//g, "-");
  }

  const d = new Date(clean);
  if (!isNaN(d.getTime())) {
    return d.toISOString();
  }
  return fallbackToNow ? new Date().toISOString() : clean;
}

export function ensureAndSyncFrontmatter(
  fullContent: string,
  options: SyncOptions
): { fullContent: string; frontmatter: KognoteFrontmatter; bodyContent: string } {
  const parsed = parseFrontmatter(fullContent);
  const nowIso = getCurrentIsoTimestamp();

  const type = options.type !== undefined ? options.type : (parsed.fields.type || "note");
  const status = options.status !== undefined ? options.status : (parsed.fields.status || "none");
  const priority = options.priority !== undefined ? options.priority : (parsed.fields.priority || "none");
  
  const rawDue = options.due !== undefined ? options.due : (parsed.fields.due || "");
  const due = toNormalizedNativeIso(rawDue, false);
  
  const created = toNormalizedNativeIso(parsed.fields.created, true);
  const updated = options.forceUpdateTimestamp ? nowIso : toNormalizedNativeIso(parsed.fields.updated, true);
  
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
