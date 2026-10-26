import { describe, it, expect } from "vitest";
import { guessFirstName } from "../../server/domain/guessName.ts";

describe("guessFirstName", () => {
  const cases: [string, string | null][] = [
    ["john.smith@x.com", "John"],
    ["john_smith@x.com", "John"],
    ["john-smith@x.com", "John"],
    ["JANE.DOE@x.com", "Jane"],
    ["info@x.com", null],
    ["sales@x.com", null],
    ["jsmith84@x.com", null],
    ["jsmith@x.com", null],
    ["a.b@x.com", null],        // too short
    ["john2.smith@x.com", null], // digits
    ["john.smith+news@x.com", "John"],
    ["j.smith@x.com", null],
    ["anne-marie.lee@x.com", "Anne"],
    ["john.@x.com", null],
    [".john@x.com", null],
    ["josé.garcia@x.com", null],
    ["info+x@x.com", null],
  ];
  for (const [email, expected] of cases) {
    it(`${email} -> ${expected}`, () => expect(guessFirstName(email)).toBe(expected));
  }
});
