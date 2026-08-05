import { pipeline, env } from "@huggingface/transformers";

// Configure transformers.js to load bundled local static models from /models/
// Configure transformers.js to load local static models or download/cache ONNX model weights
env.allowLocalModels = true;
env.allowRemoteModels = true;
(env as any).localURL = "/models/";

let pipelineInstance: any = null;

async function getPipeline() {
  if (!pipelineInstance) {
    pipelineInstance = await pipeline("feature-extraction", "nomic-ai/nomic-embed-text-v1.5", {
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
