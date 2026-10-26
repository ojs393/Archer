import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { DnsCheckResult, Health, SettingsView, SetupView, SmtpTestResult } from "@/lib/types";
import { SetupWizard } from "./SetupWizard";

const EMOJI_RE = /\p{Extended_Pictographic}/u;

const baseSettings: SettingsView = {
  provider: "ses",
  sesRegion: null,
  operatorName: "",
  organization: "",
  setupCompletedAt: null,
  fromName: "",
  fromEmail: "",
  replyTo: null,
  postalAddress: "",
  unsubMailbox: "",
  publicBaseUrl: null,
  dkimSelector: null,
  timezone: "UTC",
  testInboxes: [],
  smtp: { host: "", port: 587, secure: false, user: "", passSet: false },
};

const incompleteSetup: SetupView = {
  complete: false,
  completedAt: null,
  steps: { operator: false, provider: false, domain: false, addresses: false, testInboxes: false },
  regions: [
    { id: "us-east-1", label: "US East (N. Virginia)" },
    { id: "eu-west-1", label: "Europe (Ireland)" },
  ],
};

const completeSetup: SetupView = {
  ...incompleteSetup,
  complete: true,
  completedAt: "2026-10-26T00:00:00.000Z",
  steps: { operator: true, provider: true, domain: true, addresses: true, testInboxes: true },
};

const healthOk: Health = {
  smtp: { status: "ok", detail: "Connected", checkedAt: "2026-10-26T00:00:00.000Z" },
  dns: { status: "unknown", detail: "", checkedAt: null },
  network: { status: "ok", detail: "ok", checkedAt: "2026-10-26T00:00:00.000Z" },
  worker: { status: "ok", detail: "idle", checkedAt: "2026-10-26T00:00:00.000Z", heartbeatAgeMs: null, loopRunning: false },
};

const dnsFail: DnsCheckResult = {
  domain: "example.com",
  ok: false,
  spf: { ok: false, record: null, detail: "No SPF record", expected: "v=spf1 include:amazonses.com ~all" },
  dkim: { ok: false, selector: "s1", detail: "No DKIM record", expected: "s1._domainkey.example.com" },
  dmarc: { ok: false, record: null, detail: "No DMARC record", expected: "v=DMARC1; p=none;" },
};

let settingsState: SettingsView;
let setupState: SetupView;
let healthState: Health;
let putBodies: unknown[];
let posts: { path: string; body?: unknown }[];
let fetchMock: ReturnType<typeof vi.fn>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function renderWizard(open = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SetupWizard open={open} onOpenChange={onOpenChange} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return { ...view, onOpenChange, client };
}

async function waitReady() {
  expect(await screen.findByRole("heading", { name: "Welcome to MamaDirect" }, { timeout: 10_000 })).toBeInTheDocument();
  expect(await screen.findByLabelText("Your name", {}, { timeout: 10_000 })).toBeInTheDocument();
}

async function fillOperatorAndNext() {
  fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Oliver" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByRole("heading", { name: "Provider" })).toBeInTheDocument();
}

