import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  define: {
    "process.env.IS_PREACT": JSON.stringify("true"),
  },

  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("@excalidraw/excalidraw")) {
              return "vendor-excalidraw";
            }
            if (
              id.includes("@milkdown") ||
              id.includes("@codemirror") ||
              id.includes("codemirror") ||
              id.includes("mermaid") ||
              id.includes("cytoscape")
            ) {
              return "vendor-editor-stack";
            }
            if (id.includes("@huggingface/transformers")) {
              return "vendor-transformers";
            }
            if (id.includes("pdfjs-dist")) {
              return "vendor-pdfjs";
            }
            if (id.includes("lucide-react") || id.includes("clsx") || id.includes("tailwind-merge")) {
              return "vendor-ui";
            }
          }
        },
      },
    },
  },
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));

