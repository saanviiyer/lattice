import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  // pdfjs-dist ships a worker as an ESM module we import with ?url; keep it external
  // to esbuild's dep pre-bundling so the worker resolves correctly.
  optimizeDeps: {
    exclude: ["pdfjs-dist"],
  },
});
