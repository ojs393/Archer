import { ArrowDownAZ, ArrowUpAZ, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type FilterOption = { value: string; label: string };

/** Shared search / status / tag / sort toolbar for Audience and Runs. */
export function FilterToolbar({
  q,
  onQ,
  status,
  onStatus,
  statusOptions,
  tag,
  onTag,
  tagOptions,
  folder,
  onFolder,
  folderOptions,
  sort,
  onSort,
  sortOptions,
  order,
  onOrder,
}: {
  q: string;
  onQ: (v: string) => void;
  status: string;
  onStatus: (v: string) => void;
  statusOptions: FilterOption[];
  tag: string;
  onTag: (v: string) => void;
  tagOptions: FilterOption[];
  folder?: string;
  onFolder?: (v: string) => void;
  folderOptions?: FilterOption[];
  sort: string;
  onSort: (v: string) => void;
  sortOptions: FilterOption[];
  order: "asc" | "desc";
  onOrder: (v: "asc" | "desc") => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      <div className="relative min-w-[12rem] flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={q}
          onChange={(e) => onQ(e.target.value)}
          placeholder="Search…"
          className="pl-8"
          aria-label="Search"
        />
      </div>
      <Select value={status || "__all"} onValueChange={(v) => onStatus(v === "__all" ? "" : v)}>
        <SelectTrigger className="w-[9rem]" aria-label="Status">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All statuses</SelectItem>
          {statusOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {onFolder && folderOptions ? (
        <Select value={folder || "__all"} onValueChange={(v) => onFolder(v === "__all" ? "" : v)}>
          <SelectTrigger className="w-[9rem]" aria-label="Folder">
            <SelectValue placeholder="Folder" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All folders</SelectItem>
            {folderOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <Select value={tag || "__all"} onValueChange={(v) => onTag(v === "__all" ? "" : v)}>
        <SelectTrigger className="w-[9rem]" aria-label="Tag">
          <SelectValue placeholder="Tag" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">All tags</SelectItem>
          {tagOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={sort} onValueChange={onSort}>
        <SelectTrigger className="w-[9rem]" aria-label="Sort by">
          <SelectValue placeholder="Sort" />
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-label={order === "asc" ? "Ascending" : "Descending"}
        onClick={() => onOrder(order === "asc" ? "desc" : "asc")}
      >
        {order === "asc" ? <ArrowUpAZ aria-hidden="true" /> : <ArrowDownAZ aria-hidden="true" />}
        {order === "asc" ? "Asc" : "Desc"}
      </Button>
    </div>
  );
}
