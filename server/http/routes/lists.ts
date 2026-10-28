import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { deleteContact, listContacts, updateContact } from "../../import/contacts.ts";
import { createList, deleteList, getList, getListColumns, getListView, listLists, updateList } from "../../import/lists.ts";
import { PREVIEW_BYTES, PreviewError, previewCsv } from "../../import/preview.ts";
import { addSuppression } from "../../db/suppression.ts";
import type { AppContext } from "../context.ts";
import {
  contactUpdateSchema,
  contactsQuerySchema,
  idParamSchema,
  listContactParamSchema,
  listQuerySchema,
  listUpdateSchema,
  listUploadFieldsSchema,
  type ContactsPage,
  type ListDetail,
  type ListPreview,
  type ListView,
} from "../contract.ts";
import { HttpError, notFound } from "../errors.ts";

const FILE_FIELD = "file";

function fileMissing(): HttpError {
  return new HttpError(400, "file_missing", "Choose a CSV file to upload");
}

function requireMultipart(request: FastifyRequest): void {
  if (!request.isMultipart()) throw new HttpError(415, "unsupported_media_type", "Upload the file as multipart/form-data");
}

async function readHead(stream: Readable, limit: number): Promise<{ head: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    if (size >= limit) {
      truncated = true;
      continue;
    }
    const take = chunk.subarray(0, limit - size);
    chunks.push(take);
    size += take.length;
    if (take.length < chunk.length) truncated = true;
  }
  return { head: Buffer.concat(chunks), truncated };
}

function randomName(): string {
  return randomBytes(8).toString("hex");
}

async function receiveUpload(request: FastifyRequest, uploadsDir: string): Promise<{ tmpPath: string | null; fields: Record<string, string> }> {
  const fields: Record<string, string> = Object.create(null);
  let tmpPath: string | null = null;
  try {
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== FILE_FIELD || tmpPath !== null) {
          part.file.resume();
          throw new HttpError(400, "invalid_request", `Send exactly one file, in the "${FILE_FIELD}" field`);
        }
        tmpPath = path.join(uploadsDir, `incoming-${randomName()}.csv`);
        await pipeline(part.file, fs.createWriteStream(tmpPath, { flags: "wx", mode: 0o600 }));
        if (part.file.truncated) throw new HttpError(413, "file_too_large", "The file is larger than the upload limit");
      } else {
        if (part.valueTruncated) throw new HttpError(400, "invalid_request", `The "${part.fieldname}" field is too long`);
        fields[part.fieldname] = String(part.value);
      }
    }
    return { tmpPath, fields };
  } catch (err) {
    if (tmpPath) await fs.promises.rm(tmpPath, { force: true });
    throw err;
  }
}

