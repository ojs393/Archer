import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vitest/config";
import { webAlias } from "./vite.config.ts";

export default defineConfig({
  test: {
    execArgv: ["--disable-warning=ExperimentalWarning"],
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        extends: true,
        plugins: [react()],
        resolve: { alias: webAlias },
        test: {
          name: "web",
          include: ["web/src/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["web/src/test/setup.ts"],
        },
      },
    ],
  },
});
