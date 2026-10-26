import { isRoleAddress } from "./email.ts";

const NAME_PART = /^[a-z]{2,20}$/;
const SEPARATOR = /[._-]/;

export function guessFirstName(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0 || isRoleAddress(email)) return null;
  const local = email.slice(0, at).split("+", 1)[0].toLowerCase();
  const parts = local.split(SEPARATOR);
  if (parts.length < 2 || !parts.every((part) => NAME_PART.test(part))) return null;
  const first = parts[0];
  return first[0].toUpperCase() + first.slice(1);
}
