import { invoke } from "@tauri-apps/api/core";
import { extractSelfQueryFilter, SelfQueryFilter } from "./self-query";

export interface SearchResult {
  filePath: string;
  chunkText: string;
  similarity: number;
  updatedAt?: number;
}

export interface DbNoteMetadata {
  file_path: string;
  tags: string;
  links: string;
  storage: string;
  updated_at: number;
}

class EmbeddingWorkerClient {
  private worker: Worker | null = null;
  private pendingResolves = new Map<string, (val: any) => void>();
  private pendingRejects = new Map<string, (err: Error) => void>();
  private pendingTimeouts = new Map<string, any>();

  constructor() {
    this.initWorker();
  }

  private initWorker() {
    if (typeof window === "undefined") return;

    if (this.worker) {
      try {
        this.worker.terminate();
      } catch {}
    }

    this.worker = new Worker(
      new URL("../workers/embedding-worker.ts", import.meta.url),
      { type: "module" }
    );

    this.worker.onerror = (err) => {
      console.error("[EmbeddingWorkerClient] Worker crash detected:", err);
      this.rejectAllPending("Embedding worker crashed");
      setTimeout(() => this.initWorker(), 1000);
    };

    this.worker.onmessage = (e) => {
      const { id, vector, vectors, error, type, file, progress } = e.data;
      if (type === "progress") {
        window.dispatchEvent(new CustomEvent("embedding-progress", { detail: { file, progress } }));
        return;
      }
      if (type === "ready") {
        window.dispatchEvent(new CustomEvent("embedding-ready"));
        return;
      }
      if (type === "error") {
        window.dispatchEvent(new CustomEvent("embedding-error", { detail: { error: e.data.error } }));
        return;
      }

      if (!id) return;

      const resolve = this.pendingResolves.get(id);
      const reject = this.pendingRejects.get(id);
      const timer = this.pendingTimeouts.get(id);

      if (timer) {
        clearTimeout(timer);
        this.pendingTimeouts.delete(id);
      }

      this.pendingResolves.delete(id);
      this.pendingRejects.delete(id);

      if (error) {
        if (reject) reject(new Error(error));
      } else if (vectors) {
        if (resolve) resolve(vectors);
      } else if (vector || e.data.success) {
        if (resolve) resolve(vector || e.data.success);
      }
    };
  }

  private rejectAllPending(reason: string) {
    for (const [id, reject] of this.pendingRejects.entries()) {
      reject(new Error(reason));
      const timer = this.pendingTimeouts.get(id);
      if (timer) clearTimeout(timer);
    }
    this.pendingResolves.clear();
    this.pendingRejects.clear();
    this.pendingTimeouts.clear();
  }

  embed(text: string): Promise<number[]> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Worker not initialized"));
        return;
      }
      const id = Math.random().toString(36).substring(7);
      this.pendingResolves.set(id, resolve);
      this.pendingRejects.set(id, reject);

      const timer = setTimeout(() => {
        if (this.pendingRejects.has(id)) {
          this.pendingRejects.get(id)?.(new Error("Embedding request timed out after 60s"));
          this.pendingResolves.delete(id);
          this.pendingRejects.delete(id);
          this.pendingTimeouts.delete(id);
        }
      }, 60000);
      this.pendingTimeouts.set(id, timer);

      this.worker.postMessage({ text, id, priority: "high" });
    });
  }

  embedBatch(texts: string[]): Promise<number[][]> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Worker not initialized"));
        return;
      }
      if (texts.length === 0) {
        resolve([]);
        return;
      }
      const id = Math.random().toString(36).substring(7);
      this.pendingResolves.set(id, resolve);
      this.pendingRejects.set(id, reject);

      const timer = setTimeout(() => {
        if (this.pendingRejects.has(id)) {
          this.pendingRejects.get(id)?.(new Error("Batch embedding request timed out after 120s"));
          this.pendingResolves.delete(id);
          this.pendingRejects.delete(id);
          this.pendingTimeouts.delete(id);
        }
      }, 120000);
      this.pendingTimeouts.set(id, timer);

      this.worker.postMessage({ texts, id });
    });
  }

  purgeCache(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Worker not initialized"));
        return;
      }
      const id = Math.random().toString(36).substring(7);
      this.pendingResolves.set(id, () => resolve(true));
      this.pendingRejects.set(id, reject);
      this.worker.postMessage({ command: "purge-cache", id });
    });
  }

  redownloadModel(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error("Worker not initialized"));
        return;
      }
      const id = Math.random().toString(36).substring(7);
      this.pendingResolves.set(id, () => resolve(true));
      this.pendingRejects.set(id, reject);
      this.worker.postMessage({ command: "redownload", id });
    });
  }

  async testEmbeddingModel(): Promise<{ latencyMs: number; dimensions: number }> {
    const start = performance.now();
    const vec = await this.embed("search_query: Testing local vector embedding model performance and dimensionality");
    const latencyMs = Math.round(performance.now() - start);
    return { latencyMs, dimensions: vec.length };
  }

  async isModelCached(): Promise<boolean> {
    if (typeof caches === "undefined") return false;
    try {
      const keys = await caches.keys();
      for (const key of keys) {
        if (key.includes("transformers") || key.includes("huggingface") || key.includes("onnx") || key.includes("nomic")) {
          const cache = await caches.open(key);
          const requests = await cache.keys();
          if (requests.some((req) => req.url.includes("onnx") || req.url.includes("nomic"))) {
            return true;
          }
        }
      }
    } catch (e) {
      console.warn("Failed to check CacheStorage:", e);
    }
    return false;
  }
}

