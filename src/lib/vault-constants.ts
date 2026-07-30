/**
 * vault-constants.ts
 *
 * Shared vault folder name constants. Kept in a separate module so that
 * VaultContext.tsx can satisfy Vite's Fast Refresh requirement (React
 * context files must not export non-component values alongside components).
 */

export const DAILY_NOTES_FOLDER = "Daily Notes";
export const ATTACHMENTS_FOLDER = "Attachments";
export const CANVAS_FOLDER = "Canvas";
export const CLIPPINGS_FOLDER = "Clippings";
export const ARCHIVED_FOLDER = "Archived";
export const DELETED_FOLDER = "Trash";
export const TEMPLATES_FOLDER = "Templates";

export const PROTECTED_FOLDERS = [
  DAILY_NOTES_FOLDER,
  ATTACHMENTS_FOLDER,
  ARCHIVED_FOLDER,
  DELETED_FOLDER,
  TEMPLATES_FOLDER,
];
