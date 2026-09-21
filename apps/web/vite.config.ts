import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Lets the app call same-origin `/api/*` in dev without CORS; the API
      // itself also sets permissive CORS (apps/api/src/app.ts) for the case
      // where VITE_API_BASE_URL points elsewhere (e.g. in production).
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
