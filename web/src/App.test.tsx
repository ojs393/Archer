import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Health, SettingsView, SetupView, StatusSnapshot } from "@/lib/types";
import { requestSetupWizard } from "@/lib/setupEvent";

class SilentEventSource {
  static instances: SilentEventSource[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(readonly url: string) {
    SilentEventSource.instances.push(this);
  }
  addEventListener(): void {}
  close(): void {}
}

const item = { status: "ok" as const, detail: "Connected", checkedAt: "2026-10-26T06:00:00.000Z" };
const health: Health = { smtp: item, dns: { ...item, status: "fail", detail: "SPF missing" }, network: item, worker: { ...item, heartbeatAgeMs: 10, loopRunning: true } };
const status: StatusSnapshot = { campaign: null, worker: { status: null, heartbeatAgeMs: null, loopRunning: false, inFlight: false } };
const setup: SetupView = {
  complete: true,
  completedAt: "2026-10-26T00:00:00.000Z",
  steps: { operator: true, provider: true, domain: true, addresses: true, testInboxes: true },
  regions: [],
};

const settings: SettingsView = {
  provider: "ses",
  sesRegion: "us-east-1",
  operatorName: "Oliver",
  organization: "",
  setupCompletedAt: "2026-10-26T00:00:00.000Z",
  fromName: "Oliver",
  fromEmail: "news@example.com",
  replyTo: null,
  postalAddress: "1 Main St",
  unsubMailbox: "unsub@example.com",
  publicBaseUrl: null,
  dkimSelector: "s1",
  timezone: "UTC",
  testInboxes: ["me@example.com"],
  smtp: { host: "email-smtp.us-east-1.amazonaws.com", port: 587, secure: false, user: "AKIA", passSet: true },
};

const ROUTES: Record<string, unknown> = {
  "/api/status": status,
  "/api/health": health,
  "/api/campaigns": [],
  "/api/lists": [],
  "/api/templates": [],
  "/api/setup": setup,
  "/api/settings": settings,
  "/api/analytics/summary": {
    totals: { recipients: 0, sent: 0, failed: 0, suppressed: 0, retry: 0, uncertain: 0, skipped: 0, pending: 0 },
    rates: { deliveryRate: 0, bounceRate: 0, rejectionRate: 0 },
    lastSendAt: null,
  },
  "/api/analytics/timeseries": { bucket: "hour", coverageFrom: null, points: [] },
  "/api/analytics/errors": { coverageFrom: null, rows: [] },
  "/api/analytics/runs": { rows: [] },
  "/api/analytics/feedback": {
    available: false,
    reason: "Feedback unavailable",
    guidance: ["Step one"],
  },
};

let fetchMock: ReturnType<typeof vi.fn>;
const fetchedUrls = () => fetchMock.mock.calls.map((c) => String(c[0]));
/** Cold lazy panels after resetModules often exceed the 1s default. */
const findTimeout = { timeout: 10_000 } as const;

async function renderApp(hash = "") {
  window.history.replaceState(null, "", `/${hash}`);
  const { App } = await import("./App");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<App client={client} />);
  await screen.findByRole("heading", { level: 1 }, findTimeout);
  return { ...view, client };
}

function panelHeading(name: string) {
  return screen.findByRole("heading", { level: 1, name }, findTimeout);
}

function shellTabs() {
  return within(screen.getByRole("tablist", { name: "Sections" }));
}

function selectTab(name: string) {
  fireEvent.mouseDown(shellTabs().getByRole("tab", { name }), { button: 0 });
}

