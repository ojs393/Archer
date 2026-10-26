import { describe, expect, it } from "vitest";
import {
  ROLE_LOCAL_PARTS,
  emailDomain,
  isRoleAddress,
  isValidEmail,
  normalizeEmail,
} from "../../server/domain/email.ts";

describe("normalizeEmail", () => {
  it.each([
    [" A@B.CO ", "a@b.co"],
    ["\tUser@Example.COM\r\n", "user@example.com"],
    ["mailto:a@b.co", "a@b.co"],
    ["MAILTO:A@B.CO", "a@b.co"],
    ["John Doe <John@Example.com>", "john@example.com"],
    ['"Doe, John" <john@example.com>', "john@example.com"],
    ["<a@b.co>", "a@b.co"],
    ["<mailto:a@b.co>", "a@b.co"],
    ['"a@b.co"', "a@b.co"],
    ["'a@b.co'", "a@b.co"],
    ['  " A@B.CO "  ', "a@b.co"],
    ["mailto:A@B.co?subject=Hi", "a@b.co"],
    ["mailto:a@b.co#frag", "a@b.co"],
    ["mailto:a@b.co?subject=Hi#frag", "a@b.co"],
    ["<mailto:a@b.co?subject=Hi>", "a@b.co"],
    ["a@b.co?subject=x", "a@b.co?subject=x"],
    ["a@b.co#x", "a@b.co#x"],
  ])("normalizes %j to %j", (raw, expected) => {
    expect(normalizeEmail(raw)).toBe(expected);
  });

  it("does not validate", () => {
    expect(normalizeEmail(" Not An Email ")).toBe("not an email");
  });
});

describe("isValidEmail", () => {
  const local64 = "a".repeat(64);
  const local65 = "a".repeat(65);
  const label63 = "b".repeat(63);
  const at254 = `${local64}@${label63}.${label63}.${"c".repeat(57)}.com`;
  const at255 = `${local64}@${label63}.${label63}.${"c".repeat(58)}.com`;

  it("builds boundary fixtures of the intended length", () => {
    expect(at254).toHaveLength(254);
    expect(at255).toHaveLength(255);
  });

  it.each([
    ["a@b.co"],
    ["first.last@example.com"],
    ["user+tag@sub.example.co.uk"],
    ["o'brien@example.ie"],
    ["a-b@my-domain.io"],
    ["user@xn--mnchen-3ya.de"],
    ["user@münchen.de"],
    ["user@example.xn--p1ai"],
    ["jösé@example.com"],
    [`${local64}@example.com`],
    [`a@${label63}.com`],
    [at254],
  ])("accepts %j", (email) => {
    expect(isValidEmail(email)).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["foo", "no @"],
    ["a@", "no domain"],
    ["@b.co", "no local part"],
    ["a@b", "single-label domain"],
    ["a@b.c", "TLD too short"],
    ["a@b.c0m", "non-alphabetic TLD"],
    ["a@1.2.3.4", "IP literal without brackets"],
    ["a b@c.com", "space in local part"],
    ["a@b .com", "space in domain"],
    ["a\n@b.com", "embedded LF"],
    ["a@b.com\r\nbcc:x@y.com", "header injection CRLF"],
    ["a\u0000@b.com", "NUL"],
    ["a\u001f@b.com", "unit separator"],
    ["a\u007f@b.com", "DEL"],
    ["a\tb@c.com", "tab"],
    ["a@b@c.com", "two @"],
    ["a..b@c.com", "consecutive dots in local part"],
    [".a@c.com", "leading dot in local part"],
    ["a.@c.com", "trailing dot in local part"],
    ["a@b..com", "empty domain label"],
    ["a@.b.com", "leading dot in domain"],
    ["a@b.com.", "trailing dot in domain"],
    ["a@-b.com", "label starting with hyphen"],
    ["a@b-.com", "label ending with hyphen"],
    ["a@b_c.com", "underscore in domain"],
    [`a@${"b".repeat(64)}.com`, "64-char label"],
    [`${local65}@example.com`, "65-char local part"],
    [at255, "255-char address"],
    ["a@b.co?subject=x", "query after domain"],
    ["a@b.co#x", "fragment after domain"],
    ["a@b.co/x", "path after domain"],
    ["a@b.co\\x", "backslash after domain"],
    ["a@ex%61mple.com", "percent-encoded domain"],
    ["a@exa\u00admple.com", "soft hyphen in domain"],
    ["a@exa\u200bmple.com", "zero-width space in domain"],
    ["a@b.example\u3002com", "ideographic full stop in domain"],
    ["a@\uff45xample.com", "fullwidth letter in domain"],
    ["a@xn--a.com", "undecodable punycode label"],
    ["a@münchen.xn--a", "IDN with undecodable punycode label"],
    ["a@\ufffd.com", "domain with no ASCII form"],
    ["a\u200b@example.com", "zero-width space in local part"],
    ["a\u202e@example.com", "right-to-left override in local part"],
    ["a\u00ad@example.com", "soft hyphen in local part"],
    ["a\u0085@example.com", "C1 control in local part"],
    ["a\u009f@example.com", "last C1 control"],
  ])("rejects %j (%s)", (email) => {
    expect(isValidEmail(email)).toBe(false);
  });

  it("rejects an address that exceeds 254 characters only after IDN expansion", () => {
    const email = `${local64}@${"ü.".repeat(24)}de`;
    expect(email.length).toBeLessThanOrEqual(254);
    expect(isValidEmail(email)).toBe(false);
  });

  it("accepts every address that normalizes cleanly from messy input", () => {
    expect(isValidEmail(normalizeEmail(' "Jane" <Jane.Doe@Example.COM> '))).toBe(true);
    expect(isValidEmail(normalizeEmail("mailto:info@example.com"))).toBe(true);
    expect(isValidEmail(normalizeEmail("mailto:A@B.co?subject=Hi"))).toBe(true);
    expect(isValidEmail(normalizeEmail("a@b.co?subject=x"))).toBe(false);
  });
});

describe("emailDomain", () => {
  it.each([
    ["a@b.co", "b.co"],
    ["user@sub.example.com", "sub.example.com"],
    ["a@b@c.com", "c.com"],
    ["foo", ""],
  ])("returns the domain of %j as %j", (email, domain) => {
    expect(emailDomain(email)).toBe(domain);
  });
});

describe("isRoleAddress", () => {
  it("exposes exactly the spec role set", () => {
    expect([...ROLE_LOCAL_PARTS].sort()).toEqual(
      [
        "info",
        "sales",
        "admin",
        "support",
        "noreply",
        "no-reply",
        "postmaster",
        "abuse",
        "webmaster",
        "contact",
        "hello",
        "office",
      ].sort(),
    );
  });

  it.each([...ROLE_LOCAL_PARTS].map((local) => [`${local}@x.com`]))("flags %j", (email) => {
    expect(isRoleAddress(email)).toBe(true);
  });

  it.each([
    ["info+x@a.com", true],
    ["support+billing@a.com", true],
    ["john@x.com", false],
    ["information@x.com", false],
    ["john.info@x.com", false],
    ["john+info@x.com", false],
    ["info", false],
    ["", false],
  ])("isRoleAddress(%j) is %s", (email, expected) => {
    expect(isRoleAddress(email)).toBe(expected);
  });
});
