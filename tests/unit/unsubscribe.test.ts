import { createHmac } from "node:crypto";
import { describe, it, expect } from "vitest";
import {
  signToken,
  verifyToken,
  unsubscribeMailto,
  unsubscribeHttpsUrl,
  unsubscribeLink,
  listUnsubscribeHeaders,
} from "../../server/domain/unsubscribe.ts";

const SECRET = "k".repeat(40);
const OTHER_SECRET = "z".repeat(40);
const EMAIL = "jane.doe@example.com";

describe("signToken / verifyToken", () => {
  it("round-trips an email", () => {
    expect(verifyToken(signToken(EMAIL, SECRET), SECRET)).toBe(EMAIL);
  });

  it("produces base64url(email).base64url(mac)", () => {
    const [emailPart, macPart, ...rest] = signToken(EMAIL, SECRET).split(".");
    expect(rest).toEqual([]);
    expect(Buffer.from(emailPart, "base64url").toString("utf8")).toBe(EMAIL);
    expect(emailPart).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(macPart).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(macPart, "base64url")).toHaveLength(32);
  });

  it("is deterministic", () => {
    expect(signToken(EMAIL, SECRET)).toBe(signToken(EMAIL, SECRET));
  });

  it("round-trips unicode and plus-tagged addresses", () => {
    const email = "josé+news@exämple.com";
    expect(verifyToken(signToken(email, SECRET), SECRET)).toBe(email);
  });

  it("accepts a secret of exactly 32 characters", () => {
    const secret = "a".repeat(32);
    expect(verifyToken(signToken(EMAIL, secret), secret)).toBe(EMAIL);
  });

  it("rejects a tampered MAC", () => {
    const token = signToken(EMAIL, SECRET);
    const last = token.at(-1) === "A" ? "B" : "A";
    expect(verifyToken(token.slice(0, -1) + last, SECRET)).toBeNull();
  });

  it("rejects a swapped email part", () => {
    const mac = signToken(EMAIL, SECRET).split(".")[1];
    const forged = Buffer.from("victim@example.com", "utf8").toString("base64url") + "." + mac;
    expect(verifyToken(forged, SECRET)).toBeNull();
  });

  it("rejects a non-canonical MAC encoding that decodes to the same bytes", () => {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const token = signToken(EMAIL, SECRET);
    const variant = token.slice(0, -1) + alphabet[alphabet.indexOf(token.at(-1)!) ^ 1];
    expect(Buffer.from(variant.split(".")[1], "base64url")).toEqual(Buffer.from(token.split(".")[1], "base64url"));
    expect(verifyToken(variant, SECRET)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    expect(verifyToken(signToken(EMAIL, OTHER_SECRET), SECRET)).toBeNull();
  });

  describe("malformed tokens -> null", () => {
    const token = signToken(EMAIL, SECRET);
    const cases: [string, string][] = [
      ["empty", ""],
      ["no dot", token.replace(".", "")],
      ["extra dot", token + ".abc"],
      ["truncated MAC", token.slice(0, -4)],
      ["MAC only", "." + token.split(".")[1]],
      ["email only", token.split(".")[0] + "."],
      ["garbage", "!!!.???"],
      ["padded base64", token + "="],
      ["whitespace", " " + token],
      ["1025 chars", "a".repeat(1020) + ".abcd"],
    ];
    for (const [label, input] of cases) {
      it(label, () => expect(verifyToken(input, SECRET)).toBeNull());
    }
  });

  it("rejects a valid-shaped token longer than 1024 chars", () => {
    const longEmail = "a".repeat(800) + "@example.com";
    const token = signToken(longEmail, SECRET);
    expect(token.length).toBeGreaterThan(1024);
    expect(verifyToken(token, SECRET)).toBeNull();
  });

  it("signToken throws for a secret shorter than 32 characters", () => {
    expect(() => signToken(EMAIL, "a".repeat(31))).toThrow();
  });

  it("verifyToken returns null for a secret shorter than 32 characters", () => {
    const shortSecret = "a".repeat(31);
    expect(verifyToken(signToken(EMAIL, shortSecret + "a"), shortSecret)).toBeNull();
    expect(verifyToken(signToken(EMAIL, SECRET), "")).toBeNull();
  });

  it("verifyToken returns null for a correctly MACed token when the secret is short", () => {
    const shortSecret = "a".repeat(31);
    const macPart = createHmac("sha256", shortSecret).update("mamadirect-unsub-v1:" + EMAIL, "utf8").digest("base64url");
    const token = Buffer.from(EMAIL, "utf8").toString("base64url") + "." + macPart;
    expect(verifyToken(token, shortSecret)).toBeNull();
  });

  describe("non-string inputs -> null without throwing", () => {
    const token = signToken(EMAIL, SECRET);
    const cases: [string, unknown, unknown][] = [
      ["undefined token", undefined, SECRET],
      ["number token", 42, SECRET],
      ["undefined secret", token, undefined],
      ["number secret", token, 42],
      ["array-like secret", token, { length: 64 }],
    ];
    for (const [label, t, s] of cases) {
      it(label, () => expect(verifyToken(t as string, s as string)).toBeNull());
    }
  });
});

