import type { DatabaseSync } from "node:sqlite";
import { renderEmail } from "../domain/template.ts";
import { signToken, unsubscribeLink } from "../domain/unsubscribe.ts";
import type { TemplatePreview, TestSendResult } from "../http/contract.ts";
import { runCapped } from "../send/async.ts";
import { composeMessage } from "../send/compose.ts";
import type { MailTransport, OutgoingMessage } from "../send/transport.ts";
import type { SenderConfig } from "../send/worker.ts";
import { toTemplateRow, type TemplateRecord } from "./store.ts";

export interface SampleContact {
  id: number | null;
  email: string;
  fields_json: string;
}

export type ContactPick = "first" | "next" | "random";

export const SYNTHETIC_CONTACT: SampleContact = { id: null, email: "jane.doe@example.com", fields_json: "{}" };
export const POSTAL_PLACEHOLDER = "[postal address not set]";
export const UNSUBSCRIBE_PLACEHOLDER = "#unsubscribe";
const TEST_PREFIX = "[TEST] ";
const MAX_ERROR_LENGTH = 300;

const COLUMNS = "SELECT id, email, fields_json FROM contacts WHERE list_id = ?";

export function pickContact(
  db: DatabaseSync,
  listId: number,
  pick: ContactPick,
  afterContactId?: number,
  random: () => number = Math.random,
): SampleContact | null {
  const first = () => db.prepare(`${COLUMNS} ORDER BY id LIMIT 1`).get(listId) as SampleContact | undefined;
  const from = (id: number) => db.prepare(`${COLUMNS} AND id >= ? ORDER BY id LIMIT 1`).get(listId, id) as SampleContact | undefined;
  let row: SampleContact | undefined;
  if (pick === "next" && afterContactId !== undefined) row = from(afterContactId + 1) ?? first();
  else if (pick === "random") {
    const { lo, hi } = db.prepare("SELECT MIN(id) AS lo, MAX(id) AS hi FROM contacts WHERE list_id = ?").get(listId) as {
      lo: number | null;
      hi: number | null;
    };
    row = lo === null || hi === null ? undefined : from(lo + Math.floor(random() * (hi - lo + 1)));
  } else row = first();
  return row ? { id: row.id, email: row.email, fields_json: row.fields_json } : null;
}

/** Preview uses a legacy-shaped token (no DB row) so clicking preview never writes tokens. */
function previewUnsubscribeUrl(sender: SenderConfig, email: string): string {
  if (!sender.unsubMailbox.trim() && !sender.publicBaseUrl) return UNSUBSCRIBE_PLACEHOLDER;
  try {
    return unsubscribeLink({ mailbox: sender.unsubMailbox, publicBaseUrl: sender.publicBaseUrl, token: signToken(email, sender.unsubSecret) });
  } catch {
    return UNSUBSCRIBE_PLACEHOLDER;
  }
}

/** Throws MalformedTemplateError / MissingVariableError from renderEmail. */
export function previewTemplate(t: TemplateRecord, contact: SampleContact, sender: SenderConfig, today: string): TemplatePreview {
  const rendered = renderEmail(
    { subject: t.subject, html: t.html, text: t.text, variableMap: t.variableMap },
    { email: contact.email, fields: JSON.parse(contact.fields_json) as Record<string, string> },
    {
      unsubscribeUrl: previewUnsubscribeUrl(sender, contact.email),
      postalAddress: sender.postalAddress.trim() || POSTAL_PLACEHOLDER,
      today,
    },
  );
  return { contactId: contact.id, email: contact.email, ...rendered };
}

/** Renders as `contact`, addressed to each inbox; the unsubscribe link belongs to the inbox, never to the contact. */
export function composeTestMessages(
  db: DatabaseSync,
  t: TemplateRecord,
  contact: SampleContact,
  inboxes: string[],
  sender: SenderConfig,
  today: string,
): OutgoingMessage[] {
  const tpl = toTemplateRow(t);
  return inboxes.map((inbox) => {
    const message = composeMessage(db, tpl, contact, sender, today, inbox);
    return { ...message, to: inbox, subject: TEST_PREFIX + message.subject };
  });
}

function errorLine(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_LENGTH);
}

export async function deliverTestMessages(
  messages: OutgoingMessage[],
  transport: MailTransport,
  timeoutMs: number,
): Promise<TestSendResult["results"]> {
  const never = new AbortController().signal;
  const results: TestSendResult["results"] = [];
  try {
    for (const message of messages) {
      const r = await runCapped(() => transport.send(message), timeoutMs, never);
      if (r.kind === "ok") results.push({ to: message.to, ok: true, messageId: r.value.messageId || null, error: null });
      else {
        const error = r.kind === "error" ? errorLine(r.err) : `no reply within ${Math.round(timeoutMs / 1000)}s`;
        results.push({ to: message.to, ok: false, messageId: null, error });
      }
    }
  } finally {
    transport.close();
  }
  return results;
}
