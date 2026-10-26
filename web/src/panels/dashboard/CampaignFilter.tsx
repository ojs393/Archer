import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AnalyticsRun } from "@/lib/types";

const ALL = "all";

export function CampaignFilter({
  runs,
  value,
  onChange,
}: {
  runs: AnalyticsRun[];
  value: number | null;
  onChange: (id: number | null) => void;
}) {
  return (
    <Select
      value={value === null ? ALL : String(value)}
      onValueChange={(v) => onChange(v === ALL ? null : Number(v))}
    >
      <SelectTrigger className="w-[min(16rem,100%)]" aria-label="Filter by run">
        <SelectValue placeholder="All runs" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All runs</SelectItem>
        {runs.map((run) => (
          <SelectItem key={run.id} value={String(run.id)}>
            {run.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
