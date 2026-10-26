import path from "node:path";
import type { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { isSuppressed } from "../../db/suppression.ts";
import { MalformedTemplateError, MissingVariableError, textToHtml } from "../../domain/template.ts";
import { getList } from "../../import/lists.ts";
import { longDate } from "../../send/compose.ts";
import type { OutgoingMessage } from "../../send/transport.ts";
import { DEFAULT_SEND_TIMEOUT_MS } from "../../send/worker.ts";
import { getSenderConfig, getSettingsView, getSmtpConfig, senderGaps } from "../../settings/store.ts";
import { templateView } from "../../templates/analysis.ts";
import { MAX_LINKS, acknowledgeLink, buildLinkCheck, checkLinks, extractLinks, type LinkCheck } from "../../templates/linkCheck.ts";
import {
  SYNTHETIC_CONTACT,
  composeTestMessages,
  deliverTestMessages,
  pickContact,
  previewTemplate,
  type SampleContact,
} from "../../templates/render.ts";
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  markTested,
  saveLinkCheck,
  updateTemplate,
  type NewTemplate,
  type TemplateRecord,
} from "../../templates/store.ts";
import type { AppContext } from "../context.ts";
import {
  TEMPLATE_MAX_BYTES,
  idParamSchema,
  linkAckSchema,
  templateCreateSchema,
  templatePreviewSchema,
  templateUpdateSchema,
  templateUploadFieldsSchema,
  testSendSchema,
  type TemplatePreview,
  type TemplateView,
  type TestSendResult,
} from "../contract.ts";
import { HttpError, notFound } from "../errors.ts";

const FILE_FIELD = "file";
const TEMPLATE_EXTENSIONS: ReadonlySet<string> = new Set([".html", ".htm", ".txt"]);

async function readCapped(stream: Readable, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  return size > limit ? null : Buffer.concat(chunks);
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError(400, "not_utf8", "The file is not UTF-8 text; save it as UTF-8 and upload it again");
  }
}

async function receiveTemplateUpload(request: FastifyRequest): Promise<NewTemplate> {
  const fields: Record<string, string> = Object.create(null);
  let file: { ext: string; bytes: Buffer } | null = null;
  for await (const part of request.parts()) {
    if (part.type !== "file") {
      if (part.valueTruncated) throw new HttpError(400, "invalid_request", `The "${part.fieldname}" field is too long`);
      fields[part.fieldname] = String(part.value);
      continue;
    }
    const ext = path.extname(part.filename ?? "").toLowerCase();
    if (part.fieldname !== FILE_FIELD || file !== null) {
      part.file.resume();
      throw new HttpError(400, "invalid_request", `Send exactly one file, in the "${FILE_FIELD}" field`);
    }
    if (!TEMPLATE_EXTENSIONS.has(ext)) {
      part.file.resume();
      throw new HttpError(400, "unsupported_file", "Upload an .html, .htm or .txt file");
    }
    const bytes = await readCapped(part.file, TEMPLATE_MAX_BYTES);
    if (!bytes) throw new HttpError(413, "file_too_large", "Template files must be 2 MB or smaller");
    file = { ext, bytes };
  }
  if (!file) throw new HttpError(400, "file_missing", "Choose an .html or .txt file to upload");
  const meta = templateUploadFieldsSchema.parse({ ...fields });
  const content = decodeUtf8(file.bytes);
  if (!content.trim()) throw new HttpError(400, "empty_file", "The file is empty");
  return file.ext === ".txt" ? { ...meta, html: textToHtml(content), text: content } : { ...meta, html: content };
}

function renderFailed(err: unknown): never {
  if (err instanceof MissingVariableError) throw new HttpError(422, "render_failed", err.message, { variable: err.variable });
  if (err instanceof MalformedTemplateError) {
    throw new HttpError(422, "render_failed", err.message, { part: err.part, problems: err.problems });
  }
  throw err;
}

function currentLinkCheck(t: TemplateRecord): LinkCheck {
  if (!t.linkCheck || t.linkCheck.version !== t.version) {
    throw new HttpError(409, "no_link_check", "Run the link check for the current version of this template first");
  }
  return t.linkCheck;
}

