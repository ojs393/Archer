import type { Health, SettingsView, SetupSteps, SetupView } from "../http/contract.ts";
import { HttpError } from "../http/errors.ts";
import { SES_REGIONS } from "./sesRegions.ts";
import { senderGaps } from "./store.ts";

/** Domain is left out: DNS may still be propagating, and the launch gates check it again anyway. */
export const REQUIRED_FOR_COMPLETION = ["operator", "provider", "addresses", "testInboxes"] as const satisfies readonly (keyof SetupSteps)[];

function providerReady(s: SettingsView): boolean {
  const { smtp } = s;
  const login = smtp.user.trim() !== "" && smtp.passSet;
  return s.provider === "ses" ? s.sesRegion !== null && login : smtp.host !== "" && smtp.port > 0 && login;
}

export function setupSteps(s: SettingsView, health: Health): SetupSteps {
  return {
    operator: s.operatorName.trim() !== "",
    provider: providerReady(s),
    domain: s.fromEmail !== "" && health.dns.status === "ok",
    addresses: senderGaps(s).length === 0,
    testInboxes: s.testInboxes.length > 0,
  };
}

export function setupView(s: SettingsView, health: Health): SetupView {
  return {
    complete: s.setupCompletedAt !== null,
    completedAt: s.setupCompletedAt,
    steps: setupSteps(s, health),
    regions: SES_REGIONS,
  };
}

export function readyToComplete(steps: SetupSteps): boolean {
  return REQUIRED_FOR_COMPLETION.every((step) => steps[step]);
}

/** Blocks send/start paths until the operator has marked setup complete. */
export function assertSetupCompleted(s: SettingsView, health: Health): void {
  if (s.setupCompletedAt !== null) return;
  throw new HttpError(
    409,
    "setup_incomplete",
    "Finish setup before sending",
    setupSteps(s, health),
  );
}