beforeEach(() => {
  settingsState = structuredClone(baseSettings);
  setupState = structuredClone(incompleteSetup);
  healthState = structuredClone(healthOk);
  healthState.smtp = { status: "unknown", detail: "", checkedAt: null };
  putBodies = [];
  posts = [];
  Element.prototype.scrollIntoView = vi.fn();

  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();

    if (path === "/api/session") return new Response(null, { status: 204 });
    if (path === "/api/setup" && method === "GET") return json(setupState);
    if (path === "/api/settings" && method === "GET") return json(settingsState);
    if (path === "/api/health" && method === "GET") return json(healthState);

    if (path === "/api/settings" && method === "PUT") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      putBodies.push(body);
      if (typeof body.operatorName === "string") settingsState.operatorName = body.operatorName;
      if (typeof body.organization === "string") settingsState.organization = body.organization;
      if (body.provider === "ses" || body.provider === "smtp") settingsState.provider = body.provider;
      if ("sesRegion" in body) settingsState.sesRegion = (body.sesRegion as string | null) ?? null;
      if (typeof body.fromEmail === "string") settingsState.fromEmail = body.fromEmail;
      if ("dkimSelector" in body) settingsState.dkimSelector = (body.dkimSelector as string | null) ?? null;
      if (typeof body.fromName === "string") settingsState.fromName = body.fromName;
      if (typeof body.unsubMailbox === "string") settingsState.unsubMailbox = body.unsubMailbox;
      if (typeof body.postalAddress === "string") settingsState.postalAddress = body.postalAddress;
      if ("replyTo" in body) settingsState.replyTo = (body.replyTo as string | null) ?? null;
      if ("publicBaseUrl" in body) settingsState.publicBaseUrl = (body.publicBaseUrl as string | null) ?? null;
      if (Array.isArray(body.testInboxes)) settingsState.testInboxes = body.testInboxes as string[];
      const smtp = body.smtp as Record<string, unknown> | undefined;
      if (smtp) {
        if (typeof smtp.host === "string") settingsState.smtp.host = smtp.host;
        if (typeof smtp.port === "number") settingsState.smtp.port = smtp.port;
        if (typeof smtp.secure === "boolean") settingsState.smtp.secure = smtp.secure;
        if (typeof smtp.user === "string") settingsState.smtp.user = smtp.user;
        if (typeof smtp.pass === "string") settingsState.smtp.passSet = true;
        if (smtp.clearPass === true) settingsState.smtp.passSet = false;
      }
      if (settingsState.operatorName.trim()) setupState.steps.operator = true;
      if (
        (settingsState.provider === "ses" && settingsState.sesRegion && settingsState.smtp.user && settingsState.smtp.passSet) ||
        (settingsState.provider === "smtp" && settingsState.smtp.host && settingsState.smtp.user && settingsState.smtp.passSet)
      ) {
        setupState.steps.provider = true;
      }
      if (settingsState.fromEmail && settingsState.unsubMailbox && settingsState.postalAddress.trim()) {
        setupState.steps.addresses = true;
      }
      if (settingsState.testInboxes.length > 0) setupState.steps.testInboxes = true;
      return json(settingsState);
    }

    if (path === "/api/settings/smtp/test" && method === "POST") {
      posts.push({ path });
      const result: SmtpTestResult = { ok: true, message: "Connected" };
      healthState.smtp = { status: "ok", detail: result.message, checkedAt: new Date().toISOString() };
      return json(result);
    }

    if (path === "/api/settings/dns/check" && method === "POST") {
      posts.push({ path });
      return json(dnsFail);
    }

    if (path === "/api/system/desktop-launcher" && method === "POST") {
      posts.push({ path });
      return json({ ok: true, path: "/Users/test/Desktop/MamaDirect.command" });
    }

    if (path === "/api/setup/complete" && method === "POST") {
      posts.push({ path, body: init?.body });
      if (!setupState.steps.operator || !setupState.steps.provider || !setupState.steps.addresses || !setupState.steps.testInboxes) {
        return json(
          { error: { code: "setup_incomplete", message: "Setup incomplete", details: setupState.steps } },
          409,
        );
      }
      setupState = { ...setupState, complete: true, completedAt: "2026-10-26T12:00:00.000Z" };
      return json(setupState);
    }

    return json({ error: { code: "not_found", message: path } }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(async () => undefined) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SetupWizard", () => {
  it("opens when setup.complete is false", async () => {
    renderWizard(true);
    await waitReady();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not render dialog content when closed even if setup is incomplete", async () => {
    renderWizard(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not open when setup is already complete (controlled open=false)", async () => {
    setupState = structuredClone(completeSetup);
    settingsState.setupCompletedAt = completeSetup.completedAt;
    renderWizard(false);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Next saves via api.put and advances; Previous goes back", async () => {
    renderWizard();
    await waitReady();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Oliver" } });
    fireEvent.change(screen.getByLabelText("Organization"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => expect(putBodies.length).toBe(1));
    expect(putBodies[0]).toMatchObject({ operatorName: "Oliver", organization: "Acme" });
    expect(await screen.findByRole("heading", { name: "Provider" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(await screen.findByRole("heading", { name: "Welcome to MamaDirect" })).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toHaveValue("Oliver");
  });

  it("switches SES vs SMTP fields", async () => {
    renderWizard();
    await waitReady();
    await fillOperatorAndNext();

    expect(screen.getByLabelText("SES region")).toBeInTheDocument();
    expect(screen.queryByLabelText("SMTP host")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Other SMTP/i));
    expect(await screen.findByLabelText("SMTP host")).toBeInTheDocument();
    expect(screen.queryByLabelText("SES region")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Implicit TLS")).toBeInTheDocument();
  });

  it("Test connection, Check DNS, and Add to Desktop hit the right endpoints", async () => {
    renderWizard();
    await waitReady();
    await fillOperatorAndNext();

    fireEvent.change(screen.getByLabelText("SMTP username"), { target: { value: "AKIAEXAMPLE" } });
    // Select region via the select trigger
    fireEvent.click(screen.getByLabelText("SES region"));
    fireEvent.click(await screen.findByRole("option", { name: /US East/ }));
    fireEvent.change(screen.getByLabelText("SMTP password"), { target: { value: "secret-pass" } });

    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(posts.some((p) => p.path === "/api/settings/smtp/test")).toBe(true));
    expect(await screen.findByText("Connected")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Domain" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("From email"), { target: { value: "hi@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Check DNS" }));
    await waitFor(() => expect(posts.some((p) => p.path === "/api/settings/dns/check")).toBe(true));
    expect(await screen.findByText("SPF")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Addresses" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("From name"), { target: { value: "Acme" } });
    fireEvent.change(screen.getByLabelText("Unsubscribe mailbox"), { target: { value: "unsub@example.com" } });
    fireEvent.change(screen.getByLabelText("Postal address"), { target: { value: "1 Main St" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByRole("heading", { name: "Test inboxes" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to Desktop" }));
    await waitFor(() => expect(posts.some((p) => p.path === "/api/system/desktop-launcher")).toBe(true));
    expect(await screen.findByText(/MamaDirect\.command/)).toBeInTheDocument();
  });

  it("surfaces 409 missing steps from complete", async () => {
    settingsState = {
      ...baseSettings,
      operatorName: "Oliver",
      organization: "Acme",
      provider: "ses",
      sesRegion: "us-east-1",
      fromName: "Acme",
      fromEmail: "hi@example.com",
      unsubMailbox: "unsub@example.com",
      postalAddress: "1 Main St",
      smtp: { host: "", port: 587, secure: false, user: "user", passSet: true },
      testInboxes: ["me@example.com"],
    };
    setupState.steps = { operator: true, provider: true, domain: false, addresses: true, testInboxes: true };
    healthState.smtp = { status: "ok", detail: "Connected", checkedAt: "2026-10-26T00:00:00.000Z" };

    // Override complete to always 409 with missing provider
    const original = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      const method = (init?.method ?? "GET").toUpperCase();
      if (path === "/api/setup/complete" && method === "POST") {
        posts.push({ path });
        return json(
          {
            error: {
              code: "setup_incomplete",
              message: "Setup incomplete",
              details: { operator: true, provider: false, domain: false, addresses: true, testInboxes: true },
            },
          },
          409,
        );
      }
      return original(url, init);
    });

    const { onOpenChange } = renderWizard();
    await waitReady();
    for (const title of ["Provider", "Domain", "Addresses", "Test inboxes"] as const) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/provider/i);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("Finish succeeds, calls complete, and closes", async () => {
    settingsState = {
      ...baseSettings,
      operatorName: "Oliver",
      organization: "Acme",
      provider: "ses",
      sesRegion: "us-east-1",
      fromName: "Acme",
      fromEmail: "hi@example.com",
      unsubMailbox: "unsub@example.com",
      postalAddress: "1 Main St",
      smtp: { host: "", port: 587, secure: false, user: "user", passSet: true },
      testInboxes: ["me@example.com"],
    };
    setupState.steps = { operator: true, provider: true, domain: false, addresses: true, testInboxes: true };
    healthState.smtp = { status: "ok", detail: "Connected", checkedAt: "2026-10-26T00:00:00.000Z" };

    const { onOpenChange } = renderWizard();
    await waitReady();
    for (const title of ["Provider", "Domain", "Addresses", "Test inboxes"] as const) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
      expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(posts.some((p) => p.path === "/api/setup/complete")).toBe(true));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(window.location.hash).toBe("#/dashboard");
  });

  it("renders no emoji characters", async () => {
    renderWizard();
    await waitReady();
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent ?? "").not.toMatch(EMOJI_RE);
    // Spot-check other steps briefly
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Oliver" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "Provider" });
    expect(screen.getByRole("dialog").textContent ?? "").not.toMatch(EMOJI_RE);
  });
});

describe("App opens wizard from setup.complete", () => {
  it("opens the wizard when setup.complete is false after session ready", async () => {
    vi.resetModules();
    const setup = structuredClone(incompleteSetup);
    const status = {
      campaign: null,
      worker: { status: null, heartbeatAgeMs: null, loopRunning: false, inFlight: false },
    };
    const item = { status: "ok" as const, detail: "ok", checkedAt: "2026-10-26T00:00:00.000Z" };
    const health: Health = {
      smtp: item,
      dns: item,
      network: item,
      worker: { ...item, heartbeatAgeMs: null, loopRunning: false },
    };

    class SilentEventSource {
      onopen: ((ev: Event) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      constructor(readonly url: string) {}
      addEventListener(): void {}
      close(): void {}
    }
    vi.stubGlobal("EventSource", SilentEventSource);

    const mockFetch = vi.fn(async (url: string) => {
      const path = String(url).split("?")[0];
      if (path === "/api/session") return new Response(null, { status: 204 });
      if (path === "/api/setup") return json(setup);
      if (path === "/api/settings") return json(baseSettings);
      if (path === "/api/health") return json(health);
      if (path === "/api/status") return json(status);
      if (path === "/api/campaigns" || path === "/api/lists" || path === "/api/templates") return json([]);
      return json({ error: { code: "not_found", message: path } }, 404);
    });
    vi.stubGlobal("fetch", mockFetch);

    window.history.replaceState(null, "", "/");
    const { App } = await import("../../App");
    render(
      <App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />,
    );
    expect(await screen.findByRole("heading", { name: "Welcome to MamaDirect" })).toBeInTheDocument();
  });

  it("does not open the wizard when setup.complete is true", async () => {
    vi.resetModules();
    const setup = structuredClone(completeSetup);
    const status = {
      campaign: null,
      worker: { status: null, heartbeatAgeMs: null, loopRunning: false, inFlight: false },
    };
    const item = { status: "ok" as const, detail: "ok", checkedAt: "2026-10-26T00:00:00.000Z" };
    const health: Health = {
      smtp: item,
      dns: item,
      network: item,
      worker: { ...item, heartbeatAgeMs: null, loopRunning: false },
    };

    class SilentEventSource {
      onopen: ((ev: Event) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      constructor(readonly url: string) {}
      addEventListener(): void {}
      close(): void {}
    }
    vi.stubGlobal("EventSource", SilentEventSource);

    const mockFetch = vi.fn(async (url: string) => {
      const path = String(url).split("?")[0];
      if (path === "/api/session") return new Response(null, { status: 204 });
      if (path === "/api/setup") return json(setup);
      if (path === "/api/settings") return json({ ...baseSettings, setupCompletedAt: setup.completedAt });
      if (path === "/api/health") return json(health);
      if (path === "/api/status") return json(status);
      if (path === "/api/campaigns" || path === "/api/lists" || path === "/api/templates") return json([]);
      return json({ error: { code: "not_found", message: path } }, 404);
    });
    vi.stubGlobal("fetch", mockFetch);

    window.history.replaceState(null, "", "/");
    const { App } = await import("../../App");
    render(
      <App client={new QueryClient({ defaultOptions: { queries: { retry: false } } })} />,
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Dashboard" }, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Welcome to MamaDirect" })).not.toBeInTheDocument();
  });
});