describe("link builders", () => {
  const token = "abc_-123.def";

  it("unsubscribeMailto", () => {
    expect(unsubscribeMailto("unsub@example.com", token)).toBe(
      "mailto:unsub@example.com?subject=unsubscribe%20abc_-123.def",
    );
  });

  describe("unsubscribeHttpsUrl", () => {
    const cases: [string, string][] = [
      ["https://u.example.com", "https://u.example.com/u/abc_-123.def"],
      ["https://u.example.com/", "https://u.example.com/u/abc_-123.def"],
      ["https://x.example.com/mama/", "https://x.example.com/mama/u/abc_-123.def"],
    ];
    for (const [base, expected] of cases) {
      it(base, () => expect(unsubscribeHttpsUrl(base, token)).toBe(expected));
    }
  });

  describe("unsubscribeLink", () => {
    const mailbox = "unsub@example.com";
    const mailto = "mailto:unsub@example.com?subject=unsubscribe%20abc_-123.def";

    it("uses https when publicBaseUrl is an https URL", () => {
      expect(unsubscribeLink({ mailbox, token, publicBaseUrl: "https://u.example.com/" }))
        .toBe("https://u.example.com/u/abc_-123.def");
    });

    const fallbacks: [string, string | null | undefined][] = [
      ["absent", undefined],
      ["null", null],
      ["empty", ""],
      ["http", "http://u.example.com"],
      ["invalid", "not a url"],
    ];
    for (const [label, publicBaseUrl] of fallbacks) {
      it(`falls back to mailto when publicBaseUrl is ${label}`, () => {
        expect(unsubscribeLink({ mailbox, token, publicBaseUrl })).toBe(mailto);
      });
    }
  });
});

describe("listUnsubscribeHeaders", () => {
  const mailbox = "unsub@example.com";
  const token = "abc_-123.def";
  const mailto = "<mailto:unsub@example.com?subject=unsubscribe%20abc_-123.def>";

  it("mailto only without publicBaseUrl", () => {
    expect(listUnsubscribeHeaders({ mailbox, token })).toEqual({ "List-Unsubscribe": mailto });
  });

  it("https + mailto + one-click with an https publicBaseUrl", () => {
    expect(listUnsubscribeHeaders({ mailbox, token, publicBaseUrl: "https://u.example.com" })).toEqual({
      "List-Unsubscribe": `<https://u.example.com/u/abc_-123.def>, ${mailto}`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  for (const publicBaseUrl of ["http://u.example.com", "not a url", null]) {
    it(`ignores publicBaseUrl ${String(publicBaseUrl)}`, () => {
      expect(listUnsubscribeHeaders({ mailbox, token, publicBaseUrl })).toEqual({ "List-Unsubscribe": mailto });
    });
  }
});

describe("header-unsafe publicBaseUrl is normalized", () => {
  const mailbox = "unsub@example.com";
  const token = "abc_-123.def";
  const bases = ["https://u.example.com/a\r\nX-Evil: 1", " https://u.example.com/a b>c,d", "https://u.example.com/a\tb/"];

  for (const publicBaseUrl of bases) {
    it(`headers for ${JSON.stringify(publicBaseUrl)} contain no CR/LF, tab, space or raw >`, () => {
      const headers = listUnsubscribeHeaders({ mailbox, token, publicBaseUrl });
      expect(Object.keys(headers).sort()).toEqual(["List-Unsubscribe", "List-Unsubscribe-Post"]);
      const httpsPart = headers["List-Unsubscribe"].split(", <mailto:")[0];
      expect(httpsPart).toMatch(/^<https:\/\/u\.example\.com\/[^\s<>]*\/u\/abc_-123\.def>$/);
      for (const value of Object.values(headers)) expect(value).not.toMatch(/[\r\n\t]/);
    });

    it(`link for ${JSON.stringify(publicBaseUrl)} contains no CR/LF, whitespace or raw >`, () => {
      const link = unsubscribeLink({ mailbox, token, publicBaseUrl });
      expect(link).toMatch(/^https:\/\/u\.example\.com\//);
      expect(link).not.toMatch(/[\s<>]/);
      expect(link.endsWith("/u/abc_-123.def")).toBe(true);
    });
  }

  it("percent-encodes rather than drops unsafe path characters", () => {
    expect(unsubscribeLink({ mailbox, token, publicBaseUrl: " https://u.example.com/a b>c,d" }))
      .toBe("https://u.example.com/a%20b%3Ec,d/u/abc_-123.def");
  });
});
