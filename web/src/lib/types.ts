import type { CampaignView } from "../../../server/http/contract.ts";

export type {
  AnalyticsBucket,
  AnalyticsErrorKind,
  AnalyticsErrors,
  AnalyticsFeedback,
  AnalyticsPoint,
  AnalyticsRun,
  AnalyticsRuns,
  AnalyticsSummary,
  AnalyticsTimeseries,
  ApiErrorBody,
  CampaignView,
  DnsCheckResult,
  Health,
  HealthItem,
  ImportEvent,
  ListRow,
  Provider,
  SettingsUpdate,
  SettingsView,
  SetupSteps,
  SetupView,
  SmtpTestResult,
  StatusSnapshot,
  TemplateSummary,
  WorkerEvent,
} from "../../../server/http/contract.ts";

export type CampaignStatus = CampaignView["status"];
