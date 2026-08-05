import { pipeline, env } from "@huggingface/transformers";

// Load the bundled local model from public/models/ — no internet required on fresh systems.
// nomic-ai/nomic-embed-text-v1.5 ONNX files are shipped inside the app bundle.
env.allowLocalModels = true;
env.allowRemoteModels = false;   // Enforce offline-only: only use the bundled model
(env as any).localModelPath = "/models/";
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
