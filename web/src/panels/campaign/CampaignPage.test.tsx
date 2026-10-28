import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CampaignView } from "@/lib/types";
import CampaignPage from "./CampaignPage";

const campaign: CampaignView = {
  id: 9,
  listId: 1,
  templateId: 2,
  templateVersion: 1,
  status: "running",
  displayName: "VIP welcome blast",
  listName: "VIP",
  templateName: "Welcome",
  title: "VIP welcome blast",
  pauseReason: null,
  tags: ["vip"],
  schedule: {
    timezone: "America/New_York",
    startTime: "09:00",
    endTime: "17:00",
    sendDays: [1, 2, 3, 4, 5],
    dailyCap: 200,
    delaySeconds: 2,
    warmup: false,
  },
  counts: {
    pending: 10,
    sending: 0,
    sent: 5,
    retry: 0,
    failed: 0,
    uncertain: 0,
    skipped_suppressed: 0,
    total: 15,
  },
  stats: { sentLastHour: 2, rejectionRate: 0, sample: 5 },
  estimate: { perDay: [], completionDate: null, totalDays: 0 },
  startedAt: "2026-10-27T12:00:00.000Z",
  finishedAt: null,
  createdAt: "2026-10-27T11:00:00.000Z",
};

function json(data: unknown, code = 200) {
  return new Response(JSON.stringify(data), { status: code, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const path = String(url).split("?")[0];
    if (path === "/api/session") return new Response(null, { status: 204 });
    if (path === "/api/campaigns/9") return json(campaign);
    if (path === "/api/analytics/summary") {
      return json({
        totals: { recipients: 15, sent: 5, failed: 0, suppressed: 0, retry: 0, uncertain: 0, skipped: 0, pending: 10 },
        rates: { deliveryRate: 1, bounceRate: 0, rejectionRate: 0 },
        lastSendAt: campaign.startedAt,
      });
    }
    if (path === "/api/analytics/timeseries") {
      return json({
        bucket: "hour",
        coverageFrom: null,
        points: [{ t: "2026-10-27T12:00:00.000Z", sent: 5, failed: 0, suppressed: 0, retry: 0, uncertain: 0 }],
      });
    }
    return json({ error: { code: "not_found", message: path } }, 404);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CampaignPage", () => {
  it("stacks back link above title without a tall empty band", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <CampaignPage id={9} tab="overview" />
        </TooltipProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("heading", { name: "VIP welcome blast" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /All runs/i })).toBeInTheDocument();
    expect(screen.getByText(/Sending — counts and activity update live/)).toBeInTheDocument();
  });
});
