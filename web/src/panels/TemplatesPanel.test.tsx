import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { TemplateSummary, TemplateView } from "@/lib/types";
import TemplatesPanel from "./TemplatesPanel";

const EMOJI_RE = /\p{Extended_Pictographic}/u;
const summary: TemplateSummary = { id: 3, name: "Welcome", version: 2, updatedAt: "2026-10-25T12:00:00.000Z" };
const view: TemplateView = {
  id: 3, name: "Welcome", version: 2, subject: "Welcome aboard",
  html: "<p>Hello</p><p>{{unsubscribe_url}}</p><p>{{postal_address}}</p>", text: null,
  createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-25T12:00:00.000Z", variableMap: {},
  analysis: { variables: [], malformed: [], validation: { ok: true, unresolved: [], needsFallback: [] }, hasComplianceTags: true },
  linkCheck: null, testedOk: true,
};
let templatesState: TemplateSummary[];
let templateBodies: Map<number, TemplateView>;
let lastPut: { path: string; body: unknown } | null;
function json(data: unknown, code = 200) {
  return new Response(JSON.stringify(data), { status: code, headers: { "content-type": "application/json" } });
}
function renderTemplates() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><TooltipProvider><TemplatesPanel /></TooltipProvider></QueryClientProvider>);
}
beforeEach(() => {
  templatesState = [summary];
  templateBodies = new Map([[3, view]]);
  lastPut = null;
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    if (path === "/api/session") return new Response(null, { status: 204 });
    if (path === "/api/templates" && method === "GET") return json(templatesState);
    if (path === "/api/templates" && method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Partial<TemplateView>;
      const created: TemplateView = { ...view, id: 4, name: body.name ?? "New", subject: body.subject ?? "Subj", html: body.html ?? "<p></p>", version: 1 };
      templatesState = [...templatesState, { id: 4, name: created.name, version: 1, updatedAt: created.updatedAt }];
      templateBodies.set(4, created);
      return json(created);
    }
    if (path.match(/^\/api\/templates\/\d+$/) && method === "GET") {
      const id = Number(path.split("/").pop());
      const body = templateBodies.get(id);
      return body ? json(body) : json({ error: { code: "not_found", message: "missing" } }, 404);
    }
    if (path.match(/^\/api\/templates\/\d+$/) && method === "PUT") {
      const id = Number(path.split("/").pop());
      const body = JSON.parse(String(init?.body ?? "{}"));
      lastPut = { path, body };
      const prev = templateBodies.get(id)!;
      const next = { ...prev, ...body, version: prev.version + 1 };
      templateBodies.set(id, next);
      return json(next);
    }
    if (path.match(/^\/api\/templates\/\d+$/) && method === "DELETE") return new Response(null, { status: 204 });
    return json({ error: { code: "not_found", message: path } }, 404);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("TemplatesPanel", () => {
  it("renders templates from the API", async () => {
    renderTemplates();
    expect(await screen.findByRole("heading", { name: "Templates" })).toBeInTheDocument();
    expect(await screen.findByText("Welcome")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Welcome aboard")).toBeInTheDocument());
  });
  it("template editor save calls PUT", async () => {
    renderTemplates();
    await screen.findByText("Welcome");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    const subject = await within(dialog).findByDisplayValue("Welcome aboard");
    fireEvent.change(subject, { target: { value: "Updated subject" } });
    await within(dialog).findByDisplayValue("Updated subject");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(lastPut).not.toBeNull());
    expect(lastPut?.path).toBe("/api/templates/3");
    expect(lastPut?.body).toMatchObject({ subject: "Updated subject" });
  });
  it("has no emoji", async () => {
    renderTemplates();
    await screen.findByText("Welcome");
    expect(document.body.textContent ?? "").not.toMatch(EMOJI_RE);
  });

  it("opens a plain email preview when viewing", async () => {
    renderTemplates();
    await screen.findByText("Welcome");
    fireEvent.click(screen.getByRole("button", { name: "View" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("View template")).toBeInTheDocument();
    expect(within(dialog).getByTitle("Email preview")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/HTML body/i)).not.toBeInTheDocument();
  });
});