export const embeddingClient = new EmbeddingWorkerClient();

export class SearchEngine {
  embedBatch(texts: string[]): Promise<number[][]> {
    return embeddingClient.embedBatch(texts);
  }

  async init() {
    try {
      await invoke("init_vector_db");
    } catch (err) {
      console.error("Failed to initialize vector database:", err);
    }
  }

  async saveNoteMetadata(filePath: string, tags: string[], links: string[], storage: string = 'active') {
    try {
      await invoke("db_save_note_metadata", {
        filePath,
        tags: JSON.stringify(tags),
        links: JSON.stringify(links),
        storage: storage || 'active',
      });
    } catch (err) {
      console.error(`Failed to save note metadata for ${filePath}:`, err);
    }
  }

  async getNoteMetadata(filePath: string): Promise<{ tags: string[]; links: string[] } | null> {
    try {
      const res = await invoke<DbNoteMetadata | null>("db_get_note_metadata", { filePath });
      if (res) {
        return {
          tags: JSON.parse(res.tags || "[]"),
          links: JSON.parse(res.links || "[]"),
        };
      }
    } catch (err) {
      console.error(`Failed to get note metadata for ${filePath}:`, err);
    }
    return null;
  }

  async getAllNoteMetadata(): Promise<{ file_path: string; tags: string[]; links: string[] }[]> {
    try {
      const rows = await invoke<DbNoteMetadata[]>("db_get_all_note_metadata");
      return rows.map((r) => ({
        file_path: r.file_path,
        tags: JSON.parse(r.tags || "[]"),
        links: JSON.parse(r.links || "[]"),
      }));
    } catch (err) {
      console.error("Failed to query all note metadata:", err);
      return [];
    }
  }

  async saveAiSuggestions(filePath: string, tags: string[], links: string[]) {
    try {
      await invoke("db_save_ai_suggestions", {
        filePath,
        tags: JSON.stringify(tags),
        links: JSON.stringify(links),
      });
    } catch (err) {
      console.error(`Failed to save AI suggestions for ${filePath}:`, err);
    }
  }

  async getAiSuggestions(filePath: string): Promise<{ tags: string[]; links: string[] } | null> {
    try {
      const res = await invoke<DbNoteMetadata | null>("db_get_ai_suggestions", { filePath });
      if (res) {
        return {
          tags: JSON.parse(res.tags || "[]"),
          links: JSON.parse(res.links || "[]"),
        };
      }
    } catch (err) {
      console.error(`Failed to get AI suggestions for ${filePath}:`, err);
    }
    return null;
  }

  async getAllAiSuggestions(): Promise<{ file_path: string; tags: string[]; links: string[] }[]> {
    try {
      const rows = await invoke<DbNoteMetadata[]>("db_get_all_ai_suggestions");
      return rows.map((r) => ({
        file_path: r.file_path,
        tags: JSON.parse(r.tags || "[]"),
        links: JSON.parse(r.links || "[]"),
      }));
    } catch (err) {
      console.error("Failed to query all AI suggestions:", err);
      return [];
    }
  }

