import fs from "node:fs";
import path from "node:path";
import { checkIntegrity, restoreLatestBackup } from "./db-maint.mjs";
import { installArgs, missingDependencies } from "./deps.mjs";
import { ensureDataDirs, ensureSecrets, loadEnv } from "./env.mjs";
import { projectRoot, resolvePaths } from "./paths.mjs";
import { report } from "./report.mjs";
import { run, runNpm } from "./run.mjs";

const INSTALL_TIMEOUT_MS = 10 * 60_000;
const INSTALL_RETRIES = 2;
const AUDIT_TIMEOUT_MS = 2 * 60_000;
const SELFTEST_TIMEOUT_MS = 5 * 60_000;

function listBriefly(items, max = 3) {
  const shown = items.slice(0, max).join(", ");
  return items.length > max ? `${shown}, +${items.length - max} more` : shown;
}

async function dependencies(root, { force }) {
  const name = "dependencies";
  const before = force ? [] : missingDependencies(root);
  if (!force && before.length === 0) return { status: "PASS", name, detail: "installed" };

  const args = installArgs(root);
  const how = `npm ${args.join(" ")}`;
  const r = await runNpm(args, { cwd: root, timeoutMs: INSTALL_TIMEOUT_MS, retries: INSTALL_RETRIES });
  if (!r.ok) {
    const why = r.timedOut ? "timed out" : r.error ?? `exit code ${r.code}`;
    return { status: "FAIL", name, detail: `${how} failed after ${r.attempts} attempt(s): ${why}`, fatal: true };
  }
  const after = missingDependencies(root);
  if (after.length > 0) {
    return { status: "FAIL", name, detail: `still missing after ${how}: ${listBriefly(after)}`, fatal: true };
  }
  if (force) return { status: "PASS", name, detail: `installed with ${how}` };
  return { status: "FIXED", name, detail: `${listBriefly(before)} missing; ran ${how}` };
}

function dataDirs(paths) {
  const name = "data dirs";
  try {
    const created = ensureDataDirs(paths);
    if (created.length === 0) return { status: "PASS", name, detail: paths.dataDir };
    return { status: "FIXED", name, detail: `created ${created.length} under ${paths.dataDir}` };
  } catch (err) {
    return { status: "FAIL", name, detail: err.message, fatal: true };
  }
}

function secrets(envPath) {
  const name = ".env";
  try {
    const generated = ensureSecrets(envPath);
    if (generated.length === 0) return { status: "PASS", name, detail: "secrets present" };
    return { status: "FIXED", name, detail: `generated ${generated.join(", ")}` };
  } catch (err) {
    return { status: "FAIL", name, detail: err.message, fatal: true };
  }
}

function database(paths) {
  const name = "database";
  const check = checkIntegrity(paths.dbPath);
  if (check.status === "missing") return { status: "SKIP", name, detail: "not created yet" };
  if (check.ok) return { status: "PASS", name, detail: "integrity ok" };
  if (check.status === "error") {
    return { status: "FAIL", name, detail: `could not open ${paths.dbPath}: ${check.detail}`, fatal: true };
  }
  const restore = restoreLatestBackup(paths.dbPath, paths.backupsDir);
  if (restore.restored) {
    return { status: "FIXED", name, detail: `corrupt; restored ${path.basename(restore.from)}` };
  }
  return {
    status: "FAIL",
    name,
    detail: `corrupt (${check.detail}) and no valid backup in ${paths.backupsDir}`,
    fatal: true,
  };
}

async function audit(root) {
  const name = "npm audit";
  const r = await runNpm(["audit", "--audit-level=high"], { cwd: root, timeoutMs: AUDIT_TIMEOUT_MS });
  if (r.ok) return { status: "PASS", name, detail: "no high-severity advisories" };
  if (r.timedOut) return { status: "SKIP", name, detail: "timed out" };
  return { status: "FAIL", name, detail: "high-severity advisories or audit unavailable; report only, see above" };
}

async function selfTest(root) {
  const name = "self-test";
  const entry = path.join(root, "server", "selftest.ts");
  if (!fs.existsSync(entry)) return { status: "SKIP", name, detail: "not implemented yet" };
  const r = await run(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "--import", "tsx", entry],
    { cwd: root, timeoutMs: SELFTEST_TIMEOUT_MS },
  );
  if (r.ok) return { status: "PASS", name, detail: "test send to local fake SMTP succeeded" };
  const why = r.timedOut ? "timed out" : r.error ?? `exit code ${r.code}`;
  return { status: "FAIL", name, detail: why, fatal: true };
}

export async function runChecks({ quick = false, forceInstall = false } = {}) {
  const root = projectRoot();
  const results = [];
  const record = (result) => results.push(report(result));

  record(await dependencies(root, { force: forceInstall }));

  loadEnv(resolvePaths({ root, env: {} }).envPath);
  const paths = resolvePaths({ root, env: process.env });
  record(dataDirs(paths));
  record(secrets(paths.envPath));
  record(database(paths));

  if (!quick) {
    const healthy = !results.some((r) => r.fatal);
    record(await audit(root));
    record(healthy ? await selfTest(root) : { status: "SKIP", name: "self-test", detail: "an earlier check failed" });
  }

  return { ok: !results.some((r) => r.fatal), results };
}
