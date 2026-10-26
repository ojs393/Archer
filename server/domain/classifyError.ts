export type ErrorKind = "retry" | "suppress" | "fail" | "auth" | "config" | "network";

export interface Classified {
  kind: ErrorKind;
  responseCode?: number;
  enhancedCode?: string;
  code?: string;
  command?: string;
  message: string;
}

const AUTH_RESPONSE_CODES = new Set([530, 534, 535]);
const NETWORK_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH",
  "EHOSTUNREACH", "EPIPE", "ESOCKET", "ECONNECTION", "EDNS",
]);
const BARE_SUPPRESS_CODES = new Set([550, 551, 553]);
const FAIL_CODES = new Set(["EENVELOPE", "EMESSAGE"]);
const SENDER_ENHANCED_CODES = new Set(["5.1.7", "5.1.8"]);
const ENHANCED_STATUS = /^\d{3}[ -]([245])\.(\d{1,3})\.(\d{1,3})\b/m;
const MAX_MESSAGE_LENGTH = 300;

interface SmtpFields {
  responseCode?: number;
  code?: string;
  command?: string;
  response?: string;
  message?: string;
}

function readFields(err: unknown): SmtpFields {
  if (typeof err !== "object" || err === null) return {};
  const { responseCode, code, command, response, message } = err as Record<string, unknown>;
  return {
    responseCode: typeof responseCode === "number" ? responseCode : undefined,
    code: typeof code === "string" ? code : undefined,
    command: typeof command === "string" ? command : undefined,
    response: typeof response === "string" ? response : undefined,
    message: typeof message === "string" ? message : undefined,
  };
}

function enhancedCodeOf(response: string | undefined): string | undefined {
  const match = response === undefined ? null : ENHANCED_STATUS.exec(response);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : undefined;
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_MESSAGE_LENGTH ? flat.slice(0, MAX_MESSAGE_LENGTH - 1) + "…" : flat;
}

function summarize(err: unknown, fields: SmtpFields): string {
  const raw = typeof err === "string" ? err : fields.message || fields.response || fields.code;
  return oneLine(raw ?? "") || "Unknown error";
}

function permanentKind(responseCode: number, command: string | undefined, enhanced: string | undefined): ErrorKind {
  if (command === "MAIL FROM" || (enhanced !== undefined && SENDER_ENHANCED_CODES.has(enhanced))) return "config";
  if (command !== undefined && command !== "RCPT TO") return "fail";
  if (enhanced === undefined) return BARE_SUPPRESS_CODES.has(responseCode) ? "suppress" : "fail";
  if (enhanced.startsWith("5.1.") || enhanced === "5.2.1") return "suppress";
  return "fail";
}

function kindOf({ responseCode, code, command }: SmtpFields, enhanced: string | undefined): ErrorKind {
  if (code === "EAUTH" || (responseCode !== undefined && AUTH_RESPONSE_CODES.has(responseCode))) return "auth";
  if (code === "ETLS") return "config";
  if (code !== undefined && NETWORK_CODES.has(code)) return "network";
  if (responseCode !== undefined && responseCode >= 400 && responseCode <= 499) return "retry";
  if (responseCode !== undefined && responseCode >= 500 && responseCode <= 599) {
    return permanentKind(responseCode, command, enhanced);
  }
  if (code !== undefined && FAIL_CODES.has(code)) return "fail";
  return "retry";
}

export function classifySmtpError(err: unknown): Classified {
  const fields = readFields(err);
  const enhanced = enhancedCodeOf(fields.response);
  const result: Classified = { kind: kindOf(fields, enhanced), message: summarize(err, fields) };
  if (fields.responseCode !== undefined) result.responseCode = fields.responseCode;
  if (enhanced !== undefined) result.enhancedCode = enhanced;
  if (fields.code !== undefined) result.code = fields.code;
  if (fields.command !== undefined) result.command = fields.command;
  return result;
}
