import type { CampaignView } from "../../../server/http/contract.ts";

export type {
  ApiErrorBody,
  CampaignView,
  Health,
  HealthItem,
  ImportEvent,
  StatusSnapshot,
  WorkerEvent,
} from "../../../server/http/contract.ts";

export type CampaignStatus = CampaignView["status"];
