import type { CampaignStatus, HealthItem } from "./types";

export type Tone = "ok" | "warn" | "error" | "info" | "neutral";

export interface StatusView {
  label: string;
  tone: Tone;
  /** Animated dot: something is actively happening. */
  live?: boolean;
}

const CAMPAIGN_STATUS: Record<CampaignStatus, StatusView> = {
  draft: { label: "Draft", tone: "neutral" },
  running: { label: "Sending", tone: "ok", live: true },
  waiting_window: { label: "Waiting", tone: "info" },
  waiting_network: { label: "Offline", tone: "warn" },
  paused: { label: "Paused", tone: "warn" },
  safety_stop: { label: "Safety stop", tone: "error" },
  completed: { label: "Completed", tone: "neutral" },
  stopped: { label: "Stopped", tone: "neutral" },
};

const IDLE: StatusView = { label: "Idle", tone: "neutral" };

export function campaignStatusView(status: CampaignStatus | string | null | undefined): StatusView {
  if (!status) return IDLE;
  return Object.hasOwn(CAMPAIGN_STATUS, status) ? CAMPAIGN_STATUS[status as CampaignStatus] : { label: status, tone: "neutral" };
}

const HEALTH_STATUS: Record<HealthItem["status"], StatusView> = {
  ok: { label: "OK", tone: "ok" },
  fail: { label: "Failing", tone: "error" },
  unknown: { label: "Not checked", tone: "neutral" },
};

export function healthStatusView(status: HealthItem["status"] | undefined): StatusView {
  return status && Object.hasOwn(HEALTH_STATUS, status) ? HEALTH_STATUS[status] : HEALTH_STATUS.unknown;
}
