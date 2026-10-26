import type { LucideIcon } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { StatCard } from "@/components/StatCard";
import { Card } from "@/components/ui/card";
import { formatNumber } from "@/lib/format";
import { useCollection } from "@/lib/queries";
import { PanelShell } from "./PanelShell";

/** Placeholder until the full screen lands: the collection size, or an empty state. */
export function CollectionPanel({
  title,
  icon,
  queryKey,
  path,
  countLabel,
  emptyTitle,
}: {
  title: string;
  icon: LucideIcon;
  queryKey: readonly string[];
  path: string;
  countLabel: string;
  emptyTitle: string;
}) {
  const query = useCollection<unknown>(queryKey, path);
  const count = query.data?.length ?? 0;
  return (
    <PanelShell title={title}>
      {query.isPending || count > 0 ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label={countLabel} value={formatNumber(count)} loading={query.isPending} />
        </div>
      ) : (
        <Card>
          <EmptyState icon={icon} title={query.isError ? "Could not load" : emptyTitle} />
        </Card>
      )}
    </PanelShell>
  );
}
