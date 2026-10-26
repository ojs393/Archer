export type ErrorKind = "retry" | "suppress" | "fail" | "auth" | "config" | "network";

export interface Classified {
  kind: ErrorKind;
  responseCode?: number;
  enhancedCode?: string;
  code?: string;
  message: string;
}

const AUTH_RESPONSE_CODES = new Set([530, 534, 535]);
const NETWORK_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH",
  "EHOSTUNREACH", "EPIPE", "ESOCKET", "ECONNECTION", "EDNS",
]);
const BARE_SUPPRESS_CODES = new Set([550, 551, 553]);
const FAIL_CODES = new Set(["EENVELOPE", "EMESSAGE"]);
const ENHANCED_STATUS = /\b([245])\.(\d{1,3})\.(\d{1,3})\b/;
const MAX_MESSAGE_LENGTH = 300;

interface SmtpFields {
  responseCode?: number;
  code?: string;
  response?: string;
  message?: string;
}

function readFields(err: unknown): SmtpFields {
  if (typeof err !== "object" || err === null) return {};
  const { responseCode, code, response, message } = err as Record<string, unknown>;
  return {
    responseCode: typeof responseCode === "number" ? responseCode : undefined,
    code: typeof code === "string" ? code : undefined,
    response: typeof response === "string" ? response : undefined,
    message: typeof message === "string" ? message : undefined,
  };
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_MESSAGE_LENGTH ? flat.slice(0, MAX_MESSAGE_LENGTH - 1) + "…" : flat;
}

function summarize(err: unknown, fields: SmtpFields): string {
  const raw = typeof err === "string" ? err : fields.message || fields.response || fields.code;
  return oneLine(raw ?? "") || "Unknown error";
}

function kindOf({ responseCode, code }: SmtpFields, enhanced: RegExpExecArray | null): ErrorKind {
  if (code === "EAUTH" || (responseCode !== undefined && AUTH_RESPONSE_CODES.has(responseCode))) return "auth";
  if (code === "ETLS") return "config";
  if (code !== undefined && NETWORK_CODES.has(code)) return "network";
  if (responseCode !== undefined && responseCode >= 400 && responseCode <= 499) return "retry";
  if (responseCode !== undefined && responseCode >= 500 && responseCode <= 599) {
    if (enhanced?.[1] === "5" && enhanced[2] === "1") return "suppress";
    if (enhanced?.[1] === "5" && enhanced[2] === "7") return "fail";
    if (!enhanced && BARE_SUPPRESS_CODES.has(responseCode)) return "suppress";
    return "fail";
  }
  if (code !== undefined && FAIL_CODES.has(code)) return "fail";
  return "retry";
}

export function classifySmtpError(err: unknown): Classified {
  const fields = readFields(err);
  const enhanced = fields.response === undefined ? null : ENHANCED_STATUS.exec(fields.response);
  const result: Classified = { kind: kindOf(fields, enhanced), message: summarize(err, fields) };
  if (fields.responseCode !== undefined) result.responseCode = fields.responseCode;
  if (enhanced) result.enhancedCode = enhanced[0];
  if (fields.code !== undefined) result.code = fields.code;
  return result;
}
