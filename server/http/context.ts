import type { DatabaseSync } from "node:sqlite";
import type { AppPaths } from "../config.ts";
import type { AuthResolver } from "../dns/check.ts";
import type { HealthMonitor } from "../health/monitor.ts";
import type { DomainStatus } from "../import/mx.ts";
import type { Logger } from "../logger.ts";
import type { SmtpConfig } from "../send/transport.ts";
import type { SendWorker } from "../send/worker.ts";
import type { EventHub } from "./events.ts";
import type { ImportJobs } from "./importJobs.ts";

export type Env = Record<string, string | undefined>;

export interface ServerDeps {
  db: DatabaseSync;
  worker: SendWorker;
  port: number;
  sessionToken: string;
  paths: AppPaths;
  health: HealthMonitor;
  events: EventHub;
  env: Env;
  webDir?: string;
  imports?: ImportJobs;
  dnsResolver?: AuthResolver;
  verifySmtp?: (cfg: SmtpConfig) => Promise<void>;
  smtpTestTimeoutMs?: number;
  uploadLimitBytes?: number;
  createDomainChecker?: () => (domain: string) => Promise<DomainStatus>;
  registerSecret?: (value: string) => void;
  log?: Logger;
}

type OptionalInContext = "dnsResolver" | "smtpTestTimeoutMs" | "uploadLimitBytes";

export type AppContext = Required<Omit<ServerDeps, OptionalInContext>> & Pick<ServerDeps, OptionalInContext>;
