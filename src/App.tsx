import React, { useState, useEffect } from "react";
import { SettingsProvider, useSettings } from "./contexts/SettingsContext";
import { VaultProvider } from "./contexts/VaultContext";
import { SyncProvider } from "./contexts/SyncContext";
import { VaultPicker } from "./components/VaultPicker";
import { Layout } from "./components/Layout";
import { CheckCircle } from "lucide-react";
import logoImg from "./assets/logo.png";

/** Global lightweight toast notification powered by kognote-toast custom events */
const ToastHost: React.FC = () => {
  const [toasts, setToasts] = useState<{ id: number; message: string; isProgress?: boolean }[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ message: string }>).detail;
      if (!detail?.message) return;
      const id = Date.now();
      setToasts((prev) => [...prev, { id, message: detail.message }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3500);
    };

    const progressHandler = (e: Event) => {
      const detail = (e as CustomEvent<{ file: string; progress: number }>).detail;
      const pct = Math.round(detail.progress || 0);
      const msg = `Downloading local AI embedding model: ${pct}%`;
      setToasts((prev) => {
        const existing = prev.find((t) => t.isProgress);
        if (existing) {
          return prev.map((t) => (t.isProgress ? { ...t, message: msg } : t));
        } else {
          return [...prev, { id: 9999, message: msg, isProgress: true }];
        }
      });
    };

    const readyHandler = () => {
      const msg = "Local AI embedding model is ready!";
      setToasts((prev) => {
        const filtered = prev.filter((t) => !t.isProgress);
        if (filtered.some((t) => t.message === msg)) return filtered;
        return [...filtered, { id: Date.now(), message: msg }];
      });
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.message !== msg));
      }, 3500);
    };

    window.addEventListener("kognote-toast", handler);
    window.addEventListener("embedding-progress", progressHandler);
    window.addEventListener("embedding-ready", readyHandler);
    return () => {
      window.removeEventListener("kognote-toast", handler);
      window.removeEventListener("embedding-progress", progressHandler);
      window.removeEventListener("embedding-ready", readyHandler);
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-100 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="flex items-center gap-2 rounded-xl bg-card border border-emerald-500/30 px-4 py-3 text-xs font-semibold text-emerald-300 shadow-lg animate-fade-in backdrop-blur-sm"
        >
          <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
          {toast.message}
        </div>
      ))}
    </div>
  );
};

const MainApp: React.FC = () => {
  const { vaultPath, loading } = useSettings();

  if (loading) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center bg-background text-slate-400 select-none">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-linear-to-b from-card to-sidebar border border-white/10 shadow-xl shadow-indigo-500/20 ring-1 ring-white/10 animate-pulse">
          <img src={logoImg} alt="Kognote Logo" className="h-10 w-10 object-contain" />
        </div>
        <span className="text-xs font-bold tracking-widest text-slate-300">LOADING KOGNOTE...</span>
      </div>
    );
  }

  if (!vaultPath) {
    return <VaultPicker />;
  }

  return <Layout />;
};

export default function App() {
  return (
    <SettingsProvider>
      <VaultProvider>
        <SyncProvider>
          <MainApp />
          <ToastHost />
        </SyncProvider>
      </VaultProvider>
    </SettingsProvider>
  );
}
