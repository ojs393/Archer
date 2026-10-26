import { Users } from "lucide-react";
import { queryKeys } from "@/lib/queryKeys";
import { CollectionPanel } from "./CollectionPanel";

export default function AudiencePanel() {
  return <CollectionPanel title="Audience" icon={Users} queryKey={queryKeys.lists} path="/api/lists" countLabel="Lists" emptyTitle="No lists yet" />;
}
