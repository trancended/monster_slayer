import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const resolvePath = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      // Import źródeł, nie zbudowanego pakietu — jeden krok kompilacji mniej
      // i działający HMR na kodzie walki.
      "@ms/core": resolvePath("../core/src/index.ts"),
      "@ms/data": resolvePath("../../data"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // W kontenerze bind-mount nie emituje natywnych zdarzeń FS.
    watch: { usePolling: process.env.VITE_USE_POLLING === "true" },
    // Vite proxuje /api i /socket na Phoenixa — z punktu widzenia przeglądarki
    // wszystko leci z jednego originu, więc CORS w ogóle nie występuje.
    proxy: {
      "/api": {
        target: process.env.VITE_BACKEND_URL ?? "http://localhost:4000",
        changeOrigin: true,
      },
      "/socket": {
        target: process.env.VITE_BACKEND_WS ?? "ws://localhost:4000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: { pixi: ["pixi.js"] },
      },
    },
  },
});
