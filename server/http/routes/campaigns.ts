import type { FastifyInstance } from "fastify";
import { evaluateGates } from "../../campaigns/gates.ts";
import {
  createCampaign,
  deleteCampaign,
  eventsPage,
  getCampaign,
  listCampaignIds,
  recordEvent,
  uncertainPage,
  updateSchedule,
  type CampaignRecord,
} from "../../campaigns/store.ts";
import { getCampaignView } from "../../campaigns/view.ts";
import { getList } from "../../import/lists.ts";
import { EventLog } from "../../send/events.ts";
import { ACTIVE_STATUSES, SendStore, type CampaignStatus } from "../../send/sendState.ts";
import { getSettingsView } from "../../settings/store.ts";
import { getTemplate } from "../../templates/store.ts";
import type { AppContext } from "../context.ts";
import {
  campaignCreateSchema,
  campaignEventsQuerySchema,
  idParamSchema,
  pageQuerySchema,
  requeueSchema,
  scheduleUpdateSchema,
  type CampaignEventsPage,
  type CampaignView,
  type GatesResult,
  type UncertainPage,
} from "../contract.ts";
import { HttpError, notFound } from "../errors.ts";

const USER_PAUSE_REASON = "user";
const SCHEDULE_EDITABLE: ReadonlySet<CampaignStatus> = new Set(["draft", "paused"]);
const DELETABLE: ReadonlySet<CampaignStatus> = new Set(["draft", "completed", "stopped"]);
const RESUMABLE: ReadonlySet<CampaignStatus> = new Set(["paused", "safety_stop"]);
const FINISHED: ReadonlySet<CampaignStatus> = new Set(["completed", "stopped"]);

