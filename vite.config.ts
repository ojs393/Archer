import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react-swc";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { defineConfig } from "vite";
import { resolvePaths } from "./scripts/lib/paths.mjs";
import tailwindConfig from "./tailwind.config.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BACKEND_PORT = 5199;

export const webAlias = { "@": path.join(root, "web", "src") };

function backendTarget(): string {
  const { dataDir } = resolvePaths({ root, env: process.env });
  try {
    const { port } = JSON.parse(fs.readFileSync(path.join(dataDir, "server.json"), "utf8")) as { port?: unknown };
    if (typeof port === "number" && Number.isInteger(port) && port > 0 && port < 65536) return `http://127.0.0.1:${port}`;
  } catch {
    // Backend not running (or not started yet): use the default port.
  }
  return `http://127.0.0.1:${DEFAULT_BACKEND_PORT}`;
}

export default defineConfig(({ command }) => {
  const target = command === "serve" ? backendTarget() : "";
  return {
    root: path.join(root, "web"),
    plugins: [react()],
    resolve: { alias: webAlias },
    css: { postcss: { plugins: [tailwindcss(tailwindConfig), autoprefixer()] } },
    build: {
      outDir: path.join(root, "dist", "web"),
      emptyOutDir: true,
      sourcemap: false,
      target: "es2022",
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": { target, changeOrigin: true },
        "^/u/": { target, changeOrigin: true },
      },
    },
  };
});
