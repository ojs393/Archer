import type { SettingsView } from "@/lib/types";

/** Replace {{var}} with sample values so live edit preview matches real merges. */
export function fillPreviewVars(
  source: string,
  settings?: Pick<SettingsView, "fromName" | "fromEmail" | "postalAddress" | "publicBaseUrl" | "unsubMailbox"> | null,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const postal = settings?.postalAddress?.trim() || "123 Example St, City, ST 00000";
  const base = settings?.publicBaseUrl?.trim() || "https://example.com";
  const unsub = `${base.replace(/\/$/, "")}/u/preview`;
  const map: Record<string, string> = {
    email: "alex@example.com",
    first_name: "Alex",
    company: "Example Co",
    domain: "example.com",
    unsubscribe_url: unsub,
    postal_address: postal,
    today,
  };
  return source.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => map[key] ?? `{{${key}}}`);
}

/** Plain email-shaped preview (sandbox iframe — not raw HTML source). */
export function EmailPreview({
  subject,
  html,
  name,
  fromName,
  fromEmail,
  toEmail,
  settings,
  fillVars = false,
}: {
  subject: string;
  html: string;
  name?: string;
  fromName?: string;
  fromEmail?: string;
  toEmail?: string;
  /** When fillVars is true, merge tags are filled from settings / samples. */
  settings?: Pick<SettingsView, "fromName" | "fromEmail" | "postalAddress" | "publicBaseUrl" | "unsubMailbox"> | null;
  fillVars?: boolean;
}) {
  const filledSubject = fillVars ? fillPreviewVars(subject, settings) : subject;
  const filledHtml = fillVars ? fillPreviewVars(html, settings) : html;
  const body = filledHtml.trim() || "<p></p>";
  const from =
    fromName || fromEmail
      ? [fromName?.trim(), fromEmail?.trim() ? `<${fromEmail.trim()}>` : ""].filter(Boolean).join(" ")
      : settings
        ? [settings.fromName.trim(), settings.fromEmail.trim() ? `<${settings.fromEmail.trim()}>` : ""].filter(Boolean).join(" ")
        : "";

  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    html,body{margin:0;padding:0;background:#fff;}
    body{padding:16px;font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#18181b;}
    img{max-width:100%;height:auto;}
    a{color:#2563eb;}
    table{max-width:100%;}
  </style></head><body>${body}</body></html>`;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {name ? <p className="text-sm font-medium text-foreground">{name}</p> : null}
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
      <div className="overflow-hidden rounded-md border border-border bg-white shadow-card ring-1 ring-black/[0.04]">
        <div className="flex flex-col gap-1 border-b border-border bg-zinc-50 px-3 py-2">
          {from ? (
            <p className="truncate text-xs text-muted-foreground">
              From · <span className="text-foreground">{from}</span>
            </p>
          ) : null}
          {toEmail ? (
            <p className="truncate text-xs text-muted-foreground">
              To · <span className="text-foreground">{toEmail}</span>
            </p>
          ) : null}
          <p className="truncate text-sm text-foreground">
            <span className="text-muted-foreground">Subject · </span>
            {filledSubject.trim() || "—"}
          </p>
        </div>
        {/* XSS: templates are operator-authored on localhost; sandbox blocks scripts/forms. */}
        <iframe
          title="Email preview"
          sandbox=""
          srcDoc={srcDoc}
          className="h-[min(32rem,55dvh)] w-full border-0 bg-white"
        />
      </div>
    </div>
  );
}
