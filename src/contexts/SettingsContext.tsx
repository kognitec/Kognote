import React, { createContext, useContext, useState, useEffect } from "react";
import { LazyStore } from "@tauri-apps/plugin-store";
import { aiService } from "../lib/local-ai";
import { getSecret, setSecret, deleteSecret } from "../lib/stronghold";

// Use LazyStore for safe asynchronous initialization in Tauri 2.0
const store = new LazyStore(".settings.json");

interface SettingsContextType {
  vaultPath: string | null;
  aiProvider: "local" | "anthropic" | "gemini" | "openai" | "api";
  aiLocalModel: string;
  aiApiUrl: string;
  aiApiKey: string;
  aiApiModel: string;
  includeArchivedInScans: boolean;
  includeTrashInScans: boolean;
  setVaultPath: (path: string | null) => Promise<void>;
  setAiProvider: (provider: "local" | "anthropic" | "gemini" | "openai" | "api") => Promise<void>;
  setAiLocalModel: (model: string) => Promise<void>;
  setAiApiUrl: (url: string) => Promise<void>;
  setAiApiKey: (key: string) => Promise<void>;
  setAiApiModel: (model: string) => Promise<void>;
  setIncludeArchivedInScans: (enabled: boolean) => Promise<void>;
  setIncludeTrashInScans: (enabled: boolean) => Promise<void>;
  loading: boolean;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [vaultPath, _setVaultPathState] = useState<string | null>(null);
  const [aiProvider, _setAiProviderState] = useState<"local" | "anthropic" | "gemini" | "openai" | "api">("local");
  const [aiLocalModel, _setAiLocalModelState] = useState<string>("llama3.2-3b");
  const [aiApiUrl, _setAiApiUrlState] = useState<string>("https://api.openai.com/v1");
  const [aiApiKey, _setAiApiKeyState] = useState<string>("");
  const [aiApiModel, _setAiApiModelState] = useState<string>("gpt-4o-mini");
  const [includeArchivedInScans, _setIncludeArchivedInScansState] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // Force dark mode permanently on mount
  useEffect(() => {
    window.document.documentElement.classList.add("dark");
  }, []);

  // Load settings on startup
  useEffect(() => {
    async function loadSettings() {
      try {
        const [
          savedVault,
          savedAiProvider,
          savedAiLocalModel,
          savedAiApiUrl,
          savedAiApiModel,
          savedIncludeArchived,
        ] = await Promise.all([
          store.get<string>("vaultPath"),
          store.get<"local" | "anthropic" | "gemini" | "openai" | "api">("aiProvider"),
          store.get<"llama3.2" | "qwen3:8b">("aiLocalModel"),
          store.get<string>("aiApiUrl"),
          store.get<string>("aiApiModel"),
          store.get<boolean>("includeArchivedInScans"),
        ]);

        if (savedVault) _setVaultPathState(savedVault);
        if (savedAiProvider) _setAiProviderState(savedAiProvider);
        if (savedAiLocalModel) _setAiLocalModelState(savedAiLocalModel);
        if (savedAiApiUrl) _setAiApiUrlState(savedAiApiUrl);
        if (savedAiApiModel) _setAiApiModelState(savedAiApiModel);

        if (savedIncludeArchived !== null && savedIncludeArchived !== undefined) {
          _setIncludeArchivedInScansState(savedIncludeArchived);
        }
      } catch (err) {
        console.error("Failed to load settings from store:", err);
      } finally {
        // Unblock main UI immediately so splash screen vanishes instantly
        setLoading(false);
      }

      // Load encrypted Stronghold secret asynchronously in background without blocking UI startup
      getSecret("aiApiKey").then((secureApiKey) => {
        if (secureApiKey) _setAiApiKeyState(secureApiKey);
      }).catch((err) => {
        console.warn("Non-critical stronghold key load warning:", err);
      });
    }
    loadSettings();
  }, []);

  // Sync settings with the AI Service singleton
  useEffect(() => {
    aiService.updateSettings({
      provider: aiProvider,
      localModel: aiLocalModel,
      apiUrl: aiApiUrl,
      apiKey: aiApiKey,
      apiModel: aiApiModel,
    });
  }, [aiProvider, aiLocalModel, aiApiUrl, aiApiKey, aiApiModel]);

  const setVaultPath = async (path: string | null) => {
    _setVaultPathState(path);
    if (path) {
      await store.set("vaultPath", path);
    } else {
      await store.delete("vaultPath");
    }
    await store.save();
  };

  const setAiProvider = async (val: "local" | "anthropic" | "gemini" | "openai" | "api") => {
    _setAiProviderState(val);
    await store.set("aiProvider", val);
    await store.save();
  };

  const setAiLocalModel = async (val: string) => {
    _setAiLocalModelState(val);
    await store.set("aiLocalModel", val);
    await store.save();
  };

  const setAiApiUrl = async (val: string) => {
    _setAiApiUrlState(val);
    await store.set("aiApiUrl", val);
    await store.save();
  };

  const setAiApiKey = async (val: string) => {
    _setAiApiKeyState(val);
    if (val) {
      await setSecret("aiApiKey", val);
    } else {
      await deleteSecret("aiApiKey");
    }
  };

  const setAiApiModel = async (val: string) => {
    _setAiApiModelState(val);
    await store.set("aiApiModel", val);
    await store.save();
  };

  const setIncludeArchivedInScans = async (enabled: boolean) => {
    _setIncludeArchivedInScansState(enabled);
    await store.set("includeArchivedInScans", enabled);
    await store.save();
  };

  const setIncludeTrashInScans = async (_enabled: boolean) => {
    // Unconditionally false (trash files are always excluded)
  };

  return (
    <SettingsContext.Provider
      value={{
        vaultPath,
        aiProvider,
        aiLocalModel,
        aiApiUrl,
        aiApiKey,
        aiApiModel,
        includeArchivedInScans,
        includeTrashInScans: false,
        setVaultPath,
        setAiProvider,
        setAiLocalModel,
        setAiApiUrl,
        setAiApiKey,
        setAiApiModel,
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
