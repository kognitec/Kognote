/**
 * Date Parser Utility for Kognote
 * Exclusively powered by chrono-node for natural language date and time parsing.
 */

import * as chrono from "chrono-node";

export interface DateSuggestion {
  label: string;
  sublabel: string;
  value: string;
  isDueDate: boolean;
}

export function formatDateISO(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatTime12(timeStr?: string): string {
  if (!timeStr) return "";
  const parts = timeStr.split(":");
  if (parts.length < 2) return "";
  let h = parseInt(parts[0], 10);
  const m = parts[1];
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return ` at ${String(h).padStart(2, "0")}:${m} ${ampm}`;
}

export function parseNaturalDateWithChrono(input: string): { dateStr: string; timeStr?: string; isDueDate: boolean; parsedText?: string } | null {
  if (!input) return null;
  let raw = input.trim();

  let isDueDate = false;
  if (/^due:?\s*/i.test(raw)) {
    isDueDate = true;
    raw = raw.replace(/^due:?\s*/i, "").trim();
  }

  const now = new Date();
  if (!raw) {
    return { dateStr: formatDateISO(now), isDueDate };
  }

  try {
    const results = chrono.parse(raw, now, { forwardDate: true });
    if (results && results.length > 0) {
      const res = results[0];
      const parsedDate = res.start.date();
      const dateStr = formatDateISO(parsedDate);

      let timeStr: string | undefined = undefined;
      if (res.start.isCertain("hour") || res.start.isCertain("minute")) {
        const h = String(parsedDate.getHours()).padStart(2, "0");
        const m = String(parsedDate.getMinutes()).padStart(2, "0");
        timeStr = `${h}:${m}`;
      }

      return {
        dateStr,
        timeStr,
        isDueDate,
        parsedText: res.text,
      };
    }
  } catch (err) {
    console.warn("Chrono parsing error:", err);
  }

  return null;
}

export function parseNaturalDate(input: string): { dateStr: string; timeStr?: string; isDueDate: boolean } | null {
  const chronoRes = parseNaturalDateWithChrono(input);
  if (chronoRes) {
    return { dateStr: chronoRes.dateStr, timeStr: chronoRes.timeStr, isDueDate: chronoRes.isDueDate };
  }
  return null;
}

export function getDateSuggestions(query: string): DateSuggestion[] {
  const q = query.trim();

  // Exclusively use chrono-node to parse date & time from input
  const chronoParsed = parseNaturalDateWithChrono(q || "today");
  if (!chronoParsed) return [];

  const prefix = chronoParsed.isDueDate ? "@due:" : "@";
  const valWithTime = chronoParsed.timeStr ? `${chronoParsed.dateStr} ${chronoParsed.timeStr}` : chronoParsed.dateStr;
  const timeFormatted = formatTime12(chronoParsed.timeStr);
  const dateTitle = chronoParsed.isDueDate
    ? `Due ${chronoParsed.dateStr}${timeFormatted}`
    : `${chronoParsed.dateStr}${timeFormatted}`;

  const labelText = chronoParsed.parsedText && q && chronoParsed.parsedText.length < q.length
    ? `✨ ${dateTitle} (from "${chronoParsed.parsedText}")`
    : `✨ ${dateTitle}`;

  return [
    {
      label: labelText,
      sublabel: chronoParsed.isDueDate ? `due: ${valWithTime}` : valWithTime,
      value: `${prefix}${valWithTime}`,
      isDueDate: chronoParsed.isDueDate,
    }
  ];
}

/**
 * Determines whether a date query after `@` or `@due:` represents an already
 * completed date/time token or text following a completed date.
 *
 * Used by autocomplete scanners in WysiwygEditor and SourceViewer to suppress
 * suggestions once a date has been generated/accepted or when typing past a date token.
 */
export function isDateQueryCompleted(query: string): boolean {
  if (!query) return false;
  const q = query.trim();

  // Priority tokens like !, !!, !!! or legacy @task
  if (/^(?:task(!*)|!{1,3})\s*$/i.test(q)) {
    return true;
  }

  // Exact ISO date (with optional time):
  // e.g. "2026-07-28", "2026-07-28 19:00", "due:2026-07-28", "due:2026-07-28 19:00", "2026-07-28 at 07:00 PM"
  const isoDateExact = /^(?:due:)?20\d{2}[-/]\d{2}[-/]\d{2}(?:\s+(?:at\s+)?\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?)?\s*$/i;
  if (isoDateExact.test(q)) {
    return true;
  }

  // Query starts with a completed ISO date followed by space or text
  // e.g. "2026-07-28 19:00   and then we allow" or "2026-07-28 and then"
  const isoDateStart = /^(?:due:)?20\d{2}[-/]\d{2}[-/]\d{2}(?:\s+(?:at\s+)?\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?)?(\s+[\s\S]*)?$/i;
  const match = query.match(isoDateStart);
  if (match && match[1] !== undefined && match[1].length > 0) {
    return true;
  }

  return false;
}