beforeEach(() => {
  vi.resetModules();
  SilentEventSource.instances = [];
  ROUTES["/api/setup"] = setup;
  ROUTES["/api/settings"] = settings;
  vi.stubGlobal("EventSource", SilentEventSource);
  fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/session") return new Response(null, { status: 204 });
    const body = ROUTES[url.split("?")[0]];
    if (body === undefined) return new Response(JSON.stringify({ error: { code: "not_found", message: "Route not found" } }), { status: 404, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("App shell", () => {
  it("renders the brand and exactly five tabs, dashboard selected by default", async () => {
    await renderApp();
    expect(screen.getByRole("banner")).toHaveTextContent("Archer");
    const tabs = shellTabs().getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-label"))).toEqual(["Dashboard", "Runs", "Audience", "Templates", "Settings"]);
    expect(shellTabs().getByRole("tab", { name: "Dashboard" })).toHaveAttribute("aria-selected", "true");
    expect(window.location.hash).toBe("#/dashboard");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Dashboard");
  });

  it("opens the session before any other API call, and only once", async () => {
    await renderApp();
    await screen.findByRole("button", { name: "DNS: Failing" });
    const urls = fetchedUrls();
    expect(urls[0]).toBe("/api/session");
    expect(urls.filter((u) => u === "/api/session")).toHaveLength(1);
    expect(urls).toContain("/api/status");
    expect(urls).toContain("/api/health");
    expect(SilentEventSource.instances).toHaveLength(1);
    expect(SilentEventSource.instances[0].url).toBe("/api/events");
  });

  it("switches panels on tab click and records the tab in the hash", async () => {
    await renderApp();
    selectTab("Runs");
    expect(await panelHeading("Runs")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/runs");
    expect(await screen.findByText("No runs yet", {}, findTimeout)).toBeInTheDocument();

    selectTab("Settings");
    expect(await panelHeading("Settings")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/settings");
  });

  it("selects the tab named in the hash on load", async () => {
    await renderApp("#/templates");
    expect(shellTabs().getByRole("tab", { name: "Templates" })).toHaveAttribute("aria-selected", "true");
    expect(await panelHeading("Templates")).toBeInTheDocument();
  });

  it("follows back/forward navigation", async () => {
    await renderApp("#/audience");
    await panelHeading("Audience");
    act(() => {
      window.history.replaceState(null, "", "/#/runs");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(await panelHeading("Runs")).toBeInTheDocument();
    expect(shellTabs().getByRole("tab", { name: "Runs" })).toHaveAttribute("aria-selected", "true");
  });

  it("replaces the history entry while roving with arrow keys; a click pushes one", async () => {
    await renderApp();
    const start = window.history.length;
    const dashboard = shellTabs().getByRole("tab", { name: "Dashboard" });
    act(() => dashboard.focus());
    fireEvent.keyDown(dashboard, { key: "ArrowRight" });
    expect(await panelHeading("Runs")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/runs");
    fireEvent.keyDown(shellTabs().getByRole("tab", { name: "Runs" }), { key: "ArrowRight" });
    expect(await panelHeading("Audience")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/audience");
    expect(window.history.length).toBe(start);

    selectTab("Templates");
    expect(await panelHeading("Templates")).toBeInTheDocument();
    expect(window.location.hash).toBe("#/templates");
    expect(window.history.length).toBe(start + 1);
  });

  it("shows a not-found page for unknown hashes", async () => {
    await renderApp("#/runs");
    await panelHeading("Runs");
    act(() => {
      window.history.replaceState(null, "", "/#/no-such-tab");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(window.location.hash).toBe("#/not-found");
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to Dashboard" }));
    expect(await panelHeading("Dashboard")).toBeInTheDocument();
  });

  it("gives every button, including icon-only ones, an accessible name", async () => {
    await renderApp();
    await screen.findByRole("button", { name: "DNS: Failing" });
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const button of buttons) expect(button).toHaveAccessibleName();
    for (const tab of screen.getAllByRole("tab")) expect(tab).toHaveAccessibleName();
  });

  it("shows a retry state when the server cannot be reached", async () => {
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    window.history.replaceState(null, "", "/");
    const { App } = await import("./App");
    render(<App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />);
    expect(await screen.findByText("Cannot reach Archer", {}, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("auto-opens incomplete setup once; dismiss stays closed across refetch; SETUP_EVENT reopens", async () => {
    const dismissable: SetupView = {
      complete: false,
      completedAt: null,
      steps: { operator: false, provider: false, domain: false, addresses: false, testInboxes: false },
      regions: [],
    };
    ROUTES["/api/setup"] = dismissable;
    ROUTES["/api/settings"] = { ...settings, setupCompletedAt: null };

    const { client } = await renderApp();
    expect(await screen.findByRole("heading", { name: "Welcome to Archer" }, findTimeout)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Welcome to Archer" })).not.toBeInTheDocument();
    });

    await act(async () => {
      await client.invalidateQueries({ queryKey: ["setup"] });
    });
    await waitFor(() => {
      expect(fetchedUrls().filter((u) => u === "/api/setup").length).toBeGreaterThan(1);
    });
    expect(screen.queryByRole("heading", { name: "Welcome to Archer" })).not.toBeInTheDocument();

    act(() => {
      requestSetupWizard();
    });
    expect(await screen.findByRole("heading", { name: "Welcome to Archer" }, findTimeout)).toBeInTheDocument();
  });
});
