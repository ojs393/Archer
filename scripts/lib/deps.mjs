import fs from "node:fs";
import path from "node:path";

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function missingDependencies(root) {
  const pkg = readJson(path.join(root, "package.json"));
  const wanted = { ...pkg.dependencies, ...pkg.devDependencies };
  const problems = [];
  for (const [name, spec] of Object.entries(wanted)) {
    const manifest = path.join(root, "node_modules", ...name.split("/"), "package.json");
    if (!fs.existsSync(manifest)) {
      problems.push(name);
      continue;
    }
    const { version } = readJson(manifest);
    if (EXACT_VERSION.test(spec) && version !== spec) problems.push(`${name}@${version} (want ${spec})`);
  }
  return problems;
}

export function installArgs(root) {
  return fs.existsSync(path.join(root, "package-lock.json")) ? ["ci"] : ["install"];
}
