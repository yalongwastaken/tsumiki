import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, proxy /api to the backend so the client and server feel like one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": { target: process.env.API_TARGET || "http://localhost:4000" } },
  },
  build: { outDir: "dist" },
});
