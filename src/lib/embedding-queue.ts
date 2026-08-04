import { searchEngine } from "./search-engine";

export interface TextChunkItem {
  filePath: string;
  chunkText: string;
  modifiedAt: number;
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
    this.activeNoteQueue.unshift(...chunks);
    this.processQueue();
  }

  /** Priority 2 & 3: Enqueue background vault chunks for idle processing */
  public enqueueBackground(chunks: TextChunkItem[]) {
    for (const chunk of chunks) {
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
        if (item && item.chunkText.trim()) {
          await searchEngine.indexFileChunk(item.filePath, item.chunkText).catch(console.warn);
        }
        await new Promise((res) => setTimeout(res, 2));
      }

      // Process background queue in small idle batches of 5 items
      let batchCount = 0;
      const BATCH_SIZE = 5;

      while (this.backgroundQueue.length > 0 && batchCount < BATCH_SIZE) {
        const item = this.backgroundQueue.shift()!;
        const key = `${item.filePath}:${item.chunkText.slice(0, 50)}`;
        this.queuedSet.delete(key);

        if (item && item.chunkText.trim()) {
          await searchEngine.indexFileChunk(item.filePath, item.chunkText).catch(console.warn);
        }
        batchCount++;
        await new Promise((res) => setTimeout(res, 10));
      }
    } finally {
      this.isProcessing = false;
      // If items remain in background queue, schedule next idle batch
      if (this.backgroundQueue.length > 0 || this.activeNoteQueue.length > 0) {
        setTimeout(() => this.scheduleIdleProcessing(), 300);
      }
    }
  }
}

export const embeddingQueue = new PriorityEmbeddingQueue();
