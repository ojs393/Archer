import type { FastifyInstance } from "fastify";
import { evaluateGates } from "../../campaigns/gates.ts";
import { createCampaign, recordEvent } from "../../campaigns/store.ts";
import { getCampaignView } from "../../campaigns/view.ts";
import { createChain, deleteChain, getChain, listChains, updateCampaignChainLink } from "../../chains/store.ts";
import { getList } from "../../import/lists.ts";
import { assertSetupCompleted } from "../../settings/setup.ts";
import { getSettingsView } from "../../settings/store.ts";
import { getTemplate } from "../../templates/store.ts";
import type { AppContext } from "../context.ts";
import {
  chainCreateSchema,
  chainStartSchema,
  idParamSchema,
  type CampaignView,
  type ChainRecord,
  type ChainSummary,
} from "../contract.ts";
import { HttpError, notFound } from "../errors.ts";

const creating = new Set<number>();

export function chainRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/chains", async (): Promise<ChainSummary[]> => listChains(ctx.db));

  app.get("/api/chains/:id", async (request): Promise<ChainRecord> => {
    const { id } = idParamSchema.parse(request.params);
    const chain = getChain(ctx.db, id);
    if (!chain) throw notFound("Chain");
    return chain;
  });

  app.post("/api/chains", async (request, reply) => {
    const body = chainCreateSchema.parse(request.body ?? {});
    const list = getList(ctx.db, body.listId);
    if (!list) throw notFound("List");
    if (list.status !== "ready") throw new HttpError(409, "list_not_ready", "The list is not ready");
    for (const step of body.steps) {
      if (!getTemplate(ctx.db, step.templateId)) throw notFound("Template");
    }
    const id = createChain(ctx.db, body);
    return reply.code(201).send(getChain(ctx.db, id));
  });

  app.delete("/api/chains/:id", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    if (!deleteChain(ctx.db, id)) throw notFound("Chain");
    return reply.code(204).send();
  });

  /** Start step 0 (or a given step) as a new campaign and optionally begin sending. */
  app.post("/api/chains/:id/start", async (request): Promise<CampaignView> => {
    const { id } = idParamSchema.parse(request.params);
    const { step: stepIndex = 0, autoStart = true } = chainStartSchema.parse(request.body ?? {});
    const chain = getChain(ctx.db, id);
    if (!chain) throw notFound("Chain");
    const step = chain.steps.find((s) => s.position === stepIndex);
    if (!step) throw new HttpError(400, "bad_step", "That chain step does not exist");
    const list = getList(ctx.db, chain.listId);
    if (!list || list.status !== "ready") throw new HttpError(409, "list_not_ready", "The list is not ready");
    const template = getTemplate(ctx.db, step.templateId);
    if (!template) throw notFound("Template");
    const campaignId = await createCampaign(
      ctx.db,
      { listId: chain.listId, templateId: template.id, templateVersion: template.version, schedule: chain.schedule },
      creating,
    );
    updateCampaignChainLink(ctx.db, campaignId, chain.id, step.position);
    ctx.db.prepare(`UPDATE campaigns SET title = ? WHERE id = ?`).run(`${chain.name} · step ${step.position + 1}`, campaignId);
    recordEvent(ctx.db, campaignId, "chain", `Started from chain "${chain.name}"`);

    if (autoStart) {
      const settings = getSettingsView(ctx.db, ctx.env);
      assertSetupCompleted(settings, ctx.health.get());
      const gates = evaluateGates(ctx.db, campaignId, { health: ctx.health.get(), settings });
      if (!gates) throw notFound("Campaign");
      if (!gates.ok) {
        // Draft campaign already exists; surface the same gates_failed shape as campaign start.
        throw new HttpError(409, "gates_failed", "Some launch checks have not passed yet", gates.gates);
      }
      try {
        ctx.worker.start(campaignId);
      } catch (err) {
        throw new HttpError(409, "conflict", err instanceof Error ? err.message : String(err));
      }
    }

    const view = getCampaignView(ctx.db, campaignId);
    if (!view) throw notFound("Campaign");
    return view;
  });
}
