import { 
  FileText, 
  Calendar, 
  LayoutTemplate, 
  Scissors, 
  Archive, 
  Network, 
  Image as ImageIcon, 
  Music, 
  Film, 
  FileType, 
  Folder, 
  FolderOpen, 
  Trash2,
  Paperclip
} from "lucide-react";
import { FileEntry, NoteCachedData } from "../types/note";

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif'];
const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'ogg', 'aac', 'flac'];
const VIDEO_EXTS = ['mp4', 'mov', 'webm', 'mkv', 'avi'];

export interface FileIconOptions {
  className?: string;
  isOpenFolder?: boolean;
}

export function getFileIcon(
  file?: FileEntry | null,
  noteCache?: Record<string, NoteCachedData>,
  options?: FileIconOptions
) {
  const sizeClass = options?.className || "h-3.5 w-3.5 shrink-0";
  if (!file) return <FileText className={`${sizeClass} text-[#d946ef]/80`} />;

  const pathLower = (file.path || "").replace(/\\/g, "/").toLowerCase();
  const fileName = file.name || "";
  const ext = fileName.toLowerCase().split('.').pop() || '';

  // Check if file is in trash or marked as deleted in frontmatter
  const isDeleted = pathLower.includes("/trash/") || 
    (noteCache && file.path && noteCache[file.path]?.meta?.storage === "deleted");

  // Handle Folders
  if (file.is_dir) {
    if (pathLower.endsWith("/templates")) {
      return <LayoutTemplate className={`${sizeClass} ${isDeleted ? "text-rose-400" : "text-purple-400"}`} />;
    }
    if (pathLower.endsWith("/trash")) {
      return <Trash2 className={`${sizeClass} text-rose-400`} />;
    }
    if (pathLower.endsWith("/archived")) {
      return <Archive className={`${sizeClass} ${isDeleted ? "text-rose-400" : "text-sky-400"}`} />;
    }
    if (pathLower.endsWith("/daily notes")) {
      return <Calendar className={`${sizeClass} ${isDeleted ? "text-rose-400" : "text-indigo-400"}`} />;
    }
    if (pathLower.endsWith("/attachments") || pathLower.endsWith("/web clippings")) {
      return <Paperclip className={`${sizeClass} ${isDeleted ? "text-rose-400" : "text-emerald-400"}`} />;
    }
    if (options?.isOpenFolder) {
      return <FolderOpen className={`${sizeClass} ${isDeleted ? "text-rose-400" : "text-amber-400 dark:text-amber-300"}`} />;
    }
    return <Folder className={`${sizeClass} ${isDeleted ? "text-rose-400" : "text-amber-500/80 dark:text-amber-400/80"}`} />;
  }

  // Get note metadata if available
  const cachedData = noteCache && file.path ? (
    noteCache[file.path] || 
    Object.values(noteCache).find(c => c && c.path && (c.path === file.path || c.path.replace(/\\/g, "/").toLowerCase() === pathLower))
  ) : undefined;
  const cachedMeta = cachedData?.meta;

  const isBookmarked = cachedMeta?.bookmarked?.toLowerCase() === "yes" || cachedMeta?.storage?.toLowerCase() === "bookmarked";
  const isDailyNote = pathLower.includes("/daily notes/") || cachedMeta?.type?.toLowerCase() === "daily" || /^\d{4}-\d{2}-\d{2}\.md$/i.test(fileName);
  const isTemplateNote = pathLower.includes("/templates/") || cachedMeta?.type?.toLowerCase() === "template";
  const isClippingNote = pathLower.includes("/clippings/") || pathLower.includes("/web clippings/") || cachedMeta?.type?.toLowerCase() === "clipping";
  const isArchivedNote = pathLower.includes("/archived/") || cachedMeta?.storage === "archived";

  const getColor = (defaultColor: string) => {
    if (isDeleted) return "text-rose-400";
    if (isArchivedNote) return "text-sky-400 dark:text-sky-300";
    if (isBookmarked) return "text-amber-400 dark:text-amber-300";
    return defaultColor;
  };

  // Handle Files / Attachments / Canvas
  if (fileName.endsWith('.excalidraw')) {
    return <Network className={`${sizeClass} ${getColor("text-purple-400")}`} />;
  }
  if (isDailyNote) {
    return <Calendar className={`${sizeClass} ${getColor("text-indigo-400")}`} />;
  }
  if (isTemplateNote) {
    return <LayoutTemplate className={`${sizeClass} ${getColor("text-purple-400")}`} />;
  }
  if (isClippingNote) {
    return <Scissors className={`${sizeClass} ${getColor("text-cyan-400")}`} />;
  }
  if (IMAGE_EXTS.includes(ext)) {
    return <ImageIcon className={`${sizeClass} ${getColor("text-emerald-400/70")}`} />;
  }
  if (AUDIO_EXTS.includes(ext)) {
    return <Music className={`${sizeClass} ${getColor("text-violet-400/70")}`} />;
  }
  if (VIDEO_EXTS.includes(ext)) {
    return <Film className={`${sizeClass} ${getColor("text-amber-400/70")}`} />;
  }
  if (ext === 'pdf') {
    return <FileType className={`${sizeClass} ${getColor("text-rose-400/70")}`} />;
  }

  // Default Markdown / text note icon
  return <FileText className={`${sizeClass} ${getColor("text-[#d946ef]/80")}`} />;
}
