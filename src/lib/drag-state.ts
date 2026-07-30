/**
 * Universal in-memory drag state manager for Kognote.
 *
 * WebView2 on Windows strips custom MIME types (e.g. application/kognote-file)
 * and restricts dataTransfer reading during dragOver events. Keeping in-flight
 * drag payloads in memory ensures 100% drag-and-drop parity across Windows, macOS, and Linux.
 */

export type DragType = "file" | "tab" | "card" | "filter";

export interface DragPayload {
  type: DragType;
  payload: any;
}

let activeDragPayload: DragPayload | null = null;

export const setDragState = <T>(type: DragType, payload: T) => {
  activeDragPayload = { type, payload };
};

export const getDragState = <T = any>(type?: DragType): T | null => {
  if (!activeDragPayload) return null;
  if (type && activeDragPayload.type !== type) return null;
  return activeDragPayload.payload as T;
};

export const clearDragState = () => {
  activeDragPayload = null;
};