function invalidState(message: string): HttpError {
  return new HttpError(409, "invalid_state", message);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function campaignRoutes(app: FastifyInstance, ctx: AppContext): void {
  const sendStore = new SendStore(ctx.db);
  const eventLog = new EventLog(ctx.db);

  const requireCampaign = (params: unknown): CampaignRecord => {
    const { id } = idParamSchema.parse(params);
    const c = getCampaign(ctx.db, id);
    if (!c) throw notFound("Campaign");
    return c;
  };

  const view = (id: number): CampaignView => {
    const v = getCampaignView(ctx.db, id);
    if (!v) throw notFound("Campaign");
    return v;
  };

  const gatesFor = (id: number): GatesResult => {
    const result = evaluateGates(ctx.db, id, { health: ctx.health.get(), settings: getSettingsView(ctx.db, ctx.env) });
    if (!result) throw notFound("Campaign");
    return result;
  };

  const requireGates = (id: number): void => {
    const result = gatesFor(id);
    if (!result.ok) throw new HttpError(409, "gates_failed", "Some launch checks have not passed yet", result.gates);
  };

  const isWorkerCampaign = (id: number) => ctx.worker.getActivity().campaignId === id;

  const workerCall = (fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      throw new HttpError(409, "conflict", errorText(err));
    }
  };

  const stopWithoutWorker = (id: number): void => {
    const at = new Date().toISOString();
    sendStore.setStatus(id, "stopped", null, at);
    eventLog.insert({ type: "status", campaignId: id, message: "Status: stopped", at });
  };

  app.get("/api/campaigns", async (): Promise<CampaignView[]> =>
    listCampaignIds(ctx.db).flatMap((id) => getCampaignView(ctx.db, id) ?? []),
  );

  app.post("/api/campaigns", async (request, reply) => {
    const input = campaignCreateSchema.parse(request.body ?? {});
    const list = getList(ctx.db, input.listId);
    if (!list) throw notFound("List");
    if (list.status !== "ready") throw new HttpError(409, "list_not_ready", "The list is not ready; wait for the import to finish or upload it again");
    const template = getTemplate(ctx.db, input.templateId);
    if (!template) throw notFound("Template");
    const id = await createCampaign(ctx.db, { ...input, templateVersion: template.version });
    return reply.code(201).send(view(id));
  });

  app.get("/api/campaigns/:id", async (request): Promise<CampaignView> => view(requireCampaign(request.params).id));

  app.put("/api/campaigns/:id/schedule", async (request): Promise<CampaignView> => {
    const c = requireCampaign(request.params);
    const { schedule } = scheduleUpdateSchema.parse(request.body ?? {});
    if (!SCHEDULE_EDITABLE.has(c.status)) throw invalidState("Pause the campaign before changing its schedule");
    updateSchedule(ctx.db, c.id, schedule);
    return view(c.id);
  });

  app.get("/api/campaigns/:id/gates", async (request): Promise<GatesResult> => gatesFor(requireCampaign(request.params).id));

  app.post("/api/campaigns/:id/start", async (request): Promise<CampaignView> => {
    const c = requireCampaign(request.params);
    if (ACTIVE_STATUSES.has(c.status)) throw invalidState("This campaign is already sending");
    if (c.status === "stopped") throw invalidState("A stopped campaign cannot be restarted; create a new campaign");
    requireGates(c.id);
    workerCall(() => ctx.worker.start(c.id));
    return view(c.id);
  });

  app.post("/api/campaigns/:id/pause", async (request): Promise<CampaignView> => {
    const c = requireCampaign(request.params);
    if (!ACTIVE_STATUSES.has(c.status)) throw invalidState("Only a sending campaign can be paused");
    if (!isWorkerCampaign(c.id)) throw new HttpError(409, "conflict", "The send worker is not running this campaign; restart MamaDirect");
    ctx.worker.pause(USER_PAUSE_REASON);
    return view(c.id);
  });

  app.post("/api/campaigns/:id/resume", async (request): Promise<CampaignView> => {
    const c = requireCampaign(request.params);
    if (!RESUMABLE.has(c.status)) throw invalidState("Only a paused campaign can be resumed");
    requireGates(c.id);
    workerCall(() => (isWorkerCampaign(c.id) ? ctx.worker.resume() : ctx.worker.start(c.id)));
    return view(c.id);
  });

  app.post("/api/campaigns/:id/stop", async (request): Promise<CampaignView> => {
    const c = requireCampaign(request.params);
    if (FINISHED.has(c.status)) return view(c.id);
    if (isWorkerCampaign(c.id)) ctx.worker.stop();
    else stopWithoutWorker(c.id);
    return view(c.id);
  });

  app.get("/api/campaigns/:id/uncertain", async (request): Promise<UncertainPage> => {
    const c = requireCampaign(request.params);
    const { limit, offset } = pageQuerySchema.parse(request.query ?? {});
    return uncertainPage(ctx.db, c.id, limit, offset);
  });

  app.post("/api/campaigns/:id/requeue", async (request) => {
    const c = requireCampaign(request.params);
    const { contactIds } = requeueSchema.parse(request.body ?? {});
    const requeued = ctx.worker.requeueUncertain(c.id, contactIds);
    if (requeued > 0) {
      recordEvent(ctx.db, c.id, "requeue", `Requeued ${requeued} uncertain send${requeued === 1 ? "" : "s"}`);
      if (isWorkerCampaign(c.id)) ctx.worker.wake("requeue");
    }
    return { requeued };
  });

  app.get("/api/campaigns/:id/events", async (request): Promise<CampaignEventsPage> => {
    const c = requireCampaign(request.params);
    return eventsPage(ctx.db, c.id, campaignEventsQuerySchema.parse(request.query ?? {}));
  });

  app.delete("/api/campaigns/:id", async (request, reply) => {
    const c = requireCampaign(request.params);
    if (!DELETABLE.has(c.status)) throw invalidState("Stop the campaign before deleting it");
    deleteCampaign(ctx.db, c.id);
    return reply.code(204).send();
  });
}