  async syncNoteLinks(sourcePath: string, links: string[]) {
    try {
      await invoke("db_sync_note_links", { sourcePath, links });
    } catch (err) {
      console.error(`Failed to sync note links for ${sourcePath}:`, err);
    }
  }

  async getBacklinks(
    targetNoteName: string,
    targetRelPath?: string,
    includeTrash: boolean = false
  ): Promise<string[]> {
    try {
      return await invoke<string[]>("db_get_backlinks", {
        targetNoteName,
        targetRelPath: targetRelPath || null,
        includeTrash,
      });
    } catch (err) {
      console.error(`Failed to query backlinks for ${targetNoteName}:`, err);
      return [];
    }
  }

  async getBacklinkFilePaths(
    targetNoteName: string,
    targetRelPath?: string,
    includeTrash: boolean = false
  ): Promise<string[]> {
    try {
      return await invoke<string[]>("db_get_backlink_file_paths", {
        targetNoteName,
        targetRelPath: targetRelPath || null,
        includeTrash,
      });
    } catch (err) {
      console.error(`Failed to query backlink file paths for ${targetNoteName}:`, err);
      return [];
    }
  }

  async getAllBacklinksBatch(includeTrash: boolean = false): Promise<Record<string, string[]>> {
    try {
      return await invoke<Record<string, string[]>>("db_get_all_backlinks_batch", { includeTrash });
    } catch (err) {
      console.error("Failed to query batch backlinks:", err);
      return {};
    }
  }

