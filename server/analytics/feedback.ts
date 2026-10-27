import type { AnalyticsFeedback } from "../http/contract.ts";

export const FEEDBACK: AnalyticsFeedback = {
  available: false,
  reason:
    "Spam complaints and other recipient feedback come from Amazon SES notifications delivered through Amazon SNS. This version of Archer does not receive them, so no complaint numbers are shown.",
  guidance: [
    "Open the Amazon SES console in the region you send from.",
    "In the Amazon SNS console, create a topic for Archer feedback.",
    "In SES, open Identities, choose your sending domain, then the Notifications tab.",
    "Under Feedback notifications, choose Edit and pick that SNS topic for Bounce and Complaint.",
    "Subscribe your email address to the SNS topic to receive each complaint as it happens.",
    "Hard bounces are already detected while sending and added to the suppression list.",
  ],
};
