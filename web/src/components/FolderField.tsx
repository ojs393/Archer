import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { folderLabel, folderOptions, folderTag, isFolderTag } from "@/lib/folders";

const NONE = "__none";

/** Pick or clear a single `folder:*` tag; other tags stay untouched. */
export function FolderField({
  tags,
  onChange,
  catalog = [],
  disabled = false,
  id = "folder-field",
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  catalog?: { name: string }[];
  disabled?: boolean;
  id?: string;
}) {
  const current = tags.find(isFolderTag) ?? "";
  const options = folderOptions([
    ...catalog,
    ...tags.filter(isFolderTag).map((name) => ({ name })),
  ]);
  // Deduplicate by value
  const seen = new Set<string>();
  const unique = options.filter((o) => {
    if (seen.has(o.value)) return false;
    seen.add(o.value);
    return true;
  });

  function setFolder(next: string) {
    const without = tags.filter((t) => !isFolderTag(t));
    onChange(next ? [...without, next] : without);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Folder</Label>
      <Select
        value={current || NONE}
        disabled={disabled}
        onValueChange={(v) => setFolder(v === NONE ? "" : v)}
      >
        <SelectTrigger id={id} aria-label="Folder">
          <SelectValue placeholder="No folder" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No folder</SelectItem>
          {unique.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
          {/* Quick picks for common categories when catalog is empty */}
          {!unique.some((o) => o.value === folderTag("CRM")) ? (
            <SelectItem value={folderTag("CRM")}>{folderLabel(folderTag("CRM"))}</SelectItem>
          ) : null}
          {!unique.some((o) => o.value === folderTag("Newsletter")) ? (
            <SelectItem value={folderTag("Newsletter")}>{folderLabel(folderTag("Newsletter"))}</SelectItem>
          ) : null}
          {!unique.some((o) => o.value === folderTag("Warmup")) ? (
            <SelectItem value={folderTag("Warmup")}>{folderLabel(folderTag("Warmup"))}</SelectItem>
          ) : null}
        </SelectContent>
      </Select>
    </div>
  );
}
