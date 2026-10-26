import { spawn } from "node:child_process";

function command(url: string): [string, string[]] {
  if (process.platform === "darwin") return ["open", [url]];
  if (process.platform === "win32") return ["cmd", ["/c", "start", '""', url]];
  return ["xdg-open", [url]];
}

export function openBrowser(url: string): void {
  try {
    const [cmd, args] = command(url);
    const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsVerbatimArguments: process.platform === "win32" });
    child.on("error", () => {});
    child.unref();
  } catch {
    // No browser (headless box, missing xdg-open): the URL is already printed.
  }
}
