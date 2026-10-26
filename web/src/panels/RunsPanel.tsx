import { Send } from "lucide-react";
import { queryKeys } from "@/lib/queryKeys";
import { CollectionPanel } from "./CollectionPanel";

export default function RunsPanel() {
  return <CollectionPanel title="Runs" icon={Send} queryKey={queryKeys.campaigns} path="/api/campaigns" countLabel="Runs" emptyTitle="No runs yet" />;
}
