import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5176,
    allowedHosts: ["host.docker.internal", "willye.taile4213d.ts.net"],
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
