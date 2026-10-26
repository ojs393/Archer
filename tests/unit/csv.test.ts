import { describe, expect, it } from "vitest";
import { detectEmailColumn, sniffDelimiter } from "../../server/import/csv.ts";

describe("sniffDelimiter", () => {
  it("picks comma", () => {
    expect(sniffDelimiter("email,first_name,last_name")).toBe(",");
  });

  it("picks semicolon", () => {
    expect(sniffDelimiter("email;first_name;last_name")).toBe(";");
  });

  it("picks tab", () => {
    expect(sniffDelimiter("email\tfirst_name\tlast_name")).toBe("\t");
  });

  it("ignores delimiters inside double quotes", () => {
    expect(sniffDelimiter('"Smith, Jane, Dr.";email;"a,b"')).toBe(";");
    expect(sniffDelimiter('"a;b;c;d"\temail\tname')).toBe("\t");
  });

  it("falls back to comma when there is no delimiter", () => {
    expect(sniffDelimiter("email")).toBe(",");
    expect(sniffDelimiter("")).toBe(",");
  });

  it("falls back to comma on a tie", () => {
    expect(sniffDelimiter("a;b\tc")).toBe(",");
  });

  it("picks the most frequent even when commas appear", () => {
    expect(sniffDelimiter("a,b;c;d")).toBe(";");
  });
});

describe("detectEmailColumn", () => {
  it.each(["Email", "e-mail", "Email Address", "E-Mail Address", "mail", "  EMAIL  "])(
    "matches header alias %j",
    (alias) => {
      expect(detectEmailColumn(["first_name", alias, "city"], ["Jo", "not-an-email", "Paris"])).toBe(1);
    },
  );

  it("prefers a header match over content", () => {
    expect(detectEmailColumn(["backup", "email"], ["jo@example.com", "x"])).toBe(1);
  });

  it("falls back to the first column whose first-row value is an email", () => {
    expect(detectEmailColumn(["name", "contact", "alt"], ["Jo", "Jo@Example.com", "b@example.com"])).toBe(1);
  });

  it("normalizes the first-row value before validating", () => {
    expect(detectEmailColumn(["who", "addr"], ["Jo", " Jo Smith <JO@EXAMPLE.COM> "])).toBe(1);
  });

  it("returns -1 when nothing looks like an email", () => {
    expect(detectEmailColumn(["name", "city"], ["Jo", "Paris"])).toBe(-1);
    expect(detectEmailColumn([], [])).toBe(-1);
  });

  it("does not treat a near-alias header as a match", () => {
    expect(detectEmailColumn(["emails_sent", "name"], ["3", "Jo"])).toBe(-1);
  });
});
