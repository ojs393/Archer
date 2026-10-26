import { describe, it, expect } from "vitest";
import { classifySmtpError, type ErrorKind } from "../../server/domain/classifyError.ts";

function smtpErr(responseCode: number, response?: string, code?: string): Error {
  return Object.assign(new Error(response ?? `SMTP ${responseCode}`), { responseCode, response, code });
}

describe("classifySmtpError", () => {
  describe("brief cases", () => {
    const cases: [string, unknown, ErrorKind][] = [
      ["451", { responseCode: 451 }, "retry"],
      ["550", { responseCode: 550 }, "suppress"],
      ["535", { responseCode: 535 }, "auth"],
      ["ECONNRESET", { code: "ECONNRESET" }, "network"],
      ["502", { responseCode: 502 }, "fail"],
    ];
    for (const [label, err, kind] of cases) {
      it(`${label} -> ${kind}`, () => expect(classifySmtpError(err).kind).toBe(kind));
    }
  });

  describe("auth", () => {
    it("EAUTH -> auth", () => expect(classifySmtpError({ code: "EAUTH" }).kind).toBe("auth"));
    it("EAUTH with 535 response -> auth", () =>
      expect(classifySmtpError(smtpErr(535, "535 5.7.8 Authentication failed", "EAUTH")).kind).toBe("auth"));
    for (const responseCode of [530, 534]) {
      it(`${responseCode} -> auth`, () => expect(classifySmtpError({ responseCode }).kind).toBe("auth"));
    }
  });

  it("ETLS -> config", () => expect(classifySmtpError({ code: "ETLS" }).kind).toBe("config"));

  describe("network", () => {
    const codes = [
      "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH",
      "EHOSTUNREACH", "EPIPE", "ESOCKET", "ECONNECTION", "EDNS",
    ];
    for (const code of codes) {
      it(`${code} -> network`, () => expect(classifySmtpError({ code }).kind).toBe("network"));
    }
    it("network code wins over a 5xx responseCode", () =>
      expect(classifySmtpError({ code: "ECONNECTION", responseCode: 554 }).kind).toBe("network"));
  });

  describe("4xx -> retry", () => {
    for (const responseCode of [421, 450, 451, 452, 499]) {
      it(`${responseCode} -> retry`, () => expect(classifySmtpError({ responseCode }).kind).toBe("retry"));
    }
    it("450 4.2.1 -> retry", () => expect(classifySmtpError(smtpErr(450, "450 4.2.1 Mailbox busy")).kind).toBe("retry"));
    it("4xx with EENVELOPE -> retry", () =>
      expect(classifySmtpError(smtpErr(451, "451 4.7.1 Try later", "EENVELOPE")).kind).toBe("retry"));
  });

  describe("5xx with enhanced codes", () => {
    const cases: [number, string, ErrorKind][] = [
      [550, "550 5.1.1 User unknown", "suppress"],
      [554, "554 5.1.2 Bad destination system", "suppress"],
      [550, "550 5.7.1 Message rejected as spam", "fail"],
      [554, "554 5.7.1 Relay access denied", "fail"],
      [552, "552 5.2.2 Mailbox full", "fail"],
      [550, "550 5.2.1 Mailbox disabled", "fail"],
    ];
    for (const [responseCode, response, kind] of cases) {
      it(`${response} -> ${kind}`, () => expect(classifySmtpError(smtpErr(responseCode, response)).kind).toBe(kind));
    }
    it("nodemailer EENVELOPE rejection with 550 5.1.1 -> suppress", () =>
      expect(classifySmtpError(smtpErr(550, "550 5.1.1 <a@x.com>: Recipient address rejected", "EENVELOPE")).kind)
        .toBe("suppress"));
  });

  describe("bare 5xx", () => {
    for (const responseCode of [550, 551, 553]) {
      it(`${responseCode} bare -> suppress`, () =>
        expect(classifySmtpError(smtpErr(responseCode, `${responseCode} Rejected`)).kind).toBe("suppress"));
    }
    for (const responseCode of [500, 552, 554]) {
      it(`${responseCode} bare -> fail`, () => expect(classifySmtpError({ responseCode }).kind).toBe("fail"));
    }
  });

  describe("envelope/message errors without a responseCode", () => {
    for (const code of ["EENVELOPE", "EMESSAGE"]) {
      it(`${code} -> fail`, () => expect(classifySmtpError({ code }).kind).toBe("fail"));
    }
  });

  describe("unknown and non-object inputs -> retry without throwing", () => {
    const inputs: [string, unknown][] = [
      ["string", "something broke"],
      ["null", null],
      ["undefined", undefined],
      ["number", 42],
      ["empty object", {}],
      ["unknown code", { code: "EPROTOCOL" }],
      ["plain Error", new Error("boom")],
      ["non-numeric responseCode", { responseCode: "550" }],
    ];
    for (const [label, input] of inputs) {
      it(label, () => {
        const result = classifySmtpError(input);
        expect(result.kind).toBe("retry");
        expect(typeof result.message).toBe("string");
        expect(result.message.length).toBeGreaterThan(0);
      });
    }
  });

  describe("result fields", () => {
    it("carries responseCode, enhancedCode and code", () => {
      const result = classifySmtpError(smtpErr(550, "550 5.1.1 User unknown", "EENVELOPE"));
      expect(result).toMatchObject({ kind: "suppress", responseCode: 550, enhancedCode: "5.1.1", code: "EENVELOPE" });
    });

    it("omits fields that are absent", () => {
      const result = classifySmtpError({ code: "ECONNRESET" });
      expect(result.responseCode).toBeUndefined();
      expect(result.enhancedCode).toBeUndefined();
      expect(result.code).toBe("ECONNRESET");
    });

    it("message is a single line", () => {
      const err = smtpErr(550, "550-5.1.1 The email account\r\n550 5.1.1 does not exist\n");
      err.message = "Can't send mail\r\nall recipients were rejected\n550 5.1.1";
      expect(classifySmtpError(err).message).not.toMatch(/[\r\n]/);
    });

    it("message from a string input is a single line containing the text", () => {
      const message = classifySmtpError("line one\nline two").message;
      expect(message).not.toMatch(/[\r\n]/);
      expect(message).toContain("line one");
      expect(message).toContain("line two");
    });

    it("message falls back to response when there is no message", () => {
      expect(classifySmtpError({ responseCode: 550, response: "550 5.1.1 User unknown" }).message)
        .toContain("User unknown");
    });

    it("message is bounded in length", () => {
      expect(classifySmtpError(new Error("x".repeat(10_000))).message.length).toBeLessThanOrEqual(300);
    });

    it("message does not serialize other properties of the error", () => {
      const err = Object.assign(new Error("Invalid login"), { code: "EAUTH", command: "AUTH PLAIN", pass: "hunter2" });
      expect(classifySmtpError(err).message).not.toContain("hunter2");
    });
  });
});
