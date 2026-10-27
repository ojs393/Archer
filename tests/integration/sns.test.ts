import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { listSuppression } from "../../server/db/suppression.ts";
import { feedbackCounts } from "../../server/domain/snsFeedback.ts";
import { buildPublicServer } from "../../server/http/publicServer.ts";
import { makeHarness, type Harness } from "./httpHarness.ts";

let h: Harness;
let pub: FastifyInstance | undefined;

afterEach(async () => {
  await pub?.close();
  pub = undefined;
  await h?.close();
});

function envelope(type: string, message: object | string, extra: Record<string, string> = {}) {
  return {
    Type: type,
    MessageId: "msg-1",
    TopicArn: "arn:aws:sns:us-east-1:123:archer",
    Message: typeof message === "string" ? message : JSON.stringify(message),
    Timestamp: "2026-10-26T12:00:00.000Z",
    SignatureVersion: "1",
    Signature: "dGVzdA==",
    SigningCertURL: "https://sns.us-east-1.amazonaws.com/cert.pem",
    ...extra,
  };
}

function sesBounce(email: string, bounceType: "Permanent" | "Transient") {
  return {
    notificationType: "Bounce",
    bounce: {
      bounceType,
      bouncedRecipients: [{ emailAddress: email }],
    },
    mail: { messageId: "ses-1" },
  };
}

function sesComplaint(email: string) {
  return {
    notificationType: "Complaint",
    complaint: {
      complainedRecipients: [{ emailAddress: email }],
      complaintFeedbackType: "abuse",
    },
    mail: { messageId: "ses-2" },
  };
}

describe("POST /sns on the public listener", () => {
  it("confirms an SNS subscription", async () => {
    h = await makeHarness();
    let confirmed: string | undefined;
    pub = buildPublicServer({
      db: h.db,
      env: h.env,
      log: { info() {}, warn() {}, error() {} },
      sns: {
        verify: async () => true,
        confirm: async (url) => {
          confirmed = url;
        },
      },
    });
    await pub.ready();

    const res = await pub.inject({
      method: "POST",
      url: "/sns",
      headers: { "content-type": "text/plain", host: "unsub.example.org" },
      payload: JSON.stringify(
        envelope("SubscriptionConfirmation", "confirm me", {
          SubscribeURL: "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=abc",
          Token: "abc",
        }),
      ),
    });
    expect(res.statusCode).toBe(200);
    expect(confirmed).toContain("ConfirmSubscription");
  });

  it("suppresses permanent bounces and complaints", async () => {
    h = await makeHarness();
    pub = buildPublicServer({
      db: h.db,
      env: h.env,
      log: { info() {}, warn() {}, error() {} },
      sns: { verify: async () => true },
    });
    await pub.ready();

    const bounce = await pub.inject({
      method: "POST",
      url: "/sns",
      headers: { "content-type": "application/json", host: "unsub.example.org" },
      payload: JSON.stringify(envelope("Notification", sesBounce("bounce@example.com", "Permanent"))),
    });
    expect(bounce.statusCode).toBe(200);

    const transient = await pub.inject({
      method: "POST",
      url: "/sns",
      headers: { "content-type": "application/json", host: "unsub.example.org" },
      payload: JSON.stringify(envelope("Notification", sesBounce("soft@example.com", "Transient"))),
    });
    expect(transient.statusCode).toBe(200);

    const complaint = await pub.inject({
      method: "POST",
      url: "/sns",
      headers: { "content-type": "text/plain", host: "unsub.example.org" },
      payload: JSON.stringify(envelope("Notification", sesComplaint("spam@example.com"))),
    });
    expect(complaint.statusCode).toBe(200);

    const rows = listSuppression(h.db, { limit: 100, offset: 0 }).rows;
    expect(rows.map((r) => [r.email, r.reason]).sort()).toEqual([
      ["bounce@example.com", "hard_bounce"],
      ["spam@example.com", "complaint"],
    ]);
    expect(feedbackCounts(h.db)).toEqual({ complaints: 1, bounces: 1 });
  });

  it("rejects a bad signature", async () => {
    h = await makeHarness();
    pub = buildPublicServer({
      db: h.db,
      env: h.env,
      log: { info() {}, warn() {}, error() {} },
      sns: { verify: async () => false },
    });
    await pub.ready();

    const res = await pub.inject({
      method: "POST",
      url: "/sns",
      headers: { "content-type": "application/json", host: "unsub.example.org" },
      payload: JSON.stringify(envelope("Notification", sesComplaint("x@example.com"))),
    });
    expect(res.statusCode).toBe(403);
    expect(listSuppression(h.db, { limit: 10, offset: 0 }).rows).toEqual([]);
  });
});
