import React, { createContext, useContext, useState, useCallback, useRef } from "react";
import { aiService } from "../lib/local-ai";

export type SyncStep = {
  label: string;
  status: "pending" | "running" | "done" | "skipped" | "error";
  error?: string;
};

interface SyncContextType {
  isSyncing: boolean;
  lastSyncAt: Date | null;
  steps: SyncStep[];
  aiOff: boolean;
  /** Called by the floating button — triggers a full vault sync */
  triggerSync: () => void;
  /** Registered by individual views/components to plug into the sync pipeline */
  registerSyncHandler: (key: string, handler: () => Promise<void>, label: string, requiresAi?: boolean) => void;
  unregisterSyncHandler: (key: string) => void;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [steps, setSteps] = useState<SyncStep[]>([]);
  const [aiOff, setAiOff] = useState(false);

  // Registry of sync handlers registered by each view
  const handlersRef = useRef<Map<string, { handler: () => Promise<void>; label: string; requiresAi: boolean }>>(new Map());
  // Ref-based guard to prevent concurrent syncs — more reliable than stale state closures
  const isSyncingRef = useRef(false);

  const registerSyncHandler = useCallback(
    (key: string, handler: () => Promise<void>, label: string, requiresAi = false) => {
      handlersRef.current.set(key, { handler, label, requiresAi });
    },
    []
  );

  const unregisterSyncHandler = useCallback((key: string) => {
    handlersRef.current.delete(key);
  }, []);

  const triggerSync = useCallback(async () => {
    // Use ref for re-entry guard to avoid stale closure issues with state
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    setIsSyncing(true);
    setAiOff(false);

    // 1. Toast notification: Sync started
    window.dispatchEvent(new CustomEvent("kognote-toast", { 
      detail: { message: "Syncing vault files, tasks & views..." } 
    }));

    // 2. Check if AI is active
    let isAiConnected = false;
    try {
      isAiConnected = await aiService.checkConnection();
    } catch (e) {
      console.warn("AI connection check failed, assuming off:", e);
    }
    setAiOff(!isAiConnected);

    const handlers = Array.from(handlersRef.current.entries());
    const initialSteps: SyncStep[] = handlers.map(([, { label }]) => ({
      label,
      status: "pending",
    }));
    setSteps(initialSteps);

    let errorCount = 0;
    for (let i = 0; i < handlers.length; i++) {
      const [, { handler, label, requiresAi }] = handlers[i];

      if (requiresAi && !isAiConnected) {
        setSteps((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, status: "skipped" } : s))
        );
        continue;
      }

      setSteps((prev) =>
        prev.map((s, idx) => (idx === i ? { ...s, status: "running" } : s))
      );

      try {
        await handler();
        setSteps((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, status: "done" } : s))
        );
      } catch (err) {
        errorCount++;
        console.error(`Sync step "${label}" failed:`, err);
        setSteps((prev) =>
          prev.map((s, idx) => (idx === i ? { ...s, status: "error", error: String(err) } : s))
        );
      }
    }

    const now = new Date();
    setLastSyncAt(now);
    isSyncingRef.current = false;
    setIsSyncing(false);

    // Toast notification: Sync completed
    if (errorCount === 0) {
      window.dispatchEvent(new CustomEvent("kognote-toast", { 
        detail: { message: "Vault sync completed successfully!" } 
      }));
    } else {
      window.dispatchEvent(new CustomEvent("kognote-toast", { 
        detail: { message: `Sync completed with ${errorCount} warning(s).` } 
      }));
    }
  }, []);

  return (
    <SyncContext.Provider value={{ isSyncing, lastSyncAt, steps, aiOff, triggerSync, registerSyncHandler, unregisterSyncHandler }}>
      {children}
    </SyncContext.Provider>
  );
};

export const useSync = () => {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncProvider");
  return ctx;
};
