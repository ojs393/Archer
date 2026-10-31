import type { CampaignView } from "./types";

type CampaignCounts = CampaignView["counts"];

/** Terminal outcomes that count toward progress (not pending/retry/sending). */
export function campaignDoneCount(c: Pick<CampaignCounts, "sent" | "failed" | "skipped_suppressed" | "uncertain">): number {
  return c.sent + c.failed + c.skipped_suppressed + c.uncertain;
}

export function campaignProgress(c: CampaignCounts): {
  done: number;
  total: number;
  ratio: number | null;
  label: string;
} {
  const done = campaignDoneCount(c);
  const total = c.total;
  return {
    done,
    total,
    ratio: total === 0 ? null : done / total,
    label: total === 0 ? "—" : `${done.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`,
  };
}
