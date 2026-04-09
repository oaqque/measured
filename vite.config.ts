import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

function getNodeModulePackageName(id: string) {
  if (!id.includes("node_modules")) {
    return;
  }

  const nodeModulesPath = id.split("node_modules/").pop();
  if (!nodeModulesPath) {
    return;
  }

  const normalizedPath = nodeModulesPath.startsWith(".pnpm/")
    ? nodeModulesPath.split("/node_modules/").pop()
    : nodeModulesPath;
  if (!normalizedPath) {
    return;
  }

  const segments = normalizedPath.split("/");
  if (segments[0]?.startsWith("@")) {
    return segments.slice(0, 2).join("/");
  }

  return segments[0];
}

function resolveManualChunk(id: string) {
  const packageName = getNodeModulePackageName(id);
  if (!packageName) {
    return;
  }

  if (["react", "react-dom", "scheduler"].includes(packageName)) {
    return "react-vendor";
  }

  if (
    packageName === "leaflet" ||
    packageName === "react-leaflet" ||
    packageName === "react-leaflet-core"
  ) {
    return "map-vendor";
  }

  if (
    packageName === "katex" ||
    packageName === "rehype-katex" ||
    packageName === "remark-math" ||
    packageName === "micromark-extension-math" ||
    packageName === "mdast-util-math"
  ) {
    return "math-vendor";
  }

  if (
    packageName === "react-markdown" ||
    packageName === "rehype-raw" ||
    packageName === "remark-breaks" ||
    packageName === "remark-gfm" ||
    packageName === "remark-parse" ||
    packageName === "remark-rehype" ||
    packageName === "unified" ||
    packageName.startsWith("hast-") ||
    packageName.startsWith("mdast-") ||
    packageName.startsWith("micromark") ||
    packageName.startsWith("unist-") ||
    packageName.startsWith("vfile") ||
    packageName === "parse5" ||
    packageName === "property-information" ||
    packageName === "entities"
  ) {
    return "markdown-vendor";
  }

  if (
    packageName === "react-day-picker" ||
    packageName === "lucide-react" ||
    packageName.startsWith("@radix-ui/")
  ) {
    return "ui-vendor";
  }

  return;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: resolveManualChunk,
      },
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
