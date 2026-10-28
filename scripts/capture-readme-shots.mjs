/**
 * One-shot: start Archer on a temp data dir, seed demo content, write README screenshots.
 * Not part of normal install — run only when refreshing docs/screenshots.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { projectRoot } from "./lib/paths.mjs";

const root = projectRoot();
const outDir = path.join(root, "docs", "screenshots");
const port = 5299;
const base = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "archer-shots-"));

fs.mkdirSync(outDir, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitReady(timeoutMs = 45_000) {
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
    "X-Archer": "1",
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
  const line = raw.find((c) => c.startsWith("archer_session=")) ?? res.headers.get("set-cookie");
  if (!line) throw new Error("no archer_session cookie");
  return line.split(";")[0];
}

async function seed(cookie) {
  await api(cookie, "PUT", "/api/settings", {
    provider: "smtp",
    operatorName: "Alex Operator",
    organization: "Example Org",
    fromName: "Example",
    fromEmail: "hello@example.com",
    replyTo: "hello@example.com",
    postalAddress: "1 Example Street, Example City, CA 94105",
    unsubMailbox: "unsub@example.com",
    publicBaseUrl: "https://mail.example.com",
    dkimSelector: "s1",
    timezone: "America/Los_Angeles",
    testInboxes: ["you@example.com", "ops@example.com"],
    smtp: { host: "smtp.example.com", port: 587, secure: false, user: "smtp-user", pass: "smtp-pass-demo" },
  });
  await api(cookie, "POST", "/api/setup/complete");

  const csv = [
    "email,first_name,company",
    "ann@gmail.com,Ann,Northwind",
    "bob@outlook.com,Bob,Contoso",
    "cy@yahoo.com,Cy,Fabrikam",
    "dee@gmail.com,Dee,Adventure Works",
    "eli@gmail.com,Eli,Tailspin",
    "fay@outlook.com,Fay,Wide World",
  ].join("\n");
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
    subject: "Hello {{first_name}} — thanks for joining",
    html: [
      "<div style=\"font:16px/1.5 system-ui,sans-serif;color:#18181b;max-width:560px\">",
      "<p>Hi {{first_name}},</p>",
      "<p>Welcome to Example. Glad you are here.</p>",
      "<p><a href=\"{{unsubscribe_url}}\">Unsubscribe</a></p>",
      "<p style=\"color:#71717a;font-size:12px\">{{postal_address}}</p>",
      "</div>",
    ].join(""),
  });

  const campaign = await api(cookie, "POST", "/api/campaigns", {
    listId: list.listId,
    templateId: template.id,
    schedule: {
      timezone: "America/Los_Angeles",
      sendDays: [1, 2, 3, 4, 5],
      startTime: "09:00",
      endTime: "17:00",
      dailyCap: 500,
      warmup: true,
      delaySeconds: 10,
    },
  });
  await api(cookie, "PATCH", `/api/campaigns/${campaign.id}`, {
    title: "September newsletter",
    tags: ["folder:newsletters"],
  });

  return { listId: list.listId, templateId: template.id, campaignId: campaign.id };
}

function ensureTagId(db, name) {
  const existing = db.prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE").get(name);
  if (existing) return existing.id;
  const r = db.prepare("INSERT INTO tags (name) VALUES (?)").run(name);
  return Number(r.lastInsertRowid);
}

/** Pause the worker DB briefly and paint realistic send history for screenshots. */
function enrichDemoDb({ campaignId, listId }) {
  const dbPath = path.join(dataDir, "archer.db");
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const folder = ensureTagId(db, "folder:newsletters");
    const vip = ensureTagId(db, "vip");
    db.prepare("DELETE FROM list_tags WHERE list_id = ?").run(listId);
    db.prepare("INSERT INTO list_tags (list_id, tag_id) VALUES (?, ?), (?, ?)").run(listId, folder, listId, vip);
    db.prepare("DELETE FROM campaign_tags WHERE campaign_id = ?").run(campaignId);
    db.prepare("INSERT INTO campaign_tags (campaign_id, tag_id) VALUES (?, ?)").run(campaignId, folder);

    const contacts = db.prepare("SELECT id FROM contacts ORDER BY id").all();
    const now = Date.now();
    db.prepare(
      `UPDATE campaigns SET status = 'paused', pause_reason = 'Operator paused for screenshots',
       started_at = ? WHERE id = ?`,
    ).run(new Date(now - 3_600_000).toISOString(), campaignId);

    db.prepare("DELETE FROM sends WHERE campaign_id = ?").run(campaignId);
    const insertSend = db.prepare(
      `INSERT INTO sends (campaign_id, contact_id, state, attempts, updated_at) VALUES (?, ?, ?, ?, ?)`,
    );
    contacts.forEach((c, i) => {
      const state = i < 4 ? "sent" : "pending";
      insertSend.run(campaignId, c.id, state, state === "sent" ? 1 : 0, new Date(now - i * 120_000).toISOString());
    });

    db.prepare("DELETE FROM events WHERE campaign_id = ?").run(campaignId);
    const insertEv = db.prepare(
      `INSERT INTO events (campaign_id, type, message, created_at) VALUES (?, ?, ?, ?)`,
    );
    for (let h = 8; h >= 0; h--) {
      const at = new Date(now - h * 3_600_000 - 30_000).toISOString();
      insertEv.run(campaignId, "sent", `Demo send hour ${h}`, at);
      if (h % 3 === 0) insertEv.run(campaignId, "failed", "Demo: mailbox unavailable", at);
    }
    for (let m = 40; m >= 0; m -= 5) {
      insertEv.run(campaignId, "sent", `Demo minute ${m}`, new Date(now - m * 60_000).toISOString());
    }
  } finally {
    db.close();
  }
}

