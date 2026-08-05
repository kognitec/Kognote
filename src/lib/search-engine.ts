import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { extractSelfQueryFilter, SelfQueryFilter } from "./self-query";

export interface SearchResult {
  filePath: string;
  chunkText: string;
  similarity: number;
  updatedAt?: number;
}

class EmbeddingWorkerClient {
  private worker: Worker | null = null;
  private pendingResolves = new Map<string, (vector: number[]) => void>();
  private pendingRejects = new Map<string, (err: Error) => void>();

  constructor() {
    if (typeof window !== "undefined") {
      this.worker = new Worker(
        new URL("../workers/embedding-worker.ts", import.meta.url),
        { type: "module" }
      );
      this.worker.onmessage = (e) => {
        const { id, vector, error, type, file, progress } = e.data;
        if (type === "progress") {
          window.dispatchEvent(new CustomEvent("embedding-progress", { detail: { file, progress } }));
          return;
        }
        if (type === "ready") {
          window.dispatchEvent(new CustomEvent("embedding-ready"));
          return;
        }

        if (error) {
          const reject = this.pendingRejects.get(id);
          if (reject) {
            reject(new Error(error));
            this.pendingRejects.delete(id);
            this.pendingResolves.delete(id);
          }
        } else if (vector) {
          const resolve = this.pendingResolves.get(id);
          if (resolve) {
            resolve(vector);
            this.pendingResolves.delete(id);
            this.pendingRejects.delete(id);
          }
        }
      };
    }
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
      this.worker.postMessage({ text, id });
    });
  }
}

export const embeddingClient = new EmbeddingWorkerClient();

export class SearchEngine {
  private db: Database | null = null;

