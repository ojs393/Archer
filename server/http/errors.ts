import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import type { Logger } from "../logger.ts";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function notFound(what: string): HttpError {
  return new HttpError(404, "not_found", `${what} not found`);
}

const KNOWN_CLIENT_ERRORS: Record<string, { status: number; code: string; message: string }> = {
  FST_ERR_CTP_BODY_TOO_LARGE: { status: 413, code: "body_too_large", message: "The request body is too large" },
  FST_ERR_CTP_INVALID_MEDIA_TYPE: { status: 415, code: "unsupported_media_type", message: "Unsupported content type" },
  FST_ERR_CTP_INVALID_CONTENT_LENGTH: { status: 400, code: "invalid_request", message: "Invalid Content-Length" },
  FST_ERR_CTP_EMPTY_JSON_BODY: { status: 400, code: "invalid_request", message: "The JSON body is empty" },
  FST_REQ_FILE_TOO_LARGE: { status: 413, code: "file_too_large", message: "The file is larger than 2 GB" },
  FST_FILES_LIMIT: { status: 413, code: "too_many_files", message: "Upload one file at a time" },
  FST_FIELDS_LIMIT: { status: 413, code: "too_many_fields", message: "Too many form fields" },
  FST_PARTS_LIMIT: { status: 413, code: "too_many_fields", message: "Too many form parts" },
  FST_INVALID_MULTIPART_CONTENT_TYPE: { status: 400, code: "invalid_request", message: "Expected a multipart/form-data upload" },
  FST_PROTO_VIOLATION: { status: 400, code: "invalid_request", message: "Invalid form field name" },
};

function sendError(reply: FastifyReply, status: number, code: string, message: string, details?: unknown) {
  return reply.code(status).send({ error: details === undefined ? { code, message } : { code, message, details } });
}

export function errorHandler(log: Logger) {
  return (err: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof HttpError) return sendError(reply, err.status, err.code, err.message, err.details);
    if (err instanceof ZodError) return sendError(reply, 400, "invalid_request", "The request is invalid", err.issues);
    const fe = err as FastifyError & { code?: string };
    const known = fe.code ? KNOWN_CLIENT_ERRORS[fe.code] : undefined;
    if (known) return sendError(reply, known.status, known.code, known.message);
    if (err instanceof SyntaxError || fe.code === "FST_ERR_CTP_INVALID_JSON_BODY") {
      return sendError(reply, 400, "invalid_request", "The request body is not valid JSON");
    }
    if (fe.code === "ENOSPC") return sendError(reply, 507, "disk_full", "The disk is full; free up space and try again");
    const status = typeof fe.statusCode === "number" ? fe.statusCode : 500;
    if (status >= 400 && status < 500) return sendError(reply, status, "bad_request", "The request could not be processed");
    log.error(`HTTP ${request.method} ${request.routeOptions.url ?? "(unmatched)"} failed:`, err);
    return sendError(reply, 500, "internal", "Something went wrong on the server; details are in the MamaDirect log");
  };
}
