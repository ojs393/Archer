export const MIN_NODE_VERSION = "22.13.0";

function parts(version) {
  return version.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
}

export function meetsMinimum(version, minimum = MIN_NODE_VERSION) {
  const have = parts(version);
  const want = parts(minimum);
  for (let i = 0; i < 3; i++) {
    if ((have[i] ?? 0) !== (want[i] ?? 0)) return (have[i] ?? 0) > (want[i] ?? 0);
  }
  return true;
}

export function checkNode(version = process.versions.node, platform = process.platform) {
  const shown = `v${version.replace(/^v/, "")}`;
  if (meetsMinimum(version)) return { status: "PASS", name: "node", detail: shown };
  return {
    status: "FAIL",
    name: "node",
    detail: `${shown}; MamaDirect needs >= ${MIN_NODE_VERSION}`,
    hint: nodeInstallHint(platform),
    fatal: true,
  };
}

export function nodeInstallHint(platform = process.platform) {
  switch (platform) {
    case "darwin":
      return "brew install node@22  (or download from https://nodejs.org)";
    case "win32":
      return "winget install OpenJS.NodeJS.LTS";
    default:
      return "nvm install 22  (see https://github.com/nvm-sh/nvm)";
  }
}
