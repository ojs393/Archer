import { emailDomain } from "./email.ts";
import { guessFirstName } from "./guessName.ts";
import { htmlToText } from "./htmlToText.ts";

export interface TemplateVariable {
  name: string;
  fallback: string | null;
  alwaysHasFallback: boolean;
  occurrences: number;
}

export const BUILTIN_KEYS = ["email", "first_name", "domain", "unsubscribe_url", "postal_address", "today"] as const;
export type BuiltinKey = (typeof BUILTIN_KEYS)[number];

export type VariableSource =
  | { kind: "column"; column: string }
  | { kind: "builtin"; key: BuiltinKey }
  | { kind: "fixed"; value: string };
export type VariableMap = Record<string, VariableSource>;

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string | null;
  variableMap: VariableMap;
}

export interface RenderContext {
  unsubscribeUrl: string;
  postalAddress: string;
  today: string;
}

export class MissingVariableError extends Error {
  readonly variable: string;

  constructor(variable: string) {
    super(`No value or fallback for {{${variable}}}`);
    this.name = "MissingVariableError";
    this.variable = variable;
  }
}

const TAG_SOURCE = String.raw`\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|\s*([^{}]*?)\s*)?\}\}`;
const OPEN = "{{";
const SNIPPET_MAX = 40;
const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const HEADER_BREAKS = /\s*[\r\n\u2028\u2029]+\s*/g;
const FIRST_NAME_HEADERS: ReadonlySet<string> = new Set(["first_name", "firstname", "first"]);
const FULL_NAME_HEADERS: ReadonlySet<string> = new Set(["name", "full_name", "fullname"]);
const FOOTER_KEYS = ["unsubscribe_url", "postal_address"] as const satisfies readonly BuiltinKey[];

function tagPattern(flags = "g"): RegExp {
  return new RegExp(TAG_SOURCE, flags);
}

export function detectVariables(...texts: string[]): TemplateVariable[] {
  const byName = new Map<string, TemplateVariable>();
  for (const text of texts) {
    for (const [, name, rawFallback] of text.matchAll(tagPattern())) {
      const fallback = rawFallback ?? null;
      const seen = byName.get(name);
      if (!seen) {
        byName.set(name, { name, fallback, alwaysHasFallback: fallback !== null, occurrences: 1 });
        continue;
      }
      seen.occurrences += 1;
      seen.fallback ??= fallback;
      seen.alwaysHasFallback &&= fallback !== null;
    }
  }
  return [...byName.values()];
}

function malformedSnippet(text: string, index: number, braceRunEnd: number): string {
  const close = text.indexOf("}}", index + OPEN.length);
  const nextOpen = text.indexOf(OPEN, braceRunEnd);
  const end = Math.min(
    text.length,
    index + SNIPPET_MAX,
    close < 0 ? Infinity : close + 2,
    nextOpen < 0 ? Infinity : nextOpen,
  );
  return text.slice(index, end);
}

export function findMalformedTags(text: string): { index: number; snippet: string }[] {
  const malformed: { index: number; snippet: string }[] = [];
  const tagAt = tagPattern("y");
  let from = 0;
  for (let index = text.indexOf(OPEN); index >= 0; index = text.indexOf(OPEN, from)) {
    let braceRunEnd = index;
    while (text[braceRunEnd] === "{") braceRunEnd += 1;
    tagAt.lastIndex = braceRunEnd - OPEN.length;
    if (tagAt.test(text)) {
      from = tagAt.lastIndex;
      continue;
    }
    malformed.push({ index, snippet: malformedSnippet(text, index, braceRunEnd) });
    from = braceRunEnd;
  }
  return malformed;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

export function stripHeaderBreaks(s: string): string {
  return s.replace(HEADER_BREAKS, " ").trim();
}

export function renderTemplate(
  src: string,
  values: Readonly<Record<string, string | null | undefined>>,
  opts: { escape: boolean },
): string {
  return src.replace(tagPattern(), (_tag, name: string, fallback: string | undefined) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    if (value != null && value.trim() !== "") return opts.escape ? escapeHtml(value) : value;
    if (fallback !== undefined) return fallback;
    throw new MissingVariableError(name);
  });
}

function isBuiltinKey(name: string): name is BuiltinKey {
  return (BUILTIN_KEYS as readonly string[]).includes(name);
}

function sourceFor(name: string, map: VariableMap): VariableSource | null {
  if (Object.hasOwn(map, name)) return map[name];
  return isBuiltinKey(name) ? { kind: "builtin", key: name } : null;
}

function canBeEmpty(source: VariableSource): boolean {
  switch (source.kind) {
    case "column":
      return true;
    case "builtin":
      return source.key === "first_name";
    case "fixed":
      return source.value.trim() === "";
  }
}