export function listRoutes(app: FastifyInstance, ctx: AppContext): void {
  const uploadsDir = ctx.paths.uploadsDir;

  app.get("/api/lists", async (request): Promise<ListView[]> => {
    const q = listQuerySchema.parse(request.query);
    return listLists(ctx.db, q);
  });

  app.post("/api/lists/preview", async (request): Promise<ListPreview> => {
    requireMultipart(request);
    const file = await request.file();
    if (!file || file.fieldname !== FILE_FIELD) {
      file?.file.resume();
      throw fileMissing();
    }
    const { head, truncated } = await readHead(file.file, PREVIEW_BYTES);
    try {
      return previewCsv(head, truncated);
    } catch (err) {
      if (err instanceof PreviewError) throw new HttpError(400, err.code, err.message);
      throw err;
    }
  });

  app.post("/api/lists", async (request, reply) => {
    requireMultipart(request);
    await fs.promises.mkdir(uploadsDir, { recursive: true });
    const { tmpPath, fields } = await receiveUpload(request, uploadsDir);
    let pending = tmpPath;
    try {
      if (!pending) throw fileMissing();
      const input = listUploadFieldsSchema.parse({ ...fields });
      const listId = createList(ctx.db, {
        name: input.name,
        sourceLabel: input.sourceLabel,
        consentText: input.consentText,
        excludeRoles: input.excludeRoles,
      });
      const finalPath = path.join(uploadsDir, `${listId}-${randomName()}.csv`);
      await fs.promises.rename(pending, finalPath);
      pending = null;
      ctx.imports.start(listId, finalPath, {
        emailColumn: input.emailColumn,
        excludeRoles: input.excludeRoles,
        checkDomains: input.checkDomains,
      });
      return reply.code(202).send({ listId });
    } finally {
      if (pending) await fs.promises.rm(pending, { force: true });
    }
  });

  app.get("/api/lists/:id", async (request): Promise<ListDetail> => {
    const { id } = idParamSchema.parse(request.params);
    const list = getListView(ctx.db, id);
    if (!list) throw notFound("List");
    return { ...list, columns: getListColumns(ctx.db, id) };
  });

  app.patch("/api/lists/:id", async (request): Promise<ListDetail> => {
    const { id } = idParamSchema.parse(request.params);
    if (!getList(ctx.db, id)) throw notFound("List");
    const body = listUpdateSchema.parse(request.body ?? {});
    try {
      const list = updateList(ctx.db, id, body);
      return { ...list, columns: getListColumns(ctx.db, id) };
    } catch (err) {
      throw new HttpError(400, "invalid_request", err instanceof Error ? err.message : String(err));
    }
  });

  app.get("/api/lists/:id/contacts", async (request): Promise<ContactsPage> => {
    const { id } = idParamSchema.parse(request.params);
    if (!getList(ctx.db, id)) throw notFound("List");
    const q = contactsQuerySchema.parse(request.query);
    return listContacts(ctx.db, id, q);
  });

  app.patch("/api/lists/:id/contacts/:contactId", async (request) => {
    const { id, contactId } = listContactParamSchema.parse(request.params);
    if (!getList(ctx.db, id)) throw notFound("List");
    const body = contactUpdateSchema.parse(request.body ?? {});
    try {
      return updateContact(ctx.db, id, contactId, body);
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
      if (code === "duplicate_email") throw new HttpError(409, "duplicate_email", err instanceof Error ? err.message : "Duplicate email");
      if (err instanceof Error && /not found/i.test(err.message)) throw notFound("Contact");
      throw new HttpError(400, "invalid_request", err instanceof Error ? err.message : String(err));
    }
  });

  app.delete("/api/lists/:id/contacts/:contactId", async (request, reply) => {
    const { id, contactId } = listContactParamSchema.parse(request.params);
    if (!getList(ctx.db, id)) throw notFound("List");
    if (!deleteContact(ctx.db, id, contactId)) throw notFound("Contact");
    return reply.code(204).send();
  });

  app.post("/api/lists/:id/contacts/:contactId/suppress", async (request, reply) => {
    const { id, contactId } = listContactParamSchema.parse(request.params);
    const list = getList(ctx.db, id);
    if (!list) throw notFound("List");
    const row = ctx.db.prepare("SELECT email FROM contacts WHERE list_id = ? AND id = ?").get(id, contactId) as { email: string } | undefined;
    if (!row) throw notFound("Contact");
    addSuppression(ctx.db, row.email, "manual");
    return reply.code(204).send();
  });

  app.delete("/api/lists/:id", async (request, reply) => {
    const { id } = idParamSchema.parse(request.params);
    if (!getList(ctx.db, id)) throw notFound("List");
    if (ctx.imports.isRunning(id)) throw new HttpError(409, "import_running", "This list is still importing; wait for it to finish");
    const inUse = () => new HttpError(409, "in_use", "A campaign uses this list; delete the campaign first");
    if (ctx.db.prepare("SELECT 1 FROM campaigns WHERE list_id = ? LIMIT 1").get(id)) throw inUse();
    try {
      deleteList(ctx.db, id);
    } catch (err) {
      if (ctx.db.prepare("SELECT 1 FROM campaigns WHERE list_id = ? LIMIT 1").get(id)) throw inUse();
      throw err;
    }
    return reply.code(204).send();
  });
}
