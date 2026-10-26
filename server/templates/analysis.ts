import { detectVariables, findMalformedTags, validateVariableMap, type TemplatePart } from "../domain/template.ts";
import type { TemplateAnalysis, TemplateView } from "../http/contract.ts";
import type { TemplateRecord } from "./store.ts";

const COMPLIANCE_TAGS = ["unsubscribe_url", "postal_address"];

export function analyzeTemplate(t: Pick<TemplateRecord, "subject" | "html" | "text" | "variableMap">): TemplateAnalysis {
  const variables = detectVariables(t.subject, t.html, t.text ?? "");
  const parts: [TemplatePart, string | null][] = [
    ["subject", t.subject],
    ["html", t.html],
    ["text", t.text],
  ];
  const malformed = parts
    .map(([part, src]) => ({ part, problems: src === null ? [] : findMalformedTags(src) }))
    .filter((m) => m.problems.length > 0);
  const htmlTags = new Set(detectVariables(t.html).map((v) => v.name));
  return {
    variables,
    malformed,
    validation: validateVariableMap(variables, t.variableMap),
    hasComplianceTags: COMPLIANCE_TAGS.every((tag) => htmlTags.has(tag)),
  };
}

export function templateView(t: TemplateRecord): TemplateView {
  return {
    id: t.id,
    name: t.name,
    version: t.version,
    subject: t.subject,
    html: t.html,
    text: t.text,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    variableMap: t.variableMap,
    analysis: analyzeTemplate(t),
    linkCheck: t.linkCheck,
    testedOk: t.lastTestOkVersion === t.version,
  };
}
