import { pipeline, env } from "@huggingface/transformers";

// Tell transformers.js to load models from HuggingFace CDN and cache them locally in browser Cache API
env.allowLocalModels = false;

let pipelineInstance: any = null;

async function getPipeline() {
  if (!pipelineInstance) {
    pipelineInstance = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      progress_callback: (data: any) => {
        if (data.status === "progress") {
          self.postMessage({ type: "progress", file: data.file, progress: data.progress });
        } else if (data.status === "ready") {
          self.postMessage({ type: "ready" });
        }
      }
    });
  }
  return pipelineInstance;
}

self.onmessage = async (e: MessageEvent) => {
  const { text, id } = e.data;
  if (!text) return;

  try {
    const extractor = await getPipeline();
    const output = await extractor(text, {
      pooling: "mean",
      normalize: true,
    });
    const vector = Array.from(output.data);
    self.postMessage({ id, vector });
  } catch (err: any) {
    self.postMessage({ id, error: err.toString() });
  }
};
