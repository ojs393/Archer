// Must run on any Node version long enough to print the install hint, so only node.mjs and
// report.mjs are imported statically; everything else loads after the version check.
import { checkNode } from "./lib/node.mjs";
import { report } from "./lib/report.mjs";

console.log("MamaDirect setup\n");

if (report(checkNode()).fatal) {
  console.log("\nInstall Node.js with the command above, open a new terminal, then run: npm run setup");
  process.exit(1);
}

const { runChecks } = await import("./lib/checks.mjs");
const { ok } = await runChecks({ forceInstall: true });

if (!ok) {
  console.log("\nSetup finished with problems (see FAIL lines above). Fix them, then run: npm run setup");
  process.exit(1);
}

console.log("\nSetup complete. Start MamaDirect with:\n\n  npm start\n");