  // Indexes note contents using heading-aware paragraph chunking & batched ONNX embeddings
  async indexFile(filePath: string, content: string) {
    try {
      // Clear old chunks for this file
      await invoke("vector_delete", { filePath });

      const rawBlocks = content.split(/\n\s*\n/).map(b => b.trim()).filter(b => b.length > 10);
      if (rawBlocks.length === 0) return;

      const noteTitle = filePath
        .replace(/\\/g, "/")
        .split("/")
        .pop()
        ?.replace(/\.md$/i, "") ?? "";

      let currentHeading = "";
      const rawChunks: string[] = [];

      for (const block of rawBlocks) {
        if (block.startsWith("---") && block.endsWith("---")) continue; // Skip frontmatter
        
        const headingMatch = block.match(/^(#{1,6})\s+(.*)$/m);
        if (headingMatch) {
          currentHeading = headingMatch[2].trim();
        }

        const baseChunk = currentHeading && !block.startsWith("#")
          ? `[Section: ${currentHeading}] ${block}`
          : block;

        rawChunks.push(baseChunk);
      }

      if (rawChunks.length === 0) return;

      // Prepare formatted chunk texts with document instruction prefix
      const formattedChunks: { chunkText: string; docFormatted: string }[] = rawChunks.map((chunk, i) => {
        const chunkText = i === 0
          ? `Note: ${noteTitle}\n\n${chunk}`
          : `[Note: ${noteTitle}] ${chunk}`;
        return {
          chunkText,
          docFormatted: `search_document: ${chunkText}`,
        };
      });

      // Embed in optimal batches of 16 chunks
      const BATCH_SIZE = 16;
      for (let i = 0; i < formattedChunks.length; i += BATCH_SIZE) {
        const batch = formattedChunks.slice(i, i + BATCH_SIZE);
        const batchTexts = batch.map((b) => b.docFormatted);
        const vectors = await embeddingClient.embedBatch(batchTexts);

        const upsertItems = batch.map((b, idx) => ({
          file_path: filePath,
          chunk_text: b.chunkText,
          embedding: vectors[idx],
        }));

        await invoke("vector_upsert_batch", { chunks: upsertItems });
      }
    } catch (err) {
      console.error(`Failed to index file ${filePath}:`, err);
    }
  }

  async indexFileChunk(filePath: string, chunkText: string) {
    try {
      const docFormatted = `search_document: ${chunkText}`;
      const vector = await embeddingClient.embed(docFormatted);
      await invoke("vector_upsert", { filePath, chunkText, embedding: vector });
    } catch (err) {
      console.error(`Failed to embed chunk in ${filePath}:`, err);
    }
  }

  async deleteNoteMetadata(filePath: string) {
    try {
      await invoke("db_delete_note_metadata", { filePath });
    } catch (err) {
      console.error(`Failed to delete note metadata for ${filePath}:`, err);
    }
  }

  async clearAllMetadata() {
    try {
      await invoke("db_clear_all_metadata");
    } catch (err) {
      console.error("Failed to clear all metadata:", err);
    }
  }

  // Query vector search database using native sqlite-vec
  async search(query: string, topK = 8): Promise<SearchResult[]> {
    const queryFormatted = `search_query: ${query}`;
    const queryVector = await embeddingClient.embed(queryFormatted);
    return await invoke<SearchResult[]>("vector_search", { queryText: query, queryEmbedding: queryVector, topK });
  }

  /**
   * Hybrid RAG Search: Combines FTS5 full-text BM25 keyword search with native sqlite-vec
   * 768d cosine similarity embeddings using Reciprocal Rank Fusion (RRF).
   */
  async hybridRrfSearch(query: string, topK = 8, _kFactor = 60): Promise<SearchResult[]> {
    return this.search(query, topK);
  }

  /**
   * Dynamic Token Budget Allocation RAG Search.
   * Packs candidate chunks up to a target tokenBudget (e.g. 3,000 tokens for local models, 24,000 for cloud).
   * Applies self-query metadata pre-filtering (tags, status, date) and Time-Weighted RRF recency bias.
   */
  async hybridRrfSearchWithBudget(
    query: string,
    tokenBudget: number = 3000,
    userFilter?: SelfQueryFilter
  ): Promise<SearchResult[]> {
    const filter = userFilter || extractSelfQueryFilter(query);
    const candidateLimit = 40;
    const candidates = await this.hybridRrfSearch(filter.cleanQuery, candidateLimit);
    if (!candidates || candidates.length === 0) return [];

    let filtered = candidates;

    if (filter?.dateAfter) {
      filtered = filtered.filter((item) => (item.updatedAt || 0) >= filter.dateAfter!);
    }

    if (filter?.tags && filter.tags.length > 0) {
      try {
        const tagRows = await this.getAllNoteMetadata();
        const matchingPaths = new Set(
          tagRows
            .filter((r) => {
              try {
                const fileTags: string[] = Array.isArray(r.tags) ? r.tags.map((t: string) => t.toLowerCase()) : [];
                return filter.tags!.some((ft) => fileTags.includes(ft));
              } catch {
                return false;
              }
            })
            .map((r) => r.file_path)
        );
        if (matchingPaths.size > 0) {
          filtered = filtered.filter((item) => matchingPaths.has(item.filePath));
        }
      } catch {}
    }

    // Dynamic Token Budget Accumulation
    const results: SearchResult[] = [];
    let accumulatedTokens = 0;

    for (const item of filtered) {
      const estimatedTokens = Math.ceil(item.chunkText.length / 4);
      if (accumulatedTokens + estimatedTokens > tokenBudget && results.length > 0) {
        break;
      }
      results.push(item);
      accumulatedTokens += estimatedTokens;
    }

    return results;
  }

  async removeFile(filePath: string) {
    try {
      await invoke("vector_delete", { filePath });
    } catch (err) {
      console.error(`Failed to delete index for ${filePath}:`, err);
    }
  }

  async findBacklinks(noteName: string): Promise<string[]> {
    try {
      return await invoke<string[]>("vector_find_backlinks", { noteName });
    } catch (err) {
      console.error("Failed to query backlinks:", err);
      return [];
    }
  }

  async getSemanticConnections(threshold = 0.75): Promise<{ source: string; target: string; similarity: number }[]> {
    try {
      return await invoke<{ source: string; target: string; similarity: number }[]>(
        "vector_get_semantic_connections",
        { threshold }
      );
    } catch (err) {
      console.error("Failed to calculate semantic connections:", err);
      return [];
    }
  }
}

export const searchEngine = new SearchEngine();

if (typeof window !== "undefined" && import.meta.env.DEV) {
  (window as any).searchEngine = searchEngine;
}
