/** Folder tags use the `folder:` prefix so lists/campaigns can be sorted without a separate folders table. */
export const FOLDER_PREFIX = "folder:";

export function isFolderTag(name: string): boolean {
  return name.toLowerCase().startsWith(FOLDER_PREFIX);
}

export function folderLabel(name: string): string {
  if (!isFolderTag(name)) return name;
  return name.slice(FOLDER_PREFIX.length).trim() || name;
}

export function folderTag(label: string): string {
  const cleaned = label.trim().replace(/^folder:/i, "").toLowerCase();
  return cleaned ? `${FOLDER_PREFIX}${cleaned}` : FOLDER_PREFIX;
}

export function folderOptions(tags: { name: string; listCount?: number; campaignCount?: number }[]): { value: string; label: string }[] {
  return tags
    .filter((t) => isFolderTag(t.name))
    .map((t) => ({
      value: t.name,
      label: folderLabel(t.name),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