export function validateVariableMap(
  vars: TemplateVariable[],
  map: VariableMap,
): { ok: boolean; unresolved: string[]; needsFallback: string[] } {
  const unresolved: string[] = [];
  const needsFallback: string[] = [];
  for (const { name, alwaysHasFallback } of vars) {
    if (alwaysHasFallback) continue;
    const source = sourceFor(name, map);
    if (source === null) unresolved.push(name);
    else if (canBeEmpty(source)) needsFallback.push(name);
  }
  return { ok: unresolved.length === 0 && needsFallback.length === 0, unresolved, needsFallback };
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function fieldByHeader(fields: Readonly<Record<string, string>>, headers: ReadonlySet<string>): string | null {
  for (const [header, value] of Object.entries(fields)) {
    if (headers.has(normalizeHeader(header)) && value.trim() !== "") return value.trim();
  }
  return null;
}

export function resolveFirstName(fields: Readonly<Record<string, string>>, email: string): string | null {
  const first = fieldByHeader(fields, FIRST_NAME_HEADERS);
  if (first !== null) return first;
  const full = fieldByHeader(fields, FULL_NAME_HEADERS);
  if (full !== null) return full.split(/\s+/, 1)[0];
  return guessFirstName(email);
}

export function textToHtml(text: string): string {
  return escapeHtml(text.replace(/\r\n?/g, "\n"))
    .split(/\n\s*\n/)
    .map((block) => block.replace(/^\n+|\n+$/g, ""))
    .filter((block) => block.trim() !== "")
    .map((block) => `<p>${block.split("\n").join("<br>")}</p>`)
    .join("\n");
}

function sourceValue(
  source: VariableSource,
  fields: Readonly<Record<string, string>>,
  builtins: Readonly<Record<BuiltinKey, string | null>>,
): string | null {
  switch (source.kind) {
    case "column":
      return Object.hasOwn(fields, source.column) ? fields[source.column] : null;
    case "builtin":
      return builtins[source.key];
    case "fixed":
      return source.value;
  }
}

function hasComplianceTags(text: string, map: VariableMap): boolean {
  const names = new Set(detectVariables(text).map((v) => v.name));
  return FOOTER_KEYS.every((key) => {
    const source = sourceFor(key, map);
    return names.has(key) && source?.kind === "builtin" && source.key === key;
  });
}

function htmlFooter(ctx: RenderContext): string {
  const postal = escapeHtml(ctx.postalAddress).replace(/\r\n?|\n/g, "<br>");
  return (
    '<div style="margin-top:24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#64748b">' +
    `${postal}<br><a href="${escapeHtml(ctx.unsubscribeUrl)}" style="color:#059669">Unsubscribe</a></div>`
  );
}

function insertBeforeBodyEnd(html: string, footer: string): string {
  const bodyEnd = html.toLowerCase().lastIndexOf("</body");
  return bodyEnd < 0 ? html + footer : html.slice(0, bodyEnd) + footer + html.slice(bodyEnd);
}

function textFooter(ctx: RenderContext): string {
  return `\n\n--\n${ctx.postalAddress}\nUnsubscribe: ${ctx.unsubscribeUrl}\n`;
}

export function renderEmail(
  template: EmailTemplate,
  contact: { email: string; fields: Readonly<Record<string, string>> },
  ctx: RenderContext,
): { subject: string; html: string; text: string } {
  const builtins: Record<BuiltinKey, string | null> = {
    email: contact.email,
    first_name: resolveFirstName(contact.fields, contact.email),
    domain: emailDomain(contact.email),
    unsubscribe_url: ctx.unsubscribeUrl,
    postal_address: ctx.postalAddress,
    today: ctx.today,
  };
  const values = Object.fromEntries(
    detectVariables(template.subject, template.html, template.text ?? "").map(({ name }) => {
      const source = sourceFor(name, template.variableMap) ?? { kind: "column", column: name };
      return [name, sourceValue(source, contact.fields, builtins)];
    }),
  );

  const subject = stripHeaderBreaks(renderTemplate(template.subject, values, { escape: false }));
  const renderedHtml = renderTemplate(template.html, values, { escape: true });
  const renderedText =
    template.text !== null ? renderTemplate(template.text, values, { escape: false }) : htmlToText(renderedHtml);

  const htmlHasCompliance = hasComplianceTags(template.html, template.variableMap);
  const textHasCompliance =
    htmlHasCompliance && (template.text === null || hasComplianceTags(template.text, template.variableMap));

  return {
    subject,
    html: htmlHasCompliance ? renderedHtml : insertBeforeBodyEnd(renderedHtml, htmlFooter(ctx)),
    text: textHasCompliance ? renderedText : renderedText.trimEnd() + textFooter(ctx),
  };
}
