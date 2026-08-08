import React, { createContext, useContext, useState, useEffect } from "react";
import { LazyStore } from "@tauri-apps/plugin-store";
import { aiService } from "../lib/local-ai";
import { getSecret, setSecret, deleteSecret } from "../lib/stronghold";

// Use LazyStore for safe asynchronous initialization in Tauri 2.0
export const store = new LazyStore(".settings.json");

interface SettingsContextType {
  vaultPath: string | null;
  aiProvider: "local" | "custom_local" | "anthropic" | "gemini" | "openai" | "api";
  aiLocalModel: string;
  customLocalUrl: string;
  customLocalModel: string;
  aiApiUrl: string;
  aiApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  geminiApiKey: string;
  customApiKey: string;
  aiApiModel: string;
  aiInactivityTimeoutSeconds: number;
  userTimezone: string;
  includeArchivedInScans: boolean;
  includeTrashInScans: boolean;
  setVaultPath: (path: string | null) => Promise<void>;
  setAiProvider: (provider: "local" | "custom_local" | "anthropic" | "gemini" | "openai" | "api") => Promise<void>;
  setAiLocalModel: (model: string) => Promise<void>;
  setCustomLocalUrl: (url: string) => Promise<void>;
  setCustomLocalModel: (model: string) => Promise<void>;
  setAiApiUrl: (url: string) => Promise<void>;
  setAiApiKey: (key: string) => Promise<void>;
  setOpenaiApiKey: (key: string) => Promise<void>;
  setAnthropicApiKey: (key: string) => Promise<void>;
  setGeminiApiKey: (key: string) => Promise<void>;
  setCustomApiKey: (key: string) => Promise<void>;
  setAiApiModel: (model: string) => Promise<void>;
  setAiInactivityTimeoutSeconds: (sec: number) => Promise<void>;
  setUserTimezone: (tz: string) => Promise<void>;
  setIncludeArchivedInScans: (enabled: boolean) => Promise<void>;
  setIncludeTrashInScans: (enabled: boolean) => Promise<void>;
  loading: boolean;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [vaultPath, _setVaultPathState] = useState<string | null>(null);
  const [aiProvider, _setAiProviderState] = useState<"local" | "custom_local" | "anthropic" | "gemini" | "openai" | "api">("local");
  const [aiLocalModel, _setAiLocalModelState] = useState<string>("qwen2.5-coder-3b");
  const [customLocalUrl, _setCustomLocalUrlState] = useState<string>("http://localhost:11434/v1");
  const [customLocalModel, _setCustomLocalModelState] = useState<string>("qwen2.5-coder");
  const [aiApiUrl, _setAiApiUrlState] = useState<string>("https://api.openai.com/v1");
  const [openaiApiKey, _setOpenaiApiKeyState] = useState<string>("");
  const [anthropicApiKey, _setAnthropicApiKeyState] = useState<string>("");
  const [geminiApiKey, _setGeminiApiKeyState] = useState<string>("");
  const [customApiKey, _setCustomApiKeyState] = useState<string>("");
  const [aiApiModel, _setAiApiModelState] = useState<string>("gpt-4o-mini");
  const [aiInactivityTimeoutSeconds, _setAiInactivityTimeoutSecondsState] = useState<number>(300);
  const [userTimezone, _setUserTimezoneState] = useState<string>("auto");
  const [includeArchivedInScans, _setIncludeArchivedInScansState] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // Compute active API key based on selected provider
  const aiApiKey =
    aiProvider === "anthropic"
      ? anthropicApiKey
      : aiProvider === "gemini"
      ? geminiApiKey
      : aiProvider === "openai"
      ? openaiApiKey
      : aiProvider === "api"
      ? customApiKey
      : "";

