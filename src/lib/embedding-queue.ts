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

  /** Priority 1: Enqueue active note chunks to embed immediately */
  public enqueueActiveNote(chunks: TextChunkItem[]) {
    this.activeNoteQueue.unshift(...chunks);
    this.processQueue();
  }

  /** Priority 2 & 3: Enqueue background vault chunks for idle processing */
  public enqueueBackground(chunks: TextChunkItem[]) {
    this.backgroundQueue.push(...chunks);
    this.scheduleIdleProcessing();
  }

  private scheduleIdleProcessing() {
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      (window as any).requestIdleCallback((deadline: any) => {
        if (deadline.timeRemaining() > 10 && this.backgroundQueue.length > 0) {
          this.processQueue();
        }
      });
    } else {
      setTimeout(() => this.processQueue(), 200);
    }
  }

  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.activeNoteQueue.length > 0 || this.backgroundQueue.length > 0) {
        // High priority first
        const item = this.activeNoteQueue.length > 0 
          ? this.activeNoteQueue.shift()! 
          : this.backgroundQueue.shift()!;

        if (item && item.chunkText.trim()) {
          await searchEngine.indexFileChunk(item.filePath, item.chunkText).catch(console.warn);
        }

        // Allow micro-yield to keep UI 60 FPS responsive
        await new Promise((res) => setTimeout(res, 2));
      }
    } finally {
      this.isProcessing = false;
    }
  }
}

export const embeddingQueue = new PriorityEmbeddingQueue();
