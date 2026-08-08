/**
 * Local AI & External API Integration Service for Kognote
 *
 * Local inference: Routes through native Tauri commands (llm_*) which manage
 * model download from Hugging Face and run inference via a bundled llama-server.
 * This is fully store-compliant (Apple MAS, Microsoft Store) — no external
 * dependencies required from the user.
 *
 * External API: OpenAI-compatible REST endpoint (e.g. OpenAI, Anthropic, local OpenWebUI).
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface AISettings {
  provider: "local" | "custom_local" | "anthropic" | "gemini" | "openai" | "api";
  localModel: string;
  customLocalUrl?: string;
  customLocalModel?: string;
  apiUrl: string;
  apiKey: string;
  apiModel: string;
  inactivityTimeoutSeconds?: number;
}

export interface SystemHardwareInfo {
  os: string;
  arch: string;
  cpu_brand: string;
  cpu_cores: number;
  total_ram_gb: number;
  gpu_name: string;
  is_apple_silicon: boolean;
  display_label: string;
  recommended_model_id: string;
  recommendation_reason: string;
}

export interface ModelStatus {
  id: string;
  display_name: string;
  downloaded: boolean;
  size_bytes: number;
  file_size_bytes: number;
  target_tier: string;
  ram_required: string;
  speed_rating: string;
  description: string;
}

export interface DownloadProgressEvent {
  model_id: string;
  percent: number;
  downloaded_bytes: number;
  total_bytes: number;
  status: "downloading" | "complete" | "already_downloaded" | "downloading_runtime" | "runtime_ready";
}

export async function streamFetchSSE(
  url: string,
  headers: Record<string, string>,
  body: any,
  onToken: (token: string) => void,
  extractToken: (dataObj: any) => string | null,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    throw new Error(`API stream error ${res.status}: ${await res.text()}`);
  }

  if (!res.body) {
    throw new Error("Response body is empty or streaming not supported.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let accumulated = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":") || trimmed === "data: [DONE]") continue;
      if (trimmed.startsWith("data:")) {
        const jsonStr = trimmed.slice(5).trim();
        try {
          const parsed = JSON.parse(jsonStr);
          const token = extractToken(parsed);
          if (token) {
            accumulated += token;
            onToken(token);
          }
        } catch {}
      }
    }
  }

  return accumulated;
}

class AIService {
  private inactivityTimeout: any = null;
  private isChatOpen: boolean = false;
  private isGenerating: boolean = false;
  private settings: AISettings = {
    provider: "local",
    localModel: "qwen2.5-coder-3b",
    customLocalUrl: "http://localhost:11434/v1",
    customLocalModel: "qwen2.5-coder",
    apiUrl: "https://api.openai.com/v1",
    apiKey: "",
    apiModel: "gpt-4o-mini",
    inactivityTimeoutSeconds: 300,
  };

  /** Call when AI Chat drawer/panel opens or closes */
  setChatOpen(isOpen: boolean) {
    this.isChatOpen = isOpen;
    this.scheduleInactivityUnload();
  }

  /** Centralized unload scheduling logic */
  scheduleInactivityUnload() {
    if (this.settings.provider !== "local") return;
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
    }

    if (this.isGenerating) return;

    // If chat panel is closed (and AI is idle), enforce a strict 30-second unload override
    const configuredSeconds = Math.max(30, Math.min(300, this.settings.inactivityTimeoutSeconds ?? 300));
    const effectiveSeconds = !this.isChatOpen ? 30 : configuredSeconds;

    this.inactivityTimeout = setTimeout(() => {
      this.unloadModel().catch(console.error);
    }, effectiveSeconds * 1000);
  }

  /** Auto-detect system hardware on first launch to select optimal default timeout */
  async autoDetectDefaultTimeout(): Promise<number> {
    try {
      const info = await this.getSystemInfo();
      // Low memory systems (<12 GB RAM) use 30s unload; 12GB+ systems use 300s (5m)
      const defaultTimeout = info.total_ram_gb < 12 ? 30 : 300;
      if (this.settings.inactivityTimeoutSeconds === undefined) {
        this.settings.inactivityTimeoutSeconds = defaultTimeout;
      }
      return defaultTimeout;
    } catch {
      return 300;
    }
  }

  /** Update configuration. Call whenever settings change. */
  updateSettings(newSettings: Partial<AISettings>) {
    this.settings = { ...this.settings, ...newSettings };
  }

  /** Get current AI configuration. */
  getSettings(): AISettings {
    return { ...this.settings };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Model discovery & download (local path)
  // ─────────────────────────────────────────────────────────────────────────

  /** Returns system hardware detection info & recommended model ID. */
  async getSystemInfo(): Promise<SystemHardwareInfo> {
    return await invoke<SystemHardwareInfo>("llm_get_system_info");
  }

  /** Returns download status of all bundled models. */
  async listModels(): Promise<ModelStatus[]> {
    return await invoke<ModelStatus[]>("llm_list_models");
  }

  /** Returns true if the given model GGUF is fully on disk. */
  async isModelDownloaded(modelId: string): Promise<boolean> {
    return await invoke<boolean>("llm_check_model", { modelId });
  }

  /**
   * Download the model GGUF from Hugging Face with resume support.
   * Listens for "llm_download_progress" events and calls `onProgress` with 0-100.
   */
  async downloadModel(
    modelId: string,
    onProgress: (event: DownloadProgressEvent) => void
  ): Promise<string> {
    const unlisten: UnlistenFn = await listen<DownloadProgressEvent>(
      "llm_download_progress",
      (event) => {
        if (event.payload.model_id === modelId) {
          onProgress(event.payload);
        }
      }
    );

    try {
      const path = await invoke<string>("llm_download_model", { modelId });
      return path;
    } finally {
      unlisten();
    }
  }

  /** Delete the model file from disk to free space. */
  async deleteModel(modelId: string): Promise<void> {
    await invoke("llm_delete_model", { modelId });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Model loading / unloading
  // ─────────────────────────────────────────────────────────────────────────

  /** Ensure llama-server runtime is present on system/app data dir, downloading automatically if missing. */
  async ensureRuntime(): Promise<string> {
    return await invoke<string>("llm_ensure_runtime");
  }

  /** Load model into the llama-server process. Must be downloaded first. */
  async loadModel(modelId: string): Promise<void> {
    await invoke("llm_load_model", { modelId });
  }

  private lastUnloadedAt: number = 0;

  /** Get the timestamp (ms) when the model was last unloaded */
  getLastUnloadedAt(): number {
    return this.lastUnloadedAt;
  }

  /** Stop the running model server and free memory. */
  async unloadModel(): Promise<void> {
    await invoke("llm_unload_model");
    this.lastUnloadedAt = Date.now();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("kognote-local-ai-unloaded"));
    }
  }

  /** Get the currently loaded model ID (or null if server is stopped/unhealthy). */
  async currentModel(): Promise<string | null> {
    try {
      const isHealthy = await invoke<boolean>("llm_check_connection").catch(() => false);
      if (!isHealthy) return null;
      return await invoke<string | null>("llm_current_model");
    } catch {
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Connection checks
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * For local: checks if the current model is downloaded AND loaded.
   * For API: pings the endpoint with the stored or override API key and returns detailed diagnostic status.
   */
  async checkConnection(
    overrideProvider?: string,
    overrideApiKey?: string,
    overrideApiUrl?: string,
    overrideApiModel?: string
  ): Promise<{ ok: boolean; message: string }> {
    const provider = overrideProvider || this.settings.provider;
    const rawKey = overrideApiKey !== undefined ? overrideApiKey : this.settings.apiKey;
    const apiKey = (rawKey || "").trim();
    const apiUrl = (overrideApiUrl || this.settings.apiUrl || "https://api.openai.com/v1").trim();
    const apiModel = overrideApiModel || this.settings.apiModel;

    if (provider === "local") {
      try {
        const current = await this.currentModel();
        if (current === this.settings.localModel) {
          return { ok: true, message: `Local model active (${current})` };
        }
        return { ok: false, message: "Local AI server ready (click Boot Model to load)" };
      } catch (err: any) {
        return { ok: false, message: err?.message || "Local server connection failed" };
      }
    }

    if (provider === "custom_local") {
      const localUrl = (overrideApiUrl || this.settings.customLocalUrl || "http://localhost:11434/v1").trim().replace(/\/+$/, "");
      const targetModel = overrideApiModel || this.settings.customLocalModel || "qwen2.5-coder";
      try {
        const available = await this.fetchExternalLocalModels(localUrl);
        if (available.length > 0) {
          return { ok: true, message: `Connected to external local server! Detected ${available.length} model(s): ${available.slice(0, 3).join(", ")}` };
        }
        // Fallback test endpoint
        const testRes = await fetch(`${localUrl}/models`, { method: "GET" }).catch(() => null);
        if (testRes && testRes.ok) {
          return { ok: true, message: `Connected successfully to local server (${targetModel})` };
        }
        return { ok: false, message: `Connection refused at ${localUrl}. Ensure Ollama, LM Studio, or LocalAI is running.` };
      } catch (err: any) {
        return { ok: false, message: err?.message || `Failed to connect to local server at ${localUrl}` };
      }
    }

    if (!apiKey) {
      return { ok: false, message: "API key is empty. Please enter your API key." };
    }

    if (provider === "anthropic") {
      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: apiModel || "claude-3-5-sonnet-latest",
            max_tokens: 1,
            messages: [{ role: "user", content: "Hi" }],
          }),
        });
        if (res.ok) {
          return { ok: true, message: `Connected successfully to Anthropic (${apiModel || "Claude 3.5"})` };
        }
        const errJson = await res.json().catch(() => ({}));
        return { ok: false, message: errJson?.error?.message || `Anthropic returned HTTP ${res.status}` };
      } catch (err: any) {
        return { ok: false, message: err?.message || "Network error connecting to Anthropic" };
      }
    }

    if (provider === "gemini") {
      try {
        const cleanModel = (apiModel || "gemini-1.5-flash").replace(/^models\//i, "");
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (res.ok) {
          return { ok: true, message: `Connected successfully to Google Gemini (${cleanModel})` };
        }
        const errJson = await res.json().catch(() => ({}));
        return { ok: false, message: errJson?.error?.message || `Google Gemini returned HTTP ${res.status}` };
      } catch (err: any) {
        return { ok: false, message: err?.message || "Network error connecting to Google Gemini" };
      }
    }

    // OpenAI / Custom API / OpenRouter / Groq
    try {
      const res = await fetch(`${apiUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.ok) {
        return { ok: true, message: `Connected successfully (${apiModel || "OpenAI-compatible"})` };
      }
      const errJson = await res.json().catch(() => ({}));
      return { ok: false, message: errJson?.error?.message || `API endpoint returned HTTP ${res.status}` };
    } catch (err: any) {
      return { ok: false, message: err?.message || "Network error connecting to API endpoint" };
    }
  }

  /**
   * Convenience shim used by the Settings panel — maps old Ollama-style
   * `isModelInstalled` to the new download check.
   */
  async isModelInstalled(modelId: string): Promise<boolean> {
    if (this.settings.provider !== "local") return true;
    return this.isModelDownloaded(modelId);
  }

  /**
   * Convenience shim for the old Settings panel download button.
   * Downloads, then loads the model into the server.
   */
  async installModel(modelId: string, onProgress?: (percent: number) => void): Promise<boolean> {
    const ok = await this.downloadModel(modelId, (p) => {
      onProgress?.(p.percent);
    });
    if (!ok) return false;
    await this.loadModel(modelId);
    return true;
  }

  /** Fetch models available on an external local server (Ollama, LM Studio, LocalAI, etc.) */
  async fetchExternalLocalModels(customUrl?: string): Promise<string[]> {
    const baseUrl = (customUrl || this.settings.customLocalUrl || "http://localhost:11434/v1").trim().replace(/\/+$/, "");
    
    // 1. Try OpenAI-compatible /v1/models
    try {
      const res = await fetch(`${baseUrl}/models`, { method: "GET" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.data)) {
          return data.data.map((m: any) => m.id || m.name).filter(Boolean);
        }
      }
    } catch {}

    // 2. Try Ollama-native /api/tags
    try {
      const ollamaRoot = baseUrl.replace(/\/v1\/?$/, "");
      const res = await fetch(`${ollamaRoot}/api/tags`, { method: "GET" });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.models)) {
          return data.models.map((m: any) => m.name || m.model).filter(Boolean);
        }
      }
    } catch {}

    return [];
  }

  /** Fetch available models from a remote OpenAI-compatible API endpoint (OpenRouter, Groq, DeepSeek, etc.) */
  async fetchCustomApiModels(apiUrl?: string, apiKey?: string): Promise<string[]> {
    const url = (apiUrl || this.settings.apiUrl || "https://api.openai.com/v1").trim().replace(/\/+$/, "");
    const key = (apiKey !== undefined ? apiKey : this.settings.apiKey || "").trim();

    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (key) headers["Authorization"] = `Bearer ${key}`;
      const res = await fetch(`${url}/models`, { method: "GET", headers });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data?.data)) {
          return data.data.map((m: any) => m.id).filter(Boolean);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch models from custom API:", e);
    }
    return [];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Core text generation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Streams generation from the active provider.
   */
  async generateStream(
    prompt: string,
    onToken: (token: string) => void,
    systemPrompt?: string,
    options?: { imageBase64?: string; imageMimeType?: string; temperature?: number; tools?: any; abortSignal?: AbortSignal }
  ): Promise<string> {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
    }

    const cleanApiKey = (this.settings.apiKey || "").trim();

    if (this.settings.provider === "gemini") {
      if (!cleanApiKey) throw new Error("Gemini API key is missing. Configure it in Settings.");
      const model = (this.settings.apiModel || "gemini-1.5-flash").replace(/^models\//i, "");
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${cleanApiKey}`;
      const parts: any[] = [{ text: prompt }];
      if (options?.imageBase64) {
        parts.unshift({ inlineData: { mimeType: options.imageMimeType || "image/jpeg", data: options.imageBase64 } });
      }
      const body: any = { contents: [{ parts }], generationConfig: { temperature: 0.3 } };
      if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };

      return streamFetchSSE(url, { "Content-Type": "application/json" }, body, onToken, (data) => {
        return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
      }, options?.abortSignal);
    }

    if (this.settings.provider === "anthropic") {
      if (!cleanApiKey) throw new Error("Anthropic API key is missing. Configure it in Settings.");
      let userContent: any = prompt;
      if (options?.imageBase64) {
        userContent = [
          { type: "image", source: { type: "base64", media_type: options.imageMimeType || "image/jpeg", data: options.imageBase64 } },
          { type: "text", text: prompt }
        ];
      }
      const body = {
        model: this.settings.apiModel || "claude-3-5-sonnet-latest",
        max_tokens: 2048,
        messages: [{ role: "user", content: userContent }],
        system: systemPrompt ?? undefined,
        temperature: 0.3,
        stream: true,
      };
      return streamFetchSSE(
        "https://api.anthropic.com/v1/messages",
        {
          "content-type": "application/json",
          "x-api-key": cleanApiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body,
        onToken,
        (data) => data.delta?.text ?? null,
        options?.abortSignal
      );
    }

    if (this.settings.provider === "custom_local") {
      const baseUrl = (this.settings.customLocalUrl || "http://localhost:11434/v1").trim().replace(/\/+$/, "");
      const messages: { role: string; content: any }[] = [];
      if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
      let userContent: any = prompt;
      if (options?.imageBase64) {
        userContent = [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${options.imageMimeType || "image/jpeg"};base64,${options.imageBase64}` } }
        ];
      }
      messages.push({ role: "user", content: userContent });

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (cleanApiKey) headers["Authorization"] = `Bearer ${cleanApiKey}`;

      const url = `${baseUrl}/chat/completions`;
      return streamFetchSSE(
        url,
        headers,
        {
          model: this.settings.customLocalModel || "qwen2.5-coder",
          messages,
          temperature: options?.temperature ?? 0.3,
          stream: true,
        },
        onToken,
        (data) => data.choices?.[0]?.delta?.content ?? null,
        options?.abortSignal
      );
    }

    if (this.settings.provider !== "local") {
      if (!cleanApiKey) throw new Error("API key is missing. Configure it in Settings.");
      const messages: { role: string; content: any }[] = [];
      if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
      let userContent: any = prompt;
      if (options?.imageBase64) {
        userContent = [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${options.imageMimeType || "image/jpeg"};base64,${options.imageBase64}` } }
        ];
      }
      messages.push({ role: "user", content: userContent });

      const url = `${this.settings.apiUrl || "https://api.openai.com/v1"}/chat/completions`;
      return streamFetchSSE(
        url,
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cleanApiKey}`,
        },
        {
          model: this.settings.apiModel || "gpt-4o-mini",
          messages,
          temperature: 0.3,
          stream: true,
        },
        onToken,
        (data) => data.choices?.[0]?.delta?.content ?? null,
        options?.abortSignal
      );
    }

    this.isGenerating = true;
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
    }

    try {
      const current = await this.currentModel();
      if (current !== this.settings.localModel) {
        const downloaded = await this.isModelDownloaded(this.settings.localModel);
        if (!downloaded) {
          throw new Error(
            `Model "${this.settings.localModel}" is not downloaded yet. ` +
            `Go to Settings to download it.`
          );
        }
        await this.loadModel(this.settings.localModel);
      }

      let accumulated = "";

      const unlistenToken = await listen<string>("llm_stream_token", (event) => {
        accumulated += event.payload;
        onToken(event.payload);
      });

      let resolveDone: () => void;
      const donePromise = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });

      const unlistenDone = await listen<void>("llm_stream_done", () => {
        resolveDone();
      });

      const onAbort = () => {
        resolveDone();
      };

      if (options?.abortSignal) {
        if (options.abortSignal.aborted) {
          unlistenToken();
          unlistenDone();
          return "";
        }
        options.abortSignal.addEventListener("abort", onAbort);
      }

      try {
        await invoke("llm_generate_stream", {
          prompt,
          systemPrompt: systemPrompt ?? null,
          temperature: options?.temperature ?? null,
          tools: options?.tools ?? null,
        });
        await donePromise;
      } finally {
        if (options?.abortSignal) {
          options.abortSignal.removeEventListener("abort", onAbort);
        }
        unlistenToken();
        unlistenDone();
      }

      return accumulated;
    } finally {
      this.isGenerating = false;
      this.scheduleInactivityUnload();
    }
  }

  async generateText(
    prompt: string,
    systemPrompt?: string,
    options?: { imageBase64?: string; imageMimeType?: string; temperature?: number; tools?: any }
  ): Promise<string> {
    this.isGenerating = true;
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
    }

    try {
      if (this.settings.provider === "local") {
        // Ensure the correct model is loaded
        const current = await this.currentModel();
        if (current !== this.settings.localModel) {
          const downloaded = await this.isModelDownloaded(this.settings.localModel);
          if (!downloaded) {
            throw new Error(
              `Model "${this.settings.localModel}" is not downloaded yet. ` +
              `Go to Settings to download it.`
            );
          }
          await this.loadModel(this.settings.localModel);
        }

        const result = await invoke<string>("llm_generate", {
          prompt,
          systemPrompt: systemPrompt ?? null,
          temperature: options?.temperature ?? null,
          tools: options?.tools ?? null,
        });

        return result;
      } else if (this.settings.provider === "anthropic") {
        if (!this.settings.apiKey) {
          throw new Error("Anthropic API key is missing. Configure it in Settings.");
        }
        let userContent: any = prompt;
        if (options?.imageBase64) {
          userContent = [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: options.imageMimeType || "image/jpeg",
                data: options.imageBase64,
              },
            },
            { type: "text", text: prompt },
          ];
        }

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": this.settings.apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
          },
          body: JSON.stringify({
            model: this.settings.apiModel || "claude-3-5-sonnet-latest",
            max_tokens: 2048,
            messages: [{ role: "user", content: userContent }],
            system: systemPrompt ?? undefined,
            temperature: 0.3,
          }),
        });
        if (!res.ok) {
          throw new Error(`Claude API error ${res.status}: ${await res.text()}`);
        }
        const data = await res.json();
        return data.content?.[0]?.text ?? "";
      } else if (this.settings.provider === "gemini") {
        if (!this.settings.apiKey) {
          throw new Error("Gemini API key is missing. Configure it in Settings.");
        }
        const model = this.settings.apiModel || "gemini-1.5-flash";
        const cleanModel = model.replace(/^models\//i, "");
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${this.settings.apiKey}`;

        const parts: any[] = [{ text: prompt }];
        if (options?.imageBase64) {
          parts.unshift({
            inlineData: {
              mimeType: options.imageMimeType || "image/jpeg",
              data: options.imageBase64,
            },
          });
        }

        const body: any = {
          contents: [{ parts }],
          generationConfig: { temperature: 0.3 }
        };

        if (systemPrompt) {
          body.systemInstruction = { parts: [{ text: systemPrompt }] };
        }

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
        }
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      } else {
        // OpenAI / Custom Endpoint
        if (!this.settings.apiKey) {
          throw new Error("API key is missing. Configure it in Settings.");
        }
        const messages: { role: string; content: any }[] = [];
        if (systemPrompt) {
          messages.push({ role: "system", content: systemPrompt });
        }

        let userContent: any = prompt;
        if (options?.imageBase64) {
          userContent = [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:${options.imageMimeType || "image/jpeg"};base64,${options.imageBase64}`,
              },
            },
          ];
        }

        messages.push({ role: "user", content: userContent });

        const res = await fetch(`${this.settings.apiUrl || "https://api.openai.com/v1"}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.settings.apiKey}`,
          },
          body: JSON.stringify({
            model: this.settings.apiModel || "gpt-4o-mini",
            messages,
            temperature: 0.3,
          }),
        });

        if (!res.ok) {
          throw new Error(`API error ${res.status}: ${await res.text()}`);
        }
        const data = await res.json();
        return data.choices?.[0]?.message?.content ?? "";
      }
    } finally {
      this.isGenerating = false;
      this.scheduleInactivityUnload();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // High-level AI tasks
  // ─────────────────────────────────────────────────────────────────────────

  /** Reformat a messy Markdown note with proper structure and grammar, preserving metadata, dates, tasks, and flashcards. */
  async smartFormatMarkdown(content: string): Promise<string> {
    if (!content) return "";

    // 1. Separate YAML Frontmatter metadata completely untouched
    let frontmatter = "";
    let bodyContent = content;

    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fmMatch) {
      frontmatter = fmMatch[0];
      bodyContent = content.substring(frontmatter.length);
    }

    // 2. Generate polished body from LLM
    const polishedBody = await this.generateText(
      bodyContent,
      "You are a professional Markdown note formatting & polish assistant.\n" +
        "Re-format the note body to be beautifully structured, clean, and highly readable.\n\n" +
        "CRITICAL MANDATORY RULES:\n" +
        "1. NEVER modify, remove, or change any dates (e.g. @2026-07-29, 2026-07-29), numbers, or factual data.\n" +
        "2. PRESERVE all task syntax (- [ ] or - [x]), task priorities (!, !!, !!!), task due dates (@YYYY-MM-DD), and tags (#tag).\n" +
        "3. Standardize any unformatted task lines (e.g. '- buy groceries @2026-08-01 !!!') into valid task syntax (- [ ] buy groceries @2026-08-01 !!!).\n" +
        "4. PRESERVE flashcards ('Question :: Answer'). Keep the double-colon '::' intact.\n" +
        "5. PRESERVE WikiLinks formatted as [[Note Name]] or [[Note Name|Alias]]. Keep double brackets intact.\n" +
        "6. DO NOT modify code blocks (```...```), inline code (`...`), or math formulas ($...$).\n" +
        "7. DO NOT generate or alter any YAML frontmatter (between --- and ---).\n\n" +
        "Output ONLY the polished body markdown content, without explanations or enclosing backticks."
    );

    // 3. Re-attach original YAML Frontmatter untouched
    return frontmatter ? `${frontmatter}\n${polishedBody.trimStart()}` : polishedBody;
  }

  /** Convenience alias for formatting markdown */
  async formatMarkdown(content: string): Promise<string> {
    return this.smartFormatMarkdown(content);
  }

  /** Rewrite text selection for clarity, flow, and polish. */
  async rewriteText(text: string): Promise<string> {
    return this.generateText(
      `Rewrite and improve the following text:\n\n${text}`,
      "You are an expert editor. Rewrite the text for maximum clarity, tone, and readability. Keep the core meaning. Output ONLY the rewritten text without markdown code block fences or explanations."
    );
  }

  /** Explain a concept in simple terms. */
  async explainConcept(text: string): Promise<string> {
    return this.generateText(
      `Explain the following concept or text clearly:\n\n${text}`,
      "You are a clear and concise teacher. Explain the text in simple, intuitive terms. Output ONLY the clear explanation."
    );
  }

  /** Summarize text into bullet points. */
  async summarizeNote(text: string): Promise<string> {
    return this.generateText(
      `Summarize the key points of the following text:\n\n${text}`,
      "You are a note summarizer. Provide a concise bullet point summary of the text. Output ONLY markdown bullet points."
    );
  }

  /** Expand text selection with more depth, context, and detail. */
  async expandText(text: string): Promise<string> {
    return this.generateText(
      `Expand and elaborate on the following text with rich detail and context:\n\n${text}`,
      "You are an expert technical writer. Expand the text cleanly with deeper context and examples while maintaining accuracy. Output ONLY the expanded markdown text."
    );
  }

  /** Shorten and condense text selection. */
  async shortenText(text: string): Promise<string> {
    return this.generateText(
      `Shorten and condense the following text while preserving essential information:\n\n${text}`,
      "You are a concise editor. Reduce the length of the text while retaining all critical facts. Output ONLY the condensed markdown text."
    );
  }

  /** Convert text selection into spaced-repetition flashcards. */
  async makeFlashcards(text: string): Promise<string> {
    return this.generateText(
      `Create spaced-repetition flashcards from the following text:\n\n${text}`,
      "You are a study assistant. Generate spaced repetition flashcards in the format:\n@flashcard (Question :: Answer)\nCreate 2-4 high quality cards. Output ONLY the flashcard lines."
    );
  }

  /** Extract actionable tasks from text selection. */
  async extractTasks(text: string): Promise<string> {
    return this.generateText(
      `Extract all actionable tasks and to-dos from the following text:\n\n${text}`,
      "You are a productivity assistant. Extract actionable to-dos as markdown task checkboxes (- [ ] Task description). Output ONLY the task list."
    );
  }

  /** Rewrite text in a specific tone. */
  async changeTone(text: string, tone: string): Promise<string> {
    return this.generateText(
      `Rewrite the following text in a ${tone} tone:\n\n${text}`,
      `You are an expert communicator. Rewrite the text using a ${tone} tone. Keep the core meaning intact. Output ONLY the rewritten markdown text.`
    );
  }

  /** General chat / transformation on text. */
  async chat(prompt: string, context?: string): Promise<string> {
    const fullPrompt = context ? `Context:\n${context}\n\nTask: ${prompt}` : prompt;
    return this.generateText(
      fullPrompt,
      "You are Kognote AI assistant. Provide helpful, accurate responses. Output clean markdown."
    );
  }

  /** Convert a raw voice transcript into a polished Markdown note. */
  async processVoiceTranscript(transcript: string): Promise<string> {
    return this.generateText(
      transcript,
      "You are an expert note-taking assistant. The user will provide a raw voice transcript. " +
        "Analyze it, correct grammatical/transcription issues, extract the main takeaways, " +
        "and format it as a polished Markdown note with clear titles, headings, and key points. " +
        "Output ONLY the final markdown content, without any extra text or conversation."
    );
  }

  /** Suggest wiki-links for the active note based on semantic similarities. */
  async suggestLinks(content: string, relatedNotes: string[]): Promise<{ originalText: string; linkTarget: string }[]> {
    if (relatedNotes.length === 0) return [];
    const candidateNotes = relatedNotes.slice(0, 20);
    
    const prompt = 
      `Current Note Content:\n"""\n${content.slice(0, 4000)}\n"""\n\n` +
      `Here is a list of existing related notes in the vault:\n${candidateNotes.map(n => `- ${n}`).join("\n")}\n\n` +
      `Identify exact phrases or words in the current note content that refer to or match these related notes. ` +
      `Suggest wiki-links by replacing those phrases. For example, if the current note has the text "spaced repetition" and there is a related note named "Spaced Repetition", suggest replacing "spaced repetition" with "[[Spaced Repetition]]".\n\n` +
      `Format your output as a strict JSON array of objects, each containing:\n` +
      `- \"originalText\": the exact substring from the current note content to be replaced (case-sensitive).\n` +
      `- \"linkTarget\": the exact title of the target note from the related list (e.g. \"Spaced Repetition\").\n\n` +
      `CRITICAL:\n` +
      `1. Only return the JSON block, nothing else. No markdown wrapping or explanation.\n` +
      `2. Ensure the \"originalText\" matches the note content EXACTLY (character-for-character).\n` +
      `3. Do not suggest linking terms that are already linked in the text (e.g. already surrounded by [[ ]]).\n` +
      `4. If no suggestions are found, return an empty array [].`;

    try {
      const response = await this.generateText(prompt, "You are a precise link suggestion assistant. Output only JSON.");
      const cleanJson = response.replace(/```json/g, "").replace(/```/g, "").trim();
      return JSON.parse(cleanJson) || [];
    } catch (e) {
      console.warn("Failed to parse link suggestions JSON:", e);
      return [];
    }
  }
}

export const aiService = new AIService();

