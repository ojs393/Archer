import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getFreePort, resolvePaths } from "../../server/config.ts";

describe("resolvePaths", () => {
  const root = path.resolve("/proj");

  it("derives data dir from project root, not cwd", () => {
    const p = resolvePaths({ root, env: {} });
    expect(p.dataDir).toBe(path.join(root, "data"));
    expect(p.dbPath).toBe(path.join(root, "data", "archer.db"));
    expect(p.uploadsDir).toBe(path.join(root, "data", "uploads"));
    expect(p.logsDir).toBe(path.join(root, "data", "logs"));
    expect(p.backupsDir).toBe(path.join(root, "data", "backups"));
    expect(p.envPath).toBe(path.join(root, ".env"));
  });

  it("honors ARCHER_DATA_DIR override", () => {
    const p = resolvePaths({ root, env: { ARCHER_DATA_DIR: "/custom" } });
    expect(p.dataDir).toBe(path.resolve("/custom"));
    expect(p.dbPath).toBe(path.join(path.resolve("/custom"), "archer.db"));
    expect(p.envPath).toBe(path.join(root, ".env"));
  });

  it("resolves a relative ARCHER_DATA_DIR against the project root, not cwd", () => {
    const p = resolvePaths({ root, env: { ARCHER_DATA_DIR: path.join("var", "md") } });
    expect(p.dataDir).toBe(path.join(root, "var", "md"));
    expect(p.dbPath).toBe(path.join(root, "var", "md", "archer.db"));
  });

  it("ignores an empty ARCHER_DATA_DIR", () => {
    const p = resolvePaths({ root, env: { ARCHER_DATA_DIR: "" } });
    expect(p.dataDir).toBe(path.join(root, "data"));
  });
});

describe("getFreePort", () => {
  let blocker: net.Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => (blocker ? blocker.close(() => resolve()) : resolve()));
    blocker = undefined;
  });

  it("returns the preferred port when it is free", async () => {
    const probe = net.createServer();
    const free = await new Promise<number>((resolve) =>
      probe.listen(0, "127.0.0.1", () => {
        const { port } = probe.address() as net.AddressInfo;
        probe.close(() => resolve(port));
      }),
    );
    expect(await getFreePort(free)).toBe(free);
  });

  it("skips a busy port", async () => {
    blocker = net.createServer();
    const busy = await new Promise<number>((resolve) =>
      blocker!.listen(0, "127.0.0.1", () => resolve((blocker!.address() as net.AddressInfo).port)),
    );
    const port = await getFreePort(busy);
    expect(port).toBeGreaterThan(busy);
    expect(port).toBeLessThan(busy + 50);
  });
});