  // Load settings on startup
  useEffect(() => {
    async function loadSettings() {
      try {
        const [
          savedVault,
          savedAiProvider,
          savedAiLocalModel,
          savedCustomLocalUrl,
          savedCustomLocalModel,
          savedAiApiUrl,
          savedAiApiModel,
          savedInactivityTimeout,
          savedTimezone,
          savedIncludeArchived,
        ] = await Promise.all([
          store.get<string>("vaultPath"),
          store.get<"local" | "custom_local" | "anthropic" | "gemini" | "openai" | "api">("aiProvider"),
          store.get<string>("aiLocalModel"),
          store.get<string>("customLocalUrl"),
          store.get<string>("customLocalModel"),
          store.get<string>("aiApiUrl"),
          store.get<string>("aiApiModel"),
          store.get<number>("aiInactivityTimeoutSeconds"),
          store.get<string>("userTimezone"),
          store.get<boolean>("includeArchivedInScans"),
        ]);

        if (savedVault) _setVaultPathState(savedVault);
        if (savedAiProvider) _setAiProviderState(savedAiProvider);
        if (savedAiLocalModel) _setAiLocalModelState(savedAiLocalModel);
        if (savedCustomLocalUrl) _setCustomLocalUrlState(savedCustomLocalUrl);
        if (savedCustomLocalModel) _setCustomLocalModelState(savedCustomLocalModel);
        if (savedAiApiUrl) _setAiApiUrlState(savedAiApiUrl);
        if (savedAiApiModel) _setAiApiModelState(savedAiApiModel);

        if (savedInactivityTimeout !== null && savedInactivityTimeout !== undefined) {
          const clamped = Math.min(300, Math.max(30, savedInactivityTimeout));
          _setAiInactivityTimeoutSecondsState(clamped);
        } else {
          // Auto-detect based on hardware RAM (30s for <12GB RAM, 300s for 12GB+ RAM)
          const autoTimeout = await aiService.autoDetectDefaultTimeout();
          const clamped = Math.min(300, Math.max(30, autoTimeout));
          _setAiInactivityTimeoutSecondsState(clamped);
        }

        if (savedTimezone) _setUserTimezoneState(savedTimezone);

        if (savedIncludeArchived !== null && savedIncludeArchived !== undefined) {
          _setIncludeArchivedInScansState(savedIncludeArchived);
        }
      } catch (err) {
        console.error("Failed to load settings from store:", err);
      } finally {
        setLoading(false);
      }

      // Load encrypted Stronghold secrets asynchronously
      try {
        const [oKey, aKey, gKey, cKey] = await Promise.all([
          getSecret("openaiApiKey").catch(() => null),
          getSecret("anthropicApiKey").catch(() => null),
          getSecret("geminiApiKey").catch(() => null),
          getSecret("customApiKey").catch(() => null),
        ]);

        if (oKey) _setOpenaiApiKeyState(oKey);
        if (aKey) _setAnthropicApiKeyState(aKey);
        if (gKey) _setGeminiApiKeyState(gKey);
        if (cKey) _setCustomApiKeyState(cKey);
      } catch (err) {
        console.warn("Non-critical stronghold key load warning:", err);
      }
    }
    loadSettings();
  }, []);

  // Sync settings with the AI Service singleton
  useEffect(() => {
    aiService.updateSettings({
      provider: aiProvider,
      localModel: aiLocalModel,
      customLocalUrl: customLocalUrl,
      customLocalModel: customLocalModel,
      apiUrl: aiApiUrl,
      apiKey: aiApiKey,
      apiModel: aiApiModel,
      inactivityTimeoutSeconds: aiInactivityTimeoutSeconds,
    });
  }, [aiProvider, aiLocalModel, customLocalUrl, customLocalModel, aiApiUrl, aiApiKey, aiApiModel, aiInactivityTimeoutSeconds]);

  const setVaultPath = async (path: string | null) => {
    _setVaultPathState(path);
    if (path) {
      await store.set("vaultPath", path);
    } else {
      await store.delete("vaultPath");
    }
    await store.save();
  };

  const setAiProvider = async (val: "local" | "custom_local" | "anthropic" | "gemini" | "openai" | "api") => {
    _setAiProviderState(val);
    await store.set("aiProvider", val);
    await store.save();
  };

