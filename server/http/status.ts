import type { DatabaseSync } from "node:sqlite";
import { getCampaignView } from "../campaigns/view.ts";
import type { HealthMonitor } from "../health/monitor.ts";
import type { SendWorker, WorkerActivity, WorkerEvent } from "../send/worker.ts";
import type { StatusSnapshot } from "./contract.ts";
import type { EventHub } from "./events.ts";

export function wireWorkerEvents(opts: { db: DatabaseSync; worker: SendWorker; events: EventHub; health: HealthMonitor }): void {
  const { db, worker, events, health } = opts;
  worker.on("event", (event: WorkerEvent) => {
    events.publish("worker", event);
    if (event.type !== "status") return;
    events.publish("status", statusSnapshot(db, worker));
    health.notify();
  });
}

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
