import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createDesktopLauncher } from "../../system/desktop.ts";
import type { AppContext } from "../context.ts";
import type { DesktopLauncherResult } from "../contract.ts";
import { HttpError } from "../errors.ts";

const ICONS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "archer.icns",
  win32: "archer.ico",
  linux: "archer-512.png",
};

export function systemRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/api/system/desktop-launcher", async (): Promise<DesktopLauncherResult> => {
    const icon = ICONS[process.platform];
    try {
      const result = await createDesktopLauncher({
        projectRoot: ctx.paths.root,
        iconPath: icon ? path.join(ctx.paths.root, "assets", "icons", icon) : "",
        desktopDir: ctx.desktopDir,
      });
      ctx.log.info(`Created the desktop launcher ${result.path}`);
      return { ok: true, path: result.path };
    } catch (err) {
      ctx.log.error("Could not create the desktop launcher:", err);
      const reason = err instanceof Error ? err.message : String(err);
      throw new HttpError(500, "launcher_failed", `Could not create the desktop launcher: ${reason}`);
    }
  });
}
