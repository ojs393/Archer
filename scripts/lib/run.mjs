import { spawn } from "node:child_process";

const KILL_GRACE_MS = 5_000;

function terminate(child) {
  if (process.platform === "win32") {
    // With shell: true the direct child is cmd.exe; /T takes down npm and its children too.
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
}

function runOnce(command, args, { cwd, env, shell = false, stdio = "inherit", timeoutMs }) {
  return new Promise((resolve) => {
    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const child = spawn(command, args, { cwd, env, shell, stdio });
    const timer = setTimeout(() => {
      timedOut = true;
      terminate(child);
    }, timeoutMs);

    // Piped streams must be drained or a chatty child blocks once the pipe buffer fills.
    const out = [];
    child.stdout?.on("data", (chunk) => out.push(chunk));
    child.stderr?.resume();
    const captured = () => (child.stdout ? { stdout: Buffer.concat(out).toString("utf8") } : {});

    child.once("error", (err) => finish({ ok: false, code: null, timedOut, error: err.message, ...captured() }));
    child.once("close", (code) => finish({ ok: code === 0 && !timedOut, code, timedOut, ...captured() }));
  });
}

export async function run(command, args, { retries = 0, ...opts }) {
  let result;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    result = { ...(await runOnce(command, args, opts)), attempts: attempt };
    if (result.ok) break;
  }
  return result;
}

export function runNpm(args, opts) {
  // npm is npm.cmd on Windows, and Node refuses to spawn .cmd files without a shell.
  return run("npm", args, { ...opts, shell: process.platform === "win32" });
}
