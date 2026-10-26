import type { DatabaseSync } from "node:sqlite";
import { getCampaignView } from "../campaigns/view.ts";
import type { WorkerActivity } from "../send/worker.ts";
import type { StatusSnapshot } from "./contract.ts";

export function statusSnapshot(db: DatabaseSync, worker: { getActivity(): WorkerActivity }, now: Date = new Date()): StatusSnapshot {
  const a = worker.getActivity();
  return {
    campaign: a.campaignId === null ? null : getCampaignView(db, a.campaignId, now),
    worker: {
      status: a.status,
      heartbeatAgeMs: Math.max(0, now.getTime() - a.heartbeatAt),
      loopRunning: a.loopRunning,
      inFlight: a.inFlightSince !== null,
    },
  };
}
