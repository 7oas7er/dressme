import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: ".",
  base: "/",
  build: {
    outDir: resolve(__dirname, "../dressme"),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        imprint: resolve(__dirname, "imprint.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.DRESSME_API_PROXY || "https://dressme-stg.7oas7er.com",
        changeOrigin: true,
        secure: true,
      },
    },
  },
});
