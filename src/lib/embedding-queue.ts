import { searchEngine } from "./search-engine";
import { invoke } from "@tauri-apps/api/core";

export interface TextChunkItem {
  filePath: string;
  chunkText: string;
  modifiedAt: number;
  retryCount?: number;
}

class PriorityEmbeddingQueue {
  private activeNoteQueue: TextChunkItem[] = [];
  private backgroundQueue: TextChunkItem[] = [];
  private isProcessing = false;
  private isPaused = false;
  private queuedSet = new Set<string>();

  /** Pause background processing (e.g. during active AI streaming) */
  public pause() {
    this.isPaused = true;
  }

  /** Resume background processing */
  public resume() {
    this.isPaused = false;
    this.scheduleIdleProcessing();
  }

  /** Priority 1: Enqueue active note chunks to embed immediately */
  public enqueueActiveNote(chunks: TextChunkItem[]) {
    for (const chunk of chunks) {
      const key = `${chunk.filePath}:${chunk.chunkText.slice(0, 50)}`;
      if (!this.queuedSet.has(key)) {
        this.queuedSet.add(key);
        this.activeNoteQueue.unshift(chunk);
      }
    }
    this.processQueue();
  }

  /** Priority 2 & 3: Enqueue background vault chunks for idle processing */
  public enqueueBackground(chunks: TextChunkItem[]) {
    // Cap background queue at 1000 items to avoid memory inflation on massive vault scans
    if (this.backgroundQueue.length >= 1000) return;

    for (const chunk of chunks) {
      if (this.backgroundQueue.length >= 1000) break;
      const key = `${chunk.filePath}:${chunk.chunkText.slice(0, 50)}`;
      if (!this.queuedSet.has(key)) {
        this.queuedSet.add(key);
        this.backgroundQueue.push(chunk);
      }
    }
    this.scheduleIdleProcessing();
  }

  private scheduleIdleProcessing() {
    if (this.isProcessing) return;

    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      (window as any).requestIdleCallback((deadline: any) => {
        if ((deadline.timeRemaining() > 10 || deadline.didTimeout) && (this.activeNoteQueue.length > 0 || this.backgroundQueue.length > 0)) {
          this.processQueue();
        }
      });
    } else {
      setTimeout(() => this.processQueue(), 300);
    }
  }

  private async processQueue() {
    if (this.isProcessing || this.isPaused) return;
    this.isProcessing = true;

    try {
      // Process active notes immediately
      while (this.activeNoteQueue.length > 0) {
        const item = this.activeNoteQueue.shift()!;
        const key = `${item.filePath}:${item.chunkText.slice(0, 50)}`;
        this.queuedSet.delete(key);

        if (item && item.chunkText.trim()) {
          await searchEngine.indexFileChunk(item.filePath, item.chunkText).catch(console.warn);
        }
        await new Promise((res) => setTimeout(res, 2));
      }

      // Process background queue in fast 16-chunk batches
      while (this.backgroundQueue.length > 0 && !this.isPaused) {
        const batch = this.backgroundQueue.splice(0, 16);
        const fileGroupMap = new Map<string, string[]>();

        for (const item of batch) {
          const key = `${item.filePath}:${item.chunkText.slice(0, 50)}`;
          this.queuedSet.delete(key);
          if (item && item.chunkText.trim()) {
            if (!fileGroupMap.has(item.filePath)) fileGroupMap.set(item.filePath, []);
            fileGroupMap.get(item.filePath)!.push(item.chunkText);
          }
        }

        for (const [filePath, chunkTexts] of fileGroupMap.entries()) {
          const formatted = chunkTexts.map((txt) => `search_document: ${txt}`);
          try {
            const vectors = await searchEngine.embedBatch(formatted);
            const upsertItems = chunkTexts.map((txt, idx) => ({
              file_path: filePath,
              chunk_text: txt,
              embedding: vectors[idx],
            }));
            await invoke("vector_upsert_batch", { chunks: upsertItems });
          } catch (e) {
            console.warn(`[Embedding Queue] Batch failed for ${filePath}, retrying if under limit...`, e);
            for (const item of batch) {
              const currentRetries = item.retryCount || 0;
              if (currentRetries < 2) {
                this.backgroundQueue.push({ ...item, retryCount: currentRetries + 1 });
              } else {
                console.error(`[Embedding Queue] Exceeded max retries for chunk in ${filePath}. Skipping chunk.`);
              }
            }
            await new Promise((res) => setTimeout(res, 2000));
          }
        }
        await new Promise((res) => setTimeout(res, 5));
      }
    } finally {
      this.isProcessing = false;
      if (this.backgroundQueue.length > 0 || this.activeNoteQueue.length > 0) {
        setTimeout(() => this.scheduleIdleProcessing(), 100);
      }
    }
  }

  /** Clear all pending queues when switching vaults */
  public clear() {
    this.activeNoteQueue = [];
    this.backgroundQueue = [];
    this.queuedSet.clear();
    this.isProcessing = false;
  }
}

export const embeddingQueue = new PriorityEmbeddingQueue();
