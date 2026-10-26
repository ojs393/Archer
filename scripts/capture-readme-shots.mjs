/**
 * One-shot: start MamaDirect on a temp data dir, seed demo content, write README screenshots.
 * Not part of normal install — run only when refreshing docs/screenshots.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { projectRoot } from "./lib/paths.mjs";

const root = projectRoot();
const outDir = path.join(root, "docs", "screenshots");
const port = 5299;
const base = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mamadirect-shots-"));

fs.mkdirSync(outDir, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitReady(timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${base}/api/session`, { redirect: "manual" });
      if (res.status === 204 || res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error("server did not become ready");
}

async function api(cookie, method, urlPath, body) {
  const headers = {
    Accept: "application/json",
    Cookie: cookie,
    "X-MamaDirect": "1",
    Origin: base,
  };
  let payload;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${urlPath}`, { method, headers, body: payload });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${urlPath} → ${res.status} ${text}`);
  return data;
}

async function sessionCookie() {
  const res = await fetch(`${base}/api/session`);
  if (!res.ok && res.status !== 204) throw new Error(`session ${res.status}`);
  const raw = res.headers.getSetCookie?.() ?? [];
  const line = raw.find((c) => c.startsWith("md_session=")) ?? res.headers.get("set-cookie");
  if (!line) throw new Error("no md_session cookie");
  return line.split(";")[0];
}

async function seed(cookie) {
  await api(cookie, "PUT", "/api/settings", {
    provider: "smtp",
    operatorName: "Alex Operator",
    organization: "Example Org",
    fromName: "Example",
    fromEmail: "hello@example.com",
    postalAddress: "1 Example Street, Example City",
    unsubMailbox: "unsub@example.com",
    timezone: "UTC",
    testInboxes: ["you@example.com"],
    smtp: { host: "smtp.example.com", port: 587, secure: false, user: "smtp-user", pass: "smtp-pass-demo" },
  });
  await api(cookie, "POST", "/api/setup/complete");

  // Use domains with public MX so import stays ready without opening the live DB.
  const csv = ["email,first_name", "ann@gmail.com,Ann", "bob@outlook.com,Bob", "cy@yahoo.com,Cy"].join("\n");
  const form = new FormData();
  form.set("name", "Autumn newsletter");
  form.set("sourceLabel", "Signup form");
  form.set("consentText", "They opted in on our signup form");
  form.set("consentConfirmed", "true");
  form.set("file", new File([csv], "list.csv", { type: "text/csv" }));
  const list = await api(cookie, "POST", "/api/lists", form);
  for (let i = 0; i < 80; i++) {
    const lists = await api(cookie, "GET", "/api/lists");
    const row = lists.find((l) => l.id === list.listId);
    if (row?.status === "ready" || row?.status === "failed") break;
    await sleep(250);
  }

  const template = await api(cookie, "POST", "/api/templates", {
    name: "Welcome",
    subject: "Hello {{first_name}}",
    html: "<p>Hi {{first_name}},</p><p>Thanks for joining.</p><p>{{unsubscribe_url}}</p><p>{{postal_address}}</p>",
  });

  await api(cookie, "POST", "/api/campaigns", {
    listId: list.listId,
    templateId: template.id,
    schedule: {
      timezone: "UTC",
      sendDays: [1, 2, 3, 4, 5],
      startTime: "09:00",
      endTime: "17:00",
      dailyCap: 500,
      warmup: false,
      delaySeconds: 10,
    },
  });
}

async function shot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log("wrote", path.relative(root, file));
}

const child = spawn(
  process.execPath,
  ["--disable-warning=ExperimentalWarning", "--import", "tsx", path.join(root, "server/index.ts")],
  {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      MAMADIRECT_DATA_DIR: dataDir,
      MAMADIRECT_NO_OPEN: "1",
      UNSUB_SECRET: "s".repeat(64),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

let stderr = "";
child.stderr.on("data", (d) => {
  stderr += d.toString();
});
child.stdout.on("data", (d) => {
  process.stdout.write(d);
});

try {
  await waitReady();
  const cookie = await sessionCookie();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await context.addCookies([
    {
      name: "md_session",
      value: cookie.replace(/^md_session=/, ""),
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  const page = await context.newPage();

  // Setup wizard (reset after seed so we can also capture completed UI)
  await page.goto(`${base}/`);
  await page.waitForSelector("text=Welcome", { timeout: 15_000 }).catch(() => {});
  // Incomplete wizard on first boot
  await page.waitForTimeout(800);
  await shot(page, "01-setup");

  await seed(cookie);
  await page.reload();
  await page.waitForTimeout(1000);

  // Dismiss wizard if still open (already complete)
  const skip = page.getByRole("button", { name: /skip|close|not now/i });
  if (await skip.count()) await skip.first().click().catch(() => {});

  for (const [hash, name, waitText] of [
    ["#/dashboard", "02-dashboard", "Dashboard"],
    ["#/audience", "03-audience", "Audience"],
    ["#/templates", "04-templates", "Templates"],
    ["#/runs", "05-runs", "Runs"],
    ["#/settings", "06-settings", "Settings"],
  ]) {
    await page.goto(`${base}/${hash}`);
    await page.waitForSelector(`text=${waitText}`, { timeout: 15_000 });
    await page.waitForTimeout(600);
    await shot(page, name);
  }

  // New run wizard
  await page.goto(`${base}/#/runs`);
  await page.waitForSelector("text=Runs");
  const newRun = page.getByRole("button", { name: "New run" });
  if (await newRun.count()) {
    await newRun.click();
    await page.waitForSelector('[role="dialog"]');
    await page.waitForTimeout(500);
    await shot(page, "07-new-run");
  }

  await browser.close();
} catch (err) {
  console.error(err);
  console.error(stderr.slice(-2000));
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  await sleep(500);
  try {
    fs.rmSync(dataDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
