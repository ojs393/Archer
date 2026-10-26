import fs from "node:fs";
import path from "node:path";
import { runNpm } from "./run.mjs";

const NAME = "web app";
const BUILD_TIMEOUT_MS = 5 * 60_000;
const CONFIG_FILES = ["vite.config.ts", "tailwind.config.ts", "package-lock.json"];

function newestFile(entry, newest) {
  let stat;
  try {
    stat = fs.statSync(entry);
  } catch {
    return newest;
  }
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(entry)) {
      if (!name.startsWith(".")) newest = newestFile(path.join(entry, name), newest);
    }
    return newest;
  }
  return !newest || stat.mtimeMs > newest.mtimeMs ? { file: entry, mtimeMs: stat.mtimeMs } : newest;
}

export function webBuildState(root) {
  const webDir = path.join(root, "web");
  if (!fs.existsSync(path.join(webDir, "index.html"))) return { state: "no-source" };
  const index = path.join(root, "dist", "web", "index.html");
  if (!fs.existsSync(index)) return { state: "missing" };

  let newest = newestFile(webDir, null);
  for (const name of CONFIG_FILES) newest = newestFile(path.join(root, name), newest);
  if (fs.statSync(index).mtimeMs >= newest.mtimeMs) return { state: "fresh" };
  return { state: "stale", newest: path.relative(root, newest.file) };
}

function npmBuild(root) {
  // Build errors go to stderr; vite's progress output on stdout would only clutter the doctor report.
  return runNpm(["run", "build:web"], { cwd: root, timeoutMs: BUILD_TIMEOUT_MS, stdio: ["ignore", "ignore", "inherit"] });
}

export async function webBuildCheck(root, { build = npmBuild } = {}) {
  const before = webBuildState(root);
  if (before.state === "no-source") return { status: "SKIP", name: NAME, detail: "no web sources" };
  if (before.state === "fresh") return { status: "PASS", name: NAME, detail: "build is current" };

  const r = await build(root);
  if (!r.ok) {
    const why = r.timedOut ? "timed out" : r.error ?? `exit code ${r.code}`;
    return { status: "FAIL", name: NAME, detail: `npm run build:web failed (${why})`, hint: "run npm run build:web to see the error" };
  }
  if (webBuildState(root).state !== "fresh") {
    return { status: "FAIL", name: NAME, detail: "npm run build:web did not produce dist/web/index.html", hint: "run npm run build:web to see the error" };
  }
  const reason = before.state === "missing" ? "not built" : `${before.newest} changed`;
  return { status: "FIXED", name: NAME, detail: `${reason}; ran npm run build:web` };
}