  const setAiLocalModel = async (val: string) => {
    _setAiLocalModelState(val);
    await store.set("aiLocalModel", val);
    await store.save();
  };

  const setCustomLocalUrl = async (val: string) => {
    _setCustomLocalUrlState(val);
    await store.set("customLocalUrl", val);
    await store.save();
  };

  const setCustomLocalModel = async (val: string) => {
    _setCustomLocalModelState(val);
    await store.set("customLocalModel", val);
    await store.save();
  };

  const setAiApiUrl = async (val: string) => {
    _setAiApiUrlState(val);
    await store.set("aiApiUrl", val);
    await store.save();
  };

  const setOpenaiApiKey = async (val: string) => {
    _setOpenaiApiKeyState(val);
    if (val) await setSecret("openaiApiKey", val);
    else await deleteSecret("openaiApiKey");
  };

  const setAnthropicApiKey = async (val: string) => {
    _setAnthropicApiKeyState(val);
    if (val) await setSecret("anthropicApiKey", val);
    else await deleteSecret("anthropicApiKey");
  };

  const setGeminiApiKey = async (val: string) => {
    _setGeminiApiKeyState(val);
    if (val) await setSecret("geminiApiKey", val);
    else await deleteSecret("geminiApiKey");
  };

  const setCustomApiKey = async (val: string) => {
    _setCustomApiKeyState(val);
    if (val) await setSecret("customApiKey", val);
    else await deleteSecret("customApiKey");
  };

  const setAiApiKey = async (val: string) => {
    if (aiProvider === "anthropic") await setAnthropicApiKey(val);
    else if (aiProvider === "gemini") await setGeminiApiKey(val);
    else if (aiProvider === "openai") await setOpenaiApiKey(val);
    else if (aiProvider === "api") await setCustomApiKey(val);
  };

  const setAiApiModel = async (val: string) => {
    _setAiApiModelState(val);
    await store.set("aiApiModel", val);
    await store.save();
  };

  const setAiInactivityTimeoutSeconds = async (val: number) => {
    const clamped = Math.min(300, Math.max(30, val));
    _setAiInactivityTimeoutSecondsState(clamped);
    await store.set("aiInactivityTimeoutSeconds", clamped);
    await store.save();
  };

  const setUserTimezone = async (val: string) => {
    _setUserTimezoneState(val);
    try {
      localStorage.setItem("kognote-user-timezone", val);
    } catch (e) {}
    await store.set("userTimezone", val);
    await store.save();
  };

  const setIncludeArchivedInScans = async (enabled: boolean) => {
    _setIncludeArchivedInScansState(enabled);
    await store.set("includeArchivedInScans", enabled);
    await store.save();
  };

  /** Trash notes are permanently excluded from vault scans and AI context for safety & privacy */
  const setIncludeTrashInScans = async (_enabled: boolean) => {
    // Unconditionally false — trash notes are strictly isolated and never scanned
  };

  return (
    <SettingsContext.Provider
      value={{
        vaultPath,
        aiProvider,
        aiLocalModel,
        customLocalUrl,
        customLocalModel,
        aiApiUrl,
        aiApiKey,
        openaiApiKey,
        anthropicApiKey,
        geminiApiKey,
        customApiKey,
        aiApiModel,
        aiInactivityTimeoutSeconds,
        userTimezone,
        includeArchivedInScans,
        includeTrashInScans: false,
        setVaultPath,
        setAiProvider,
        setAiLocalModel,
        setCustomLocalUrl,
        setCustomLocalModel,
        setAiApiUrl,
        setAiApiKey,
        setOpenaiApiKey,
        setAnthropicApiKey,
        setGeminiApiKey,
        setCustomApiKey,
        setAiApiModel,
        setAiInactivityTimeoutSeconds,
        setUserTimezone,
        setIncludeArchivedInScans,
        setIncludeTrashInScans,
        loading,
      }}
    >
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
};
