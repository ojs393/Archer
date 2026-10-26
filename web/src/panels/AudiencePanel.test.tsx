import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ListPreview, ListRow } from "@/lib/types";
import AudiencePanel from "./AudiencePanel";

const EMOJI_RE = /\p{Extended_Pictographic}/u;
const list: ListRow = {
  id: 1, name: "Autumn", source_label: "csv", consent_text: "yes", consent_at: "2026-10-01T00:00:00.000Z",
  exclude_roles: 1, email_column: "email", status: "ready", total_rows: 12, valid_count: 10, invalid_count: 1,
  duplicate_count: 0, suppressed_count: 1, role_count: 0, error: null, created_at: "2026-10-01T00:00:00.000Z",
};
const preview: ListPreview = {
  delimiter: ",", headers: ["email", "first_name"], headerless: false,
  rows: [["a@example.com", "Alex"], ["b@example.com", "Bo"]], emailColumn: 0,
};
let listsState: ListRow[];
function json(data: unknown, code = 200) {
  return new Response(JSON.stringify(data), { status: code, headers: { "content-type": "application/json" } });
}
function renderAudience() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><TooltipProvider><AudiencePanel /></TooltipProvider></QueryClientProvider>);
}
beforeEach(() => {
  listsState = [list];
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    if (path === "/api/session") return new Response(null, { status: 204 });
    if (path === "/api/lists" && method === "GET") return json(listsState);
    if (path === "/api/lists/preview" && method === "POST") return json(preview);
    if (path === "/api/lists" && method === "POST") {
      const imported: ListRow = { ...list, id: 7, name: "Imported", status: "ready", valid_count: 5, invalid_count: 2, suppressed_count: 1, duplicate_count: 0, role_count: 0, total_rows: 8 };
      listsState = [imported, ...listsState];
      return json({ listId: 7 }, 202);
    }
    if (path === "/api/lists/1" && method === "GET") return json({ ...list, columns: ["first_name", "company"] });
    if (path === "/api/lists/7" && method === "GET") return json({ ...listsState.find((l) => l.id === 7)!, columns: [] });
    if (path.match(/^\/api\/lists\/\d+$/) && method === "DELETE") return new Response(null, { status: 204 });
    return json({ error: { code: "not_found", message: path } }, 404);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("AudiencePanel", () => {
  it("renders lists from the API", async () => {
    renderAudience();
    expect(await screen.findByRole("heading", { name: "Audience" })).toBeInTheDocument();
    expect(await screen.findByText("Autumn")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });
  it("import dialog surfaces counts after upload", async () => {
    listsState = [];
    renderAudience();
    fireEvent.click(await screen.findByRole("button", { name: "Import CSV" }));
    const dialog = await screen.findByRole("dialog");
    const file = new File(["email,first_name\na@x.com,Alex\n"], "people.csv", { type: "text/csv" });
    fireEvent.change(within(dialog).getByTestId("import-file"), { target: { files: [file] } });
    await within(dialog).findByText("a@example.com");
    fireEvent.click(within(dialog).getByLabelText(/consented to receive email/i));
    fireEvent.click(within(dialog).getByRole("button", { name: "Import" }));
    const result = await within(dialog).findByTestId("import-result");
    await waitFor(() => { expect(result.textContent).toMatch(/Imported:\s*5/); });
    expect(result.textContent).toMatch(/Invalid:\s*2/);
  });
  it("has no emoji", async () => {
    renderAudience();
    await screen.findByText("Autumn");
    expect(document.body.textContent ?? "").not.toMatch(EMOJI_RE);
  });
});