  async init() {
    if (this.db) return;
    try {
      this.db = await Database.load("sqlite:kognote_search.db");
      
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS ai_suggestions (
          file_path TEXT PRIMARY KEY,
          tags TEXT NOT NULL,
          links TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);

      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS note_metadata (
          file_path TEXT PRIMARY KEY,
          tags TEXT NOT NULL,
          links TEXT NOT NULL,
          storage TEXT NOT NULL DEFAULT 'active',
          updated_at INTEGER NOT NULL
        );
      `);

      await this.db.execute(`
        CREATE VIRTUAL TABLE IF NOT EXISTS note_fts USING fts5(
          file_path UNINDEXED,
          chunk_text
        );
      `);

      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS note_links (
          source_path TEXT NOT NULL,
          target_name TEXT NOT NULL,
          PRIMARY KEY (source_path, target_name)
        );
      `);

      await this.db.execute(`
        CREATE INDEX IF NOT EXISTS idx_note_links_target ON note_links(target_name);
      `);
    } catch (err) {
      console.error("Failed to initialize SQLite search database:", err);
    }
  }

  async saveNoteMetadata(filePath: string, tags: string[], links: string[], storage: string = 'active') {
    await this.init();
    if (!this.db) return;
    try {
      await this.db.execute(
        `INSERT OR REPLACE INTO note_metadata (file_path, tags, links, storage, updated_at) VALUES ($1, $2, $3, $4, $5)`,
        [filePath, JSON.stringify(tags), JSON.stringify(links), storage || 'active', Date.now()]
      );
    } catch (err) {
      console.error(`Failed to save note metadata for ${filePath}:`, err);
    }
  }

  async getNoteMetadata(filePath: string): Promise<{ tags: string[]; links: string[] } | null> {
    await this.init();
    if (!this.db) return null;
    try {
      const rows = await this.db.select<{ tags: string; links: string }[]>(
        `SELECT tags, links FROM note_metadata WHERE file_path = $1`,
        [filePath]
      );
      if (rows && rows.length > 0) {
        return {
          tags: JSON.parse(rows[0].tags),
          links: JSON.parse(rows[0].links)
        };
      }
    } catch (err) {
      console.error(`Failed to get note metadata for ${filePath}:`, err);
    }
    return null;
  }

  async getAllNoteMetadata(): Promise<{ file_path: string; tags: string[]; links: string[] }[]> {
    await this.init();
    if (!this.db) return [];
    try {
      const rows = await this.db.select<{ file_path: string; tags: string; links: string }[]>(
        `SELECT file_path, tags, links FROM note_metadata`
      );
      return rows.map(r => ({
        file_path: r.file_path,
        tags: JSON.parse(r.tags),
        links: JSON.parse(r.links)
      }));
    } catch (err) {
      console.error("Failed to query all note metadata:", err);
      return [];
    }
  }

  async saveAiSuggestions(filePath: string, tags: string[], links: string[]) {
    await this.init();
    if (!this.db) return;
    try {
      await this.db.execute(
        `INSERT OR REPLACE INTO ai_suggestions (file_path, tags, links, updated_at) VALUES ($1, $2, $3, $4)`,
        [filePath, JSON.stringify(tags), JSON.stringify(links), Date.now()]
      );
    } catch (err) {
      console.error(`Failed to save AI suggestions for ${filePath}:`, err);
    }
  }

  async getAiSuggestions(filePath: string): Promise<{ tags: string[]; links: string[] } | null> {
    await this.init();
    if (!this.db) return null;
    try {
      const rows = await this.db.select<{ tags: string; links: string }[]>(
        `SELECT tags, links FROM ai_suggestions WHERE file_path = $1`,
        [filePath]
      );
      if (rows && rows.length > 0) {
        return {
          tags: JSON.parse(rows[0].tags),
          links: JSON.parse(rows[0].links)
        };
      }
    } catch (err) {
      console.error(`Failed to get AI suggestions for ${filePath}:`, err);
    }
    return null;
  }

  async getAllAiSuggestions(): Promise<{ file_path: string; tags: string[]; links: string[] }[]> {
    await this.init();
    if (!this.db) return [];
    try {
      const rows = await this.db.select<{ file_path: string; tags: string; links: string }[]>(
        `SELECT file_path, tags, links FROM ai_suggestions`
      );
      return rows.map(r => ({
        file_path: r.file_path,
        tags: JSON.parse(r.tags),
        links: JSON.parse(r.links)
      }));
    } catch (err) {
      console.error("Failed to query all AI suggestions:", err);
      return [];
    }
  }

  // Incremental relational note_links update
  async syncNoteLinks(sourcePath: string, links: string[]) {
    await this.init();
    if (!this.db) return;
    try {
      await this.db.execute(`DELETE FROM note_links WHERE source_path = $1`, [sourcePath]);
      for (const link of links) {
        const cleanLink = link.trim().replace(/\.md$/, "");
        if (cleanLink) {
          await this.db.execute(
            `INSERT OR IGNORE INTO note_links (source_path, target_name) VALUES ($1, $2)`,
            [sourcePath, cleanLink]
          );
        }
      }
    } catch (err) {
      console.error(`Failed to sync note links for ${sourcePath}:`, err);
    }
  }

  // Fast relational backlink lookup with storage filtering and path disambiguation
  async getBacklinks(
    targetNoteName: string,
    targetRelPath?: string,
    includeTrash: boolean = false
  ): Promise<string[]> {
    await this.init();
    if (!this.db) return [];
    try {
      const cleanTarget = targetNoteName.trim().replace(/\.(md|excalidraw)$/i, "").toLowerCase();
      const cleanRelTarget = targetRelPath ? targetRelPath.trim().replace(/\.(md|excalidraw)$/i, "").toLowerCase() : "";

      let query = `
        SELECT DISTINCT nl.source_path 
        FROM note_links nl
        LEFT JOIN note_metadata nm ON LOWER(nl.source_path) = LOWER(nm.file_path)
        WHERE (LOWER(nl.target_name) = $1 OR ($2 != '' AND LOWER(nl.target_name) = $2))
      `;

      if (!includeTrash) {
        query += ` AND (nm.storage IS NULL OR nm.storage != 'deleted') AND LOWER(nl.source_path) NOT LIKE '%/trash/%' AND LOWER(nl.source_path) NOT LIKE '%/.deleted/%'`;
      }

      const rows = await this.db.select<{ source_path: string }[]>(query, [cleanTarget, cleanRelTarget]);
      return rows.map((r) => r.source_path.replace(/\\/g, "/").split("/").pop()!.replace(/\.(md|excalidraw)$/i, ""));
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
    await this.init();
    if (!this.db) return [];
    try {
      const cleanTarget = targetNoteName.trim().replace(/\.(md|excalidraw)$/i, "").toLowerCase();
      const cleanRelTarget = targetRelPath ? targetRelPath.trim().replace(/\.(md|excalidraw)$/i, "").toLowerCase() : "";

      let query = `
        SELECT DISTINCT nl.source_path 
        FROM note_links nl
        LEFT JOIN note_metadata nm ON LOWER(nl.source_path) = LOWER(nm.file_path)
        WHERE (LOWER(nl.target_name) = $1 OR ($2 != '' AND LOWER(nl.target_name) = $2))
      `;

      if (!includeTrash) {
        query += ` AND (nm.storage IS NULL OR nm.storage != 'deleted') AND LOWER(nl.source_path) NOT LIKE '%/trash/%' AND LOWER(nl.source_path) NOT LIKE '%/.deleted/%'`;
      }

      const rows = await this.db.select<{ source_path: string }[]>(query, [cleanTarget, cleanRelTarget]);
      return rows.map((r) => r.source_path);
    } catch (err) {
      console.error(`Failed to query backlink file paths for ${targetNoteName}:`, err);
      return [];
    }
  }

  // Indexes note contents using heading-aware paragraph chunking & native 768d sqlite-vec
  async indexFile(filePath: string, content: string) {
    await this.init();

    try {
      // Clear old chunks for this file
      await invoke("vector_delete", { filePath });

      const rawBlocks = content.split(/\n\s*\n/).map(b => b.trim()).filter(b => b.length > 10);
      if (rawBlocks.length === 0) return;

      let currentHeading = "";
      const chunks: string[] = [];

      for (const block of rawBlocks) {
        if (block.startsWith("---") && block.endsWith("---")) continue; // Skip frontmatter block
        
        const headingMatch = block.match(/^(#{1,6})\s+(.*)$/m);
        if (headingMatch) {
          currentHeading = headingMatch[2].trim();
        }

        const baseChunk = currentHeading && !block.startsWith("#")
          ? `[Section: ${currentHeading}] ${block}`
          : block;

        chunks.push(baseChunk);
      }

      for (const chunkText of chunks) {
        try {
          // Add nomic-embed-text-v1.5 document instruction prefix
          const docFormatted = `search_document: ${chunkText}`;
          const vector = await embeddingClient.embed(docFormatted);
          await invoke("vector_upsert", { filePath, chunkText, embedding: vector });
        } catch (err) {
          console.error(`Failed to embed chunk in ${filePath}:`, err);
        }
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

  // Query vector search database using native sqlite-vec
  async search(query: string, topK = 8): Promise<SearchResult[]> {
    try {
      // Add nomic-embed-text-v1.5 query instruction prefix
      const queryFormatted = `search_query: ${query}`;
      const queryVector = await embeddingClient.embed(queryFormatted);
      return await invoke<SearchResult[]>("vector_search", { queryText: query, queryEmbedding: queryVector, topK });
    } catch (err) {
      console.error("Vector search failed:", err);
      return [];
    }
  }

  /**
   * Hybrid RAG Search: Combines FTS5 full-text BM25 keyword search with native sqlite-vec
   * 768d cosine similarity embeddings using Reciprocal Rank Fusion (RRF).
   */
  async hybridRrfSearch(query: string, topK = 8, kFactor = 60): Promise<SearchResult[]> {
    try {
      const vectorResults = await this.search(query, topK * 2);

      let ftsResults: { file_path: string; chunk_text: string }[] = [];
      if (this.db) {
        const cleanQuery = query.replace(/[^a-zA-Z0-9\s]/g, "").trim();
        if (cleanQuery) {
          ftsResults = await this.db.select<{ file_path: string; chunk_text: string }[]>(
            `SELECT file_path, chunk_text FROM note_fts WHERE chunk_text MATCH $1 LIMIT $2`,
            [cleanQuery, topK * 2]
          ).catch(() => []);
        }
      }

      const scoresMap = new Map<string, { filePath: string; chunkText: string; score: number }>();

      vectorResults.forEach((res, rank) => {
        const key = `${res.filePath}::${res.chunkText}`;
        const rrfScore = 1 / (kFactor + (rank + 1));
        scoresMap.set(key, { filePath: res.filePath, chunkText: res.chunkText, score: rrfScore });
      });

      ftsResults.forEach((res, rank) => {
        const key = `${res.file_path}::${res.chunk_text}`;
        const rrfScore = 1 / (kFactor + (rank + 1));
        const existing = scoresMap.get(key);
        if (existing) {
          existing.score += rrfScore;
        } else {
          scoresMap.set(key, { filePath: res.file_path, chunkText: res.chunk_text, score: rrfScore });
        }
      });

      const sorted = Array.from(scoresMap.values()).sort((a, b) => b.score - a.score);
      return sorted.slice(0, topK).map((item) => ({
        filePath: item.filePath,
        chunkText: item.chunkText,
        similarity: item.score,
      }));
    } catch (err) {
      console.error("Hybrid RRF search failed:", err);
      return this.search(query, topK);
    }
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

    // Apply Self-Query Date Filter if specified
    if (filter?.dateAfter) {
      filtered = filtered.filter((item) => (item.updatedAt || 0) >= filter.dateAfter!);
    }

    // Apply Self-Query Tag Filter if specified
    if (filter?.tags && filter.tags.length > 0 && this.db) {
      try {
        const tagRows = (await this.db.select<{ file_path: string; tags: string }>(
          `SELECT file_path, tags FROM note_metadata`
        )) || [];
        if (Array.isArray(tagRows)) {
          const matchingPaths = new Set(
            tagRows
              .filter((r: { file_path: string; tags: string }) => {
                try {
                  const fileTags: string[] = JSON.parse(r.tags || "[]").map((t: string) => t.toLowerCase());
                  return filter.tags!.some((ft) => fileTags.includes(ft));
                } catch {
                  return false;
                }
              })
              .map((r: { file_path: string; tags: string }) => r.file_path)
          );
          if (matchingPaths.size > 0) {
            filtered = filtered.filter((item) => matchingPaths.has(item.filePath));
          }
        }
      } catch {}
    }

    // Apply Self-Query Status Filter if specified
    if (filter?.status && this.db) {
      try {
        const statusRows = (await this.db.select<{ file_path: string }>(
          `SELECT file_path FROM note_metadata WHERE tags LIKE $1`,
          [`%${filter.status}%`]
        ).catch(() => [])) || [];
        if (Array.isArray(statusRows) && statusRows.length > 0) {
          const statusPaths = new Set(statusRows.map((r: { file_path: string }) => r.file_path));
          filtered = filtered.filter((item) => statusPaths.has(item.filePath));
        }
      } catch {}
    }

    // Dynamic Token Budget Accumulation
    const results: SearchResult[] = [];
    let accumulatedTokens = 0;

    for (const item of filtered) {
      // Estimate token count (~4 chars per token for English text)
      const estimatedTokens = Math.ceil(item.chunkText.length / 4);
      if (accumulatedTokens + estimatedTokens > tokenBudget && results.length > 0) {
        break;
      }
      results.push(item);
      accumulatedTokens += estimatedTokens;
    }

    return results;
  }

  // Deletes note indexing entries using native sqlite-vec
  async removeFile(filePath: string) {
    try {
      await invoke("vector_delete", { filePath });
    } catch (err) {
      console.error(`Failed to delete index for ${filePath}:`, err);
    }
  }

  // Safe wrapper to perform custom queries
  async select<T>(sql: string, params: any[] = []): Promise<T[]> {
    await this.init();
    if (!this.db) return [];
    return this.db.select<T[]>(sql, params);
  }

  // Safe wrapper to execute write/delete custom queries
  async execute(sql: string, params: any[] = []): Promise<void> {
    await this.init();
    if (!this.db) return;
    await this.db.execute(sql, params);
  }

  // Find other notes referencing a note by name (wiki-links backlink finder)
  async findBacklinks(noteName: string): Promise<string[]> {
    try {
      return await invoke<string[]>("vector_find_backlinks", { noteName });
    } catch (err) {
      console.error("Failed to query backlinks:", err);
      return [];
    }
  }

  // Calculate pairs of semantically related notes based on cosine similarity using sqlite-vec
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

