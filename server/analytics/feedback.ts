import type { DatabaseSync } from "node:sqlite";
import { feedbackCounts } from "../domain/snsFeedback.ts";
import type { AnalyticsFeedback } from "../http/contract.ts";

const GUIDANCE_SETUP = [
  "Open the Amazon SES console in the region you send from.",
  "In the Amazon SNS console, create a topic for Archer feedback.",
  "In SES, open Identities, choose your sending domain, then the Notifications tab.",
  "Under Feedback notifications, choose Edit and pick that SNS topic for Bounce and Complaint.",
  "Subscribe that topic to HTTPS and use your public listener URL ending in /sns (ARCHER_PUBLIC_PORT).",
  "Confirm the SNS subscription when Archer auto-confirms, or open the SubscribeURL once.",
  "Hard bounces caught during SMTP sending are still added to the suppression list separately.",
];

const GUIDANCE_LIVE = [
  "Permanent SES bounces and complaints arriving at POST /sns are written to feedback_events and the suppression list.",
  "Transient bounces are ignored (SES may retry).",
  "Counts below are raw notification recipients, not a rate against sends.",
];

export function getFeedback(db: DatabaseSync): AnalyticsFeedback {
  const { complaints, bounces } = feedbackCounts(db);
  const available = complaints > 0 || bounces > 0;
  if (available) {
    return {
      available: true,
      complaints,
      bounces,
      reason: "SES bounce and complaint notifications received through SNS at POST /sns.",
      guidance: GUIDANCE_LIVE,
      endpoint: "/sns",
    };
  }
  return {
    available: false,
    complaints: 0,
    bounces: 0,
    reason:
      "No SES bounce or complaint notifications have been received yet. Point an SNS topic at the public listener POST /sns.",
    guidance: GUIDANCE_SETUP,
    endpoint: "/sns",
  };
}
