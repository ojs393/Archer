#!/usr/bin/env node
/**
 * Local demo seed — writes only under data/ (gitignored).
 * Re-run safe: removes prior rows tagged `seed`, then inserts fresh demo data.
 * Does not overwrite SMTP password or other secrets.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const { resolvePaths, ensureDataDirs } = await import(pathToFileURL(path.join(root, "server/config.ts")).href);
const { openDb } = await import(pathToFileURL(path.join(root, "server/db/index.ts")).href);
const { createList } = await import(pathToFileURL(path.join(root, "server/import/lists.ts")).href);
const { setListTags, setCampaignTags, ensureTag } = await import(pathToFileURL(path.join(root, "server/tags/store.ts")).href);
const { setSetting, getSetting } = await import(pathToFileURL(path.join(root, "server/db/settings.ts")).href);

const paths = resolvePaths({ root, env: process.env });
ensureDataDirs(paths);
const db = openDb(paths.dbPath);

const MARKER = "seed";

function wipeSeed() {
  const tag = db.prepare("SELECT id FROM tags WHERE name = ? COLLATE NOCASE").get(MARKER);
  if (tag) {
    const listIds = db.prepare("SELECT list_id AS id FROM list_tags WHERE tag_id = ?").all(tag.id).map((r) => r.id);
    const campaignIds = db
      .prepare("SELECT campaign_id AS id FROM campaign_tags WHERE tag_id = ?")
      .all(tag.id)
      .map((r) => r.id);
    for (const id of campaignIds) {
      db.prepare("DELETE FROM campaigns WHERE id = ?").run(id);
    }
    for (const id of listIds) {
      db.prepare("DELETE FROM lists WHERE id = ?").run(id);
    }
  }
  // Seed templates by name prefix
  db.prepare("DELETE FROM templates WHERE name LIKE 'Seed %'").run();
}

function people(n, domain, prefix) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    out.push({
      email: `${prefix}${i}@${domain}`,
      fields: { first_name: `Person${i}`, company: i % 3 === 0 ? "Acme" : "Globex" },
    });
  }
  return out;
}

function insertContacts(listId, rows) {
  const insert = db.prepare("INSERT INTO contacts (list_id, email, domain, fields_json) VALUES (?, ?, ?, ?)");
  for (const r of rows) {
    const at = r.email.indexOf("@");
    const domain = at >= 0 ? r.email.slice(at + 1).toLowerCase() : "";
    insert.run(listId, r.email.toLowerCase(), domain, JSON.stringify(r.fields));
  }
  db.prepare(
    `UPDATE lists SET status = 'ready', total_rows = ?, valid_count = ?, invalid_count = 0,
     duplicate_count = 0, suppressed_count = 0, role_count = 0, error = NULL WHERE id = ?`,
  ).run(rows.length, rows.length, listId);
}

function insertTemplate(name, subject) {
  const r = db
    .prepare(
      `INSERT INTO templates (name, subject, html, text, variable_map_json)
       VALUES (?, ?, ?, ?, '{}')`,
    )
    .run(
      name,
      subject,
      `<p>Hi {{first_name}},</p><p>Thanks for being with {{company}}.</p><p><a href="{{unsubscribe_url}}">Unsubscribe</a></p><p>{{postal_address}}</p>`,
      "Hi {{first_name}} — unsubscribe: {{unsubscribe_url}}",
    );
  return Number(r.lastInsertRowid);
}

function insertCampaign({ listId, templateId, title, status, tags, sent = 0, pending = 0 }) {
  const schedule = JSON.stringify({
    timezone: "America/New_York",
    startTime: "09:00",
    endTime: "17:00",
    sendDays: [1, 2, 3, 4, 5],
    dailyCap: 200,
    delaySeconds: 2,
    warmup: false,
  });
  const r = db
    .prepare(
      `INSERT INTO campaigns (list_id, template_id, template_version, status, title, schedule_json, started_at, finished_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
    )
    .run(
      listId,
      templateId,
      status,
      title,
      schedule,
      status === "draft" ? null : new Date(Date.now() - 86400000).toISOString(),
      status === "completed" ? new Date().toISOString() : null,
    );
  const id = Number(r.lastInsertRowid);
  const contacts = db.prepare("SELECT id FROM contacts WHERE list_id = ? ORDER BY id").all(listId);
  const insertSend = db.prepare(
    `INSERT INTO sends (campaign_id, contact_id, state, attempts, updated_at) VALUES (?, ?, ?, ?, ?)`,
  );
  let s = 0;
  let p = 0;
  for (const c of contacts) {
    let state = "pending";
    if (s < sent) {
      state = "sent";
      s++;
    } else if (p < pending) {
      state = "pending";
      p++;
    } else if (status === "completed") {
      state = "sent";
    } else {
      state = "pending";
    }
    insertSend.run(id, c.id, state, state === "sent" ? 1 : 0, new Date().toISOString());
  }
  // Spread outcome events across recent hours so dashboard charts have real curves.
  if (sent > 0) {
    const insertEv = db.prepare(
      `INSERT INTO events (campaign_id, type, message, created_at) VALUES (?, ?, ?, ?)`,
    );
    const now = Date.now();
    let remaining = sent;
    const hours = Math.min(24, Math.max(4, Math.ceil(sent / 3)));
    for (let h = hours - 1; h >= 0 && remaining > 0; h--) {
      const n = Math.max(1, Math.floor(remaining / (h + 1)));
      const at = new Date(now - h * 3_600_000 - 60_000).toISOString();
      for (let i = 0; i < n; i++) {
        insertEv.run(id, "sent", `Seed send ${remaining - i}`, at);
      }
      remaining -= n;
      if (h % 5 === 0 && sent > 5) {
        insertEv.run(id, "failed", "Seed: mailbox unavailable", at);
      }
      if (h % 7 === 0 && sent > 8) {
        insertEv.run(id, "suppressed", "Seed: suppressed", at);
      }
    }
  }
  setCampaignTags(db, id, [MARKER, ...tags]);
  return id;
}

wipeSeed();
ensureTag(db, MARKER);

if (!getSetting(db, "operator_name")) setSetting(db, "operator_name", "Demo Operator");
if (!getSetting(db, "organization")) setSetting(db, "organization", "Archer Demo");
if (!getSetting(db, "from_name")) setSetting(db, "from_name", "Archer Demo");
if (!getSetting(db, "from_email")) setSetting(db, "from_email", "hello@example.com");
if (!getSetting(db, "unsub_mailbox")) setSetting(db, "unsub_mailbox", "unsub@example.com");
if (!getSetting(db, "postal_address")) setSetting(db, "postal_address", "123 Demo St, Springfield");
if (!getSetting(db, "setup_completed_at")) setSetting(db, "setup_completed_at", new Date().toISOString());

const vip = createList(db, {
  name: "VIP customers",
  sourceLabel: "crm-export",
  consentText: "Seeded consent attestation for local demo only.",
  excludeRoles: true,
});
insertContacts(vip, people(40, "customers.example", "vip"));
setListTags(db, vip, [MARKER, "vip", "newsletter", "folder:crm"]);

const warmup = createList(db, {
  name: "Warm-up cohort",
  sourceLabel: "signup",
  consentText: "Seeded consent attestation for local demo only.",
  excludeRoles: true,
});
insertContacts(warmup, people(60, "warmup.example", "w"));
setListTags(db, warmup, [MARKER, "warmup", "folder:warmup"]);

const newsletter = createList(db, {
  name: "Monthly newsletter",
  sourceLabel: "web-form",
  consentText: "Seeded consent attestation for local demo only.",
  excludeRoles: true,
});
insertContacts(newsletter, people(80, "news.example", "n"));
setListTags(db, newsletter, [MARKER, "newsletter", "folder:newsletter"]);

const tWelcome = insertTemplate("Seed Welcome", "Welcome aboard, {{first_name}}");
const tNews = insertTemplate("Seed Newsletter", "{{company}} updates for {{first_name}}");
const tWarm = insertTemplate("Seed Warm-up", "Quick hello from Archer");

insertCampaign({
  listId: vip,
  templateId: tWelcome,
  title: "VIP welcome blast",
  status: "completed",
  tags: ["vip", "folder:crm"],
  sent: 40,
});
insertCampaign({
  listId: warmup,
  templateId: tWarm,
  title: "Domain warm-up day 3",
  status: "paused",
  tags: ["warmup", "folder:warmup"],
  sent: 20,
  pending: 40,
});
insertCampaign({
  listId: newsletter,
  templateId: tNews,
  title: "October newsletter",
  status: "draft",
  tags: ["newsletter", "folder:newsletter"],
  pending: 80,
});
insertCampaign({
  listId: newsletter,
  templateId: tNews,
  title: "September newsletter",
  status: "stopped",
  tags: ["newsletter", "folder:newsletter"],
  sent: 50,
  pending: 30,
});

fs.writeFileSync(path.join(paths.dataDir, ".seed-local"), new Date().toISOString() + "\n", { mode: 0o600 });

db.close();
console.log(`Seeded local demo into ${paths.dbPath}`);
console.log("Restart Archer (npm start) and open Audience / Runs / Dashboard.");
