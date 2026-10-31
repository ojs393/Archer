import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NEW_RUN_EVENT } from "@/lib/newRunEvent";
import type { CampaignView, Gate, ListRow, SettingsView, TemplateSummary, TemplateView } from "@/lib/types";
import RunsPanel from "./RunsPanel";

const EMOJI_RE = /\p{Extended_Pictographic}/u;

const list: ListRow & { tags: string[] } = {
  id: 1, name: "Autumn", source_label: "csv", consent_text: "yes", consent_at: "2026-10-01T00:00:00.000Z",
  exclude_roles: 1, email_column: "email", status: "ready", total_rows: 10, valid_count: 8, invalid_count: 1,
  duplicate_count: 0, suppressed_count: 1, role_count: 0, error: null, created_at: "2026-10-01T00:00:00.000Z",
  tags: [],
};
const templateSummary: TemplateSummary = { id: 2, name: "Promo", version: 1, updatedAt: "2026-10-20T00:00:00.000Z" };
const templateView: TemplateView = {
  id: 2, name: "Promo", version: 1, subject: "Hello {{first_name}}", html: "<p>Hi</p>", text: null,
  createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z", variableMap: {},
  analysis: { variables: [], malformed: [], validation: { ok: true, unresolved: [], needsFallback: [] }, hasComplianceTags: true },
  linkCheck: null, testedOk: true,
};
const schedule = { timezone: "UTC", sendDays: [1,2,3,4,5], startTime: "09:00", endTime: "17:00", dailyCap: 2000, warmup: false, delaySeconds: 10 };
const campaign: CampaignView = {
  id: 9, listId: 1, templateId: 2, templateVersion: 1, status: "running", pauseReason: null, schedule,
  title: null, tags: [], displayName: "Autumn · Promo", listName: "Autumn", templateName: "Promo",
  createdAt: "2026-10-26T08:00:00.000Z", startedAt: "2026-10-26T08:05:00.000Z", finishedAt: null,
  counts: { pending: 5, sending: 0, sent: 3, retry: 0, failed: 0, uncertain: 0, skipped_suppressed: 0, total: 8 },
  estimate: { perDay: [], completionDate: "2026-10-27", totalDays: 1 },
  stats: { sentLastHour: 3, rejectionRate: 0, sample: 3 },
};
const settings: SettingsView = {
  provider: "smtp", sesRegion: null, operatorName: "Op", organization: "Org", setupCompletedAt: "2026-10-01T00:00:00.000Z",
  fromName: "Mama", fromEmail: "hello@example.com", replyTo: null, postalAddress: "1 Main St", unsubMailbox: "unsub@example.com",
  publicBaseUrl: null, dkimSelector: null, timezone: "UTC", testInboxes: ["test@example.com"],
  smtp: { host: "smtp.example.com", port: 587, secure: false, user: "u", passSet: true },
};
const failingGates: Gate[] = [
  { key: "smtp_verified", ok: false, message: "Test connection first" },
  { key: "from_email", ok: true, message: "From set" },
];

let campaignsState: CampaignView[];
let startShouldFailGates = false;
function json(data: unknown, code = 200) {
  return new Response(JSON.stringify(data), { status: code, headers: { "content-type": "application/json" } });
}
function renderRuns() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><TooltipProvider><RunsPanel /></TooltipProvider></QueryClientProvider>);
}

beforeEach(() => {
  campaignsState = [campaign];
  startShouldFailGates = false;
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    if (path === "/api/session") return new Response(null, { status: 204 });
    if (path === "/api/campaigns" && method === "GET") return json(campaignsState);
    if (path === "/api/campaigns" && method === "POST") {
      const created = { ...campaign, id: 99, status: "draft" as const, startedAt: null };
      campaignsState = [...campaignsState, created];
      return json(created, 201);
    }
    if (path === "/api/campaigns/99/start" && method === "POST") {
      if (startShouldFailGates) return json({ error: { code: "gates_failed", message: "fail", details: failingGates } }, 409);
      return json({ ...campaign, id: 99, status: "running" });
    }
    if (path.match(/^\/api\/campaigns\/\d+\/(pause|resume|stop)$/)) return json(campaign);
    if (path === "/api/lists") return json([list]);
    if (path === "/api/tags") return json({ tags: [] });
    if (path === "/api/templates") return json([templateSummary]);
    if (path === "/api/templates/2") return json(templateView);
    if (path === "/api/templates/2/preview") return json({ contactId: null, email: "a@x.com", subject: "Hello Alex", html: "<p>Hi</p>", text: "Hi" });
    if (path === "/api/settings") return json(settings);
    if (path === "/api/health") return json({ smtp: { status: "ok", detail: "", checkedAt: null }, dns: { status: "ok", detail: "", checkedAt: null }, network: { status: "ok", detail: "", checkedAt: null }, worker: { status: "ok", detail: "", checkedAt: null, heartbeatAgeMs: null, loopRunning: false } });
    if (path === "/api/status") return json({ campaign: null, worker: { status: null, heartbeatAgeMs: null, loopRunning: false, inFlight: false } });
    if (path === "/api/estimate") return json({ perDay: [{ date: "2026-10-27", count: 8 }], completionDate: "2026-10-27", totalDays: 1 });
    return json({ error: { code: "not_found", message: path } }, 404);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); window.history.replaceState(null, "", "/"); });

describe("RunsPanel", () => {
  it("renders runs from the campaigns API", async () => {
    renderRuns();
    expect(await screen.findByRole("heading", { name: "Runs" })).toBeInTheDocument();
    expect(await screen.findByText("Autumn · Promo")).toBeInTheDocument();
    expect(screen.getByText("3 of 8")).toBeInTheDocument();
  });
  it("opens the New Run wizard from the header and from archer:new-run", async () => {
    renderRuns();
    await screen.findByRole("heading", { name: "Runs" });
    fireEvent.click(screen.getByRole("button", { name: "New run" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    act(() => { window.dispatchEvent(new Event(NEW_RUN_EVENT)); });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
  it("blocks Start when launch gates fail and lists the failures", async () => {
    startShouldFailGates = true;
    campaignsState = [];
    sessionStorage.setItem("archer:run-draft", JSON.stringify({ listId: 1, templateId: 2, mode: "window", schedule }));
    renderRuns();
    fireEvent.click(await screen.findByRole("button", { name: "New run" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/Autumn/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    await within(dialog).findByRole("combobox", { name: "Template" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    await within(dialog).findByLabelText(/Mode|Schedule mode/i);
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    const start = await within(dialog).findByRole("button", { name: "Start run" });
    fireEvent.click(start);
    expect(await within(dialog).findByText(/Launch checks failed/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Test connection first/)).toBeInTheDocument();
  });
  it("has no emoji in the panel chrome", async () => {
    renderRuns();
    await screen.findByText("Autumn · Promo");
    expect(document.body.textContent ?? "").not.toMatch(EMOJI_RE);
  });
});
