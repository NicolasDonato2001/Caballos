import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // /api va al servidor del juego (Fase 7): node server/servidor.ts
  // allowedHosts: para jugar con amigos por internet con un túnel de Cloudflare (JUGAR_POR_INTERNET.bat)
  server: { port: 5173, strictPort: true, host: "localhost", proxy: { "/api": "http://127.0.0.1:8787" }, allowedHosts: [".trycloudflare.com"] },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
});
