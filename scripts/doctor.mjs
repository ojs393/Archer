// Must run on any Node version long enough to print the install hint, so only node.mjs and
// report.mjs are imported statically; everything else loads after the version check.
import { checkNode } from "./lib/node.mjs";
import { report } from "./lib/report.mjs";

const quick = process.argv.includes("--quick");

if (report(checkNode()).fatal) process.exit(1);

const { runChecks } = await import("./lib/checks.mjs");
const { ok } = await runChecks({ quick });

if (!ok) {
  console.log("\nDoctor found problems it could not fix (see FAIL lines above).");
  process.exit(1);
}
