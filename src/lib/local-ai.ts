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
  provider: "local" | "anthropic" | "gemini" | "openai" | "api";
  localModel: string;
  apiUrl: string;
  apiKey: string;
  apiModel: string;
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
  private settings: AISettings = {
    provider: "local",
    localModel: "qwen2.5-coder-3b",
    apiUrl: "https://api.openai.com/v1",
    apiKey: "",
    apiModel: "gpt-4o-mini",
  };

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

  /** Stop the running model server and free memory. */
  async unloadModel(): Promise<void> {
    await invoke("llm_unload_model");
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
   * For API: pings the endpoint with the stored API key.
   */
  async checkConnection(): Promise<boolean> {
    if (this.settings.provider === "local") {
      try {
        const current = await this.currentModel();
        return current === this.settings.localModel;
      } catch {
        return false;
      }
    } else if (this.settings.provider === "anthropic") {
      if (!this.settings.apiKey) return false;
      try {
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
            max_tokens: 1,
            messages: [{ role: "user", content: "Hello" }],
          }),
        });
        return res.ok;
      } catch {
        return false;
      }
    } else if (this.settings.provider === "gemini") {
      if (!this.settings.apiKey) return false;
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${this.settings.apiKey}`);
        return res.ok;
      } catch {
        return false;
      }
    } else {
      if (!this.settings.apiKey) return false;
      try {
        const res = await fetch(`${this.settings.apiUrl || "https://api.openai.com/v1"}/models`, {
          headers: { Authorization: `Bearer ${this.settings.apiKey}` },
        });
        return res.ok;
      } catch {
        return false;
      }
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
  async pullModel(
    modelId: string,
    onProgress: (percent: number) => void
  ): Promise<void> {
    await this.downloadModel(modelId, (evt) => onProgress(evt.percent));
    await this.loadModel(modelId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Core text generation
  // ─────────────────────────────────────────────────────────────────────────

  async generateTextStreaming(
    prompt: string,
    systemPrompt: string | undefined,
    onToken: (token: string) => void,
    options?: { imageBase64?: string; imageMimeType?: string; temperature?: number; tools?: any; abortSignal?: AbortSignal }
  ): Promise<string> {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
    }

    if (this.settings.provider === "gemini") {
      if (!this.settings.apiKey) throw new Error("Gemini API key is missing. Configure it in Settings.");
      const model = (this.settings.apiModel || "gemini-1.5-flash").replace(/^models\//i, "");
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${this.settings.apiKey}`;
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
      if (!this.settings.apiKey) throw new Error("Anthropic API key is missing. Configure it in Settings.");
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
          "x-api-key": this.settings.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body,
        onToken,
        (data) => data.delta?.text ?? null,
        options?.abortSignal
      );
    }

    if (this.settings.provider !== "local") {
      if (!this.settings.apiKey) throw new Error("API key is missing. Configure it in Settings.");
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
          Authorization: `Bearer ${this.settings.apiKey}`,
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

      if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = setTimeout(() => {
        this.unloadModel().catch(console.error);
      }, 15000);

      return accumulated;
    } catch (err: any) {
      if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = setTimeout(() => {
        this.unloadModel().catch(console.error);
      }, 15000);
      throw err;
    }
  }

  async generateText(
    prompt: string,
    systemPrompt?: string,
    options?: { imageBase64?: string; imageMimeType?: string; temperature?: number; tools?: any }
  ): Promise<string> {
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

        // Auto-unload after 15 seconds of inactivity to free system RAM
        if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
        this.inactivityTimeout = setTimeout(() => {
          this.unloadModel().catch(console.error);
        }, 15000);

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
    } catch (err: any) {
      if (this.settings.provider === "local") {
        if (this.inactivityTimeout) clearTimeout(this.inactivityTimeout);
        this.inactivityTimeout = setTimeout(() => {
          this.unloadModel().catch(console.error);
        }, 15000);
      }
      throw err;
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

