import { pipeline, env } from "@huggingface/transformers";

// Configure Transformers.js to check local bundled models first, falling back to CDN
env.allowLocalModels = true;
env.allowRemoteModels = true;

// Configure ONNX WebAssembly backend to use single-threaded mode for maximum stability across platforms
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
}

let pipelineInstance: any = null;

// Helper to clear any corrupted or partial cache entries in CacheStorage
async function purgeCorruptedCache() {
  if (typeof caches !== "undefined") {
    try {
      const keys = await caches.keys();
      for (const key of keys) {
        if (key.includes("transformers") || key.includes("huggingface") || key.includes("onnx")) {
          console.warn(`[Embedding Worker] Clearing cached storage key: ${key}`);
          await caches.delete(key);
        }
      }
    } catch (e) {
      console.warn("[Embedding Worker] Failed to purge CacheStorage:", e);
    }
  }
}

// Self-healing pipeline initializer with automatic retries, backoff, and cache eviction
async function getPipeline(maxRetries = 3) {
  if (pipelineInstance) return pipelineInstance;

  // 1. Try loading from local bundled asset path (/models/nomic-embed-text-v1.5/) for 100% offline first boot
  try {
    console.log("[Embedding Worker] Checking for local bundled model in /models/nomic-embed-text-v1.5/...");
    const checkRes = await fetch("/models/nomic-embed-text-v1.5/config.json");
    const checkType = checkRes.headers.get("content-type") || "";
    if (!checkRes.ok || !checkType.includes("application/json")) {
      throw new Error("Bundled model config not found or invalid response");
    }

    pipelineInstance = await (pipeline as any)(
      "feature-extraction",
      "/models/nomic-embed-text-v1.5/",
      { dtype: "q8" }
    );
    console.log("[Embedding Worker] Successfully loaded bundled model offline!");
    self.postMessage({ type: "ready" });
    return pipelineInstance;
  } catch (localErr) {
    console.log("[Embedding Worker] Local bundled model files not present or invalid. Proceeding with remote CDN fetching...");
  }

  let lastError: any = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[Embedding Worker] Initializing nomic-embed-text-v1.5 model from CDN (Attempt ${attempt}/${maxRetries})...`);
      
      pipelineInstance = await (pipeline as any)(
        "feature-extraction",
        "nomic-ai/nomic-embed-text-v1.5",
        {
          dtype: "q8",
          progress_callback: (data: any) => {
            if (data.status === "progress") {
              self.postMessage({
                type: "progress",
                file: data.file,
                progress: data.progress,
                loaded: data.loaded,
                total: data.total,
              });
            } else if (data.status === "ready" || data.status === "done") {
              self.postMessage({ type: "ready", file: data.file });
            }
          },
        }
      );

      console.log("[Embedding Worker] Model pipeline loaded successfully!");
      self.postMessage({ type: "ready" });
      return pipelineInstance;
    } catch (err: any) {
      lastError = err;
      console.error(`[Embedding Worker] Initialization attempt ${attempt} failed:`, err);
      pipelineInstance = null;

      // On failure, purge any corrupted or partially downloaded cache before retrying
      await purgeCorruptedCache();

      // Exponential backoff pause before retrying
      if (attempt < maxRetries) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        console.log(`[Embedding Worker] Retrying in ${backoffMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  throw new Error(`Failed to load embedding model after ${maxRetries} attempts: ${lastError?.message || lastError}`);
}

// Internal FIFO message queue to prevent concurrent ONNX WebAssembly session race conditions
const messageQueue: MessageEvent[] = [];
let isProcessingQueue = false;

async function processQueue() {
  if (isProcessingQueue || messageQueue.length === 0) return;
  isProcessingQueue = true;

  while (messageQueue.length > 0) {
    const e = messageQueue.shift()!;
    const { text, texts, id, command } = e.data;

    if (command === "purge-cache") {
      try {
        await purgeCorruptedCache();
        pipelineInstance = null;
        self.postMessage({ id, success: true });
      } catch (err: any) {
        self.postMessage({ id, error: err.toString() });
      }
      continue;
    }

    if (command === "redownload") {
      try {
        await purgeCorruptedCache();
        pipelineInstance = null;
        await getPipeline(3);
        self.postMessage({ id, success: true });
      } catch (err: any) {
        self.postMessage({ id, error: err.toString() });
      }
      continue;
    }

    // Handle batched texts embedding
    if (Array.isArray(texts) && texts.length > 0) {
      try {
        const extractor = await getPipeline();
        const output = await extractor(texts, {
          pooling: "mean",
          normalize: true,
        });
        const vectors: number[][] = [];
        const numItems = output.dims[0];
        const dim = output.dims[1] || 768;

        for (let i = 0; i < numItems; i++) {
          const slice = Array.from(output.data.slice(i * dim, (i + 1) * dim));
          vectors.push(slice as number[]);
        }

        self.postMessage({ id, vectors });
      } catch (err: any) {
        console.error("[Embedding Worker] Batch embedding execution error:", err);
        self.postMessage({ id, error: err.toString() });
      }
      continue;
    }

    // Handle single text embedding
    if (text) {
      try {
        const extractor = await getPipeline();
        const output = await extractor(text, {
          pooling: "mean",
          normalize: true,
        });
        const vector = Array.from(output.data);
        self.postMessage({ id, vector });
      } catch (err: any) {
        console.error("[Embedding Worker] Embedding execution error:", err);
        self.postMessage({ id, error: err.toString() });
      }
    }
  }

  isProcessingQueue = false;
}

self.onmessage = (e: MessageEvent) => {
  if (e.data.priority === "high" || e.data.text) {
    messageQueue.unshift(e);
  } else {
    messageQueue.push(e);
  }
  processQueue();
};
