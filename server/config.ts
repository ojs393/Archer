import net from "node:net";
import { loadEnv } from "../scripts/lib/env.mjs";
import { projectRoot, resolvePaths } from "../scripts/lib/paths.mjs";

export { ensureDataDirs, ensureSecrets, loadEnv } from "../scripts/lib/env.mjs";
export { projectRoot, resolvePaths } from "../scripts/lib/paths.mjs";
export type { AppPaths } from "../scripts/lib/paths.mjs";

export const DEFAULT_PORT = 5199;
const PORT_SEARCH_SPAN = 50;

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

export async function getFreePort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + PORT_SEARCH_SPAN; port++) {
    if (await isPortFree(port)) return port;
  }
  throw new Error(`No free port in ${preferred}-${preferred + PORT_SEARCH_SPAN - 1}`);
}

function buildConfig() {
  const root = projectRoot();
  const env = loadEnv(resolvePaths({ root, env: { MAMADIRECT_ENV_FILE: process.env.MAMADIRECT_ENV_FILE } }).envPath);
  const paths = resolvePaths({ root, env: process.env });
  return { ...paths, port: Number(process.env.PORT) || DEFAULT_PORT, env };
}

export type Config = ReturnType<typeof buildConfig>;

export const config: Config = buildConfig();
