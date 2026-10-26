import type { FastifyInstance } from "fastify";
import { checkDomainAuth, type DnsAuthResult } from "../../dns/check.ts";
import { emailDomain } from "../../domain/email.ts";
import { redact } from "../../logger.ts";
import type { SmtpConfig } from "../../send/transport.ts";
import { setEnvValue } from "../../settings/envFile.ts";
import { getSettingsView, smtpConfigFor, updateSettings } from "../../settings/store.ts";
import type { AppContext } from "../context.ts";
import { settingsUpdateSchema, type Provider, type SmtpTestResult } from "../contract.ts";
import { HttpError } from "../errors.ts";

export const SMTP_TEST_TIMEOUT_MS = 45_000;
const MAX_MESSAGE = 300;

function scrubSecret(text: string, cfg: SmtpConfig): string {
  if (!cfg.pass) return redact(text);
  const forms = [
    cfg.pass,
    Buffer.from(cfg.pass, "utf8").toString("base64"),
    Buffer.from(`\u0000${cfg.user}\u0000${cfg.pass}`, "utf8").toString("base64"),
  ].sort((a, b) => b.length - a.length);
  return redact(forms.reduce((out, s) => out.split(s).join("***"), text));
}

function describeSmtpFailure(err: unknown, cfg: SmtpConfig): string {
  const e = (err ?? {}) as { code?: unknown; responseCode?: unknown; message?: unknown };
  const where = `${cfg.host}:${cfg.port}`;
  const raw = typeof e.message === "string" ? e.message : String(err);
  const detail = scrubSecret(raw, cfg).replace(/\s+/g, " ").trim();
  let message: string;
  if (e.code === "EAUTH" || e.responseCode === 535) message = `Login failed: the server rejected the username or password (${detail})`;
  else if (e.code === "ETIMEDOUT" || e.code === "ECONNECTION" || e.code === "ECONNREFUSED") {
    message = `Could not connect to ${where}; check the host, port and secure setting (${detail})`;
  } else if (e.code === "EDNS") message = `Could not find ${cfg.host}; check the host name (${detail})`;
  else if (e.code === "ETLS") message = `TLS problem talking to ${where} (${detail})`;
  else message = `SMTP test failed: ${detail}`;
  return message.slice(0, MAX_MESSAGE);
}

function missingSmtpField(cfg: SmtpConfig, provider: Provider): string | null {
  if (!cfg.host) return provider === "ses" ? "Choose the Amazon SES region first" : "Enter the SMTP host first";
  if (!cfg.user) return "Enter the SMTP username first";
  if (!cfg.pass) return "Enter the SMTP password first";
  return null;
}

function withTimeout<T>(work: () => Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: false }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ done: false }), ms);
    Promise.resolve()
      .then(work)
      .then(
        (value) => resolve({ done: true, value }),
        (err: unknown) => reject(err),
      )
      .finally(() => clearTimeout(timer));
  });
}

function dnsSummary(r: DnsAuthResult): string {
  if (r.ok) return `SPF, DKIM and DMARC found for ${r.domain}`;
  const failing = (
    [
      ["SPF", r.spf],
      ["DKIM", r.dkim],
      ["DMARC", r.dmarc],
    ] as const
  ).filter(([, part]) => !part.ok);
  return failing.map(([name, part]) => `${name}: ${part.detail}`).join("; ");
}

export function settingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const envPath = ctx.paths.envPath;
  const smtpTimeoutMs = ctx.smtpTestTimeoutMs ?? SMTP_TEST_TIMEOUT_MS;

  app.get("/api/settings", async () => getSettingsView(ctx.db, ctx.env));

  app.put("/api/settings", async (request) => {
    const patch = settingsUpdateSchema.parse(request.body ?? {});
    let passChanged = false;
    if (patch.smtp?.pass !== undefined) {
      ctx.registerSecret(patch.smtp.pass);
      passChanged = ctx.env.SMTP_PASS !== patch.smtp.pass;
      setEnvValue(envPath, "SMTP_PASS", patch.smtp.pass, ctx.env);
    } else if (patch.smtp?.clearPass && ctx.env.SMTP_PASS !== undefined) {
      setEnvValue(envPath, "SMTP_PASS", null, ctx.env);
      passChanged = true;
    }
    const change = updateSettings(ctx.db, patch);
    if (change.smtpChanged || passChanged) ctx.health.reset("smtp");
    if (change.dnsChanged) ctx.health.reset("dns");
    return getSettingsView(ctx.db, ctx.env);
  });

  app.post("/api/settings/smtp/test", async (): Promise<SmtpTestResult> => {
    const settings = getSettingsView(ctx.db, ctx.env);
    const cfg = smtpConfigFor(settings, ctx.env);
    const missing = missingSmtpField(cfg, settings.provider);
    if (missing) return { ok: false, message: missing };
    let result: SmtpTestResult;
    try {
      const outcome = await withTimeout(() => ctx.verifySmtp(cfg), smtpTimeoutMs);
      result = outcome.done
        ? { ok: true, message: `Connected to ${cfg.host}:${cfg.port} over TLS and logged in` }
        : { ok: false, message: `${cfg.host}:${cfg.port} did not answer within ${Math.round(smtpTimeoutMs / 1000)}s` };
    } catch (err) {
      result = { ok: false, message: describeSmtpFailure(err, cfg) };
    }
    ctx.health.set("smtp", { status: result.ok ? "ok" : "fail", detail: result.message, checkedAt: new Date().toISOString() });
    return result;
  });

  app.post("/api/settings/dns/check", async () => {
    const s = getSettingsView(ctx.db, ctx.env);
    if (!s.fromEmail) throw new HttpError(400, "from_email_missing", "Set the from address first; its domain is what gets checked");
    const result = await checkDomainAuth(emailDomain(s.fromEmail), s.dkimSelector, ctx.dnsResolver);
    ctx.health.set("dns", { status: result.ok ? "ok" : "fail", detail: dnsSummary(result), checkedAt: new Date().toISOString() });
    return result;
  });
}
