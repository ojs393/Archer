import type { FastifyInstance } from "fastify";
import { readyToComplete, setupView } from "../../settings/setup.ts";
import { getSettingsView, setSetupCompletedAt } from "../../settings/store.ts";
import type { AppContext } from "../context.ts";
import type { SetupView } from "../contract.ts";
import { HttpError } from "../errors.ts";

export function setupRoutes(app: FastifyInstance, ctx: AppContext): void {
  const current = (): SetupView => setupView(getSettingsView(ctx.db, ctx.env), ctx.health.get());

  app.get("/api/setup", async (): Promise<SetupView> => current());

  app.post("/api/setup/complete", async (): Promise<SetupView> => {
    const { steps } = current();
    if (!readyToComplete(steps)) {
      throw new HttpError(409, "setup_incomplete", "Finish the operator, provider, addresses and test inbox steps first", steps);
    }
    setSetupCompletedAt(ctx.db, new Date().toISOString());
    return current();
  });

  app.post("/api/setup/reset", async (): Promise<SetupView> => {
    setSetupCompletedAt(ctx.db, null);
    return current();
  });
}