async function shot(page, name) {
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log("wrote", path.relative(root, file));
}

async function dismissOverlays(page) {
  for (const name of [/skip for now/i, /^skip$/i, /^close$/i, /not now/i]) {
    const btn = page.getByRole("button", { name });
    if (await btn.count()) {
      await btn.first().click().catch(() => {});
      await sleep(250);
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(150);
}

function spawnServer() {
  const proc = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "--import", "tsx", path.join(root, "server/index.ts")],
    {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        ARCHER_DATA_DIR: dataDir,
        ARCHER_NO_OPEN: "1",
        UNSUB_SECRET: "s".repeat(64),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  proc.stderr.on("data", (d) => {
    stderr += d.toString();
  });
  proc.stdout.on("data", (d) => {
    process.stdout.write(d);
  });
  return proc;
}

let stderr = "";
let child = spawnServer();

try {
  await waitReady();
  const cookie = await sessionCookie();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await context.addCookies([
    {
      name: "archer_session",
      value: cookie.replace(/^archer_session=/, ""),
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  const page = await context.newPage();

  await page.goto(`${base}/`);
  await page.waitForSelector("text=/Welcome|Operator|Your name|Setup/i", { timeout: 20_000 });
  await sleep(900);
  await shot(page, "01-setup");

  const ids = await seed(cookie);

  // Stop briefly so SQLite enrich can write; then reopen.
  child.kill("SIGTERM");
  await sleep(800);
  enrichDemoDb(ids);
  child = spawnServer();
  await waitReady();

  await page.goto(`${base}/#/dashboard`);
  await sleep(600);
  await dismissOverlays(page);
  await page.waitForSelector("text=Dashboard", { timeout: 15_000 });
  await page.waitForSelector("text=/Sent|Recipients/i", { timeout: 10_000 });
  await sleep(900);
  await shot(page, "02-dashboard");

  await page.goto(`${base}/#/audience`);
  await dismissOverlays(page);
  await page.waitForSelector("text=Autumn newsletter", { timeout: 15_000 });
  await sleep(600);
  await shot(page, "03-audience");

  await page.goto(`${base}/#/templates`);
  await dismissOverlays(page);
  await page.waitForSelector("text=Welcome", { timeout: 15_000 });
  const viewBtn = page.getByRole("button", { name: "View" }).first();
  if (await viewBtn.count()) {
    await viewBtn.click();
    await page.waitForSelector('[role="dialog"]');
    await page.waitForSelector('iframe[title="Email preview"]', { timeout: 10_000 }).catch(() => {});
    await sleep(800);
    await shot(page, "04-templates");
    await page.keyboard.press("Escape");
    await sleep(300);
  } else {
    await shot(page, "04-templates");
  }

  await page.goto(`${base}/#/runs`);
  await dismissOverlays(page);
  await page.waitForSelector("text=September newsletter", { timeout: 15_000 });
  await sleep(600);
  await shot(page, "05-runs");

  await page.goto(`${base}/#/settings`);
  await dismissOverlays(page);
  await page.waitForSelector("text=Operator", { timeout: 15_000 });
  await sleep(700);
  await shot(page, "06-settings");

  await page.goto(`${base}/#/runs`);
  await dismissOverlays(page);
  const newRun = page.getByRole("button", { name: "New run" });
  if (await newRun.count()) {
    await newRun.click();
    await page.waitForSelector('[role="dialog"]');
    const listTrigger = page.getByRole("combobox").first();
    if (await listTrigger.count()) {
      await listTrigger.click();
      const opt = page.getByRole("option", { name: /Autumn newsletter/i });
      if (await opt.count()) await opt.first().click();
    }
    await sleep(700);
    await shot(page, "07-new-run");
    await page.keyboard.press("Escape");
  }

  await page.goto(`${base}/#/campaigns/${ids.campaignId}`);
  await dismissOverlays(page);
  await page.waitForSelector("text=/September newsletter|Overview|Progress/i", { timeout: 15_000 });
  await sleep(900);
  await shot(page, "08-campaign");

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
