import { describe, expect, it } from "vitest";
import { formatActivityEvent } from "./formatActivity";

describe("formatActivityEvent", () => {
  it("formats sent with recipient and clean detail", () => {
    expect(formatActivityEvent("sent", "Sent to ann@x.example")).toEqual({
      action: "Sent",
      recipient: "ann@x.example",
      detail: "Accepted by SMTP",
      tone: "ok",
    });
  });

  it("formats status without raw prefix", () => {
    expect(formatActivityEvent("status", "Status: paused (user)")).toMatchObject({
      action: "Status",
      recipient: null,
      detail: "paused (user)",
      tone: "info",
    });
  });

  it("formats failed with recipient and reason", () => {
    expect(formatActivityEvent("failed", "Failed bob@x.example: 550 mailbox")).toEqual({
      action: "Failed",
      recipient: "bob@x.example",
      detail: "550 mailbox",
      tone: "danger",
    });
  });
});
