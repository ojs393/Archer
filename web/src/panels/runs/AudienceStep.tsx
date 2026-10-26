import { InfoHint } from "@/components/ui/InfoHint";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNumber } from "@/lib/format";
import { navigateToTab } from "@/lib/tabs";
import type { ListRow } from "@/lib/types";

export function AudienceStep({
  lists,
  listId,
  onListIdChange,
}: {
  lists: ListRow[];
  listId: number | null;
  onListIdChange: (id: number | null) => void;
}) {
  const ready = lists.filter((l) => l.status === "ready");
  const selected = lists.find((l) => l.id === listId) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-1">
          <Label htmlFor="run-audience">Audience list</Label>
          <InfoHint label="About suppressed addresses">Suppressed addresses are skipped automatically.</InfoHint>
        </div>
        {ready.length === 0 ? (
          <p className="text-sm text-secondary-foreground">
            No ready lists yet.{" "}
            <button type="button" className="text-primary underline-offset-4 hover:underline" onClick={() => navigateToTab("audience")}>
              Import a CSV
            </button>{" "}
            first.
          </p>
        ) : (
          <Select
            value={listId !== null ? String(listId) : undefined}
            onValueChange={(v) => onListIdChange(Number(v))}
          >
            <SelectTrigger id="run-audience" aria-label="Audience list">
              <SelectValue placeholder="Select a list" />
            </SelectTrigger>
            <SelectContent>
              {ready.map((list) => (
                <SelectItem key={list.id} value={String(list.id)}>
                  {list.name} ({formatNumber(list.valid_count)} recipients)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {selected ? (
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Recipients</dt>
            <dd className="font-medium tabular">{formatNumber(selected.valid_count)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Suppressed</dt>
            <dd className="font-medium tabular">{formatNumber(selected.suppressed_count)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Status</dt>
            <dd className="font-medium capitalize">{selected.status}</dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
