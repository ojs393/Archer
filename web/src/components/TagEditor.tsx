import { X } from "lucide-react";
import { useState, type KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { folderLabel, isFolderTag } from "@/lib/folders";
import { cn, focusRing } from "@/lib/utils";

/** Normalize tag names; keep `folder:` prefix intact (lowercase body). */
export function normalizeTag(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (isFolderTag(trimmed)) {
    const rest = trimmed.slice("folder:".length).trim().toLowerCase();
    return rest ? `folder:${rest}` : "";
  }
  return trimmed.toLowerCase();
}

/** Chip list + create-on-type input for list/campaign tags (folders shown as Folder · Name). */
export function TagEditor({
  value,
  onChange,
  suggestions = [],
  disabled = false,
  className,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  disabled?: boolean;
  className?: string;
}) {
  const [pending, setPending] = useState("");

  function add(raw: string) {
    const name = normalizeTag(raw);
    if (!name || value.includes(name)) {
      setPending("");
      return;
    }
    // One folder max: replace existing folder tag if adding another.
    if (isFolderTag(name)) {
      onChange([...value.filter((t) => !isFolderTag(t)), name]);
    } else {
      onChange([...value, name]);
    }
    setPending("");
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(pending);
    } else if (e.key === "Backspace" && !pending && value.length) {
      onChange(value.slice(0, -1));
    }
  }

  const unused = suggestions.filter((s) => !value.includes(normalizeTag(s)) && !value.includes(s)).slice(0, 10);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div
        className={cn(
          "flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1.5",
          "focus-within:border-primary",
          focusRing,
        )}
      >
        {value.map((tag) => (
          <Badge key={tag} size="sm" variant={isFolderTag(tag) ? "solid" : "info"} className="gap-0.5 pr-0.5">
            {isFolderTag(tag) ? `Folder · ${folderLabel(tag)}` : tag}
            <button
              type="button"
              className="inline-flex h-4 w-4 items-center justify-center rounded-sm hover:bg-zinc-200"
              aria-label={`Remove ${tag}`}
              disabled={disabled}
              onClick={() => onChange(value.filter((t) => t !== tag))}
            >
              <X className="h-2.5 w-2.5" aria-hidden="true" />
            </button>
          </Badge>
        ))}
        <Input
          value={pending}
          disabled={disabled}
          onChange={(e) => setPending(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(pending)}
          placeholder={value.length ? "Add tag" : "tag or folder:Name"}
          className="h-7 min-w-[8rem] flex-1 border-0 shadow-none focus-visible:ring-0"
          aria-label="Add tag"
        />
      </div>
      {unused.length ? (
        <div className="flex flex-wrap gap-1">
          {unused.map((s) => (
            <Button key={s} type="button" size="sm" variant="subtle" disabled={disabled} onClick={() => add(s)}>
              + {isFolderTag(s) ? folderLabel(s) : s}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
