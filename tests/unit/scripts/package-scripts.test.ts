import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { projectRoot } from "../../../scripts/lib/paths.mjs";

const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot(), "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

// These commands run before the Node version check, so they must start on any Node old enough
// to need the install hint: no node flags at all (e.g. --disable-warning needs Node >= 20.11).
describe.each(["setup", "doctor", "start"])("npm run %s", (name) => {
  it("starts with a flag-free node invocation of a scripts/*.mjs file", () => {
    const first = pkg.scripts[name].split("&&")[0].trim();
    expect(first).toMatch(/^node scripts\/[\w-]+\.mjs( --quick)?$/);
  });
});
