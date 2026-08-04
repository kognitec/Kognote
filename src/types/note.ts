export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  modified_at?: number;
  created_at?: number;
  children?: FileEntry[];
}

export interface ScannedTask {
  id: string;
  notePath: string;
  noteName: string;
  content: string;
  completed: boolean;
  lineNumber: number;
  dueDate?: string; // YYYY-MM-DD
  dueTime?: string; // HH:MM
  rawDueDate?: string; // Original raw ISO UTC string if present
  tags: string[];
  priority: "high" | "medium" | "low" | "none";
}

export interface ScannedDateReference {
  id: string;
  notePath: string;
  noteName: string;
  date: string; // YYYY-MM-DD
  context: string;
}

export interface BoardCard {
  file: FileEntry;
  title: string;
  snippet: string;
  tags: string[];
  status: "Backlog" | "Todo" | "In Progress" | "In Review" | "Done";
  todoTasks: number;
  completedTasks: number;
  wordCount: number;
  dueDate?: string;
  type?: string;
  storage?: "active" | "archived" | "deleted";
  bookmarked?: boolean;
  priority: "high" | "medium" | "low" | "none";
}

import { KognoteFrontmatter } from "../lib/frontmatter";

export interface NoteCachedData {
  path: string;
  modifiedAt: number;
  content?: string; // Optional on-demand loaded text content
  tags: string[]; // manual + inline tags
  links: string[]; // wikilinks
  urls: string[]; // extracted external urls
  tasks: ScannedTask[]; // checklist items
  dateRefs: ScannedDateReference[]; // date references
  boardCard: BoardCard | null; // kanban board card if #board is present
  meta?: KognoteFrontmatter;
}
