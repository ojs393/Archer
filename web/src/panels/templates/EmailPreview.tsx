/** Plain email-shaped preview (sandbox iframe — not raw HTML source). */
export function EmailPreview({
  subject,
  html,
  name,
}: {
  subject: string;
  html: string;
  name?: string;
}) {
  const body = html.slice(0, 12_000) || "<p></p>";
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:16px;font:14px/1.5 system-ui,sans-serif;color:#18181b;background:#fff;}
    a{color:#2563eb;}
  </style></head><body>${body}</body></html>`;

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {name ? <p className="text-sm font-medium text-foreground">{name}</p> : null}
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</p>
      <div className="overflow-hidden rounded-md border border-border bg-white shadow-card ring-1 ring-black/[0.04]">
        <div className="border-b border-border bg-zinc-50 px-3 py-2">
          <p className="truncate text-sm text-foreground">
            <span className="text-muted-foreground">Subject · </span>
            {subject.trim() || "—"}
          </p>
        </div>
        {/* XSS: templates are operator-authored on localhost; sandbox blocks scripts/forms. */}
        <iframe
          title="Email preview"
          sandbox=""
          srcDoc={srcDoc}
          className="h-[min(28rem,50dvh)] w-full border-0 bg-white"
        />
      </div>
    </div>
  );
}
