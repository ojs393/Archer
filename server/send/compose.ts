import type { DatabaseSync } from "node:sqlite";
import { renderEmail, type VariableMap } from "../domain/template.ts";
import { issueToken, listUnsubscribeHeaders, unsubscribeLink } from "../domain/unsubscribe.ts";
import type { SendRow, TemplateRow } from "./sendState.ts";
import type { OutgoingMessage } from "./transport.ts";

export interface ComposeSender {
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  postalAddress: string;
  unsubMailbox: string;
  publicBaseUrl: string | null;
  unsubSecret: string;
}

const longDateFormats = new Map<string, Intl.DateTimeFormat>();

export function longDate(instant: Date, timezone: string): string {
  let f = longDateFormats.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: timezone });
    longDateFormats.set(timezone, f);
  }
  return f.format(instant);
}

/** Throws MalformedTemplateError / MissingVariableError from renderEmail. */
export function composeMessage(
  db: DatabaseSync,
  tpl: TemplateRow,
  row: Pick<SendRow, "email" | "fields_json">,
  sender: ComposeSender,
  today: string,
  unsubscribeEmail: string = row.email,
): OutgoingMessage {
  const link = {
    mailbox: sender.unsubMailbox,
    publicBaseUrl: sender.publicBaseUrl,
    token: issueToken(db, unsubscribeEmail, sender.unsubSecret),
  };
  const rendered = renderEmail(
    { subject: tpl.subject, html: tpl.html, text: tpl.text, variableMap: JSON.parse(tpl.variable_map_json) as VariableMap },
    { email: row.email, fields: JSON.parse(row.fields_json) as Record<string, string> },
    { unsubscribeUrl: unsubscribeLink(link), postalAddress: sender.postalAddress, today },
  );
  return {
    from: { name: sender.fromName, address: sender.fromEmail },
    to: row.email,
    ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
    ...rendered,
    headers: listUnsubscribeHeaders(link),
  };
}
