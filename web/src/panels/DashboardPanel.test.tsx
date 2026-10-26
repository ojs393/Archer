import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NEW_RUN_EVENT } from "@/lib/newRunEvent";
import type {
  AnalyticsErrors,
  AnalyticsFeedback,
  AnalyticsRuns,
  AnalyticsSummary,
  AnalyticsTimeseries,
  StatusSnapshot,
} from "@/lib/types";
import DashboardPanel from "./DashboardPanel";

const EMOJI_RE = /\p{Extended_Pictographic}/u;

const summary: AnalyticsSummary = {
  totals: { recipients: 16, sent: 8, failed: 1, suppressed: 2, retry: 1, uncertain: 1, skipped: 1, pending: 2 },
  rates: { deliveryRate: 8 / 11, bounceRate: 2 / 11, rejectionRate: 3 / 11 },
  lastSendAt: "2026-10-26T12:01:00.000Z",
};

const emptySummary: AnalyticsSummary = {
  totals: { recipients: 0, sent: 0, failed: 0, suppressed: 0, retry: 0, uncertain: 0, skipped: 0, pending: 0 },
  rates: { deliveryRate: 0, bounceRate: 0, rejectionRate: 0 },
  lastSendAt: null,
};

const timeseries: AnalyticsTimeseries = {
  bucket: "hour",
  coverageFrom: "2026-10-26T09:00:00.000Z",
  points: [
    { t: "2026-10-26T08:00:00.000Z", sent: 0, failed: 0, suppressed: 0, retry: 0, uncertain: 0 },
    { t: "2026-10-26T09:00:00.000Z", sent: 3, failed: 0, suppressed: 0, retry: 0, uncertain: 0 },
    { t: "2026-10-26T10:00:00.000Z", sent: 2, failed: 1, suppressed: 0, retry: 0, uncertain: 0 },
  ],
};

const errors: AnalyticsErrors = {
  coverageFrom: "2026-10-26T09:00:00.000Z",
  rows: [{ kind: "failed", message: "Failed <email>: mailbox unavailable", count: 1, lastAt: "2026-10-26T10:59:59.999Z" }],
};

const runs: AnalyticsRuns = {
  rows: [
    {
      id: 2,
      name: "Autumn list · Promo",
      status: "paused",
      recipients: 6,
      sent: 3,
      failed: 0,
      suppressed: 1,
      uncertain: 0,
      deliveryRate: 3 / 4,
      startedAt: "2026-10-20T07:00:00.000Z",
      finishedAt: null,
    },
  ],
};

const feedback: AnalyticsFeedback = {
  available: false,
  reason: "Spam complaints require SES SNS notifications. This version does not receive them.",
  guidance: [
    "Open the Amazon SES console in the region you send from.",
    "Create an SNS topic for MamaDirect feedback.",
    "Wire Bounce and Complaint notifications to that topic.",
  ],
};

const status: StatusSnapshot = {
  campaign: null,
  worker: { status: null, heartbeatAgeMs: null, loopRunning: false, inFlight: false },
};

let summaryState: AnalyticsSummary;
let fetchMock: ReturnType<typeof vi.fn>;

function json(data: unknown, code = 200) {
  return new Response(JSON.stringify(data), { status: code, headers: { "content-type": "application/json" } });
}

function renderDashboard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <DashboardPanel />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  summaryState = summary;
  fetchMock = vi.fn(async (url: string) => {
    const path = String(url).split("?")[0];
    if (path === "/api/session") return new Response(null, { status: 204 });
    if (path === "/api/status") return json(status);
    if (path === "/api/analytics/summary") return json(summaryState);
    if (path === "/api/analytics/timeseries") return json(timeseries);
    if (path === "/api/analytics/errors") return json(errors);
    if (path === "/api/analytics/runs") return json(runs);
    if (path === "/api/analytics/feedback") return json(feedback);
    return json({ error: { code: "not_found", message: "missing" } }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("DashboardPanel", () => {
  it("renders stats from the analytics summary", async () => {
    renderDashboard();
    expect(await screen.findByText("8")).toBeInTheDocument();
    expect(screen.getByText("73%")).toBeInTheDocument();
    expect(screen.getByText("18%")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("shows em dash for rates when there are no recipients", async () => {
    summaryState = emptySummary;
    renderDashboard();
    expect(await screen.findAllByText("—")).toHaveLength(2);
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("notes coverageFrom on Overview instead of inventing early zeros", async () => {
    renderDashboard();
    await screen.findByText("8");
    expect(await screen.findByText(/Showing data from/)).toBeInTheDocument();
    expect(screen.getByText(/older events rotated out/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("overview-chart")).toBeInTheDocument());
  });

  it("shows feedback guidance without fake spam rates", async () => {
    renderDashboard();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Feedback" }));
    expect(await screen.findByText(feedback.reason)).toBeInTheDocument();
    expect(screen.queryByText(/complaint rate/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/spam rate/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "How to connect SES feedback" }));
    const hint = await screen.findByRole("dialog");
    for (const line of feedback.guidance) {
      expect(within(hint).getByText(line)).toBeInTheDocument();
    }
  });

  it("dispatches mamadirect:new-run from the Runs empty state", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const path = String(url).split("?")[0];
      if (path === "/api/session") return new Response(null, { status: 204 });
      if (path === "/api/status") return json(status);
      if (path === "/api/analytics/summary") return json(emptySummary);
      if (path === "/api/analytics/timeseries") return json({ ...timeseries, coverageFrom: null, points: [] });
      if (path === "/api/analytics/errors") return json({ coverageFrom: null, rows: [] });
      if (path === "/api/analytics/runs") return json({ rows: [] });
      if (path === "/api/analytics/feedback") return json(feedback);
      return json({ error: { code: "not_found", message: "missing" } }, 404);
    });
    const seen: Event[] = [];
    const onNewRun = (e: Event) => seen.push(e);
    window.addEventListener(NEW_RUN_EVENT, onNewRun);
    renderDashboard();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Runs" }));
    const button = await screen.findByRole("button", { name: "New run" });
    act(() => {
      fireEvent.click(button);
    });
    expect(seen).toHaveLength(1);
    expect(window.location.hash).toBe("#/runs");
    window.removeEventListener(NEW_RUN_EVENT, onNewRun);
  });

  it("contains no emoji in the rendered dashboard", async () => {
    renderDashboard();
    await screen.findByText("8");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Feedback" }));
    await screen.findByText(feedback.reason);
    expect(document.body.textContent ?? "").not.toMatch(EMOJI_RE);
  });
});