export function templateRoutes(app: FastifyInstance, ctx: AppContext): void {
  const requireTemplate = (params: unknown): TemplateRecord => {
    const { id } = idParamSchema.parse(params);
    const t = getTemplate(ctx.db, id);
    if (!t) throw notFound("Template");
    return t;
  };

  const sampleContact = (listId: number | undefined, pick: "first" | "next" | "random" = "first", after?: number): SampleContact => {
    if (listId === undefined) return SYNTHETIC_CONTACT;
    if (!getList(ctx.db, listId)) throw notFound("List");
    return pickContact(ctx.db, listId, pick, after) ?? SYNTHETIC_CONTACT;
  };

  const today = () => longDate(new Date(), getSettingsView(ctx.db, ctx.env).timezone);

  app.get("/api/templates", async () => listTemplates(ctx.db));

  app.post("/api/templates", async (request): Promise<TemplateView> => {
    const input = request.isMultipart() ? await receiveTemplateUpload(request) : templateCreateSchema.parse(request.body ?? {});
    const id = createTemplate(ctx.db, input);
    return templateView(getTemplate(ctx.db, id)!);
  });

  app.get("/api/templates/:id", async (request): Promise<TemplateView> => templateView(requireTemplate(request.params)));

  app.put("/api/templates/:id", async (request): Promise<TemplateView> => {
    const { id } = idParamSchema.parse(request.params);
    const patch = templateUpdateSchema.parse(request.body ?? {});
    const updated = updateTemplate(ctx.db, id, patch);
    if (!updated) throw notFound("Template");
    return templateView(updated);
  });

  app.delete("/api/templates/:id", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    const outcome = deleteTemplate(ctx.db, id);
    if (outcome === "not_found") throw notFound("Template");
    if (outcome === "in_use") throw new HttpError(409, "in_use", "A campaign uses this template; delete the campaign first");
    return reply.code(204).send();
  });

  app.post("/api/templates/:id/preview", async (request): Promise<TemplatePreview> => {
    const t = requireTemplate(request.params);
    const body = templatePreviewSchema.parse(request.body ?? {});
    const contact = sampleContact(body.listId, body.pick, body.afterContactId);
    try {
      return previewTemplate(t, contact, getSenderConfig(ctx.db, ctx.env), today());
    } catch (err) {
      return renderFailed(err);
    }
  });

  app.post("/api/templates/:id/link-check", async (request): Promise<LinkCheck> => {
    const t = requireTemplate(request.params);
    const { urls, variableLinks } = extractLinks(t.html, t.text);
    if (urls.length + variableLinks.length > MAX_LINKS) {
      throw new HttpError(413, "too_many_links", `The template has more than ${MAX_LINKS} different links; remove some and check again`);
    }
    const probes = await checkLinks(urls, ctx.linkChecker);
    const latest = getTemplate(ctx.db, t.id);
    if (!latest) throw notFound("Template");
    if (latest.version !== t.version) throw new HttpError(409, "template_changed", "The template changed during the link check; run it again");
    const check = buildLinkCheck(t.version, probes, variableLinks, latest.linkCheck, new Date());
    saveLinkCheck(ctx.db, t.id, check);
    return check;
  });

  app.post("/api/templates/:id/link-ack", async (request): Promise<LinkCheck> => {
    const t = requireTemplate(request.params);
    const { url } = linkAckSchema.parse(request.body ?? {});
    const next = acknowledgeLink(currentLinkCheck(t), url);
    if (!next) throw new HttpError(404, "not_found", "That link is not in the latest link check");
    saveLinkCheck(ctx.db, t.id, next);
    return next;
  });

  app.post("/api/templates/:id/test-send", async (request): Promise<TestSendResult> => {
    const t = requireTemplate(request.params);
    const body = testSendSchema.parse(request.body ?? {});
    const settings = getSettingsView(ctx.db, ctx.env);
    const outside = (body.to ?? []).filter((to) => !settings.testInboxes.includes(to));
    if (outside.length > 0) {
      throw new HttpError(400, "not_test_inbox", "Test sends only go to the test inboxes in Sender settings", outside);
    }
    if (settings.testInboxes.length === 0) throw new HttpError(422, "no_test_inboxes", "Add at least one test inbox in Sender settings");
    const gaps = senderGaps(settings);
    if (gaps.length > 0) {
      throw new HttpError(422, "sender_incomplete", "Set the from address, postal address and unsubscribe mailbox first", gaps);
    }
    const smtp = getSmtpConfig(ctx.db, ctx.env);
    if (!smtp.host || !smtp.user || !smtp.pass) {
      throw new HttpError(422, "smtp_incomplete", "Enter the SMTP host, username and password first");
    }
    const contact = sampleContact(body.listId);
    const recipients = [...new Set(body.to ?? settings.testInboxes)];
    const sendable = recipients.filter((to) => !isSuppressed(ctx.db, to));
    let messages: OutgoingMessage[];
    try {
      messages = composeTestMessages(t, contact, sendable, getSenderConfig(ctx.db, ctx.env), today());
    } catch (err) {
      return renderFailed(err);
    }
    const delivered = messages.length > 0 ? await deliverTestMessages(messages, ctx.createTransport(smtp), DEFAULT_SEND_TIMEOUT_MS) : [];
    const results = recipients.map(
      (to) => delivered.find((r) => r.to === to) ?? { to, ok: false, messageId: null, error: "suppressed" },
    );
    if (results.every((r) => r.ok)) markTested(ctx.db, t.id, t.version);
    return { results };
  });
}
