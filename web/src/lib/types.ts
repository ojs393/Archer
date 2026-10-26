import type { CampaignView } from "../../../server/http/contract.ts";

export type {
  ApiErrorBody,
  CampaignView,
  Health,
  HealthItem,
  ImportEvent,
  ListRow,
  SetupView,
  StatusSnapshot,
  TemplateSummary,
  WorkerEvent,
} from "../../../server/http/contract.ts";

export type CampaignStatus = CampaignView["status"];
