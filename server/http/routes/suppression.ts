import { Readable } from "node:stream";
import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { addSuppression, listSuppression, removeSuppression, type SuppressionRow } from "../../db/suppression.ts";
import type { AppContext } from "../context.ts";
import { suppressionAddSchema, suppressionParamSchema, suppressionQuerySchema } from "../contract.ts";

const EXPORT_CHUNK_ROWS = 500;
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function* exportLines(db: DatabaseSync): Generator<string> {
  yield "email,reason,created_at\r\n";
  let chunk: string[] = [];
  const rows = db.prepare("SELECT email, reason, created_at FROM suppression ORDER BY created_at, email").iterate() as Iterable<SuppressionRow>;
  for (const r of rows) {
    chunk.push(`${csvCell(r.email)},${csvCell(r.reason)},${csvCell(r.created_at)}\r\n`);
    if (chunk.length >= EXPORT_CHUNK_ROWS) {
      yield chunk.join("");
      chunk = [];
    }
  }
  if (chunk.length > 0) yield chunk.join("");
}

export function suppressionRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/suppression", async (request) => {
    const q = suppressionQuerySchema.parse(request.query);
    return listSuppression(ctx.db, q);
  });

  app.post("/api/suppression", async (request, reply) => {
    const body = suppressionAddSchema.parse(request.body);
    const added = addSuppression(ctx.db, body.email, "manual");
    return reply.code(201).send({ added });
  });

  app.delete("/api/suppression/:email", async (request, reply) => {
    const { email } = suppressionParamSchema.parse(request.params);
    removeSuppression(ctx.db, email);
    return reply.code(204).send();
  });

  app.get("/api/suppression/export", async (_request, reply) => {
    const day = new Date().toISOString().slice(0, 10);
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="suppression-${day}.csv"`);
    return reply.send(Readable.from(exportLines(ctx.db)));
  });
}
