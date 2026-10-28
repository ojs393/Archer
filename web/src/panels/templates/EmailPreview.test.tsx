import { describe, expect, it } from "vitest";
import { fillPreviewVars } from "./EmailPreview";

describe("fillPreviewVars", () => {
  it("fills built-in merge tags from settings", () => {
    const out = fillPreviewVars("Hi {{first_name}} — {{postal_address}} {{unsubscribe_url}}", {
      fromName: "Ops",
      fromEmail: "ops@acme.test",
      postalAddress: "1 Main",
      publicBaseUrl: "https://mail.acme.test/",
      unsubMailbox: "u@acme.test",
    });
    expect(out).toContain("Hi Alex");
    expect(out).toContain("1 Main");
    expect(out).toContain("https://mail.acme.test/u/preview");
  });

  it("leaves unknown tags intact", () => {
    expect(fillPreviewVars("{{custom_field}}", null)).toBe("{{custom_field}}");
  });
});
